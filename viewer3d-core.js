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
  // Углы прямые. Скругление задавалось ЗДЕСЬ, инлайном на канвасе рендерера, и
  // никакое правило из styles-desktop.css его не перебивало (TODO: «скругления
  // углов у 3D-окна не нужно»).
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:0;';

  // ── Scene ─────────────────────────────────────
  const scene = new THREE.Scene();
  // scene.fog отключён — мешает восприятию участка

  // ── Camera ────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  camera.position.set(18, 12, 18);

  // ── Controls ──────────────────────────────────
  const controls = _setupControls(camera, renderer.domElement);
  controls.target.set(4, 2, 2.5);
  // Как только пользователь сам покрутил/подвинул камеру — перестаём её
  // переставлять при пересборке сцены (см. хвост buildScene3d).
  controls.addEventListener('start', () => { if (threeState) threeState.camTouched = true; });


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
  _assignHouseMatTex(wall, _houseTexSet('wall', (typeof S !== 'undefined' && S.wallMat) || 'white'));

  // Цоколь — бетон (однотонный) или камень (текстура).
  const base = new THREE.MeshStandardMaterial({
    color:           0x9a9a9a,
    roughness:       0.88,
    metalness:       0.04,
    envMap:          env,
    envMapIntensity: eI * 0.4,
  });
  _assignHouseMatTex(base, _houseTexSet('base', (typeof S !== 'undefined' && S.baseMat) || 'beige'));

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

// Ребро кубической UV-проекции (метров) — ЕДИНОЕ для дома: текстура повторяется
// ровно раз в метр, поэтому масштаб рисунка одинаков у стен, цоколя и крыши.
const UV_TILE = 1.0;

// Тайл deck-текстур считается от ШИРИНЫ ДОСКИ (TODO.md, этап 1 п.9): в текстуре
// ровно DECK_BOARDS_PER_TILE досок на тайл, значит тайл = ширина доски × их число.
// Замер по assets/deck_diff.jpg: 10 грувов на 1024 px, шаг 113 px → 9 досок на тайл.
// Тем же числом досок считаются и текстуры товаров — других данных о шаге у нас нет.
const DECK_BOARDS_PER_TILE = 9;
const DECK_BOARD_W = 0.15;   // доска настила: терраса, крыльцо, проступи, дорожки, грядки
const SIDE_BOARD_W = 0.17;   // доска зашивки: юбка террасы, щёки лестницы, подступенки
const DECK_TILE = DECK_BOARD_W * DECK_BOARDS_PER_TILE;          // 1.35 м
const TERRACE_SIDE_TILE = SIDE_BOARD_W * DECK_BOARDS_PER_TILE;  // 1.53 м

// Кубическая deck-UV проекция с ориентацией досок вдоль нужной оси.
// Текстура: грувы (стыки досок) — горизонтальные линии (const V). После _applyBoxUV
// верхняя грань даёт u=X, v=Z → доски тянутся ВДОЛЬ X (по умолчанию).
//   plankAlongX = true  → доски вдоль X (без поворота);
//   plankAlongX = false → доски вдоль Z (поворот верхней грани на 90°).
// Боковые грани всегда дают горизонтальные грувы (имитация дощатой обшивки юбки).
// uvOffset — необязательное смещение проекции (как groupOffset у _applyBoxUV):
// им можно «переехать» с мировой сетки на локальную привязку. Нужно ступеням:
// см. проступи в buildSteps3d, где шов доски ставится по середине проступи.
function _applyDeckUV(mesh, plankAlongX, uvOffset) {
  _applyBoxUV(mesh, DECK_TILE, uvOffset);
  if (!plankAlongX) _rotateBoxTopUV90(mesh.geometry);
}

