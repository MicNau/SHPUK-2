// ══════════════════════════════════════════════
// VIEWER3D-BUILDERS.JS — строители конструкций участка
// Выделен из viewer3d-core.js (разрез монолита ~3.5 тыс. строк на 3 файла):
//   • процедурный дом-fallback (buildHouseMeshes)
//   • канвас→мир (canvasToWorld), настилы (_buildTerracePoly, buildTerrace3d),
//     подкладки (buildConstructionPad)
//   • грядки (GLB-плантер) и кэш GLB ограждения (ensureRailingLoaded)
//   • ступени (buildSteps3d), крыльцо (buildPorch3d)
//   • дорожки (buildPaths3d + рибоны/тримминг T-стыков), забор (buildFence3d)
// Все viewer3d-* — classic scripts с ОБЩЕЙ глобальной областью видимости.
// Порядок подключения: viewer3d-core.js → viewer3d-builders.js →
// viewer3d-railing.js (index.html). Кросс-файловые обращения происходят только
// на этапе вызова функций (runtime), не при загрузке.
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// HOUSE BUILDER
// ══════════════════════════════════════════════
function buildHouseMeshes(parent, M, length, width, wh, bh, wt) {
  const box  = (sx,sy,sz) => new THREE.BoxGeometry(sx,sy,sz);
  const mesh = (geo,mat)  => { const m=new THREE.Mesh(geo,mat); m.castShadow=m.receiveShadow=true; return m; };

  const bm = mesh(box(length+.2, bh, width+.2), M.base);
  bm.position.set(length/2, bh/2, width/2);
  parent.add(bm);
  _applyBoxUV(bm, UV_TILE);

  const WWIN=0.9, HWIN=1.2, YWIN=1.0, WDOOR=1.0, HDOOR=2.2;

  function xWallWithWins(len, wins, extZ) {
    const g      = new THREE.Group();
    const sorted = [...wins].sort((a,b)=>a.x-b.x);
    const botH   = sorted.length ? Math.min(...sorted.map(w=>w.y))     : wh;
    const topS   = sorted.length ? Math.max(...sorted.map(w=>w.y+w.h)) : wh;
    const addW   = (sx,sy,px,py) => { const m=mesh(box(sx,sy,wt),M.wall); m.position.set(px,py,wt/2); g.add(m); threeState.wallMeshes.push(m); };
    if (botH>.01)   addW(len,botH,   len/2,botH/2);
    if (wh-topS>.01)addW(len,wh-topS,len/2,topS+(wh-topS)/2);
    let prev=0;
    for (const w of sorted) {
      if (w.x-prev>.01) addW(w.x-prev,topS-botH,prev+(w.x-prev)/2,botH+(topS-botH)/2);
      const gm=new THREE.Mesh(box(w.w,w.h,wt*.3),M.glass); gm.position.set(w.x+w.w/2,w.y+w.h/2,wt/2); g.add(gm);
      const ft=.045, fd=wt+.06;
      // Рама снаружи (4 перекладины + 2 горбылька)
      [[w.w+ft*2,ft,fd,w.x+w.w/2,w.y+w.h+ft/2],[w.w+ft*2,ft,fd,w.x+w.w/2,w.y-ft/2],
       [ft,w.h,fd,w.x-ft/2,w.y+w.h/2],[ft,w.h,fd,w.x+w.w+ft/2,w.y+w.h/2],
       [w.w,ft*.7,fd*.7,w.x+w.w/2,w.y+w.h/2],[ft*.7,w.h,fd*.7,w.x+w.w/2,w.y+w.h/2]
      ].forEach(([sx,sy,sz,px,py])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,wt/2); g.add(m); });
      // Подоконник (exterior windowsill)
      { const sw=w.w+ft*4, sh=0.025, sd=0.07;
        const sillZ = extZ===0 ? -sd*0.35 : wt+sd*0.35;
        const m=new THREE.Mesh(box(sw,sh,sd),M.frame);
        m.position.set(w.x+w.w/2, w.y-ft/2-sh/2, sillZ); g.add(m); }
      prev=w.x+w.w;
    }
    if (len-prev>.01) addW(len-prev,topS-botH,prev+(len-prev)/2,botH+(topS-botH)/2);
    return g;
  }

  function zWallWithDoor(zLen, hasDoor, hasWins, extX) {
    const grp=new THREE.Group(), holes=[];
    if (hasDoor) holes.push({z:zLen/2-WDOOR/2,y:0,w:WDOOR,h:HDOOR,isDoor:true});
    if (hasWins) {
      const dz=zLen/2-WDOOR/2;
      const lc=(dz-.3)/2-WWIN/2; if(lc>=.1) holes.push({z:lc,y:YWIN,w:WWIN,h:HWIN});
      const rc=(dz+WDOOR+.3+zLen)/2-WWIN/2; if(rc+WWIN<=zLen-.1) holes.push({z:rc,y:YWIN,w:WWIN,h:HWIN});
    }
    if (!holes.length) { const m=mesh(box(wt,wh,zLen),M.wall); m.position.set(wt/2,wh/2,zLen/2); grp.add(m); threeState.wallMeshes.push(m); return grp; }
    const sorted=[...holes].sort((a,b)=>a.z-b.z);
    const topS=Math.max(...sorted.map(h=>h.y+h.h));
    if(wh-topS>.01){ const m=mesh(box(wt,wh-topS,zLen),M.wall); m.position.set(wt/2,topS+(wh-topS)/2,zLen/2); grp.add(m); threeState.wallMeshes.push(m); }
    let prev=0;
    for (const h of sorted) {
      if(h.z-prev>.01){ const m=mesh(box(wt,topS,h.z-prev),M.wall); m.position.set(wt/2,topS/2,prev+(h.z-prev)/2); grp.add(m); threeState.wallMeshes.push(m); }
      if(h.y>.01)     { const m=mesh(box(wt,h.y,h.w),M.wall);       m.position.set(wt/2,h.y/2,h.z+h.w/2);          grp.add(m); threeState.wallMeshes.push(m); }
      const fH=topS-(h.y+h.h);
      if(fH>.01)      { const m=mesh(box(wt,fH,h.w),M.wall);         m.position.set(wt/2,(h.y+h.h)+fH/2,h.z+h.w/2); grp.add(m); threeState.wallMeshes.push(m); }
      const fm=new THREE.Mesh(box(wt*.3,h.h,h.w),h.isDoor?M.door:M.glass); fm.position.set(wt/2,h.y+h.h/2,h.z+h.w/2); grp.add(fm);
      const ft=.04,fd=wt+.08;
      if(!h.isDoor){
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],[fd,ft,h.w+ft*2,wt/2,h.y-ft/2,h.z+h.w/2],
         [fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2],
         [fd*.8,ft*.7,h.w,wt/2,h.y+h.h/2,h.z+h.w/2],[fd*.8,h.h,ft*.7,wt/2,h.y+h.h/2,h.z+h.w/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); grp.add(m); });
        // Подоконник (exterior windowsill)
        { const sh=0.025, sd=0.07;
          const sillX = extX===0 ? -sd*0.35 : wt+sd*0.35;
          const m=new THREE.Mesh(box(sd,sh,h.w+ft*4),M.frame);
          m.position.set(sillX, h.y-ft/2-sh/2, h.z+h.w/2); grp.add(m); }
      } else {
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); grp.add(m); });
      }
      prev=h.z+h.w;
    }
    if(zLen-prev>.01){ const m=mesh(box(wt,topS,zLen-prev),M.wall); m.position.set(wt/2,topS/2,prev+(zLen-prev)/2); grp.add(m); threeState.wallMeshes.push(m); }
    return grp;
  }

  // Применяем box UV к стенам Z после их построения (zWallWithDoor)
  // addW уже применяет к стенам X; здесь обрабатываем остальные wallMeshes
  // grpOff — суммарное смещение родительских групп (накапливается при рекурсии)
  const _wallUVHelper = (grp, grpOff) => {
    const off = grpOff || { x: 0, y: 0, z: 0 };
    const thisOff = {
      x: off.x + grp.position.x,
      y: off.y + grp.position.y,
      z: off.z + grp.position.z,
    };
    grp.children.forEach(child => {
      if (child.isMesh && child.material === M.wall) {
        _applyBoxUV(child, UV_TILE, thisOff);
      }
      if (child.isGroup) _wallUVHelper(child, thisOff);
    });
  };

  const winCnt    = Math.max(0, Math.round(length/(WWIN*2.9)));
  const winIndent = winCnt>0 ? (length-winCnt*WWIN)/(winCnt+1) : length;
  const wins=[];
  for(let i=0;i<winCnt;i++) wins.push({x:winIndent+(WWIN+winIndent)*i,y:YWIN,w:WWIN,h:HWIN});

  const lw=xWallWithWins(length,wins,0); lw.position.set(0,bh,0);        parent.add(lw);
  const rw=xWallWithWins(length,wins,wt); rw.position.set(0,bh,width-wt); parent.add(rw);
  const zI=width-wt*2;
  const bk=zWallWithDoor(zI,false,true,0);  bk.position.set(0,bh,wt);         parent.add(bk);
  const fw=zWallWithDoor(zI,true,true,wt); fw.position.set(length-wt,bh,wt); parent.add(fw);
  // Применяем box UV к стенам Z (X-стены обработаны в addW)
  [lw,rw,bk,fw].forEach(grp => _wallUVHelper(grp));

  const rh=2.0,oh=.3, x0=-oh,x1=length+oh,z0=-oh,z1=width+oh,zMid=width/2;
  const yBase=bh+wh, yPeak=bh+wh+rh;
  // Длина ската: от карниза до конька
  const slatLen = Math.sqrt(Math.pow((width+oh*2)/2, 2) + Math.pow(rh, 2));
  // UV: U вдоль конька (делим на 2м), V поперёк ската (делим на 2м)
  const uL = (length+oh*2)/8, uR = (length+oh*2)/8; // длина / 8 для редкого тайлинга
  const vS = slatLen/8; // повторяем каждые 8м поперёк

  // Строим геометрию вручную с UV для двух скатов + фронтоны
  // Каждый треугольник: [pos0, uv0, pos1, uv1, pos2, uv2]
  const buildRoofGeo = (tris) => {
    const pos=[], uvArr=[];
    for (const [p0,u0,p1,u1,p2,u2] of tris) {
      pos.push(...p0,...p1,...p2);
      uvArr.push(...u0,...u1,...u2);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
    g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uvArr),2));
    g.computeVertexNormals();
    return g;
  };

  // Скат A (z0 → zMid, передний)
  // Скат B (z1 → zMid, задний)
  // U: вдоль X, V: вдоль ската
  const roofTris = [
    // Скат A: два треугольника
    [[x0,yBase,z0],[0,0],     [x1,yBase,z0],[uL,0],     [x1,yPeak,zMid],[uL,vS]],
    [[x0,yBase,z0],[0,0],     [x1,yPeak,zMid],[uL,vS],  [x0,yPeak,zMid],[0,vS]],
    // Скат B
    [[x0,yBase,z1],[0,0],     [x0,yPeak,zMid],[0,vS],   [x1,yPeak,zMid],[uR,vS]],
    [[x0,yBase,z1],[0,0],     [x1,yPeak,zMid],[uR,vS],  [x1,yBase,z1],[uR,0]],
    // Фронтон правый (xMax)
    [[x1,yBase,z0],[0,0],     [x1,yBase,z1],[width/2,0],[x1,yPeak,zMid],[width/4,vS]],
    // Фронтон левый (xMin)
    [[x0,yBase,z1],[0,0],     [x0,yBase,z0],[width/2,0],[x0,yPeak,zMid],[width/4,vS]],
  ];
  const roofGeo=buildRoofGeo(roofTris);
  const roofMesh=new THREE.Mesh(roofGeo,M.roof); roofMesh.castShadow=true;
  parent.add(roofMesh);
}

// ══════════════════════════════════════════════
// TERRACE / PIER / POOL BUILDER
// ══════════════════════════════════════════════
// Смещение bbox реального полигона дома в мире (для крестообразных, T-образных
// и пр. — у них bbox.minX/minZ != 0). Устанавливается в buildScene3d на основе
// дескриптора. Используется в canvasToWorld и buildPorch3d, чтобы канвас-точки
// (центрированные по bbox в сетке GRID×GRID) корректно ложились на дом в 3D-мире.
let _houseBboxMinX = 0;
let _houseBboxMinZ = 0;
// Кэш полигона этажа дома на ТЕКУЩУЮ сборку сцены. Ставится в начале buildScene3d
// (клампованная площадь — та же, с которой строится дом), null на пустом участке
// или пока дескриптор не загружен. Билдеры читают его вместо повторных
// HouseBuilder.getHouseFloorPolygon(...) с параметрами из DOM.
let _housePoly = null;

// Габариты дома последней сборки — нужны обратному преобразованию worldToCanvas
// (редактор ограждения рисует в координатах плана то, что посчитано в мире).
let _lastHouseL = 0, _lastHouseW = 0;

function canvasToWorld(pts, houseL, houseW) {
  const gridSize=GRID, offsetX=(gridSize-houseL)/2, offsetZ=(gridSize-houseW)/2;
  _lastHouseL = houseL; _lastHouseW = houseW;
  return pts.map(p=>({ x:p.x*gridSize-offsetX+_houseBboxMinX, z:p.y*gridSize-offsetZ+_houseBboxMinZ }));
}

// Габариты дома последней сборки — редактору плана они нужны, чтобы считать
// геометрию ограждения в мире теми же значениями, что и 3D.
function lastHouseSize() { return { L: _lastHouseL, W: _lastHouseW }; }

// Обратное преобразование: мир → нормированные координаты плана. Габариты дома по
// умолчанию берутся из последнего canvasToWorld — плану они неизвестны.
function worldToCanvas(pts, houseL, houseW) {
  const gridSize = GRID;
  const L = (houseL !== undefined) ? houseL : _lastHouseL;
  const W = (houseW !== undefined) ? houseW : _lastHouseW;
  const offsetX = (gridSize - L) / 2, offsetZ = (gridSize - W) / 2;
  return pts.map(p => ({
    x: (p.x + offsetX - _houseBboxMinX) / gridSize,
    y: (p.z + offsetZ - _houseBboxMinZ) / gridSize,
  }));
}

// Преобразует прямоугольники секции (по умолчанию терраса/крыльцо) в массив
// 4-точечных полигонов (canvas-нормированные).
// CCW winding (как ожидает scanline в buildTerrace3d / buildRailing3d).
function _terraceRectsToPolygons(secId) {
  const rects = (typeof secRects === 'function') ? secRects(secId || 'terrace') : [];
  const polys = [];
  for (const r of rects) {
    if (!r || r.w <= 0 || r.h <= 0) continue;
    polys.push([
      { x: r.x,         y: r.y         },
      { x: r.x + r.w,   y: r.y         },
      { x: r.x + r.w,   y: r.y + r.h   },
      { x: r.x,         y: r.y + r.h   },
    ]);
  }
  return polys;
}

// ── БАССЕЙН (TODO.md, этап 2 п.14) ───────────────────────────────────────────
// Полигон бассейна в МИРЕ: прямоугольник как есть, круглый — 32-угольником.
const POOL_SEGMENTS = 32;
function poolPolygonWorld(houseL, houseW) {
  const p = (typeof S !== 'undefined') ? S.pool : null;
  if (!p || !(p.w > 0) || !(p.h > 0)) return null;
  if (p.kind === 'round') {
    const c = canvasToWorld([{ x: p.x + p.w / 2, y: p.y + p.h / 2 }], houseL, houseW)[0];
    const r = p.w / 2 * GRID;
    const out = [];
    for (let i = 0; i < POOL_SEGMENTS; i++) {
      const a = i / POOL_SEGMENTS * Math.PI * 2;
      out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
    }
    return out;
  }
  const c = canvasToWorld([
    { x: p.x, y: p.y }, { x: p.x + p.w, y: p.y },
    { x: p.x + p.w, y: p.y + p.h }, { x: p.x, y: p.y + p.h },
  ], houseL, houseW);
  return c.map(q => ({ x: q.x, z: q.z }));
}

// Обрезка выпуклого полигона прямоугольником (Сазерленд–Ходжман). Нужна, когда
// бассейн выходит за край блока: вырезаем только пересечение.
function clipPolyToRect(poly, minX, maxX, minZ, maxZ) {
  const clip = (pts, inside, isect) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(isect(a, b));
    }
    return out;
  };
  const lerpX = (a, b, x) => ({ x, z: a.z + (b.z - a.z) * ((x - a.x) / (b.x - a.x || 1e-9)) });
  const lerpZ = (a, b, z) => ({ x: a.x + (b.x - a.x) * ((z - a.z) / (b.z - a.z || 1e-9)), z });
  let p = poly.slice();
  p = clip(p, q => q.x >= minX, (a, b) => lerpX(a, b, minX));
  p = clip(p, q => q.x <= maxX, (a, b) => lerpX(a, b, maxX));
  p = clip(p, q => q.z >= minZ, (a, b) => lerpZ(a, b, minZ));
  p = clip(p, q => q.z <= maxZ, (a, b) => lerpZ(a, b, maxZ));
  return p;
}

// Площадь полигона (м²) — уходит в смету как площадь вырезанной части.
function polyAreaM2(poly) {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

// Чаша бассейна: вода чуть ниже настила + тёмные стенки вниз. Модели бассейна нет —
// это геометрия с задаваемыми размерами (решение продукта 2026-08-24).
const POOL_WATER_DROP = 0.12;   // вода ниже уровня настила, м
const POOL_DEPTH = 1.20;        // глубина чаши, м
// Бассейн — ОДНО простое тело: цилиндр для круглого, бокс для прямоугольного
// (TODO п.16). Верх тела — на отметке воды. Раньше строились отдельно плоскость
// воды (ShapeGeometry по полигону) и стенки чаши: плоскость выглядела «съехавшей»
// — на просвет было видно, что она обрезана настилом не по контуру чаши.
function buildPool3d(parent, poly, deckTopY) {
  if (!poly || poly.length < 3) return;
  const xs = poly.map(p => p.x), zs = poly.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const w = maxX - minX, d = maxZ - minZ;
  if (w < 0.2 || d < 0.2) return;
  const round = (typeof S !== 'undefined' && S.pool && S.pool.kind === 'round');
  const geo = round
    ? new THREE.CylinderGeometry(w / 2, w / 2, POOL_DEPTH, POOL_SEGMENTS)
    : new THREE.BoxGeometry(w, POOL_DEPTH, d);
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x2f7fa8, roughness: 0.22, metalness: 0.0,
  }));
  const topY = deckTopY - POOL_WATER_DROP;
  body.position.set((minX + maxX) / 2, topY - POOL_DEPTH / 2, (minZ + maxZ) / 2);
  body.castShadow = body.receiveShadow = true;
  parent.add(body);
}

// Пересечение линий, параллельных рёбрам e и m и смещённых по их нормалям на de/dm.
// Возвращает точку {x,z} или null, если рёбра почти параллельны (митры нет).
function _nosingLineX(e, de, m, dm) {
  const p1x = e.a.x + e.nx * de, p1z = e.a.z + e.nz * de;
  const p2x = m.a.x + m.nx * dm, p2z = m.a.z + m.nz * dm;
  const den = e.ux * m.uz - e.uz * m.ux;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((p2x - p1x) * m.uz - (p2z - p1z) * m.ux) / den;
  return { x: p1x + e.ux * t, z: p1z + e.uz * t };
}

// Призма высотой [yBot..yTop] по четырёхугольнику в плане (порядок точек — по
// контуру). Геометрия неиндексированная: у каждой грани свои нормали, без
// сглаживания на рёбрах доски.
function _nosingPrism(quad, yTop, yBot) {
  const P = (i, y) => [quad[i].x, y, quad[i].z];
  const tri = [];
  const push = (a, b, c) => { tri.push(...a, ...b, ...c); };
  // Верх и низ (четырёхугольник = два треугольника).
  push(P(0, yTop), P(1, yTop), P(2, yTop));
  push(P(0, yTop), P(2, yTop), P(3, yTop));
  push(P(0, yBot), P(2, yBot), P(1, yBot));
  push(P(0, yBot), P(3, yBot), P(2, yBot));
  // Боковины.
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    push(P(i, yTop), P(j, yBot), P(j, yTop));
    push(P(i, yTop), P(i, yBot), P(j, yBot));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// UV полуступени: доска РИСУЕТСЯ ВДОЛЬ СВОЕЙ ДЛИННОЙ СТОРОНЫ и СО СВОЕЙ привязкой —
// начало отсчёта в наружном углу самого куска (origin), а не в мировом нуле.
// Мировая привязка (до 2026-08-31) совпадала с проекцией настила, и на кромке,
// параллельной доскам террасы, рисунок полуступени продолжал соседнюю доску настила:
// полуступень «маскировалась» под обычную доску. Локальная привязка рвёт этот стык.
// Проекция осевая (_applyAxisUV): на верхней грани доски идут вдоль ребра, на наружной
// грани высотой 25 мм — тоже вдоль (раньше плоская проекция по x/z размазывала по ней
// одну линию текстуры). При tile = TERRACE_SIDE_TILE на ширину доски (170 мм)
// приходится ровно одна доска текстуры, то есть грувы ложатся на обе кромки.
function _nosingUV(mesh, e, origin, tile) {
  const geo = mesh.geometry;
  geo.translate(-origin.x, -origin.y, -origin.z);
  if (typeof _applyAxisUV === 'function') {
    _applyAxisUV(mesh, { x: e.ux, y: 0, z: e.uz }, tile);
  } else {                                   // фолбэк: прежняя плоская проекция
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      uv[i * 2]     = (x * e.ux + z * e.uz) / tile;
      uv[i * 2 + 1] = (x * e.nx + z * e.nz) / tile;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  geo.translate(origin.x, origin.y, origin.z);
  _nosingPhaseShift(mesh);
}

// Шов текстуры не должен попадать НА полуступень (требование продукта 2026-09-01):
// её ширина — ровно одна доска текстуры, и грувы должны совпасть с её кромками.
// У разных текстур товара шов стоит в картинке по-своему, поэтому v сдвигается на
// измеренную фазу (_texGroovePhase). Пока картинка не догрузилась, фазы нет — тогда
// сдвиг доложим позже, из _syncNosingPhase.
function _nosingPhaseShift(mesh) {
  const map = mesh.material && mesh.material.map;
  const phase = (typeof _texGroovePhase === 'function') ? _texGroovePhase(map) : 0;
  if (phase === null) return;                       // текстура ещё грузится
  const was = mesh.userData._nosingPhase || 0;
  const d = phase - was;
  if (Math.abs(d) < 1e-6) { mesh.userData._nosingPhase = phase; return; }
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) + d);
  uv.needsUpdate = true;
  mesh.userData._nosingPhase = phase;
}

