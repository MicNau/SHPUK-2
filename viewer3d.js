// VIEWER3D.JS — Three.js сцена, buildScene3d и все 3D-строители
// Зависимости: state.js, Three.js r128, OrbitControls

// THREE.JS 3D ВИЗУАЛИЗАЦИЯ
// ══════════════════════════════════════════════
let threeState = null; // {renderer, scene, camera, controls, houseGroup, animId}

// Именованные группы для применения материалов
// threeState.wallMeshes = [] — все стеновые mesh'и
// threeState.deckMeshes = [] — все доски террасы (верхняя поверхность)
// threeState.porchMeshes = [] — доски крыльца

function init3dCanvas(targetSlotId) {
  const targetSlot = document.getElementById(targetSlotId || 'three-container');
  if (!targetSlot || typeof THREE === 'undefined') return;

  // Если уже инициализирован — перемещаем renderer в целевой слот и обновляем
  if (threeState) {
    moveThreeTo(targetSlotId);
    // Откладываем resize — слот мог ещё не получить размер
    requestAnimationFrame(() => { resizeThree(); buildScene3d(); });
    return;
  }

  const W = targetSlot.offsetWidth || 360;
  const H = targetSlot.offsetHeight || 360;

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  targetSlot.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:12px;';

  // --- Scene ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(0.65, 0.78, 0.95), 40, 90);

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  camera.position.set(18, 12, 18);

  // --- Controls ---
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(4, 2, 2.5);
  controls.minDistance = 4;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI / 2.05;

  // --- Sky sphere ---
  const skyGeo = new THREE.SphereGeometry(80, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      skyTop:    { value: new THREE.Color(0.25, 0.45, 0.85) },
      skyHoriz:  { value: new THREE.Color(0.65, 0.78, 0.95) },
      ground:    { value: new THREE.Color(0.28, 0.4, 0.22) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 skyTop, skyHoriz, ground;
      varying vec3 vPos;
      void main() {
        float e = vPos.y;
        vec3 col = mix(skyHoriz, skyTop, smoothstep(0.0, 0.5, e));
        col = mix(ground * 0.5, col, smoothstep(-0.05, 0.05, e));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // --- Lights ---
  scene.add(new THREE.AmbientLight(0xfff8e8, 0.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
  sun.shadow.camera.top  =  15; sun.shadow.camera.bottom = -15;
  sun.shadow.camera.near = 1;   sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0003;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.5));

  // --- Ground ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- House group ---
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);

  threeState = { renderer, scene, camera, controls, houseGroup, animId: null,
                 wallMeshes: [], deckMeshes: [], porchMeshes: [],
                 stepMeshes: [], fenceMeshes: [], railingMeshes: [],
                 currentSlot: targetSlotId };

  // --- Animation loop ---
  function animate() {
    threeState.animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  buildScene3d();
}

// Перемещаем canvas Three.js в другой слот
function moveThreeTo(slotId) {
  if (!threeState) return;
  const target = document.getElementById(slotId);
  if (!target) return;
  if (threeState.currentSlot === slotId) return;
  // Перемещаем DOM-элемент renderer'а
  target.appendChild(threeState.renderer.domElement);
  threeState.currentSlot = slotId;
  // Пере-привязываем OrbitControls к новому DOM
  threeState.controls.dispose();
  threeState.controls = new THREE.OrbitControls(threeState.camera, threeState.renderer.domElement);
  threeState.controls.enableDamping = true;
  threeState.controls.dampingFactor = 0.08;
  threeState.controls.minDistance = 4;
  threeState.controls.maxDistance = 50;
  threeState.controls.maxPolarAngle = Math.PI / 2.05;
  // Восстанавливаем target чтобы камера смотрела на дом
  const area2 = parseFloat(document.getElementById('v-area')?.value || 120);
  const houseW2 = Math.sqrt(area2 / 1.6), houseL2 = houseW2 * 1.6;
  const bh2 = parseFloat(document.getElementById('v-found')?.value || 80) / 100;
  const wh2 = Math.min(Math.max(parseFloat(document.getElementById('v-floor')?.value || 400) / 100, 2), 5);
  threeState.controls.target.set(houseL2/2, (bh2+wh2)/2, houseW2/2);
  threeState.controls.update();
}

function resizeThree() {
  if (!threeState) return;
  const wrap = document.getElementById(threeState.currentSlot);
  if (!wrap) return;
  const W = wrap.offsetWidth, H = wrap.offsetHeight;
  if (!W || !H) return;
  const { renderer, camera } = threeState;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
}

// Вызывается при изменении параметров на шагах 2-4
let paramChangeTimer = null;
function onParamChange() {
  clearTimeout(paramChangeTimer);
  paramChangeTimer = setTimeout(() => {
    if (threeState) buildScene3d();
  }, 150);
}

// ══════════════════════════════════════════════
// SHARED 3D MATERIALS
// ══════════════════════════════════════════════
function getHouseMats() {
  return {
    wall:   new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.85, metalness: 0.02 }),
    base:   new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.90, metalness: 0.05 }),
    roof:   new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.70, metalness: 0.10, side: THREE.DoubleSide }),
    glass:  new THREE.MeshStandardMaterial({ color: 0x6baed6, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.6 }),
    frame:  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.40, metalness: 0.15 }),
    door:   new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.75, metalness: 0.05 }),
    // Терраса / крыльцо
    deck:   new THREE.MeshStandardMaterial({ color: 0xC8A96E, roughness: 0.72, metalness: 0.02 }),
    joist:  new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.85, metalness: 0.15 }),
    post:   new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.80, metalness: 0.20 }),
    step:   new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.80, metalness: 0.05 }),
  };
}