// UV-проекция ВДОЛЬ ЗАДАННОЙ ОСИ — для линейных элементов, у которых доска идёт
// вдоль самого элемента: столбы и балясины ограждения (ось вверх), перила и нижняя
// планка (ось вдоль пролёта), перила лестницы (ось по скату). Кубическая проекция
// для них не годится: она всегда кладёт доски горизонтально и по мировым осям, из-за
// чего у столбов рисунок ложился поперёк, а у наклонных перил — под углом к брусу.
//   u = P·dir      — вдоль элемента (в текстуре доска вытянута по U);
//   v = P·(n × dir) — поперёк, по плоскости грани (шаг досок = tile / 9).
// Ось dir не обязана совпадать с мировой: годится любое направление.
function _applyAxisUV(mesh, dir, tile) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos) return;
  const T = tile || DECK_TILE;
  const d = new THREE.Vector3(dir.x, dir.y, dir.z);
  if (d.lengthSq() < 1e-12) return;
  d.normalize();
  // Запасная ось для торцов (нормаль параллельна dir → n × dir вырождается).
  const fb = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const uv = new Float32Array(pos.count * 2);
  const vP = new THREE.Vector3(), vN = new THREE.Vector3(), vV = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vP.fromBufferAttribute(pos, i);
    if (nor) vN.fromBufferAttribute(nor, i); else vN.copy(fb);
    vV.crossVectors(vN, d);
    if (vV.lengthSq() < 1e-8) vV.crossVectors(fb, d);
    vV.normalize();
    uv[i * 2]     = vP.dot(d) / T;
    uv[i * 2 + 1] = vP.dot(vV) / T;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv.needsUpdate = true;
  ['map', 'normalMap', 'roughnessMap'].forEach(slot => {
    const tex = mesh.material && mesh.material[slot];
    if (tex) { tex.repeat.set(1, 1); tex.needsUpdate = true; }
  });
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

// Деко-элементы, у каждого свой материал настила (S.elementMat[el]): терраса у бассейна
// и причал берут те же карточки каталога, что терраса, но доска у них может быть своя.
const DECK_ELEMENTS = ['terrace', 'steps', 'paths', 'beds', 'pool_terrace'];

// Материал настила для конкретного элемента: дефолтный baseDeck, либо его клон с
// текстурами товара / цветом из S.elementMat[el]. Клон попадёт в меш и будет
// освобождён clearGroup при следующей пересборке.
// Элементы, которые до выбора товара рендерятся УСЛОВНЫМ серым, а не дефолтной
// текстурой доски (TODO.md, этап 1 п.6): терраса, ступени, ограждение и перила
// (перила берут материал ограждения). Цвет — тот же, что у полотна условного
// забора: он читается как «черновик», а не как готовый материал.
// Дорожки, грядки и терраса у бассейна в список не входят — там прежний вид.
// Пока товар не выбран — условный (серый) вид, а не дефолтная доска: терраса,
// ступени, ограждение и терраса у бассейна (TODO пп.3, 4).
const SCHEMATIC_UNTIL_PRODUCT = new Set(['terrace', 'steps', 'railing', 'pool_terrace']);
function _schematicDeckMat() {
  const c = (typeof FENCE_SCHEMATIC_COLOR !== 'undefined') ? FENCE_SCHEMATIC_COLOR : 0xb0a89c;
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 });
}

// Элементы, которые до выбора СВОЕГО товара берут материал ТЕРРАСЫ (правка
// 2026-08-30): ступени — часть той же конструкции, и по умолчанию они должны быть
// из той же доски. Ограждение сюда НЕ входит: там наследование отменено намеренно
// (TODO п.3) — перила выглядели бы отделанными без выбора товара.
const INHERIT_TERRACE_MAT = new Set(['steps']);

// Материал элемента: свой выбранный товар, иначе материал террасы (для элементов
// из INHERIT_TERRACE_MAT), иначе условный серый вид.
function _resolveDeckMat(baseDeck, el) {
  const em = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat[el] : null;
  if (!em && INHERIT_TERRACE_MAT.has(el)) {
    const t = (typeof S !== 'undefined' && S.elementMat) ? S.elementMat.terrace : null;
    if (t) return _resolveDeckMat(baseDeck, 'terrace');
  }
  if (!em) return SCHEMATIC_UNTIL_PRODUCT.has(el) ? _schematicDeckMat() : baseDeck;
  const m = baseDeck.clone();
  if (em.textures && _applyDeckProductTextures({ deck: m }, em.textures)) return m;
  if (em.color) { m.color.set(em.color); return m; }
  m.dispose();
  // Товар выбран, но ни текстур, ни цвета у него нет — условный вид тоже не годится
  // (пользователь уже сделал выбор), берём дефолтную доску.
  return baseDeck;
}