// Текстура догружается уже после сборки сцены, поэтому фазу шва доносим до готовых
// полуступеней отдельно: несколько попыток с интервалом, пока картинка не появится.
// Сцена рисуется в постоянном animation loop — пересборка для этого не нужна.
function _syncNosingPhase(tries) {
  const list = (threeState && threeState.nosingMeshes) || [];
  let pending = false;
  for (const m of list) {
    if (!m.material) continue;
    const phase = (typeof _texGroovePhase === 'function') ? _texGroovePhase(m.material.map) : 0;
    if (phase === null) { pending = true; continue; }
    _nosingPhaseShift(m);
  }
  const left = (tries === undefined ? 20 : tries) - 1;
  if (pending && left > 0) setTimeout(() => _syncNosingPhase(left), 300);
}

// ── ПОЛУСТУПЕНЬ ──────────────────────────────────────────────────────────────
// Доска по всему СВОБОДНОМУ контуру террасы (TODO.md, этап 1 п.7): 170 мм в плане,
// 25 мм по высоте, верх на 4 мм выше настила, наружу вылет 10 мм. Свободный контур —
// весь периметр, КРОМЕ участков у стен дома; у лестницы полуступень НЕ разрывается.
const NOSING_W    = 0.17;    // ширина доски в плане
const NOSING_H    = 0.025;   // высота доски
const NOSING_OUT  = 0.01;    // вылет за кромку настила
// Подъём над настилом. Изначально это был 1 мм — только чтобы не было z-fighting на
// перекрытии в 160 мм. Но заподлицо полуступень ничем не отличалась от доски настила:
// 170 мм рядом со 150 мм читались как ещё одна доска, и элемент «маскировался»
// (решение продукта 2026-08-31). На 4 мм по стыку идёт теневая линия, и доска читается
// по всему периметру; развёртка при этом остаётся вдоль длинной стороны (_nosingUV).
const NOSING_LIFT = 0.004;

// Точка внутри полигона (мир {x,z}), луч вправо.
function _pointInPolyXZ(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) &&
        x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Участки ребра (нормированные t), попадающие ВНУТРЬ полигона. Полуступень там
// не строится: в вырезе под бассейн доска шла поперёк дыры (TODO п.16). pad —
// запас с каждой стороны, чтобы доска не нависала над водой.
function _polyCutRanges(ax, az, bx, bz, poly, pad) {
  if (!poly || poly.length < 3) return [];
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  if (L < 1e-6) return [];
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - ax) * ez - (p.z - az) * ex) / den;
    const u = ((p.x - ax) * dz - (p.z - az) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const g = (pad || 0) / L;
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-4) continue;
    const mid = (t0 + t1) / 2;
    if (!_pointInPolyXZ(ax + dx * mid, az + dz * mid, poly)) continue;
    out.push([Math.max(0, t0 - g), Math.min(1, t1 + g)]);
  }
  return out;
}

// Строит полуступень по union-контуру блоков секции.
// worldRects — [{minX,maxX,minZ,maxZ}] в мире, deckTopY — отметка верха настила.
// holes — вырезы в настиле (полигоны world {x,z}, сейчас бассейн): в них доски нет.
function buildTerraceNosing(parent, M, worldRects, deckTopY, holes) {
  if (!worldRects || !worldRects.length) return 0;
  if (typeof _terraceUnionLoops !== 'function') return 0;
  const loops = _terraceUnionLoops(worldRects);
  const houseEdges = (typeof _railHouseEdges === 'function') ? _railHouseEdges() : [];
  const inside = (x, z) => worldRects.some(r =>
    x > r.minX + 1e-4 && x < r.maxX - 1e-4 && z > r.minZ + 1e-4 && z < r.maxZ - 1e-4);
  const mat = M.deck;
  let built = 0;

  for (const loop of loops) {
    const n = loop.length;
    if (n < 3) continue;
    // Направление и НАРУЖНАЯ нормаль каждого ребра (пробой точки в полуметре от середины).
    const seg = [];
    for (let i = 0; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      if (L < 1e-6) { seg.push(null); continue; }
      const ux = dx / L, uz = dz / L;
      let nx = uz, nz = -ux;
      if (inside((a.x + b.x) / 2 + nx * 0.05, (a.z + b.z) / 2 + nz * 0.05)) { nx = -nx; nz = -nz; }
      seg.push({ a, ux, uz, nx, nz, L, alongX: Math.abs(ux) > Math.abs(uz) });
    }
    // У стен дома полуступени нет: те же skip-диапазоны, что у перил (pad 0.30).
    const skipsOf = [];
    for (let i = 0; i < n; i++) {
      const e = seg[i], b = loop[(i + 1) % n];
      let sk = (e && houseEdges.length)
        ? _railEdgesSkipRanges(e.a.x, e.a.z, b.x, b.z, 0.30, houseEdges) : [];
      // Вырезы (бассейн) — доска обрывается по краю выреза, как и сам настил.
      if (e && holes) for (const h of holes) {
        sk = sk.concat(_polyCutRanges(e.a.x, e.a.z, b.x, b.z, h, NOSING_W));
      }
      sk.sort((p, q) => p[0] - q[0]);
      skipsOf.push(sk);
    }
    // Есть ли у ребра доска у его начала (t=0) / конца (t=1)?
    const coveredAt = (idx, atStart) => {
      if (!seg[idx]) return false;
      const t = atStart ? 0.001 : 0.999;
      return !skipsOf[idx].some(([a, b2]) => t >= a - 1e-6 && t <= b2 + 1e-6);
    };

    for (let i = 0; i < n; i++) {
      const e = seg[i];
      if (!e) continue;
      const b = loop[(i + 1) % n];
      const skips = skipsOf[i];
      const parts = _railSplitBySkipRanges(e.a.x, e.a.z, b.x, b.z, skips);
      for (const p of parts) {
        // t вдоль ребра: 0 — вершина начала, 1 — вершина конца (не обрезано скипом).
        const s0 = ((p.ax - e.a.x) * e.ux + (p.az - e.a.z) * e.uz);
        const s1 = ((p.bx - e.a.x) * e.ux + (p.bz - e.a.z) * e.uz);
        if (s1 - s0 < 0.05) continue;
        // Стыки на углах — «в ус», под 45° (правка 2026-08-30): торец доски идёт по
        // биссектрисе угла, то есть по линии, соединяющей точку пересечения НАРУЖНЫХ
        // кромок соседних досок с точкой пересечения ВНУТРЕННИХ. Раньше доски
        // стыковались внахлёст встык (одна доводилась до наружной грани другой) —
        // угол выглядел «внакладку», а не запиленным.
        // Сосед в начале ребра — предыдущее ребро (стык на его КОНЦЕ), в конце —
        // следующее (стык на его НАЧАЛЕ). Если у соседа доски нет (стена дома),
        // торец остаётся прямым.
        const mitre = (mi, atVertex, neighbourStart) => {
          if (!atVertex) return null;
          const m = seg[mi];
          if (!m || !coveredAt(mi, neighbourStart)) return null;
          const o = _nosingLineX(e, NOSING_OUT, m, NOSING_OUT);
          const q = _nosingLineX(e, -(NOSING_W - NOSING_OUT), m, -(NOSING_W - NOSING_OUT));
          return (o && q) ? { out: o, in: q } : null;
        };
        const mA = mitre((i - 1 + n) % n, s0 < 1e-4, false);
        const mB = mitre((i + 1) % n, s1 > e.L - 1e-4, true);
        // Прямой торец: точки на наружной и внутренней кромке при параметре s.
        const at = (s, d) => ({ x: e.a.x + e.ux * s + e.nx * d,
                                z: e.a.z + e.uz * s + e.nz * d });
        const outA = mA ? mA.out : at(s0, NOSING_OUT);
        const inA  = mA ? mA.in  : at(s0, -(NOSING_W - NOSING_OUT));
        const outB = mB ? mB.out : at(s1, NOSING_OUT);
        const inB  = mB ? mB.in  : at(s1, -(NOSING_W - NOSING_OUT));
        // Слишком короткий кусок (митра съела длину) — пропускаем.
        if (Math.hypot(outB.x - outA.x, outB.z - outA.z) < 0.02 &&
            Math.hypot(inB.x - inA.x, inB.z - inA.z) < 0.02) continue;

        const yTop = deckTopY + NOSING_LIFT;
        const geo = _nosingPrism([outA, outB, inB, inA], yTop, yTop - NOSING_H);
        const m = new THREE.Mesh(geo, mat);
        // Текстура ВСЕГДА вдоль доски и со своей привязкой — от наружного угла этого
        // куска, а не от мирового нуля: иначе на кромке, параллельной доскам настила,
        // полуступень продолжает их рисунок и не читается как отдельная доска.
        _nosingUV(m, e, { x: outA.x, y: yTop, z: outA.z }, TERRACE_SIDE_TILE);
        m.castShadow = m.receiveShadow = true;
        parent.add(m);
        threeState.deckMeshes.push(m);
        if (!threeState.nosingMeshes) threeState.nosingMeshes = [];
        threeState.nosingMeshes.push(m);          // для доводки фазы шва по текстуре
        built++;
      }
    }
  }
  // Текстура товара могла ещё не догрузиться — доводим фазу шва, когда появится.
  if (built) _syncNosingPhase();
  return built;
}

// Настил террасы/крыльца по плановому полигону foot (world {x,z}). Призма от земли
// (Y=0) до deckHeight: верх = настил (доски вдоль X или Z), боковые грани = дощатая
// «юбка», низ закрыт. UV world-based (как _applyBoxUV) → непрерывный тайл между
// блоками одинаковой ориентации. На углах составной террасы foot заранее обрезается
// по диагонали (миттер) — доски двух перпендикулярных крыльев сходятся под 45°.
// foot — выпуклый (CCW); диагональные рёбра-стыки внутренние (их «юбка» скрыта телом
// соседнего крыла).
// holes — необязательные вырезы (полигоны world {x,z}), например бассейн
// (TODO.md, этап 2 п.14). С вырезом верх и низ триангулируются с дырой, а по её
// контуру достраивается стенка — иначе настил выглядел бы бумажным.
function _buildTerracePoly(parent, M, foot, deckHeight, plankAlongX, meshArrayName, holes) {
  const n = foot.length;
  if (n < 3 || deckHeight < 0.03) return;
  // Нормализуем контур в CCW (в плоскости x,z) — иначе верхняя грань смотрит вниз.
  let area2 = 0;
  for (let k = 0; k < n; k++) { const a = foot[k], b = foot[(k + 1) % n]; area2 += a.x * b.z - b.x * a.z; }
  if (area2 < 0) foot = foot.slice().reverse();
  const T = DECK_TILE, yTop = deckHeight, yBot = 0;
  const topUV = (x, z) => plankAlongX ? [x / T, z / T] : [z / T, x / T];
  const pos = [], uv = [], idx = [];

  // ── Вырезы: дыры триангулируем через ShapeUtils (он умеет holes), стенку по
  //    контуру дыры достраиваем отдельно. Без вырезов — прежний веер, он дешевле.
  const cuts = (holes || []).filter(h => h && h.length >= 3).map(h => {
    // Дыра должна идти в ОБРАТНОМ направлении относительно контура (CW при CCW-контуре).
    let a2 = 0;
    for (let k = 0; k < h.length; k++) { const a = h[k], b = h[(k + 1) % h.length]; a2 += a.x * b.z - b.x * a.z; }
    return a2 > 0 ? h.slice().reverse() : h.slice();
  });

  if (cuts.length) {
    const toV2 = p => new THREE.Vector2(p.x, p.z);
    const contour = foot.map(toV2);
    const holeV = cuts.map(h => h.map(toV2));
    const flat = [...foot, ...cuts.flat()];
    for (const p of flat) { pos.push(p.x, yTop, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); }
    for (const p of flat) { pos.push(p.x, yBot, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); }
    const N = flat.length;
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
    for (const t of tris) { idx.push(t[0], t[2], t[1]); idx.push(N + t[0], N + t[1], N + t[2]); }
    // Стенка по контуру каждой дыры (нормаль внутрь выреза).
    const TS0 = TERRACE_SIDE_TILE;
    let off = foot.length;
    for (const h of cuts) {
      for (let i = 0; i < h.length; i++) {
        const a = h[i], b = h[(i + 1) % h.length];
        const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
        const uA = (alongX ? a.x : a.z) / TS0, uB = (alongX ? b.x : b.z) / TS0;
        const base = pos.length / 3;
        pos.push(a.x, yTop, a.z); uv.push(uA, yTop / TS0);
        pos.push(b.x, yTop, b.z); uv.push(uB, yTop / TS0);
        pos.push(b.x, yBot, b.z); uv.push(uB, yBot / TS0);
        pos.push(a.x, yBot, a.z); uv.push(uA, yBot / TS0);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      off += h.length;
    }
  } else {
  for (const p of foot) { pos.push(p.x, yTop, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); } // верх 0..n-1
  for (const p of foot) { pos.push(p.x, yBot, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); } // низ  n..2n-1
  for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);          // верх (нормаль +Y)
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i, n + i + 1);  // низ  (нормаль −Y)
  }
  // Юбка: на каждое ребро — свой квад. Доски ГОРИЗОНТАЛЬНЫЕ (TODO.md, этап 1 п.8):
  // грувы текстуры — линии постоянного V, поэтому V идёт ПО ВЫСОТЕ, а U вдоль ребра.
  // Ребро UV-бокса — TERRACE_SIDE_TILE (доска зашивки шире доски настила).
  const TS = TERRACE_SIDE_TILE;
  for (let i = 0; i < n; i++) {
    const a = foot[i], b = foot[(i + 1) % n];
    const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    const uA = (alongX ? a.x : a.z) / TS, uB = (alongX ? b.x : b.z) / TS;
    const base = pos.length / 3;
    pos.push(a.x, yTop, a.z); uv.push(uA, yTop / TS);
    pos.push(b.x, yTop, b.z); uv.push(uB, yTop / TS);
    pos.push(b.x, yBot, b.z); uv.push(uB, yBot / TS);
    pos.push(a.x, yBot, a.z); uv.push(uA, yBot / TS);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3); // наружу (foot CCW)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.deck);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  if (meshArrayName && threeState[meshArrayName]) threeState[meshArrayName].push(m);
}

// Тёмная подкладка (отмостка) под наземной конструкцией (терраса, ступени).
// Axis-aligned footprint в мире (minX..maxX, minZ..maxZ), расширенный на offset;
// тонкая плита от земли (y 0..0.05) — той же высоты и цвета, что pad дома
// (HouseBuilder строит его по контуру). Перекрытие с pad-ом дома и соседними
// подкладками допустимо — одинаковый цвет/высота дают бесшовную тёмную зону.
// НЕ кладётся в deckMeshes: иначе смена deck-материала перекрасила бы подкладку.
// Подкладка выступает из-под конструкции на PAD_OFFSET (10 см — по требованию
// 2026-08-22; было 30 см, из-за чего у террасы и лестницы она читалась как отдельная
// площадка), красится нейтрально-серым и ПРИТОПЛЕНА (верх на PAD_TOP_Y = 5 мм):
// иначе торчал её 5-сантиметровый торец и верх совпадал с верхом дорожки (z-fighting).
// Материал создаётся per-build и диспозится в clearGroup(houseGroup, true).
const PAD_OFFSET = 0.10;      // выступ подкладки за габарит конструкции, м
// Цвет — из HouseBuilder (единый источник для отмостки дома, крыльца и конструкций);
// читаем при вызове, а не при загрузке файла: house-builder подключается раньше,
// но константа нужна только в момент сборки сцены.
const _padColor = () => ((typeof HouseBuilder !== 'undefined' && HouseBuilder.PAD_COLOR)
                          || 0x3c3c3c);
// Отметка верха плиты — тоже из HouseBuilder: подкладка притоплена (см. PAD_TOP_Y).
const _padTopY = () => ((typeof HouseBuilder !== 'undefined' && HouseBuilder.PAD_TOP_Y !== undefined)
                          ? HouseBuilder.PAD_TOP_Y : 0.005);
// offset — число (запас по обеим осям) или {x, z} (запас по каждой оси отдельно:
// подкладке лестницы запас нужен только вдоль спуска, вбок она вылезала за край веранды).
function buildConstructionPad(parent, minX, maxX, minZ, maxZ, offset) {
  const padThick = 0.05;
  const offX = (offset === undefined) ? PAD_OFFSET
             : (typeof offset === 'number' ? offset : (offset.x || 0));
  const offZ = (offset === undefined) ? PAD_OFFSET
             : (typeof offset === 'number' ? offset : (offset.z || 0));
  const W = (maxX - minX) + 2 * offX;
  const D = (maxZ - minZ) + 2 * offZ;
  if (W < 0.3 || D < 0.3) return;
  const mat = new THREE.MeshStandardMaterial({ color: _padColor(), roughness: 0.95, metalness: 0.0 });
  mat.name = 'mat_construction_pad';
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, padThick, D), mat);
  m.position.set((minX + maxX) / 2, _padTopY() - padThick / 2, (minZ + maxZ) / 2);
  m.receiveShadow = true;
  parent.add(m);
}

// ══════════════════════════════════════════════
// ГРЯДКИ (raised beds) — GLB-модуль mod_planter_a
// ══════════════════════════════════════════════
// Модель смоделирована в натуральном размере: дерево (planter_wood) X[0..3],
// Y[0..0.1566], Z[-1..0]; земля (planter_soil) — тонкая плита внутри.
// Дерево перекрываем deck-материалом + кубическим UV (как терраса/дорожки),
// земля сохраняет свой материал. Высота — масштаб по Y (одна на все грядки).
const PLANTER_NATIVE_H   = 0.1566;  // родная высота борта (верх дерева), м
const PLANTER_SOIL_TOP   = 0.0908;  // родная высота верха земли, м
const PLANTER_SOIL_GAP   = PLANTER_NATIVE_H - PLANTER_SOIL_TOP; // отступ земли от борта (~65 мм)
let _planterCache = null;       // { woodGeo, soilGeo } — клоны геометрий в родном базисе
let _planterLoadPromise = null; // защита от повторной загрузки

function ensurePlanterLoaded() {
  if (_planterCache) return Promise.resolve(_planterCache);
  if (_planterLoadPromise) return _planterLoadPromise;
  _planterLoadPromise = new Promise(resolve => {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { resolve(null); return; }
    const loader = new THREE.GLTFLoader();
    loader.load(
      'assets/houses/modules/site/mod_planter_a.glb?v=1',
      gltf => {
        let woodGeo = null, soilGeo = null;
        gltf.scene.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          o.updateWorldMatrix(true, false);
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld); // запекаем трансформ узла (у модуля — единичный)
          if ((o.name || '').toLowerCase().includes('soil')) soilGeo = g;
          else woodGeo = g;
        });
        _planterCache = { woodGeo, soilGeo };
        resolve(_planterCache);
      },
      undefined,
      err => { console.warn('[planter] не удалось загрузить GLB:', err); resolve(null); }
    );
  });
  return _planterLoadPromise;
}

// ══════════════════════════════════════════════
// САДОВАЯ МЕБЕЛЬ — GLB-модели по точкам плана (S.furniture)
// Точка = место установки; товар назначается ей из каталога (по порядку номеров).
// Источник модели (`furnitureModelUrl`): поле товара из API, когда бэкенд его
// добавит, иначе локальный фолбэк. На 2026-08-02 API моделей НЕ отдаёт: у товаров
// нет полей model/glb, разделы мебели (2442/2448) пусты, /static/models|glb — 404.
// Как только появится (ожидаем `model_url` или `texture_urls.model_glb`) —
// ResourceManager прокидывает его в ProductResource.modelUrl и код подхватит.
// ══════════════════════════════════════════════
const FURNITURE_FALLBACK = {
  lamp:  'assets/houses/modules/site/mod_lamp_a.glb',
  bench: 'assets/houses/modules/site/mod_bench_a.glb',
};
const _furnCache = {};          // url → THREE.Group (прототип для клонирования)
const _furnLoading = {};        // url → Promise

function furnitureModelUrl(product) {
  // glbFileUrl — поле каталога (glb_file_url в ответе API, с 2026-08-02);
  // modelUrl — то же значение, прокинутое в образец при «Применить».
  const direct = product && (product.glbFileUrl || product.modelUrl);
  if (direct) return direct;
  const n = ((product && product.name) || '').toLowerCase();
  if (/лампа|светильник|фонар|торшер/.test(n)) return FURNITURE_FALLBACK.lamp;
  return FURNITURE_FALLBACK.bench;   // диваны/скамьи/столы — пока одна модель
}

// Загрузка модели с индикатором прогресса: файлы каталога — 4–12 МБ (3–10 с),
// поэтому прогресс отдаётся в d3dLoadingSet (nav-desktop.js). Если сервер не шлёт
// Content-Length, pct = null → индикатор показывает бегущую полосу без процентов.
function ensureFurnitureModel(url, label) {
  if (_furnCache[url]) return Promise.resolve(_furnCache[url]);
  if (_furnLoading[url]) return _furnLoading[url];
  const done = () => { if (typeof d3dLoadingClear === 'function') d3dLoadingClear(url); };
  const show = pct => { if (typeof d3dLoadingSet === 'function') d3dLoadingSet(url, label || 'модель', pct); };
  _furnLoading[url] = new Promise(resolve => {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { resolve(null); return; }
    show(null);
    new THREE.GLTFLoader().load(url,
      gltf => { _furnCache[url] = gltf.scene; _furnLoading[url] = null; done(); resolve(gltf.scene); },
      ev => { show(ev && ev.total > 0 ? Math.min(100, Math.round(ev.loaded / ev.total * 100)) : null); },
      err => { console.warn('[furniture] не загрузилась модель', url, err);
               _furnCache[url] = null; _furnLoading[url] = null; done(); resolve(null); });
  });
  return _furnLoading[url];
}

