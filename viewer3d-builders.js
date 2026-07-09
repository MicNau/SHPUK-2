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
  _applyBoxUV(bm, 1.0);

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
        _applyBoxUV(child, 2.0, thisOff);
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

function canvasToWorld(pts, houseL, houseW) {
  const gridSize=GRID, offsetX=(gridSize-houseL)/2, offsetZ=(gridSize-houseW)/2;
  return pts.map(p=>({ x:p.x*gridSize-offsetX+_houseBboxMinX, z:p.y*gridSize-offsetZ+_houseBboxMinZ }));
}

// Преобразует S.terraceRects в массив 4-точечных полигонов (canvas-нормированные).
// CCW winding (как ожидает scanline в buildTerrace3d / buildRailing3d).
function _terraceRectsToPolygons() {
  const rects = (typeof S !== 'undefined' && S.terraceRects) ? S.terraceRects : [];
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

// Настил террасы/крыльца по плановому полигону foot (world {x,z}). Призма от земли
// (Y=0) до deckHeight: верх = настил (доски вдоль X или Z), боковые грани = дощатая
// «юбка», низ закрыт. UV world-based (как _applyBoxUV) → непрерывный тайл между
// блоками одинаковой ориентации. На углах составной террасы foot заранее обрезается
// по диагонали (миттер) — доски двух перпендикулярных крыльев сходятся под 45°.
// foot — выпуклый (CCW); диагональные рёбра-стыки внутренние (их «юбка» скрыта телом
// соседнего крыла).
function _buildTerracePoly(parent, M, foot, deckHeight, plankAlongX, meshArrayName) {
  const n = foot.length;
  if (n < 3 || deckHeight < 0.03) return;
  // Нормализуем контур в CCW (в плоскости x,z) — иначе верхняя грань смотрит вниз.
  let area2 = 0;
  for (let k = 0; k < n; k++) { const a = foot[k], b = foot[(k + 1) % n]; area2 += a.x * b.z - b.x * a.z; }
  if (area2 < 0) foot = foot.slice().reverse();
  const T = DECK_TILE, yTop = deckHeight, yBot = 0;
  const topUV = (x, z) => plankAlongX ? [x / T, z / T] : [z / T, x / T];
  const pos = [], uv = [], idx = [];
  for (const p of foot) { pos.push(p.x, yTop, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); } // верх 0..n-1
  for (const p of foot) { pos.push(p.x, yBot, p.z); const t = topUV(p.x, p.z); uv.push(t[0], t[1]); } // низ  n..2n-1
  for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);          // верх (нормаль +Y)
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i, n + i + 1);  // низ  (нормаль −Y)
  // Юбка: на каждое ребро — свой квад (U вдоль ребра, V по высоте → доски горизонтально).
  for (let i = 0; i < n; i++) {
    const a = foot[i], b = foot[(i + 1) % n];
    const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    const uA = (alongX ? a.x : a.z) / T, uB = (alongX ? b.x : b.z) / T;
    const base = pos.length / 3;
    pos.push(a.x, yTop, a.z); uv.push(uA, yTop / T);
    pos.push(b.x, yTop, b.z); uv.push(uB, yTop / T);
    pos.push(b.x, yBot, b.z); uv.push(uB, yBot / T);
    pos.push(a.x, yBot, a.z); uv.push(uA, yBot / T);
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
// Материал создаётся per-build и диспозится в clearGroup(houseGroup, true).
function buildConstructionPad(parent, minX, maxX, minZ, maxZ, offset) {
  const padThick = 0.05;
  const W = (maxX - minX) + 2 * offset;
  const D = (maxZ - minZ) + 2 * offset;
  if (W < 0.3 || D < 0.3) return;
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.0 });
  mat.name = 'mat_construction_pad';
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, padThick, D), mat);
  m.position.set((minX + maxX) / 2, padThick / 2, (minZ + maxZ) / 2);
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

// ── Ограждение террасы: GLB-модуль mod_railing (post / rails / balu_short / balu_floor) ──
// Геометрии запекаются в родном базисе модуля: post центрирован на x=0 (h 0..1.2),
// rails x[0..1]; Y=высота, Z=поперёк. Секция = 1.0 м между осями.
// Балясины — единичные, центрированы в x=0 (сечение 50×50): baluShort (y 0.145..1.055) и
// baluFloor (y 0..1.055, узор «2/5/8 от пола»). Перила (rails) тянем масштабом по длине
// пролёта, балясины — НЕ тянем (иначе плющится сечение): тиражируем нужным числом по шагу ~0.1 м.
let _railingCache = null;       // { post, rails, baluShort, baluFloor }
let _railingLoadPromise = null;
const RAIL_BALU_PITCH = 0.1;    // нативный шаг балясин (центр-центр), м
const RAIL_BALU_INSET = 0.1;    // отступ крайней балясины от оси столба, м
const RAIL_SECTION_W  = 1.0;    // целевая ширина секции (одинакова на всех сегментах), м
const RAIL_POST_MERGE = 0.28;   // столбы ближе этого расстояния считаем одним (дедуп на стыках rect-ов)
let _railPostReg = null;        // общий реестр поставленных столбов [{x,z,tall,mesh}] на проход buildScene3d

