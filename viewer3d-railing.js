// ══════════════════════════════════════════════
// VIEWER3D-RAILING.JS — периметр террасы и ограждение
// Выделен из viewer3d-core.js:
//   • terracePerimeterSegments + skip-диапазоны (стены дома / проём ступеней /
//     стыки террасных блоков)
//   • union-контур террасных блоков (_terraceUnionLoops), орто-инсеты
//   • buildRailing3d — GLB-секции mod_railing
// (Навес над террасой убран по TODO.md, этап 1 п.5: вместе с ним ушли высокие
// столбы-опоры, плиты навеса и колонны.)
// Общая глобальная область видимости с остальными viewer3d-* (см. шапку
// viewer3d-builders.js); подключается последним из трёх.
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// ПЕРИМЕТР ТЕРРАСЫ — расчёт сегментов для перил.
// Возвращает массив сегментов {ax,az,bx,bz} по внешнему контуру террасного rect,
// исключая участки: у стен дома (pad 0.30 м), у входа на ступени (pad 0.40 м),
// на стыках с другими террасными rect'ами. Перила рисуются по этим сегментам.
// ══════════════════════════════════════════════

// t-диапазоны на сегменте, прилегающие к одному из targetEdges (параллельны ~6° И ближе pad).
function _railEdgesSkipRanges(ax,az,bx,bz,pad,targetEdges){
  const dx=bx-ax, dz=bz-az;
  const len=Math.sqrt(dx*dx+dz*dz);
  if (len < 0.01) return [];
  const dux=dx/len, duz=dz/len;
  const ranges=[];
  for (const [h0x,h0z,h1x,h1z] of targetEdges) {
    const hdx=h1x-h0x, hdz=h1z-h0z;
    const hlen=Math.sqrt(hdx*hdx+hdz*hdz);
    if (hlen < 0.01) continue;
    const hux=hdx/hlen, huz=hdz/hlen;
    if (Math.abs(dux*huz - duz*hux) > 0.1) continue;
    const vx=ax-h0x, vz=az-h0z;
    const dot=vx*hux + vz*huz;
    const perpSq = Math.max(0, vx*vx+vz*vz - dot*dot);
    if (perpSq > pad*pad) continue;
    const t0=((h0x-ax)*dux + (h0z-az)*duz) / len;
    const t1=((h1x-ax)*dux + (h1z-az)*duz) / len;
    const tmin=Math.max(0, Math.min(t0,t1));
    const tmax=Math.min(1, Math.max(t0,t1));
    if (tmax > tmin + 0.001) ranges.push([tmin, tmax]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length-1][1] + 0.001) {
      merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], r[1]);
    } else merged.push([r[0], r[1]]);
  }
  return merged;
}

// Разбивает сегмент [0..1] минус skipRanges на подсегменты.
function _railSplitBySkipRanges(ax,az,bx,bz,skipRanges){
  const out=[]; let t=0;
  for (const [s,e] of skipRanges) {
    if (s > t + 0.001) out.push({ax: ax+(bx-ax)*t, az: az+(bz-az)*t, bx: ax+(bx-ax)*s, bz: az+(bz-az)*s});
    t = Math.max(t, e);
  }
  if (t < 1 - 0.001) out.push({ax: ax+(bx-ax)*t, az: az+(bz-az)*t, bx, bz});
  return out;
}

// Рёбра outline дома (мир) — из кэша _housePoly текущей сборки.
function _railHouseEdges(){
  const edges=[];
  if (_housePoly && _housePoly.corners && _housePoly.corners.length >= 3) {
    const c = _housePoly.corners;
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i+1)%c.length];
      edges.push([a.x, a.z, b.x, b.z]);
    }
  }
  return edges;
}

// Рёбра rect ступеней (мир).
function _railStepsEdges(houseL, houseW){
  const edges=[];
  if (S.sections.includes('steps') && S.steps) {
    const sc = canvasToWorld([
      { x: S.steps.x,             y: S.steps.y },
      { x: S.steps.x + S.steps.w, y: S.steps.y },
      { x: S.steps.x + S.steps.w, y: S.steps.y + S.steps.h },
      { x: S.steps.x,             y: S.steps.y + S.steps.h },
    ], houseL, houseW);
    for (let i = 0; i < 4; i++) { const a = sc[i], b = sc[(i+1)%4]; edges.push([a.x, a.z, b.x, b.z]); }
  }
  return edges;
}

