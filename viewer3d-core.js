// ══════════════════════════════════════════════
// VIEWER3D-CORE.JS
// Общий код для десктоп и мобильной версий:
//   • Инициализация сцены
//   • HDRI-загрузчик с диска
//   • Процедурные PBR-текстуры
//   • PBR-материалы дома
//   • buildHouse3d() — параметрическая модель
// Зависимости: state.js, Three.js r128, OrbitControls, RGBELoader
// Антураж подключается версионным файлом:
//   viewer3d-desktop.js  → _buildEntourage()
//   viewer3d-mobile.js   → _buildEntourage()
// ══════════════════════════════════════════════

let threeState = null;
// { renderer, scene, camera, controls, houseGroup,
//   envMap, skyMesh, sunLight, ambLight, animId }

// ══════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ СЦЕНЫ
// ══════════════════════════════════════════════
function init3dCanvas() {
  const wrap = document.getElementById('three-container');
  if (!wrap || typeof THREE === 'undefined') return;

  if (threeState) { resizeThree(); buildHouse3d(); return; }

  const W = wrap.offsetWidth  || 360;
  const H = wrap.offsetHeight || 360;

  // ── Renderer ─────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias:       !IS_MOBILE,
    powerPreference: IS_MOBILE ? 'low-power' : 'high-performance',
  });
  renderer.setSize(W, H);
  renderer.setPixelRatio(IS_MOBILE ? Math.min(window.devicePixelRatio, 1.5)
                                   : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = IS_MOBILE ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = IS_MOBILE ? 1.1 : 1.0;
  renderer.outputEncoding      = THREE.sRGBEncoding;
  renderer.physicallyCorrectLights = true;
  wrap.appendChild(renderer.domElement);
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:12px;';

  // ── Scene ─────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9ab8d4, IS_MOBILE ? 0.018 : 0.011);

  // ── Camera ────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  camera.position.set(18, 12, 18);

  // ── Controls ──────────────────────────────────
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(4, 2, 2.5);
  controls.minDistance   = 4;
  controls.maxDistance   = 50;
  controls.maxPolarAngle = Math.PI / 2.05;

  // ── Процедурное небо (до загрузки HDRI) ───────
  const skyMesh = _buildProceduralSky();
  scene.add(skyMesh);

  // ── Освещение ─────────────────────────────────
  const ambLight = new THREE.AmbientLight(0xfff8e8, 0.35);
  scene.add(ambLight);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sunLight.position.set(14, 22, 10);
  sunLight.castShadow = true;
  const smSize = IS_MOBILE ? 1024 : 2048;
  sunLight.shadow.mapSize.set(smSize, smSize);
  sunLight.shadow.camera.left   = -22; sunLight.shadow.camera.right  =  22;
  sunLight.shadow.camera.top    =  22; sunLight.shadow.camera.bottom = -22;
  sunLight.shadow.camera.near   = 1;   sunLight.shadow.camera.far    =  65;
  sunLight.shadow.bias   = -0.0004;
  sunLight.shadow.radius = IS_MOBILE ? 2 : 4;
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x5a8a3c, 0.75));

  // ── Земля ─────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140, 1, 1),
    _makeGroundMat(),
  );
  ground.rotation.x    = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Группа дома ───────────────────────────────
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);

  threeState = {
    renderer, scene, camera, controls,
    houseGroup, skyMesh, sunLight, ambLight,
    envMap: null, animId: null,
  };

  // ── Антураж — реализован в версионном файле ───
  _buildEntourage(scene);

  // ── Анимационный цикл ─────────────────────────
  const clock = new THREE.Clock();
  function animate() {
    threeState.animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    controls.update();
    _onAnimFrame(t);        // хук из версионного файла
    renderer.render(scene, camera);
  }
  animate();

  buildHouse3d();
  _injectHdriButton();

  setTimeout(() => {
    const h = document.getElementById('three-hint');
    if (h) { h.style.transition = 'opacity 1s'; h.style.opacity = '0'; }
  }, 4000);
}

