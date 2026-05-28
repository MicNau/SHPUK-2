// ══════════════════════════════════════════════
// VIEWER3D-CORE.JS
// Общий код для десктоп и мобильной версий:
//   • Инициализация сцены (renderer, camera, lights, ground)
//   • HDRI-освещение: загрузка assets/environment.hdr
//   • PBR-материалы с загрузкой текстур из assets/
//   • buildScene3d() — вся геометрия дома и участка
//   • Строители: дом, терраса, крыльцо, дорожки, забор, перила
// Антураж подключается отдельным файлом:
//   viewer3d-entourage.js → _buildEntourage(scene), IS_MOBILE
//   (платформа определяется автоматически внутри entourage)
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
// МАППИНГ S.houseType → typeId дескриптора
// (Шаг 1 UI использует «человеческие» имена; дескрипторы лежат под typeId='type_NN'.)
// «Участок без дома» → null (дом не рендерится).
// ══════════════════════════════════════════════
const HOUSE_TYPE_MAP = {
  'Одноэтажный дом':  'type_01',
  'Двухэтажный дом':  'type_09',
  'Дом с мансардой':  'type_10',
  'Участок без дома': null,
};

function getHouseTypeId() {
  const name = (typeof S !== 'undefined') ? S.houseType : null;
  if (!name) return null;
  if (name in HOUSE_TYPE_MAP) return HOUSE_TYPE_MAP[name];
  // Если houseType — это уже typeId (например, для тестов), пропускаем напрямую
  if (/^type_\d+$/.test(name)) return name;
  return null;
}

// Кэш загруженного дескриптора и GLB-модулей. Один за раз — пересоздаётся при смене типа.
// Загрузка async, но buildScene3d синхронный: если desc ещё не загружен, дом не рендерится,
// после завершения промиса rebuildHouseAsync() пересоберёт сцену.
const _houseCache = { typeId: null, desc: null, modules: null, loadingPromise: null };

async function ensureHouseLoaded() {
  const typeId = getHouseTypeId();
  if (!typeId) { _houseCache.typeId = null; _houseCache.desc = null; _houseCache.modules = null; return null; }
  if (_houseCache.typeId === typeId && _houseCache.desc) return _houseCache;
  if (_houseCache.loadingPromise && _houseCache.typeId === typeId) return _houseCache.loadingPromise;
  _houseCache.typeId = typeId;
  _houseCache.desc = null;
  _houseCache.modules = null;
  _houseCache.loadingPromise = (typeof HouseBuilder !== 'undefined' ? HouseBuilder.loadHouseType(typeId) : Promise.reject(new Error('HouseBuilder not loaded')))
    .then(loaded => {
      _houseCache.desc = loaded.desc;
      _houseCache.modules = loaded.modules;
      _houseCache.loadingPromise = null;
      return _houseCache;
    })
    .catch(err => {
      console.error('[3D] ensureHouseLoaded fail:', err);
      _houseCache.loadingPromise = null;
      throw err;
    });
  return _houseCache.loadingPromise;
}