// t-диапазоны, где ребро внутреннее (стыкуется с другим террасным rect).
function _railInterTerraceSkip(ax,az,bx,bz,cX,cZ,otherRects){
  if (!otherRects || !otherRects.length) return [];
  const dx=bx-ax, dz=bz-az, len=Math.hypot(dx,dz);
  if (len < 0.01) return [];
  let nx=dz/len, nz=-dx/len;
  const midx=(ax+bx)/2, midz=(az+bz)/2;
  if (nx*(midx-cX) + nz*(midz-cZ) < 0) { nx=-nx; nz=-nz; }
  const eps=0.12, N=Math.max(2, Math.ceil(len/0.05));
  const ranges=[]; let run=null;
  for (let k=0;k<=N;k++){
    const t=k/N;
    const px=ax+dx*t + nx*eps, pz=az+dz*t + nz*eps;
    let inside=false;
    for (const r of otherRects){
      if (px>=r.minX-1e-4 && px<=r.maxX+1e-4 && pz>=r.minZ-1e-4 && pz<=r.maxZ+1e-4){ inside=true; break; }
    }
    if (inside){ if(!run) run=[t,t]; else run[1]=t; }
    else if (run){ ranges.push(run); run=null; }
  }
  if (run) ranges.push(run);
  return ranges;
}

// Главная: сегменты периметра террасного rect (где есть перила / куда ставить опоры).
function terracePerimeterSegments(worldPts, houseL, houseW, otherRects){
  otherRects = otherRects || [];
  const cX = worldPts.reduce((s,p)=>s+p.x,0)/worldPts.length;
  const cZ = worldPts.reduce((s,p)=>s+p.z,0)/worldPts.length;
  const houseEdges = _railHouseEdges();
  const stepsEdges = _railStepsEdges(houseL, houseW);
  const segs=[];
  for(let i=0;i<worldPts.length;i++){
    const cur=worldPts[i], next=worldPts[(i+1)%worldPts.length];
    const wallSkip  = _railEdgesSkipRanges(cur.x, cur.z, next.x, next.z, 0.30, houseEdges);
    // Проём под лестницу сужаем на STAIR_RAIL_INSET с каждой «внутренней» границы:
    // перила лестницы сдвинуты внутрь на тот же inset (latOff), и теперь конец перил
    // террасы + колонна навеса на углу проёма встают на ту же линию (соосно).
    // Границу, упирающуюся в конец сегмента (угол террасы), не двигаем.
    const segLen = Math.hypot(next.x - cur.x, next.z - cur.z);
    const inT = segLen > 0.01 ? STAIR_RAIL_INSET / segLen : 0;
    const stepsSkip = (stepsEdges.length
        ? _railEdgesSkipRanges(cur.x, cur.z, next.x, next.z, 0.40, stepsEdges)
        : [])
      .map(([s, e]) => [s > 0.001 ? s + inT : s, e < 0.999 ? e - inT : e])
      .filter(([s, e]) => e > s + 0.001);
    const interSkip = _railInterTerraceSkip(cur.x, cur.z, next.x, next.z, cX, cZ, otherRects);
    const allSkips = [...wallSkip, ...stepsSkip, ...interSkip].sort((a,b)=>a[0]-b[0]);
    const merged=[];
    for (const r of allSkips) {
      if (merged.length && r[0] <= merged[merged.length-1][1] + 0.001) {
        merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], r[1]);
      } else merged.push([r[0], r[1]]);
    }
    for (const s of _railSplitBySkipRanges(cur.x, cur.z, next.x, next.z, merged)) segs.push(s);
  }
  return segs;
}

// Цвет деревянных колонн (mod_porch_column fallback) — им же красим перила/балясины,
// чтобы ограждение визуально совпадало с колоннами навеса.
const PORCH_COLUMN_COLOR = 0x6e4a2a; // дерево — коричневый (перила/колонны/балясины)
// Inset перил и колонн внутрь от кромки настила (чтобы не свисали за край).
const RAIL_INSET = 0.10;
// Inset перил лестницы от боковой грани ступеней (latOff в buildSteps3d). Тем же
// значением сужается проём перил террасы под лестницу — конец перил террасы и колонна
// навеса на углу проёма встают соосно с перилами лестницы.
const STAIR_RAIL_INSET = 0.12;