// ══════════════════════════════════════════════
// МАТЕРИАЛЫ ДОМА (выбор на шаге «Параметры дома»)
// ══════════════════════════════════════════════
// Тайлы материалов дома — тоже 1 м (единое ребро UV_TILE). Крыша использует
// проекцию по скату (_applyRoofUV), шаг тот же.
const HOUSE_ROOF_TILE  = UV_TILE;
const HOUSE_WALL_TILE  = UV_TILE;
const HOUSE_BASE_TILE  = UV_TILE;
const TERRACE_MIN_H = 0.15;   // минимальная высота настила террасы, м (TODO.md, этап 1 п.2)
// Палитра дома (стены/фундамент/рамы) — те же значения, что в HOUSE_COLORS (state.js).
const HOUSE_PALETTE = {
  white:    { c: 0xffffff },
  beige:    { c: 0xc7ba95 },
  gray:     { c: 0x7e7e7e },
  brown:    { c: 0x61564d },
  darkgray: { c: 0x1d2630 },
};

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
    // Стены, фундамент и рамы — ОДНА палитра из пяти цветов (TODO.md, этап 1 п.10).
    // Дублируется в HOUSE_COLORS (state.js), откуда рисуются образцы в UI; менять
    // синхронно. Текстур ни у одной из трёх групп нет — только цвет.
    wall:  HOUSE_PALETTE,
    base:  HOUSE_PALETTE,
    frame: HOUSE_PALETTE,
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
  const wallT = _houseTexSet('wall', (typeof S !== 'undefined' && S.wallMat) || 'white');
  const baseT = _houseTexSet('base', (typeof S !== 'undefined' && S.baseMat) || 'beige');
  const frameC = _houseTexSet('frame', (typeof S !== 'undefined' && S.frameMat) || 'brown').color;
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
      // Рамы окон и полотна дверей — матовый цвет из «Материала рам» (S.frameMat).
      o.material.color.set(frameC);
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
  threeState.bedMeshes     = [];
  threeState.furnitureMeshes = [];    // садовая мебель (GLB по точкам S.furniture)
  threeState.facadeSegs    = [];      // элементы фасада (segId) — соберём после сборки дома
  threeState.facadePillars = [];      // угловые столбы (facadePillar) — отделка «под ближайшую вставку»
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
  // Уровень настила террасы: настраивается пользователем (S.terraceH, TODO.md → ТЕРРАСА)
  // в пределах 0.10 м … высота фундамента; без дома — прежние 0.35 м. По этому уровню
  // строятся настил, ограждение, навес, ступени и посадка мебели.
  const terraceLevel = isNoHouse ? 0.35
    : Math.min(bh, Math.max(TERRACE_MIN_H, (typeof S.terraceH === 'number') ? S.terraceH : bh));

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
        // controls передаём ТОЛЬКО пока пользователь не трогал камеру: сборщик дома
        // сам центрирует вид по bbox, и на каждой пересборке это сбивало ракурс.
        { controls: threeState.camTouched ? null : controls, porchEnabled: false }
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
      const padMat = new THREE.MeshStandardMaterial({
        color: (typeof HouseBuilder !== 'undefined' && HouseBuilder.PAD_COLOR) || 0x585858,
        roughness: 0.95, metalness: 0.0 });
      const padMesh = new THREE.Mesh(padGeo, padMat);
      const _padTop = (typeof HouseBuilder !== 'undefined' && HouseBuilder.PAD_TOP_Y !== undefined)
        ? HouseBuilder.PAD_TOP_Y : 0.005;
      padMesh.position.set(houseL/2, _padTop - padH/2, houseW/2);
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

  // Настилы прямоугольных секций (RECT_SECTIONS): терраса/крыльцо и отдельно
  // стоящие — терраса у бассейна и причал. Каждый rect → 4-точечный polygon →
  // _buildTerracePoly, углы перпендикулярных крыльев сшиваются миттером.
  //   hEdges — рёбра дома (направление досок вдоль ближайшей стены); null у
  //   отдельно стоящих: там доски идут вдоль длинной стороны блока.
  // Полигон бассейна текущей сборки: ставится перед настилом террасы у бассейна,
  // остальным секциям вырез не нужен.
  let _poolPoly = null;
  const _buildRectDecks = (polys, deckH, _hEdges) => {
    const E = 0.04;   // допуск (м)
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
    const tR = polys.map(pp => {
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
      buildConstructionPad(houseGroup, R.minX, R.maxX, R.minZ, R.maxZ);
      const foot = [
        { x: R.eMinX, z: R.eMinZ }, { x: R.eMaxX, z: R.eMinZ },
        { x: R.eMaxX, z: R.eMaxZ }, { x: R.eMinX, z: R.eMaxZ },
      ];
      // Вырез под бассейн — только у террасы у бассейна и только та его часть,
      // что попадает в этот блок (TODO.md, этап 2 п.14).
      let holes = null;
      if (_poolPoly) {
        const cut = clipPolyToRect(_poolPoly, R.eMinX, R.eMaxX, R.eMinZ, R.eMaxZ);
        if (cut.length >= 3 && polyAreaM2(cut) > 0.05) holes = [cut];
      }
      try { _buildTerracePoly(houseGroup, M, foot, deckH, R.plankAlongX, 'deckMeshes', holes); }
      catch (e) { console.error('[_buildTerracePoly]', e); }
    }
    for (const ct of cornerTris) {
      try { _buildTerracePoly(houseGroup, M, ct.p, deckH, ct.pa, 'deckMeshes'); }
      catch (e) { console.error('[_buildTerracePoly corner]', e); }
    }
  };

  // Рёбра дома — направление досок пристроенной террасы.
  let _houseEdgesW = null;
  if (!isNoHouse && _housePoly && _housePoly.corners && _housePoly.corners.length >= 2) {
    _houseEdgesW = [];
    for (let k = 0; k < _housePoly.corners.length; k++) {
      const a = _housePoly.corners[k], b = _housePoly.corners[(k + 1) % _housePoly.corners.length];
      _houseEdgesW.push({ ax: a.x, az: a.z, dx: b.x - a.x, dz: b.z - a.z });
    }
  }

  // Мировые bbox блоков секции — нужны настилу и полуступени.
  const _rectsWorld = polys => polys.map(pp => {
    const w = canvasToWorld(pp, houseL, houseW);
    return {
      minX: Math.min(...w.map(p => p.x)), maxX: Math.max(...w.map(p => p.x)),
      minZ: Math.min(...w.map(p => p.z)), maxZ: Math.max(...w.map(p => p.z)),
    };
  });

  const terraceRectPolys = _terraceRectsToPolygons('terrace');
  if (S.sections.includes('terrace')) {
    M.deck = _resolveDeckMat(_baseDeck, 'terrace');
    _buildRectDecks(terraceRectPolys, terraceLevel - 0.01, _houseEdgesW);
    // Полуступень по свободному контуру (всё, кроме участков у стен дома).
    try { buildTerraceNosing(houseGroup, M, _rectsWorld(terraceRectPolys), terraceLevel - 0.01); }
    catch (e) { console.error('[buildTerraceNosing]', e); }
  }

  // Отдельно стоящие террасы: тот же настил, но доски вдоль длинной стороны блока
  // (дом на них не влияет).
  const poolRectPolys = _terraceRectsToPolygons('pool_terrace');
  if (S.sections.includes('pool_terrace') && poolRectPolys.length) {
    M.deck = _resolveDeckMat(_baseDeck, 'pool_terrace');
    _poolPoly = (typeof poolPolygonWorld === 'function') ? poolPolygonWorld(houseL, houseW) : null;
    _buildRectDecks(poolRectPolys, terraceLevel - 0.01, null);
    if (_poolPoly) {
      try { buildPool3d(houseGroup, _poolPoly, terraceLevel - 0.01); }
      catch (e) { console.error('[buildPool3d]', e); }
    }
    // Отдельно стоящая — свободен весь контур, кроме выреза под бассейн:
    // там полуступень обрывается так же, как настил (TODO п.16).
    try {
      buildTerraceNosing(houseGroup, M, _rectsWorld(poolRectPolys), terraceLevel - 0.01,
                         _poolPoly ? [_poolPoly] : null);
    } catch (e) { console.error('[buildTerraceNosing pool]', e); }
    _poolPoly = null;
  }

  if (S.sections.includes('paths') && S.pts.paths.filter(p=>!p.break).length >= 2) {
    M.deck = _resolveDeckMat(_baseDeck, 'paths');
    buildPaths3d(houseGroup, M, S.pts.paths, houseL, houseW);
  }

  // Забор: планки текстурируются товаром (свой deck-материал), рама — сплошной цвет.
  if (S.sections.includes('fence') && S.pts.fence.filter(p=>!p.break).length >= 2) {
    M.deck = _resolveDeckMat(_baseDeck, 'fence');
    buildFence3d(houseGroup, M, S.pts.fence, houseL, houseW);
  }

  // Ступени — отдельная секция. Глубина в плане пересчитывается из bh.
  if (S.sections.includes('steps') && S.steps) {
    M.deck = _resolveDeckMat(_baseDeck, 'steps');
    // Перила лестницы — ТОТ ЖЕ материал, что у ограждения террасы: одна конструкция,
    // и собирать его отдельно от своей базы значит получить другой цвет/блеск
    // (у товара без PBR-текстур база вообще решает всё).
    M.railing = _resolveDeckMat(_baseDeck, 'railing');
    // Зашивка (щёки) и подступенки — материал ТЕРРАСЫ, как её боковины.
    M.terraceSide = _resolveDeckMat(_baseDeck, 'terrace');
    try {
      // Лестниц может быть несколько (правка 2026-08-30) — строим каждую.
      // Подкладку строит сам buildSteps3d по реальному footprint лестницы.
      for (const st of (typeof stepsAll === 'function' ? stepsAll() : [S.steps])) {
        if (st) buildSteps3d(houseGroup, M, st, terraceLevel, houseL, houseW);
      }
    } catch (e) { console.error('[buildSteps3d]', e); }
    // M.railing сам к мешам не привязан (перила лестницы берут его клон) — клон-заготовку
    // освобождаем сразу, иначе на каждой пересборке остаётся висячий материал.
    if (M.railing && M.railing !== _baseDeck) M.railing.dispose();
    M.railing = null;
  }

  // Грядки. Модель planter нужна только когда выбран товар; до этого (и пока GLB
  // грузится) buildBeds3d рисует габаритные прямоугольники и сам дёргает загрузку.
  if (S.sections.includes('beds') && S.beds && S.beds.length) {
    M.deck = _resolveDeckMat(_baseDeck, 'beds');
    try {
      buildBeds3d(houseGroup, M, S.beds, S.bedH || 0.20, houseL, houseW);
    } catch (e) { console.error('[buildBeds3d]', e); }
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

  // Садовая мебель — модели по точкам плана (S.furniture). Отметка поверхности под
  // точкой: настил террасы, если точка внутри террасного блока (или причала/зоны
  // бассейна), иначе земля — мебель на террасе не проваливается под настил.
  if (S.sections.includes('furniture') && S.furniture && S.furniture.length) {
    const deckY = terraceLevel - 0.01;
    // Отдельно стоящие террасы — тоже прямоугольники; bbox достаточно.
    const rectsWorldOf = secId => (S.sections.includes(secId)
      ? _terraceRectsToPolygons(secId).map(pp => {
          const w = canvasToWorld(pp, houseL, houseW);
          return {
            minX: Math.min(...w.map(p => p.x)), maxX: Math.max(...w.map(p => p.x)),
            minZ: Math.min(...w.map(p => p.z)), maxZ: Math.max(...w.map(p => p.z)),
          };
        })
      : []);
    const poolRectsW = rectsWorldOf('pool_terrace');
    const inRects = (x, z, list) =>
      list.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
    const surfaceYAt = (x, z) => {
      if (S.sections.includes('terrace') && inRects(x, z, allRectsWorld)) return deckY;
      if (inRects(x, z, poolRectsW)) return deckY;
      return 0;                                    // земля
    };
    try {
      buildFurniture3d(houseGroup, M, S.furniture, houseL, houseW, surfaceYAt);
    } catch (e) { console.error('[buildFurniture3d]', e); }
  }

  // Ограждение идёт по СВОБОДНОМУ периметру террасы и пересчитывается на каждой
  // сборке (TODO.md, этап 2 п.4): точки руками не ставятся, разрыв под лестницу и
  // «вход» вычитаются автоматически. S.pts.railing — производный кэш этой разметки:
  // по нему рисуется план, считается смета и залипают ступени.
  if (S.sections.includes('railing') && typeof railingAutoPoints === 'function') {
    S.pts.railing = railingAutoPoints(houseL, houseW);
  }
  const railingPts = (S.pts.railing || []).filter(p => !p.break);
  if (S.sections.includes('railing') && railingPts.length >= 2) {
    // Модуль выбирается по товару: его GLB, иначе файл под вид крышки столба
    // (mod_railing_dpk/metal/plastic), иначе базовый модуль без крышки.
    const _railUrl = (typeof railingModelUrl === 'function') ? railingModelUrl() : null;
    const _railMod = (typeof railingUseModule === 'function') ? railingUseModule(_railUrl) : null;
    // Нужного модуля ещё нет в кэше — грузим и пересобираем сцену. Раньше загрузка
    // запускалась ТОЛЬКО когда не загружено вообще ничего: при смене товара (другой
    // вид крышки → другой файл) railingUseModule возвращал null, а прежний модуль
    // оставался активным — ограждение так и строилось старым, без крышки.
    // buildScene3d зовём лишь когда модуль реально появился в кэше: если GLB не
    // открылся, повторная сборка не запускается и цикл «грузим-строим» не возникает.
    if (!_railMod && _railUrl && typeof ensureRailingLoaded === 'function') {
      ensureRailingLoaded(_railUrl).then(() => {
        if (threeState && railingUseModule(_railUrl)) buildScene3d();
      });
    }
    if (_railingCache && _railingCache.rails) {
      // Материал ограждения — свой (товар раздела 2331, тег fencing), а пока товар
      // не выбран — условный, тот же, что у террасы.
      // ВНИМАНИЕ: у buildRailingLine3d шесть параметров, материал — ШЕСТОЙ. Здесь
      // стоял лишний null, материал уезжал в седьмой аргумент и терялся: ограждение
      // всегда рисовалось запасным коричневым PORCH_COLUMN_COLOR — и до выбора
      // товара, и после.
      buildRailingLine3d(houseGroup, S.pts.railing, terraceLevel, houseL, houseW,
                         _resolveDeckMat(_baseDeck, 'railing'));
    }
    // Ветки «ещё ничего не загружено» здесь больше нет: загрузку модуля запускает
    // проверка выше, она же покрывает и первую сборку.
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
  for (const [secId, polys] of [['pool_terrace', poolRectPolys]]) {
    if (!S.sections.includes(secId)) continue;
    for (const polyPts of polys) {
      threeState.occupiedZones.push({ type:'poly', points:canvasToWorld(polyPts,houseL,houseW) });
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

  // Центрируем вид на доме ТОЛЬКО пока пользователь не трогал камеру: раньше каждая
  // пересборка (в том числе «Применить» товара) возвращала цель в центр дома и сбивала
  // выбранный ракурс. Флаг сбрасывается при смене типа дома (resetCameraFraming).
  if (!threeState.camTouched) {
    const cx = isNoHouse ? 0 : houseL/2;
    const cy = isNoHouse ? 1 : (bh+wh)/2;
    const cz = isNoHouse ? 0 : houseW/2;
    controls.target.set(cx, cy, cz);
    controls.update();
  }
}

// Разрешить сцене снова выставить камеру (смена типа дома — новая геометрия,
// прежний ракурс может смотреть в пустоту).
function resetCameraFraming() {
  if (threeState) threeState.camTouched = false;
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
// ОТДЕЛКА ФАСАДА — применение панелей на выбранные элементы
// Сегменты — wall_segment'ы с userData.segId/segW/segH (см. buildEdgeWall в
// shared/house-builder.js). ВЫБОР ведётся на ПЛАНЕ (редактор «Отделка фасада»,
// initFacadeCanvas в canvas.js); здесь только применение: S.wallZones (segId → true)
// + материал S.elementMat.facade. Пустой выбор при заданном материале = «весь фасад».
// Оконные колонки (стена над/под проёмом) — два меша с ОБЩИМ segId (`:o{n}`).
// Угловые столбы (userData.facadePillar) не выбираются сами — отделываются
// АВТОМАТИЧЕСКИ «под ближайшую вставку»: если любой примыкающий (bbox-касание)
// элемент фасада выбран под панели, столб красится вместе с ним.
// Фронтоны/мансардные стены segId не имеют и под отделку не выбираются.
// ══════════════════════════════════════════════

function _collectFacadeSegments(root) {
  const segs = [], pillars = [];
  root.traverse(o => {
    if (!o.userData) return;
    if (o.userData.segId) segs.push(o);
    else if (o.userData.facadePillar) pillars.push(o);
  });
  threeState.facadeSegs = segs;
  threeState.facadePillars = pillars;
  // Смежность столбов с элементами фасада (bbox-касание с допуском) — один раз
  // на пересборку; по ней столб следует за состоянием соседних вставок.
  if (pillars.length && segs.length) {
    root.updateMatrixWorld(true);
    const segBoxes = segs.map(s => ({ id: s.userData.segId, box: new THREE.Box3().setFromObject(s) }));
    for (const p of pillars) {
      const pb = new THREE.Box3().setFromObject(p).expandByScalar(0.08);
      const adj = new Set();
      for (const sb of segBoxes) if (pb.intersectsBox(sb.box)) adj.add(sb.id);
      p.userData._adjIds = [...adj];
    }
  } else {
    for (const p of pillars) p.userData._adjIds = [];
  }
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
// на каждый клик на плане). Родной материал меша (после _applyHouseMaterials)
// кэшируется в userData._baseMat и возвращается при снятии выбора. Мировой box-UV
// ставится мешу один раз (userData._facadeUV) — текстура панелей не растягивается
// масштабом сегмента. Подсветки выбора в 3D нет: выбор виден на плане, в 3D —
// результат (панели). Материал не выбран → сцена не меняется.
function _applyFacadeSelection() {
  if (!threeState || !threeState.facadeSegs || !threeState.facadeSegs.length) return;
  const zones = (typeof S !== 'undefined' && S.wallZones) ? S.wallZones : {};
  const selCount = Object.keys(zones).length;
  if (threeState._facadePanelMat) threeState._facadePanelMat.dispose();
  const panel = _facadePanelMaterial();          // ОБЩИЙ на все панельные сегменты
  threeState._facadePanelMat = panel;
  // Общий раскрасчик: панель (с одноразовым мировым UV) либо родной материал.
  const paint = (rootObj, usePanel) => {
    rootObj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (!o.userData._baseMat) o.userData._baseMat = o.material;
      if (usePanel) {
        if (!o.userData._facadeUV) { _applyWorldBoxUV(o, HOUSE_WALL_TILE); o.userData._facadeUV = true; }
        o.material = panel;
      } else {
        o.material = o.userData._baseMat;
      }
    });
  };

  for (const seg of threeState.facadeSegs) {
    const selected = !!zones[seg.userData.segId];
    paint(seg, !!panel && (selected || selCount === 0));
  }

  // Угловые столбы — «под ближайшую вставку»: включён, если пустой выбор
  // (весь фасад) или выбран любой примыкающий элемент. Флаг _facadeOn читает
  // facadeSelectedAreaM2 (площадь столба попадает в смету вместе со вставкой).
  for (const p of (threeState.facadePillars || [])) {
    const on = selCount === 0 || (p.userData._adjIds || []).some(id => zones[id]);
    p.userData._facadeOn = on;
    paint(p, !!panel && on);
  }
}

// Площадь элементов под отделку (м²) для сметы; пустой выбор = весь фасад.
// Оконная колонка — два меша с общим segId и СВОИМИ segH (перемычка/подоконник),
// сумма по мешам даёт точную площадь без задвоения. Угловые столбы добавляются
// по флагу _facadeOn (выставляет _applyFacadeSelection).
function facadeSelectedAreaM2() {
  const segs = (threeState && threeState.facadeSegs) || [];
  if (!segs.length) return 0;
  const zones = (typeof S !== 'undefined' && S.wallZones) ? S.wallZones : {};
  const sel = segs.filter(s => zones[s.userData.segId]);
  const list = sel.length ? sel : segs;
  let a = list.reduce((s, o) => s + (o.userData.segW || 0) * (o.userData.segH || 0), 0);
  for (const p of ((threeState && threeState.facadePillars) || [])) {
    if (p.userData._facadeOn) a += (p.userData.segW || 0) * (p.userData.segH || 0);
  }
  return a;
}

// (Пикинг сегментов кликом в 3D удалён — выбор ведётся ТОЛЬКО на плане
// в редакторе «Отделка фасада», см. initFacadeCanvas в canvas.js. В 3D остаётся
// результат: панели на выбранных элементах.)

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