// ══════════════════════════════════════════════
// MAIN SCENE BUILDER
// ══════════════════════════════════════════════
function buildScene3d() {
  if (!threeState || typeof THREE === 'undefined') return;
  const { houseGroup, controls } = threeState;

  // Clear everything
  clearGroup(houseGroup);
  threeState.wallMeshes = [];
  threeState.deckMeshes = [];
  threeState.porchMeshes = [];
  threeState.stepMeshes = [];
  threeState.fenceMeshes = [];
  threeState.railingMeshes = [];

  const M = getHouseMats();

  // Apply active sample color to relevant section
  if (S.activeSample && S.activeSample.color) {
    const sec = getActive()[S.curSec];
    const secId = sec ? sec.id : 'terrace';
    if (secId === 'facade') {
      M.wall.color.set(S.activeSample.color);
    } else if (secId === 'porch') {
      M.step.color.set(S.activeSample.color);
    } else {
      M.deck.color.set(S.activeSample.color);
    }
  }

  const isNoHouse = (S.houseType === 'Участок без дома');

  // Pull params
  const area      = parseFloat(document.getElementById('v-area')?.value || 120);
  const wallH     = parseFloat(document.getElementById('v-floor')?.value || 400) / 100;
  const foundH    = parseFloat(document.getElementById('v-found')?.value || 80) / 100;
  const RATIO     = 1.6;
  const wt        = 0.2;

  const houseW = Math.sqrt(area / RATIO);
  const houseL = houseW * RATIO;
  const wh     = Math.min(Math.max(wallH, 2), 5);
  const bh     = Math.max(foundH, 0.1);

  // ── BUILD HOUSE ──
  if (!isNoHouse) {
    buildHouseMeshes(houseGroup, M, houseL, houseW, wh, bh, wt);
  }

  // ── BUILD TERRACE ──
  if (S.sections.includes('terrace') && S.pts.terrace.length >= 3) {
    const terraceH = isNoHouse ? 0.35 : bh;
    buildTerrace3d(houseGroup, M, S.pts.terrace, terraceH, houseL, houseW, 'deckMeshes');
  }

  // ── BUILD POOL TERRACE ──
  if (S.sections.includes('pool_terrace') && S.pts.pool_terrace.length >= 3) {
    const terraceH = isNoHouse ? 0.35 : bh;
    buildTerrace3d(houseGroup, M, S.pts.pool_terrace, terraceH, houseL, houseW, 'deckMeshes');
  }

  // ── BUILD PIER ──
  if (S.sections.includes('pier') && S.pts.pier.length >= 3) {
    buildTerrace3d(houseGroup, M, S.pts.pier, 0.5, houseL, houseW, 'deckMeshes');
  }

  // ── BUILD PATHS ──
  if (S.sections.includes('paths') && S.pts.paths.length >= 2) {
    buildPaths3d(houseGroup, M, S.pts.paths, houseL, houseW);
  }

  // ── BUILD PORCH ──
  if (S.sections.includes('porch') && !isNoHouse) {
    buildPorch3d(houseGroup, M, S.porch, houseL, houseW, bh);
  }

  // ── BUILD FENCE ──
  if (S.sections.includes('fence') && S.pts.fence.length >= 2) {
    buildFence3d(houseGroup, M, S.pts.fence, houseL, houseW);
  }

  // ── BUILD TERRACE RAILING (по тоглу «Нужно ограждение» на шаге террасы) ──
  const terraceRailingOn = document.querySelector('.tg[data-id="terrace-railing"]')?.classList.contains('on');
  if (terraceRailingOn && S.pts.terrace.length >= 3) {
    const terraceH = isNoHouse ? 0.35 : bh;
    buildRailing3d(houseGroup, M, S.pts.terrace, terraceH, houseL, houseW);
  }

  // Center camera
  const cx = isNoHouse ? 0 : houseL/2;
  const cy = isNoHouse ? 1 : (bh+wh)/2;
  const cz = isNoHouse ? 0 : houseW/2;
  controls.target.set(cx, cy, cz);
  controls.update();
}