// Единый контур ОБЪЕДИНЕНИЯ террасных блоков (axis-aligned rect'ы) → массив орто-полигонов
// (петель) в мире. Так перила/балясины строятся по внешнему периметру всей террасы без
// разрывов на стыках блоков (раньше каждый блок строился отдельно → дырки на границах).
// Метод: сетка по координатам граней rect-ов → занятые ячейки → граничные рёбра (интерьер
// слева) → трассировка в петли → схлопывание коллинеарных вершин.
function _terraceUnionLoops(rects) {
  if (!rects || !rects.length) return [];
  const xs = [...new Set(rects.flatMap(r => [r.minX, r.maxX]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap(r => [r.minZ, r.maxZ]))].sort((a, b) => a - b);
  const filled = (i, j) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return rects.some(r => cx > r.minX && cx < r.maxX && cz > r.minZ && cz < r.maxZ);
  };
  const P = (i, j) => xs[i] + ',' + zs[j];
  const pt = (i, j) => ({ x: xs[i], z: zs[j] });
  const edges = new Map();   // ключ start "x,z" → {to:[i,j], from:[i,j]}
  const addEdge = (ai, aj, bi, bj) => edges.set(P(ai, aj), { a: [ai, aj], b: [bi, bj] });
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (!filled(i, j)) continue;
    if (j === 0 || !filled(i, j - 1)) addEdge(i, j, i + 1, j);             // низ: +x
    if (j === zs.length - 2 || !filled(i, j + 1)) addEdge(i + 1, j + 1, i, j + 1); // верх: -x
    if (i === 0 || !filled(i - 1, j)) addEdge(i, j + 1, i, j);             // лево: -z
    if (i === xs.length - 2 || !filled(i + 1, j)) addEdge(i + 1, j, i + 1, j + 1); // право: +z
  }
  const loops = [];
  while (edges.size) {
    const startKey = edges.keys().next().value;
    let e = edges.get(startKey);
    const loop = [];
    while (e) {
      edges.delete(P(e.a[0], e.a[1]));
      loop.push(pt(e.a[0], e.a[1]));
      e = edges.get(P(e.b[0], e.b[1]));
      if (e && loop.length && pt(e.a[0], e.a[1]).x === loop[0].x && pt(e.a[0], e.a[1]).z === loop[0].z) break;
    }
    // схлопнуть коллинеарные точки (оставляем только вершины-углы)
    const clean = [];
    for (let k = 0; k < loop.length; k++) {
      const p0 = loop[(k - 1 + loop.length) % loop.length], p1 = loop[k], p2 = loop[(k + 1) % loop.length];
      const cross = (p1.x - p0.x) * (p2.z - p1.z) - (p1.z - p0.z) * (p2.x - p1.x);
      if (Math.abs(cross) > 1e-9) clean.push(p1);   // поворот — это угол
    }
    loops.push(clean.length >= 3 ? clean : loop);
  }
  return loops;
}

// Инсет орто-полигона внутрь на d (к геометрическому интерьеру; работает для L/П-форм).
function _insetOrthoPolygon(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.x * b.z - b.x * a.z; }
  const ccw = area > 0;
  const inwardN = (ax, az, bx, bz) => {
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    return ccw ? { nx: -dz, nz: dx } : { nx: dz, nz: -dx };   // интерьер слева (CCW)
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const n1 = inwardN(prev.x, prev.z, cur.x, cur.z);
    const n2 = inwardN(cur.x, cur.z, next.x, next.z);
    out.push({ x: cur.x + (n1.nx + n2.nx) * d, z: cur.z + (n1.nz + n2.nz) * d });
  }
  return out;
}