function ensureRailingLoaded() {
  if (_railingCache) return Promise.resolve(_railingCache);
  if (_railingLoadPromise) return _railingLoadPromise;
  _railingLoadPromise = new Promise(resolve => {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { resolve(null); return; }
    new THREE.GLTFLoader().load(
      'assets/houses/modules/site/mod_railing.glb?v=2',
      gltf => {
        const c = { post: null, rails: null, baluShort: null, baluFloor: null };
        gltf.scene.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          o.updateWorldMatrix(true, false);
          const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
          const n = (o.name || '').toLowerCase();
          if (n.includes('post')) c.post = g;
          else if (n.includes('balu_floor')) c.baluFloor = g;
          else if (n.includes('balu_short')) c.baluShort = g;
          else if (n.includes('rail')) c.rails = g;
        });
        _railingCache = c; resolve(c);
      },
      undefined,
      err => { console.warn('[railing] не удалось загрузить GLB:', err); resolve(null); }
    );
  });
  return _railingLoadPromise;
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

function buildBeds3d(parent, M, beds, bedH, houseL, houseW) {
  if (!_planterCache || !_planterCache.woodGeo) return;
  const sy = Math.max(0.2, bedH / PLANTER_NATIVE_H);
  // Земля: верх на (bedH - PLANTER_SOIL_GAP), то есть сохраняем родной отступ от борта.
  const soilExtraY = (bedH - PLANTER_SOIL_GAP) - PLANTER_SOIL_TOP * sy;

  for (const b of beds) {
    const worldPts = canvasToWorld([
      { x: b.x,        y: b.y        },
      { x: b.x + b.w,  y: b.y        },
      { x: b.x + b.w,  y: b.y + b.h  },
      { x: b.x,        y: b.y + b.h  },
    ], houseL, houseW);
    const minX = Math.min(...worldPts.map(p => p.x)), maxX = Math.max(...worldPts.map(p => p.x));
    const minZ = Math.min(...worldPts.map(p => p.z)), maxZ = Math.max(...worldPts.map(p => p.z));
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
      _applyDeckUV(tread, bestSide.axisAlong === 'X');
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
    const riser = mesh(box(rdimX, riserH, rdimZ), matStep);
    riser.position.set(rcx, riserCenterY, rcz);
    stairGroup.add(riser);
    threeState.stepMeshes.push(riser);
  }

  // Щёки лестницы (toggle steps-sheathing) — non-convex полигон, повторяющий
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
  const hasSheathing = tgOn('steps-sheathing');
  if (hasSheathing && THREE.ShapeUtils && typeof THREE.ShapeUtils.triangulateShape === 'function') {
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

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts3D, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const cheekMat = matStep.clone ? matStep.clone() : new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.85 });
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
  const hasRailing = tgOn('steps-railing');
  if (hasRailing) {
    const RC = _railingCache;
    if (!(RC && RC.rails && RC.post && RC.baluFloor)) {
      // GLB ещё не загружен — подгружаем и перестраиваем сцену (как для перил террасы).
      ensureRailingLoaded().then(c => { if (c && threeState) buildScene3d(); });
    } else {
      // latOff: перила сдвинуты от краёв ступеней внутрь (на STAIR_RAIL_INSET) — соосны
      // колонне навеса на углу проёма террасы (см. terracePerimeterSegments).
      const latOff = Math.max(0.10, stairWidth / 2 - STAIR_RAIL_INSET);
      const stairRailMat = new THREE.MeshStandardMaterial({ color: PORCH_COLUMN_COLOR, roughness: 0.72, metalness: 0.04 });
      stairRailMat.name = 'mat_railing';
      const up = new THREE.Vector3(0, 1, 0);
      const placeGeo = (geo, m4) => {
        const g = geo.clone(); g.applyMatrix4(m4);
        const mm = mesh(g, stairRailMat); stairGroup.add(mm); threeState.railingMeshes.push(mm);
      };

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
        const B = P1.clone();

        // ── Перила (rails) под рейк: ось X — вдоль ската (наклон), Y — вертикаль (сдвиг) ──
        const slopeVec = new THREE.Vector3().subVectors(B, A);
        const L = slopeVec.length() || 1e-6;
        const xAxis = slopeVec.clone().multiplyScalar(1 / L);
        const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
        const mRail = new THREE.Matrix4().makeBasis(xAxis, up, zAxis);
        mRail.setPosition(A.x, A.y, A.z);
        mRail.multiply(new THREE.Matrix4().makeScale(L, 1, 1));        // тянем по длине ската
        placeGeo(RC.rails, mRail);

        // ── Нижний столб-ньюэл (post), вертикальный, на последней проступи ──
        const mPost = new THREE.Matrix4().makeBasis(headX, up, crossH);
        mPost.setPosition(B.x, B.y, B.z);
        placeGeo(RC.post, mPost);

        // ── Балясины по видимым проступям (i=0..n-2): вертикальные, нативное сечение,
        //    высота по уровню (от проступи до поручня) — учитывает разницу уровней ──
        for (let i = 0; i < n - 1; i++) {
          const off = i * STEP_DEPTH + (RISER_THICKNESS + STEP_DEPTH + STEP_NOSING) / 2; // центр проступи i
          const t = off / stairDepth;
          const bx = topPx + (botPx - topPx) * t;
          const bz = topPz + (botPz - topPz) * t;
          const surfY = bh - (i + 1) * realRise;            // верх проступи i
          const baseLineY = bh + (realRise - bh) * t;       // линия ската на этой проступи
          const baluH = (baseLineY + 1.055) - surfY;        // до низа поручня (как в секции террасы)
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
  stairGroup.updateMatrixWorld(true);
  const _sb = new THREE.Box3().setFromObject(stairGroup);
  if (isFinite(_sb.min.x) && _sb.max.x > _sb.min.x) {
    buildConstructionPad(parent, _sb.min.x, _sb.max.x, _sb.min.z, _sb.max.z, 0.30);
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

// Типовые размеры секции забора. У разных производителей отличаются — поэтому
// вынесены в константы (при желании можно вывести в UI как параметры).
const FENCE_SECTION_W  = 2.0;   // ширина стандартной секции, м
const FENCE_PANEL_H    = 1.4;   // высота полотна секции, м
const FENCE_GROUND_GAP = 0.05;  // просвет под полотном, м
const FENCE_POST_W     = 0.10;  // сечение столба, м
const FENCE_POST_CAP   = 0.10;  // на сколько столб выше полотна, м
const FENCE_PANEL_T    = 0.04;  // толщина полотна, м

// Забор из стандартных секций: каждый пролёт ломаной делится на секции по
// FENCE_SECTION_W; последняя секция — остаток (подрезанная панель). Столбы
// ставятся на границах секций и на углах (дедуплицируются на стыках сегментов).
function buildFence3d(parent,M,pts,houseL,houseW){
  const realPts=pts.filter(p=>!p.break);
  if(realPts.length<2)return;
  const fenceGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  const fenceMat=new THREE.MeshStandardMaterial({color:0x8B7355,roughness:.80,metalness:.05});

  const panelH  = (typeof S !== 'undefined' && S.fenceH) ? S.fenceH : FENCE_PANEL_H; // 1.5 | 1.9 м
  const postH   = FENCE_GROUND_GAP + panelH + FENCE_POST_CAP;
  const panelCY = FENCE_GROUND_GAP + panelH/2;

  // Позиции столбов — дедуплицируются (углы/стыки секций общие у соседних пролётов).
  const postMap = new Map();
  const addPost = (x,z) => { const k = `${x.toFixed(3)},${z.toFixed(3)}`; if(!postMap.has(k)) postMap.set(k,{x,z}); };

  // Разбиваем на сегменты по маркерам break (мультилинейный забор).
  const segments = (typeof splitAtBreaks==='function') ? splitAtBreaks(pts) : [realPts];
  for(const seg of segments){
    if(seg.length<2)continue;
    const worldPts=canvasToWorld(seg,houseL,houseW);
    for(let i=0;i<worldPts.length-1;i++){
      const a=worldPts[i], b=worldPts[i+1];
      const dx=b.x-a.x, dz=b.z-a.z;
      const segLen=Math.hypot(dx,dz);
      if(segLen<.05) continue;
      const ux=dx/segLen, uz=dz/segLen;
      const angle=Math.atan2(dx,dz);

      // Ширины секций: целые по FENCE_SECTION_W + остаток.
      const nFull = Math.floor(segLen/FENCE_SECTION_W + 1e-6);
      const rem   = segLen - nFull*FENCE_SECTION_W;
      const widths = [];
      for(let k=0;k<nFull;k++) widths.push(FENCE_SECTION_W);
      if(rem > 0.05) widths.push(rem);
      if(widths.length===0) widths.push(segLen); // пролёт короче одной секции

      let dist=0;
      addPost(a.x, a.z); // столб в начале пролёта
      for(const w of widths){
        const cd = dist + w/2;
        const cx = a.x + ux*cd, cz = a.z + uz*cd;
        const panelLen = Math.max(0.05, w - FENCE_POST_W); // зазор под столбы
        const panel=meshFn(box(FENCE_PANEL_T,panelH,panelLen),fenceMat);
        panel.position.set(cx, panelCY, cz);
        panel.rotation.y=angle;
        fenceGroup.add(panel); threeState.fenceMeshes.push(panel);
        dist += w;
        addPost(a.x+ux*dist, a.z+uz*dist); // столб на границе секции / в конце пролёта
      }
    }
  }

  // Столбы (после дедупликации).
  for(const {x,z} of postMap.values()){
    const post=meshFn(box(FENCE_POST_W,postH,FENCE_POST_W),M.post);
    post.position.set(x,postH/2,z);
    fenceGroup.add(post);
  }
  parent.add(fenceGroup);
}