// ══════════════════════════════════════════════
// HDRI: ЗАГРУЗКА С ДИСКА ПОЛЬЗОВАТЕЛЯ
// ══════════════════════════════════════════════
function _injectHdriButton() {
  if (document.getElementById('hdri-btn')) return;
  const sh = document.querySelector('#screen-10 .sh');
  if (!sh) return;

  const row = document.createElement('div');
  row.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

  const btn = document.createElement('button');
  btn.id        = 'hdri-btn';
  btn.innerHTML = '🌅 Загрузить HDRI';
  btn.style.cssText = 'font-size:12px;font-weight:600;padding:6px 14px;'
    + 'background:#e0e0e0;border:none;border-radius:8px;cursor:pointer;'
    + 'letter-spacing:.03em;transition:background .15s;';
  btn.onmouseenter = () => btn.style.background = '#ccc';
  btn.onmouseleave = () => btn.style.background = '#e0e0e0';

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:11px;color:#aaa;font-weight:300;';
  hint.textContent   = '.hdr · .exr — Poly Haven, HDRI Haven и др.';

  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = '.hdr,.exr';
  input.style.display = 'none';
  input.addEventListener('change', _onHdriFile);

  btn.addEventListener('click', () => input.click());
  row.appendChild(btn);
  row.appendChild(hint);
  sh.appendChild(row);
  sh.appendChild(input);
}

function _onHdriFile(e) {
  const file = e.target.files[0];
  if (!file || !threeState) return;

  const btn = document.getElementById('hdri-btn');
  if (btn) { btn.innerHTML = '⏳ Загрузка…'; btn.disabled = true; }

  const url   = URL.createObjectURL(file);
  const isExr = file.name.toLowerCase().endsWith('.exr');

  // RGBELoader и EXRLoader уже подключены через <script> в index.html
  const Loader = isExr ? THREE.EXRLoader : THREE.RGBELoader;
  if (!Loader) {
    console.warn('Loader not found — check <script> tags in index.html');
    if (btn) { btn.innerHTML = '⚠ Загрузчик не найден'; btn.disabled = false; }
    return;
  }

  const loader = new Loader();
  if (!isExr) loader.setDataType(THREE.HalfFloatType);

  loader.load(url, (texture) => {
    URL.revokeObjectURL(url);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    const { scene, skyMesh, sunLight, ambLight, renderer } = threeState;

    // PMREM — генерируем карту для IBL
    const pmrem  = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envMap = pmrem.fromEquirectangular(texture).texture;
    pmrem.dispose();
    texture.dispose();

    // Применяем к сцене
    scene.environment = envMap;
    scene.background  = envMap;
    skyMesh.visible   = false;

    // IBL берёт ambient на себя — уменьшаем прямое освещение
    sunLight.intensity = 1.0;
    ambLight.intensity = 0.0;
    threeState.envMap  = envMap;

    // Перестраиваем дом чтобы все MeshStandardMaterial получили envMap
    buildHouse3d();

    if (btn) { btn.innerHTML = '✓ HDRI применён'; btn.disabled = false; }
  }, undefined, (err) => {
    URL.revokeObjectURL(url);
    console.error('HDRI load error', err);
    if (btn) { btn.innerHTML = '⚠ Ошибка'; btn.disabled = false; }
  });
}

// ══════════════════════════════════════════════
// ПРОЦЕДУРНЫЕ ТЕКСТУРЫ
// ══════════════════════════════════════════════

// Базовый генератор шума попиксельно
function _noiseCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b, a] = fn(Math.random());
    img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function _repeatTex(canvas, ru = 4, rv = 4) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ru, rv);
  return t;
}

// Штукатурка: тёплый белый с фактурной вариацией
function _makePlasterTex(sz = 256) {
  const c = _noiseCanvas(sz, n => { const v = 212 + n*38|0; return [v, v-5, v-14, 255]; });
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(0.7px)';
  ctx.drawImage(c, 0, 0);
  return _repeatTex(c, 5, 5);
}

// Карта нормалей — лёгкая шероховатость штукатурки
function _makePlasterNorm(sz = 128) {
  const c = _noiseCanvas(sz, () => {
    const dx = (Math.random()-.5)*12|0, dy = (Math.random()-.5)*12|0;
    return [128+dx, 128+dy, 248, 255];
  });
  return _repeatTex(c, 5, 5);
}

// Roughness-карта стены (0.70–0.95)
function _makePlasterRough(sz = 128) {
  const c = _noiseCanvas(sz, n => { const v = 178+n*56|0; return [v,v,v,255]; });
  return _repeatTex(c, 5, 5);
}