// Удобный вспомогательный wrapper для смены типа дома: запускает loader, после успеха перестраивает сцену.
function rebuildHouseAsync() {
  ensureHouseLoaded().then(() => { if (threeState) buildScene3d(); }).catch(()=>{});
}

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
// НАСТРОЙКА OrbitControls (единый источник)
// ══════════════════════════════════════════════
function _setupControls(camera, domElement) {
  const c = new THREE.OrbitControls(camera, domElement);
  c.enableDamping  = true;
  c.dampingFactor  = 0.08;
  c.minDistance    = 4;
  c.maxDistance    = 50;
  c.maxPolarAngle  = Math.PI / 2.05;
  // Правая кнопка — pan (перемещение), средняя — dolly
  c.mouseButtons.LEFT   = THREE.MOUSE.ROTATE;
  c.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  c.mouseButtons.RIGHT  = THREE.MOUSE.PAN;
  c.enablePan = true;
  c.screenSpacePanning = true;
  // Камера не опускается ниже земли
  c.addEventListener('change', () => {
    if (camera.position.y < 0.3) camera.position.y = 0.3;
  });
  return c;
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
  const controls = _setupControls(camera, renderer.domElement);
  controls.target.set(4, 2, 2.5);

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

  // Группа для растительности (очищается при каждой перестройке)
  const vegGroup = new THREE.Group();
  scene.add(vegGroup);

  threeState = {
    renderer, scene, camera, controls,
    houseGroup, vegGroup, skyMesh, sunLight, ambLight, groundMesh,
    envMap: null, texCache: {},
    wallMeshes: [], deckMeshes: [], porchMeshes: [],
    stepMeshes: [], fenceMeshes: [], railingMeshes: [],
    currentSlot: targetSlotId,
    animId: null,
  };

  // Антураж (растительность) вызывается из buildScene3d
  // после того как размечены конструкции

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

  // Штукатурка стен
  const wall = new THREE.MeshStandardMaterial({
    color:           0xf5e6c8,
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

  // Цоколь
  const base = new THREE.MeshStandardMaterial({
    color:           0x8a8278,
    roughness:       0.88,
    metalness:       0.04,
    envMap:          env,
    envMapIntensity: eI * 0.4,
  });
  base.map       = _loadTex('base_diff.jpg', 1);
  base.normalMap = _loadNorm('base_norm.jpg', 1);
  // UV назначаются на меш через _applyBoxUV(mesh, 1.0) в buildHouseMeshes

  // Крыша
  const roof = new THREE.MeshStandardMaterial({
    color:           0x8b3a3a,
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

  // Рамы
  const frame = new THREE.MeshStandardMaterial({
    color:           0xf0f0ee,
    roughness:       0.28,
    metalness:       0.28,
    envMap:          env,
    envMapIntensity: eI * 1.0,
    polygonOffset:      true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });

  // Дверь
  const door = new THREE.MeshStandardMaterial({
    color:           0x5c3a1e,
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

  return { wall, base, roof, glass, frame, door, deck, joist, post, step };
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

  // Базовый зелёный (приглушённый)
  ctx.fillStyle = '#2e4a22';
  ctx.fillRect(0, 0, sz, sz);

  // Крупные пятна — эллиптические, органичные формы
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 40 + Math.random() * 160;
    const hue = 80 + Math.random() * 40 | 0;
    const sat = 18 + Math.random() * 22 | 0;
    const lt  = 14 + Math.random() * 18 | 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1, 0.4 + Math.random() * 0.8);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `hsla(${hue},${sat}%,${lt}%,0.40)`);
    g.addColorStop(0.6, `hsla(${hue},${sat}%,${lt}%,0.15)`);
    g.addColorStop(1, 'hsla(100,20%,16%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Средние пятна — тоже эллиптические
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 6 + Math.random() * 28;
    const hue = 70 + Math.random() * 50 | 0;
    const lt  = 12 + Math.random() * 22 | 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1, 0.5 + Math.random());
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `hsla(${hue},24%,${lt}%,0.28)`);
    g.addColorStop(1, 'hsla(90,20%,14%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Мелкая фактура (точки — округлость не заметна)
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * sz, y = Math.random() * sz;
    const r = 1 + Math.random() * 4;
    const hue = 65 + Math.random() * 55 | 0;
    const lt  = 12 + Math.random() * 22 | 0;
    ctx.fillStyle = `hsla(${hue},22%,${lt}%,0.20)`;
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
  const { houseGroup, vegGroup, controls } = threeState;

  clearGroup(houseGroup, true);   // диспозим материалы, мы их и создаём
  if (vegGroup) clearGroup(vegGroup, false);   // материалы общие с GLB-источником
  threeState.wallMeshes    = [];
  threeState.deckMeshes    = [];
  threeState.porchMeshes   = [];
  threeState.stepMeshes    = [];
  threeState.fenceMeshes   = [];
  threeState.railingMeshes = [];
  threeState.canopyMeshes  = [];

  const M = getHouseMats();

  // Применяем цвет активного образца к нужной секции
  if (S.activeSample && S.activeSample.color) {
    const sec   = getActive()[S.curSec];
    const secId = sec ? sec.id : 'terrace';
    if      (secId === 'facade') M.wall.color.set(S.activeSample.color);
    else if (secId === 'porch')  M.step.color.set(S.activeSample.color);
    else if (secId === 'fence')  { /* fence uses its own mat */ }
    else                         M.deck.color.set(S.activeSample.color);
  }

  const isNoHouse = (S.houseType === 'Участок без дома');
  // Параметры собираем через dCollectParams (nav-desktop.js) — поддерживает per-floor массивы.
  // Если она недоступна (например, мобильная версия) — fallback на legacy DOM-id'и.
  const collected = (typeof dCollectParams === 'function')
    ? dCollectParams()
    : {
        area:   parseFloat(document.getElementById('v-area')?.value  || 80),
        floorH: parseFloat(document.getElementById('v-floor')?.value || 300),
        baseH:  parseFloat(document.getElementById('v-found')?.value || 80),
        floorAreas: [],
        floorHs: [],
      };
  const areaRaw  = collected.area;
  const floorRaw = collected.floorH;
  const foundRaw = collected.baseH;
  const area   = Math.min(140, Math.max(40, areaRaw));
  const wallH  = Math.min(3.6, Math.max(2.4, floorRaw / 100));
  const foundH = Math.min(1.2, Math.max(0.5, foundRaw / 100));
  const RATIO  = 1.6, wt = 0.2;
  let houseW = Math.sqrt(area / RATIO);
  let houseL = houseW * RATIO;
  const wh     = wallH;
  const bh     = foundH;

  // Если дескриптор уже загружен — переопределяем houseL/houseW реальными
  // размерами bbox полигона (для крестообразных, T-, L-, П-форм). Также
  // сохраняем bbox.minX/minZ для корректного маппинга канвас→мир.
  _houseBboxMinX = 0;
  _houseBboxMinZ = 0;
  if (!isNoHouse && typeof HouseBuilder !== 'undefined'
      && typeof HouseBuilder.getHouseFloorPolygon === 'function'
      && _houseCache.desc) {
    const poly = HouseBuilder.getHouseFloorPolygon(_houseCache.desc, { area });
    if (poly && poly.bbox) {
      houseL = poly.bbox.maxX - poly.bbox.minX;
      houseW = poly.bbox.maxZ - poly.bbox.minZ;
      _houseBboxMinX = poly.bbox.minX;
      _houseBboxMinZ = poly.bbox.minZ;
    }
  }

  // usingHouseBuilder вычисляется выше блока if(!isNoHouse), чтобы быть видимым
  // ниже (где порчевая логика решает, рисовать ли процедурное крыльцо).
  const usingHouseBuilder = !isNoHouse && (typeof HouseBuilder !== 'undefined' && _houseCache.desc && _houseCache.modules);
  if (!isNoHouse) {
    // Используем модульную сборку по дескриптору, если он загружен (см. ensureHouseLoaded).
    // Если ещё нет — fallback на старый процедурный билдер (timeout пока async).
    if (usingHouseBuilder) {
      // Pad дома и pad крыльца HouseBuilder строит САМ — по реальному bbox outline.
      // Крыльцо строится ТОЛЬКО когда пользователь явно настроил его в UI (sidebar
      // → Крыльцо → Готово). Toggle'ы «Навес» / «Перила» — из canvas-редактора крыльца.
      // Крыльцо HouseBuilder отключено — порч строит процедурный buildPorch3d ниже,
      // по нарисованному пользователем прямоугольнику (свободное размещение).
      HouseBuilder.buildHouseFromDescriptor(
        houseGroup,
        _houseCache.desc,
        _houseCache.modules,
        {
          area,
          floorH:     floorRaw,
          baseH:      foundRaw,
          floorAreas: collected.floorAreas,
          floorHs:    collected.floorHs,
        },
        { controls, porchEnabled: false }
      );
    } else {
      // Дескриптор ещё не загружен — рисуем процедурный fallback и запускаем загрузку.
      buildHouseMeshes(houseGroup, M, houseL, houseW, wh, bh, wt);
      if (typeof HouseBuilder !== 'undefined') {
        // Async-loader, после успеха сцена будет перестроена через rebuildHouseAsync.
        rebuildHouseAsync();
      }
      // Pad под процедурным домом (старый fallback) — по houseL/houseW.
      const padW = houseL + 0.6, padD = houseW + 0.6, padH = 0.05;
      const padGeo = new THREE.BoxGeometry(padW, padH, padD);
      const padMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.0 });
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.position.set(houseL/2, padH/2, houseW/2);
      padMesh.receiveShadow = true;
      houseGroup.add(padMesh);
    }
  }

  if (S.sections.includes('terrace') && S.pts.terrace.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.terrace, (isNoHouse ? 0.35 : bh) - 0.01, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('pool_terrace') && S.pts.pool_terrace.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.pool_terrace, (isNoHouse ? 0.35 : bh) - 0.01, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('pier') && S.pts.pier.length >= 3)
    buildTerrace3d(houseGroup, M, S.pts.pier, 0.5, houseL, houseW, 'deckMeshes');

  if (S.sections.includes('paths') && S.pts.paths.filter(p=>!p.break).length >= 2)
    buildPaths3d(houseGroup, M, S.pts.paths, houseL, houseW);

  // Крыльцо — свободное размещение по нарисованному пользователем прямоугольнику.
  // buildPorch3d сам определяет ближайшую стену дома и направление ступеней.
  // Toggle'ы «Навес»/«Перила» читаются внутри buildPorch3d.
  if (S.sections.includes('porch') && !isNoHouse)
    buildPorch3d(houseGroup, M, S.porch, houseL, houseW, bh);

  if (S.sections.includes('fence') && S.pts.fence.filter(p=>!p.break).length >= 2)
    buildFence3d(houseGroup, M, S.pts.fence, houseL, houseW);

  const terraceRailingOn = document.querySelector('.tg[data-id="terrace-railing"]')?.classList.contains('on');
  if (terraceRailingOn && S.pts.terrace.length >= 3)
    buildRailing3d(houseGroup, M, S.pts.terrace, isNoHouse ? 0.35 : bh, houseL, houseW);

  const terraceCanopyOn = document.querySelector('.tg[data-id="terrace-roof"]')?.classList.contains('on');
  if (terraceCanopyOn && S.pts.terrace.length >= 3)
    buildTerraceCanopy3d(houseGroup, M, S.pts.terrace, isNoHouse ? 0.35 : bh, houseL, houseW);

  // Собираем зоны, занятые конструкциями (для проверки растительности)
  threeState.occupiedZones = [];
  if (!isNoHouse) {
    threeState.occupiedZones.push({ type:'rect', minX:-0.5, maxX:houseL+0.5, minZ:-0.5, maxZ:houseW+0.5 });
  }
  for (const secId of ['terrace','pool_terrace','pier']) {
    if (S.sections.includes(secId) && S.pts[secId].length >= 3) {
      threeState.occupiedZones.push({ type:'poly', points:canvasToWorld(S.pts[secId],houseL,houseW) });
    }
  }
  if (S.sections.includes('paths') && S.pts.paths.filter(p=>!p.break).length >= 2) {
    const pw2=parseFloat(document.getElementById('v-paths-width')?.value||120)/100;
    const segs2=(typeof splitAtBreaks==='function')?splitAtBreaks(S.pts.paths):[S.pts.paths.filter(p=>!p.break)];
    for(const seg of segs2){if(seg.length<2)continue; threeState.occupiedZones.push({type:'path',points:canvasToWorld(seg,houseL,houseW),width:pw2});}
  }
  if (S.sections.includes('porch') && !isNoHouse) {
    const gs2=GRID,ox2=(gs2-houseL)/2,oz2=(gs2-houseW)/2;
    const ppx=S.porch.x*gs2-ox2,ppz=S.porch.y*gs2-oz2,ppw=S.porch.w*gs2,ppd=S.porch.h*gs2;
    threeState.occupiedZones.push({type:'rect',minX:ppx,maxX:ppx+ppw,minZ:ppz,maxZ:ppz+ppd});
  }

  // Антураж (растительность) — только когда есть размеченные конструкции
  const hasLayout = S.pts.terrace.length >= 3
    || S.pts.paths.length >= 2
    || S.pts.fence.length >= 2
    || S.sections.includes('porch');
  if (hasLayout && typeof _buildEntourage === 'function') {
    _buildEntourage(threeState.vegGroup || threeState.scene);
  }

  const cx = isNoHouse ? 0 : houseL/2;
  const cy = isNoHouse ? 1 : (bh+wh)/2;
  const cz = isNoHouse ? 0 : houseW/2;
  controls.target.set(cx, cy, cz);
  controls.update();
}

// disposeMaterials: true только для групп, чьи материалы создаём мы (houseGroup).
// Для vegGroup ставим false: GLB-клоны шарят материал с источником в загрузчике
// (THREE.Object3D.clone() делает shallow-копию материала), и dispose сломает
// будущие clone() при следующей пересборке сцены.
function clearGroup(group, disposeMaterials) {
  const mats = disposeMaterials ? new Set() : null;
  (function recurse(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (mats && c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => mats.add(m));
        else                            mats.add(c.material);
      }
      if (c.children && c.children.length) recurse(c);
    }
  })(group);
  if (mats) {
    mats.forEach(m => { if (m && typeof m.dispose === 'function') m.dispose(); });
  }
  // Текстуры не диспозим — они в texCache и переиспользуются между сборками.
}

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

