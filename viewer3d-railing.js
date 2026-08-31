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
  if (!S.sections.includes('steps')) return edges;
  // Проём в ограждении нужен под КАЖДУЮ лестницу (правка 2026-08-30).
  for (const st of (typeof stepsAll === 'function' ? stepsAll() : [S.steps])) {
    if (!st) continue;
    const sc = canvasToWorld([
      { x: st.x,        y: st.y },
      { x: st.x + st.w, y: st.y },
      { x: st.x + st.w, y: st.y + st.h },
      { x: st.x,        y: st.y + st.h },
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
// UV ограждения берутся ИЗ GLB — так решено продуктом (правка 2026-08-30): развёртка
// делается в самой модели, код её не пересчитывает. Прежняя осевая проекция
// (_applyAxisUV) для столбов, крышек, балясин и перил отменена.
// Inset перил лестницы от боковой грани ступеней (latOff в buildSteps3d). Тем же
// значением сужается проём перил террасы под лестницу — конец перил террасы встаёт
// соосно с перилами лестницы.
// Значение РАВНО RAIL_INSET: у ограждения террасы ось столбов отстоит от кромки настила
// на RAIL_INSET, и разные отступы (0.12 против 0.10) читались как уступ на стыке
// перил лестницы с ограждением, особенно когда лестница стоит у самого угла
// (правка 2026-08-30).
const STAIR_RAIL_INSET = RAIL_INSET;

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
  // Ключ старта → СПИСОК рёбер. Список, а не одно ребро: там, где два блока касаются
  // УГЛОМ, из одной точки выходят два граничных ребра, и при хранении по одному
  // второе затиралось — контур второй террасы обрывался, и ограждение на ней не
  // строилось вовсе (баг с рендера 2026-08-30).
  const edges = new Map();
  const addEdge = (ai, aj, bi, bj) => {
    const k = P(ai, aj);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ a: [ai, aj], b: [bi, bj] });
  };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (!filled(i, j)) continue;
    if (j === 0 || !filled(i, j - 1)) addEdge(i, j, i + 1, j);             // низ: +x
    if (j === zs.length - 2 || !filled(i, j + 1)) addEdge(i + 1, j + 1, i, j + 1); // верх: -x
    if (i === 0 || !filled(i - 1, j)) addEdge(i, j + 1, i, j);             // лево: -z
    if (i === xs.length - 2 || !filled(i + 1, j)) addEdge(i + 1, j, i + 1, j + 1); // право: +z
  }
  // Достаёт ребро, выходящее из точки k. Когда кандидатов несколько (точка касания
  // двух блоков), берём тот, что поворачивает МАКСИМАЛЬНО ВЛЕВО относительно
  // направления входа: интерьер у нас слева, и такой обход замыкает контур своей
  // террасы, а не сшивает обе в одну «восьмёрку» через общую точку.
  const takeEdge = (k, din) => {
    const list = edges.get(k);
    if (!list || !list.length) return null;
    let bi = 0;
    if (list.length > 1 && din) {
      let bestAng = -Infinity;
      for (let n = 0; n < list.length; n++) {
        const c = list[n];
        const cx = c.b[0] - c.a[0], cz = c.b[1] - c.a[1];
        // Угол поворота от входящего направления к кандидату: >0 — влево, <0 — вправо.
        const ang = Math.atan2(cz * din.x - cx * din.z, cx * din.x + cz * din.z);
        if (ang > bestAng) { bestAng = ang; bi = n; }
      }
    }
    const e = list.splice(bi, 1)[0];
    if (!list.length) edges.delete(k);
    return e;
  };
  const loops = [];
  while (edges.size) {
    const startKey = edges.keys().next().value;
    let e = takeEdge(startKey, null);
    const loop = [];
    while (e) {
      loop.push(pt(e.a[0], e.a[1]));
      const din = { x: e.b[0] - e.a[0], z: e.b[1] - e.a[1] };
      const nextKey = P(e.b[0], e.b[1]);
      // Вернулись в начало петли — замкнулись.
      if (loop.length > 1 && pt(e.b[0], e.b[1]).x === loop[0].x && pt(e.b[0], e.b[1]).z === loop[0].z) break;
      e = takeEdge(nextKey, din);
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

  // Крышка столба красится по СВОЕМУ правилу (дпк/металл/пластик), остальное —
  // материалом ограждения. Тип берётся из товара (свойство, имя GLB или название).
  const capType = (typeof railingCapType === 'function') ? railingCapType() : '';
  const capMat = (typeof _railCapMaterial === 'function')
    ? _railCapMaterial(railMat, capType) : railMat;

  // UV не трогаем — они приходят из GLB вместе с геометрией.
  function placeGeo(geo, m4, matOv) {
    const g = geo.clone(); g.applyMatrix4(m4);
    const mesh = new THREE.Mesh(g, matOv || railMat);
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
  // Сечение столба — свойство ВЫБРАННОГО ТОВАРА (S.railPostW, мм). Фильтр раздела
  // сюда не вмешивается: он отбирает каталог (TODO п.1). Родное сечение модуля
  // 100 мм, поэтому 125 мм = масштаб 1.25 В ПЛАНЕ (по X и Z), высота не меняется.
  const postK = (typeof S !== 'undefined' && S.railPostW) ? S.railPostW / 100 : 1;
  function placePostAt(px, pz, ux, uz) {
    if (_railPostReg) {
      for (const e of _railPostReg) {
        if (Math.hypot(e.x - px, e.z - pz) < RAIL_POST_MERGE) return;   // точка уже покрыта
      }
    }
    const m = mat(px, pz, ux, uz, 1);
    if (postK !== 1) m.multiply(new THREE.Matrix4().makeScale(postK, 1, postK));
    placeGeo(_railingCache.post, m);
    // Крышка сидит на столбе — та же матрица (в том числе сечение 100/125 мм).
    if (_railingCache.cap) placeGeo(_railingCache.cap, m, capMat);
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

// ══════════════════════════════════════════════
// АВТОМАТИЧЕСКОЕ ОГРАЖДЕНИЕ ТЕРРАСЫ (TODO.md, этап 2 п.4)
// Точки руками больше не ставятся: ограждение идёт по СВОБОДНОМУ периметру террасы —
// union-контур блоков, инсет RAIL_INSET, без участков у стен дома и без проёма под
// лестницу (то и другое уже умеет terracePerimeterSegments). Плюс «вход» — разрыв,
// заданный двумя точками, которые пользователь двигает по периметру.
// ══════════════════════════════════════════════

// Мировые bbox блоков террасы.
function _railTerraceRectsWorld(houseL, houseW) {
  const rects = (typeof secRects === 'function') ? secRects('terrace') : [];
  const out = [];
  for (const r of rects) {
    if (!r || r.w <= 0 || r.h <= 0) continue;
    const w = canvasToWorld([
      { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h },
    ], houseL, houseW);
    out.push({
      minX: Math.min(w[0].x, w[1].x), maxX: Math.max(w[0].x, w[1].x),
      minZ: Math.min(w[0].z, w[1].z), maxZ: Math.max(w[0].z, w[1].z),
    });
  }
  return out;
}

// Петли периметра ограждения (инсетнутые), мир. Первая — самая длинная: по ней
// отсчитывается положение «входа».
function railingLoopsWorld(houseL, houseW) {
  const rects = _railTerraceRectsWorld(houseL, houseW);
  if (!rects.length || typeof _terraceUnionLoops !== 'function') return [];
  const loops = _terraceUnionLoops(rects)
    .map(l => _insetOrthoPolygon(l, RAIL_INSET))
    .filter(l => l && l.length >= 3);
  const len = loop => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      s += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return s;
  };
  return loops.sort((a, b) => len(b) - len(a));
}

// Параметризация петли: накопленные длины вершин + полная длина.
function railingLoopPath(loop) {
  const cum = [0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { loop, cum, L: cum[cum.length - 1] };
}

// Точка на петле по параметру t ∈ [0,1).
function railingPointAt(path, t) {
  const { loop, cum, L } = path;
  if (!L) return { x: loop[0].x, z: loop[0].z };
  let d = ((t % 1) + 1) % 1 * L;
  for (let i = 0; i < loop.length; i++) {
    if (d <= cum[i + 1] || i === loop.length - 1) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const segLen = cum[i + 1] - cum[i];
      const k = segLen > 1e-9 ? (d - cum[i]) / segLen : 0;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
  }
  return { x: loop[0].x, z: loop[0].z };
}

// Параметр ближайшей к точке позиции на петле.
function railingParamOf(path, p) {
  const { loop, cum, L } = path;
  if (!L) return 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    if (l2 < 1e-9) continue;
    let k = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
    k = Math.max(0, Math.min(1, k));
    const qx = a.x + dx * k, qz = a.z + dz * k;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (d < bestD) { bestD = d; best = (cum[i] + Math.hypot(qx - a.x, qz - a.z)) / L; }
  }
  return best;
}

// Вычитает из отрезка [s0,s1] (в параметрах петли) циклический интервал входа.
function _railCutEntry(s0, s1, e0, e1) {
  if (e0 === null || e1 === null) return [[s0, s1]];
  // Интервал входа может проходить через 0 — разворачиваем в один или два куска.
  const cuts = (e0 <= e1) ? [[e0, e1]] : [[e0, 1], [0, e1]];
  let parts = [[s0, s1]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [a, b] of parts) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }   // не пересекается
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a > 1e-6);
}

// Вход (разрыв) петли li. Входов столько же, сколько независимых контуров террас:
// у каждой отдельно стоящей террасы свой разрыв (правка 2026-08-30). Раньше вход был
// один и работал только на самой длинной петле — вторая терраса оставалась глухой.
function railingEntryOf(li) {
  if (typeof S === 'undefined') return null;
  const list = S.railingEntries;
  return (Array.isArray(list) && list[li]) ? list[li] : null;
}

// Сегменты ограждения в МИРЕ: свободный периметр минус «вход» своей петли.
function railingAutoSegmentsWorld(houseL, houseW) {
  const loops = railingLoopsWorld(houseL, houseW);
  const out = [];
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li];
    const path = railingLoopPath(loop);
    const segs = terracePerimeterSegments(loop, houseL, houseW, []);
    const entry = railingEntryOf(li);
    const e0 = entry ? entry.t0 : null;
    const e1 = entry ? entry.t1 : null;
    for (const s of segs) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
      if (L < 0.05 || !path.L) continue;
      // Параметр середины точен: отрезок лежит на ребре петли.
      const tMid = railingParamOf(path, { x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2 });
      const half = L / path.L / 2;
      // Направление: параметр растёт вдоль обхода петли, поэтому концы могут
      // поменяться местами — восстанавливаем по фактическим точкам.
      const t0 = tMid - half, t1 = tMid + half;
      for (const [a, b] of _railCutEntry(t0, t1, e0, e1)) {
        const pa = railingPointAt(path, a), pb = railingPointAt(path, b);
        if (Math.hypot(pb.x - pa.x, pb.z - pa.z) < 0.05) continue;
        out.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z });
      }
    }
  }
  return out;
}