// Кирпичная кладка цоколя
function _makeBaseTex(sz = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a7068';
  ctx.fillRect(0, 0, sz, sz);
  // Добавляем цветовую вариацию кирпичей
  for (let row = 0; row * 36 < sz; row++) {
    const off = (row % 2) ? 0 : 26;
    for (let x = off; x < sz + 52; x += 52) {
      const l = 35 + Math.random()*14|0;
      ctx.fillStyle = `hsl(20,${18+Math.random()*10|0}%,${l}%)`;
      ctx.fillRect(x+1, row*36+1, 50, 34);
    }
  }
  // Швы
  ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2;
  for (let y = 36; y < sz; y += 36) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(sz,y); ctx.stroke();
  }
  for (let row = 0; row * 36 < sz; row++) {
    const off = (row%2) ? 0 : 26;
    for (let x = off; x < sz; x += 52) {
      ctx.beginPath(); ctx.moveTo(x, row*36); ctx.lineTo(x, row*36+36); ctx.stroke();
    }
  }
  return _repeatTex(c, 3, 1);
}

// Черепица: двухтонная имитация
function _makeRoofTex(sz = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a2828'; ctx.fillRect(0,0,sz,sz);
  const tw = 32, th = 20;
  for (let row = 0; row*th < sz; row++) {
    for (let col = 0; col*tw < sz; col++) {
      const ox = (row%2) ? tw/2 : 0;
      const x = col*tw+ox, y = row*th;
      const l = 24+Math.random()*14|0;
      ctx.fillStyle = `hsl(0,${48+Math.random()*12|0}%,${l}%)`;
      ctx.fillRect(x+1, y+1, tw-2, th-2);
      // Нижняя тень
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x+1, y+th-4, tw-2, 3);
    }
  }
  return _repeatTex(c, 7, 5);
}

function _makeRoofRough(sz = 128) {
  const c = _noiseCanvas(sz, n => { const v=150+n*80|0; return [v,v,v,255]; });
  return _repeatTex(c, 4, 4);
}

// Террасная доска ДПК
function _makeDeckTex(sz = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4e3010'; ctx.fillRect(0,0,sz,sz);
  const bw = 18; // ширина доски в пикселях
  for (let x = 0; x < sz; x += bw) {
    const l = 18+Math.random()*12|0;
    ctx.fillStyle = `hsl(25,${42+Math.random()*18|0}%,${l}%)`;
    ctx.fillRect(x, 0, bw-1, sz);
    // Рёбра вельвета
    for (let ridge = 4; ridge < sz; ridge += 7) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, ridge, bw-1, 2);
    }
  }
  return _repeatTex(c, 1, 6);
}

// Земля: вариативная трава
function _makeGroundTex(sz = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(sz/2,sz/2,0, sz/2,sz/2,sz*.72);
  g.addColorStop(0.0, '#4f8234');
  g.addColorStop(0.55,'#3c6e22');
  g.addColorStop(1.0, '#2c5018');
  ctx.fillStyle = g; ctx.fillRect(0,0,sz,sz);
  // Пятна — разнотравье
  for (let i = 0; i < 1200; i++) {
    const x = Math.random()*sz, y = Math.random()*sz;
    ctx.fillStyle = `hsl(${90+Math.random()*30|0},${42+Math.random()*28|0}%,${18+Math.random()*18|0}%)`;
    ctx.beginPath(); ctx.arc(x,y, 1.5+Math.random()*8, 0, Math.PI*2); ctx.fill();
  }
  return c;
}

function _makeGroundMat() {
  const tex = new THREE.CanvasTexture(_makeGroundTex());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return new THREE.MeshStandardMaterial({
    map:             tex,
    roughness:       0.93,
    metalness:       0.0,
    envMapIntensity: 0.2,
  });
}