function canvasToWorld(pts, houseL, houseW) {
  const gridSize=GRID, offsetX=(gridSize-houseL)/2, offsetZ=(gridSize-houseW)/2;
  return pts.map(p=>({ x:p.x*gridSize-offsetX+_houseBboxMinX, z:p.y*gridSize-offsetZ+_houseBboxMinZ }));
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
  const hasCanopy  = !!document.querySelector('.tg[data-id="porch-canopy"]')?.classList.contains('on');
  const hasRailing = !!document.querySelector('.tg[data-id="porch-railing"]')?.classList.contains('on');
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
          0, 'mat_porch_column', 0xc7a878
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

function buildPaths3d(parent,M,pts,houseL,houseW){
  const realPts=pts.filter(p=>!p.break);
  if(realPts.length<2)return;
  const pathW=parseFloat(document.getElementById('v-paths-width')?.value||120)/100;
  const boardW=.14,boardH=.022,gap=.005;
  const pathGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  // Разбиваем на сегменты по маркерам break
  const segments = (typeof splitAtBreaks==='function') ? splitAtBreaks(pts) : [realPts];
  for(const seg of segments){
    if(seg.length<2)continue;
    const worldPts=canvasToWorld(seg,houseL,houseW);
    for(let i=0;i<worldPts.length-1;i++){
      const a=worldPts[i],b=worldPts[i+1],dx=b.x-a.x,dz=b.z-a.z;
      const segLen=Math.sqrt(dx*dx+dz*dz); if(segLen<.1)continue;
      const angle=Math.atan2(dx,dz);
      for(let d=boardW/2;d<segLen;d+=boardW+gap){
        const t=d/segLen,bx=a.x+dx*t,bz=a.z+dz*t;
        const bd=meshFn(box(pathW,boardH,boardW),M.deck);bd.position.set(bx,boardH/2,bz);bd.rotation.y=angle;pathGroup.add(bd);threeState.deckMeshes.push(bd);
      }
    }
  }
  parent.add(pathGroup);
}

function buildFence3d(parent,M,pts,houseL,houseW){
  const realPts=pts.filter(p=>!p.break);
  if(realPts.length<2)return;
  const fenceH=1.8,postW=.1,boardH=fenceH-.2,boardT=.02;
  const fenceGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  const fenceMat=new THREE.MeshStandardMaterial({color:0x8B7355,roughness:.80,metalness:.05});
  // Разбиваем на сегменты по маркерам break
  const segments = (typeof splitAtBreaks==='function') ? splitAtBreaks(pts) : [realPts];
  for(const seg of segments){
    if(seg.length<2)continue;
    const worldPts=canvasToWorld(seg,houseL,houseW);
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
  }
  parent.add(fenceGroup);
}

function buildRailing3d(parent,M,pts,deckHeight,houseL,houseW){
  if(pts.length<3)return;
  const worldPts=canvasToWorld(pts,houseL,houseW);
  // Единый стиль с крыльцом: деревянный поручень + вертикальные балясины (сталь/серый).
  const railH=0.95, handT=0.05, balW=0.04, balStep=0.15;
  const railGroup=new THREE.Group();
  const box=(sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz);
  const meshFn=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;return m;};
  // Материалы: handMat — поручень (дерево, как настил террасы), baluMat — балясины (тёмный пост-материал).
  const railFallback=new THREE.MeshStandardMaterial({color:0x777777,roughness:.60,metalness:.3});
  const handMat = M.deck || railFallback;
  const baluMat = M.post || M.step || railFallback;

  // Прямоугольник крыльца (если оно есть) в мировых координатах — для исключения сегментов перил, пересекающих крыльцо.
  let porchRect=null;
  if(S.sections.includes('porch')){
    const gridSize=GRID,offsetX=(gridSize-houseL)/2,offsetZ=(gridSize-houseW)/2,p=S.porch;
    const px1=p.x*gridSize-offsetX+_houseBboxMinX,pz1=p.y*gridSize-offsetZ+_houseBboxMinZ;
    const px2=(p.x+p.w)*gridSize-offsetX+_houseBboxMinX,pz2=(p.y+p.h)*gridSize-offsetZ+_houseBboxMinZ;
    porchRect={minX:Math.min(px1,px2),maxX:Math.max(px1,px2),minZ:Math.min(pz1,pz2),maxZ:Math.max(pz1,pz2)};
  }

  // Рёбра реального полигона дома в мировых координатах (для скрытия перил у стен).
  let houseEdges=[];
  if (typeof HouseBuilder !== 'undefined'
      && typeof HouseBuilder.getHouseFloorPolygon === 'function'
      && _houseCache.desc) {
    const params = { area: parseFloat(document.getElementById('v-area')?.value || 80) };
    const poly = HouseBuilder.getHouseFloorPolygon(_houseCache.desc, params);
    if (poly && poly.corners && poly.corners.length >= 3) {
      const c = poly.corners;
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i+1)%c.length];
        houseEdges.push([a.x, a.z, b.x, b.z]);
      }
    }
  }

  // Возвращает t-диапазоны [t0,t1] на сегменте (ax,az)→(bx,bz), которые
  // нужно ПРОПУСТИТЬ, потому что сегмент прилегает к стене дома (параллелен ей
  // в пределах углового допуска И отстоит не дальше pad).
  function _wallSkipRanges(ax,az,bx,bz,pad){
    const dx=bx-ax, dz=bz-az;
    const len=Math.sqrt(dx*dx+dz*dz);
    if (len < 0.01) return [];
    const dux=dx/len, duz=dz/len;
    const ranges=[];
    for (const [h0x,h0z,h1x,h1z] of houseEdges) {
      const hdx=h1x-h0x, hdz=h1z-h0z;
      const hlen=Math.sqrt(hdx*hdx+hdz*hdz);
      if (hlen < 0.01) continue;
      const hux=hdx/hlen, huz=hdz/hlen;
      // Параллельность: |векторное произведение| < 0.1 ≈ до ~6° наклона
      if (Math.abs(dux*huz - duz*hux) > 0.1) continue;
      // Перпендикулярное расстояние от линии (h0,h1) до точки (ax,az)
      const vx=ax-h0x, vz=az-h0z;
      const dot=vx*hux + vz*huz;
      const perpSq = Math.max(0, vx*vx+vz*vz - dot*dot);
      if (perpSq > pad*pad) continue;
      // Проекция h0,h1 на ось сегмента (ax→bx) с нормировкой к [0..1]
      const t0=((h0x-ax)*dux + (h0z-az)*duz) / len;
      const t1=((h1x-ax)*dux + (h1z-az)*duz) / len;
      const tmin=Math.max(0, Math.min(t0,t1));
      const tmax=Math.min(1, Math.max(t0,t1));
      if (tmax > tmin + 0.001) ranges.push([tmin, tmax]);
    }
    // Сортировка и слияние перекрывающихся
    ranges.sort((a,b)=>a[0]-b[0]);
    const merged=[];
    for (const r of ranges) {
      if (merged.length && r[0] <= merged[merged.length-1][1] + 0.001) {
        merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], r[1]);
      } else {
        merged.push([r[0], r[1]]);
      }
    }
    return merged;
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

  // Поручень + вертикальные балясины — стиль идентичный крыльцу.
  function drawRailSeg(a_x,a_z,b_x,b_z){
    const sdx=b_x-a_x, sdz=b_z-a_z;
    const sLen=Math.sqrt(sdx*sdx+sdz*sdz);
    if(sLen < 0.1) return;
    const angle = Math.atan2(sdx, sdz);
    // Поручень (деревянный)
    const hand = meshFn(box(handT, handT, sLen), handMat);
    hand.position.set((a_x + b_x)/2, deckHeight + railH, (a_z + b_z)/2);
    hand.rotation.y = angle;
    railGroup.add(hand);
    threeState.railingMeshes.push(hand);
    // Балясины: равномерно с шагом ~balStep, по краям отступ margin (как у крыльца).
    const margin = 0.18;
    const usable = sLen - 2 * margin;
    if (usable < 0) return;
    const n = Math.max(2, Math.floor(usable / balStep));
    const ux = sdx / sLen, uz = sdz / sLen;
    for (let i = 0; i <= n; i++) {
      const t = margin + (n > 0 ? i * usable / n : 0);
      const bxR = a_x + ux * t, bzR = a_z + uz * t;
      const balu = meshFn(box(balW, railH, balW), baluMat);
      balu.position.set(bxR, deckHeight + railH/2, bzR);
      railGroup.add(balu);
      threeState.railingMeshes.push(balu);
    }
  }

  // Применяет к сегменту t-диапазоны skip (от стен) → массив подсегментов.
  function _splitBySkipRanges(ax,az,bx,bz,skipRanges){
    const out=[];
    let t=0;
    for (const [s,e] of skipRanges) {
      if (s > t + 0.001) {
        out.push({ax: ax+(bx-ax)*t, az: az+(bz-az)*t, bx: ax+(bx-ax)*s, bz: az+(bz-az)*s});
      }
      t = Math.max(t, e);
    }
    if (t < 1 - 0.001) out.push({ax: ax+(bx-ax)*t, az: az+(bz-az)*t, bx, bz});
    return out;
  }

  for(let i=0;i<worldPts.length;i++){
    const cur=worldPts[i], next=worldPts[(i+1)%worldPts.length];
    // 1) Сначала убираем участки, прилегающие к стенам дома (pad = 0.30 м —
    //    половина типичной толщины стены + сам перильный пост).
    const wallSkip = _wallSkipRanges(cur.x, cur.z, next.x, next.z, 0.30);
    const afterWall = _splitBySkipRanges(cur.x, cur.z, next.x, next.z, wallSkip);
    // 2) Каждый получившийся подсегмент режем вокруг крыльца.
    for (const ws of afterWall) {
      for (const seg of splitAroundPorch(ws.ax, ws.az, ws.bx, ws.bz)) {
        drawRailSeg(seg.ax, seg.az, seg.bx, seg.bz);
      }
    }
  }
  parent.add(railGroup);
}