// Те же сегменты в координатах плана — ими живут S.pts.railing, смета и рисование.
// Формат прежний: точки подряд, между отрезками маркер {break:true}.
function railingAutoPoints(houseL, houseW) {
  const segs = railingAutoSegmentsWorld(houseL, houseW);
  const pts = [];
  for (const s of segs) {
    const c = worldToCanvas([{ x: s.ax, z: s.az }, { x: s.bx, z: s.bz }], houseL, houseW);
    if (pts.length) pts.push({ break: true });
    pts.push(c[0], c[1]);
  }
  return pts;
}

// Ширина «входа» по умолчанию (м) — потом двигается двумя точками.
const RAIL_ENTRY_W = 1.0;

// Петля периметра по индексу (по ней отсчитывается её вход) или null.
function railingLoopPathAt(li) {
  const lw = lastHouseSize();
  const loops = railingLoopsWorld(lw.L, lw.W);
  return loops[li] ? railingLoopPath(loops[li]) : null;
}

// Первая (самая длинная) петля — оставлена для вызовов, которым нужен один контур.
function railingMainPath(houseL, houseW) {
  const lw = (houseL === undefined) ? lastHouseSize() : { L: houseL, W: houseW };
  const loops = railingLoopsWorld(lw.L, lw.W);
  return loops.length ? railingLoopPath(loops[0]) : null;
}

