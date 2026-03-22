// ══════════════════════════════════════════════
// VIEWER3D.JS — Three.js параметрическая модель дома
// Зависимости: state.js (S), Three.js r128, OrbitControls
// ══════════════════════════════════════════════

let threeState = null; // {renderer, scene, camera, controls, houseGroup, animId}

function init3dCanvas() {
  const wrap = document.getElementById('three-container');
  if (!wrap || typeof THREE === 'undefined') return;

  // Уже инициализирован — обновляем размер и перестраиваем дом
  if (threeState) {
    resizeThree();
    buildHouse3d();
    return;
  }

  const W = wrap.offsetWidth || 360;
  const H = wrap.offsetHeight || 360;

  // ── Renderer ─────────────────────────────────
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  wrap.appendChild(renderer.domElement);
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:12px;';

  // ── Scene ─────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(0.65, 0.78, 0.95), 40, 90);

  // ── Camera ────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  camera.position.set(18, 12, 18);

  // ── Controls ──────────────────────────────────
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(4, 2, 2.5);
  controls.minDistance = 4;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI / 2.05;

  // ── Sky sphere (процедурный градиент) ─────────
  const skyGeo = new THREE.SphereGeometry(80, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      skyTop:   {value: new THREE.Color(0.25, 0.45, 0.85)},
      skyHoriz: {value: new THREE.Color(0.65, 0.78, 0.95)},
      ground:   {value: new THREE.Color(0.28, 0.4, 0.22)},
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
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // ── Lights ────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xfff8e8, 0.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -15; sun.shadow.camera.right = 15;
  sun.shadow.camera.top    =  15; sun.shadow.camera.bottom = -15;
  sun.shadow.camera.near   = 1;   sun.shadow.camera.far   = 50;
  sun.shadow.bias = -0.0003;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.5));

  // ── Ground ────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({color: 0x4a7c3f, roughness: 0.95, metalness: 0}),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── House group ───────────────────────────────
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);

  threeState = {renderer, scene, camera, controls, houseGroup, animId: null};

  // ── Animation loop ────────────────────────────
  function animate() {
    threeState.animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  buildHouse3d();

  // Убираем подсказку через 4 с
  setTimeout(() => {
    const h = document.getElementById('three-hint');
    if (h) { h.style.transition = 'opacity 1s'; h.style.opacity = '0'; }
  }, 4000);
}

function resizeThree() {
  if (!threeState) return;
  const wrap = document.getElementById('three-container');
  if (!wrap) return;
  const W = wrap.offsetWidth, H = wrap.offsetHeight;
  threeState.camera.aspect = W / H;
  threeState.camera.updateProjectionMatrix();
  threeState.renderer.setSize(W, H);
}

// ── Материалы (создаются каждый вызов, недорого) ──
function getHouseMats() {
  return {
    wall:  new THREE.MeshStandardMaterial({color: 0xf5e6c8, roughness: 0.85, metalness: 0.02}),
    base:  new THREE.MeshStandardMaterial({color: 0x8a8278, roughness: 0.90, metalness: 0.05}),
    roof:  new THREE.MeshStandardMaterial({color: 0x8b3a3a, roughness: 0.70, metalness: 0.10, side: THREE.DoubleSide}),
    glass: new THREE.MeshStandardMaterial({color: 0x6baed6, roughness: 0.05, metalness: 0.5,  transparent: true, opacity: 0.6}),
    frame: new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.40, metalness: 0.15}),
    door:  new THREE.MeshStandardMaterial({color: 0x5c3a1e, roughness: 0.75, metalness: 0.05}),
  };
}