// ══════════════════════════════════════════════
// PBR МАТЕРИАЛЫ ДОМА
// ══════════════════════════════════════════════
function getHouseMats() {
  const envMap = threeState?.envMap || null;
  const eI = envMap ? 1.0 : 0.0;   // envMapIntensity — только при наличии HDRI

  return {
    wall: new THREE.MeshStandardMaterial({
      map:             _makePlasterTex(),
      normalMap:       _makePlasterNorm(),
      normalScale:     new THREE.Vector2(0.55, 0.55),
      roughnessMap:    _makePlasterRough(),
      roughness:       0.85,
      metalness:       0.0,
      envMap,
      envMapIntensity: eI * 0.7,
    }),

    base: new THREE.MeshStandardMaterial({
      map:             _makeBaseTex(),
      roughness:       0.88,
      metalness:       0.04,
      envMap,
      envMapIntensity: eI * 0.4,
    }),

    roof: new THREE.MeshStandardMaterial({
      map:             _makeRoofTex(),
      roughnessMap:    _makeRoofRough(),
      roughness:       0.82,
      metalness:       0.04,
      side:            THREE.DoubleSide,
      envMap,
      envMapIntensity: eI * 0.6,
    }),

    // Стекло: физически корректное преломление
    glass: (() => {
      // MeshPhysicalMaterial доступен в r128
      const m = new THREE.MeshPhysicalMaterial({
        color:           0xc8e8f8,
        roughness:       0.02,
        metalness:       0.0,
        transmission:    0.88,
        thickness:       0.12,
        ior:             1.46,
        reflectivity:    0.88,
        transparent:     true,
        opacity:         1.0,
        side:            THREE.DoubleSide,
        envMap,
        envMapIntensity: eI * 1.8,
      });
      return m;
    })(),

    frame: new THREE.MeshStandardMaterial({
      color:           0xf0f0ee,
      roughness:       0.28,
      metalness:       0.28,
      envMap,
      envMapIntensity: eI * 1.0,
    }),

    door: new THREE.MeshStandardMaterial({
      color:           0x4a2e18,
      roughness:       0.72,
      metalness:       0.06,
      envMap,
      envMapIntensity: eI * 0.5,
    }),

    deck: new THREE.MeshStandardMaterial({
      map:             _makeDeckTex(),
      roughness:       0.90,
      metalness:       0.0,
      envMap,
      envMapIntensity: eI * 0.3,
    }),
  };
}