// Маркер места под мебель: полупрозрачный диск + треугольник-стрелка, показывающий
// «перёд» (локальный +X группы). Ставится под пустой точкой, а также пока модель
// грузится или если она не загрузилась — место в сцене видно всегда.
function _furnitureMarker() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9,
                                               transparent: true, opacity: 0.5 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20), mat);
  disc.position.y = 0.02; disc.receiveShadow = true;
  g.add(disc);
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0.44, 0, 0,   0.24, 0, -0.12,   0.24, 0, 0.12,      // обход даёт нормаль +Y
  ], 3));
  triGeo.computeVertexNormals();
  const tip = new THREE.Mesh(triGeo, mat);
  tip.position.y = 0.045;
  g.add(tip);
  return g;
}

// Расставляет мебель по точкам. surfaceYAt(x,z) → отметка поверхности (настил
// террасы/причала или земля) — точка на террасе ставит мебель НА настил.
// Модель садится основанием на эту отметку и центрируется по точке в плане.
// Точки без модели (товар не выбран, модель ещё грузится или не загрузилась)
// показываются маркером-подставкой — место в 3D видно всегда.
//
// ПОВОРОТ (pt.rot, радианы, кратно π/2). «Перёд» мебели — локальная ось +X модели;
// при rot = 0 он смотрит вдоль мирового +X (вправо на плане). Модель кладётся в
// группу-пивот, центрированную по точке: вращать сам клон нельзя — его origin не
// совпадает с центром bbox, и предмет уезжал бы с точки по дуге.
function buildFurniture3d(parent, M, points, houseL, houseW, surfaceYAt) {
  if (!points || !points.length) return;
  points.forEach((pt, i) => {
    const w = canvasToWorld([{ x: pt.x, y: pt.y }], houseL, houseW)[0];
    const y = surfaceYAt ? surfaceYAt(w.x, w.z) : 0;
    const rot = pt.rot || 0;
    const marker = () => {
      const g = _furnitureMarker();
      g.position.set(w.x, y, w.z);
      g.rotation.y = rot;
      parent.add(g); threeState.furnitureMeshes.push(g);
    };
    if (!pt.product) { marker(); return; }
    const url = furnitureModelUrl(pt.product);
    const proto = _furnCache[url];
    if (proto === undefined) {
      ensureFurnitureModel(url, pt.product.name).then(() => { if (threeState) buildScene3d(); });
      marker(); return;                       // пока грузится — место видно маркером
    }
    if (!proto) { marker(); return; }         // модель не загрузилась — остаётся маркер
    const obj = proto.clone(true);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    // В пивоте: центр модели в плане — в начале координат, основание — на y=0.
    obj.position.set(-c.x, -bb.min.y, -c.z);
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      // Материалы КЛОНИРУЕМ: Object3D.clone() шарит их с прототипом в кэше, а
      // clearGroup(houseGroup, true) диспозит материалы — иначе следующая
      // пересборка получила бы «убитый» прототип (та же грабля, что с vegGroup).
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    });
    const pivot = new THREE.Group();
    pivot.add(obj);
    pivot.position.set(w.x, y, w.z);           // точка плана + отметка поверхности
    pivot.rotation.y = rot;
    parent.add(pivot); threeState.furnitureMeshes.push(pivot);
  });
}

// ── Ограждение террасы: GLB-модуль mod_railing (post / rails / balu_short / balu_floor) ──
// Геометрии запекаются в родном базисе модуля: post центрирован на x=0 (h 0..1.2),
// rails x[0..1]; Y=высота, Z=поперёк. Секция = 1.0 м между осями.
// Балясины — единичные, центрированы в x=0 (сечение 50×50): baluShort (y 0.145..1.055) и
// baluFloor (y 0..1.055, узор «2/5/8 от пола»). Перила (rails) тянем масштабом по длине
// пролёта, балясины — НЕ тянем (иначе плющится сечение): тиражируем нужным числом по шагу ~0.1 м.
// Модули ограждения различаются ТОЛЬКО крышкой столба — три файла, ключи те же,
// что id в RAIL_CAP_TYPES. Бэкенд назначает товару свой glb_file_url (эти же
// модели), поэтому файл товара всегда главнее локального.
const RAIL_CAP_MODULES = {
  dpk:     'assets/houses/modules/site/mod_railing_dpk.glb',
  metal:   'assets/houses/modules/site/mod_railing_metal.glb',
  plastic: 'assets/houses/modules/site/mod_railing_plastic.glb',
};
// Модуль без крышки — для товаров, у которых вид крышки не задан.
const RAIL_MODULE_FALLBACK = 'assets/houses/modules/site/mod_railing.glb?v=2';

let _railingCaches = {};        // url → { post, rails, baluShort, baluFloor, cap, … }
let _railingLoads = {};         // url → Promise
let _railingCache = null;       // активный модуль (его читает buildRailing3d)

// Вид крышки столба у выбранного товара: сначала свойство каталога
// (components.post_cap.type — согласовано с бэкендом), потом имя назначенного
// товару GLB, потом слово в названии (RAIL_CAP_TYPES). Пусто — крышки нет.
function railingCapType() {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.railing : null;
  if (!em) return '';
  const prop = (typeof productProp === 'function')
    ? productProp(em, 'components.post_cap.type') : null;
  if (prop && RAIL_CAP_MODULES[String(prop).toLowerCase()]) return String(prop).toLowerCase();
  const m = /mod_railing_(dpk|metal|plastic)\b/i.exec(em.modelUrl || '');
  if (m) return m[1].toLowerCase();
  return _railCapFromText((em.name || '') + ' ' + (em.previewText || ''));
}

// Вид крышки из НАЗВАНИЯ — только если в нём вообще говорится о крышке. Без этого
// условия «Ограждение из ДПК …» получало крышку ДПК, хотя ДПК там про материал
// самого ограждения, а вид крышки у товара не задан (бэкенд оставил его пустым).
function _railCapFromText(text) {
  if (!/крышк|колпач|колпак|cap/i.test(text || '')) return '';
  if (typeof RAIL_CAP_TYPES === 'undefined') return '';
  for (const t of RAIL_CAP_TYPES) if (t.re.test(text) && RAIL_CAP_MODULES[t.id]) return t.id;
  return '';
}

// Какой модуль строить: GLB товара, иначе модуль под вид крышки, иначе базовый.
function railingModelUrl() {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.railing : null;
  if (em && em.modelUrl) return em.modelUrl;
  return RAIL_CAP_MODULES[railingCapType()] || RAIL_MODULE_FALLBACK;
}

// Сделать модуль активным. Вернёт разобранный модуль или null, если он ещё не
// загружен (тогда зовущий грузит его через ensureRailingLoaded и пересобирает сцену).
function railingUseModule(url) {
  const c = _railingCaches[url || RAIL_MODULE_FALLBACK];
  if (c) _railingCache = c;
  return c || null;
}
const RAIL_BALU_PITCH = 0.1;    // нативный шаг балясин (центр-центр), м
const RAIL_BALU_INSET = 0.1;    // отступ крайней балясины от оси столба, м
const RAIL_BALU_MAX   = 9;      // максимум балясин на секцию (9 = ровный узор «2/5/8 от пола»)
const RAIL_SECTION_W  = 1.5;    // ширина секции ПО ОСЯМ СТОЛБОВ (одинакова везде), м
const RAIL_POST_H     = 1.0;    // высота столба ограждения (от настила до верха), м
const RAIL_POST_MERGE = 0.28;   // столбы ближе этого расстояния считаем одним (дедуп на стыках rect-ов)
let _railPostReg = null;        // общий реестр поставленных столбов [{x,z,tall,mesh}] на проход buildScene3d

function ensureRailingLoaded(url) {
  url = url || RAIL_MODULE_FALLBACK;
  if (_railingCaches[url]) return Promise.resolve(_railingCaches[url]);
  if (_railingLoads[url]) return _railingLoads[url];
  _railingLoads[url] = new Promise(resolve => {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { resolve(null); return; }
    new THREE.GLTFLoader().load(
      url,
      gltf => {
        const c = { post: null, rails: null, baluShort: null, baluFloor: null, cap: null };
        gltf.scene.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          o.updateWorldMatrix(true, false);
          const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
          const n = (o.name || '').toLowerCase();
          if (n.includes('post')) c.post = g;
          else if (n.includes('cap')) c.cap = g;          // крышка столба (в базовом модуле её нет)
          else if (n.includes('balu_floor')) c.baluFloor = g;
          else if (n.includes('balu_short')) c.baluShort = g;
          else if (n.includes('rail')) c.rails = g;
        });
        // Нативные высоты модуля (для приведения к RAIL_POST_H). Меряем по геометрии,
        // а не хардкодим — переэкспорт GLB не потребует правки кода.
        const topY = g => { if (!g) return 0; g.computeBoundingBox(); return g.boundingBox.max.y; };
        c.nativePostH = topY(c.post) || 1.2;              // верх столба в родном базисе
        c.nativeBaluH = topY(c.baluFloor) || c.nativePostH; // верх балясины (= низ поручня)
        c.ky = RAIL_POST_H / c.nativePostH;               // общий масштаб модуля по высоте
        c.baluTopH = c.nativeBaluH * c.ky;                // высота низа поручня над настилом
        console.info('[railing] модуль загружен:', url, '| крышка столба:', c.cap ? 'есть' : 'нет');
        _railingCaches[url] = c;
        if (!_railingCache) _railingCache = c;
        resolve(c);
      },
      undefined,
      err => {
        console.warn('[railing] не удалось загрузить GLB:', url, err);
        _railingLoads[url] = null;
        // Модуль товара не открылся — работаем базовым, иначе ограждение пропадёт.
        if (url !== RAIL_MODULE_FALLBACK) { ensureRailingLoaded(RAIL_MODULE_FALLBACK).then(resolve); return; }
        resolve(null);
      }
    );
  });
  return _railingLoads[url];
}

// Материал крышки столба по её виду (правило продукта, уточнено 2026-08-28):
//   dpk     — материал и текстура как у самого ограждения;
//   metal   — карт нет вовсе, цвет из карточки товара, roughness 0.30, metalness 0.30;
//   plastic — остаётся ТОЛЬКО карта normal (рельеф тот же), цвет из карточки товара,
//             roughness 0.50 без карты, metalness 0.
// Цвет обязательно свой: у товара с PBR-текстурами материал ограждения белый
// (color=0xffffff, чтобы не красить текстуру), и крышка без карт вышла бы белой.
const RAIL_CAP_MAPS = ['map', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap',
                       'displacementMap', 'emissiveMap', 'specularMap', 'alphaMap'];
const RAIL_CAP_FALLBACK_COLOR = 0x8c8c8c;   // «Серый» палитры — когда цвет не распознан

// Цвет выбранного товара ограждения: поле color каталога, иначе имя цвета в
// названии, иначе в описании (тот же порядок, что у фильтра цвета в каталоге).
function _railProductColorHex() {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.railing : null;
  if (!em) return null;
  if (typeof _detectColorNames !== 'function' || typeof CATALOG_COLOR_HEX === 'undefined') return null;
  for (const text of [em.color, em.name, em.previewText]) {
    if (!text) continue;
    for (const name of _detectColorNames(text)) {
      if (CATALOG_COLOR_HEX[name]) return CATALOG_COLOR_HEX[name];
    }
  }
  return null;
}

function _railCapMaterial(base, capType) {
  if (capType !== 'metal' && capType !== 'plastic') return base;   // дпк и неизвестное — как ограждение
  const m = base.clone();
  m.name = 'mat_railing_cap_' + capType;
  const hasMaps = !!(base.map || base.normalMap || base.roughnessMap);
  for (const k of RAIL_CAP_MAPS) if (m[k]) m[k] = null;
  if (capType === 'metal') { m.normalMap = null; m.roughness = 0.30; m.metalness = 0.30; }
  else                     { m.roughness = 0.50; m.metalness = 0.0; }
  const hex = _railProductColorHex();
  if (hex) m.color.set(hex);
  // Цвет не распознан, а материал ограждения был белой «подложкой под текстуру» —
  // ставим нейтральный серый, иначе крышка светилась бы белым.
  else if (hasMaps) m.color.set(RAIL_CAP_FALLBACK_COLOR);
  m.needsUpdate = true;
  return m;
}

// Матрица, отображающая родной базис планки в мировой прямоугольник грядки.
//   rot=false: длинная сторона (3 м) вдоль X; rot=true: вдоль Z (поворот +90°).
//   sy: масштаб по высоте = bedH / PLANTER_NATIVE_H.
function _planterMatrix(minX, maxX, minZ, maxZ, rot, sy) {
  const S4 = new THREE.Matrix4().makeScale(1, sy, 1);
  let M4;
  if (!rot) {
    // X[0,3]→[minX,maxX]; Z[-1,0]→[minZ,maxZ] (z=0→maxZ); Y база на земле.
    const T = new THREE.Matrix4().makeTranslation(minX, 0, maxZ);
    M4 = T.multiply(S4);
  } else {
    // поворот +90° по Y: (x,y,z)→(z,y,-x). X[0,1]?? см. вывод в комментарии.
    const R = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const T = new THREE.Matrix4().makeTranslation(maxX, 0, maxZ);
    M4 = T.multiply(R).multiply(S4);
  }
  return M4;
}

// Габариты грядки в мире по её rect'у в плане.
function _bedWorldBox(b, houseL, houseW) {
  const w = canvasToWorld([
    { x: b.x,       y: b.y       },
    { x: b.x + b.w, y: b.y       },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x,       y: b.y + b.h },
  ], houseL, houseW);
  return {
    minX: Math.min(...w.map(p => p.x)), maxX: Math.max(...w.map(p => p.x)),
    minZ: Math.min(...w.map(p => p.z)), maxZ: Math.max(...w.map(p => p.z)),
  };
}

// Место под грядку до выбора товара: плоский прямоугольник 3×1 на земле.
// Высота борта, цвет и крепёж приходят с карточки товара (TODO.md → ГРЯДКИ),
// поэтому рисовать модель до выбора — выдумывать её параметры.
function _buildBedPlaceholders(parent, beds, houseL, houseW) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9,
                                               transparent: true, opacity: 0.5 });
  for (const b of beds) {
    const bb = _bedWorldBox(b, houseL, houseW);
    const wX = bb.maxX - bb.minX, wZ = bb.maxZ - bb.minZ;
    if (wX < 0.3 || wZ < 0.3) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wX, 0.04, wZ), mat);
    m.position.set((bb.minX + bb.maxX) / 2, 0.02, (bb.minZ + bb.maxZ) / 2);
    m.receiveShadow = true;
    parent.add(m); threeState.bedMeshes.push(m);
  }
}

function buildBeds3d(parent, M, beds, bedH, houseL, houseW) {
  // Товар для грядок ещё не выбран → показываем только место под неё.
  const chosen = (typeof S !== 'undefined' && S.elementMat && S.elementMat.beds
                  && S.elementMat.beds.productId);
  if (!chosen) { _buildBedPlaceholders(parent, beds, houseL, houseW); return; }
  if (!_planterCache || !_planterCache.woodGeo) {
    // Товар выбран, но GLB ещё не загружен: грузим и до готовности показываем места.
    ensurePlanterLoaded().then(c => { if (c && threeState) buildScene3d(); });
    _buildBedPlaceholders(parent, beds, houseL, houseW);
    return;
  }
  const sy = Math.max(0.2, bedH / PLANTER_NATIVE_H);
  // Земля: верх на (bedH - PLANTER_SOIL_GAP), то есть сохраняем родной отступ от борта.
  const soilExtraY = (bedH - PLANTER_SOIL_GAP) - PLANTER_SOIL_TOP * sy;

  for (const b of beds) {
    const { minX, maxX, minZ, maxZ } = _bedWorldBox(b, houseL, houseW);
    const wX = maxX - minX, wZ = maxZ - minZ;
    if (wX < 0.3 || wZ < 0.3) continue;
    const rot = wZ > wX; // длинная сторона вдоль Z → поворот

    const mat4 = _planterMatrix(minX, maxX, minZ, maxZ, rot, sy);

    // Дерево: deck-материал + кубический мировой UV (масштаб как терраса/дорожки).
    const woodGeo = _planterCache.woodGeo.clone();
    woodGeo.applyMatrix4(mat4);
    const wood = new THREE.Mesh(woodGeo, M.deck);
    wood.castShadow = wood.receiveShadow = true;
    _applyBoxUV(wood, DECK_TILE); // mesh.position=0 → локальные коорд. = мировые
    parent.add(wood);
    threeState.bedMeshes.push(wood);
    // Дерево = deck-материал → перекрашивается вместе с террасой/дорожками.
    threeState.deckMeshes.push(wood);

    // Земля: свой материал, верх — у борта.
    if (_planterCache.soilGeo) {
      const soilGeo = _planterCache.soilGeo.clone();
      soilGeo.applyMatrix4(mat4);
      if (soilExtraY) soilGeo.translate(0, soilExtraY, 0);
      const soil = new THREE.Mesh(soilGeo, M.soil);
      soil.castShadow = false; soil.receiveShadow = true;
      parent.add(soil);
      threeState.bedMeshes.push(soil);
    }
  }
}