// Ограждение террасы из GLB-секций (mod_railing): по ЕДИНОМУ контуру террасы столбы (post)
// секциями фикс. ширины (~1 м, одинаковы везде) + узкий добор; перила (rails) тянутся масштабом,
// балясины (нативное сечение, число по шагу ~0.1 м) — в каждой секции.
// worldOutline — орто-полигон периметра всей террасы (не инсетнутый).
// segsOverride — готовые сегменты {ax,az,bx,bz}: так строится ограждение по
// НАРИСОВАННОЙ ломаной (раздел «Ограждения»). Без него сегменты считаются по
// контуру террасы, как раньше (инсет + пропуски у стен дома и лестницы).
// matOverride — материал выбранного товара ограждения (S.elementMat.railing через
// _resolveDeckMat). Без него — прежний цвет колонн крыльца.
function buildRailing3d(parent, worldOutline, deckHeight, houseL, houseW, segsOverride, matOverride){
  if (!_railingCache || !_railingCache.rails || !_railingCache.post) return;  // GLB ещё не загружен
  if (!segsOverride && (!worldOutline || worldOutline.length < 3)) return;
  const up = new THREE.Vector3(0, 1, 0);
  const railMat = matOverride
    ? matOverride.clone()
    : new THREE.MeshStandardMaterial({ color: PORCH_COLUMN_COLOR, roughness: 0.72, metalness: 0.04 });
  railMat.name = 'mat_railing';

  const segs = segsOverride
    || terracePerimeterSegments(_insetOrthoPolygon(worldOutline, RAIL_INSET), houseL, houseW, []);

  function placeGeo(geo, m4) {
    const g = geo.clone(); g.applyMatrix4(m4);
    const mesh = new THREE.Mesh(g, railMat);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); threeState.railingMeshes.push(mesh);
  }
  // Масштаб модуля по высоте: родная высота столба → RAIL_POST_H (1 м). Секции по
  // осям столбов — RAIL_SECTION_W (1.5 м). Профиль столбов/балясин в плане не меняется.
  const ky = _railingCache.ky || 1;
  // Базис модуля: local +X → вдоль сегмента, +Y → вверх, +Z → поперёк; старт в (px,pz) на настиле.
  function mat(px, pz, ux, uz, sx) {
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(ux, 0, uz), up, new THREE.Vector3(-uz, 0, ux));
    m.setPosition(px, deckHeight, pz);
    if (sx !== 1 || ky !== 1) m.multiply(new THREE.Matrix4().makeScale(sx, ky, 1));
    return m;
  }

  // Ставит столб с дедупом по общему реестру (стыки rect-ов): если рядом уже есть
  // столб — не дублируем. Высоких столбов-опор больше нет: навес над террасой убран
  // (TODO.md, этап 1 п.5), все столбы ограждения одной высоты.
  function placePostAt(px, pz, ux, uz) {
    if (_railPostReg) {
      for (const e of _railPostReg) {
        if (Math.hypot(e.x - px, e.z - pz) < RAIL_POST_MERGE) return;   // точка уже покрыта
      }
    }
    placeGeo(_railingCache.post, mat(px, pz, ux, uz, 1));
    if (_railPostReg) _railPostReg.push({ x: px, z: pz });
  }

  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 0.20) continue;
    const ux = dx / L, uz = dz / L;
    // Секции фиксированной ширины ~1 м (одинаковы на всех сегментах) + один узкий «добор»
    // в конце, если длина не делится на W нацело. Концы — точно на углах.
    const W = RAIL_SECTION_W;
    const nFull = Math.max(1, Math.floor(L / W + 1e-6));
    const rem = L - nFull * W;
    const pos = [];
    for (let i = 0; i <= nFull; i++) pos.push(i * W);
    if (rem > 0.15) pos.push(L);                           // узкая добор-секция
    else pos[pos.length - 1] = L;                          // мелкий остаток — растворяем в последней
    for (let i = 0; i < pos.length; i++) {
      placePostAt(s.ax + ux * pos[i], s.az + uz * pos[i], ux, uz);
    }
    for (let k = 0; k < pos.length - 1; k++) {
      const t0 = pos[k], gap = pos[k + 1] - pos[k];
      if (gap < 0.15) continue;
      // Перила (верх/низ) тянем по длине секции.
      placeGeo(_railingCache.rails, mat(s.ax + ux * t0, s.az + uz * t0, ux, uz, gap));
      // Балясины: НЕ тянем — ставим нативного сечения, число подгоняем по шагу ~0.1 м,
      // но НЕ БОЛЕЕ RAIL_BALU_MAX на секцию (9 штук ровно ложатся на узор «2/5/8 от пола»);
      // при упоре в лимит шаг просто увеличивается. Узор (0-base j%3===1) перезапускается
      // в каждом пролёте.
      const bg = _railingCache;
      if (bg.baluShort && bg.baluFloor) {
        const usable = gap - 2 * RAIL_BALU_INSET;
        const n = usable <= 0 ? 1
          : Math.min(RAIL_BALU_MAX, Math.max(1, Math.round(usable / RAIL_BALU_PITCH) + 1));
        for (let j = 0; j < n; j++) {
          const local = n === 1 ? gap / 2 : RAIL_BALU_INSET + usable * j / (n - 1);
          const t = t0 + local;
          const geo = (j % 3 === 1) ? bg.baluFloor : bg.baluShort;
          placeGeo(geo, mat(s.ax + ux * t, s.az + uz * t, ux, uz, 1));
        }
      }
    }
  }
}

// Ограждение по ломаной, нарисованной пользователем (раздел «Ограждения»):
// логика та же, что у забора, но в пределах террасы. Ни инсета, ни пропусков у
// стен и лестницы здесь нет — где ставить перила, решает пользователь.
function buildRailingLine3d(parent, pts, deckHeight, houseL, houseW, mat) {
  const segments = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts.filter(p => !p.break)];
  _railPostReg = [];                      // общий реестр столбов: дедуп на стыках линий
  for (const seg of segments) {
    if (!seg || seg.length < 2) continue;
    const w = canvasToWorld(seg, houseL, houseW);
    const segs = [];
    for (let i = 0; i < w.length - 1; i++) {
      const a = w[i], b = w[i + 1];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.05) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
    if (!segs.length) continue;
    try {
      buildRailing3d(parent, null, deckHeight, houseL, houseW, segs, mat);
    } catch (e) { console.error('[buildRailingLine3d]', e); }
  }
  _railPostReg = null;
}