function clearGroup(group) {
  while (group.children.length) {
    const c = group.children[0];
    group.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.children) clearGroup(c);
  }
}

// ══════════════════════════════════════════════
// HOUSE BUILDER (дом — существующая логика)
// ══════════════════════════════════════════════
function buildHouseMeshes(parent, M, length, width, wh, bh, wt) {
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  // Basement
  const bm = mesh(box(length + 0.2, bh, width + 0.2), M.base);
  bm.position.set(length/2, bh/2, width/2);
  parent.add(bm);

  // Window / door constants
  const WWIN = 0.9, HWIN = 1.2, YWIN = 1.0;
  const WDOOR = 1.0, HDOOR = 2.2;

  function xWallWithWins(len, wins) {
    const g = new THREE.Group();
    const sorted = [...wins].sort((a,b)=>a.x-b.x);
    const botH = sorted.length ? Math.min(...sorted.map(w=>w.y)) : wh;
    const topStart = sorted.length ? Math.max(...sorted.map(w=>w.y+w.h)) : wh;
    if (botH > 0.01) { const m=mesh(box(len,botH,wt),M.wall); m.position.set(len/2,botH/2,wt/2); g.add(m); threeState.wallMeshes.push(m); }
    if (wh - topStart > 0.01) { const m=mesh(box(len,wh-topStart,wt),M.wall); m.position.set(len/2,topStart+(wh-topStart)/2,wt/2); g.add(m); threeState.wallMeshes.push(m); }
    let prev=0;
    for (const w of sorted) {
      if (w.x-prev>0.01) { const m=mesh(box(w.x-prev,topStart-botH,wt),M.wall); m.position.set(prev+(w.x-prev)/2,botH+(topStart-botH)/2,wt/2); g.add(m); threeState.wallMeshes.push(m); }
      const gm=new THREE.Mesh(box(w.w,w.h,wt*0.3),M.glass); gm.position.set(w.x+w.w/2,w.y+w.h/2,wt/2); g.add(gm);
      const ft=0.04, fd=wt+0.06;
      [[w.w+ft*2,ft,fd,w.x+w.w/2,w.y+w.h+ft/2],[w.w+ft*2,ft,fd,w.x+w.w/2,w.y-ft/2],
       [ft,w.h,fd,w.x-ft/2,w.y+w.h/2],[ft,w.h,fd,w.x+w.w+ft/2,w.y+w.h/2],
       [w.w,ft*0.7,fd*0.7,w.x+w.w/2,w.y+w.h/2],[ft*0.7,w.h,fd*0.7,w.x+w.w/2,w.y+w.h/2]
      ].forEach(([sx,sy,sz,px,py])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,wt/2); g.add(m); });
      prev=w.x+w.w;
    }
    if (len-prev>0.01) { const m=mesh(box(len-prev,topStart-botH,wt),M.wall); m.position.set(prev+(len-prev)/2,botH+(topStart-botH)/2,wt/2); g.add(m); threeState.wallMeshes.push(m); }
    return g;
  }

  function zWallWithDoor(zLen, hasDoor, hasWins) {
    const g = new THREE.Group();
    const holes = [];
    if (hasDoor) { const dz = zLen/2 - WDOOR/2; holes.push({z:dz,y:0,w:WDOOR,h:HDOOR,isDoor:true}); }
    if (hasWins) {
      const dz = zLen/2 - WDOOR/2;
      const leftC = (dz - 0.3) / 2 - WWIN/2;
      if (leftC >= 0.1) holes.push({z:leftC, y:YWIN, w:WWIN, h:HWIN});
      const rightC = (dz+WDOOR+0.3 + zLen)/2 - WWIN/2;
      if (rightC+WWIN <= zLen-0.1) holes.push({z:rightC, y:YWIN, w:WWIN, h:HWIN});
    }
    if (!holes.length) { const m=mesh(box(wt,wh,zLen),M.wall); m.position.set(wt/2,wh/2,zLen/2); g.add(m); threeState.wallMeshes.push(m); return g; }
    const sorted=[...holes].sort((a,b)=>a.z-b.z);
    const topS = Math.max(...sorted.map(h=>h.y+h.h));
    if (wh-topS>0.01){ const m=mesh(box(wt,wh-topS,zLen),M.wall); m.position.set(wt/2,topS+(wh-topS)/2,zLen/2); g.add(m); threeState.wallMeshes.push(m); }
    let prev=0;
    for (const h of sorted) {
      if (h.z-prev>0.01){ const m=mesh(box(wt,topS,h.z-prev),M.wall); m.position.set(wt/2,topS/2,prev+(h.z-prev)/2); g.add(m); threeState.wallMeshes.push(m); }
      if (h.y>0.01){ const m=mesh(box(wt,h.y,h.w),M.wall); m.position.set(wt/2,h.y/2,h.z+h.w/2); g.add(m); threeState.wallMeshes.push(m); }
      const fillerH=topS-(h.y+h.h);
      if (fillerH>0.01){ const m=mesh(box(wt,fillerH,h.w),M.wall); m.position.set(wt/2,(h.y+h.h)+fillerH/2,h.z+h.w/2); g.add(m); threeState.wallMeshes.push(m); }
      const fm=new THREE.Mesh(box(wt*0.3,h.h,h.w), h.isDoor?M.door:M.glass);
      fm.position.set(wt/2,h.y+h.h/2,h.z+h.w/2); g.add(fm);
      const ft=0.04,fd=wt+0.08;
      if (!h.isDoor) {
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],[fd,ft,h.w+ft*2,wt/2,h.y-ft/2,h.z+h.w/2],
         [fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2],
         [fd*0.7,ft*0.7,h.w,wt/2,h.y+h.h/2,h.z+h.w/2],[fd*0.7,h.h,ft*0.7,wt/2,h.y+h.h/2,h.z+h.w/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); g.add(m); });
      } else {
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); g.add(m); });
      }
      prev=h.z+h.w;
    }
    if (zLen-prev>0.01){ const m=mesh(box(wt,topS,zLen-prev),M.wall); m.position.set(wt/2,topS/2,prev+(zLen-prev)/2); g.add(m); threeState.wallMeshes.push(m); }
    return g;
  }

  const winCount = Math.max(0, Math.round(length / (WWIN * 2.9)));
  const winIndent = winCount > 0 ? (length - winCount * WWIN) / (winCount + 1) : length;
  const wins = [];
  for (let i=0;i<winCount;i++) wins.push({x: winIndent + (WWIN + winIndent)*i, y:YWIN, w:WWIN, h:HWIN});

  const lw = xWallWithWins(length, wins); lw.position.set(0, bh, 0); parent.add(lw);
  const rw = xWallWithWins(length, wins); rw.position.set(0, bh, width - wt); parent.add(rw);
  const zInner = width - wt*2;
  const bk = zWallWithDoor(zInner, false, true); bk.position.set(0, bh, wt); parent.add(bk);
  const fw = zWallWithDoor(zInner, true, true); fw.position.set(length-wt, bh, wt); parent.add(fw);

  // Roof
  const rh = 2.0, oh=0.3;
  const x0=-oh, x1=length+oh, z0=-oh, z1=width+oh, zMid=width/2;
  const yBase=bh+wh, yPeak=bh+wh+rh;
  const verts = new Float32Array([
    x0,yBase,z0, x1,yBase,z0, x1,yPeak,zMid,  x0,yBase,z0, x1,yPeak,zMid, x0,yPeak,zMid,
    x0,yBase,z1, x0,yPeak,zMid, x1,yPeak,zMid, x0,yBase,z1, x1,yPeak,zMid, x1,yBase,z1,
    x1,yBase,z0, x1,yBase,z1, x1,yPeak,zMid,
    x0,yBase,z1, x0,yBase,z0, x0,yPeak,zMid,
    x0,yBase,z0, x0,yBase,z1, x1,yBase,z1, x0,yBase,z0, x1,yBase,z1, x1,yBase,z0,
  ]);
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  roofGeo.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roofGeo, M.roof);
  roofMesh.castShadow = true;
  parent.add(roofMesh);
}