function buildTerrace3d(parent, M, pts, deckHeight, houseL, houseW, meshArrayName) {
  if (pts.length<3) return;
  const trackArray=meshArrayName||'deckMeshes';
  const box =(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const mesh=(geo,mat)=>{ const m=new THREE.Mesh(geo,mat); m.castShadow=m.receiveShadow=true; return m; };
  const worldPts=canvasToWorld(pts,houseL,houseW);
  const minX=Math.min(...worldPts.map(p=>p.x)), maxX=Math.max(...worldPts.map(p=>p.x));
  const minZ=Math.min(...worldPts.map(p=>p.z)), maxZ=Math.max(...worldPts.map(p=>p.z));
  if (maxX-minX<.3||maxZ-minZ<.3) return;

  function ptInPoly(px,pz) {
    let inside=false;
    for(let i=0,j=worldPts.length-1;i<worldPts.length;j=i++){
      const xi=worldPts[i].x,zi=worldPts[i].z,xj=worldPts[j].x,zj=worldPts[j].z;
      if((zi>pz)!==(zj>pz)&&px<(xj-xi)*(pz-zi)/(zj-zi)+xi) inside=!inside;
    }
    return inside;
  }

  const boardW=.14,boardH=.022,gap=.005,joistH=.05,joistW=.05,joistStep=.4,postW=.08,postStep=1.0;
  const boardBot=deckHeight-boardH, joistBot=boardBot-joistH;
  const terraceGroup=new THREE.Group();

  // Опоры
  for(let px=minX+postStep/2;px<=maxX;px+=postStep) {
    for(let pz=minZ+postStep/2;pz<=maxZ;pz+=postStep) {
      if(!ptInPoly(px,pz)) continue;
      const ph=joistBot; if(ph<.05) continue;
      const post=mesh(box(postW,ph,postW),M.post); post.position.set(px,ph/2,pz); terraceGroup.add(post);
    }
  }

  // Лаги
  for(let jz=minZ+joistStep/2;jz<=maxZ;jz+=joistStep) {
    const ix=[];
    for(let i=0,j=worldPts.length-1;i<worldPts.length;j=i++){
      const z1=worldPts[j].z,z2=worldPts[i].z,x1=worldPts[j].x,x2=worldPts[i].x;
      if((z1<=jz&&z2>jz)||(z2<=jz&&z1>jz)) ix.push(x1+(jz-z1)/(z2-z1)*(x2-x1));
    }
    ix.sort((a,b)=>a-b);
    for(let k=0;k<ix.length-1;k+=2){
      const len=ix[k+1]-ix[k]; if(len<.1) continue;
      const j=mesh(box(len,joistH,joistW),M.joist); j.position.set(ix[k]+len/2,joistBot+joistH/2,jz); terraceGroup.add(j);
    }
  }

  // Доски
  for(let bx=minX+boardW/2;bx<=maxX;bx+=boardW+gap){
    const iz=[];
    for(let i=0,j=worldPts.length-1;i<worldPts.length;j=i++){
      const x1=worldPts[j].x,x2=worldPts[i].x,z1=worldPts[j].z,z2=worldPts[i].z;
      if((x1<=bx&&x2>bx)||(x2<=bx&&x1>bx)) iz.push(z1+(bx-x1)/(x2-x1)*(z2-z1));
    }
    iz.sort((a,b)=>a-b);
    for(let k=0;k<iz.length-1;k+=2){
      const len=iz[k+1]-iz[k]; if(len<.05) continue;
      const b=mesh(box(boardW,boardH,len),M.deck); b.position.set(bx,boardBot+boardH/2,iz[k]+len/2);
      terraceGroup.add(b); threeState[trackArray].push(b);
    }
  }

  // Боковые панели (юбка) по периметру — закрываем пространство под настилом
  const skirtT = 0.06; // толщина панели
  for(let i=0;i<worldPts.length;i++){
    const a=worldPts[i],b=worldPts[(i+1)%worldPts.length];
    const sdx=b.x-a.x,sdz=b.z-a.z;
    const segLen=Math.sqrt(sdx*sdx+sdz*sdz); if(segLen<.1)continue;
    const angle=Math.atan2(sdx,sdz);
    const mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
    const skirtH=boardBot; if(skirtH<.03)continue;
    const panel=mesh(box(skirtT,skirtH,segLen),M.deck);
    panel.position.set(mx,skirtH/2,mz);
    panel.rotation.y=angle;
    terraceGroup.add(panel); threeState[trackArray].push(panel);
  }

  parent.add(terraceGroup);
}

// ══════════════════════════════════════════════
// PORCH / PATHS / FENCE / RAILING BUILDERS
// (перенесены из viewer3d.js без изменений)
// ══════════════════════════════════════════════
// Хелпер: поворот UV верхней (+Y) грани BoxGeometry на 90° (swap u↔v).
// BoxGeometry в Three.js r128: 6 граней, у каждой 4 вершины × 2 UV = 8 float.
// Порядок граней: +X, −X, +Y, −Y, +Z, −Z. UV +Y начинаются с offset = 16.
function _rotateBoxTopUV90(geom) {
  const uv = geom.attributes.uv.array;
  const off = 16;
  for (let i = 0; i < 4; i++) {
    const u = uv[off + i * 2];
    const v = uv[off + i * 2 + 1];
    uv[off + i * 2] = v;
    uv[off + i * 2 + 1] = u;
  }
  geom.attributes.uv.needsUpdate = true;
}

// Хелпер: меш из четырёхугольной плоской грани (для щёк лестницы).
function makePolyMesh(vertsXYZ, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertsXYZ, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = m.receiveShadow = true;
  // Двусторонний для надёжности (винайдинг не всегда совпадает с ожидаемой нормалью).
  if (material && material.side === undefined) m.material.side = THREE.DoubleSide;
  return m;
}

// ══════════════════════════════════════════════
// STEPS: лестница по rect-описанию (S.steps).
// Глубина rect в плане игнорируется — пересчитывается на n × stepDepth.
// Опорная сторона (верх лестницы) — та, что ближе всего к ребру террасы
// или дому. Ступени откладываются от неё наружу.
// ══════════════════════════════════════════════
const STEP_RISE = 0.17;        // высота подъёма ступеньки (~170 мм)
const STEP_DEPTH = 0.28;       // глубина шага в плане (~280 мм)
const TREAD_THICKNESS = 0.04;  // толщина доски проступи (40 мм)
const RISER_THICKNESS = 0.025; // толщина листа подступенка (25 мм)
const STEP_NOSING = 0.035;     // свес проступи вперёд от подступенка (35 мм > RISER_THICKNESS)

function buildSteps3d(parent, M, stepsRect, bh, houseL, houseW) {
  if (bh < 0.05) return;
  // Стандартная лестница: n полноценных ступенек, каждая ступенька = подступенок + проступь.
  // Подступенок i — вертикальная стенка от верха «уровня i» (= bh − i·realRise; для i=0
  // это верх террасы) до верха проступи i (= bh − (i+1)·realRise). Высота подступенка
  // = realRise. Подступенок 0 стоит прямо под кромкой террасы — стыковка без зазора,
  // первая проступь лестницы оказывается ровно на одну ступеньку ниже террасы.
  const n = Math.max(1, Math.ceil(bh / STEP_RISE));
  const realRise = bh / n;

  // Углы rect в мировых координатах.
  const rc = canvasToWorld([
    { x: stepsRect.x,                y: stepsRect.y },
    { x: stepsRect.x + stepsRect.w,  y: stepsRect.y },
    { x: stepsRect.x + stepsRect.w,  y: stepsRect.y + stepsRect.h },
    { x: stepsRect.x,                y: stepsRect.y + stepsRect.h },
  ], houseL, houseW);
  const minX = Math.min(rc[0].x, rc[1].x, rc[2].x, rc[3].x);
  const maxX = Math.max(rc[0].x, rc[1].x, rc[2].x, rc[3].x);
  const minZ = Math.min(rc[0].z, rc[1].z, rc[2].z, rc[3].z);
  const maxZ = Math.max(rc[0].z, rc[1].z, rc[2].z, rc[3].z);
  if (maxX - minX < 0.3 || maxZ - minZ < 0.3) return;
  const cxW = (minX + maxX) / 2, czW = (minZ + maxZ) / 2;
  const Wx = maxX - minX, Dz = maxZ - minZ;

  // Собираем «опорные» рёбра — террасные rect'ы + outline дома.
  const supportEdges = [];
  if (S.terraceRects && S.terraceRects.length) {
    for (const tr of S.terraceRects) {
      const tc = canvasToWorld([
        { x: tr.x,        y: tr.y },
        { x: tr.x+tr.w,   y: tr.y },
        { x: tr.x+tr.w,   y: tr.y+tr.h },
        { x: tr.x,        y: tr.y+tr.h },
      ], houseL, houseW);
      for (let i = 0; i < 4; i++) supportEdges.push([tc[i], tc[(i+1)%4]]);
    }
  }
  if (_housePoly && _housePoly.corners) {
    const poly = _housePoly;
    for (let i = 0; i < poly.corners.length; i++) {
      const a = poly.corners[i], b = poly.corners[(i+1) % poly.corners.length];
      supportEdges.push([{ x:a.x, z:a.z }, { x:b.x, z:b.z }]);
    }
  }

  function distToSupports(pt) {
    let best = Infinity;
    for (const [a, b] of supportEdges) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const lenSq = dx*dx + dz*dz;
      if (lenSq < 1e-6) continue;
      let t = ((pt.x - a.x)*dx + (pt.z - a.z)*dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t*dx, pz = a.z + t*dz;
      const d = Math.hypot(pt.x - px, pt.z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  // Точка внутри какого-нибудь террасного rect?
  function insideTerrace(pt) {
    if (!S.terraceRects) return false;
    for (const tr of S.terraceRects) {
      const tc = canvasToWorld([
        { x: tr.x,        y: tr.y },
        { x: tr.x+tr.w,   y: tr.y },
        { x: tr.x+tr.w,   y: tr.y+tr.h },
        { x: tr.x,        y: tr.y+tr.h },
      ], houseL, houseW);
      const a = Math.min(tc[0].x, tc[1].x, tc[2].x, tc[3].x);
      const b = Math.max(tc[0].x, tc[1].x, tc[2].x, tc[3].x);
      const c = Math.min(tc[0].z, tc[1].z, tc[2].z, tc[3].z);
      const d = Math.max(tc[0].z, tc[1].z, tc[2].z, tc[3].z);
      if (pt.x >= a && pt.x <= b && pt.z >= c && pt.z <= d) return true;
    }
    return false;
  }
  // Точка внутри outline дома?
  function insideHouse(pt) {
    if (!_housePoly || !_housePoly.corners) return false;
    const c = _housePoly.corners;
    let inside = false;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const xi = c[i].x, zi = c[i].z, xj = c[j].x, zj = c[j].z;
      if ((zi > pt.z) !== (zj > pt.z)
          && pt.x < (xj - xi) * (pt.z - zi) / (zj - zi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  const isSupported = pt => insideTerrace(pt) || insideHouse(pt);

  // 4 стороны rect. dirX/dirZ указывают НАРУЖУ от опоры (= направление спуска лестницы).
  // Если опора у minZ — лестница идёт в +Z, и т.д.
  // axisAlong — ось, ВДОЛЬ которой идёт ширина лестницы.
  const sides = [
    { id:'N', mid:{ x:cxW, z:minZ }, axisAlong:'X', dirX:0,  dirZ:+1, topX:cxW, topZ:minZ },
    { id:'S', mid:{ x:cxW, z:maxZ }, axisAlong:'X', dirX:0,  dirZ:-1, topX:cxW, topZ:maxZ },
    { id:'W', mid:{ x:minX, z:czW }, axisAlong:'Z', dirX:+1, dirZ:0,  topX:minX,topZ:czW },
    { id:'E', mid:{ x:maxX, z:czW }, axisAlong:'Z', dirX:-1, dirZ:0,  topX:maxX,topZ:czW },
  ];

  // Шаг 1 (приоритет): если для пары противоположных сторон одна mid ВНУТРИ опоры,
  // а другая СНАРУЖИ — опорная = внутренняя; лестница идёт к внешней стороне.
  // Если обе пары удовлетворяют — выбираем пару с большей «уверенностью»
  // (где внешняя mid дальше от опор).
  let bestSide = null, bestConfidence = -1;
  const pairs = [[sides[0], sides[1]], [sides[2], sides[3]]];
  for (const [a, b] of pairs) {
    const ia = isSupported(a.mid), ib = isSupported(b.mid);
    if (ia && !ib) {
      const c = distToSupports(b.mid);
      if (c > bestConfidence) { bestConfidence = c; bestSide = a; }
    } else if (ib && !ia) {
      const c = distToSupports(a.mid);
      if (c > bestConfidence) { bestConfidence = c; bestSide = b; }
    }
  }

  // Шаг 2 (fallback): если ни одна mid не «внутри» (rect вне опор) — берём сторону
  // с минимальным distToSupports.
  if (!bestSide) {
    let bestDist = Infinity;
    for (const s of sides) {
      const d = distToSupports(s.mid);
      if (d < bestDist) { bestDist = d; bestSide = s; }
    }
  }

  // Шаг 3: вообще нет опор — длинная сторона = ширина, ступени идут с короткой.
  if (supportEdges.length === 0) {
    bestSide = (Wx >= Dz) ? sides[1] : sides[3];
  }

  const stairWidth = (bestSide.axisAlong === 'X') ? Wx : Dz;
  // Лестница в плане: последняя проступь (i=n-2) кончается на (n-1)·STEP_DEPTH + STEP_NOSING.
  // Нижний подступенок (i=n-1) идёт прямо на землю, проступи n-1 нет.
  const stairDepth = (n - 1) * STEP_DEPTH + STEP_NOSING;
  const { topX, topZ, dirX, dirZ } = bestSide;

  const matDeck = M.deck;
  const matStep = M.step || matDeck;
  const matPost = M.post || matStep;
  const stairGroup = new THREE.Group();
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };

  // Проступи и подступенки. i=0 — верхняя, i=n-1 — нижняя.
  // Геометрия (Z измеряется от опоры в направлении спуска):
  //   • Подступенок i: вертикальная стенка. Y_top: для i=0 = bh, для i≥1 = низ
  //     проступи i−1 = bh − i·realRise − TREAD_THICKNESS (укороченный — избегаем
  //     z-fighting с верхней плоскостью проступи). Y_bot: для i<n-1 = bh − (i+1)·realRise
  //     (= верх проступи i), для i=n-1 = 0 (земля, нижний подступенок доходит до земли,
  //     над ним нет проступи — спуск сразу на грунт).
  //     В плане — на Z = i·STEP_DEPTH до Z = i·STEP_DEPTH + RISER_THICKNESS.
  //   • Проступь i (i=0..n-2): лежит впереди подступенка i, верх на bh−(i+1)·realRise.
  //     В плане от Z = i·STEP_DEPTH + RISER_THICKNESS до Z = (i+1)·STEP_DEPTH + STEP_NOSING
  //     (с свесом вперёд над следующим подступенком).
  //     ПОСЛЕДНЯЯ ПРОСТУПЬ (i=n-1) НЕ СТРОИТСЯ — нижняя «ступень» = земля.
  const treadLen = STEP_DEPTH + STEP_NOSING - RISER_THICKNESS;
  for (let i = 0; i < n; i++) {
    const isLast = (i === n - 1);
    // Подступенок 0 (между террасой и проступью 0) НЕ строится — кромка террасы
    // с nosing сама закрывает зазор по высоте, а лишняя серая стенка под террасой
    // создаёт визуальный артефакт. Подступенки i≥1 — как обычно (укорочены сверху).
    const skipRiser = (i === 0);
    const yTopRiser = (bh - i * realRise - TREAD_THICKNESS); // (i=0 → bh−TREAD_THICKNESS; используется только для щёк)
    const yBotRiser = isLast ? 0 : (bh - (i + 1) * realRise);

    // ── ПРОСТУПЬ i (не строится для последней ступеньки) ──
    // По длинной стороне проступь шире лестницы на 2·STEP_NOSING — нависает
    // над щёками с обеих сторон так же, как nosing нависает спереди.
    if (!isLast) {
      const yTopTread = bh - (i + 1) * realRise;
      const treadCenterY = yTopTread - TREAD_THICKNESS / 2;
      const treadOffset = i * STEP_DEPTH + RISER_THICKNESS + treadLen / 2;
      const tcx = topX + dirX * treadOffset;
      const tcz = topZ + dirZ * treadOffset;
      const treadWidthWithSide = stairWidth + 2 * STEP_NOSING;
      const dimX = (bestSide.axisAlong === 'X') ? treadWidthWithSide : treadLen;
      const dimZ = (bestSide.axisAlong === 'X') ? treadLen : treadWidthWithSide;
      const tread = mesh(box(dimX, TREAD_THICKNESS, dimZ), matDeck);
      tread.position.set(tcx, treadCenterY, tcz);
      // Доски проступи вдоль ширины лестницы (длинной стороны) — тот же масштаб
      // и проекция, что у террасы. Длинная сторона = stairWidth: вдоль X при
      // axisAlong==='X', иначе вдоль Z.
      //
      // ПОПЕРЁК ступеней UV отсчитываем НЕ от мировой сетки, а от центра проступи:
      // доска ≈ 0.11 м, проступь 0.29 м, шаг лестницы 0.28 м — периоды несоизмеримы,
      // и при мировой проекции шов попадал то на нос, то на пятку, каждый раз
      // по-разному. Смещение (порядка 0.1 м) ставит шов по середине проступи —
      // одинаково на всех ступенях. Вдоль ступени проекция остаётся мировой.
      const uvAnchor = { x: dirX ? -tcx : 0, y: 0, z: dirZ ? -tcz : 0 };
      _applyDeckUV(tread, bestSide.axisAlong === 'X', uvAnchor);
      stairGroup.add(tread);
      threeState.deckMeshes.push(tread);
    }

    // ── ПОДСТУПЕНОК i (i=0 пропускается — см. skipRiser) ──
    if (skipRiser) continue;
    const riserH = yTopRiser - yBotRiser;
    if (riserH < 0.01) continue;
    const riserCenterY = (yTopRiser + yBotRiser) / 2;
    const riserOffset = i * STEP_DEPTH + RISER_THICKNESS / 2;
    const rcx = topX + dirX * riserOffset;
    const rcz = topZ + dirZ * riserOffset;
    const rdimX = (bestSide.axisAlong === 'X') ? stairWidth : RISER_THICKNESS;
    const rdimZ = (bestSide.axisAlong === 'X') ? RISER_THICKNESS : stairWidth;
    // Подступенок — материал ТЕРРАСЫ (M.terraceSide), доски ГОРИЗОНТАЛЬНО:
    // боковые грани box-UV дают именно горизонтальные грувы; ребро UV-бокса — как
    // у боковин террасы (TERRACE_SIDE_TILE), чтобы доска была одного размера.
    //
    // UV по ВЫСОТЕ у каждого подступенка СВОИ, от верхней кромки (TODO.md, этап 1
    // п.9): подступенок ниже доски зашивки (≈0.16 м против 0.17 м), и при мировой
    // проекции шов доски приходился на середину то одной ступени, то другой.
    // Привязка к кромке уводит шов за пределы подступенка — он выходит цельным.
    // По горизонтали проекция остаётся мировой (доска продолжается вдоль ступени).
    const riser = mesh(box(rdimX, riserH, rdimZ), M.terraceSide || matStep);
    riser.position.set(rcx, riserCenterY, rcz);
    if (typeof _applyBoxUV === 'function') {
      _applyBoxUV(riser, TERRACE_SIDE_TILE, { x: 0, y: -(riserCenterY + riserH / 2), z: 0 });
    }
    stairGroup.add(riser);
    threeState.stepMeshes.push(riser);
  }


  // Щёки лестницы — non-convex полигон, повторяющий
  // ВНЕШНИЙ силуэт лестницы с учётом проступей и nosing. Точки лежат в 2D-плоскости
  // (off вдоль направления спуска × Y вертикаль). Триангулируем через ShapeUtils.
  //
  // Силуэт (по часовой стрелке от top-back, в координатах (off, y)):
  //   (0, bh)                                                — top-back, у опоры
  //   (RISER_THICKNESS, bh)                                  — верх передней плоскости подступенка 0
  //   Для i=0..n-1:
  //     (i·D+R, y_bot_riser_i)                               — низ подступенка i
  //     если i < n-1 (есть проступь i): дополнительные точки nosing:
  //       (i·D+R, y_bot_tread_i)                             — задняя нижняя кромка проступи i (внутри подступенка не строится отдельно, совмещаем)
  //       Wait — это та же точка что и выше, если y_bot_riser_i == y_top_tread_i.
  //       Простой профиль:
  //       1: ((i+1)·D + N, y_bot_tread_i)                    — передняя кромка nosing проступи i
  //       2: ((i+1)·D + N, y_bot_tread_i - TREAD_THICKNESS)  — низ nosing
  //       3: ((i+1)·D + R, y_bot_tread_i - TREAD_THICKNESS)  — низ проступи на передней плоскости подступенка i+1
  //   После последней ступени: (0, 0) — задний-низ.
  if (THREE.ShapeUtils && typeof THREE.ShapeUtils.triangulateShape === 'function') {
    for (const lateralSign of [-1, +1]) {
      const latX = (bestSide.axisAlong === 'X') ? (cxW + lateralSign * stairWidth / 2) : null;
      const latZ = (bestSide.axisAlong === 'Z') ? (czW + lateralSign * stairWidth / 2) : null;

      // Строим 2D-контур (off, y), по часовой.
      const points2D = [];
      const addPt = (off, y) => points2D.push(new THREE.Vector2(off, y));

      // Подступенок 0 не строится → щека начинается с верха проступи 0
      // (bh − realRise), а не с уровня террасы. Это убирает «полочку»
      // под террасой и z-fighting в районе nosing террасы.
      const yTop0 = bh - realRise;
      addPt(0, yTop0);                                      // top-back (на уровне верха первой проступи)
      addPt(RISER_THICKNESS, yTop0);                        // верх в районе передней плоскости подступенка 0
      for (let i = 0; i < n; i++) {
        const isLast = (i === n - 1);
        const yBotRiser = isLast ? 0 : (bh - (i + 1) * realRise);
        const offRiserFront = i * STEP_DEPTH + RISER_THICKNESS;
        addPt(offRiserFront, yBotRiser);                    // низ подступенка i

        if (!isLast) {
          // У этой ступени есть проступь — добавляем nosing-зубец:
          const yTopTread = bh - (i + 1) * realRise;
          const yBotTread = yTopTread - TREAD_THICKNESS;
          const offNosing = (i + 1) * STEP_DEPTH + STEP_NOSING;
          const offNextRiserFront = (i + 1) * STEP_DEPTH + RISER_THICKNESS;
          addPt(offNosing, yTopTread);                      // передняя кромка nosing (верх)
          addPt(offNosing, yBotTread);                      // передняя кромка nosing (низ)
          addPt(offNextRiserFront, yBotTread);              // низ проступи у передней плоскости след. подступенка
        }
      }
      addPt(0, 0);                                          // задний-низ

      // ShapeUtils.triangulateShape ожидает CCW порядок; наши точки идут CW —
      // разворачиваем перед триангуляцией.
      const ccw = points2D.slice().reverse();
      const tris = THREE.ShapeUtils.triangulateShape(ccw, []);

      // Конвертируем в 3D. У нас полигон в перевёрнутом порядке (ccw), поэтому
      // индексы тоже относятся к ccw, не к points2D.
      const verts3D = [];
      for (const p of ccw) {
        if (bestSide.axisAlong === 'X') verts3D.push(latX, p.y, topZ + dirZ * p.x);
        else                             verts3D.push(topX + dirX * p.x, p.y, latZ);
      }
      const idx = [];
      for (const tri of tris) idx.push(tri[0], tri[1], tri[2]);

      // UV щеки — как у боковины («юбки») террасы: доски ГОРИЗОНТАЛЬНЫЕ
      // (TODO.md, этап 1 п.8), поэтому V идёт по высоте, а U вдоль спуска.
      // Ребро UV-бокса — TERRACE_SIDE_TILE.
      const TSc = TERRACE_SIDE_TILE;
      const uvs = [];
      for (let k = 0; k < verts3D.length; k += 3) {
        const along = (bestSide.axisAlong === 'X') ? verts3D[k + 2] : verts3D[k];
        uvs.push(along / TSc, verts3D[k + 1] / TSc);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts3D, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const cheekBase = M.terraceSide || matStep;
      const cheekMat = cheekBase.clone ? cheekBase.clone() : new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.85 });
      cheekMat.side = THREE.DoubleSide;
      const cheek = new THREE.Mesh(geo, cheekMat);
      cheek.castShadow = cheek.receiveShadow = true;
      stairGroup.add(cheek);
      threeState.stepMeshes.push(cheek);
    }
  }

  // Перила лестницы (toggle steps-railing) — из того же GLB-модуля, что и ограждение
  // террасы (post / rails / balu_floor). Поручень+нижнее перило идут под РЕЙК (наклон по
  // разнице уровней верх→низ), балясины — вертикальные, нативного сечения, по проступям.
  // Габарит СТУПЕНЕЙ — снимаем ДО постройки перил: подкладка должна лежать под самой
  // лестницей, а не под её перилами. Перила стоят шире ступеней (столбы-ньюэлы плюс
  // вылет крышки), и подкладка по общему bbox выпирала за край веранды (правка
  // 2026-08-30).
  stairGroup.updateMatrixWorld(true);
  const _sbSteps = new THREE.Box3().setFromObject(stairGroup);

  const hasRailing = tgOn('steps-railing');
  if (hasRailing) {
    // Перила лестницы берут тот же модуль, что и ограждение террасы (один товар).
    const _stairRailUrl = (typeof railingModelUrl === 'function') ? railingModelUrl() : null;
    const _stairRailMod = (typeof railingUseModule === 'function') ? railingUseModule(_stairRailUrl) : null;
    // Как и у ограждения террасы: модуля товара может не быть в кэше, тогда активным
    // остаётся прежний. Грузим нужный и пересобираем сцену, когда он появится.
    if (!_stairRailMod && _stairRailUrl && typeof ensureRailingLoaded === 'function') {
      ensureRailingLoaded(_stairRailUrl).then(() => {
        if (threeState && railingUseModule(_stairRailUrl)) buildScene3d();
      });
    }
    const RC = _railingCache;
    if (!(RC && RC.rails && RC.post && RC.baluFloor)) {
      // Модуля пока нет — перила лестницы построятся при пересборке после загрузки.
    } else {
      // latOff: перила сдвинуты от краёв ступеней внутрь (на STAIR_RAIL_INSET) — соосны
      // колонне навеса на углу проёма террасы (см. terracePerimeterSegments).
      const latOff = Math.max(0.10, stairWidth / 2 - STAIR_RAIL_INSET);
      // Перила лестницы всегда из того же материала, что ограждение террасы:
      // это одна конструкция, разные материалы у них выглядели бы ошибкой.
      // _resolveDeckMat подставит текстуры или цвет выбранного товара (S.elementMat.railing).
      // M.railing приходит из buildScene3d уже разрешённым — ровно тот материал,
      // которым строится ограждение террасы (одна база, одни карты). Отдельная база
      // здесь давала другой цвет и блеск: у товара без PBR-текстур клонируется база,
      // а она была своя.
      const stairRailMat = M.railing
        ? M.railing.clone()
        : (typeof _resolveDeckMat === 'function'
            ? _resolveDeckMat(new THREE.MeshStandardMaterial(
                { color: PORCH_COLUMN_COLOR, roughness: 0.72, metalness: 0.04 }), 'railing')
            : new THREE.MeshStandardMaterial({ color: PORCH_COLUMN_COLOR, roughness: 0.72, metalness: 0.04 }));
      stairRailMat.name = 'mat_railing';
      const up = new THREE.Vector3(0, 1, 0);
      // Тот же масштаб по высоте, что у ограждения террасы (столб → RAIL_POST_H),
      // и та же высота низа поручня — перила лестницы стыкуются с террасными.
      const ky = RC.ky || 1;
      const railTopH = RC.baluTopH || (RC.nativeBaluH || 1.055) * ky;
      // UV не трогаем — приходят из GLB (то же решение, что у ограждения террасы).
      const placeGeo = (geo, m4, matOv) => {
        const g = geo.clone(); g.applyMatrix4(m4);
        const mm = mesh(g, matOv || stairRailMat);
        stairGroup.add(mm); threeState.railingMeshes.push(mm);
      };
      // Крышка столба-ньюэла — по тому же правилу, что у ограждения террасы.
      const stairCapType = (typeof railingCapType === 'function') ? railingCapType() : '';
      const stairCapMat = (typeof _railCapMaterial === 'function')
        ? _railCapMaterial(stairRailMat, stairCapType) : stairRailMat;

      for (const lateralSign of [-1, +1]) {
        // Концы перил в плане (верх — у кромки террасы, низ — у последней проступи).
        let topPx, topPz, botPx, botPz;
        if (bestSide.axisAlong === 'X') {
          topPx = cxW + lateralSign * latOff; topPz = topZ;
          botPx = topPx;                       botPz = topZ + dirZ * stairDepth;
        } else {
          topPx = topX;                        topPz = czW + lateralSign * latOff;
          botPx = topX + dirX * stairDepth;    botPz = topPz;
        }
        // Базовая линия ската (через верх террасы → верх последней видимой проступи).
        const P0 = new THREE.Vector3(topPx, bh,       topPz);
        const P1 = new THREE.Vector3(botPx, realRise, botPz);
        const headX = new THREE.Vector3(botPx - topPx, 0, botPz - topPz).normalize(); // горизонт. направление спуска
        const crossH = new THREE.Vector3().crossVectors(headX, up).normalize();

        // Верх продлеваем по скату вглубь террасы до ОСИ столба на линии ограждения
        // (inset RAIL_INSET от кромки) — конец перил прячется в теле стойки на углу
        // проёма (см. STAIR_RAIL_INSET / terracePerimeterSegments), а не висит в воздухе.
        // Раньше добавлялась ещё CANOPY_COL_HALF (расчёт на толстую колонну навеса
        // 0.14 м): у обычной стойки ограждения (~0.1 м) конец выходил насквозь с
        // обратной стороны. До оси — надёжно при любой толщине стойки.
        const slope0 = new THREE.Vector3().subVectors(P1, P0);
        const slopeLen0 = slope0.length() || 1e-6;
        const run = Math.hypot(botPx - topPx, botPz - topPz) || 1e-6;
        const topExt = RAIL_INSET * slopeLen0 / run;
        const u = slope0.clone().multiplyScalar(1 / slopeLen0);       // единичный вектор вниз по скату
        const A = P0.clone().addScaledVector(u, -topExt);             // верх с продлением
        // Низ ПРОДЛЕВАЕМ по скату до земли: P1 лежит на уровне последней проступи
        // (realRise над грунтом), и столб-ньюэл там висел в воздухе — перед лестницей
        // проступей уже нет. Идём по тому же уклону, пока Y не станет 0.
        const B = P1.clone();
        if (u.y < -1e-6 && B.y > 1e-4) B.addScaledVector(u, B.y / -u.y);

        // ── Перила (rails) под рейк: ось X — вдоль ската (наклон), Y — вертикаль (сдвиг) ──
        const slopeVec = new THREE.Vector3().subVectors(B, A);
        const L = slopeVec.length() || 1e-6;
        const xAxis = slopeVec.clone().multiplyScalar(1 / L);
        const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
        const mRail = new THREE.Matrix4().makeBasis(xAxis, up, zAxis);
        mRail.setPosition(A.x, A.y, A.z);
        mRail.multiply(new THREE.Matrix4().makeScale(L, ky, 1));       // длина ската × высота модуля
        placeGeo(RC.rails, mRail);

        // ── Нижний столб-ньюэл (post), вертикальный, стоит НА ЗЕМЛЕ (B продлён до Y=0) ──
        // Сечение — как у столбов ограждения террасы: это один товар, поэтому
        // берётся из него же (S.railPostW, мм), а не из фильтра каталога.
        const postK = (typeof S !== 'undefined' && S.railPostW) ? S.railPostW / 100 : 1;
        const mPost = new THREE.Matrix4().makeBasis(headX, up, crossH);
        mPost.setPosition(B.x, B.y, B.z);
        mPost.multiply(new THREE.Matrix4().makeScale(postK, ky, postK));
        placeGeo(RC.post, mPost);
        if (RC.cap) placeGeo(RC.cap, mPost, stairCapMat);

        // ── Балясины по видимым проступям (i=0..n-2): вертикальные, нативное сечение,
        //    высота по уровню (от проступи до поручня) — учитывает разницу уровней ──
        for (let i = 0; i < n - 1; i++) {
          const off = i * STEP_DEPTH + (RISER_THICKNESS + STEP_DEPTH + STEP_NOSING) / 2; // центр проступи i
          const t = off / stairDepth;
          const bx = topPx + (botPx - topPx) * t;
          const bz = topPz + (botPz - topPz) * t;
          const surfY = bh - (i + 1) * realRise;            // верх проступи i
          const baseLineY = bh + (realRise - bh) * t;       // линия ската на этой проступи
          const baluH = (baseLineY + railTopH) - surfY;     // до низа поручня (как в секции террасы)
          if (baluH < 0.1) continue;
          const mBal = new THREE.Matrix4().makeBasis(headX, up, crossH);
          mBal.setPosition(bx, surfY, bz);
          mBal.multiply(new THREE.Matrix4().makeScale(1, baluH / 1.055, 1)); // тянем ТОЛЬКО по высоте
          placeGeo(RC.baluFloor, mBal);
        }
      }
    }
  }

  parent.add(stairGroup);

  // Подкладка (отмостка) под ступенями — по РЕАЛЬНОМУ footprint лестницы (bbox stairGroup),
  // а не по drawn-rect S.steps: его глубину buildSteps3d игнорирует (пересчитывает на
  // n × stepDepth), из-за чего pad по drawn-rect торчал за лестницу.
  const _sb = _sbSteps;
  if (isFinite(_sb.min.x) && _sb.max.x > _sb.min.x) {
    // Запас подкладки только ВДОЛЬ СПУСКА: вбок она упиралась бы в край веранды и
    // выпирала из-под неё (правка 2026-08-30). Ось спуска — поперёк опорного ребра.
    const padOff = (bestSide.axisAlong === 'X') ? { x: 0, z: PAD_OFFSET }
                                                : { x: PAD_OFFSET, z: 0 };
    buildConstructionPad(parent, _sb.min.x, _sb.max.x, _sb.min.z, _sb.max.z, padOff);
  }
}

function buildPorch3d(parent,M,porch,houseL,houseW,bh){
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const mesh=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  // Учитываем bbox.minX/minZ полигона (для крест/T/L-форм) — те же сдвиги, что и в canvasToWorld.
  const gridSize=GRID,offsetX=(gridSize-houseL)/2,offsetZ=(gridSize-houseW)/2;
  const px=porch.x*gridSize-offsetX+_houseBboxMinX,pz=porch.y*gridSize-offsetZ+_houseBboxMinZ,pw=porch.w*gridSize,pd=porch.h*gridSize;
  if(pw<.2||pd<.2)return;
  const porchGroup=new THREE.Group();
  const cx=px+pw/2,cz=pz+pd/2;
  // Расстояние до краёв bbox дома (в мире: minX..minX+houseL по X, minZ..minZ+houseW по Z).
  const houseMinX=_houseBboxMinX, houseMaxX=_houseBboxMinX+houseL;
  const houseMinZ=_houseBboxMinZ, houseMaxZ=_houseBboxMinZ+houseW;
  // Выбор стены для крыльца: предпочитаем ту, которая ПАРАЛЛЕЛЬНА более длинной
  // стороне прямоугольника крыльца. Это правильная архитектурная ориентация —
  // длинная сторона крыльца идёт ВДОЛЬ стены дома, ступени — в перпендикулярном
  // направлении. Раньше выбирали просто ближайшую стену, из-за чего «глубокий-узкий»
  // прямоугольник, оказавшийся ближе к перпендикулярной стене, разворачивался
  // боком к террасе/двери.
  const candidates = [
    { sDX: 0, sDZ:  1, dist: Math.abs(cz - houseMaxZ), wallAlongX: true  }, // S wall
    { sDX: 0, sDZ: -1, dist: Math.abs(cz - houseMinZ), wallAlongX: true  }, // N wall
    { sDX:  1, sDZ: 0, dist: Math.abs(cx - houseMaxX), wallAlongX: false }, // E wall
    { sDX: -1, sDZ: 0, dist: Math.abs(cx - houseMinX), wallAlongX: false }, // W wall
  ];
  // pw — размер крыльца по X, pd — по Z. Если pw >= pd, длинная сторона по X,
  // значит стена тоже должна быть по X (wallAlongX = true), и ступени идут по Z.
  const wantWallAlongX = pw >= pd;
  candidates.sort((a, b) => {
    const aMatch = a.wallAlongX === wantWallAlongX ? 0 : 1;
    const bMatch = b.wallAlongX === wantWallAlongX ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;     // правильная ориентация выше
    return a.dist - b.dist;                            // среди равных — ближайшая
  });
  const sDX = candidates[0].sDX, sDZ = candidates[0].sDZ;
  const stepH=.17,stepD=.28,boardH=.022,nSteps=Math.max(1,Math.round(bh/stepH)),aStepH=bh/nSteps;
  const boardW=.14,gap=.005;
  const nosOver=.025,nosThick=.04;  // выступ проступи и её толщина
  // Отдельные доски настила больше НЕ рисуем — их заменила цельная верхняя
  // плита крыльца (см. выше).
  // Цикл ступеней — i=1..nSteps-1 (видимые ступени НИЖЕ крыльца). i=0 (на уровне
  // крыльца) перекрывается верхней плитой и не нужен. Последняя ступень (i=nSteps-1)
  // имеет проступь на aStepH над землёй; вертикальный спуск до земли закрыт щекой.
  for(let i=1;i<nSteps;i++){
    const treadTop = bh - i * aStepH;        // верх проступи этой ступени
    const yBodyTop = treadTop - nosThick;     // верх тела ступени (под проступью)
    const yBot = yBodyTop - (aStepH - nosThick); // низ тела = верх проступи предыдущей ступени
    const stepEps = 0.01; // inset, чтобы избежать z-fighting с щёками
    let sx,sz,sxP,szP;
    if(sDZ!==0){sx=pw - 2*stepEps;sz=stepD;sxP=px+pw/2;szP=sDZ>0?(pz+pd+i*stepD+stepD/2):(pz-i*stepD-stepD/2);}
    else{sx=stepD;sz=pd - 2*stepEps;szP=pz+pd/2;sxP=sDX>0?(px+pw+i*stepD+stepD/2):(px-i*stepD-stepD/2);}
    // Тело ступени (подступенок) — серый
    const bodyH = yBodyTop - yBot;
    const s=mesh(box(sx,bodyH,sz),M.step);
    s.position.set(sxP, (yBot + yBodyTop)/2, szP);
    porchGroup.add(s);threeState.stepMeshes.push(s);
    // Проступь — deck-плита толщиной nosThick, сверху тела ступени, с выступом
    // по передней кромке и боковым кромкам.
    let nosSx, nosSz, nosX, nosZ;
    if (sDZ !== 0) {
      nosSx = sx + 2 * nosOver;
      nosSz = sz + nosOver;
      nosX = sxP;
      nosZ = szP + sDZ * (nosOver / 2);
    } else {
      nosSx = sx + nosOver;
      nosSz = sz + 2 * nosOver;
      nosX = sxP + sDX * (nosOver / 2);
      nosZ = szP;
    }
    const nosGeo = box(nosSx, nosThick, nosSz);
    if (sDX !== 0) _rotateBoxTopUV90(nosGeo);
    const nos = mesh(nosGeo, M.deck);
    nos.position.set(nosX, treadTop - nosThick/2, nosZ);
    porchGroup.add(nos); threeState.stepMeshes.push(nos);
  }
  // Тело крыльца (сплошная плита под верхней «плитой настила») — от земли
  // до низа deck-плиты (на nosThick ниже верха крыльца). Расширяется в направлении
  // ступеней на stepD, чтобы заполнить область «шага 0» под передним свесом плиты.
  // Материал ступени (серый).
  // Лёгкий inset (eps) в направлении, перпендикулярном ступеням — щёки тоже лежат
  // в плоскостях px / px+pw (или pz / pz+pd), без inset было z-fighting.
  {
    const bodyT = bh - nosThick;
    const eps = 0.01;
    if (bodyT > 0.02) {
      let bodyX, bodyZ, bodyCX, bodyCZ;
      if (sDZ !== 0) {
        bodyX = pw - 2 * eps;
        bodyZ = pd + stepD;
        bodyCX = px + pw / 2;
        const backZ = (sDZ > 0) ? pz : (pz + pd);
        bodyCZ = backZ + sDZ * bodyZ / 2;
      } else if (sDX !== 0) {
        bodyX = pw + stepD;
        bodyZ = pd - 2 * eps;
        bodyCZ = pz + pd / 2;
        const backX = (sDX > 0) ? px : (px + pw);
        bodyCX = backX + sDX * bodyX / 2;
      } else {
        bodyX = pw - 2 * eps; bodyZ = pd - 2 * eps;
        bodyCX = px + pw / 2; bodyCZ = pz + pd / 2;
      }
      const body = mesh(box(bodyX, bodyT, bodyZ), M.step);
      body.position.set(bodyCX, bodyT/2, bodyCZ);
      porchGroup.add(body); threeState.porchMeshes.push(body);
    }
  }
  // Верхняя плита крыльца — единая deck-плита толщиной nosThick на уровне
  // проступи верхней ступени (y от bh−nosThick до bh).
  // Свес:
  //   • по обеим перпендикулярным к ступеням сторонам — nosOver;
  //   • в направлении ступеней — выходит над «шагом 0» (pd ... pd+stepD)
  //     плюс ещё nosOver сверху;
  //   • с тыльной стороны (у дома) свеса нет.
  {
    let plateX, plateZ, plateCX, plateCZ;
    if (sDZ !== 0) {
      plateX = pw + 2 * nosOver;
      plateZ = pd + stepD + nosOver;
      plateCX = px + pw / 2;
      const backZ = (sDZ > 0) ? pz : (pz + pd);
      plateCZ = backZ + sDZ * plateZ / 2;
    } else {
      plateX = pw + stepD + nosOver;
      plateZ = pd + 2 * nosOver;
      plateCZ = pz + pd / 2;
      const backX = (sDX > 0) ? px : (px + pw);
      plateCX = backX + sDX * plateX / 2;
    }
    const plateGeo = box(plateX, nosThick, plateZ);
    // Если крыльцо у Z-стены (sDX != 0) — длинная ось плиты вдоль Z, но UV-«доски»
    // деки по умолчанию идут вдоль X. Поворачиваем UV на 90°, чтобы доски
    // легли вдоль длинной оси плиты (= параллельно стене дома).
    if (sDX !== 0) _rotateBoxTopUV90(plateGeo);
    const plate = mesh(plateGeo, M.deck);
    plate.position.set(plateCX, bh - nosThick/2, plateCZ);
    porchGroup.add(plate); threeState.porchMeshes.push(plate);
  }

  // Боковины крыльца + щёки лестницы — ОДНИМ полигоном вдоль каждой боковой стороны.
  // Полигон в плоскости (u, v): u=−pd (задняя кромка крыльца у дома) → u=0 (передняя
  // кромка, где начинаются ступени) → u=stairsRun (низ лестницы).
  // v=0 — земля, v=bh−nosThick — тело крыльца/ступеней (под проступями).
  // Материал — M.step (как ступени). Заменяет отдельные «юбки» и плоские щёки.
  {
    const stairsRun = nSteps * stepD;
    const cheekMat = M.step || M.deck;
    const pts2D = [];
    pts2D.push([-pd, 0]);                 // задняя нижняя (у дома, на земле)
    pts2D.push([-pd, bh - nosThick]);     // задняя верхняя (под проступью платформы)
    pts2D.push([stepD, bh - nosThick]);   // верх тела платформы (у первой ступени)
    for (let i = 1; i < nSteps; i++) {
      const bodyTopY = bh - i * aStepH - nosThick;
      pts2D.push([stepD + (i - 1) * stepD, bodyTopY]);
      pts2D.push([stepD +  i      * stepD, bodyTopY]);
    }
    pts2D.push([stepD + (nSteps - 1) * stepD, 0]); // спуск к земле на передней грани нижней ступени
    // Триангулируем
    const shapePts = pts2D.map(p => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(shapePts, []);
    function uToWorld(u, v, fixedVal) {
      if (sDZ !== 0) {
        return [fixedVal, v, (sDZ > 0 ? (pz + pd) : pz) + sDZ * u];
      } else {
        return [(sDX > 0 ? (px + pw) : px) + sDX * u, v, fixedVal];
      }
    }
    const sides = (sDZ !== 0) ? [px, px + pw] : [pz, pz + pd];
    for (const fixedVal of sides) {
      const positions = [];
      for (const p of pts2D) {
        const w = uToWorld(p[0], p[1], fixedVal);
        positions.push(w[0], w[1], w[2]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const indices = [];
      for (const t of tris) indices.push(t[0], t[1], t[2]);
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const matCheek = cheekMat.clone ? cheekMat.clone() : new THREE.MeshStandardMaterial({ color: 0xb8b3aa, roughness: 0.85 });
      matCheek.side = THREE.DoubleSide;
      const cheek = new THREE.Mesh(geo, matCheek);
      cheek.castShadow = cheek.receiveShadow = true;
      porchGroup.add(cheek); threeState.stepMeshes.push(cheek);
    }
  }
  // Задняя стенка крыльца (та, что у дома) — в материале ступени.
  const sideW = .06;
  if (sDZ !== 0) {
    const fz = sDZ > 0 ? pz : (pz + pd);
    const fs = mesh(box(pw, bh, sideW), M.step);
    fs.position.set(px + pw/2, bh/2, fz);
    porchGroup.add(fs); threeState.porchMeshes.push(fs);
  } else {
    const fx = sDX > 0 ? px : (px + pw);
    const fs = mesh(box(sideW, bh, pd), M.step);
    fs.position.set(fx, bh/2, pz + pd/2);
    porchGroup.add(fs); threeState.porchMeshes.push(fs);
  }

  // ── Навес и перила — по toggle'ам в canvas-редакторе крыльца ─────────────
  const hasCanopy  = tgOn('porch-canopy');
  const hasRailing = tgOn('porch-railing');
  const matCanopy = M.roof   || M.deck;
  const matRail   = M.deck   || M.step;
  const matPost   = M.post   || M.step;
  // Общий отступ колонн / перил / ограждения от внешней кромки крыльца внутрь.
  // 1) колонны навеса перестают свисать наружу,
  // 2) балясины наклонных перил больше не упираются в щёки лестницы (они на тех же
  //    X/Z, что и щёки — без отступа происходил z-fight и они «торчали»).
  const porchInset = 0.12;

  // Перила: на двух «боковых» сторонах крыльца (без той, где ступени, и без той, что у дома).
  // Плюс наклонные перила вдоль ступеней.
  if (hasRailing) {
    const railH = 0.95;        // высота поручня от пола крыльца
    const handTop = bh + railH;
    const handT = 0.05;        // толщина поручня
    const balW = 0.04, balStep = 0.15;
    // sDZ!=0: ступени вдоль ±Z; перила на сторонах px (Xmin) и px+pw (Xmax).
    // sDX!=0: симметрично, перила на сторонах pz (Zmin) и pz+pd (Zmax).
    // Концы перил сдвинуты внутрь на porchInset, чтобы стыковаться с колоннами,
    // которые тоже сдвинуты внутрь от внешней кромки крыльца.
    const sides = (sDZ !== 0)
      ? [
          { id:'Xmin', a:{x:px + porchInset,        z:pz + porchInset}, b:{x:px + porchInset,        z:pz+pd - porchInset} },
          { id:'Xmax', a:{x:px+pw - porchInset,     z:pz + porchInset}, b:{x:px+pw - porchInset,     z:pz+pd - porchInset} },
        ]
      : [
          { id:'Zmin', a:{x:px + porchInset,        z:pz + porchInset},    b:{x:px+pw - porchInset, z:pz + porchInset} },
          { id:'Zmax', a:{x:px + porchInset,        z:pz+pd - porchInset}, b:{x:px+pw - porchInset, z:pz+pd - porchInset} },
        ];
    for (const s of sides) {
      const dxs = s.b.x - s.a.x, dzs = s.b.z - s.a.z;
      const len = Math.hypot(dxs, dzs); if (len < 0.05) continue;
      const ang = Math.atan2(dxs, dzs);
      const cxR = (s.a.x + s.b.x)/2, czR = (s.a.z + s.b.z)/2;
      // Поручень
      const handMesh = mesh(box(handT, handT, len), matRail);
      handMesh.position.set(cxR, handTop, czR);
      handMesh.rotation.y = ang;
      porchGroup.add(handMesh); threeState.porchMeshes.push(handMesh);
      // Балясины (с шагом ~15 см, отступая от концов чтобы не наезжать на колонны)
      const margin = 0.18;
      const n = Math.max(2, Math.floor((len - 2*margin) / balStep));
      const usableLen = len - 2*margin;
      const ux = dxs / len, uz = dzs / len;
      for (let i = 0; i <= n; i++) {
        const t = margin + (n > 0 ? i * usableLen / n : 0);
        const bxR = s.a.x + ux * t, bzR = s.a.z + uz * t;
        const baluY = (bh + handTop) / 2;
        const baluH = handTop - bh;
        const balu = mesh(box(balW, baluH, balW), matPost);
        balu.position.set(bxR, baluY, bzR);
        porchGroup.add(balu); threeState.porchMeshes.push(balu);
      }
    }
    // Наклонные перила вдоль ступеней (на тех же боковых сторонах, что и платформа-перила).
    // Верхний конец — у колонны (sides[].a/b — уже с учётом porchInset). Нижний конец
    // получается экстраполяцией вдоль направления ступеней на stairsRun.
    const stairsRun = nSteps * stepD;
    for (const s of sides) {
      let topX, topZ, botX, botZ;
      if (sDZ !== 0) {
        const xSide = s.a.x; // уже px+porchInset или px+pw-porchInset
        topX = xSide;
        topZ = (sDZ > 0) ? (pz + pd - porchInset) : (pz + porchInset);
        botX = xSide;
        botZ = topZ + sDZ * stairsRun;
      } else {
        const zSide = s.a.z; // уже pz+porchInset или pz+pd-porchInset
        topZ = zSide;
        topX = (sDX > 0) ? (px + pw - porchInset) : (px + porchInset);
        botZ = zSide;
        botX = topX + sDX * stairsRun;
      }
      const topY = handTop;        // на уровне поручня крыльца
      const botY = railH;          // ~95 см над землёй у нижней ступени
      const dxR = botX - topX, dzR = botZ - topZ, dyR = botY - topY;
      const rakeLen = Math.hypot(dxR, dyR, dzR);
      if (rakeLen < 0.1) continue;
      const cxR = (topX + botX)/2, cyR = (topY + botY)/2, czR = (topZ + botZ)/2;
      // Поручень — наклонный брус. BoxGeometry(handT, handT, rakeLen) — длинная ось вдоль Z.
      // После lookAt(botX, botY, botZ) локальная -Z смотрит на bot, длина бруса легла
      // на линию top-bot. Дополнительных вращений не нужно.
      const handR = mesh(box(handT, handT, rakeLen), matRail);
      handR.position.set(cxR, cyR, czR);
      handR.lookAt(botX, botY, botZ);
      porchGroup.add(handR); threeState.porchMeshes.push(handR);
      // Балясины по ступеням: одна на каждой ступени
      for (let i = 1; i <= nSteps; i++) {
        const t = i / nSteps;
        const bxR = topX + dxR * t, bzR = topZ + dzR * t;
        // Земля на этой позиции: ступенька i снизу = высота bh - i * aStepH (верх ступени)
        const stepTopY = bh - i * aStepH;
        const handYAt = topY + dyR * t;
        const baluCenterY = (stepTopY + handYAt) / 2;
        const baluH = handYAt - stepTopY;
        if (baluH < 0.05) continue;
        const balu = mesh(box(balW, baluH, balW), matPost);
        balu.position.set(bxR, baluCenterY, bzR);
        porchGroup.add(balu); threeState.porchMeshes.push(balu);
      }
    }
  }

  // Навес: 2 колонны со стороны ступеней; плита, опирающаяся на колонны спереди
  // и заходящая на стену дома сзади. Уклон: передняя кромка (над ступенями) ниже
  // задней (у стены) — слив воды от дома.
  if (hasCanopy) {
    const canopyClear = 2.30;            // высота низа навеса над передней (передней) кромкой крыльца
    const canopySlope = 0.30;            // подъём задней кромки относительно передней
    const colT = 0.14;                   // сечение колонны
    const canopyT = 0.06;                // толщина плиты навеса
    const canopyOver = 0.12;             // вылет навеса за переднюю кромку (за колонны)
    const canopySideOver = 0.10;         // боковой свес навеса за крайние колонны
    // Колонны: только 2, на «передней» (со стороны ступеней) стороне крыльца,
    // сдвинутые от наружного края крыльца внутрь на porchInset — чтобы не свисали наружу.
    let cols;
    if (sDZ !== 0) {
      const zFront = (sDZ > 0) ? (pz + pd - porchInset) : (pz + porchInset);
      cols = [
        { x: px + porchInset,      z: zFront },
        { x: px + pw - porchInset, z: zFront },
      ];
    } else {
      const xFront = (sDX > 0) ? (px + pw - porchInset) : (px + porchInset);
      cols = [
        { x: xFront, z: pz + porchInset },
        { x: xFront, z: pz + pd - porchInset },
      ];
    }
    const useGlb = (typeof HouseBuilder !== 'undefined'
                    && HouseBuilder.placeScaledGlb
                    && _houseCache.modules
                    && _houseCache.modules.porch_column);
    for (const c of cols) {
      if (useGlb) {
        HouseBuilder.placeScaledGlb(
          porchGroup, _houseCache.modules, 'porch_column',
          colT, canopyClear, colT,
          c.x, bh + canopyClear / 2, c.z,
          0, 'mat_porch_column', PORCH_COLUMN_COLOR
        );
      } else {
        const colMesh = mesh(box(colT, canopyClear, colT), matPost);
        colMesh.position.set(c.x, bh + canopyClear / 2, c.z);
        porchGroup.add(colMesh); threeState.porchMeshes.push(colMesh);
      }
    }
    // Плита навеса: полностью закрывает крыльцо (pw × pd в плане) + боковой свес
    // canopySideOver со всех сторон + дополнительный фронтальный вылет canopyOver
    // на стороне ступеней. Размеры задаются ЯВНО в мировых осях X и Z (раньше путались
    // «along»/«depth» когда крыльцо стояло на разных фасадах).
    const canopyXSize = pw + 2 * canopySideOver + (sDX !== 0 ? canopyOver : 0);
    const canopyZSize = pd + 2 * canopySideOver + (sDZ !== 0 ? canopyOver : 0);
    // Центр плиты: центр крыльца + смещение на половину фронтального вылета в сторону ступеней.
    const canopyCX = px + pw / 2 + (sDX !== 0 ? sDX * canopyOver / 2 : 0);
    const canopyCZ = pz + pd / 2 + (sDZ !== 0 ? sDZ * canopyOver / 2 : 0);
    // Высота центра: между фронтальной (низкой) и задней (высокой) кромками.
    const frontY = bh + canopyClear;
    const backY  = frontY + canopySlope;
    const centerY = (frontY + backY) / 2;
    const canopy = mesh(box(canopyXSize, canopyT, canopyZSize), matCanopy);
    canopy.position.set(canopyCX, centerY + canopyT / 2, canopyCZ);
    // Наклон: фронтальная (со стороны ступеней) кромка ниже, задняя (у дома) выше.
    // Длина наклонной поверхности = размер плиты в направлении ступеней.
    if (sDZ !== 0) {
      // sDZ=+1: +Z ниже → rotation.x = +tilt (вершина +Z уходит в −Y).
      const tilt = Math.atan2(canopySlope, canopyZSize);
      canopy.rotation.x = sDZ * tilt;
    } else if (sDX !== 0) {
      // sDX=+1: +X ниже → rotation.z = −tilt (вершина +X уходит в −Y).
      const tilt = Math.atan2(canopySlope, canopyXSize);
      canopy.rotation.z = -sDX * tilt;
    }
    porchGroup.add(canopy); threeState.porchMeshes.push(canopy);
  }

  // Поднимаем всю группу крыльца на 1 см, чтобы не было z-fighting с фундаментной
  // плитой / землёй (которые тоже на y=0).
  porchGroup.position.y = 0.01;
  parent.add(porchGroup);
}

// Смещение полилинии (world {x,z}) на halfW в обе стороны со стыками-миттерами на углах
// (как у навеса террасы). Возвращает левую и правую кромки ленты.
function _offsetPolyline(pts, halfW) {
  const n = pts.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i+1].x - pts[i].x, dz = pts[i+1].z - pts[i].z;
    const L = Math.hypot(dx, dz) || 1;
    segN.push({ x: -dz / L, z: dx / L });                 // левая нормаль сегмента
  }
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    let nx, nz;
    if (i === 0)            { nx = segN[0].x;     nz = segN[0].z; }
    else if (i === n - 1)   { nx = segN[n-2].x;   nz = segN[n-2].z; }
    else {                                                // внутренний угол → миттер
      const a = segN[i-1], b = segN[i];
      let mx = a.x + b.x, mz = a.z + b.z;
      const mL = Math.hypot(mx, mz) || 1; mx /= mL; mz /= mL;
      const cos = Math.max(mx * b.x + mz * b.z, 0.34);    // лимит миттера (не даём «шипам» расти)
      const k = Math.min(1 / cos, 3);
      nx = mx * k; nz = mz * k;
    }
    left.push ({ x: pts[i].x + nx * halfW, z: pts[i].z + nz * halfW });
    right.push({ x: pts[i].x - nx * halfW, z: pts[i].z - nz * halfW });
  }
  return { left, right };
}

// Монолитная лента-настил по левой/правой кромкам (как terrace box, но вдоль полилинии).
// Доски (перекладины) идут ПОПЕРЁК дорожки, СТРОГО ⟂ локальной осевой каждого сегмента.
// Ключ: каждый сегмент строится своими вершинами, а UV-координата V — это ПРОЕКЦИЯ точки
// на ось ИМЕННО этого сегмента (а не накопленная длина по миттер-трапеции). По центру V
// совпадает с накопленной длиной → планки выровнены на стыке, а к кромкам угла образуется
// чистый миттер-шов (без «ёлочки»/скоса). DoubleSide — winding для видимости не важен.
function _buildPathRibbon(parent, left, right, yBot, yTop, pathW, mat, meshArray) {
  const n = left.length; if (n < 2) return;
  const T = DECK_TILE, crossU = pathW / T;
  const ctr = [], runs = [0];                         // осевая + накопленная длина
  for (let i = 0; i < n; i++) ctr.push({ x: (left[i].x + right[i].x) / 2, z: (left[i].z + right[i].z) / 2 });
  for (let i = 1; i < n; i++) runs.push(runs[i - 1] + Math.hypot(ctr[i].x - ctr[i - 1].x, ctr[i].z - ctr[i - 1].z));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < n - 1; i++) {
    let dx = ctr[i + 1].x - ctr[i].x, dz = ctr[i + 1].z - ctr[i].z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;          // направление сегмента
    const vOf = p => (runs[i] + (p.x - ctr[i].x) * dx + (p.z - ctr[i].z) * dz) / T;  // проекция на ось сегмента
    const pts = [left[i], right[i], left[i + 1], right[i + 1]];   // 0=LT,1=RT,2=LT2,3=RT2
    const us  = [0, crossU, 0, crossU];
    const b = pos.length / 3;
    for (let j = 0; j < 4; j++) { pos.push(pts[j].x, yTop, pts[j].z); uv.push(us[j], vOf(pts[j])); } // верх b+0..3
    for (let j = 0; j < 4; j++) { pos.push(pts[j].x, yBot, pts[j].z); uv.push(us[j], vOf(pts[j])); } // низ  b+4..7
    const LT = b, RT = b + 1, LT2 = b + 2, RT2 = b + 3, LB = b + 4, RB = b + 5, LB2 = b + 6, RB2 = b + 7;
    idx.push(LT, RT, LT2,  RT, RT2, LT2);   // верх
    idx.push(LB, LB2, RB,  RB, LB2, RB2);   // низ
    idx.push(LT, LT2, LB,  LB, LT2, LB2);   // левая кромка
    idx.push(RT, RB, RT2,  RT2, RB, RB2);   // правая кромка
    if (i === 0)     idx.push(LT, LB, RT,  RT, LB, RB);          // торец начала
    if (i === n - 2) idx.push(LT2, RT2, LB2,  RT2, RB2, LB2);    // торец конца
  }
  // Разворот треугольников → наружные нормали (верх +Y), корректный normalMap (как было).
  for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  if (meshArray && threeState[meshArray]) threeState[meshArray].push(m);
}

// Тримминг T-стыков: если КОНЕЦ линии упирается в ВНУТРЕННОСТЬ ребра другой линии
// (ответвление), укорачиваем этот конец так, чтобы он встал на ближний край той дорожки
// (на полуширину для перпендикулярного стыка) — лента примыкает, а не перекрывает.
// Возвращает копии линий с поправленными концами. Концы у концов ребра (продолжение
// дорожки) и свободные концы не трогаем.
function _trimPathJunctions(lines, halfW) {
  const out = lines.map(wp => wp.map(p => ({ x: p.x, z: p.z })));
  for (let li = 0; li < out.length; li++) {
    const wp = out[li];
    for (const endIdx of [0, wp.length - 1]) {
      const E = wp[endIdx];
      const nb = (endIdx === 0) ? wp[1] : wp[wp.length - 2];   // соседняя точка (внутрь линии)
      let dx = nb.x - E.x, dz = nb.z - E.z; const segLen = Math.hypot(dx, dz) || 1; dx /= segLen; dz /= segLen;
      let bestTrim = 0;
      for (let lj = 0; lj < lines.length; lj++) {
        if (lj === li) continue;
        const oth = lines[lj];
        for (let k = 0; k < oth.length - 1; k++) {
          const s0 = oth[k], s1 = oth[k + 1];
          const sx = s1.x - s0.x, sz = s1.z - s0.z, sl2 = sx * sx + sz * sz; if (sl2 < 1e-9) continue;
          const t = ((E.x - s0.x) * sx + (E.z - s0.z) * sz) / sl2;
          if (t < 0.05 || t > 0.95) continue;                 // только интерьер ребра (не его концы)
          const cx = s0.x + t * sx, cz = s0.z + t * sz;
          if (Math.hypot(E.x - cx, E.z - cz) > halfW + 0.05) continue;  // конец вне дорожки — не стык
          // укоротить вдоль d до ближнего края (perp = halfW на стороне подхода)
          const sl = Math.sqrt(sl2), nx = -sz / sl, nz = sx / sl;       // нормаль ребра
          const curr = (E.x - s0.x) * nx + (E.z - s0.z) * nz;           // знаковая перп-дистанция
          const rate = dx * nx + dz * nz;                              // d·n
          if (Math.abs(rate) < 1e-6) continue;
          const side = (Math.abs(curr) < 1e-6) ? Math.sign(rate || 1) : Math.sign(curr);
          const trim = (side * halfW - curr) / rate;
          if (trim > bestTrim) bestTrim = trim;
        }
      }
      bestTrim = Math.min(bestTrim, segLen - 0.05);
      if (bestTrim > 1e-4) { E.x += dx * bestTrim; E.z += dz * bestTrim; }
    }
  }
  return out;
}

// Вычесть из набора интервалов [0..1] другой набор.
function _subtractRanges(keep, cuts) {
  let out = keep;
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [k0, k1] of out) {
      if (c1 <= k0 || c0 >= k1) { next.push([k0, k1]); continue; }   // не пересекаются
      if (c0 > k0) next.push([k0, Math.min(c0, k1)]);
      if (c1 < k1) next.push([Math.max(c1, k0), k1]);
    }
    out = next.filter(([a, b]) => b - a > 1e-6);
  }
  return out;
}

// Полотно дорожки как замкнутый полигон (левый борт вперёд + правый назад).
function _pathRibbonPoly(wp, halfW) {
  const { left, right } = _offsetPolyline(wp, halfW);
  return [right[0], ...left, ...right.slice(1).reverse()];
}

// Осевые линии дорожек, разрезанные там, где их накрывает полотно ДРУГОЙ дорожки
// (TODO п.7). Нужно смете: пересечение попадало в неё дважды — один раз от каждой
// дорожки. Куски, накрытые более ранней линией, просто выбрасываются: площадь там
// уже посчитана, а физически это одно и то же покрытие.
// Ответвления (T-стыки) подрезаются, как и в 3D, тем же _trimPathJunctions.
function pathLinesNoOverlap(lines, halfW) {
  if (typeof _offsetPolyline !== 'function') return lines;
  const trimmed = _trimPathJunctions(lines, halfW);
  const ribbons = trimmed.map(wp => _pathRibbonPoly(wp, halfW));
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const out = [];
  trimmed.forEach((wp, i) => {
    if (i === 0) { out.push(wp); return; }
    let cur = null, openEnd = false;
    const flush = () => {
      if (cur && cur.length >= 2) {
        let L = 0;
        for (let k = 1; k < cur.length; k++) L += Math.hypot(cur[k].x - cur[k-1].x, cur[k].z - cur[k-1].z);
        if (L > 0.05) out.push(cur);
      }
      cur = null;
    };
    for (let k = 0; k < wp.length - 1; k++) {
      const a = wp[k], b = wp[k + 1];
      let keep = [[0, 1]];
      for (let j = 0; j < i; j++) {
        keep = _subtractRanges(keep, _polyCutRanges(a.x, a.z, b.x, b.z, ribbons[j], 0));
      }
      keep.sort((p, q) => p[0] - q[0]);
      let first = true;
      for (const [t0, t1] of keep) {
        const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
        if (cur && openEnd && first && t0 < 1e-6) cur.push(p1);      // продолжение той же линии
        else { flush(); cur = [p0, p1]; }
        first = false;
        openEnd = (t1 > 1 - 1e-6);
      }
      if (!keep.length) { flush(); openEnd = false; }
    }
    flush();
  });
  return out;
}

// Дорожки: сеть линий (разделены break). Рендерим посегментными рибонами (митёные углы +
// доски ⟂ каждому сегменту), а пересечения чиним тримингом концов-ответвлений (T-стыки)
// на полуширину — конец линии примыкает к краю встречной дорожки без наложения.
function buildPaths3d(parent, M, pts, houseL, houseW) {
  if (pts.filter(p => !p.break).length < 2) return;
  const pathW = (S.pathWidth || 120) / 100;
  const halfW = pathW / 2, PATH_H = 0.05;
  const group = new THREE.Group();
  const pathMat = (M.deck && M.deck.clone) ? M.deck.clone()
                                           : new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.85 });
  pathMat.side = THREE.DoubleSide;
  const segments = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts.filter(p => !p.break)];

  const lines = [];
  for (const seg of segments) {
    const raw = canvasToWorld(seg.filter(p => !p.break), houseL, houseW);
    const wp = [];
    for (const p of raw) if (!wp.length || Math.hypot(p.x - wp[wp.length-1].x, p.z - wp[wp.length-1].z) > 0.05) wp.push(p);
    if (wp.length >= 2) lines.push(wp);
  }
  if (!lines.length) { parent.add(group); return; }

  for (const wp of _trimPathJunctions(lines, halfW)) {
    const { left, right } = _offsetPolyline(wp, halfW);
    _buildPathRibbon(group, left, right, 0, PATH_H, pathW, pathMat, 'deckMeshes');
  }
  parent.add(group);
}

