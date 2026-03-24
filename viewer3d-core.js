// ══════════════════════════════════════════════
// VIEWER3D-CORE.JS
// Общий код для десктоп и мобильной версий:
//   • Инициализация сцены (renderer, camera, lights, ground)
//   • HDRI-освещение: загрузка assets/environment.hdr
//   • PBR-материалы с загрузкой текстур из assets/
//   • buildScene3d() — вся геометрия дома и участка
//   • Строители: дом, терраса, крыльцо, дорожки, забор, перила
// Антураж подключается версионным файлом:
//   viewer3d-desktop.js  → _buildEntourage(scene)
//   viewer3d-mobile.js   → _buildEntourage(scene)
// Зависимости: state.js, Three.js r128, OrbitControls, RGBELoader
// ══════════════════════════════════════════════

// ── Папка с ресурсами ─────────────────────────
const ASSETS = 'assets/';

// ── Глобальное состояние сцены ────────────────
let threeState = null;
// { renderer, scene, camera, controls, houseGroup,
//   skyMesh, sunLight, ambLight, groundMesh,
//   envMap, texCache,
//   wallMeshes, deckMeshes, porchMeshes,
//   stepMeshes, fenceMeshes, railingMeshes,
//   currentSlot, animId }

// ══════════════════════════════════════════════
// ЗАГРУЗКА ТЕКСТУР
// Возвращает текстуру из файла или null (тихо).
// Кэш: повторные вызовы с тем же путём отдают тот же объект.
// ══════════════════════════════════════════════
function _loadTex(filename, repeat = 4, onLoad = null) {
  if (!threeState) return null;
  const cache = threeState.texCache;
  const key = filename + '_' + repeat;
  if (cache[key]) { if (onLoad) onLoad(cache[key]); return cache[key]; }

  const loader = new THREE.TextureLoader();
  // Создаём placeholder-текстуру (1×1 белый пиксель) чтобы вернуть сразу
  const placeholder = new THREE.Texture();
  placeholder.needsUpdate = false;

  loader.load(
    ASSETS + filename,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.encoding = THREE.sRGBEncoding;
      // Копируем в placeholder чтобы обновить уже выданные материалы
      Object.assign(placeholder, tex);
      placeholder.image = tex.image;
      placeholder.needsUpdate = true;
      cache[key] = placeholder;
      if (onLoad) onLoad(placeholder);
    },
    undefined,
    () => { /* файл не найден — тихо, материал останется однотонным */ }
  );

  cache[key] = placeholder;
  return placeholder;
}

// Загружает normal-map (без sRGB encoding)
function _loadNorm(filename, repeat = 4) {
  if (!threeState) return null;
  const cache = threeState.texCache;
  const key = 'norm_' + filename + '_' + repeat;
  if (cache[key]) return cache[key];

  const loader = new THREE.TextureLoader();
  const placeholder = new THREE.Texture();
  loader.load(ASSETS + filename, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    // Normal maps НЕ нужен sRGB
    Object.assign(placeholder, tex);
    placeholder.image = tex.image;
    placeholder.needsUpdate = true;
    cache[key] = placeholder;
  }, undefined, () => {});
  cache[key] = placeholder;
  return placeholder;
}

// Загружает roughness/AO (LinearEncoding)
function _loadData(filename, repeat = 4) {
  if (!threeState) return null;
  const cache = threeState.texCache;
  const key = 'data_' + filename + '_' + repeat;
  if (cache[key]) return cache[key];

  const loader = new THREE.TextureLoader();
  const placeholder = new THREE.Texture();
  loader.load(ASSETS + filename, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.encoding = THREE.LinearEncoding;
    Object.assign(placeholder, tex);
    placeholder.image = tex.image;
    placeholder.needsUpdate = true;
    cache[key] = placeholder;
  }, undefined, () => {});
  cache[key] = placeholder;
  return placeholder;
}

// ══════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ СЦЕНЫ
// ══════════════════════════════════════════════
function init3dCanvas(targetSlotId) {
  const targetSlot = document.getElementById(targetSlotId || 'three-container');
  if (!targetSlot || typeof THREE === 'undefined') return;

  if (threeState) {
    moveThreeTo(targetSlotId);
    requestAnimationFrame(() => { resizeThree(); buildScene3d(); });
    return;
  }

  const W = targetSlot.offsetWidth  || 360;
  const H = targetSlot.offsetHeight || 360;

  // ── Renderer ─────────────────────────────────
  const isMobile = typeof IS_MOBILE !== 'undefined' ? IS_MOBILE : false;
  const renderer = new THREE.WebGLRenderer({
    antialias: !isMobile,
    powerPreference: isMobile ? 'low-power' : 'high-performance',
  });
  renderer.setSize(W, H);
  renderer.setPixelRatio(isMobile ? Math.min(window.devicePixelRatio, 1.5)
                                  : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = isMobile ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputEncoding      = THREE.sRGBEncoding;
  renderer.physicallyCorrectLights = true;
  targetSlot.appendChild(renderer.domElement);
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:12px;';

  // ── Scene ─────────────────────────────────────
  const scene = new THREE.Scene();
  // scene.fog отключён — мешает восприятию участка

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

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sunLight.position.set(14, 22, 10);
  sunLight.castShadow = true;
  const smSz = isMobile ? 1024 : 2048;
  sunLight.shadow.mapSize.set(smSz, smSz);
  sunLight.shadow.camera.left   = -26; sunLight.shadow.camera.right  =  26;
  sunLight.shadow.camera.top    =  26; sunLight.shadow.camera.bottom = -26;
  sunLight.shadow.camera.near   = 0.5; sunLight.shadow.camera.far    =  80;
  sunLight.shadow.bias          = -0.0003;
  sunLight.shadow.normalBias    = 0.02;
  sunLight.shadow.radius        = isMobile ? 3 : 5;
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x5a8a3c, 0.7));

  // ── Земля ─────────────────────────────────────
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140, 1, 1),
    _makeGroundMat(),
  );
  groundMesh.rotation.x    = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ── Группа дома ───────────────────────────────
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);

  threeState = {
    renderer, scene, camera, controls,
    houseGroup, skyMesh, sunLight, ambLight, groundMesh,
    envMap: null, texCache: {},
    wallMeshes: [], deckMeshes: [], porchMeshes: [],
    stepMeshes: [], fenceMeshes: [], railingMeshes: [],
    currentSlot: targetSlotId,
    animId: null,
  };

  // ── Антураж — реализован в версионном файле ───
  _buildEntourage(scene);

  // ── Анимационный цикл ─────────────────────────
  const clock = new THREE.Clock();
  function animate() {
    threeState.animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    controls.update();
    if (typeof _onAnimFrame === 'function') _onAnimFrame(t);
    renderer.render(scene, camera);
  }
  animate();

  buildScene3d();

  // Загружаем HDRI автоматически если файл существует
  _autoLoadHdri();

  setTimeout(() => {
    const h = document.getElementById('three-hint');
    if (h) { h.style.transition = 'opacity 1s'; h.style.opacity = '0'; }
  }, 4000);
}