// ══════════════════════════════════════════════
// TERRACE BUILDER
// ══════════════════════════════════════════════
// Преобразование нормализованных точек (0..1 из canvas) в мировые координаты
// Canvas: 16×16м сетка. Дом центрирован на canvas.
// 3D: дом от (0, 0, 0) до (houseL, _, houseW).
// Нужно: canvas-coord дома → 3D-coord дома (совпадение)
function canvasToWorld(pts, houseL, houseW) {
  const gridSize = GRID;
  // Дом на canvas начинается в (centerX - houseL/2, centerY - houseW/2)
  // В нормализованных: ((gridSize - houseL)/2 / gridSize, ...)
  // В 3D дом начинается в (0, 0)
  // Смещение: worldX = canvasX_meters - houseOffsetX_meters
  const offsetX = (gridSize - houseL) / 2;
  const offsetZ = (gridSize - houseW) / 2;
  return pts.map(p => ({
    x: p.x * gridSize - offsetX,  // относительно начала дома
    z: p.y * gridSize - offsetZ   // canvas Y → world Z
  }));
}

function buildTerrace3d(parent, M, pts, deckHeight, houseL, houseW, meshArrayName) {
  if (pts.length < 3) return;
  const trackArray = meshArrayName || 'deckMeshes';

  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  const worldPts = canvasToWorld(pts, houseL, houseW);

  // Bounding box
  const minX = Math.min(...worldPts.map(p=>p.x));
  const maxX = Math.max(...worldPts.map(p=>p.x));
  const minZ = Math.min(...worldPts.map(p=>p.z));
  const maxZ = Math.max(...worldPts.map(p=>p.z));
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  if (spanX < 0.3 || spanZ < 0.3) return; // слишком маленькая

  // Проверка точки внутри полигона (ray casting)
  function pointInPoly(px, pz) {
    let inside = false;
    for (let i=0, j=worldPts.length-1; i<worldPts.length; j=i++) {
      const xi=worldPts[i].x, zi=worldPts[i].z;
      const xj=worldPts[j].x, zj=worldPts[j].z;
      if ((zi > pz) !== (zj > pz) && px < (xj-xi)*(pz-zi)/(zj-zi)+xi) inside = !inside;
    }
    return inside;
  }

  const boardW = 0.14;   // ширина доски 140мм
  const boardH = 0.022;  // толщина 22мм
  const gap    = 0.005;  // зазор 5мм
  const joistH = 0.05;   // высота лаги
  const joistW = 0.05;   // ширина лаги
  const joistStep = 0.4; // шаг лаг
  const postW  = 0.08;   // сечение опоры
  const postStep = 1.0;  // шаг опор

  const deckY = deckHeight;          // верх настила
  const boardBot = deckY - boardH;   // низ доски
  const joistBot = boardBot - joistH;// низ лаги

  const terraceGroup = new THREE.Group();

  // ── ОПОРЫ (posts) ──
  for (let px = minX + postStep/2; px <= maxX; px += postStep) {
    for (let pz = minZ + postStep/2; pz <= maxZ; pz += postStep) {
      if (!pointInPoly(px, pz)) continue;
      const ph = joistBot; // от земли до низа лаг
      if (ph < 0.05) continue;
      const post = mesh(box(postW, ph, postW), M.post);
      post.position.set(px, ph/2, pz);
      terraceGroup.add(post);
    }
  }

  // ── ЛАГИ (joists) — вдоль X ──
  for (let jz = minZ + joistStep/2; jz <= maxZ; jz += joistStep) {
    // Найти пересечения линии z=jz с полигоном
    const intersections = [];
    for (let i=0, j=worldPts.length-1; i<worldPts.length; j=i++) {
      const z1=worldPts[j].z, z2=worldPts[i].z;
      const x1=worldPts[j].x, x2=worldPts[i].x;
      if ((z1<=jz && z2>jz) || (z2<=jz && z1>jz)) {
        const t = (jz - z1) / (z2 - z1);
        intersections.push(x1 + t*(x2-x1));
      }
    }
    intersections.sort((a,b)=>a-b);
    // Рисуем лаги между парами пересечений
    for (let k=0; k<intersections.length-1; k+=2) {
      const x1 = intersections[k], x2 = intersections[k+1];
      const len = x2 - x1;
      if (len < 0.1) continue;
      const j = mesh(box(len, joistH, joistW), M.joist);
      j.position.set(x1 + len/2, joistBot + joistH/2, jz);
      terraceGroup.add(j);
    }
  }

  // ── ДОСКИ (boards) — вдоль Z ──
  for (let bx = minX + boardW/2; bx <= maxX; bx += boardW + gap) {
    // Найти пересечения линии x=bx с полигоном
    const intersections = [];
    for (let i=0, j=worldPts.length-1; i<worldPts.length; j=i++) {
      const x1=worldPts[j].x, x2=worldPts[i].x;
      const z1=worldPts[j].z, z2=worldPts[i].z;
      if ((x1<=bx && x2>bx) || (x2<=bx && x1>bx)) {
        const t = (bx - x1) / (x2 - x1);
        intersections.push(z1 + t*(z2-z1));
      }
    }
    intersections.sort((a,b)=>a-b);
    for (let k=0; k<intersections.length-1; k+=2) {
      const z1 = intersections[k], z2 = intersections[k+1];
      const len = z2 - z1;
      if (len < 0.05) continue;
      const b = mesh(box(boardW, boardH, len), M.deck);
      b.position.set(bx, boardBot + boardH/2, z1 + len/2);
      terraceGroup.add(b);
      threeState[trackArray].push(b);
    }
  }

  parent.add(terraceGroup);
}