// ══════════════════════════════════════════════
// ЗАБОР
//
// Модель забора приходит С СЕРВЕРА вместе с текстурой — как у садовой мебели
// (TODO.md → ЗАБОР 2, 3): выбранный в каталоге товар несёт `glb_file_url`, его
// материалы используются как есть. Пока таких товаров нет, забор строится
// в УСЛОВНОМ виде: столбы + полотно нейтрального цвета, чтобы разметка была
// видна в сцене и считалась в смете, но никто не принимал её за реальный профиль.
// ══════════════════════════════════════════════
const FENCE_SECTION_W  = 2.0;    // шаг секции по осям столбов, м
const FENCE_NATIVE_H   = 1.9;    // высота секции модели-образца, м (база масштаба по S.fenceH)
const FENCE_POST_W     = 0.10;   // сечение столба условного забора, м
const FENCE_PANEL_T    = 0.04;   // толщина полотна условного забора, м
const FENCE_GROUND_GAP = 0.05;   // просвет под полотном, м
const FENCE_SCHEMATIC_COLOR = 0xb0a89c;   // нейтральный «условный» цвет полотна без товара
// ВСЕ части забора, кроме полотна, — тёмно-серые: товаром красится ТОЛЬКО полотно
// (требование продукта 2026-08-23). Значение занижено относительно
// «настоящего» тёмно-серого: базовый цвет умножается на освещение сцены (та же
// история, что с PAD_COLOR), и 0x4a4a4a в кадре читался как средне-серый.
const FENCE_FRAME_COLOR = 0x2a2a2a;