// ══════════════════════════════════════════════
// HDRI: АВТОЗАГРУЗКА И КНОПКА РУЧНОЙ ЗАГРУЗКИ
// ══════════════════════════════════════════════

// Пытаемся загрузить assets/environment.hdr при старте
function _autoLoadHdri() {
  if (typeof THREE.RGBELoader === 'undefined') return;
  const loader = new THREE.RGBELoader();
  loader.setDataType(THREE.HalfFloatType);
  loader.load(
    ASSETS + 'environment.hdr',
    (texture) => _applyHdri(texture),
    undefined,
    () => { /* файл не найден — остаётся процедурное небо */ },
  );
}

function _applyHdri(texture) {
  if (!threeState) return;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const { scene, skyMesh, sunLight, ambLight, renderer } = threeState;

  const pmrem  = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();

  scene.environment = envMap;
  scene.background  = envMap;
  skyMesh.visible   = false;
  sunLight.intensity = 1.8;
  ambLight.intensity = 0.0;
  renderer.toneMappingExposure = 0.85;
  threeState.envMap  = envMap;

  // Перестраиваем дом — материалы получат envMap
  buildScene3d();
}

// Кнопка ручной загрузки HDRI — добавляется на шаге 10
function _injectHdriButton() {
  if (document.getElementById('hdri-btn')) return;
  const sh = document.querySelector('#screen-10 .sh');
  if (!sh) return;

  const row = document.createElement('div');
  row.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

  const btn = document.createElement('button');
  btn.id = 'hdri-btn';
  btn.innerHTML = '🌅 Загрузить HDRI';
  btn.style.cssText = 'font-size:12px;font-weight:600;padding:6px 14px;'
    + 'background:#e0e0e0;border:none;border-radius:8px;cursor:pointer;'
    + 'letter-spacing:.03em;transition:background .15s;';
  btn.onmouseenter = () => btn.style.background = '#ccc';
  btn.onmouseleave = () => btn.style.background = '#e0e0e0';

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:11px;color:#aaa;font-weight:300;';
  hint.textContent   = 'assets/environment.hdr · или выберите файл';

  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = '.hdr,.exr';
  input.style.display = 'none';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file || !threeState) return;
    btn.innerHTML = '⏳ Загрузка…'; btn.disabled = true;

    const url   = URL.createObjectURL(file);
    const isExr = file.name.toLowerCase().endsWith('.exr');
    const Loader = isExr
      ? (typeof THREE.EXRLoader !== 'undefined' ? THREE.EXRLoader : null)
      : THREE.RGBELoader;
    if (!Loader) { btn.innerHTML = '⚠ Загрузчик не найден'; btn.disabled = false; return; }

    const loader = new Loader();
    if (!isExr) loader.setDataType(THREE.HalfFloatType);
    loader.load(url, (tex) => {
      URL.revokeObjectURL(url);
      _applyHdri(tex);
      btn.innerHTML = '✓ HDRI применён'; btn.disabled = false;
    }, undefined, () => {
      URL.revokeObjectURL(url);
      btn.innerHTML = '⚠ Ошибка'; btn.disabled = false;
    });
  });

  btn.addEventListener('click', () => input.click());
  row.appendChild(btn); row.appendChild(hint);
  sh.appendChild(row);  sh.appendChild(input);
}