// ══════════════════════════════════════════════
// PORCH BUILDER
// ══════════════════════════════════════════════
function buildPorch3d(parent, M, porch, houseL, houseW, bh) {
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  const gridSize = GRID;
  const offsetX = (gridSize - houseL) / 2;
  const offsetZ = (gridSize - houseW) / 2;

  // Крыльцо в мировых координатах (та же система, что canvasToWorld)
  const px = porch.x * gridSize - offsetX;
  const pz = porch.y * gridSize - offsetZ;
  const pw = porch.w * gridSize;
  const pd = porch.h * gridSize;

  if (pw < 0.2 || pd < 0.2) return;

  const porchGroup = new THREE.Group();

  // Определяем направление ступеней: от ближайшей стены дома наружу
  // Дом в 3D: X от 0 до houseL, Z от 0 до houseW
  // Центр крыльца
  const cx = px + pw/2;
  const cz = pz + pd/2;

  // Расстояние до каждой стены дома
  const distFront = Math.abs(cz - houseW);  // передняя стена (Z = houseW)
  const distBack  = Math.abs(cz);           // задняя стена (Z = 0)
  const distRight = Math.abs(cx - houseL);  // правая стена (X = houseL)
  const distLeft  = Math.abs(cx);           // левая стена (X = 0)
  const minDist = Math.min(distFront, distBack, distRight, distLeft);

  // Направление ступеней (dx, dz) — от дома наружу
  let stepDirX = 0, stepDirZ = 0;
  if (minDist === distFront) stepDirZ = 1;      // ступени идут в +Z
  else if (minDist === distBack) stepDirZ = -1;  // ступени идут в -Z
  else if (minDist === distRight) stepDirX = 1;  // ступени идут в +X
  else stepDirX = -1;                            // ступени идут в -X

  // Параметры ступеней
  const stepH = 0.17;
  const stepD = 0.28;
  const boardH = 0.022;
  const nSteps = Math.max(1, Math.round(bh / stepH));
  const actualStepH = bh / nSteps;

  // ── ПЛОЩАДКА — доски ──
  const boardW = 0.14;
  const gap = 0.005;

  // Доски на площадке: всегда перпендикулярны ступеням
  if (stepDirZ !== 0) {
    // Ступени идут по Z → доски идут по X
    for (let bx = px + boardW/2; bx <= px + pw; bx += boardW + gap) {
      const b = mesh(box(boardW, boardH, pd), M.deck);
      b.position.set(bx, bh - boardH/2, pz + pd/2);
      porchGroup.add(b);
      threeState.porchMeshes.push(b);
    }
  } else {
    // Ступени идут по X → доски идут по Z
    for (let bz = pz + boardW/2; bz <= pz + pd; bz += boardW + gap) {
      const b = mesh(box(pw, boardH, boardW), M.deck);
      b.position.set(px + pw/2, bh - boardH/2, bz);
      porchGroup.add(b);
      threeState.porchMeshes.push(b);
    }
  }

  // ── СТУПЕНИ — спускаются от площадки к земле ──
  for (let i = 0; i < nSteps; i++) {
    const sy = actualStepH;
    const yBot = bh - (i+1) * actualStepH; // сверху вниз
    let sx, sz, sxPos, szPos;

    if (stepDirZ !== 0) {
      // Ступени по оси Z
      sx = pw; sz = stepD;
      sxPos = px + pw/2;
      szPos = stepDirZ > 0
        ? (pz + pd + i * stepD + stepD/2)    // вперёд от площадки
        : (pz - i * stepD - stepD/2);         // назад от площадки
    } else {
      // Ступени по оси X
      sx = stepD; sz = pd;
      szPos = pz + pd/2;
      sxPos = stepDirX > 0
        ? (px + pw + i * stepD + stepD/2)
        : (px - i * stepD - stepD/2);
    }

    const s = mesh(box(sx, sy, sz), M.step);
    s.position.set(sxPos, yBot + sy/2, szPos);
    porchGroup.add(s);
    threeState.stepMeshes.push(s);
  }

  // ── Боковые стенки ──
  const sideW = 0.06;
  if (stepDirZ !== 0) {
    const ls = mesh(box(sideW, bh, pd), M.base);
    ls.position.set(px, bh/2, pz + pd/2);
    porchGroup.add(ls);
    const rs = mesh(box(sideW, bh, pd), M.base);
    rs.position.set(px + pw, bh/2, pz + pd/2);
    porchGroup.add(rs);
  } else {
    const ls = mesh(box(pw, bh, sideW), M.base);
    ls.position.set(px + pw/2, bh/2, pz);
    porchGroup.add(ls);
    const rs = mesh(box(pw, bh, sideW), M.base);
    rs.position.set(px + pw/2, bh/2, pz + pd);
    porchGroup.add(rs);
  }

  parent.add(porchGroup);
}