const _fenceCache = {};          // url → THREE.Group (прототип) | null (не загрузилась)
const _fenceLoading = {};        // url → Promise

// URL модели забора из выбранного товара (то же поле, что у мебели).
function fenceModelUrl() {
  const el = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.fence : null;
  return (el && (el.modelUrl || el.glbFileUrl)) || '';
}

function ensureFenceModel(url, label) {
  if (_fenceCache[url] !== undefined) return Promise.resolve(_fenceCache[url]);
  if (_fenceLoading[url]) return _fenceLoading[url];
  const done = () => { if (typeof d3dLoadingClear === 'function') d3dLoadingClear(url); };
  const show = pct => { if (typeof d3dLoadingSet === 'function') d3dLoadingSet(url, label || 'забор', pct); };
  _fenceLoading[url] = new Promise(resolve => {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { resolve(null); return; }
    show(null);
    new THREE.GLTFLoader().load(url,
      gltf => { const proto = _fenceNormalizeProto(gltf.scene);
                _fenceCache[url] = proto; _fenceLoading[url] = null; done(); resolve(proto); },
      ev => { show(ev && ev.total > 0 ? Math.min(100, Math.round(ev.loaded / ev.total * 100)) : null); },
      err => { console.warn('[fence] не загрузилась модель', url, err);
               _fenceCache[url] = null; _fenceLoading[url] = null; done(); resolve(null); });
  });
  return _fenceLoading[url];
}