// ══════════════════════════════════════════════
// МАТЕРИАЛЫ ДОМА (PBR с текстурами из assets/)
// ══════════════════════════════════════════════
function getHouseMats() {
  const env = threeState?.envMap || null;
  const eI  = env ? 1.0 : 0.0;

  // Штукатурка стен (белая, как на референсе)
  const wall = new THREE.MeshStandardMaterial({
    color:           0xf2f2ee,
    roughness:       0.85,
    metalness:       0.0,
    envMap:          env,
    envMapIntensity: eI * 0.7,
  });
  wall.map          = _loadTex('wall_diff.jpg', 1);
  wall.normalMap    = _loadNorm('wall_norm.jpg', 1);
  wall.normalScale  = new THREE.Vector2(0.5, 0.5);
  wall.roughnessMap = _loadData('wall_roug.jpg', 1);
  // UV назначаются на меш через _applyBoxUV(mesh, 2.0) в buildHouseMeshes

  // Цоколь (тёмный антрацит)
  const base = new THREE.MeshStandardMaterial({
    color:           0x3a3a3c,
    roughness:       0.88,
    metalness:       0.04,
    envMap:          env,
    envMapIntensity: eI * 0.4,
  });
  base.map       = _loadTex('base_diff.jpg', 1);
  base.normalMap = _loadNorm('base_norm.jpg', 1);
  // UV назначаются на меш через _applyBoxUV(mesh, 1.0) в buildHouseMeshes

  // Крыша (тёмно-серая черепица)
  const roof = new THREE.MeshStandardMaterial({
    color:           0x404045,
    roughness:       0.80,
    metalness:       0.04,
    side:            THREE.DoubleSide,
    envMap:          env,
    envMapIntensity: eI * 0.6,
  });
  roof.map          = _loadTex('roof_diff.jpg', 6);
  roof.normalMap    = _loadNorm('roof_norm.jpg', 6);
  roof.roughnessMap = _loadData('roof_roug.jpg', 6);

  // Стекло — тёмное с отражением, сквозь него плохо видно
  // MeshStandardMaterial надёжнее MeshPhysicalMaterial.transmission в r128
  const glass = new THREE.MeshStandardMaterial({
    color:           0x4a6878,  // тёмно-синеватый — имитирует тонированное стекло
    roughness:       0.04,
    metalness:       0.82,      // высокий metalness даёт отражение без transmission
    transparent:     true,
    opacity:         0.38,      // менее прозрачное — скрывает отсутствие интерьера
    side:            THREE.DoubleSide,
    envMap:          env,
    envMapIntensity: eI * 2.5,
    depthWrite:      false,     // избегаем z-fighting при прозрачности
  });

  // Рамы (тёмный антрацит, как на референсе)
  const frame = new THREE.MeshStandardMaterial({
    color:           0x3a3a3c,
    roughness:       0.28,
    metalness:       0.28,
    envMap:          env,
    envMapIntensity: eI * 1.0,
    polygonOffset:      true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });

  // Дверь (тёмная, как на референсе)
  const door = new THREE.MeshStandardMaterial({
    color:           0x2a2a2e,
    roughness:       0.72,
    metalness:       0.06,
    envMap:          env,
    envMapIntensity: eI * 0.5,
  });

  // Террасная доска ДПК
  const deck = new THREE.MeshStandardMaterial({
    color:           0xC8A96E,
    roughness:       0.72,
    metalness:       0.02,
    envMap:          env,
    envMapIntensity: eI * 0.3,
  });
  deck.map          = _loadTex('deck_diff.jpg', 1);
  deck.normalMap    = _loadNorm('deck_norm.jpg', 1);
  deck.roughnessMap = _loadData('deck_roug.jpg', 1);

  // Лаги, столбы, ступени
  const joist = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.85, metalness: 0.15, envMap: env, envMapIntensity: eI * 0.2 });
  const post  = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.80, metalness: 0.20, envMap: env, envMapIntensity: eI * 0.2 });
  const step  = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.80, metalness: 0.05, envMap: env, envMapIntensity: eI * 0.3 });

  // Деревянная обшивка входной зоны (тёплое дерево)
  const woodClad = new THREE.MeshStandardMaterial({
    color:           0xB08050,
    roughness:       0.75,
    metalness:       0.0,
    envMap:          env,
    envMapIntensity: eI * 0.4,
  });

  // Колонны (белые, как стены)
  const column = new THREE.MeshStandardMaterial({
    color:           0xf0f0ec,
    roughness:       0.60,
    metalness:       0.05,
    envMap:          env,
    envMapIntensity: eI * 0.5,
  });

  return { wall, base, roof, glass, frame, door, deck, joist, post, step, woodClad, column };
}