// ══════════════════════════════════════════════
// ПРОЦЕДУРНОЕ НЕБО
// ══════════════════════════════════════════════
function _buildProceduralSky() {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side:       THREE.BackSide,
    depthWrite: false,
    uniforms: {
      skyTop:   { value: new THREE.Color(0.14, 0.36, 0.78) },
      skyHoriz: { value: new THREE.Color(0.56, 0.74, 0.92) },
      sunDir:   { value: new THREE.Vector3(0.62, 0.68, 0.39).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.92, 0.72) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 skyTop, skyHoriz, sunDir, sunColor;
      varying vec3 vPos;
      void main() {
        float e    = clamp(vPos.y, 0.0, 1.0);
        vec3  sky  = mix(skyHoriz, skyTop, pow(e, 0.5));
        float sd   = max(0.0, dot(vPos, sunDir));
        float halo = pow(sd, 80.0) * 1.2 + pow(sd, 10.0) * 0.14;
        sky += sunColor * halo;
        sky  = mix(sky * 1.18, sky, smoothstep(0.0, 0.08, e));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

// ══════════════════════════════════════════════
// ПОСТРОЕНИЕ ДОМА (параметрическая модель)
// ══════════════════════════════════════════════
function buildHouse3d() {
  if (!threeState || typeof THREE === 'undefined') return;
  const { houseGroup, controls } = threeState;

  // Очистка с полным dispose
  while (houseGroup.children.length) {
    const c = houseGroup.children[0];
    houseGroup.remove(c);
    c.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
        ms.forEach(m => m.dispose());
      }
    });
  }

  const area  = parseFloat(document.getElementById('v-area')?.value  || 120);
  const wallH = parseFloat(document.getElementById('v-floor')?.value || 400) / 100;

  const RATIO  = 1.6;
  const width  = Math.sqrt(area / RATIO);
  const length = width * RATIO;
  const wh     = Math.min(Math.max(wallH, 2), 5);
  const bh = 0.6, rh = 2.0, wt = 0.22;

  const M    = getHouseMats();
  const box  = (sx,sy,sz) => new THREE.BoxGeometry(sx,sy,sz);
  const mesh = (geo,mat)  => {
    const m = new THREE.Mesh(geo,mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };

  // Цоколь
  const bm = mesh(box(length+.3, bh, width+.3), M.base);
  bm.position.set(length/2, bh/2, width/2);
  houseGroup.add(bm);

  // ── Стены вдоль X (с окнами) ──────────────────
  const WWIN=0.9, HWIN=1.2, YWIN=1.0, WDOOR=1.0, HDOOR=2.2;

  function xWallWithWins(len, wins) {
    const g      = new THREE.Group();
    const sorted = [...wins].sort((a,b)=>a.x-b.x);
    const botH   = sorted.length ? Math.min(...sorted.map(w=>w.y))     : wh;
    const topS   = sorted.length ? Math.max(...sorted.map(w=>w.y+w.h)) : wh;
    const addW   = (sx,sy,px,py) => {
      const m = mesh(box(sx,sy,wt),M.wall); m.position.set(px,py,wt/2); g.add(m);
    };

    if (botH    > .01) addW(len, botH,      len/2, botH/2);
    if (wh-topS > .01) addW(len, wh-topS,   len/2, topS+(wh-topS)/2);

    let prev = 0;
    for (const w of sorted) {
      if (w.x-prev>.01) addW(w.x-prev, topS-botH, prev+(w.x-prev)/2, botH+(topS-botH)/2);
      // Стекло
      const gm = new THREE.Mesh(box(w.w,w.h,wt*.3), M.glass);
      gm.position.set(w.x+w.w/2, w.y+w.h/2, wt/2); g.add(gm);
      // Рама (6 деталей)
      const ft=.045, fd=wt+.07;
      [[w.w+ft*2,ft,fd, w.x+w.w/2, w.y+w.h+ft/2],
       [w.w+ft*2,ft,fd, w.x+w.w/2, w.y-ft/2],
       [ft,w.h,fd, w.x-ft/2,    w.y+w.h/2],
       [ft,w.h,fd, w.x+w.w+ft/2,w.y+w.h/2],
       [w.w,ft*.7,fd*.8, w.x+w.w/2, w.y+w.h/2],
       [ft*.7,w.h,fd*.8, w.x+w.w/2, w.y+w.h/2],
      ].forEach(([sx,sy,sz,px,py])=>{
        const m = new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,wt/2); g.add(m);
      });
      prev = w.x+w.w;
    }
    if (len-prev>.01) addW(len-prev, topS-botH, prev+(len-prev)/2, botH+(topS-botH)/2);
    return g;
  }

  // ── Стены вдоль Z (с дверью) ──────────────────
  function zWallWithDoor(zLen, hasDoor, hasWins) {
    const grp   = new THREE.Group();
    const holes = [];
    if (hasDoor) holes.push({z:zLen/2-WDOOR/2, y:0,    w:WDOOR, h:HDOOR, isDoor:true});
    if (hasWins) {
      const dz = zLen/2-WDOOR/2;
      const lc = (dz-.3)/2-WWIN/2;
      if (lc>=.1) holes.push({z:lc, y:YWIN, w:WWIN, h:HWIN});
      const rc = (dz+WDOOR+.3+zLen)/2-WWIN/2;
      if (rc+WWIN<=zLen-.1) holes.push({z:rc, y:YWIN, w:WWIN, h:HWIN});
    }
    if (!holes.length) {
      const m=mesh(box(wt,wh,zLen),M.wall); m.position.set(wt/2,wh/2,zLen/2); grp.add(m); return grp;
    }
    const sorted = [...holes].sort((a,b)=>a.z-b.z);
    const topS   = Math.max(...sorted.map(h=>h.y+h.h));
    if (wh-topS>.01) { const m=mesh(box(wt,wh-topS,zLen),M.wall); m.position.set(wt/2,topS+(wh-topS)/2,zLen/2); grp.add(m); }
    let prev = 0;
    for (const h of sorted) {
      if (h.z-prev>.01)  { const m=mesh(box(wt,topS,h.z-prev),M.wall); m.position.set(wt/2,topS/2,prev+(h.z-prev)/2); grp.add(m); }
      if (h.y>.01)       { const m=mesh(box(wt,h.y,h.w),M.wall);       m.position.set(wt/2,h.y/2,h.z+h.w/2);          grp.add(m); }
      const fH=topS-(h.y+h.h);
      if (fH>.01)        { const m=mesh(box(wt,fH,h.w),M.wall);         m.position.set(wt/2,(h.y+h.h)+fH/2,h.z+h.w/2); grp.add(m); }
      const fm = new THREE.Mesh(box(wt*.3,h.h,h.w), h.isDoor?M.door:M.glass);
      fm.position.set(wt/2,h.y+h.h/2,h.z+h.w/2); grp.add(fm);
      // Рамы
      const ft=.045,fd=wt+.09;
      if (!h.isDoor) {
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],[fd,ft,h.w+ft*2,wt/2,h.y-ft/2,h.z+h.w/2],
         [fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2],
         [fd*.8,ft*.7,h.w,wt/2,h.y+h.h/2,h.z+h.w/2],[fd*.8,h.h,ft*.7,wt/2,h.y+h.h/2,h.z+h.w/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); grp.add(m); });
      } else {
        [[fd,ft,h.w+ft*2,wt/2,h.y+h.h+ft/2,h.z+h.w/2],
         [fd,h.h,ft,wt/2,h.y+h.h/2,h.z-ft/2],[fd,h.h,ft,wt/2,h.y+h.h/2,h.z+h.w+ft/2]
        ].forEach(([sx,sy,sz,px,py,pz])=>{ const m=new THREE.Mesh(box(sx,sy,sz),M.frame); m.position.set(px,py,pz); grp.add(m); });
      }
      prev=h.z+h.w;
    }
    if (zLen-prev>.01) { const m=mesh(box(wt,topS,zLen-prev),M.wall); m.position.set(wt/2,topS/2,prev+(zLen-prev)/2); grp.add(m); }
    return grp;
  }

  // Размещаем окна равномерно
  const winCnt    = Math.max(0, Math.round(length/(WWIN*2.9)));
  const winIndent = winCnt>0 ? (length-winCnt*WWIN)/(winCnt+1) : length;
  const wins      = [];
  for (let i=0;i<winCnt;i++) wins.push({x:winIndent+(WWIN+winIndent)*i, y:YWIN, w:WWIN, h:HWIN});

  const lw = xWallWithWins(length,wins); lw.position.set(0,bh,0);         houseGroup.add(lw);
  const rw = xWallWithWins(length,wins); rw.position.set(0,bh,width-wt);  houseGroup.add(rw);
  const zI = width-wt*2;
  const bk = zWallWithDoor(zI,false,true); bk.position.set(0,bh,wt);           houseGroup.add(bk);
  const fw = zWallWithDoor(zI,true,true);  fw.position.set(length-wt,bh,wt);   houseGroup.add(fw);

  // ── Крыша (двускатная) ─────────────────────────
  const oh=.35, x0=-oh, x1=length+oh, z0=-oh, z1=width+oh, zMid=width/2;
  const yBase=bh+wh, yPeak=bh+wh+rh;
  const verts = new Float32Array([
    x0,yBase,z0,x1,yBase,z0,x1,yPeak,zMid,  x0,yBase,z0,x1,yPeak,zMid,x0,yPeak,zMid,
    x0,yBase,z1,x0,yPeak,zMid,x1,yPeak,zMid, x0,yBase,z1,x1,yPeak,zMid,x1,yBase,z1,
    x1,yBase,z0,x1,yBase,z1,x1,yPeak,zMid,
    x0,yBase,z1,x0,yBase,z0,x0,yPeak,zMid,
    x0,yBase,z0,x0,yBase,z1,x1,yBase,z1, x0,yBase,z0,x1,yBase,z1,x1,yBase,z0,
  ]);
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.BufferAttribute(verts,3));
  roofGeo.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roofGeo, M.roof);
  roofMesh.castShadow = true;
  houseGroup.add(roofMesh);

  // ── Терраса ДПК (из полигона шага 6) ──────────
  if (S.sections.includes('terrace') && S.pts.terrace?.length >= 3) {
    const deckGeo  = _extrudePolygon(S.pts.terrace, 0.1, 12);
    const deckMesh = new THREE.Mesh(deckGeo, M.deck);
    deckMesh.castShadow = deckMesh.receiveShadow = true;
    deckMesh.position.y = bh;
    houseGroup.add(deckMesh);
  }

  controls.target.set(length/2, (bh+wh)/2, width/2);
  controls.update();
}

// Экструзия нормализованного полигона
function _extrudePolygon(pts, thickness, scale = 12) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x*scale, pts[0].y*scale);
  for (let i=1;i<pts.length;i++) shape.lineTo(pts[i].x*scale, pts[i].y*scale);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {depth:thickness, bevelEnabled:false});
  geo.rotateX(-Math.PI/2);
  return geo;
}

// ══════════════════════════════════════════════
// УТИЛИТЫ
// ══════════════════════════════════════════════
function resizeThree() {
  if (!threeState) return;
  const wrap = document.getElementById('three-container'); if (!wrap) return;
  const W=wrap.offsetWidth, H=wrap.offsetHeight;
  threeState.camera.aspect = W/H;
  threeState.camera.updateProjectionMatrix();
  threeState.renderer.setSize(W,H);
}

window.addEventListener('resize', resizeThree);
