// ══════════════════════════════════════════════
// VIEWER3D-CORE.JS
// Ядро 3D: сцена, материалы, оркестрация сборки.
//   • Инициализация сцены (renderer, camera, lights, ground)
//   • HDRI-освещение: загрузка assets/environment.hdr
//   • PBR-материалы с загрузкой текстур из assets/, UV-проекции
//   • buildScene3d() — оркестратор: вызывает строители из соседних файлов
// Строители вынесены (общая глобальная область видимости, порядок в index.html):
//   viewer3d-builders.js — дом-fallback, настилы, ступени, крыльцо, дорожки, забор
//   viewer3d-railing.js  — периметр террасы, ограждение (GLB), навесы
//   viewer3d-entourage.js — антураж (растительность), IS_MOBILE
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
// S.houseType → typeId дескриптора
// (S.houseType: 'type_NN' | 'no_house' | легаси-имя из HOUSE_TYPE_MAP в state.js.)
// null → дом не рендерится (пустой участок / тип не выбран).
// ══════════════════════════════════════════════
function getHouseTypeId() {
  let name = (typeof S !== 'undefined') ? S.houseType : null;
  if (!name) return null;
  if (name in HOUSE_TYPE_MAP) name = HOUSE_TYPE_MAP[name];  // легаси-имя → typeId
  if (name === 'no_house') return null;                     // пустой участок
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
      // Защита от гонки: пока грузился этот тип, пользователь мог выбрать другой —
      // тогда результат устарел и кэш (уже перенацеленный на новый тип) не трогаем.
      if (_houseCache.typeId !== typeId) return _houseCache;
      _houseCache.desc = loaded.desc;
      _houseCache.modules = loaded.modules;
      _houseCache.loadingPromise = null;
      return _houseCache;
    })
    .catch(err => {
      console.error('[3D] ensureHouseLoaded fail:', err);
      if (_houseCache.typeId === typeId) _houseCache.loadingPromise = null;
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
// Возвращает текстуру сразу (TextureLoader.load отдаёт объект синхронно и
// дозаполняет image по загрузке — стандартный паттерн three.js). Раньше здесь
// был placeholder + Object.assign(placeholder, tex): assign копировал id/uuid
// чужой текстуры и путал внутренние кэши рендерера (ловили на текстуре земли).
// Кэш: повторные вызовы с тем же путём отдают тот же объект.
// При ошибке загрузки текстура остаётся пустой — материал рендерится цветом.
// ══════════════════════════════════════════════
function _loadTexBase(cachePrefix, filename, repeat, encoding, onLoad) {
  if (!threeState) return null;
  const cache = threeState.texCache;
  const key = cachePrefix + filename + '_' + repeat;
  if (cache[key]) { if (onLoad) onLoad(cache[key]); return cache[key]; }

  const tex = new THREE.TextureLoader().load(
    ASSETS + filename,
    (t) => { if (onLoad) onLoad(t); },   // t === tex (тот же объект)
    undefined,
    () => { /* файл не найден — тихо, материал останется однотонным */ }
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.encoding = encoding;
  cache[key] = tex;
  return tex;
}

// Albedo (sRGB)
function _loadTex(filename, repeat = 4, onLoad = null) {
  return _loadTexBase('', filename, repeat, THREE.sRGBEncoding, onLoad);
}

// Normal-map (linear — sRGB не нужен)
function _loadNorm(filename, repeat = 4) {
  return _loadTexBase('norm_', filename, repeat, THREE.LinearEncoding, null);
}

// Roughness/AO (linear)
function _loadData(filename, repeat = 4) {
  return _loadTexBase('data_', filename, repeat, THREE.LinearEncoding, null);
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
  renderer.toneMappingExposure = 0.82;
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

  // Пикинг сегментов фасада (активен только в S.facadeMode; см. «Отделка фасада»)
  _initFacadePicking(renderer.domElement);

  // ── Процедурное небо (до загрузки HDRI) ───────
  const skyMesh = _buildProceduralSky();
  scene.add(skyMesh);

  // ── Освещение ─────────────────────────────────
  const ambLight = new THREE.AmbientLight(0xfff8e8, 0.2);
  scene.add(ambLight);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
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
  // Заливка неба/земли — снижена: тени глубже (раньше 0.7 размывало тени).
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x5a8a3c, 0.3));

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
  sunLight.intensity = 1.5;
  ambLight.intensity = 0.0;
  renderer.toneMappingExposure = 0.72;   // меньше пересвета (текстуры не разбеливаются)
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

  // Стены — карты по выбранному материалу (штукатурка/кирпич/сайдинг). Текстуры через
  // _houseTexSet (новые имена *_01/_02); UV на меш — _applyBoxUV в buildHouseMeshes (fallback).
  const wall = new THREE.MeshStandardMaterial({
    color:           0xefe2c8,
    roughness:       0.85,
    metalness:       0.0,
    envMap:          env,
    envMapIntensity: eI * 0.7,
  });
  wall.normalScale  = new THREE.Vector2(0.5, 0.5);
  _assignHouseMatTex(wall, _houseTexSet('wall', (typeof S !== 'undefined' && S.wallMat) || 'stucco'));

  // Цоколь — бетон (однотонный) или камень (текстура).
  const base = new THREE.MeshStandardMaterial({
    color:           0x9a9a9a,
    roughness:       0.88,
    metalness:       0.04,
    envMap:          env,
    envMapIntensity: eI * 0.4,
  });
  _assignHouseMatTex(base, _houseTexSet('base', (typeof S !== 'undefined' && S.baseMat) || 'concrete'));

  // Крыша — черепица / металл (зелёный/красный).
  const roof = new THREE.MeshStandardMaterial({
    color:           0xffffff,
    roughness:       0.80,
    metalness:       0.04,
    side:            THREE.DoubleSide,
    envMap:          env,
    envMapIntensity: eI * 0.6,
  });
  _assignHouseMatTex(roof, _houseTexSet('roof', (typeof S !== 'undefined' && S.roofMat) || 'tile'));

  // Стекло — тёмное с отражением, сквозь него плохо видно
  // MeshStandardMaterial надёжнее MeshPhysicalMaterial.transmission в r128
  const glass = new THREE.MeshStandardMaterial({
    color:           0x4a6878,  // тёмно-синеватый — имитирует тонированное стекло
    roughness:       0.04,
    metalness:       0.82,      // высокий metalness даёт отражение без transmission
    transparent:     true,
    opacity:         0.5,       // ~50% — менее прозрачное (скрывает отсутствие интерьера)
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

  // Земля в грядке (верхний слой почвы). Тёмно-коричневая, матовая.
  const soil  = new THREE.MeshStandardMaterial({ color: 0x3c2a18, roughness: 0.97, metalness: 0.0, envMap: env, envMapIntensity: eI * 0.1 });

  return { wall, base, roof, glass, frame, door, deck, joist, post, step, soil };
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

// Размер одного тайла deck-текстуры (метров). Общий масштаб для террасы, крыльца
// и ступеней. deck_diff.jpg содержит ~11 досок по высоте → доска ≈ DECK_TILE/11.
const DECK_TILE = 1.5;

// Кубическая deck-UV проекция с ориентацией досок вдоль нужной оси.
// Текстура: грувы (стыки досок) — горизонтальные линии (const V). После _applyBoxUV
// верхняя грань даёт u=X, v=Z → доски тянутся ВДОЛЬ X (по умолчанию).
//   plankAlongX = true  → доски вдоль X (без поворота);
//   plankAlongX = false → доски вдоль Z (поворот верхней грани на 90°).
// Боковые грани всегда дают горизонтальные грувы (имитация дощатой обшивки юбки).
function _applyDeckUV(mesh, plankAlongX) {
  _applyBoxUV(mesh, DECK_TILE);
  if (!plankAlongX) _rotateBoxTopUV90(mesh.geometry);
}

// Накладывает реальные PBR-текстуры товара (из каталога API, ProductResource.textures)
// на deck-материал — то есть на террасы, дорожки и борта грядок. Текстуры
// бесшовные → RepeatWrapping; тайлинг задаётся UV-проекцией (_applyBoxUV, мир/DECK_TILE),
// поэтому repeat остаётся (1,1). Вызывается ДО построения deck-мешей (порядок в buildScene3d).
function _applyDeckProductTextures(M, textures) {
  if (!textures || !M || !M.deck) return false;
  let applied = false;
  const set = (tex, slot, srgb) => {
    if (!tex) return;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (srgb) tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    M.deck[slot] = tex;
    applied = true;
  };
  set(textures.textures_dpc_diffusion, 'map', true);
  set(textures.textures_dpc_normal, 'normalMap', false);
  set(textures.textures_dpc_roughness, 'roughnessMap', false);
  if (applied) {
    M.deck.color.set(0xffffff); // не подкрашиваем поверх реальной текстуры
    M.deck.needsUpdate = true;
  }
  return applied; // false → у товара нет PBR-текстур (напр. мебель), деке не трогаем
}

// Деко-элементы, у каждого свой материал настила (S.elementMat[el]).
const DECK_ELEMENTS = ['terrace', 'steps', 'paths', 'beds', 'pool_terrace', 'pier'];

// Материал настила для конкретного элемента: дефолтный baseDeck, либо его клон с
// текстурами товара / цветом из S.elementMat[el]. Клон попадёт в меш и будет
// освобождён clearGroup при следующей пересборке.
function _resolveDeckMat(baseDeck, el) {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat[el] : null;
  if (!em) return baseDeck;
  const m = baseDeck.clone();
  if (em.textures && _applyDeckProductTextures({ deck: m }, em.textures)) return m;
  if (em.color) { m.color.set(em.color); return m; }
  m.dispose();
  return baseDeck;
}

// ══════════════════════════════════════════════
// МАТЕРИАЛЫ ДОМА (выбор на шаге «Параметры дома»)
// ══════════════════════════════════════════════
const HOUSE_ROOF_TILE  = 2.0;      // метров на тайл текстуры крыши
const HOUSE_WALL_TILE  = 1.5;      // стен
const HOUSE_BASE_TILE  = 1.0;      // цоколя
const HOUSE_WOOD_COLOR = 0x4a2f18; // коричневый для деревянных частей (рамы/двери/перила)

// Текстурный набор для материала дома: {color, map, normalMap, roughnessMap}.
// Для однотонных (штукатурка/бетон) карты = null. repeat=1 — тайлинг задаётся
// мировым UV (_applyWorldBoxUV).
function _houseTexSet(kind, variant) {
  const D = {
    roof: {
      tile:        { c: 0xffffff, d: 'roof_diff_01', n: 'roof_norm_01', r: 'roof_roug_01' },
      metal_green: { c: 0xffffff, d: 'roof_diff_02', n: 'roof_norm_02', r: 'roof_roug_02' },
      metal_red:   { c: 0xffffff, d: 'roof_diff_03', n: 'roof_norm_03', r: 'roof_roug_03' },
    },
    wall: {
      stucco: { c: 0xefe2c8 },
      brick:  { c: 0xffffff, d: 'wall_diff_01', n: 'wall_norm_01', r: 'wall_roug_01' },
      siding: { c: 0xffffff, d: 'wall_diff_02', n: 'wall_norm_02', r: 'wall_roug_02' },
    },
    base: {
      concrete: { c: 0x9a9a9a },
      stone:    { c: 0xffffff, d: 'base_diff_01', n: 'base_norm', r: 'base_roug_01' },
    },
  };
  const grp = D[kind] || {};
  const e = grp[variant] || grp[Object.keys(grp)[0]] || { c: 0xffffff };
  return {
    color:        e.c,
    map:          e.d ? _loadTex(e.d + '.jpg', 1) : null,
    normalMap:    e.n ? _loadNorm(e.n + '.jpg', 1) : null,
    roughnessMap: e.r ? _loadData(e.r + '.jpg', 1) : null,
  };
}

// Присваивает материалу цвет+карты из texSet (без UV — для getHouseMats/fallback,
// где UV ставит _applyBoxUV на меше).
function _assignHouseMatTex(m, tex) {
  if (!m) return;
  m.color.set(tex.color);
  m.map = tex.map || null;
  m.normalMap = tex.normalMap || null;
  m.roughnessMap = tex.roughnessMap || null;
  m.needsUpdate = true;
}

// Мировой box-UV: проекция по доминантной оси нормали в МИРОВЫХ координатах (через
// matrixWorld) → тайлинг корректен на трансформированных/масштабированных мешах дома.
// Клонирует геометрию (она может быть общей у GLB-инстансов).
function _applyWorldBoxUV(mesh, tileSize) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry = mesh.geometry.clone();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  if (!pos) return;
  const mw = mesh.matrixWorld;
  const nmat = new THREE.Matrix3().getNormalMatrix(mw);
  const uv = new Float32Array(pos.count * 2);
  const vP = new THREE.Vector3(), vN = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vP.fromBufferAttribute(pos, i).applyMatrix4(mw);
    if (nor) { vN.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize(); } else vN.set(0, 1, 0);
    const ax = Math.abs(vN.x), ay = Math.abs(vN.y), az = Math.abs(vN.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = vP.x / tileSize; v = vP.z / tileSize; }
    else if (ax >= az)        { u = vP.z / tileSize; v = vP.y / tileSize; }
    else                      { u = vP.x / tileSize; v = vP.y / tileSize; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv.needsUpdate = true;
}

// UV крыши: на КАЖДОМ скате текстура ориентируется одинаково — V идёт вдоль линии
// СПУСКА ската (от конька к свесу), U — поперёк (вдоль конька/свеса). Тогда
// вертикальные полосы текстуры (металл — постоянный U) идут сверху вниз по скату на
// всех скатах одинаково; ряды черепицы (постоянный V) идут горизонтально вдоль свеса.
// Геометрию де-индексируем (toNonIndexed), чтобы у каждого треугольника был свой UV,
// нормаль грани берём из позиций (не из сглаженных вершинных нормалей).
function _applyRoofUV(mesh, tileSize) {
  mesh.updateWorldMatrix(true, false);
  let geo = mesh.geometry.clone();
  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  if (!pos) { mesh.geometry = geo; return; }
  const mw = mesh.matrixWorld, t = new THREE.Vector3(), wp = [];
  for (let i = 0; i < pos.count; i++) { t.fromBufferAttribute(pos, i).applyMatrix4(mw); wp.push(t.clone()); }
  const uv = new Float32Array(pos.count * 2);
  const UPNEG = new THREE.Vector3(0, -1, 0);
  const N = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const down = new THREE.Vector3(), ridge = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const a = wp[i], b = wp[i + 1], c = wp[i + 2];
    e1.subVectors(b, a); e2.subVectors(c, a);
    N.crossVectors(e1, e2).normalize();
    if (N.y < 0) N.negate();
    down.copy(UPNEG).addScaledVector(N, -UPNEG.dot(N));        // проекция -Y на плоскость ската
    if (down.lengthSq() < 1e-8) down.set(0, 0, 1); else down.normalize();
    ridge.crossVectors(N, down).normalize();                  // поперёк ската (вдоль конька)
    for (let k = 0; k < 3; k++) {
      const p = wp[i + k];
      uv[(i + k) * 2]     = p.dot(ridge) / tileSize;
      uv[(i + k) * 2 + 1] = p.dot(down)  / tileSize;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv.needsUpdate = true;
  mesh.geometry = geo;
}

function _applyHouseTexSet(mesh, tex, tileSize, uvFn) {
  const m = mesh.material; if (!m) return;
  m.color.set(tex.color);
  if (tex.map) {
    m.map = tex.map; m.normalMap = tex.normalMap || null; m.roughnessMap = tex.roughnessMap || null;
    (uvFn || _applyWorldBoxUV)(mesh, tileSize);
  } else {
    m.map = null; m.normalMap = null; m.roughnessMap = null;
  }
  m.needsUpdate = true;
}

// Накладывает выбранные материалы дома на меши по имени материала (mat_roof/mat_wall/
// mat_base) и красит деревянные части (рамы/двери) в коричневый. Вызывать после сборки
// дома, ДО постройки террасы (чтобы не задеть deck-меши — у них нет mat_* имён).
function _applyHouseMaterials(parent) {
  if (!parent) return;
  const roofT = _houseTexSet('roof', (typeof S !== 'undefined' && S.roofMat) || 'tile');
  const wallT = _houseTexSet('wall', (typeof S !== 'undefined' && S.wallMat) || 'stucco');
  const baseT = _houseTexSet('base', (typeof S !== 'undefined' && S.baseMat) || 'concrete');
  parent.traverse(o => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const nm = o.material.name || '';
    if      (nm === 'mat_roof') {
      _applyHouseTexSet(o, roofT, HOUSE_ROOF_TILE, _applyRoofUV);
      // Крыша смотрит вверх → ловит максимум неба через scene.environment (IBL).
      // При envMapIntensity=1 текстура разбеливалась; снижаем до 0.25.
      o.material.envMapIntensity = 0.25;
      o.material.needsUpdate = true;
    }
    else if (nm === 'mat_wall') _applyHouseTexSet(o, wallT, HOUSE_WALL_TILE);
    else if (nm === 'mat_base') _applyHouseTexSet(o, baseT, HOUSE_BASE_TILE);
    else if (nm === 'mat_reveal') {
      // Простенки окон (заполнение над/под окном) — белый матовый материал.
      o.material.color.set(0xf2f2f0);
      o.material.map = null; o.material.normalMap = null; o.material.roughnessMap = null;
      o.material.metalness = 0.0; o.material.roughness = 0.9;
      o.material.needsUpdate = true;
    } else if (nm === 'mat_metal') {
      // Водостоки + труба — единый металл.
      o.material.color.set(0x66666b);
      o.material.map = null;
      o.material.metalness = 0.85; o.material.roughness = 0.30;
      o.material.needsUpdate = true;
    } else if (nm === 'mat_glass') {
      // Стекло: меньше прозрачности (~50%).
      o.material.transparent = true;
      o.material.opacity = 0.5;
      o.material.needsUpdate = true;
    } else if (nm === 'mat_curtain') {
      // Шторы — белая матовая ткань с картой нормалей (складки).
      o.material.color.set(0xffffff);
      o.material.map = null;
      o.material.normalMap = _loadNorm('curtain_norm.jpg', 1);
      o.material.metalness = 0.0;
      o.material.roughness = 0.9;
      o.material.needsUpdate = true;
    } else if (nm === 'mat_door' || nm.indexOf('mat_frame') === 0) {
      // Деревянные части (рамы/двери) — матовый коричневый.
      o.material.color.set(HOUSE_WOOD_COLOR);
      o.material.metalness = 0.0;
      o.material.roughness = 0.65;
      o.material.map = null;
      o.material.needsUpdate = true;
    }
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
  threeState.bedMeshes     = [];
  threeState.facadeSegs    = [];      // вертикальные сегменты стен (segId) — соберём после сборки дома
  threeState._facadePanelMat = null;  // материал панелей уже диспознут clearGroup'ом выше

  const M = getHouseMats();

  // Базовый deck-материал. Деко-элементы (терраса/ступени/дорожки/грядки/бассейн/
  // причал) красятся НЕЗАВИСИМО: перед сборкой каждого M.deck подменяется на его
  // материал из S.elementMat (см. _resolveDeckMat). Базовый используется как дефолт.
  const _baseDeck = M.deck;

  // Цвет активного образца для крыльца. Деко-элементы красятся per-element ниже;
  // фасад — per-segment через _applyFacadeSelection (S.elementMat.facade + S.wallZones).
  if (S.activeSample && S.activeSample.color) {
    const sec   = getActive()[S.curSec];
    const secId = sec ? sec.id : '';
    if (secId === 'porch') M.step.color.set(S.activeSample.color);
  }

  // «Пустой участок»: единая проверка isEmptyLot (state.js). Десктоп хранит
  // 'no_house', легаси — строку; раньше сравнение только со строкой ломало режим
  // (при 'no_house' рисовался процедурный fallback-дом).
  const isNoHouse = isEmptyLot();
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
  // Полигон считается ОДИН РАЗ на сборку и кэшируется в _housePoly — все
  // билдеры (доски/ступени/перила/навесы) берут его отсюда, а не пересчитывают
  // с чтением v-area из DOM (раньше — до 5 повторных вычислений за сборку,
  // причём с НЕклампованной площадью — мог разойтись с реально построенным домом).
  _houseBboxMinX = 0;
  _houseBboxMinZ = 0;
  _housePoly = null;
  if (!isNoHouse && typeof HouseBuilder !== 'undefined'
      && typeof HouseBuilder.getHouseFloorPolygon === 'function'
      && _houseCache.desc) {
    const poly = HouseBuilder.getHouseFloorPolygon(_houseCache.desc, { area });
    _housePoly = poly || null;
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
    // Выбранные материалы дома (крыша/цоколь/стены) + деревянные части коричневым.
    // ДО постройки террасы — deck-меши не имеют mat_* имён и не затрагиваются.
    _applyHouseMaterials(houseGroup);
    // Отделка фасада: собираем вертикальные сегменты стен (segId) и накладываем
    // выбор/материал панелей (S.wallZones + S.elementMat.facade). ПОСЛЕ
    // _applyHouseMaterials — базовый материал сегмента кэшируется уже текстурированным.
    _collectFacadeSegments(houseGroup);
    _applyFacadeSelection();
  }

  // Терраса/Крыльцо — multi-rect. Каждый rect → 4-точечный polygon → buildTerrace3d.
  // На стыках возможен z-fighting (MVP); boolean union — следующая итерация.
  const terraceRectPolys = _terraceRectsToPolygons();
  if (S.sections.includes('terrace')) {
    M.deck = _resolveDeckMat(_baseDeck, 'terrace');
    const deckH = (isNoHouse ? 0.35 : bh) - 0.01;
    const E = 0.04;   // допуск (м)
    // Направление досок блока — вдоль БЛИЖАЙШЕЙ стены дома (стабильно, не зависит от
    // разбивки на блоки): переднее/заднее крыло → доски вдоль X, боковое → вдоль Z.
    // Fallback (нет дома) — длинная сторона блока.
    let _hEdges = null;
    if (!isNoHouse && _housePoly && _housePoly.corners && _housePoly.corners.length >= 2) {
      const poly = _housePoly;
      _hEdges = [];
      for (let k = 0; k < poly.corners.length; k++) {
        const a = poly.corners[k], b = poly.corners[(k + 1) % poly.corners.length];
        _hEdges.push({ ax: a.x, az: a.z, dx: b.x - a.x, dz: b.z - a.z });
      }
    }
    const plankDir = (cx, cz, fallback) => {
      if (!_hEdges) return fallback;
      let best = Infinity, alongX = fallback;
      for (const e of _hEdges) {
        const lenSq = e.dx * e.dx + e.dz * e.dz;
        if (lenSq < 1e-6) continue;
        let t = ((cx - e.ax) * e.dx + (cz - e.az) * e.dz) / lenSq; t = Math.max(0, Math.min(1, t));
        const px = e.ax + t * e.dx, pz = e.az + t * e.dz, d = Math.hypot(cx - px, cz - pz);
        if (d < best) { best = d; alongX = Math.abs(e.dx) >= Math.abs(e.dz); }
      }
      return alongX;
    };
    // Мировые bbox + направление досок. e* — эффективные границы после подрезки углов.
    const tR = terraceRectPolys.map(pp => {
      const wp = canvasToWorld(pp, houseL, houseW);
      const minX = Math.min(...wp.map(p => p.x)), maxX = Math.max(...wp.map(p => p.x));
      const minZ = Math.min(...wp.map(p => p.z)), maxZ = Math.max(...wp.map(p => p.z));
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      return { minX, maxX, minZ, maxZ, cx, cz,
               plankAlongX: plankDir(cx, cz, (maxX - minX) >= (maxZ - minZ)),
               eMinX: minX, eMaxX: maxX, eMinZ: minZ, eMaxZ: maxZ };
    });
    // Миттер на углах перпендикулярных крыльев: подрезаем оба крыла до угловой ячейки
    // и заполняем её двумя треугольниками (доски двух направлений сходятся по диагонали).
    // Работает и для стыка встык, и для перекрытия (L/П/O-формы).
    const cornerTris = [];
    for (let i = 0; i < tR.length; i++) {
      for (let j = i + 1; j < tR.length; j++) {
        const W = tR[i].plankAlongX ? tR[i] : tR[j];   // доски вдоль X (широкое крыло)
        const Tt = tR[i].plankAlongX ? tR[j] : tR[i];  // доски вдоль Z (узкое крыло)
        if (W.plankAlongX === Tt.plankAlongX) continue; // нужны перпендикулярные крылья
        const Sx0 = Tt.minX, Sx1 = Tt.maxX, Sz0 = W.minZ, Sz1 = W.maxZ;   // угловая ячейка (x-полоса T × z-полоса W)
        // Крылья должны соприкасаться по обеим осям (связный угол; работает и для
        // перекрытия, и для встык, и для обёртки вокруг выпуклого угла дома).
        if (Math.min(W.maxX, Tt.maxX) < Math.max(W.minX, Tt.minX) - E) continue;
        if (Math.min(W.maxZ, Tt.maxZ) < Math.max(W.minZ, Tt.minZ) - E) continue;
        const exRight = W.maxX > Sx1 + E, exLeft = W.minX < Sx0 - E;
        if (exRight === exLeft) continue;               // W торчит ровно с одной стороны (угол, не T/+)
        const exUp = Tt.maxZ > Sz1 + E, exDown = Tt.minZ < Sz0 - E;
        if (exUp === exDown) continue;                  // T торчит ровно с одной стороны
        const exX = exRight ? 1 : -1, exZ = exUp ? 1 : -1;
        const innerX = exX > 0 ? Sx1 : Sx0, innerZ = exZ > 0 ? Sz1 : Sz0;
        const outerX = exX > 0 ? Sx0 : Sx1, outerZ = exZ > 0 ? Sz0 : Sz1;
        if (exX > 0) W.eMinX = Math.max(W.eMinX, innerX); else W.eMaxX = Math.min(W.eMaxX, innerX);
        if (exZ > 0) Tt.eMinZ = Math.max(Tt.eMinZ, innerZ); else Tt.eMaxZ = Math.min(Tt.eMaxZ, innerZ);
        cornerTris.push({ p: [{ x: outerX, z: outerZ }, { x: innerX, z: innerZ }, { x: innerX, z: outerZ }], pa: true });  // W-tri
        cornerTris.push({ p: [{ x: outerX, z: outerZ }, { x: innerX, z: innerZ }, { x: outerX, z: innerZ }], pa: false }); // T-tri
      }
    }
    // Подкладки (по исходным границам) + настил крыльев (по подрезанным).
    for (const R of tR) {
      if (R.maxX - R.minX < 0.3 || R.maxZ - R.minZ < 0.3) continue;
      buildConstructionPad(houseGroup, R.minX, R.maxX, R.minZ, R.maxZ, 0.30);
      const foot = [
        { x: R.eMinX, z: R.eMinZ }, { x: R.eMaxX, z: R.eMinZ },
        { x: R.eMaxX, z: R.eMaxZ }, { x: R.eMinX, z: R.eMaxZ },
      ];
      try { _buildTerracePoly(houseGroup, M, foot, deckH, R.plankAlongX, 'deckMeshes'); }
      catch (e) { console.error('[_buildTerracePoly]', e); }
    }
    for (const ct of cornerTris) {
      try { _buildTerracePoly(houseGroup, M, ct.p, deckH, ct.pa, 'deckMeshes'); }
      catch (e) { console.error('[_buildTerracePoly corner]', e); }
    }
  }

  if (S.sections.includes('pool_terrace') && S.pts.pool_terrace.length >= 3) {
    M.deck = _resolveDeckMat(_baseDeck, 'pool_terrace');
    buildTerrace3d(houseGroup, M, S.pts.pool_terrace, (isNoHouse ? 0.35 : bh) - 0.01, houseL, houseW, 'deckMeshes');
  }

  if (S.sections.includes('pier') && S.pts.pier.length >= 3) {
    M.deck = _resolveDeckMat(_baseDeck, 'pier');
    buildTerrace3d(houseGroup, M, S.pts.pier, 0.5, houseL, houseW, 'deckMeshes');
  }

  if (S.sections.includes('paths') && S.pts.paths.filter(p=>!p.break).length >= 2) {
    M.deck = _resolveDeckMat(_baseDeck, 'paths');
    buildPaths3d(houseGroup, M, S.pts.paths, houseL, houseW);
  }

  if (S.sections.includes('fence') && S.pts.fence.filter(p=>!p.break).length >= 2)
    buildFence3d(houseGroup, M, S.pts.fence, houseL, houseW);

  // Ступени — отдельная секция. Глубина в плане пересчитывается из bh.
  if (S.sections.includes('steps') && S.steps) {
    M.deck = _resolveDeckMat(_baseDeck, 'steps');
    try {
      // Подкладку строит сам buildSteps3d по реальному footprint лестницы.
      buildSteps3d(houseGroup, M, S.steps, isNoHouse ? 0.35 : bh, houseL, houseW);
    } catch (e) { console.error('[buildSteps3d]', e); }
  }

  // Грядки — GLB-модуль planter. Если ещё не загружен — грузим и перестраиваем сцену.
  if (S.sections.includes('beds') && S.beds && S.beds.length) {
    if (_planterCache) {
      M.deck = _resolveDeckMat(_baseDeck, 'beds');
      try {
        buildBeds3d(houseGroup, M, S.beds, S.bedH || 0.20, houseL, houseW);
      } catch (e) { console.error('[buildBeds3d]', e); }
    } else {
      ensurePlanterLoaded().then(c => { if (c && threeState) buildScene3d(); });
    }
  }

  // Восстанавливаем базовый deck в M (на случай, если ниже что-то на него опирается).
  M.deck = _baseDeck;

  // Мировые bbox всех террасных rect'ов — для пропуска перил/опор на внутренних
  // (стыкующихся) рёбрах: контур строится только по внешнему периметру union.
  const allRectsWorld = terraceRectPolys.map(pp => {
    const w = canvasToWorld(pp, houseL, houseW);
    return {
      minX: Math.min(...w.map(p=>p.x)), maxX: Math.max(...w.map(p=>p.x)),
      minZ: Math.min(...w.map(p=>p.z)), maxZ: Math.max(...w.map(p=>p.z)),
    };
  });

  // Навес строим ДО перил: высоту высоких столбов перила берут рейкастом по готовым плитам навеса.
  const terraceCanopyOn = tgOn('terrace-roof');
  if (terraceCanopyOn && S.sections.includes('terrace')) {
    try {
      buildTerraceCanopies(houseGroup, M, terraceRectPolys, isNoHouse ? 0.35 : bh, houseL, houseW);
    } catch (e) { console.error('[buildTerraceCanopies]', e); }
  }

  const terraceRailingOn = tgOn('terrace-railing');
  if (terraceRailingOn && S.sections.includes('terrace')) {
    if (_railingCache && _railingCache.rails) {
      // Высоту высоких столбов берём по РЕАЛЬНЫМ плитам навеса (рейкаст), а не аналитикой —
      // на стыках блоков плита обрезана по диагонали, и аналитика (max по bbox) промахивалась.
      let canopyUndersideY = null;
      if (terraceCanopyOn && threeState.canopyMeshes.length) {
        houseGroup.updateMatrixWorld(true);          // плиты навеса только что добавлены
        const _rc = new THREE.Raycaster();
        const _down = new THREE.Vector3(0, -1, 0);
        const deckY = isNoHouse ? 0.35 : bh;
        canopyUndersideY = (x, z) => {               // мировой Y НИЗА плиты навеса над точкой (или null)
          _rc.set(new THREE.Vector3(x, deckY + 10, z), _down);
          const hits = _rc.intersectObjects(threeState.canopyMeshes, true);
          return hits.length ? hits[hits.length - 1].point.y : null;   // нижнее пересечение = низ плиты
        };
      }
      // Единый контур объединения блоков → перила без разрывов на стыках.
      _railPostReg = [];   // общий реестр столбов на весь проход (дедуп на стыках петель)
      const loops = _terraceUnionLoops(allRectsWorld);
      for (const loop of loops) {
        try {
          buildRailing3d(houseGroup, loop, isNoHouse ? 0.35 : bh, houseL, houseW, canopyUndersideY);
        } catch (e) { console.error('[buildRailing3d]', e); }
      }
      _railPostReg = null;
    } else {
      // GLB ограждения ещё не загружен — грузим и перестраиваем сцену (как грядки).
      ensureRailingLoaded().then(c => { if (c && threeState) buildScene3d(); });
    }
  }

  // Собираем зоны, занятые конструкциями (для проверки растительности)
  threeState.occupiedZones = [];
  if (!isNoHouse) {
    threeState.occupiedZones.push({ type:'rect', minX:-0.5, maxX:houseL+0.5, minZ:-0.5, maxZ:houseW+0.5 });
  }
  if (S.sections.includes('terrace')) {
    for (const polyPts of terraceRectPolys) {
      threeState.occupiedZones.push({ type:'poly', points:canvasToWorld(polyPts,houseL,houseW) });
    }
  }
  for (const secId of ['pool_terrace','pier']) {
    if (S.sections.includes(secId) && S.pts[secId].length >= 3) {
      threeState.occupiedZones.push({ type:'poly', points:canvasToWorld(S.pts[secId],houseL,houseW) });
    }
  }
  if (S.sections.includes('paths') && S.pts.paths.filter(p=>!p.break).length >= 2) {
    const pw2=(S.pathWidth||120)/100;
    const segs2=(typeof splitAtBreaks==='function')?splitAtBreaks(S.pts.paths):[S.pts.paths.filter(p=>!p.break)];
    for(const seg of segs2){if(seg.length<2)continue; threeState.occupiedZones.push({type:'path',points:canvasToWorld(seg,houseL,houseW),width:pw2});}
  }
  if (S.sections.includes('beds') && S.beds) {
    for (const b of S.beds) {
      threeState.occupiedZones.push({ type:'poly', points: canvasToWorld([
        { x:b.x, y:b.y }, { x:b.x+b.w, y:b.y }, { x:b.x+b.w, y:b.y+b.h }, { x:b.x, y:b.y+b.h },
      ], houseL, houseW) });
    }
  }

  // Антураж (растительность) отключён по требованию — кусты/деревья в сцену не
  // добавляются. vegGroup очищается в начале buildScene3d, поэтому остаётся пустым.
  // (Чтобы вернуть растительность — раскомментировать вызов _buildEntourage.)
  // const hasLayout = terraceRectPolys.length > 0
  //   || S.pts.paths.length >= 2
  //   || S.pts.fence.length >= 2
  //   || (S.beds && S.beds.length > 0);
  // if (hasLayout && typeof _buildEntourage === 'function') {
  //   _buildEntourage(threeState.vegGroup || threeState.scene);
  // }

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
// ОТДЕЛКА ФАСАДА — выбор вертикальных сегментов стен в 3D
// Сегменты — wall_segment'ы с userData.segId/segW/segH (см. buildEdgeWall в
// shared/house-builder.js). Выбор — S.wallZones (segId → true); материал панелей —
// S.elementMat.facade. Пустой выбор при заданном материале = «весь фасад».
// Клик в 3D в режиме S.facadeMode тоглит сегмент (drag/orbit кликом не считается).
// Фронтоны/мансардные стены segId не имеют и под отделку не выбираются.
// ══════════════════════════════════════════════
const FACADE_SELECT_EMISSIVE = 0x2f6fd8;   // подсветка выбранных сегментов в режиме фасада

function _collectFacadeSegments(root) {
  const segs = [];
  root.traverse(o => { if (o.userData && o.userData.segId) segs.push(o); });
  threeState.facadeSegs = segs;
}

// Материал панелей отделки из S.elementMat.facade: PBR-текстуры товара каталога
// (раздел фасадных панелей, walls-тег) или однотонный цвет. null — не выбран.
function _facadePanelMaterial() {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.facade : null;
  if (!em) return null;
  const env = threeState.envMap || null;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0.0,
    envMap: env, envMapIntensity: env ? 0.5 : 0,
  });
  m.name = 'mat_facade';
  if (em.textures && _applyDeckProductTextures({ deck: m }, em.textures)) return m;
  if (em.color) { m.color.set(em.color); return m; }
  m.dispose();
  return null;
}

// Применяет выбор/материал к сегментам БЕЗ пересборки сцены (дёшево — вызывается
// на каждый клик). Родной материал меша (после _applyHouseMaterials) кэшируется в
// userData._baseMat и возвращается при снятии выбора. Мировой box-UV ставится мешу
// один раз (userData._facadeUV) — текстура панелей не растягивается масштабом сегмента.
function _applyFacadeSelection() {
  if (!threeState || !threeState.facadeSegs || !threeState.facadeSegs.length) return;
  const zones = (typeof S !== 'undefined' && S.wallZones) ? S.wallZones : {};
  const selCount = Object.keys(zones).length;
  const facadeMode = !!(typeof S !== 'undefined' && S.facadeMode);
  if (threeState._facadePanelMat) threeState._facadePanelMat.dispose();
  const panel = _facadePanelMaterial();          // ОБЩИЙ на все панельные сегменты
  threeState._facadePanelMat = panel;
  if (panel && facadeMode && selCount > 0) {
    // Панель стоит только на выбранных → подсветку можно дать общему материалу.
    panel.emissive = new THREE.Color(FACADE_SELECT_EMISSIVE);
    panel.emissiveIntensity = 0.35;
  }
  for (const seg of threeState.facadeSegs) {
    const selected = !!zones[seg.userData.segId];
    const usePanel = !!panel && (selected || selCount === 0);
    seg.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (!o.userData._baseMat) o.userData._baseMat = o.material;
      if (usePanel) {
        if (!o.userData._facadeUV) { _applyWorldBoxUV(o, HOUSE_WALL_TILE); o.userData._facadeUV = true; }
        o.material = panel;
      } else {
        o.material = o.userData._baseMat;
        // Подсветка выбранного сегмента без материала — на его собственном
        // материале (cloneModule клонирует материалы per-mesh, чужих не заденем).
        if (o.material.emissive !== undefined) {
          o.material.emissive.setHex(facadeMode && selected ? FACADE_SELECT_EMISSIVE : 0x000000);
          o.material.emissiveIntensity = 0.35;
        }
      }
    });
  }
}

// Площадь сегментов под отделку (м²) для сметы; пустой выбор = весь фасад.
function facadeSelectedAreaM2() {
  const segs = (threeState && threeState.facadeSegs) || [];
  if (!segs.length) return 0;
  const zones = (typeof S !== 'undefined' && S.wallZones) ? S.wallZones : {};
  const sel = segs.filter(s => zones[s.userData.segId]);
  const list = sel.length ? sel : segs;
  return list.reduce((a, s) => a + (s.userData.segW || 0) * (s.userData.segH || 0), 0);
}

// ── Пикинг сегментов кликом в 3D ──
let _fpDown = null;
function _initFacadePicking(dom) {
  dom.addEventListener('pointerdown', e => {
    if (e.button === 0) _fpDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  dom.addEventListener('pointerup', e => {
    const d = _fpDown; _fpDown = null;
    if (!d || e.button !== 0) return;
    // Отличаем клик от orbit-drag: малое смещение и короткое время удержания.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    if (!threeState || typeof S === 'undefined' || !S.facadeMode) return;
    _pickFacadeSegment(e.clientX, e.clientY);
  });
}

function _pickFacadeSegment(cx, cy) {
  const { renderer, camera, houseGroup } = threeState;
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  for (const h of rc.intersectObjects(houseGroup.children, true)) {
    if (h.object.material && h.object.material.transparent) continue;  // стекло — смотрим дальше
    let o = h.object, segId = null;
    while (o && o !== houseGroup) {
      if (o.userData && o.userData.segId) { segId = o.userData.segId; break; }
      o = o.parent;
    }
    if (segId) {
      if (S.wallZones[segId]) delete S.wallZones[segId];
      else S.wallZones[segId] = true;
      _applyFacadeSelection();
      if (typeof _dUpdateFacadeBar === 'function') _dUpdateFacadeBar();
    }
    return;   // первый непрозрачный хит решает — сквозь дом не выбираем
  }
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