// ══════════════════════════════════════════════
// PATHS BUILDER (дорожки)
// ══════════════════════════════════════════════
function buildPaths3d(parent, M, pts, houseL, houseW) {
  if (pts.length < 2) return;
  const worldPts = canvasToWorld(pts, houseL, houseW);
  const pathWidthCm = parseFloat(document.getElementById('v-paths-width')?.value || 120);
  const pathW = pathWidthCm / 100;
  const boardW = 0.14, boardH = 0.022, gap = 0.005;
  const pathGroup = new THREE.Group();
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const meshFn = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  for (let i = 0; i < worldPts.length - 1; i++) {
    const a = worldPts[i], b = worldPts[i+1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const segLen = Math.sqrt(dx*dx + dz*dz);
    if (segLen < 0.1) continue;
    const angle = Math.atan2(dx, dz);
    // Доски перпендикулярно направлению дорожки
    for (let d = boardW/2; d < segLen; d += boardW + gap) {
      const t = d / segLen;
      const bx = a.x + dx*t, bz = a.z + dz*t;
      const bd = meshFn(box(pathW, boardH, boardW), M.deck);
      bd.position.set(bx, boardH/2, bz);
      bd.rotation.y = angle;
      pathGroup.add(bd);
      threeState.deckMeshes.push(bd);
    }
  }
  parent.add(pathGroup);
}

// ══════════════════════════════════════════════
// FENCE BUILDER (забор)
// ══════════════════════════════════════════════
function buildFence3d(parent, M, pts, houseL, houseW) {
  if (pts.length < 2) return;
  const worldPts = canvasToWorld(pts, houseL, houseW);
  const fenceH = 1.8, postW = 0.1, postH = fenceH + 0.2;
  const boardW = 0.12, boardH = fenceH - 0.2, boardT = 0.02;
  const fenceGroup = new THREE.Group();
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const meshFn = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.80, metalness: 0.05 });

  for (let i = 0; i < worldPts.length; i++) {
    // Столб
    const p = worldPts[i];
    const post = meshFn(box(postW, postH, postW), M.post);
    post.position.set(p.x, postH/2, p.z);
    fenceGroup.add(post);

    // Секция забора до следующего столба
    if (i < worldPts.length - 1) {
      const a = worldPts[i], b = worldPts[i+1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const segLen = Math.sqrt(dx*dx + dz*dz);
      if (segLen < 0.2) continue;
      const angle = Math.atan2(dx, dz);
      const mx = (a.x + b.x)/2, mz = (a.z + b.z)/2;
      const panel = meshFn(box(boardT, boardH, segLen - postW), fenceMat);
      panel.position.set(mx, 0.2 + boardH/2, mz);
      panel.rotation.y = angle;
      fenceGroup.add(panel);
      threeState.fenceMeshes.push(panel);
    }
  }
  // Замыкающая секция если 3+ точек
  if (worldPts.length >= 3) {
    const a = worldPts[worldPts.length-1], b = worldPts[0];
    const dx = b.x - a.x, dz = b.z - a.z;
    const segLen = Math.sqrt(dx*dx + dz*dz);
    if (segLen > 0.2) {
      const angle = Math.atan2(dx, dz);
      const mx = (a.x + b.x)/2, mz = (a.z + b.z)/2;
      const panel = meshFn(box(boardT, boardH, segLen - postW), fenceMat);
      panel.position.set(mx, 0.2 + boardH/2, mz);
      panel.rotation.y = angle;
      fenceGroup.add(panel);
      threeState.fenceMeshes.push(panel);
    }
  }
  parent.add(fenceGroup);
}