// Приводит модель товара к нашим осям: начало секции в X=0, низ на земле (Y=0),
// полотно по оси линии (центр по Z). Родные габариты запоминаем — по ним считается
// масштаб секции. Без этого масштаб брался от жёстких FENCE_SECTION_W × FENCE_NATIVE_H,
// и модель с другой шириной/высотой или со сдвинутым origin расползалась: длинные
// прогоны уезжали за крайние столбы (баг с рендера 2026-08-25).
function _fenceNormalizeProto(scene) {
  const proto = new THREE.Group();
  proto.add(scene);
  const box = new THREE.Box3().setFromObject(scene);
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) return proto;
  scene.position.x -= box.min.x;                       // начало секции — в нуле
  scene.position.y -= box.min.y;                       // низ — на земле
  scene.position.z -= (box.min.z + box.max.z) / 2;     // полотно — по оси линии
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  proto.userData.nativeW = (w > 0.2) ? w : FENCE_SECTION_W;
  proto.userData.nativeH = (h > 0.2) ? h : FENCE_NATIVE_H;
  console.info('[fence] габариты модели:', proto.userData.nativeW.toFixed(2), '×',
               proto.userData.nativeH.toFixed(2), 'м');
  return proto;
}

// Родные габариты прототипа (с запасными значениями, если модель не нормализовалась).
function _fenceNativeW(proto) {
  const w = proto && proto.userData && proto.userData.nativeW;
  return (w > 0.2) ? w : FENCE_SECTION_W;
}
function _fenceNativeH(proto) {
  const h = proto && proto.userData && proto.userData.nativeH;
  return (h > 0.2) ? h : FENCE_NATIVE_H;
}

// Планочная UV для полотна УСЛОВНОГО забора (без модели товара). Доски идут вдоль
// длинной стороны панели: box-проекция даёт грувы вдоль горизонтали (панель шире,
// чем выше — обычный случай), а для вытянутой вверх панели u/v меняются местами.
// Нужна только когда на полотне лежит текстура товара — у сплошного цвета UV не важны.
// У забора ИЗ МОДЕЛИ товара UV берутся из GLB (см. _fenceModelSection): ориентация
// досок — вертикальная или горизонтальная — задаётся в самом файле.
function _applyFenceUV(mesh, swap) {
  if (typeof _applyBoxUV !== 'function') return;
  _applyBoxUV(mesh, DECK_TILE);
  if (!swap) return;
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  uv.needsUpdate = true;
}

// Столб условного забора (он же — замыкающий на свободном конце пролёта).
function _fenceBoxPost(group, x, z, angle, panelH, frameMat) {
  const postH = FENCE_GROUND_GAP + panelH + 0.10;
  const post = new THREE.Mesh(new THREE.BoxGeometry(FENCE_POST_W, postH, FENCE_POST_W), frameMat);
  post.position.set(x, postH / 2, z);
  post.rotation.y = angle;
  post.castShadow = post.receiveShadow = true;
  group.add(post);
}

// Столб в модели товара: узкая вдоль пролёта и высокая деталь (или прямо названная
// столбом). Возвращает габарит по X в системе прототипа или null. Меши во всю секцию
// — горизонтальные прогоны, поперечины, полотно — столбом не считаются.
const FENCE_POST_RE = /post|stolb|столб|стойк|pillar|opora|опор/i;

// Боковины секции по соглашению моделей забора: `fence_left` и `fence_right` —
// вертикальные рамки по краям секции. ИМИ ограничивается полотно (доски, плетёнка),
// см. _fenceProtoLimits и _fenceClipX. Столбами они не считаются: раньше узкая
// высокая рамка проходила по признакам столба, `fence_right` попадал в «конечный
// столб» секции и выбрасывался из каждого клона — правая боковина пропадала
// (правка 2026-08-31).
const FENCE_SIDE_RE = /(^|[_.\-\s|])(left|right)([_.\-\s0-9|]|$)/i;

function _fencePostSpan(o, nativeW, nativeH) {
  const nm = (o.name || '') + '|' + ((o.material && o.material.name) || '');
  if (FENCE_PANEL_RE.test(nm)) return null;
  if (!FENCE_POST_RE.test(nm) && FENCE_SIDE_RE.test(nm)) return null;   // боковина рамы
  const bb = new THREE.Box3().setFromObject(o);
  if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return null;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
  if (w > nativeW * 0.5) return null;                      // деталь во всю секцию — не столб
  if (!FENCE_POST_RE.test(nm) && (w > Math.max(0.35, nativeW * 0.25) || h < nativeH * 0.5)) return null;
  // Сечение столба в плане близко к квадрату, а вертикальная ламель полотна тонкая
  // поперёк линии. Без этой проверки штакетина с непонятным именем шла в столбы: шаг
  // секций считался по ламелям, секции разъезжались, а полотно красилось как каркас.
  if (!FENCE_POST_RE.test(nm) && d < w * 0.5) return null;
  // Столб СТОИТ НА ЗЕМЛЕ. В моделях 003/005 декоративные вертикальные накладки
  // полотна приезжают из GLTF отдельными мешами со сгенерированными именами
  // (`Cube002`, `Cube005`), и по сечению они неотличимы от столба: шаг секции
  // считался по ним (1.32 м вместо 2 м), и забор рассыпался — рендер 2026-08-31.
  // Полотно и его накладки в этих моделях начинаются с 0.135 м над землёй.
  if (!FENCE_POST_RE.test(nm) && bb.min.y > nativeH * 0.05) return null;
  return { minX: bb.min.x, maxX: bb.max.x };
}

// Разбор прототипа: есть ли в модели столб в начале секции (X≈0) и в её конце
// (X≈nativeW). Считается один раз и кэшируется в userData.
function _fenceProtoPosts(proto) {
  if (proto.userData._posts) return proto.userData._posts;
  const nw = _fenceNativeW(proto), nh = _fenceNativeH(proto);
  const tol = _fencePostTol(nw);
  proto.updateMatrixWorld(true);
  const info = { any: false, atStart: false, atEnd: false, startCx: 0, endCx: 0, pitch: 0,
                 postHalf: 0, twoPosts: false };
  const posts = [], other = [];
  const centers = [], halves = [];
  proto.traverse(o => {
    if (!o.isMesh) return;
    const p = _fencePostSpan(o, nw, nh);
    if (!p) { other.push(o.name || '(без имени)'); return; }
    posts.push(`${o.name || '(без имени)'} [${p.minX.toFixed(2)}…${p.maxX.toFixed(2)}]`);
    centers.push((p.minX + p.maxX) / 2);
    halves.push((p.maxX - p.minX) / 2);
    info.any = true;
  });
  // Полутолщина столба — по ней полотно дотягивается до граней столбов (см. _fenceModelSection).
  if (halves.length) info.postHalf = Math.min(...halves);
  // Шаг секции — расстояние между ЦЕНТРАМИ крайних столбов, а не габарит модели.
  // Габарит включает по полстолба с каждого края: если ставить секции по нему,
  // столбы соседних секций встают ВПЛОТНУЮ ДРУГ К ДРУГУ (двойной столб на каждом
  // стыке и на углу), а полотно расходится — баг с рендера 2026-08-25.
  if (centers.length) {
    info.startCx = Math.min(...centers);
    info.endCx = Math.max(...centers);
    if (info.endCx - info.startCx > 0.2) { info.pitch = info.endCx - info.startCx; info.twoPosts = true; }
    // Столб в модели ОДИН (в начале секции): шаг берём из соглашения — 2 м между
    // осями столбов, файл так и рассчитан. Раньше шаг падал на габарит модели
    // (`nativeW`), а он у секции с длинным полотном (доски нарисованы «с запасом»)
    // ничего общего с шагом столбов не имеет.
    else info.pitch = FENCE_SECTION_W;
    // Секция ставится ПО ОСИ стартового столба (shift = startCx), поэтому столб в
    // начале секции есть всегда, когда столб вообще распознан; столб в конце — только
    // когда их в модели два. Раньше эти признаки считались от габарита модели
    // (`minX <= tol`, `maxX >= nativeW - tol`) и у модели с длинным полотном оба
    // выходили false: замыкающий столб пролёта подменялся простым box-столбом.
    info.atStart = true;
    info.atEnd = info.twoPosts;
  }
  // На стенде должно быть видно, как разобрана конкретная модель: если столб слит
  // с прогонами в один меш, он сюда не попадёт и на свободном конце встанет
  // простой box-столб (это фолбэк, а не баг разбора).
  console.info('[fence] столбы в модели:', posts.length ? posts.join(', ') : 'не распознаны',
               '| начало секции:', info.atStart, '| конец секции:', info.atEnd,
               '| шаг столбов:', info.pitch
                 ? info.pitch.toFixed(2) + ' м' + (info.twoPosts ? '' : ' (по соглашению)')
                 : 'по габариту модели',
               '| прочие меши:', other.join(', '));
  proto.userData._posts = info;
  return info;
}

// Допуск «столб в начале/конце секции». Считается от ширины модели, но сверху
// ограничен: у модели с длинной лентой полотна габарит — несколько секций, и допуск
// без потолка вырастал до метров.
function _fencePostTol(nativeW) { return Math.min(0.40, Math.max(0.15, nativeW * 0.08)); }

// Границы полотна в секции: боковины `fence_left` / `fence_right` из модели.
// Полотно (доски, плетёнка) в файле часто нарисовано «с запасом» — длинной лентой
// на несколько секций; ограничителями служат боковины, по ним лента и режется
// (_fenceClipX). Без этого лента проходила НАСКВОЗЬ через соседние модули забора
// (баг с рендера 2026-08-31). Модель без боковин работает по-прежнему: полотно
// дотягивается до граней столбов (_fenceSpanBetweenPosts).
function _fenceProtoLimits(proto) {
  if (proto.userData._limits !== undefined) return proto.userData._limits;
  proto.updateMatrixWorld(true);
  const sides = [];
  proto.traverse(o => {
    if (!o.isMesh) return;
    const nm = (o.name || '') + '|' + ((o.material && o.material.name) || '');
    // Боковина — это КАРКАС: деталь, прямо названная полотном или столбом, границей
    // секции быть не может (иначе полотно ограничило бы само себя).
    if (FENCE_PANEL_RE.test(nm) || FENCE_POST_RE.test(nm) || !FENCE_SIDE_RE.test(nm)) return;
    const bb = new THREE.Box3().setFromObject(o);
    if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return;
    sides.push({ name: o.name || '(без имени)', min: bb.min.x, max: bb.max.x });
  });
  let lim = null;
  if (sides.length) {
    const x0 = Math.min(...sides.map(s => s.min)), x1 = Math.max(...sides.map(s => s.max));
    if (x1 - x0 > 0.2) {
      // Центры и полутолщины КРАЙНИХ боковин: по ним границы полотна пересчитываются
      // в координаты секции (боковины — короткие детали, они не тянутся, а только
      // раздвигаются вместе с секцией, см. _fenceFitX).
      const l = sides.reduce((a, s) => (s.min < a.min ? s : a), sides[0]);
      const r = sides.reduce((a, s) => (s.max > a.max ? s : a), sides[0]);
      lim = { x0, x1,
              lc: (l.min + l.max) / 2, lh: (l.max - l.min) / 2,
              rc: (r.min + r.max) / 2, rh: (r.max - r.min) / 2 };
      console.info('[fence] боковины секции:', sides.map(s => s.name).join(', '),
                   `→ полотно по X [${x0.toFixed(2)}…${x1.toFixed(2)}]`);
    }
  }
  proto.userData._limits = lim;
  return lim;
}

// Разовый дамп разбора модели: что она содержит и кем мы считаем каждую деталь.
// Нужен для разбора жалоб «забор развалился» на конкретном товаре: модели лежат на
// бэкенде, локально их не открыть, а по этому выводу видно и структуру файла, и то,
// как её прочитал разбор (столб / боковина / полотно / каркас).
function _fenceDumpProto(proto) {
  if (proto.userData._dumped) return;
  proto.userData._dumped = true;
  const nw = _fenceNativeW(proto), nh = _fenceNativeH(proto);
  const panelSet = _fenceProtoPanels(proto);
  const lim = _fenceProtoLimits(proto);
  const rows = [];
  proto.updateMatrixWorld(true);
  proto.traverse(o => {
    if (!o.isMesh) return;
    const nm = (o.name || '') + '|' + ((o.material && o.material.name) || '');
    const bb = new THREE.Box3().setFromObject(o);
    const role = _fencePostSpan(o, nw, nh) ? 'столб'
               : panelSet.has(o) ? 'полотно'
               : (!FENCE_POST_RE.test(nm) && FENCE_SIDE_RE.test(nm)) ? 'боковина'
               : 'каркас';
    rows.push(`  ${(o.name || '(без имени)').padEnd(22)} ${role.padEnd(8)}`
            + ` X[${bb.min.x.toFixed(3)}…${bb.max.x.toFixed(3)}]`
            + ` Y[${bb.min.y.toFixed(3)}…${bb.max.y.toFixed(3)}]`
            + ` Z[${bb.min.z.toFixed(3)}…${bb.max.z.toFixed(3)}]`);
  });
  console.info('[fence] РАЗБОР МОДЕЛИ (габарит '
             + nw.toFixed(3) + ' × ' + nh.toFixed(3) + ' м, боковины '
             + (lim ? `[${lim.x0.toFixed(3)}…${lim.x1.toFixed(3)}]` : 'нет') + '):\n'
             + rows.join('\n'));
}

// Обрезает геометрию по X диапазоном [x0, x1]: треугольники целиком снаружи
// выбрасываются из индекса, у пересекающих границу вершины прижимаются к плоскости
// реза. Именно РЕЗ, а не сжатие (_fenceClampX): длинную ленту досок или плетёнки
// сжимать нельзя — рисунок стал бы в разы плотнее, чем в модели.
// Режем ИНДЕКСОМ, а не пересборкой атрибутов: буферы вершин остаются общими с клоном
// (у плетёнки это 30 тыс. вершин на секцию — разворачивать их в неиндексные значит
// вчетверо раздуть память на каждую секцию пролёта). Правится геометрия на месте,
// вызывающий передаёт сюда СВОЙ клон.
function _fenceClipX(geo, x0, x1) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return geo;
  if (bb.min.x >= x0 - 1e-4 && bb.max.x <= x1 + 1e-4) return geo;     // и так внутри
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const idx = geo.index;
  const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
  const vAt = i => (idx ? idx.getX(i) : i);
  const keep = [];
  for (let t = 0; t < triCount; t++) {
    const a = vAt(t * 3), b = vAt(t * 3 + 1), c = vAt(t * 3 + 2);
    const xa = pos.getX(a), xb = pos.getX(b), xc = pos.getX(c);
    const mn = Math.min(xa, xb, xc), mx = Math.max(xa, xb, xc);
    if (mx > x0 + 1e-4 && mn < x1 - 1e-4) keep.push(a, b, c);
  }
  if (!keep.length) return geo;                     // от полотна ничего не осталось — не режем
  if (keep.length < triCount * 3) {
    const Arr = (pos.count > 65535) ? Uint32Array : Uint16Array;
    geo.setIndex(new THREE.BufferAttribute(new Arr(keep), 1));
  }
  for (let i = 0; i < pos.count; i++) pos.setX(i, Math.min(x1, Math.max(x0, pos.getX(i))));
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Замыкающий столб для забора ИЗ МОДЕЛИ товара: клонируем секцию и оставляем в ней
// ТОЛЬКО столб начала секции — всё остальное (полотно, горизонтальные прогоны,
// крепёж) выбрасываем. Раньше выбрасывалось лишь полотно, и на свободном конце
// вместе со столбом висели прогоны длиной в целую секцию, а сам столб оказывался
// не в конце пролёта (баг с рендера 2026-08-25). Столбов не нашли → false,
// зовущий ставит box-столб.
function _fenceModelPost(proto, group, x, z, angle, sy, frameMat) {
  const info = _fenceProtoPosts(proto);
  if (!info.any || !info.atStart) return false;
  const nw = _fenceNativeW(proto), nh = _fenceNativeH(proto);
  const tol = _fencePostTol(nw);
  const inst = proto.clone(true);
  inst.updateMatrixWorld(true);              // фильтруем, пока клон стоит в нуле
  const drop = [];
  let kept = 0;
  inst.traverse(o => {
    if (!o.isMesh) return;
    const p = _fencePostSpan(o, nw, nh);
    if (p && Math.abs((p.minX + p.maxX) / 2 - info.startCx) < tol) {
      o.material = frameMat;             // в threeState.fenceMeshes не идёт: примерка
      o.castShadow = o.receiveShadow = true;  // образца красит только полотно
      kept++;
    } else drop.push(o);
  });
  if (!kept) return false;
  for (const o of drop) if (o.parent) o.parent.remove(o);
  // Столб начала секции, поставленный в конец пролёта, — это столб начала
  // следующей (несуществующей) секции: ровно то, что нужно на свободном конце.
  // Сдвиг тот же, что у секции: центр столба — точно в точку конца пролёта.
  if (info.pitch) for (const c of inst.children) c.position.x -= info.startCx;
  inst.position.set(x, 0, z);
  inst.rotation.y = angle;
  inst.scale.set(1, sy, 1);   // столб по длине не тянем — только по высоте
  group.add(inst);
  return true;
}

// Секция условного забора: столб в начале + полотно до следующего столба.
// panelMat — материал товара (полотно), frameMat — тёмно-серый (столбы).
function _fenceSchematicSection(group, x, z, angle, spanW, panelH, panelMat, frameMat, withPost) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = angle;
  if (withPost) _fenceBoxPost(g, 0, 0, 0, panelH, frameMat);
  const panelLen = Math.max(0.05, spanW - FENCE_POST_W);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(panelLen, panelH, FENCE_PANEL_T), panelMat);
  panel.position.set(spanW / 2, FENCE_GROUND_GAP + panelH / 2, 0);
  panel.castShadow = panel.receiveShadow = true;
  // Доски вдоль длинной стороны панели: если панель выше, чем шире — разворачиваем.
  if (panelMat.map) _applyFenceUV(panel, panelH > panelLen);
  g.add(panel);
  threeState.fenceMeshes.push(panel);
  group.add(g);
}

// Полотно в модели товара — по имени меша или материала. Всё ОСТАЛЬНОЕ (столбы,
// каркас, крепёж, добор и что там ещё окажется в файле) красится тёмно-серым:
// правило продукта — «все части забора кроме панелей тёмно-серые». Раньше было
// наоборот (список каркасных имён, остальное — полотно), и любая непонятная
// деталь модели уезжала в текстуру товара.
// Ширина проёма под калитку в мире (то же значение, что FENCE_GATE_W на плане).
const FENCE_GATE_W3D = 1.0;

const FENCE_PANEL_RE = /panel|polotno|полотн|board|plank|доск|штакет|ламел|lamel|fill|заполн/i;