// Входы по умолчанию — ПО ОДНОМУ НА КАЖДУЮ петлю: середина самого длинного свободного
// участка этой петли, ширина RAIL_ENTRY_W. Возвращает массив, выровненный по индексам
// петель (null там, где ставить вход некуда — слишком короткие участки).
function railingDefaultEntries(houseL, houseW) {
  const lw = (houseL === undefined) ? lastHouseSize() : { L: houseL, W: houseW };
  const loops = railingLoopsWorld(lw.L, lw.W);
  if (!loops.length) return [];
  const saved = S.railingEntries;
  S.railingEntries = [];                      // считаем участки БЕЗ старых входов
  const out = loops.map((loop, li) => {
    const path = railingLoopPath(loop);
    if (!path.L) return null;
    let best = null, bestL = 0;
    for (const s of terracePerimeterSegments(loop, lw.L, lw.W, [])) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
      if (L > bestL) { bestL = L; best = s; }
    }
    if (!best || bestL < 0.6) return null;
    const tMid = railingParamOf(path, { x: (best.ax + best.bx) / 2, z: (best.az + best.bz) / 2 });
    const half = Math.min(RAIL_ENTRY_W, bestL - 0.4) / 2 / path.L;
    return { t0: (tMid - half + 1) % 1, t1: (tMid + half + 1) % 1 };
  });
  S.railingEntries = saved;
  return out;
}

// Точки входов в координатах плана: массив [{ li, a, b }] — по одному входу на петлю.
// Раньше возвращалась одна пара точек (вход был единственным).
function railingEntryPointsNorm() {
  const list = (typeof S !== 'undefined' && Array.isArray(S.railingEntries)) ? S.railingEntries : [];
  if (!list.length) return [];
  const out = [];
  for (let li = 0; li < list.length; li++) {
    const e = list[li];
    if (!e) continue;
    const path = railingLoopPathAt(li);
    if (!path) continue;
    const a = railingPointAt(path, e.t0), b = railingPointAt(path, e.t1);
    const c = worldToCanvas([{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
    out.push({ li, a: c[0], b: c[1] });
  }
  return out;
}

// Перетаскивание точки входа: li — петля, idx 0/1 — конец, p — точка плана {x,y}.
function railingEntryDrag(li, idx, p) {
  const e = railingEntryOf(li);
  if (!e) return;
  const path = railingLoopPathAt(li);
  if (!path) return;
  const lw = lastHouseSize();
  const w = canvasToWorld([p], lw.L, lw.W)[0];
  const t = railingParamOf(path, w);
  if (idx === 0) e.t0 = t; else e.t1 = t;
}
