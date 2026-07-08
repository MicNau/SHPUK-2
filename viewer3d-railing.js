// ══════════════════════════════════════════════
// VIEWER3D-RAILING.JS — периметр террасы, ограждение, навесы
// Выделен из viewer3d-core.js:
//   • terracePerimeterSegments + skip-диапазоны (стены дома / проём ступеней /
//     стыки террасных блоков)
//   • union-контур террасных блоков (_terraceUnionLoops), орто-инсеты
//   • buildRailing3d — GLB-секции mod_railing, высокие столбы-опоры навеса
//   • навесы террасы (_terraceCanopyParams, _buildCanopySlab, buildTerraceCanopies)
// Общая глобальная область видимости с остальными viewer3d-* (см. шапку
// viewer3d-builders.js); подключается последним из трёх.
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// ПЕРИМЕТР ТЕРРАСЫ — общий расчёт для перил И опор навеса.
// Возвращает массив сегментов {ax,az,bx,bz} по внешнему контуру террасного rect,
// исключая участки: у стен дома (pad 0.30 м), у входа на ступени (pad 0.40 м),
// на стыках с другими террасными rect'ами. Перила рисуются по этим сегментам;
// колонны навеса ставятся по их концам — поэтому опоры всегда на углах перил.
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

// Возвращает прямоугольный полигон, сжатый внутрь на inset со всех сторон
// (порядок углов как у исходного rect). Для маленьких rect inset ограничен.
function _insetWorldRect(worldPts, inset) {
  const minX = Math.min(...worldPts.map(p => p.x)), maxX = Math.max(...worldPts.map(p => p.x));
  const minZ = Math.min(...worldPts.map(p => p.z)), maxZ = Math.max(...worldPts.map(p => p.z));
  const ix = Math.min(inset, (maxX - minX) / 2 - 0.05);
  const iz = Math.min(inset, (maxZ - minZ) / 2 - 0.05);
  return [
    { x: minX + ix, z: minZ + iz },
    { x: maxX - ix, z: minZ + iz },
    { x: maxX - ix, z: maxZ - iz },
    { x: minX + ix, z: maxZ - iz },
  ];
}

const CANOPY_COL_SPACING = 2.5;   // шаг промежуточных колонн навеса на длинных пролётах
const CANOPY_COL_HALF    = 0.07;  // половина сечения колонны (colT/2) — для обхода балясинами