// ══════════════════════════════════════════════
// RAILING BUILDER (ограждение террасы)
// ══════════════════════════════════════════════
function buildRailing3d(parent, M, pts, deckHeight, houseL, houseW) {
  if (pts.length < 3) return;
  const worldPts = canvasToWorld(pts, houseL, houseW);
  const railH = 1.0, railW = 0.05, postW = 0.06;
  const railGroup = new THREE.Group();
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const meshFn = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const railMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.60, metalness: 0.3 });

  // Зона крыльца в мировых координатах
  let porchRect = null;
  if (S.sections.includes('porch')) {
    const gridSize = GRID;
    const offsetX = (gridSize - houseL) / 2;
    const offsetZ = (gridSize - houseW) / 2;
    const p = S.porch;
    const px1 = p.x * gridSize - offsetX;
    const pz1 = p.y * gridSize - offsetZ;
    const px2 = (p.x + p.w) * gridSize - offsetX;
    const pz2 = (p.y + p.h) * gridSize - offsetZ;
    porchRect = {
      minX: Math.min(px1, px2), maxX: Math.max(px1, px2),
      minZ: Math.min(pz1, pz2), maxZ: Math.max(pz1, pz2),
    };
  }

  // Разбивает отрезок A→B на подотрезки, вырезая пересечение с porchRect
  function splitAroundPorch(ax, az, bx, bz) {
    if (!porchRect) return [{ ax, az, bx, bz }];
    const pr = porchRect;
    const pad = 0.08;
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx*dx + dz*dz);
    if (len < 0.01) return [{ ax, az, bx, bz }];

    // Параметрический t ∈ [0,1]: P(t) = A + t·(B-A)
    let tEnter = 0, tExit = 1;

    if (Math.abs(dx) > 0.001) {
      const t1 = (pr.minX - pad - ax) / dx;
      const t2 = (pr.maxX + pad - ax) / dx;
      tEnter = Math.max(tEnter, Math.min(t1, t2));
      tExit  = Math.min(tExit,  Math.max(t1, t2));
    } else if (ax < pr.minX - pad || ax > pr.maxX + pad) {
      return [{ ax, az, bx, bz }]; // мимо по X
    }

    if (Math.abs(dz) > 0.001) {
      const t1 = (pr.minZ - pad - az) / dz;
      const t2 = (pr.maxZ + pad - az) / dz;
      tEnter = Math.max(tEnter, Math.min(t1, t2));
      tExit  = Math.min(tExit,  Math.max(t1, t2));
    } else if (az < pr.minZ - pad || az > pr.maxZ + pad) {
      return [{ ax, az, bx, bz }]; // мимо по Z
    }

    if (tEnter >= tExit || tExit <= 0 || tEnter >= 1) return [{ ax, az, bx, bz }];

    const tc0 = Math.max(0, tEnter);
    const tc1 = Math.min(1, tExit);
    const result = [];
    if (tc0 > 0.02)
      result.push({ ax, az, bx: ax + dx*tc0, bz: az + dz*tc0 });
    if (tc1 < 0.98)
      result.push({ ax: ax + dx*tc1, az: az + dz*tc1, bx, bz });
    return result;
  }

  // Рисует перила на подотрезке со столбиками на обоих концах
  function drawRailSeg(a_x, a_z, b_x, b_z) {
    const sdx = b_x - a_x, sdz = b_z - a_z;
    const sLen = Math.sqrt(sdx*sdx + sdz*sdz);
    if (sLen < 0.1) return;

    // Столбики
    for (const [px2, pz2] of [[a_x, a_z], [b_x, b_z]]) {
      const p = meshFn(box(postW, railH, postW), railMat);
      p.position.set(px2, deckHeight + railH/2, pz2);
      railGroup.add(p);
      threeState.railingMeshes.push(p);
    }

    const angle = Math.atan2(sdx, sdz);
    const mx = (a_x + b_x)/2, mz = (a_z + b_z)/2;
    for (const hFrac of [1.0, 0.5]) {
      const bar = meshFn(box(railW, railW, sLen), railMat);
      bar.position.set(mx, deckHeight + railH * hFrac, mz);
      bar.rotation.y = angle;
      railGroup.add(bar);
      threeState.railingMeshes.push(bar);
    }
  }

  for (let i = 0; i < worldPts.length; i++) {
    const cur = worldPts[i];
    const next = worldPts[(i+1) % worldPts.length];
    const subSegs = splitAroundPorch(cur.x, cur.z, next.x, next.z);
    for (const seg of subSegs) {
      drawRailSeg(seg.ax, seg.az, seg.bx, seg.bz);
    }
  }
  parent.add(railGroup);
}

