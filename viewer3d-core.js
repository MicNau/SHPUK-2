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

  const M = getHouseMats();

  // Базовый deck-материал. Деко-элементы (терраса/ступени/дорожки/грядки/бассейн/
  // причал) красятся НЕЗАВИСИМО: перед сборкой каждого M.deck подменяется на его
  // материал из S.elementMat (см. _resolveDeckMat). Базовый используется как дефолт.
  const _baseDeck = M.deck;

  // Цвет активного образца для НЕ-deck элементов (фасад/крыльцо). Деко-элементы
  // красятся per-element ниже, поэтому здесь deck НЕ трогаем.
  if (S.activeSample && S.activeSample.color) {
    const sec   = getActive()[S.curSec];
    const secId = sec ? sec.id : '';
    if      (secId === 'facade') M.wall.color.set(S.activeSample.color);
    else if (secId === 'porch')  M.step.color.set(S.activeSample.color);
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

        // Верх продлеваем по скату вглубь террасы — перила входят в ствол колонны на углу
        // проёма, а не висят в воздухе (см. STAIR_RAIL_INSET / terracePerimeterSegments).
        const slope0 = new THREE.Vector3().subVectors(P1, P0);
        const slopeLen0 = slope0.length() || 1e-6;
        const run = Math.hypot(botPx - topPx, botPz - topPz) || 1e-6;
        const topExt = (RAIL_INSET + CANOPY_COL_HALF) * slopeLen0 / run;
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