function buildHouse3d() {
  if (!threeState || typeof THREE === 'undefined') return;
  const {houseGroup, controls} = threeState;

  // Очищаем группу
  while (houseGroup.children.length) {
    const c = houseGroup.children[0];
    houseGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  // Параметры из конфигуратора
  const area   = parseFloat(document.getElementById('v-area')?.value   || 120);
  const wallH  = parseFloat(document.getElementById('v-floor')?.value  || 400) / 100;

  const RATIO  = 1.6;
  const width  = Math.sqrt(area / RATIO);
  const length = width * RATIO;
  const wh     = Math.min(Math.max(wallH, 2), 5);
  const bh     = 0.6;   // высота цоколя
  const rh     = 2.0;   // высота конька
  const wt     = 0.2;   // толщина стены

  const M   = getHouseMats();
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };

  // Цоколь
  const bm = mesh(box(length + 0.2, bh, width + 0.2), M.base);
  bm.position.set(length / 2, bh / 2, width / 2);
  houseGroup.add(bm);

  // ── Стена вдоль оси X с окнами ────────────────
  const WWIN = 0.9, HWIN = 1.2, YWIN = 1.0;
  const WDOOR = 1.0, HDOOR = 2.2;

  function xWallWithWins(len, wins) {
    const g = new THREE.Group();
    const sorted = [...wins].sort((a, b) => a.x - b.x);
    const botH   = sorted.length ? Math.min(...sorted.map(w => w.y)) : wh;
    const topStart = sorted.length ? Math.max(...sorted.map(w => w.y + w.h)) : wh;

    if (botH > 0.01) {
      const m = mesh(box(len, botH, wt), M.wall);
      m.position.set(len / 2, botH / 2, wt / 2); g.add(m);
    }
    if (wh - topStart > 0.01) {
      const m = mesh(box(len, wh - topStart, wt), M.wall);
      m.position.set(len / 2, topStart + (wh - topStart) / 2, wt / 2); g.add(m);
    }

    let prev = 0;
    for (const w of sorted) {
      if (w.x - prev > 0.01) {
        const m = mesh(box(w.x - prev, topStart - botH, wt), M.wall);
        m.position.set(prev + (w.x - prev) / 2, botH + (topStart - botH) / 2, wt / 2); g.add(m);
      }
      // Стекло
      const gm = new THREE.Mesh(box(w.w, w.h, wt * 0.3), M.glass);
      gm.position.set(w.x + w.w / 2, w.y + w.h / 2, wt / 2); g.add(gm);
      // Рама
      const ft = 0.04, fd = wt + 0.06;
      [
        [w.w + ft*2, ft, fd, w.x + w.w/2, w.y + w.h + ft/2],
        [w.w + ft*2, ft, fd, w.x + w.w/2, w.y - ft/2],
        [ft, w.h, fd, w.x - ft/2, w.y + w.h/2],
        [ft, w.h, fd, w.x + w.w + ft/2, w.y + w.h/2],
        [w.w, ft*0.7, fd*0.7, w.x + w.w/2, w.y + w.h/2],
        [ft*0.7, w.h, fd*0.7, w.x + w.w/2, w.y + w.h/2],
      ].forEach(([sx, sy, sz, px, py]) => {
        const m = new THREE.Mesh(box(sx, sy, sz), M.frame);
        m.position.set(px, py, wt / 2); g.add(m);
      });
      prev = w.x + w.w;
    }
    if (len - prev > 0.01) {
      const m = mesh(box(len - prev, topStart - botH, wt), M.wall);
      m.position.set(prev + (len - prev) / 2, botH + (topStart - botH) / 2, wt / 2); g.add(m);
    }
    return g;
  }

  // ── Стена вдоль оси Z с дверью и окнами ───────
  function zWallWithDoor(zLen, hasDoor, hasWins) {
    const g = new THREE.Group();
    const holes = [];
    if (hasDoor) {
      const dz = zLen / 2 - WDOOR / 2;
      holes.push({z: dz, y: 0, w: WDOOR, h: HDOOR, isDoor: true});
    }
    if (hasWins) {
      const dz = zLen / 2 - WDOOR / 2;
      const leftC  = (dz - 0.3) / 2 - WWIN / 2;
      if (leftC >= 0.1) holes.push({z: leftC, y: YWIN, w: WWIN, h: HWIN});
      const rightC = (dz + WDOOR + 0.3 + zLen) / 2 - WWIN / 2;
      if (rightC + WWIN <= zLen - 0.1) holes.push({z: rightC, y: YWIN, w: WWIN, h: HWIN});
    }

    if (!holes.length) {
      const m = mesh(box(wt, wh, zLen), M.wall);
      m.position.set(wt / 2, wh / 2, zLen / 2); g.add(m); return g;
    }

    const sorted  = [...holes].sort((a, b) => a.z - b.z);
    const topS    = Math.max(...sorted.map(h => h.y + h.h));

    if (wh - topS > 0.01) {
      const m = mesh(box(wt, wh - topS, zLen), M.wall);
      m.position.set(wt / 2, topS + (wh - topS) / 2, zLen / 2); g.add(m);
    }

    let prev = 0;
    for (const h of sorted) {
      if (h.z - prev > 0.01) {
        const m = mesh(box(wt, topS, h.z - prev), M.wall);
        m.position.set(wt / 2, topS / 2, prev + (h.z - prev) / 2); g.add(m);
      }
      if (h.y > 0.01) {
        const m = mesh(box(wt, h.y, h.w), M.wall);
        m.position.set(wt / 2, h.y / 2, h.z + h.w / 2); g.add(m);
      }
      const fillerH = topS - (h.y + h.h);
      if (fillerH > 0.01) {
        const m = mesh(box(wt, fillerH, h.w), M.wall);
        m.position.set(wt / 2, (h.y + h.h) + fillerH / 2, h.z + h.w / 2); g.add(m);
      }
      // Заполнение (дверь / стекло)
      const fm = new THREE.Mesh(box(wt * 0.3, h.h, h.w), h.isDoor ? M.door : M.glass);
      fm.position.set(wt / 2, h.y + h.h / 2, h.z + h.w / 2); g.add(fm);

      // Рамы
      const ft = 0.04, fd = wt + 0.08;
      if (!h.isDoor) {
        [
          [fd, ft, h.w + ft*2, wt/2, h.y + h.h + ft/2, h.z + h.w/2],
          [fd, ft, h.w + ft*2, wt/2, h.y - ft/2, h.z + h.w/2],
          [fd, h.h, ft, wt/2, h.y + h.h/2, h.z - ft/2],
          [fd, h.h, ft, wt/2, h.y + h.h/2, h.z + h.w + ft/2],
          [fd*0.7, ft*0.7, h.w, wt/2, h.y + h.h/2, h.z + h.w/2],
          [fd*0.7, h.h, ft*0.7, wt/2, h.y + h.h/2, h.z + h.w/2],
        ].forEach(([sx, sy, sz, px, py, pz]) => {
          const m = new THREE.Mesh(box(sx, sy, sz), M.frame);
          m.position.set(px, py, pz); g.add(m);
        });
      } else {
        [
          [fd, ft, h.w + ft*2, wt/2, h.y + h.h + ft/2, h.z + h.w/2],
          [fd, h.h, ft, wt/2, h.y + h.h/2, h.z - ft/2],
          [fd, h.h, ft, wt/2, h.y + h.h/2, h.z + h.w + ft/2],
        ].forEach(([sx, sy, sz, px, py, pz]) => {
          const m = new THREE.Mesh(box(sx, sy, sz), M.frame);
          m.position.set(px, py, pz); g.add(m);
        });
      }
      prev = h.z + h.w;
    }
    if (zLen - prev > 0.01) {
      const m = mesh(box(wt, topS, zLen - prev), M.wall);
      m.position.set(wt / 2, topS / 2, prev + (zLen - prev) / 2); g.add(m);
    }
    return g;
  }

  // Окна на боковых стенах
  const winCount  = Math.max(0, Math.round(length / (WWIN * 2.9)));
  const winIndent = winCount > 0 ? (length - winCount * WWIN) / (winCount + 1) : length;
  const wins = [];
  for (let i = 0; i < winCount; i++)
    wins.push({x: winIndent + (WWIN + winIndent) * i, y: YWIN, w: WWIN, h: HWIN});

  // Стены
  const lw = xWallWithWins(length, wins); lw.position.set(0, bh, 0);           houseGroup.add(lw);
  const rw = xWallWithWins(length, wins); rw.position.set(0, bh, width - wt);  houseGroup.add(rw);

  const zInner = width - wt * 2;
  const bk = zWallWithDoor(zInner, false, true); bk.position.set(0, bh, wt);         houseGroup.add(bk);
  const fw = zWallWithDoor(zInner, true,  true); fw.position.set(length - wt, bh, wt); houseGroup.add(fw);

  // ── Крыша (двускатная) ─────────────────────────
  const oh = 0.3;
  const x0 = -oh, x1 = length + oh;
  const z0 = -oh, z1 = width + oh, zMid = width / 2;
  const yBase = bh + wh, yPeak = bh + wh + rh;

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
  houseGroup.add(roofMesh);

  // Центрируем камеру на доме
  controls.target.set(length / 2, (bh + wh) / 2, width / 2);
  controls.update();
}

// Отклик на ресайз окна (регистрируется в index.html)
window.addEventListener('resize', resizeThree);