// ── Земля (процедурная текстура без тайлинга) ──
function _makeGroundMat() {
  return new THREE.MeshStandardMaterial({
    color:     0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    map:         _generateGroundTex(),
    normalMap:   _generateGrassNormal(),
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
}

function _generateGroundTex() {
  const sz = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');

  // Базовый зелёный
  ctx.fillStyle = '#3a6828';
  ctx.fillRect(0, 0, sz, sz);

  // Крупные пятна — эллиптические, органичные формы
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 40 + Math.random() * 160;
    const hue = 75 + Math.random() * 45 | 0;
    const sat = 30 + Math.random() * 35 | 0;
    const lt  = 18 + Math.random() * 28 | 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1, 0.4 + Math.random() * 0.8);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `hsla(${hue},${sat}%,${lt}%,0.45)`);
    g.addColorStop(0.6, `hsla(${hue},${sat}%,${lt}%,0.18)`);
    g.addColorStop(1, 'hsla(100,30%,20%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Средние пятна — тоже эллиптические
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 6 + Math.random() * 28;
    const hue = 60 + Math.random() * 60 | 0;
    const lt  = 15 + Math.random() * 32 | 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1, 0.5 + Math.random());
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `hsla(${hue},38%,${lt}%,0.3)`);
    g.addColorStop(1, 'hsla(90,30%,18%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Мелкая фактура (точки — округлость не заметна)
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 1 + Math.random() * 4;
    const hue = 55 + Math.random() * 65 | 0;
    const lt  = 18 + Math.random() * 35 | 0;
    ctx.fillStyle = `hsla(${hue},42%,${lt}%,0.22)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function _generateGrassNormal() {
  const sz = 512;
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(sz, sz);
  const d = img.data;

  // Базовая нормаль — вертикаль (128, 128, 255)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128; d[i+1] = 128; d[i+2] = 255; d[i+3] = 255;
  }

  // Травинки — короткие направленные штрихи
  for (let i = 0; i < 60000; i++) {
    const bx = Math.random() * sz | 0;
    const by = Math.random() * sz | 0;
    const angle = -Math.PI/2 + (Math.random() - 0.5) * 1.4;
    const strength = 18 + Math.random() * 35;
    const len = 2 + Math.random() * 7 | 0;
    const dx = Math.cos(angle), dy = Math.sin(angle);

    for (let t = 0; t < len; t++) {
      const px = (bx + dx * t) | 0;
      const py = (by + dy * t) | 0;
      if (px < 0 || px >= sz || py < 0 || py >= sz) continue;
      const idx = (py * sz + px) * 4;
      const fade = 1 - t / len;
      d[idx]     = Math.max(0, Math.min(255, 128 + dx * strength * fade));
      d[idx + 1] = Math.max(0, Math.min(255, 128 + dy * strength * fade));
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return tex;
}

// ══════════════════════════════════════════════
// КУБИЧЕСКАЯ UV-ПРОЕКЦИЯ (CPU)
// Вычисляет UV-координаты из позиций вершин меша
// и записывает их в geometry.attributes.uv.
// Вызывается ПОСЛЕ создания меша, перед добавлением в сцену.
// tileSize — размер одного тайла в метрах.
// ══════════════════════════════════════════════
function _applyBoxUV(mesh, tileSize, groupOffset) {
  // UV из локальных координат меша + смещение его группы.
  // groupOffset = {x,y,z} — position группы-родителя (и её родителя, если есть).
  // Это даёт непрерывный тайлинг между соседними секциями стен.
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos) return;

  const go = groupOffset || { x: 0, y: 0, z: 0 };
  // Полный offset: позиция меша в группе + позиция группы
  const ox = mesh.position.x + go.x;
  const oy = mesh.position.y + go.y;
  const oz = mesh.position.z + go.z;

  const uv = new Float32Array(pos.count * 2);
  const vP = new THREE.Vector3(), vN = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    vP.fromBufferAttribute(pos, i);
    const wx = vP.x + ox, wy = vP.y + oy, wz = vP.z + oz;

    if (nor) { vN.fromBufferAttribute(nor, i); }
    else      { vN.set(0, 1, 0); }

    const ax = Math.abs(vN.x), ay = Math.abs(vN.y), az = Math.abs(vN.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = wx / tileSize; v = wz / tileSize; }  // горизонталь XZ
    else if (ax >= az)         { u = wz / tileSize; v = wy / tileSize; }  // нормаль X → ZY
    else                       { u = wx / tileSize; v = wy / tileSize; }  // нормаль Z → XY

    uv[i * 2]     = u;
    uv[i * 2 + 1] = v;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv.needsUpdate = true;
  ['map', 'normalMap', 'roughnessMap'].forEach(slot => {
    const tex = mesh.material[slot];
    if (tex) { tex.repeat.set(1, 1); tex.needsUpdate = true; }
  });
}

// ══════════════════════════════════════════════
// ПРОЦЕДУРНОЕ НЕБО (пока нет HDRI)
// ══════════════════════════════════════════════
function _buildProceduralSky() {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      skyTop:   { value: new THREE.Color(0.14, 0.36, 0.78) },
      skyHoriz: { value: new THREE.Color(0.56, 0.74, 0.92) },
      sunDir:   { value: new THREE.Vector3(0.62, 0.68, 0.39).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.92, 0.72) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
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
// MAIN SCENE BUILDER
// ══════════════════════════════════════════════
function buildScene3d() {
  if (!threeState || typeof THREE === 'undefined') return;
  const { houseGroup, controls } = threeState;

  clearGroup(houseGroup);
  threeState.wallMeshes    = [];
  threeState.deckMeshes    = [];
  threeState.porchMeshes   = [];
  threeState.stepMeshes    = [];
  threeState.fenceMeshes   = [];
  threeState.railingMeshes = [];

  const M = getHouseMats();

  // Применяем цвет активного образца к нужной секции
  if (S.activeSample && S.activeSample.color) {
    const sec   = getActive()[S.curSec];
    const secId = sec ? sec.id : 'terrace';
    if      (secId === 'facade') M.wall.color.set(S.activeSample.color);
    else if (secId === 'porch')  M.step.color.set(S.activeSample.color);
    else                         M.deck.color.set(S.activeSample.color);
  }

  const isNoHouse = (S.houseType === 'Участок без дома');
  const area   = parseFloat(document.getElementById('v-area')?.value  || 120);
  const wallH  = parseFloat(document.getElementById('v-floor')?.value || 400) / 100;
  const foundH = parseFloat(document.getElementById('v-found')?.value || 80)  / 100;
  const RATIO  = 1.6, wt = 0.2;
  const houseW = Math.sqrt(area / RATIO);
  const houseL = houseW * RATIO;
  const wh     = Math.min(Math.max(wallH, 2), 5);
  const bh     = Math.max(foundH, 0.1);

  if (!isNoHouse) buildHouseMeshes(houseGroup, M, houseL, houseW, wh, bh, wt);

  if (S.sections.includes('terrace') && S.pts.terrace.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.terrace, isNoHouse ? 0.35 : bh, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('pool_terrace') && S.pts.pool_terrace.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.pool_terrace, isNoHouse ? 0.35 : bh, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('pier') && S.pts.pier.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.pier, 0.5, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('paths') && S.pts.paths.length >= 2)
    buildPaths3d(houseGroup, M, S.pts.paths, houseL, houseW);

  if (S.sections.includes('porch') && !isNoHouse)
    buildPorch3d(houseGroup, M, S.porch, houseL, houseW, bh);

  if (S.sections.includes('fence') && S.pts.fence.length >= 2)
    buildFence3d(houseGroup, M, S.pts.fence, houseL, houseW);

  const terraceRailingOn = document.querySelector('.tg[data-id="terrace-railing"]')?.classList.contains('on');
  if (terraceRailingOn && S.pts.terrace.length >= 3)
    buildRailing3d(houseGroup, M, S.pts.terrace, isNoHouse ? 0.35 : bh, houseL, houseW);

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
    if (c.children && c.children.length) clearGroup(c);
  }
}

// ══════════════════════════════════════════════
// HOUSE BUILDER
// ══════════════════════════════════════════════
function buildHouseMeshes(parent, M, length, width, wh, bh, wt) {
  console.log('[3D] buildHouseMeshes start, length:', length, 'width:', width, 'wh:', wh, 'bh:', bh);
  const box  = (sx,sy,sz) => new THREE.BoxGeometry(sx,sy,sz);
  const mesh = (geo,mat)  => { const m=new THREE.Mesh(geo,mat); m.castShadow=m.receiveShadow=true; return m; };

  const bm = mesh(box(length+.2, bh, width+.2), M.base);
  bm.position.set(length/2, bh/2, width/2);
  parent.add(bm);
  _applyBoxUV(bm, 1.0);
  console.log('[3D] цоколь создан, size:', length+.2, bh, width+.2, 'pos:', bm.position);
  console.log('[3D] M.base.map:', M.base.map, 'visible:', bm.visible, 'material:', M.base.type);

  const WWIN=0.9, HWIN=1.2, YWIN=1.0, WDOOR=1.6, HDOOR=2.3;

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
  console.log('[3D] стены построены, wallMeshes:', threeState.wallMeshes.length);
  console.log('[3D] M.wall.map:', M.wall.map, 'M.wall.onBeforeCompile:', M.wall.onBeforeCompile);
  console.log('[3D] lw children:', lw.children.length, 'rw:', rw.children.length);

  // ── Вальмовая (hip) крыша ──────────────────────
  const rh=2.0, oh=0.45; // overhang 0.45m
  const x0=-oh, x1=length+oh, z0=-oh, z1=width+oh, zMid=width/2;
  const yBase=bh+wh, yPeak=bh+wh+rh;

  // Вальм: конёк короче длины дома, 4 ската
  const eaveHalfW = (width + oh*2) / 2;
  const hipInset  = eaveHalfW * 0.7; // длина вальма от карниза до конька
  const ridgeX0   = x0 + hipInset;   // начало конька
  const ridgeX1   = x1 - hipInset;   // конец конька

  // UV масштабы
  const slatLen = Math.sqrt(eaveHalfW*eaveHalfW + rh*rh);
  const uTotal  = (length + oh*2) / 8;
  const vS      = slatLen / 8;
  const uHip    = hipInset / 8;

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

  const roofTris = [
    // Передний скат (z0, трапеция) — 2 треугольника
    [[x0,yBase,z0],[0,0],         [x1,yBase,z0],[uTotal,0],       [ridgeX1,yPeak,zMid],[uTotal-uHip,vS]],
    [[x0,yBase,z0],[0,0],         [ridgeX1,yPeak,zMid],[uTotal-uHip,vS], [ridgeX0,yPeak,zMid],[uHip,vS]],
    // Задний скат (z1, трапеция)
    [[x1,yBase,z1],[0,0],         [x0,yBase,z1],[uTotal,0],       [ridgeX0,yPeak,zMid],[uTotal-uHip,vS]],
    [[x1,yBase,z1],[0,0],         [ridgeX0,yPeak,zMid],[uTotal-uHip,vS], [ridgeX1,yPeak,zMid],[uHip,vS]],
    // Левый вальм (x0, треугольник)
    [[x0,yBase,z0],[0,0],         [ridgeX0,yPeak,zMid],[uHip,vS], [x0,yBase,z1],[uHip*2,0]],
    // Правый вальм (x1, треугольник)
    [[x1,yBase,z1],[0,0],         [ridgeX1,yPeak,zMid],[uHip,vS], [x1,yBase,z0],[uHip*2,0]],
  ];

  const roofGeo=buildRoofGeo(roofTris);
  const roofMesh=new THREE.Mesh(roofGeo,M.roof);
  roofMesh.castShadow=true; roofMesh.receiveShadow=true;
  parent.add(roofMesh);

  // ── Подшивка карниза (софит) ─────────────────
  const sofH = 0.06; // толщина лобовой доски
  const sofMat = M.base;
  [[x0,yBase,z0, x1-x0,sofH,0.01, (x0+x1)/2,yBase-sofH/2,z0],   // передний
   [x0,yBase,z1, x1-x0,sofH,0.01, (x0+x1)/2,yBase-sofH/2,z1],   // задний
   [x0,yBase,z0, 0.01,sofH,z1-z0, x0,yBase-sofH/2,(z0+z1)/2],    // левый
   [x1,yBase,z0, 0.01,sofH,z1-z0, x1,yBase-sofH/2,(z0+z1)/2],    // правый
  ].forEach(([,,, sx,sy,sz, px,py,pz])=>{
    const m=new THREE.Mesh(box(sx,sy,sz),sofMat);
    m.position.set(px,py,pz); m.castShadow=true; parent.add(m);
  });

  // ── Входная зона (крытое крыльцо с колоннами) ─
  // Расположена на правой стене (x = length), по центру Z
  const porchW  = Math.min(width * 0.4, 4.0);  // ширина входной зоны
  const porchD  = 1.8;                           // глубина (выступ наружу)
  const porchZ0 = width/2 - porchW/2;
  const porchZ1 = width/2 + porchW/2;
  const colW    = 0.22; // сечение колонны
  const colH    = wh;   // высота колонны

  // Колонны (2 шт по углам)
  const colGeo = box(colW, colH, colW);
  [[length + porchD - colW/2, bh + colH/2, porchZ0 + colW/2],
   [length + porchD - colW/2, bh + colH/2, porchZ1 - colW/2],
  ].forEach(([cx,cy,cz])=>{
    const c = new THREE.Mesh(colGeo, M.column);
    c.position.set(cx,cy,cz); c.castShadow=true; c.receiveShadow=true;
    parent.add(c);
  });

  // Деревянная обшивка задней стенки крыльца
  const cladH = wh;
  const cladM = new THREE.Mesh(box(0.03, cladH, porchW), M.woodClad);
  cladM.position.set(length + 0.015, bh + cladH/2, width/2);
  cladM.castShadow=true; cladM.receiveShadow=true;
  parent.add(cladM);

  // Боковые стенки входной зоны (частичные, до колонн)
  const sideD = porchD - colW;
  [[length + sideD/2, bh + cladH/2, porchZ0 + 0.015],
   [length + sideD/2, bh + cladH/2, porchZ1 - 0.015],
  ].forEach(([sx,sy,sz])=>{
    const sw = new THREE.Mesh(box(sideD, cladH * 0.35, 0.03), M.wall);
    sw.position.set(sx, bh + cladH * 0.825, sz);
    sw.castShadow=true; parent.add(sw);
  });

  // Перекрытие крыльца (козырёк, продолжение крыши)
  const canopyM = new THREE.Mesh(box(porchD + oh, 0.12, porchW + oh*0.5), M.roof);
  canopyM.position.set(length + porchD/2, yBase - 0.06, width/2);
  canopyM.castShadow=true; canopyM.receiveShadow=true;
  parent.add(canopyM);

  // Ступеньки перед входом
  const entStepH = 0.17, entStepD = 0.30;
  const nEntSteps = Math.max(1, Math.round(bh / entStepH));
  const aEntStepH = bh / nEntSteps;
  for (let i = 0; i < nEntSteps; i++) {
    const yBot = bh - (i+1) * aEntStepH;
    const sx = porchW * 0.8;
    const stepM = new THREE.Mesh(box(entStepD, aEntStepH, sx), M.base);
    stepM.position.set(length + porchD + i*entStepD + entStepD/2, yBot + aEntStepH/2, width/2);
    stepM.castShadow=true; stepM.receiveShadow=true;
    parent.add(stepM); threeState.stepMeshes.push(stepM);
  }

  // Плита крыльца (площадка)
  const porchSlab = new THREE.Mesh(box(porchD, 0.06, porchW), M.base);
  porchSlab.position.set(length + porchD/2, bh - 0.03, width/2);
  porchSlab.castShadow=true; porchSlab.receiveShadow=true;
  parent.add(porchSlab);
}

// ══════════════════════════════════════════════
// TERRACE / PIER / POOL BUILDER
// ══════════════════════════════════════════════
function canvasToWorld(pts, houseL, houseW) {
  const gridSize=GRID, offsetX=(gridSize-houseL)/2, offsetZ=(gridSize-houseW)/2;
  return pts.map(p=>({ x:p.x*gridSize-offsetX, z:p.y*gridSize-offsetZ }));
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
  parent.add(terraceGroup);
}

// ══════════════════════════════════════════════
// PORCH / PATHS / FENCE / RAILING BUILDERS
// (перенесены из viewer3d.js без изменений)
// ══════════════════════════════════════════════
function buildPorch3d(parent,M,porch,houseL,houseW,bh){
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const mesh=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  const gridSize=GRID,offsetX=(gridSize-houseL)/2,offsetZ=(gridSize-houseW)/2;
  const px=porch.x*gridSize-offsetX,pz=porch.y*gridSize-offsetZ,pw=porch.w*gridSize,pd=porch.h*gridSize;
  if(pw<.2||pd<.2)return;
  const porchGroup=new THREE.Group();
  const cx=px+pw/2,cz=pz+pd/2;
  const dF=Math.abs(cz-houseW),dB=Math.abs(cz),dR=Math.abs(cx-houseL),dL=Math.abs(cx);
  const minD=Math.min(dF,dB,dR,dL);
  let sDX=0,sDZ=0;
  if(minD===dF)sDZ=1;else if(minD===dB)sDZ=-1;else if(minD===dR)sDX=1;else sDX=-1;
  const stepH=.17,stepD=.28,boardH=.022,nSteps=Math.max(1,Math.round(bh/stepH)),aStepH=bh/nSteps;
  const boardW=.14,gap=.005;
  if(sDZ!==0){for(let bx=px+boardW/2;bx<=px+pw;bx+=boardW+gap){const b=mesh(box(boardW,boardH,pd),M.deck);b.position.set(bx,bh-boardH/2,pz+pd/2);porchGroup.add(b);threeState.porchMeshes.push(b);}}
  else{for(let bz=pz+boardW/2;bz<=pz+pd;bz+=boardW+gap){const b=mesh(box(pw,boardH,boardW),M.deck);b.position.set(px+pw/2,bh-boardH/2,bz);porchGroup.add(b);threeState.porchMeshes.push(b);}}
  for(let i=0;i<nSteps;i++){
    const yBot=bh-(i+1)*aStepH;let sx,sz,sxP,szP;
    if(sDZ!==0){sx=pw;sz=stepD;sxP=px+pw/2;szP=sDZ>0?(pz+pd+i*stepD+stepD/2):(pz-i*stepD-stepD/2);}
    else{sx=stepD;sz=pd;szP=pz+pd/2;sxP=sDX>0?(px+pw+i*stepD+stepD/2):(px-i*stepD-stepD/2);}
    const s=mesh(box(sx,aStepH,sz),M.step);s.position.set(sxP,yBot+aStepH/2,szP);porchGroup.add(s);threeState.stepMeshes.push(s);
  }
  const sideW=.06;
  if(sDZ!==0){const ls=mesh(box(sideW,bh,pd),M.base);ls.position.set(px,bh/2,pz+pd/2);porchGroup.add(ls);const rs=mesh(box(sideW,bh,pd),M.base);rs.position.set(px+pw,bh/2,pz+pd/2);porchGroup.add(rs);}
  else{const ls=mesh(box(pw,bh,sideW),M.base);ls.position.set(px+pw/2,bh/2,pz);porchGroup.add(ls);const rs=mesh(box(pw,bh,sideW),M.base);rs.position.set(px+pw/2,bh/2,pz+pd);porchGroup.add(rs);}
  parent.add(porchGroup);
}

function buildPaths3d(parent,M,pts,houseL,houseW){
  if(pts.length<2)return;
  const worldPts=canvasToWorld(pts,houseL,houseW);
  const pathW=parseFloat(document.getElementById('v-paths-width')?.value||120)/100;
  const boardW=.14,boardH=.022,gap=.005;
  const pathGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  for(let i=0;i<worldPts.length-1;i++){
    const a=worldPts[i],b=worldPts[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const segLen=Math.sqrt(dx*dx+dz*dz); if(segLen<.1)continue;
    const angle=Math.atan2(dx,dz);
    for(let d=boardW/2;d<segLen;d+=boardW+gap){
      const t=d/segLen,bx=a.x+dx*t,bz=a.z+dz*t;
      const bd=meshFn(box(pathW,boardH,boardW),M.deck);bd.position.set(bx,boardH/2,bz);bd.rotation.y=angle;pathGroup.add(bd);threeState.deckMeshes.push(bd);
    }
  }
  parent.add(pathGroup);
}

function buildFence3d(parent,M,pts,houseL,houseW){
  if(pts.length<2)return;
  const worldPts=canvasToWorld(pts,houseL,houseW);
  const fenceH=1.8,postW=.1,boardH=fenceH-.2,boardT=.02;
  const fenceGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  const fenceMat=new THREE.MeshStandardMaterial({color:0x8B7355,roughness:.80,metalness:.05});
  for(let i=0;i<worldPts.length;i++){
    const p=worldPts[i],postH=fenceH+.2;
    const post=meshFn(box(postW,postH,postW),M.post);post.position.set(p.x,postH/2,p.z);fenceGroup.add(post);
    if(i<worldPts.length-1){
      const a=worldPts[i],b=worldPts[i+1],dx=b.x-a.x,dz=b.z-a.z;
      const segLen=Math.sqrt(dx*dx+dz*dz); if(segLen<.2)continue;
      const angle=Math.atan2(dx,dz),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
      const panel=meshFn(box(boardT,boardH,segLen-postW),fenceMat);panel.position.set(mx,.2+boardH/2,mz);panel.rotation.y=angle;fenceGroup.add(panel);threeState.fenceMeshes.push(panel);
    }
  }
  if(worldPts.length>=3){
    const a=worldPts[worldPts.length-1],b=worldPts[0],dx=b.x-a.x,dz=b.z-a.z;
    const segLen=Math.sqrt(dx*dx+dz*dz); if(segLen>.2){
      const angle=Math.atan2(dx,dz),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
      const fenceMat2=new THREE.MeshStandardMaterial({color:0x8B7355,roughness:.80,metalness:.05});
      const panel=meshFn(box(.02,fenceH-.2,segLen-.1),fenceMat2);panel.position.set(mx,.2+(fenceH-.2)/2,mz);panel.rotation.y=angle;fenceGroup.add(panel);threeState.fenceMeshes.push(panel);
    }
  }
  parent.add(fenceGroup);
}

function buildRailing3d(parent,M,pts,deckHeight,houseL,houseW){
  if(pts.length<3)return;
  const worldPts=canvasToWorld(pts,houseL,houseW);
  const railH=1.0,railW=.05,postW=.06;
  const railGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  const railMat=new THREE.MeshStandardMaterial({color:0x777777,roughness:.60,metalness:.3});
  let porchRect=null;
  if(S.sections.includes('porch')){
    const gridSize=GRID,offsetX=(gridSize-houseL)/2,offsetZ=(gridSize-houseW)/2,p=S.porch;
    const px1=p.x*gridSize-offsetX,pz1=p.y*gridSize-offsetZ,px2=(p.x+p.w)*gridSize-offsetX,pz2=(p.y+p.h)*gridSize-offsetZ;
    porchRect={minX:Math.min(px1,px2),maxX:Math.max(px1,px2),minZ:Math.min(pz1,pz2),maxZ:Math.max(pz1,pz2)};
  }
  function splitAroundPorch(ax,az,bx,bz){
    if(!porchRect)return[{ax,az,bx,bz}];
    const pr=porchRect,pad=.08,dx=bx-ax,dz=bz-az,len=Math.sqrt(dx*dx+dz*dz);
    if(len<.01)return[{ax,az,bx,bz}];
    let tE=0,tX=1;
    if(Math.abs(dx)>.001){const t1=(pr.minX-pad-ax)/dx,t2=(pr.maxX+pad-ax)/dx;tE=Math.max(tE,Math.min(t1,t2));tX=Math.min(tX,Math.max(t1,t2));}
    else if(ax<pr.minX-pad||ax>pr.maxX+pad)return[{ax,az,bx,bz}];
    if(Math.abs(dz)>.001){const t1=(pr.minZ-pad-az)/dz,t2=(pr.maxZ+pad-az)/dz;tE=Math.max(tE,Math.min(t1,t2));tX=Math.min(tX,Math.max(t1,t2));}
    else if(az<pr.minZ-pad||az>pr.maxZ+pad)return[{ax,az,bx,bz}];
    if(tE>=tX||tX<=0||tE>=1)return[{ax,az,bx,bz}];
    const tc0=Math.max(0,tE),tc1=Math.min(1,tX),result=[];
    if(tc0>.02)result.push({ax,az,bx:ax+dx*tc0,bz:az+dz*tc0});
    if(tc1<.98)result.push({ax:ax+dx*tc1,az:az+dz*tc1,bx,bz});
    return result;
  }
  function drawRailSeg(a_x,a_z,b_x,b_z){
    const sdx=b_x-a_x,sdz=b_z-a_z,sLen=Math.sqrt(sdx*sdx+sdz*sdz); if(sLen<.1)return;
    for(const[px2,pz2]of[[a_x,a_z],[b_x,b_z]]){const p=meshFn(box(postW,railH,postW),railMat);p.position.set(px2,deckHeight+railH/2,pz2);railGroup.add(p);threeState.railingMeshes.push(p);}
    const angle=Math.atan2(sdx,sdz),mx=(a_x+b_x)/2,mz=(a_z+b_z)/2;
    for(const hFrac of[1.0,.5]){const bar=meshFn(box(railW,railW,sLen),railMat);bar.position.set(mx,deckHeight+railH*hFrac,mz);bar.rotation.y=angle;railGroup.add(bar);threeState.railingMeshes.push(bar);}
  }
  for(let i=0;i<worldPts.length;i++){
    const cur=worldPts[i],next=worldPts[(i+1)%worldPts.length];
    for(const seg of splitAroundPorch(cur.x,cur.z,next.x,next.z)) drawRailSeg(seg.ax,seg.az,seg.bx,seg.bz);
  }
  parent.add(railGroup);
}

// ══════════════════════════════════════════════
// MATERIAL APPLICATION (примерка образцов)
// ══════════════════════════════════════════════
function applyMaterialToScene(colorHex) {
  if (!threeState||!colorHex) return;
  const c=new THREE.Color(colorHex);
  const sec=getActive()[S.curSec], secId=sec?sec.id:'terrace';
  let targetMeshes=[], roughness=.72;
  if(secId==='facade')     { targetMeshes=threeState.wallMeshes||[];  roughness=.85; }
  else if(secId==='porch') { targetMeshes=threeState.stepMeshes||[];  roughness=.80; }
  else if(secId==='fence') { targetMeshes=threeState.fenceMeshes||[]; roughness=.80; }
  else                     { targetMeshes=[...(threeState.deckMeshes||[]),...(threeState.porchMeshes||[])]; }
  if(!targetMeshes.length) { buildScene3d(); return; }
  const newMat=new THREE.MeshStandardMaterial({color:c,roughness,metalness:.02});
  targetMeshes.forEach(m=>{ if(m.material)m.material.dispose(); m.material=newMat; });
}

function rot(dir) { /* orbit controls handle rotation */ }

// ══════════════════════════════════════════════
// УТИЛИТЫ
// ══════════════════════════════════════════════
function moveThreeTo(slotId) {
  if (!threeState) return;
  const target=document.getElementById(slotId); if(!target) return;
  if(threeState.currentSlot===slotId) return;
  target.appendChild(threeState.renderer.domElement);
  threeState.currentSlot=slotId;
  threeState.controls.dispose();
  threeState.controls=new THREE.OrbitControls(threeState.camera,threeState.renderer.domElement);
  threeState.controls.enableDamping=true; threeState.controls.dampingFactor=.08;
  threeState.controls.minDistance=4; threeState.controls.maxDistance=50;
  threeState.controls.maxPolarAngle=Math.PI/2.05;
  const area2=parseFloat(document.getElementById('v-area')?.value||120);
  const houseW2=Math.sqrt(area2/1.6),houseL2=houseW2*1.6;
  const bh2=parseFloat(document.getElementById('v-found')?.value||80)/100;
  const wh2=Math.min(Math.max(parseFloat(document.getElementById('v-floor')?.value||400)/100,2),5);
  threeState.controls.target.set(houseL2/2,(bh2+wh2)/2,houseW2/2);
  threeState.controls.update();
}

function resizeThree() {
  if (!threeState) return;
  const wrap=document.getElementById(threeState.currentSlot); if(!wrap) return;
  const W=wrap.offsetWidth,H=wrap.offsetHeight; if(!W||!H) return;
  threeState.camera.aspect=W/H;
  threeState.camera.updateProjectionMatrix();
  threeState.renderer.setSize(W,H);
}

let paramChangeTimer=null;
function onParamChange() {
  clearTimeout(paramChangeTimer);
  paramChangeTimer=setTimeout(()=>{ if(threeState) buildScene3d(); },150);
}

window.addEventListener('resize', resizeThree);