// ══════════════════════════════════════════════
// MATERIAL APPLICATION (примерка)
// ══════════════════════════════════════════════
function applyMaterialToScene(colorHex) {
  if (!threeState || !colorHex) return;
  const c = new THREE.Color(colorHex);

  // Определяем текущую секцию
  const sec = getActive()[S.curSec];
  const secId = sec ? sec.id : 'terrace';

  let targetMeshes = [];
  let roughness = 0.72;

  if (secId === 'facade') {
    targetMeshes = threeState.wallMeshes || [];
    roughness = 0.85;
  } else if (secId === 'porch') {
    targetMeshes = threeState.stepMeshes || [];
    roughness = 0.80;
  } else if (secId === 'fence') {
    targetMeshes = threeState.fenceMeshes || [];
    roughness = 0.80;
  } else {
    // terrace, pool_terrace, pier, paths, beds, furniture → доски настила
    targetMeshes = [...(threeState.deckMeshes||[]), ...(threeState.porchMeshes||[])];
  }

  if (targetMeshes.length === 0) {
    buildScene3d();
    return;
  }

  const newMat = new THREE.MeshStandardMaterial({ color: c, roughness, metalness: 0.02 });
  targetMeshes.forEach(m => {
    if (m.material) m.material.dispose();
    m.material = newMat;
  });
}

function rot(dir) { /* orbit controls handle rotation, kept for compat */ }

// ══════════════════════════════════════════════