// Навес над террасой — вальмовая (hip) крыша над bbox полигона + колонны
// по периметру (на углах и с шагом ~2.5 м по длинным рёбрам).
// Высота согласована с навесом крыльца: низ на 2.30 м над настилом, ридж на 2.60 м.
function buildTerraceCanopy3d(parent, M, pts, deckHeight, houseL, houseW) {
  const realPts = pts.filter(p => !p.break);
  if (realPts.length < 3) return;
  const worldPts = canvasToWorld(realPts, houseL, houseW);

  // Высоты согласованы с навесом крыльца:
  //   • Низ навеса (углы bbox)  ≈ нижняя кромка переда крыльца  (bh + 2.30 + 0.01-lift ≈ bh + 2.31).
  //   • Ридж (верх скатов)      ≈ верхняя кромка зада крыльца (bh + 2.30 + 0.30 + 0.06-plate-top ≈ bh + 2.67).
  // Поэтому canopyClear=2.31 (низ на уровне порч-фронт-bottom), canopyRise=0.36
  // (подъём так, чтобы вершина риджа = верхний угол задней кромки порч-плиты).
  const canopyClear = 2.31;
  const canopyRise  = 0.36;
  const colT = 0.14;
  const colSpacing = 2.5;     // шаг промежуточных колонн на длинных рёбрах
  const matRoof = M.roof || M.deck;
  const matPost = M.post || M.step;

  // bbox полигона
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of worldPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const W = maxX - minX, D = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const longAxisX = W >= D;

  const baseY = deckHeight + canopyClear;
  const ridgeY = baseY + canopyRise;

  // Концы риджа: вдоль длинной оси, отступ от торца = half короткой стороны.
  let r0x, r0z, r1x, r1z;
  if (longAxisX) {
    r0x = cx - (W - D) / 2; r0z = cz;
    r1x = cx + (W - D) / 2; r1z = cz;
  } else {
    r0x = cx; r0z = cz - (D - W) / 2;
    r1x = cx; r1z = cz + (D - W) / 2;
  }

  // Полигон дома (для пропуска колонн у стен).
  let housePoly = null;
  if (typeof HouseBuilder !== 'undefined'
      && typeof HouseBuilder.getHouseFloorPolygon === 'function'
      && _houseCache.desc) {
    const params = { area: parseFloat(document.getElementById('v-area')?.value || 80) };
    const poly = HouseBuilder.getHouseFloorPolygon(_houseCache.desc, params);
    if (poly && poly.corners) housePoly = poly.corners;
  }
  function _nearWall(p, threshold) {
    if (!housePoly) return false;
    for (let i = 0; i < housePoly.length; i++) {
      const a = housePoly[i], b = housePoly[(i+1)%housePoly.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const lenSq = dx*dx + dz*dz;
      if (lenSq < 1e-6) continue;
      let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx2 = a.x + t * dx, cz2 = a.z + t * dz;
      if (Math.hypot(p.x - cx2, p.z - cz2) < threshold) return true;
    }
    return false;
  }

  // Колонны на углах + промежуточные на длинных рёбрах.
  const colPoints = [];
  for (let i = 0; i < worldPts.length; i++) {
    const a = worldPts[i], b = worldPts[(i + 1) % worldPts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    colPoints.push({ x: a.x, z: a.z });
    if (len > colSpacing * 1.5) {
      const nMid = Math.floor(len / colSpacing);
      for (let j = 1; j < nMid; j++) {
        const t = j / nMid;
        colPoints.push({ x: a.x + dx * t, z: a.z + dz * t });
      }
    }
  }
  for (const p of colPoints) {
    if (_nearWall(p, 0.30)) continue;
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(colT, canopyClear, colT),
      matPost
    );
    col.position.set(p.x, deckHeight + canopyClear/2, p.z);
    col.castShadow = col.receiveShadow = true;
    parent.add(col);
    threeState.canopyMeshes.push(col);
  }

  // Вальмовая крыша: 4 склона (2 трапеции + 2 треугольника) к риджу.
  // Вершины: 4 угла bbox у базы + 2 точки риджа.
  const verts = [
    [minX, baseY, minZ],  // 0: NW
    [maxX, baseY, minZ],  // 1: NE
    [maxX, baseY, maxZ],  // 2: SE
    [minX, baseY, maxZ],  // 3: SW
    [r0x,  ridgeY, r0z],  // 4: ridge0
    [r1x,  ridgeY, r1z],  // 5: ridge1
  ];
  let indices;
  if (longAxisX) {
    // Длинная ось по X. Ридж по X, торцы (треугольники) на E/W.
    indices = [
      0, 4, 5,  0, 5, 1,   // N трапеция
      2, 5, 4,  2, 4, 3,   // S трапеция
      1, 5, 2,             // E треугольник
      3, 4, 0,             // W треугольник
    ];
  } else {
    // Длинная ось по Z. Ридж по Z, торцы (треугольники) на N/S.
    indices = [
      0, 4, 1,             // N треугольник
      3, 2, 5,             // S треугольник
      0, 3, 5,  0, 5, 4,   // W трапеция
      1, 4, 5,  1, 5, 2,   // E трапеция
    ];
  }

  const positions = [];
  for (const v of verts) positions.push(...v);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Клон материала с DoubleSide — чтобы изнутри (стоя под навесом) тоже видно.
  const roofMat = matRoof.clone ? matRoof.clone() : new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.85 });
  roofMat.side = THREE.DoubleSide;
  roofMat.flatShading = true;
  const roof = new THREE.Mesh(geo, roofMat);
  roof.castShadow = roof.receiveShadow = true;
  parent.add(roof);
  threeState.canopyMeshes.push(roof);
}

// ══════════════════════════════════════════════
// MATERIAL APPLICATION (примерка образцов)
// ══════════════════════════════════════════════
function applyMaterialToScene(colorHex) {
  if (!threeState||!colorHex) return;
  const c=new THREE.Color(colorHex);
  const sec=getActive()[S.curSec], secId=sec?sec.id:'terrace';
  let targetMeshes=[], roughness=.72;
  // Поддержка суб-режима (терраса/ограждение)
  const subMode = (typeof S.matSubMode !== 'undefined') ? S.matSubMode : null;
  if(secId==='facade')     { targetMeshes=threeState.wallMeshes||[];  roughness=.85; }
  else if(secId==='porch') { targetMeshes=threeState.stepMeshes||[];  roughness=.80; }
  else if(secId==='fence') { targetMeshes=threeState.fenceMeshes||[]; roughness=.80; }
  else if(secId==='terrace' && subMode==='railing') { targetMeshes=threeState.railingMeshes||[]; roughness=.60; }
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
  // Просто переносим canvas в новый слот — controls остаются те же
  target.appendChild(threeState.renderer.domElement);
  threeState.currentSlot=slotId;
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