// Секция из модели товара: клон, растянутый по длине пролёта. Материалы назначаем
// САМИ по тому же правилу, что и у условного забора: полотно — материал товара,
// ВСЁ остальное — тёмно-серое. Раньше брались материалы из GLB как есть, и после
// загрузки модели текстура товара пропадала — забор «возвращался» к виду из файла.
// Модель без текстур товара (panelMat без карты) красится так же — по правилу
// продукта. Возвращает число мешей, опознанных как полотно (0 → см. warn в
// buildFence3d: имена в модели не совпали с FENCE_PANEL_RE).
//
// UV НЕ ТРОГАЕМ: развёртка досок делается в GLB, оттуда и берётся (решение продукта
// от 2026-08-23) — вертикальный и горизонтальный заборы различаются только файлом,
// признака ориентации в карточке товара не нужно. Единственное исключение — меш
// вообще без UV: тогда текстура товара легла бы одним пикселем, поэтому для него
// остаётся аварийная box-проекция.
// Секция ставится ПО ШАГУ СТОЛБОВ: центр стартового столба модели попадает ровно
// в начало секции, центр её конечного столба — в начало следующей. Конечный столб
// из клона выбрасывается — его место занимает стартовый столб следующей секции
// (а на свободном конце — замыкающий столб, см. _fenceModelPost). Иначе на каждом
// стыке стояло по два столба вплотную, а на углу — четыре.
// Сами столбы по длине не тянутся: масштаб секции им компенсируется, иначе на
// коротком пролёте они становились тоньше, на длинном — толще.
// isGate — секция калитки (узкая, 1 м): у неё из ПОВТОРЯЮЩИХСЯ вертикальных элементов
// полотна (штакетины, ламели) остаётся один — средний. Требование продукта 2026-08-28:
// калитка выглядит как секция забора шириной 1 м, а не как просвет.
function _fenceModelSection(proto, group, x, z, angle, spanW, sy, panelMat, frameMat, isGate) {
  const info = _fenceProtoPosts(proto);
  const nw = _fenceNativeW(proto), nh = _fenceNativeH(proto);
  const tol = _fencePostTol(nw);
  const pitch = (info.pitch > 0.2) ? info.pitch : nw;
  const dx = spanW - pitch;                  // насколько секция длиннее/короче родной
  const k = spanW / pitch;                   // им двигаются ПОЗИЦИИ деталей внутри секции
  const shift = info.pitch ? info.startCx : 0;

  // Геометрия каждого меша ЗАПЕКАЕТСЯ в систему прототипа (o.matrixWorld), после чего
  // все детали лежат в общих осях секции: +X вдоль пролёта. Так и делаются подгонка
  // длины, и сдвиг. Раньше длина менялась через o.scale.x, а он действует по ЛОКАЛЬНОЙ
  // оси меша: в модели с повёрнутыми узлами полотно тянулось поперёк линии и вылезало
  // за раму скошенным, а вложенные меши масштабировались дважды (баг с рендера
  // 2026-08-28). Заодно ушёл общий масштаб inst по X — он же скашивал повёрнутые узлы.
  const inst = new THREE.Group();
  proto.updateMatrixWorld(true);
  const panelSet = _fenceProtoPanels(proto);
  const limits = _fenceProtoLimits(proto);
  // Сначала собираем детали секции, потом строим: в режиме калитки нужно ЗНАТЬ все
  // вертикальные элементы полотна, чтобы оставить из них один.
  const parts = [];
  proto.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const p = _fencePostSpan(o, nw, nh);
    if (p && info.twoPosts) {
      const cx = (p.minX + p.maxX) / 2;
      // Конечный столб выбрасываем: его место занимает стартовый столб следующей
      // секции (на свободном конце — замыкающий, см. _fenceModelPost). Только когда
      // столбов в модели ДВА: у модели с одним столбом начало и конец совпадают, и
      // проверка выбросила бы единственный столб секции.
      if (Math.abs(cx - info.endCx) < tol) return;
    }
    const bb = new THREE.Box3().setFromObject(o);
    const isPanel = panelSet.has(o);
    // Полотно меряем ПО РЕЗУ (боковины секции): длина ленты в файле — не длина
    // секции, и по ней деталь ошибочно считалась бы «во всю секцию» или наоборот.
    const minX = (isPanel && limits) ? Math.max(bb.min.x, limits.x0) : bb.min.x;
    const maxX = (isPanel && limits) ? Math.min(bb.max.x, limits.x1) : bb.max.x;
    if (isPanel && limits && maxX - minX < 0.005) return;   // полотно целиком вне секции
    const len = maxX - minX, hgt = bb.max.y - bb.min.y;
    parts.push({ o, isPost: !!p, isPanel, cx: (minX + maxX) / 2, len, hgt });
  });
  if (isGate) {
    // Вертикальный элемент полотна: узкий по длине секции и заметно выше, чем шире.
    const verts = parts.filter(s => s.isPanel && !s.isPost
                                    && s.len < pitch * 0.5 && s.hgt > s.len * 1.5);
    if (verts.length > 1) {
      // Оставляем средний по X — он приходится на середину створки.
      verts.sort((a, b) => a.cx - b.cx);
      const keep = verts[Math.floor(verts.length / 2)];
      for (const s of verts) if (s !== keep) s.drop = true;
      keep.center = true;                    // и ставим его ровно по центру калитки
    }
  }
  let panels = 0;
  for (const s of parts) {
    if (s.drop) continue;
    let g = s.o.geometry.clone();
    g.applyMatrix4(s.o.matrixWorld);
    // ПОЛОТНО режем боковинами секции (`fence_left` / `fence_right`): в модели оно
    // нарисовано лентой на несколько секций и без реза проходило насквозь через
    // соседние модули забора (баг с рендера 2026-08-31). Рез — до подгонки длины:
    // дальше деталь уже имеет длину секции и тянется вместе с ней.
    let ovL = 0, ovR = 0;                    // заход полотна за боковины, как в модели
    if (s.isPanel && limits) {
      g = _fenceClipX(g, limits.x0, limits.x1);
      g.computeBoundingBox();
      ovL = (limits.lc + limits.lh) - g.boundingBox.min.x;   // + = полотно уходит ПОД боковину
      ovR = g.boundingBox.max.x - (limits.rc - limits.rh);
    }
    // Позиция детали внутри секции — пропорционально (k), собственная длина — только
    // у деталей во всю секцию (полотно, прогоны): им она меняется РОВНО на разницу
    // длины секции, тогда зазоры до столбов остаются как в модели. Столбы и мелочь
    // вроде штакетин сохраняют родной размер и просто раздвигаются.
    _fenceFitX(g, shift, k, s.isPost ? 0 : dx, pitch);
    // ПОЛОТНО дотягиваем до граней столбов: в модели между полотном и столбом часто
    // оставлен зазор, и на пролёте он читается как щель (правка 2026-08-30). Растягиваем
    // только сплошное полотно во всю секцию — штакетины и ламели трогать нельзя.
    // Если в модели есть боковины, полотно подгоняется ПО НИМ: на растянутой секции
    // боковины разъезжаются, и без подгонки у одной из них открывается щель.
    // Цель — ВНУТРЕННИЕ грани боковин плюс тот заход под них, что есть в файле
    // (у досок 1 см с каждой стороны, у плетёнки 0). По внешним граням тянуть нельзя:
    // прутья плетёнки той же толщины, что рамка, и торчали сквозь неё наружу
    // (баг с рендера 2026-08-31). Боковины — короткие детали, они только раздвигаются,
    // поэтому их грани пересчитываются в координаты секции тем же k.
    if (s.isPanel && !s.isPost && s.len > pitch * 0.5) {
      if (limits) {
        _fenceSpanBetweenPosts(g, (limits.lc - shift) * k + limits.lh - ovL,
                                  (limits.rc - shift) * k - limits.rh + ovR);
      } else if (info.postHalf > 0) {
        _fenceSpanBetweenPosts(g, info.postHalf, spanW - info.postHalf);
      }
    }
    // Деталь не должна вылезать за границы секции. В модели полотно и прогоны часто
    // ШИРЕ шага столбов (нарисованы с нахлёстом на столбы): внутри пролёта нахлёст
    // соседних секций не виден, а на конце забора и на углу полотно торчало наружу
    // (баг с рендера 2026-08-30). Столбы не вписываем: стартовый стоит по центру нуля
    // и половиной сечения законно уходит в минус.
    if (!s.isPost && _fenceClampX(g, 0, spanW) && proto && !proto.userData._clampLogged) {
      proto.userData._clampLogged = true;
      console.info('[fence] детали модели шире шага столбов — вписываю в секцию,',
                   'иначе полотно торчит за концом забора и за углом');
    }
    if (s.center) {                          // единственная штакетина калитки — по центру
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(spanW / 2 - (bb.min.x + bb.max.x) / 2, 0, 0);
      g.computeBoundingSphere();
    }
    const mesh = new THREE.Mesh(g, s.isPanel ? panelMat : frameMat);
    mesh.name = s.o.name;
    mesh.castShadow = mesh.receiveShadow = true;
    inst.add(mesh);
    if (!s.isPanel) continue;            // не полотно — товаром не красится и в примерку не идёт
    _applyFencePanelUV(mesh, proto, pitch);
    threeState.fenceMeshes.push(mesh);
    panels++;
  }
  inst.position.set(x, 0, z);
  inst.rotation.y = angle;
  inst.scale.set(1, sy, 1);            // по длине уже подогнано, тянем только высоту
  group.add(inst);
  return panels;
}

// Растягивает геометрию по X ровно на диапазон [x0, x1] — им полотно дотягивается от
// грани одного столба до грани другого, чтобы у столбов не оставалось щелей. Работает в
// обе стороны (и растянет, и подожмёт); вырожденную геометрию не трогает.
function _fenceSpanBetweenPosts(geo, x0, x1) {
  if (!(x1 > x0 + 0.02)) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const a = bb.min.x, len = bb.max.x - a;
  if (len < 0.02) return;
  const k = (x1 - x0) / len;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, x0 + (pos.getX(i) - a) * k);
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

// Вписывает геометрию в диапазон [x0, x1] по X, сжимая её при выходе за границы.
// Возвращает true, если что-то пришлось поджать. Крайние точки внутри диапазона
// остаются на месте — деталь просто перестаёт торчать наружу.
function _fenceClampX(geo, x0, x1) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return false;
  const a = bb.min.x, b = bb.max.x, len = b - a;
  if (len < 1e-6) return false;
  if (a >= x0 - 1e-4 && b <= x1 + 1e-4) return false;      // и так внутри секции
  const na = Math.max(a, x0), nb = Math.min(b, x1);
  if (nb - na < 0.01) return false;                        // вырождается — оставляем как есть
  const s = (nb - na) / len;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, na + (pos.getX(i) - a) * s);
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return true;
}

// Какие меши модели считать ПОЛОТНОМ (их красит товар, всё прочее — тёмно-серое).
// Сначала по именам (FENCE_PANEL_RE), а если ни одно имя не подошло — ПО ГЕОМЕТРИИ:
// полотно — самые крупные по площади фасада детали, не являющиеся столбами. Без этого
// запаса модель товара с непривычными именами красилась целиком тёмно-серым, и после
// выбора товара забор становился чёрным (баг с рендера 2026-08-28).
// Считается один раз на модель и кэшируется в userData.
function _fenceProtoPanels(proto) {
  if (proto.userData._panels) return proto.userData._panels;
  const nw = _fenceNativeW(proto), nh = _fenceNativeH(proto);
  const byName = new Set(), cand = [];
  proto.updateMatrixWorld(true);
  proto.traverse(o => {
    if (!o.isMesh) return;
    const nm = (o.name || '') + '|' + ((o.material && o.material.name) || '');
    if (FENCE_PANEL_RE.test(nm)) { byName.add(o); return; }
    if (FENCE_SIDE_RE.test(nm)) return;                 // боковина рамы — каркас, не полотно
    if (_fencePostSpan(o, nw, nh)) return;              // столб — точно не полотно
    const bb = new THREE.Box3().setFromObject(o);
    cand.push({ o, area: (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) });
  });
  let set = byName;
  if (!byName.size && cand.length) {
    const max = Math.max(...cand.map(c => c.area));
    set = new Set(cand.filter(c => c.area >= max * 0.4).map(c => c.o));
    console.info('[fence] полотно по именам не опознано, взято по площади:',
                 [...set].map(o => o.name || '(без имени)').join(', '),
                 '| остальное красится тёмно-серым');
  }
  proto.userData._panels = set;
  return set;
}

// ── Развёртка полотна забора ──
// UV из GLB БОЛЬШЕ НЕ ИСПОЛЬЗУЮТСЯ напрямую: у моделей товара развёртка полотна сделана
// наискось, и доски текстуры шли под углом к раме (баг с рендера 2026-08-28: рама и
// контур полотна ровные, а полосы наклонены). Прежнее решение «развёртку делает GLB»
// (2026-08-23) на практике не выполняется.
// Что делаем: ОРИЕНТАЦИЮ досок берём из модели (по тому, вдоль чего растёт u в её
// развёртке) — так вертикальный и горизонтальный заборы по-прежнему различаются только
// файлом, — а саму развёртку кладём заново, ровной осевой проекцией (_applyAxisUV,
// шаг DECK_TILE, тот же, что у настила и ограждения).
// Наклон развёртки модели печатается один раз на модель: на стенде должно быть видно,
// насколько кривой была родная UV.
function _fenceUVVerticalInGeo(geo) {
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  if (!uv || !pos || pos.count < 3) return null;
  // Регрессия u ~ a·x + b·y + c по нормальным уравнениям 3×3 (метод Крамера).
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0, sux = 0, suy = 0, su = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), u = uv.getX(i);
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; n++;
    sux += u * x; suy += u * y; su += u;
  }
  const det = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx);
  if (Math.abs(det) < 1e-12) return null;
  const a = (sux * (syy * n - sy * sy) - sxy * (suy * n - sy * su) + sx * (suy * sy - syy * su)) / det;
  const b = (sxx * (suy * n - sy * su) - sux * (sxy * n - sy * sx) + sx * (sxy * su - suy * sx)) / det;
  if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) return null;
  return { vertical: Math.abs(b) > Math.abs(a),
           tiltDeg: Math.atan2(Math.min(Math.abs(a), Math.abs(b)),
                               Math.max(Math.abs(a), Math.abs(b))) * 180 / Math.PI };
}

function _applyFencePanelUV(mesh, proto, pitch) {
  if (typeof _applyAxisUV !== 'function') { _applyFenceUV(mesh, false); return; }
  const g = mesh.geometry;
  const uvInfo = _fenceUVVerticalInGeo(g);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const len = bb.max.x - bb.min.x;
  // Узкая и вытянутая вверх деталь (штакетина, ламель) — доски вдоль неё, что бы ни было
  // в развёртке модели: у бруска её ориентация случайна. Для деталей во всю секцию
  // (сплошное полотно) ориентацию решает развёртка модели — так вертикальный и
  // горизонтальный заборы по-прежнему различаются только файлом. Условие «узкая»
  // обязательно: без него узкая створка калитки получала вертикальные доски, хотя
  // соседние секции того же забора — горизонтальные.
  const narrow = !(pitch > 0) || len < pitch * 0.5;
  const tall = narrow && (bb.max.y - bb.min.y) > len * 1.5;
  const vertical = tall ? true : (uvInfo ? uvInfo.vertical : false);
  _applyAxisUV(mesh, vertical ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 });
  if (proto && !proto.userData._uvLogged) {
    proto.userData._uvLogged = true;
    console.info('[fence] развёртка полотна: доски', vertical ? 'вертикальные' : 'горизонтальные',
                 '| наклон UV в модели:', uvInfo ? uvInfo.tiltDeg.toFixed(1) + '°' : 'UV нет',
                 '— кладём свою проекцию, шаг', DECK_TILE.toFixed(2), 'м');
  }
}

// Ставит деталь в секцию по оси X: начало секции (x0) переезжает в нуль, ЦЕНТР детали
// сдвигается пропорционально k, а собственная длина меняется на dx — но только если
// деталь тянется хотя бы на половину секции (полотно, прогоны). Короткие детали
// (штакетины, ламели, крепёж) сохраняют родной размер и просто раздвигаются:
// растягивать их на dx нельзя — на пролёте с шагом меньше родного планка шириной
// 0.10 м ужималась до 0.02 м.
// Пропорциональный сдвиг центра и подгонка длины согласованы: у детали во всю секцию
// центр (≈pitch/2) уезжает в spanW/2, то есть ровно туда, где он оказывается при
// удлинении на dx с неподвижным левым краем — зазоры до столбов сохраняются с обеих
// сторон.
function _fenceFitX(geo, x0, k, dx, pitch) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const len = bb.max.x - bb.min.x;
  const cx = (bb.min.x + bb.max.x) / 2;
  const ncx = (cx - x0) * k;
  const stretch = dx && len > 0.05 && len > pitch * 0.5;
  const s = stretch ? Math.max(0.02, len + dx) / len : 1;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, ncx + (pos.getX(i) - cx) * s);
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

// Забор по ломаной: пролёты делятся на секции РАВНОЙ ширины (округление длины на
// шаг секции) — «целые + остаток» оставляли у углов узкий огрызок.
function buildFence3d(parent, M, pts, houseL, houseW) {
  const realPts = pts.filter(p => !p.break);
  if (realPts.length < 2) return;

  const url = fenceModelUrl();
  let proto = null;
  if (url) {
    if (_fenceCache[url] === undefined) {
      ensureFenceModel(url).then(() => { if (threeState) buildScene3d(); });
    } else {
      proto = _fenceCache[url];          // null → модель не загрузилась, строим условный
      if (proto) { console.info('[fence] секции из модели товара:', url);
                   _fenceDumpProto(proto); }
    }
  }

  const fenceGroup = new THREE.Group();
  const panelH = (typeof S !== 'undefined' && S.fenceH) ? S.fenceH
                 : ((typeof FENCE_H !== 'undefined') ? FENCE_H : 1.92);
  // Масштаб модели по высоте — от её РОДНОЙ высоты (после нормализации она известна).
  const sy = proto ? (panelH / _fenceNativeH(proto)) : 1;
  // Материал условного забора: если к нему применён товар — его текстуры/цвет
  // (M.deck приходит уже разрешённым из _resolveDeckMat), иначе прежний
  // нейтральный «условный» цвет. Раньше текстура товара сюда не доезжала:
  // и столбы, и полотно всегда красились FENCE_SCHEMATIC_COLOR, и забор
  // оставался серым даже когда в каталоге у товара есть texture_urls.
  const hasProductMat = !!(typeof S !== 'undefined' && S.elementMat && S.elementMat.fence);
  const panelMat = (hasProductMat && M.deck) ? M.deck : new THREE.MeshStandardMaterial({
    color: FENCE_SCHEMATIC_COLOR, roughness: 0.85, metalness: 0.05,
  });
  // ВСЕ части забора, кроме полотна, — тёмно-серые (столбы, каркас, крепёж, добор).
  const frameMat = new THREE.MeshStandardMaterial({
    color: FENCE_FRAME_COLOR, roughness: 0.60, metalness: 0.15,
  });

  const postSet = new Set();
  const postKey = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
  const runEnds = [];                    // концы пролётов — столбы там ставятся в конце
  let panelsPainted = 0;                 // сколько мешей модели опознано как полотно
  // Калитка (TODO.md, этап 2 п.8) — точка плана, переводим в мир один раз.
  const gateW = (typeof S !== 'undefined' && S.fenceGate)
    ? canvasToWorld([S.fenceGate], houseL, houseW)[0] : null;

  const segments = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [realPts];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const worldPts = canvasToWorld(seg, houseL, houseW);
    for (let i = 0; i < worldPts.length - 1; i++) {
      const a = worldPts[i], b = worldPts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.05) continue;
      const ux = dx / segLen, uz = dz / segLen;
      const angle = Math.atan2(ux, uz) - Math.PI / 2;   // локальный +X вдоль пролёта
      // Калитка: проём фиксированной ширины на пролёте, где она стоит (TODO.md,
      // этап 2 п.8). Пролёт делится на два куска — до и после проёма; каждый
      // собирается своими секциями, как обычный пролёт.
      const parts = _fenceGateSplit(a, ux, uz, segLen, gateW);
      for (const part of parts) {
        const px = a.x + ux * part.t0, pz = a.z + uz * part.t0;
        if (part.gate) _fenceGateLeaf(px, pz, ux, uz, part.len, angle);
        else           _fenceRun(px, pz, ux, uz, part.len, angle);
      }
    }
  }
  // Замыкающие столбы: все пролёты уже разметили свои столбы в postSet, поэтому
  // на углах и стыках здесь ничего не добавится — только на свободных концах.
  for (const e of runEnds) {
    const key = postKey(e.x, e.z);
    if (postSet.has(key)) continue;
    postSet.add(key);
    if (!proto || !_fenceModelPost(proto, fenceGroup, e.x, e.z, e.angle, sy, frameMat)) {
      _fenceBoxPost(fenceGroup, e.x, e.z, e.angle, panelH, frameMat);
    }
  }
  // Модель без опознанного полотна станет целиком тёмно-серой — на стенде это надо
  // видеть сразу, чтобы дополнить FENCE_PANEL_RE именами из конкретного файла.
  if (proto && !panelsPainted) {
    console.warn('[fence] в модели товара не опознано полотно — забор целиком тёмно-серый:', url);
  }
  parent.add(fenceGroup);

  // ── Сборка одного участка пролёта (секции + замыкающий столб) ──
  function _fenceRun(sx, sz, ux, uz, runLen, angle) {
      const segLen = runLen;
      const a = { x: sx, z: sz };
      if (segLen < 0.3) return;
      const nSec = Math.max(1, Math.round(segLen / FENCE_SECTION_W));
      const secW = segLen / nSec;

      for (let k = 0; k < nSec; k++) {
        const dist = k * secW;
        const x = a.x + ux * dist, z = a.z + uz * dist;
        const key = postKey(x, z);
        const withPost = !postSet.has(key);
        postSet.add(key);
        if (proto) panelsPainted += _fenceModelSection(proto, fenceGroup, x, z, angle, secW, sy, panelMat, frameMat);
        else       _fenceSchematicSection(fenceGroup, x, z, angle, secW, panelH, panelMat, frameMat, withPost);
      }
      // Конец пролёта: столб здесь нужен, только если в этой точке не начинается
      // другой пролёт (на углу ломаной его ставит первая секция следующего
      // пролёта). Решается ПОСЛЕ сборки всех пролётов — на момент сборки этого
      // следующий ещё не размечен, и на углу вырастал лишний столб.
      runEnds.push({ x: a.x + ux * segLen, z: a.z + uz * segLen, angle });
  }

  // ── Створка калитки: ОДНА секция во всю ширину проёма ──
  // Просвета быть не должно (требование продукта 2026-08-28): калитка выглядит как
  // секция забора шириной FENCE_GATE_W3D. От обычной секции отличается тем, что из
  // повторяющихся вертикальных элементов полотна остаётся один.
  function _fenceGateLeaf(sx, sz, ux, uz, len, angle) {
    if (len < 0.2) return;
    const key = postKey(sx, sz);
    const withPost = !postSet.has(key);
    postSet.add(key);
    if (proto) panelsPainted += _fenceModelSection(proto, fenceGroup, sx, sz, angle, len, sy,
                                                   panelMat, frameMat, true);
    else       _fenceSchematicSection(fenceGroup, sx, sz, angle, len, panelH,
                                      panelMat, frameMat, withPost);
    runEnds.push({ x: sx + ux * len, z: sz + uz * len, angle });
  }
}

// Делит пролёт на куски вокруг калитки: [{t0, len, gate?}]. Калитка задана точкой плана
// (S.fenceGate); на пролёт она влияет, только если лежит на нём (в пределах 0.3 м).
// Кусок с gate:true — сама створка: её строит _fenceGateLeaf одной секцией, просвета
// на месте калитки не остаётся.
function _fenceGateSplit(a, ux, uz, segLen, gate) {
  if (!gate) return [{ t0: 0, len: segLen }];
  const vx = gate.x - a.x, vz = gate.z - a.z;
  const t = vx * ux + vz * uz;                                  // проекция на ось пролёта
  const off = Math.hypot(vx - ux * t, vz - uz * t);             // отклонение от оси
  if (off > 0.30 || t < -0.1 || t > segLen + 0.1) return [{ t0: 0, len: segLen }];
  const half = FENCE_GATE_W3D / 2;
  const g0 = Math.max(0, t - half), g1 = Math.min(segLen, t + half);
  const parts = [];
  if (g0 > 0.3) parts.push({ t0: 0, len: g0 });
  if (g1 - g0 > 0.2) parts.push({ t0: g0, len: g1 - g0, gate: true });
  if (segLen - g1 > 0.3) parts.push({ t0: g1, len: segLen - g1 });
  return parts.length ? parts : [{ t0: 0, len: segLen }];
}