// Точки колонн навеса для inset-периметра: концы сегментов перил (углы + края проёма
// под лестницу) + промежуточные на длинных пролётах, минус точки у стены дома.
// Общая для навеса (ставит колонны) и перил (обходит колонны балясинами).
function _terraceColumnPoints(insetPts, houseL, houseW, otherRects) {
  const segs = terracePerimeterSegments(insetPts, houseL, houseW, otherRects || []);
  const pts = [];
  const add = (x, z) => { if (!pts.some(p => Math.hypot(p.x - x, p.z - z) < 0.30)) pts.push({ x, z }); };
  for (const s of segs) {
    add(s.ax, s.az);
    add(s.bx, s.bz);
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len > CANOPY_COL_SPACING * 1.5) {
      const nMid = Math.floor(len / CANOPY_COL_SPACING);
      for (let j = 1; j < nMid; j++) {
        const t = j / nMid;
        add(s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t);
      }
    }
  }
  // Колонны у стены дома не нужны (навес примыкает к стене).
  const houseEdges = _railHouseEdges();
  const wallSkipDist = 0.55;
  return pts.filter(p => !houseEdges.some(([ax, az, bx, bz]) => {
    const dx = bx - ax, dz = bz - az, l2 = dx*dx + dz*dz; if (l2 < 1e-6) return false;
    let t = ((p.x - ax)*dx + (p.z - az)*dz) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (ax + t*dx), p.z - (az + t*dz)) < wallSkipDist;
  }));
}

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
// балясины (нативное сечение, число по шагу ~0.1 м) — в каждой секции. При навесе ВЫСОКИЕ столбы
// (до низа навеса) на углах сегмента и каждые ~2 м — они же опоры навеса. Высота высокого столба —
// из РЕАЛЬНОЙ плиты навеса рейкастом (`canopyUndersideY`), а не аналитики: на стыках блоков плита
// обрезана по диагонали, аналитика (max по bbox) промахивалась и столб протыкал навес.
// worldOutline — орто-полигон периметра всей террасы (не инсетнутый); canopyUndersideY(x,z)->Y|null.
function buildRailing3d(parent, worldOutline, deckHeight, houseL, houseW, canopyUndersideY){
  if (!_railingCache || !_railingCache.rails || !_railingCache.post) return;  // GLB ещё не загружен
  if (!worldOutline || worldOutline.length < 3) return;
  const up = new THREE.Vector3(0, 1, 0);
  const railMat = new THREE.MeshStandardMaterial({ color: PORCH_COLUMN_COLOR, roughness: 0.72, metalness: 0.04 });
  railMat.name = 'mat_railing';

  const insetPts = _insetOrthoPolygon(worldOutline, RAIL_INSET);
  const segs = terracePerimeterSegments(insetPts, houseL, houseW, []);
  const canopyOn = !!canopyUndersideY;

  function placeGeo(geo, m4) {
    const g = geo.clone(); g.applyMatrix4(m4);
    const mesh = new THREE.Mesh(g, railMat);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); threeState.railingMeshes.push(mesh);
  }
  // Базис модуля: local +X → вдоль сегмента, +Y → вверх, +Z → поперёк; старт в (px,pz) на настиле.
  function mat(px, pz, ux, uz, sx) {
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(ux, 0, uz), up, new THREE.Vector3(-uz, 0, ux));
    m.setPosition(px, deckHeight, pz);
    if (sx !== 1) m.multiply(new THREE.Matrix4().makeScale(sx, 1, 1));
    return m;
  }

  // Высокий столб-опора до низа навеса (box). Высоту берём по РЕАЛЬНОЙ плите навеса над точкой
  // (рейкаст), сэмплируя чуть внутрь по нормали сегмента (nx,nz) — иначе на кромке луч скользит
  // мимо края плиты. Нет навеса над точкой → null (ставится обычный столб, без протыкания).
  function makeTallPost(px, pz, nx, nz) {
    if (!canopyUndersideY) return null;
    let yU = canopyUndersideY(px + nx * 0.25, pz + nz * 0.25);
    if (yU === null) yU = canopyUndersideY(px, pz);
    if (yU === null) return null;
    const h = yU - deckHeight;
    if (!isFinite(h) || h <= 1.2) return null;
    const colT = 0.10;
    const b = new THREE.Mesh(new THREE.BoxGeometry(colT, h, colT), railMat);
    b.position.set(px, deckHeight + h / 2, pz);
    b.castShadow = b.receiveShadow = true;
    parent.add(b); threeState.railingMeshes.push(b);
    return b;
  }
  function removeMesh(m) {
    if (!m) return;
    if (m.parent) m.parent.remove(m);
    const a = threeState.railingMeshes, k = a.indexOf(m); if (k >= 0) a.splice(k, 1);
    if (m.geometry) m.geometry.dispose();
  }
  // Ставит столб с дедупом по общему реестру (стыки rect-ов): если рядом уже есть столб —
  // не дублируем; короткий апгрейдим до высокого, если новый должен быть высоким.
  function placePostAt(px, pz, wantTall, ux, uz, nx, nz) {
    if (_railPostReg) {
      for (const e of _railPostReg) {
        if (Math.hypot(e.x - px, e.z - pz) < RAIL_POST_MERGE) {
          if (!e.tall && wantTall) {            // апгрейд короткого до высокого
            const t = makeTallPost(px, pz, nx, nz);
            if (t) { removeMesh(e.mesh); e.mesh = t; e.tall = true; }
          }
          return;                               // существующий столб покрывает точку
        }
      }
    }
    let mesh = wantTall ? makeTallPost(px, pz, nx, nz) : null;
    const tall = !!mesh;
    if (!mesh) { placeGeo(_railingCache.post, mat(px, pz, ux, uz, 1)); mesh = threeState.railingMeshes[threeState.railingMeshes.length - 1]; }
    if (_railPostReg) _railPostReg.push({ x: px, z: pz, tall, mesh });
  }

  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 0.20) continue;
    const ux = dx / L, uz = dz / L;
    // Секции фиксированной ширины ~1 м (одинаковы на всех сегментах) + один узкий «добор»
    // в конце (с коротким столбом), если длина не делится на W нацело. Концы — точно на углах.
    const W = RAIL_SECTION_W;
    const nFull = Math.max(1, Math.floor(L / W + 1e-6));
    const rem = L - nFull * W;
    const pos = [];
    for (let i = 0; i <= nFull; i++) pos.push(i * W);
    let hasLeftover = false;
    if (rem > 0.15) { pos.push(L); hasLeftover = true; }   // узкая добор-секция
    else pos[pos.length - 1] = L;                          // мелкий остаток — растворяем в последней
    const lastIdx = pos.length - 1;
    // Высокие столбы (при навесе): на углах + каждые 2 м ПО РАССТОЯНИЮ (чётные метры).
    // Узкий добор не делаем высоким — его внутренний столб короткий (по просьбе: можно узкую секцию).
    const isTall = i => {
      if (!canopyOn) return false;
      if (i === 0 || i === lastIdx) return true;            // углы сегмента
      if (hasLeftover && i === lastIdx - 1) return false;   // вход в узкий добор — короткий
      const k = Math.round(pos[i] / W);
      return Math.abs(pos[i] - k * W) < 0.05 && k % 2 === 0;
    };

    const nx = -uz, nz = ux;   // внутренняя нормаль сегмента (для сэмпла навеса чуть внутрь)
    for (let i = 0; i < pos.length; i++) {
      placePostAt(s.ax + ux * pos[i], s.az + uz * pos[i], isTall(i), ux, uz, nx, nz);
    }
    for (let k = 0; k < pos.length - 1; k++) {
      const t0 = pos[k], gap = pos[k + 1] - pos[k];
      if (gap < 0.15) continue;
      // Перила (верх/низ) тянем по длине секции.
      placeGeo(_railingCache.rails, mat(s.ax + ux * t0, s.az + uz * t0, ux, uz, gap));
      // Балясины: НЕ тянем — ставим нативного сечения, число подгоняем по шагу ~0.1 м,
      // узор «2/5/8 от пола» (0-base j%3===1) перезапускается в каждом пролёте.
      const bg = _railingCache;
      if (bg.baluShort && bg.baluFloor) {
        const usable = gap - 2 * RAIL_BALU_INSET;
        const n = usable <= 0 ? 1 : Math.max(1, Math.round(usable / RAIL_BALU_PITCH) + 1);
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

// Навес над террасой — вальмовая (hip) крыша над bbox полигона + колонны
// по периметру (на углах и с шагом ~2.5 м по длинным рёбрам).
// Высота согласована с навесом крыльца: низ на 2.30 м над настилом, ридж на 2.60 м.
// Параметры одностороннего навеса одного rect: bbox, ось/сторона ridge и план-высота
// низа плиты planeH(x,z) (canopyHigh у стены-ridge → canopyLow у дальней кромки-eave).
function _terraceCanopyParams(worldPts, houseL, houseW) {
  const CANOPY_LOW = 2.30, CANOPY_HIGH = 2.60;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of worldPts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const W = maxX - minX, D = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // Опорная стена дома → ось ridge + сторона (ребро дома, ближайшее к центру bbox).
  const housePoly = (_housePoly && _housePoly.corners) ? _housePoly.corners : null;
  let ridgeAlongX, ridgeAtMaxZ = false, ridgeAtMaxX = false;
  if (housePoly && housePoly.length >= 2) {
    let bestDist = Infinity, bestPz = cz, bestPx = cx, bestDx = 0, bestDz = 0;
    for (let i = 0; i < housePoly.length; i++) {
      const a = housePoly[i], b = housePoly[(i+1) % housePoly.length];
      const dx = b.x - a.x, dz = b.z - a.z, lenSq = dx*dx + dz*dz;
      if (lenSq < 1e-6) continue;
      let t = ((cx - a.x)*dx + (cz - a.z)*dz) / lenSq; t = Math.max(0, Math.min(1, t));
      const px = a.x + t*dx, pz = a.z + t*dz, dist = Math.hypot(cx - px, cz - pz);
      if (dist < bestDist) { bestDist = dist; bestPx = px; bestPz = pz; bestDx = dx; bestDz = dz; }
    }
    ridgeAlongX = Math.abs(bestDx) >= Math.abs(bestDz);
    if (ridgeAlongX) ridgeAtMaxZ = (bestPz > cz); else ridgeAtMaxX = (bestPx > cx);
  } else {
    ridgeAlongX = (W >= D);   // fallback без дома
  }
  const dHL = CANOPY_HIGH - CANOPY_LOW;
  const planeH = (x, z) => {
    if (ridgeAlongX) {
      const zr = ridgeAtMaxZ ? maxZ : minZ;
      return CANOPY_HIGH - dHL * (D > 1e-6 ? Math.abs(z - zr) / D : 0);
    }
    const xr = ridgeAtMaxX ? maxX : minX;
    return CANOPY_HIGH - dHL * (W > 1e-6 ? Math.abs(x - xr) / W : 0);
  };
  return { minX, maxX, minZ, maxZ, cx, cz, W, D, planeH, ridgeAlongX, ridgeAtMaxX, ridgeAtMaxZ };
}

// Обрезка выпуклого полигона foot (world {x,z}) полуплоскостью прямой через I→U,
// оставляя сторону, где лежит keep-точка. Sutherland–Hodgman по одной грани.
function _clipFootByDiagonal(foot, I, U, keep) {
  const ex = U.x - I.x, ez = U.z - I.z;
  const sideOf = (p) => ex * (p.z - I.z) - ez * (p.x - I.x);
  const refSign = sideOf(keep) >= 0 ? 1 : -1;
  const inside = (p) => sideOf(p) * refSign >= -1e-7;
  const out = [];
  for (let i = 0; i < foot.length; i++) {
    const a = foot[i], b = foot[(i + 1) % foot.length];
    const ina = inside(a), inb = inside(b);
    if (ina) out.push(a);
    if (ina !== inb) {
      const sa = sideOf(a) * refSign, sb = sideOf(b) * refSign;
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

// Плита навеса по выпуклому плановому полигону foot, высоты из params.planeH.
// Низ плиты = deckHeight + planeH, толщина canopyT вверх. Веер-триангуляция (выпуклый).
// Материал клонируем с DoubleSide — не зависим от winding обрезанного полигона.
function _buildCanopySlab(parent, foot, params, deckHeight, canopyT, matRoof) {
  if (foot.length < 3) return;
  const n = foot.length, pos = [], idx = [];
  for (const p of foot) pos.push(p.x, deckHeight + params.planeH(p.x, p.z) + canopyT, p.z); // top [0..n-1]
  for (const p of foot) pos.push(p.x, deckHeight + params.planeH(p.x, p.z),           p.z); // bottom [n..2n-1]
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);            // верх
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i);    // низ (обратный обход)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, n + i, j, j, n + i, n + j); } // боковины
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = matRoof.clone(); mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  threeState.canopyMeshes.push(m);
}

// Навесы составной (multi-rect) террасы. Каждый rect → односкатная плита, обрезанная
// по диагонали перекрытия с соседями: I — угол перекрытия, где оба ската высокие (у дома),
// U — противоположный «уличный» угол (с колонной). Оставляем сторону центра rect → шов
// идёт ровно по линии I→U («угловая колонна → угол дома»), плиты делят перекрытие без
// двойного покрытия. Колонны — глобально, с дедупликацией на стыках.
function buildTerraceCanopies(parent, M, rectPolys, deckHeight, houseL, houseW) {
  const canopyT = 0.06, colT = 0.14;
  const matRoof = M.roof || M.deck;
  const matPost = M.post || M.step;
  const rects = rectPolys.map(pp => {
    const wp = canvasToWorld(pp.filter(p => !p.break), houseL, houseW);
    return { wp, P: _terraceCanopyParams(wp, houseL, houseW) };
  }).filter(r => r.wp.length >= 3 && r.P.W > 0.3 && r.P.D > 0.3);

  // Плиты с вальмовым швом на стыках перпендикулярных «крыльев».
  // Работает и для перекрытия, и для стыка встык: для каждой пары перпендикулярных
  // rect строится угловая «коробка» (по оси своего ската — диапазон P, по оси ската
  // соседа — диапазон Q). I — угол у дома (оба конька), U — внешний угол (оба свеса,
  // там колонна). Bbox ската расширяется до коробки, затем режется по диагонали I→U
  // (оставляем сторону центра rect) → ровный шов «угловая колонна → угол дома».
  for (let i = 0; i < rects.length; i++) {
    const P = rects[i].P;
    let exMinX = P.minX, exMaxX = P.maxX, exMinZ = P.minZ, exMaxZ = P.maxZ;
    const clips = [];
    for (let j = 0; j < rects.length; j++) {
      if (j === i) continue;
      const Q = rects[j].P;
      if (P.ridgeAlongX === Q.ridgeAlongX) continue;   // нужны перпендикулярные скаты
      // Угловой стык: диапазоны по обеим осям должны соприкасаться/перекрываться.
      const xAdj = Math.min(P.maxX, Q.maxX) >= Math.max(P.minX, Q.minX) - 1e-6;
      const zAdj = Math.min(P.maxZ, Q.maxZ) >= Math.max(P.minZ, Q.minZ) - 1e-6;
      if (!xAdj || !zAdj) continue;
      let bxMin, bxMax, bzMin, bzMax, I, U;
      if (!P.ridgeAlongX) {            // P — уклон по X, Q — уклон по Z
        bxMin = P.minX; bxMax = P.maxX; bzMin = Q.minZ; bzMax = Q.maxZ;
        I = { x: P.ridgeAtMaxX ? P.maxX : P.minX, z: Q.ridgeAtMaxZ ? Q.maxZ : Q.minZ };
        U = { x: P.ridgeAtMaxX ? P.minX : P.maxX, z: Q.ridgeAtMaxZ ? Q.minZ : Q.maxZ };
      } else {                          // P — уклон по Z, Q — уклон по X
        bxMin = Q.minX; bxMax = Q.maxX; bzMin = P.minZ; bzMax = P.maxZ;
        I = { x: Q.ridgeAtMaxX ? Q.maxX : Q.minX, z: P.ridgeAtMaxZ ? P.maxZ : P.minZ };
        U = { x: Q.ridgeAtMaxX ? Q.minX : Q.maxX, z: P.ridgeAtMaxZ ? P.minZ : P.maxZ };
      }
      if (bxMax - bxMin < 0.15 || bzMax - bzMin < 0.15) continue;
      exMinX = Math.min(exMinX, bxMin); exMaxX = Math.max(exMaxX, bxMax);
      exMinZ = Math.min(exMinZ, bzMin); exMaxZ = Math.max(exMaxZ, bzMax);
      clips.push({ I, U });
    }
    let foot = [
      { x: exMinX, z: exMinZ }, { x: exMaxX, z: exMinZ },
      { x: exMaxX, z: exMaxZ }, { x: exMinX, z: exMaxZ },
    ];
    for (const c of clips) {
      foot = _clipFootByDiagonal(foot, c.I, c.U, { x: P.cx, z: P.cz });
      if (foot.length < 3) break;
    }
    rects[i].ext = { minX: exMinX, maxX: exMaxX, minZ: exMinZ, maxZ: exMaxZ };
    _buildCanopySlab(parent, foot, P, deckHeight, canopyT, matRoof);
  }

  // Колонны: точки опор всех rect, дедуп на стыках. Высота = низ навеса над точкой =
  // МИНИМУМ planeH по всем крыльям, что её накрывают (вальма — нижняя огибающая скатов).
  // Брать максимум нельзя: у шва соседнее крыло near-конёк высоко, но реально над колонной
  // — низкий скат другого крыла, и колонна пробивала бы навес.
  const canopyHeightAt = (x, z) => {
    let h = Infinity;
    for (const r of rects) {
      const e = r.ext || { minX: r.P.minX, maxX: r.P.maxX, minZ: r.P.minZ, maxZ: r.P.maxZ };
      if (x >= e.minX - 1e-3 && x <= e.maxX + 1e-3 && z >= e.minZ - 1e-3 && z <= e.maxZ + 1e-3) {
        h = Math.min(h, r.P.planeH(x, z));
      }
    }
    return h;
  };
  const colPts = [];
  for (let i = 0; i < rects.length; i++) {
    const insetPts = _insetWorldRect(rects[i].wp, RAIL_INSET);
    const otherRects = rects.filter((_, j) => j !== i).map(r => ({
      minX: r.P.minX, maxX: r.P.maxX, minZ: r.P.minZ, maxZ: r.P.maxZ,
    }));
    for (const c of _terraceColumnPoints(insetPts, houseL, houseW, otherRects)) {
      if (colPts.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 0.30)) continue;  // дедуп по позиции
      let h = canopyHeightAt(c.x, c.z);
      if (!isFinite(h)) h = rects[i].P.planeH(c.x, c.z);
      colPts.push({ x: c.x, z: c.z, h });
    }
  }
  // Если включено ограждение террасы — опоры навеса даёт само ограждение (высокие
  // столбы каждые ~2.5 м), отдельные колонны навеса не строим (иначе задвоение).
  const railingOn = tgOn('terrace-railing') && S.sections.includes('terrace');
  const useGlbCol = (typeof HouseBuilder !== 'undefined'
                     && HouseBuilder.placeScaledGlb
                     && _houseCache.modules
                     && _houseCache.modules.porch_column);
  if (!railingOn) for (const p of colPts) {
    if (useGlbCol) {
      HouseBuilder.placeScaledGlb(
        parent, _houseCache.modules, 'porch_column',
        colT, p.h, colT,
        p.x, deckHeight + p.h / 2, p.z,
        0, 'mat_porch_column', PORCH_COLUMN_COLOR
      );
    } else {
      const col = new THREE.Mesh(new THREE.BoxGeometry(colT, p.h, colT), matPost);
      col.position.set(p.x, deckHeight + p.h / 2, p.z);
      col.castShadow = col.receiveShadow = true;
      parent.add(col);
      threeState.canopyMeshes.push(col);
    }
  }
}

