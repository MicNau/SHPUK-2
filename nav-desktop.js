// NAV-DESKTOP.JS — desktop navigation, sidebar, panel, canvas editors
// Dependencies: state.js, canvas.js (init*), viewer3d-core.js

// ══════════════════════════════════════════════
// DESKTOP STATE
// ══════════════════════════════════════════════
let dStep = 1;
let dActiveItem = null;     // currently selected sidebar item id
let dEditorOpen = false;    // true when canvas editor is open (locks UI)
const dConfigured = new Set(); // items that completed configuration

// All sidebar items
const D_SIDEBAR_ITEMS = [
  { id: 'terrace',       lbl: 'Терраса/Крыльцо',     hasEditor: true  },
  { id: 'steps',         lbl: 'Ступени',             hasEditor: true  },
  { id: 'paths',         lbl: 'Дорожки',             hasEditor: true  },
  { id: 'fence',         lbl: 'Забор',               hasEditor: true  },
  { id: 'facade',        lbl: 'Отделка фасада',      hasEditor: true  },
  { id: 'beds',          lbl: 'Грядки',              hasEditor: true  },
  { id: 'furniture',     lbl: 'Садовая мебель',      hasEditor: true  },
  { id: 'pool_terrace',  lbl: 'Терраса у бассейна',  hasEditor: true  },
  { id: 'pier',          lbl: 'Причал',              hasEditor: true  },
];

// Canvas init functions map
const D_CANVAS_INIT = {
  terrace:      () => initTerraceCanvas(),
  steps:        () => initStepsCanvas(),
  pool_terrace: () => initSnapCanvas('pool_terrace'),
  paths:        () => initPathsCanvas(),
  pier:         () => initSnapCanvas('pier'),
  fence:        () => { initSnapCanvas('fence'); _dSyncFenceHeight(); _dRenderFenceTypes(); },
  beds:         () => initBedsCanvas(),
  facade:       () => initFacadeCanvas(),
  furniture:    () => initFurnitureCanvas(),
};

// ══════════════════════════════════════════════
// SCREEN NAVIGATION
// ══════════════════════════════════════════════
function dGoTo(s) {
  const prev = document.getElementById('d-screen-' + dStep);
  if (prev) prev.classList.remove('active');

  dStep = s;
  const el = document.getElementById('d-screen-' + s);
  if (el) el.classList.add('active');

  // Режим фасада живёт только на шаге 3 — при уходе гасим (иначе клики по 3D
  // на шаге 2 продолжали бы тоглить сегменты).

  // Хедер убран; «Итог» — плавающая кнопка, видна только на шаге 3.
  const summaryBtn = document.getElementById('d-btn-summary');
  if (summaryBtn) summaryBtn.style.display = s === 3 ? '' : 'none';

  if (s === 1) _dInitHouseGrid();
  else if (s === 2) _dInitParamsView();
  else if (s === 3) _dInitWorkspace();
}

// Сразу рендерим сетку при загрузке (step 1 активен по умолчанию)
if (typeof document !== 'undefined') {
  const _initOnReady = () => { _dCacheToggleDefaults(); _dInitHouseGrid(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initOnReady);
  } else {
    _initOnReady();
  }
}

// ══════════════════════════════════════════════
// STEP 1 — House selection
// ══════════════════════════════════════════════
let _dHousesIndex = null; // кэш списка домов

// Загружает индекс домов и рендерит сетку (5 в ряд, вертикальный скролл).
async function _dInitHouseGrid() {
  const grid = document.getElementById('d-house-grid');
  if (!grid) return;
  if (grid.dataset.rendered === '1') return; // уже отрисовано
  try {
    // ?ts=Date.now() — жёсткий cache-bust против застрявшего в кэше старого index.json
    // (некоторые preview-режимы / file:// игнорируют cache:'no-store').
    const idx = await fetch('assets/houses/index.json?ts=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    _dHousesIndex = idx;
    grid.innerHTML = idx.houses.map(h => `
      <div class="d-house-card" data-typeid="${h.id}" onclick="dSelectHouseAndGo('${h.id}')">
        <div class="hcp">
          <div class="ic" data-placeholder="1"></div>
        </div>
        <div class="hcl">${h.name}<br><span style="font-size:11px; opacity:0.75; font-weight:400;">${h.subtitle || ''}</span></div>
      </div>
    `).join('');
    grid.dataset.rendered = '1';
    // Стартовое сообщение прогресс-каунтера
    const prog = document.getElementById('d-house-progress');
    if (prog) {
      prog.classList.remove('done');
      prog.textContent = `Готовим превью домов (0 / ${idx.houses.length})…`;
    }
    // Запускаем фоновый рендер 3D-превью (после небольшой задержки, чтобы UI успел отрисоваться)
    setTimeout(() => _dRenderHousePreviews().catch(e => console.warn('[house-preview]', e)), 100);
  } catch (e) {
    console.error('[house-grid] не удалось загрузить index.json:', e);
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#999;">Ошибка загрузки списка домов</div>';
  }
}

// Кэш отрендеренных превью (typeId → dataURL). Между переходами туда-сюда не пересчитываем.
const _dPreviewCache = {};

// Рендерит 3D-превью для всех домов из индекса. Использует ОДИН shared WebGL-рендерер,
// чтобы не упираться в лимит контекстов браузера. Снимок → JPEG dataURL → <img>.
async function _dRenderHousePreviews() {
  if (!_dHousesIndex || typeof THREE === 'undefined' || typeof HouseBuilder === 'undefined') return;
  const W = 240, H = 180;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false; // для скорости

  const prog = document.getElementById('d-house-progress');
  const total = _dHousesIndex.houses.length;
  let done = 0;
  const updateProg = () => {
    if (!prog) return;
    if (done >= total) {
      prog.textContent = '';
      prog.classList.add('done');
    } else {
      prog.textContent = `Готовим превью домов (${done} / ${total})…`;
    }
  };

  for (const h of _dHousesIndex.houses) {
    if (_dPreviewCache[h.id]) {
      _dApplyPreviewToCard(h.id, _dPreviewCache[h.id]);
      done++; updateProg();
      continue;
    }
    try {
      // Загрузка дескриптора + GLB-модулей. HTTP-кэш дедуплицирует общие модули между домами.
      const { desc, modules } = await HouseBuilder.loadHouseType(h.id);

      // Минимальная сцена для рендера
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf0f0f0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.95);
      sun.position.set(10, 14, 8);
      scene.add(sun);
      // Земля под домом — небольшая плита
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial({ color: 0x7fa86b, roughness: 0.9, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const houseGroup = new THREE.Group();
      scene.add(houseGroup);

      // Параметры — берём дефолты из дескриптора
      const firstFloor = desc.floors[0];
      const areaDef   = firstFloor?.constraints?.area?.default   || 80;
      const floorHDef = firstFloor?.constraints?.floor_h?.default || 300;
      const baseHDef  = desc.constraints?.base_h?.default || 80;

      HouseBuilder.buildHouseFromDescriptor(houseGroup, desc, modules,
        { area: areaDef, floorH: floorHDef, baseH: baseHDef }, {}
      );

      // Iso-ракурс по bbox дома
      const bbox = new THREE.Box3().setFromObject(houseGroup);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 200);
      const dist = maxDim * 1.6;
      cam.position.set(center.x + dist * 0.75, center.y + dist * 0.55, center.z + dist * 0.85);
      cam.lookAt(center);

      renderer.render(scene, cam);
      const dataURL = renderer.domElement.toDataURL('image/jpeg', 0.82);
      _dPreviewCache[h.id] = dataURL;
      _dApplyPreviewToCard(h.id, dataURL);

      // Dispose геометрии и материалов сцены, чтобы освободить GPU-память
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => m && m.dispose());
        }
      });

      done++; updateProg();

      // Даём браузеру вдохнуть, чтобы UI не подвисал
      await new Promise(r => setTimeout(r, 0));
    } catch (e) {
      console.warn(`[preview] ${h.id}:`, e);
      done++; updateProg();
    }
  }
  renderer.dispose();
  done = total; updateProg();
}

// ── Тип секции забора: превьюшки GLB-модулей ──────────────────────────────
// Рендерятся тем же способом, что карточки домов: одна off-screen сцена на модуль,
// снимок → JPEG dataURL. Считаются один раз за сессию (ленивая, при первом открытии
// редактора забора) и кэшируются.
const _dFencePreviewCache = {};   // тип → dataURL

function _dRenderFenceTypes() {
  const host = document.getElementById('d-fence-types');
  if (!host || typeof FENCE_TYPES === 'undefined') return;
  const cur = (typeof S !== 'undefined' && S.fenceType) || FENCE_TYPES[0];
  host.innerHTML = FENCE_TYPES.map((t, i) => `
    <button class="d-fence-type${t === cur ? ' active' : ''}" id="d-fence-type-${t}"
            title="Тип ${i + 1}" onclick="dSetFenceType('${t}')">${
      _dFencePreviewCache[t] ? `<img src="${_dFencePreviewCache[t]}" alt="">` : `Тип ${i + 1}`
    }</button>`).join('');
  _dRenderFencePreviews().catch(e => console.warn('[fence-preview]', e));
}

function dSetFenceType(type) {
  if (typeof FENCE_TYPES === 'undefined' || !FENCE_TYPES.includes(type)) return;
  S.fenceType = type;
  _dRenderFenceTypes();
  if (typeof onParamChange === 'function') onParamChange();   // пересборка 3D
}

async function _dRenderFencePreviews() {
  if (typeof THREE === 'undefined' || typeof FENCE_TYPES === 'undefined') return;
  const todo = FENCE_TYPES.filter(t => !_dFencePreviewCache[t]);
  if (!todo.length) return;
  const W = 152, H = 104;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H); renderer.setPixelRatio(1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  for (const t of todo) {
    try {
      const proto = await ensureFenceModule(t);
      if (!proto) continue;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf0f0f0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(4, 8, 6); scene.add(sun);
      const inst = proto.clone(true);
      // Модули идут без материалов — в превью красим «под доску», как в сцене.
      const wood = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8, metalness: 0.05 });
      inst.traverse(o => { if (o.isMesh) o.material = wood; });
      scene.add(inst);
      const bbox = new THREE.Box3().setFromObject(inst);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
      const dist = Math.max(size.x, size.y) * 1.5;
      cam.position.set(center.x + dist * 0.35, center.y + dist * 0.25, center.z + dist);
      cam.lookAt(center);
      renderer.render(scene, cam);
      _dFencePreviewCache[t] = renderer.domElement.toDataURL('image/jpeg', 0.85);
      const btn = document.getElementById('d-fence-type-' + t);
      if (btn) btn.innerHTML = `<img src="${_dFencePreviewCache[t]}" alt="">`;
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      wood.dispose();
      await new Promise(r => setTimeout(r, 0));
    } catch (e) {
      console.warn('[fence-preview]', t, e);
    }
  }
  renderer.dispose();
}

function _dApplyPreviewToCard(typeId, dataURL) {
  const hcp = document.querySelector(`.d-house-card[data-typeid="${typeId}"] .hcp`);
  if (!hcp) return;
  hcp.innerHTML = `<img class="preview-img" src="${dataURL}" alt="">`;
}

// Полный сброс ВСЕХ настроек проекта: конструкции (терраса/крыльцо/дорожки/забор/
// грядки/…), материалы по элементам, смета, накопленные образцы, каталожные фильтры
// и UI-состояние. Вызывается при смене типа дома И при возврате в workspace с
// ИЗМЕНЁННЫМ контуром дома (площади — см. _dInitWorkspace): размещённое становится
// невалидным. Просто заглянуть на шаг 2 и вернуться — сброса НЕ вызывает.
// 3D-объекты удаляются при следующей пересборке сцены (buildScene3d чистит houseGroup).
function _dResetAllConfigurations() {
  S.sections = [];
  S.pts = { pool_terrace: [], paths: [], pier: [], fence: [] };
  S.terraceRects = [];
  S.activeTerraceRect = null;
  S.steps = { ...DEFAULT_STEPS_RECT };
  S.beds = [];
  S.activeBed = null;
  S.bedH = 0.20;
  S.fenceH = 1.5;
  S.furniture = [];
  S.activeFurniture = null;
  S.wallZones = {};   // выбор сегментов фасада привязан к контуру дома
  S.mats = {};
  S.elementMat = {};
  S.estimate = {};
  S.samples = [];
  S.activeSample = null;
  S.catColors = new Set();
  S.catPrice = null;
  S.catSection = null;
  S.matSubMode = null;
  S.curSec = 0;
  dConfigured.clear();
  dActiveItem = null;
  dEditorOpen = false;
  // Возвращаем toggle'ы (террасы / крыльца) к дефолтным значениям из HTML
  // (initial-class "on" → ON). Сбрасываем все .tg в их HTML-дефолт + зеркало S.toggles.
  document.querySelectorAll('.d-center-canvas .tg').forEach(tg => {
    const isInitiallyOn = tg.dataset.initialOn === '1';
    tg.classList.toggle('on', isInitiallyOn);
    if (tg.dataset.id) S.toggles[tg.dataset.id] = isInitiallyOn;
  });
  // Ширина дорожки — к дефолту (S + инпут).
  S.pathWidth = 120;
  const pwInp = document.getElementById('v-paths-width');
  if (pwInp) pwInp.value = 120;
}

// Запоминаем стартовое состояние toggle'ов один раз при инициализации UI
// (чтобы _dResetAllConfigurations мог их вернуть к этим значениям).
function _dCacheToggleDefaults() {
  document.querySelectorAll('.d-center-canvas .tg').forEach(tg => {
    if (tg.dataset.initialOn === undefined) {
      tg.dataset.initialOn = tg.classList.contains('on') ? '1' : '0';
    }
    // Зеркалим стартовое состояние в S.toggles — 3D-слой читает тумблеры
    // только оттуда (tgOn в state.js), DOM из viewer3d-* не трогается.
    if (tg.dataset.id) S.toggles[tg.dataset.id] = tg.classList.contains('on');
  });
}

function dSelectHouseAndGo(typeId) {
  document.querySelectorAll('.d-house-card, .d-house-card-empty').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.d-house-card[data-typeid="${typeId}"]`) ||
               document.querySelector(`.d-house-card-empty[data-typeid="${typeId}"]`);
  if (card) card.classList.add('selected');

  // S.houseType хранит typeId напрямую (например, "type_10") или 'no_house' («Пустой
  // участок»). Раньше для no_house писали null — он неотличим от «ещё не выбрано»,
  // а все проверки «без дома» (isEmptyLot в state.js) сравнивали с легаси-строкой.
  const newType = typeId;

  // Если тип дома МЕНЯЕТСЯ — сбрасываем все настройки конструкций (терраса/крыльцо/…),
  // потому что они привязаны к геометрии конкретного дома. При повторном выборе того же
  // типа — настройки сохраняются.
  if (S.houseType !== newType) {
    _dResetAllConfigurations();
  }
  S.houseType = newType;

  // Async preload дескриптора + GLB модулей
  if (typeof ensureHouseLoaded === 'function' && S.houseType) {
    ensureHouseLoaded().then(() => {
      if (typeof threeState !== 'undefined' && threeState) buildScene3d();
      if (dStep === 2) _dRenderFloorParams();
    }).catch(()=>{});
  }
  dGoTo(2);
}


// ══════════════════════════════════════════════
// STEP 2 — Parameters + 3D
// ══════════════════════════════════════════════
function _dInitParamsView() {
  // Мягкий сброс: раньше вход на шаг 2 обнулял проект БЕЗУСЛОВНО (даже «зашёл
  // посмотреть и вернулся»). Теперь сброс происходит при возврате в workspace и
  // только если контур дома реально изменился — см. _dParamsSig в _dInitWorkspace.
  // Перерендерим параметры по дескриптору (если уже загружен) или по дефолтам;
  // введённые значения при том же типе дома сохраняются (keepValues).
  _dRenderFloorParams();
  _dRenderHouseMaterials();
  _dSyncRanges();
  setTimeout(() => {
    const slot = document.getElementById('d-slot-params');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-params');
    else setTimeout(() => init3dCanvas('d-slot-params'), 100);
  }, 80);
}

// Материалы дома (крыша/фундамент/стены/рамы) — квадратные образцы без подписей.
// Группы и их порядок берутся из HOUSE_MATERIALS; выбранное значение лежит в
// S['<kind>Mat'] (см. соглашение в state.js), поэтому новая группа материалов
// подхватывается здесь без правок.
function _dRenderHouseMaterials() {
  const host = document.getElementById('d-house-mats');
  if (!host || typeof HOUSE_MATERIALS === 'undefined') return;
  host.innerHTML = Object.keys(HOUSE_MATERIALS).map(kind => {
    const grp = HOUSE_MATERIALS[kind];
    const cur = S[kind + 'Mat'];
    const sw = grp.items.map(it => {
      const bg = it.img ? `background-image:url('${it.img}');background-size:cover;background-position:center;`
                        : `background:${it.color};`;
      const active = (cur === it.id) ? ' active' : '';
      return `<button class="d-hm-sw${active}" style="${bg}" onclick="dSetHouseMat('${kind}','${it.id}')" title="${it.id}"></button>`;
    }).join('');
    return `<div class="d-hm-group">
      <div class="d-hm-label">${grp.label}</div>
      <div class="d-hm-row">${sw}</div>
    </div>`;
  }).join('');
}

function dSetHouseMat(kind, id) {
  if (typeof HOUSE_MATERIALS === 'undefined' || !HOUSE_MATERIALS[kind]) return;
  S[kind + 'Mat'] = id;
  _dRenderHouseMaterials();
  if (typeof onParamChange === 'function') onParamChange(); // пересборка 3D (debounced)
}

// Рендерит per-floor контролы (высота этажа + площадь этажа) на основе дескриптора.
// Глобальный area-слайдер служит для синхронной установки площадей всех этажей.
// При повторном входе на шаг 2 с ТЕМ ЖЕ типом дома введённые значения сохраняются
// (keepValues); дефолты ставятся только после смены типа.
let _dFloorParamsType = null;   // тип дома, для которого параметры отрисованы

function _dRenderFloorParams() {
  const cont = document.getElementById('d-floors-params');
  if (!cont) return;
  const keepValues = (_dFloorParamsType === S.houseType);
  const prev = {};
  cont.querySelectorAll('input[id]').forEach(inp => { prev[inp.id] = inp.value; });
  const prevArea = document.getElementById('v-area')?.value;
  cont.innerHTML = '';
  // Возьмём дескриптор из кэша HouseBuilder (если уже загружен), иначе пропустим.
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (!desc) {
    // Дом без дескриптора (или ещё не загружен) — оставляем только глобальный area.
    return;
  }
  // Обновим диапазон глобального area по первому этажу (как опорному)
  const firstFloor = desc.floors && desc.floors[0];
  if (firstFloor && firstFloor.constraints && firstFloor.constraints.area) {
    const a = firstFloor.constraints.area;
    const aInp = document.getElementById('v-area'), aRng = document.getElementById('r-area');
    const hint = document.getElementById('d-area-range-hint');
    const aVal = (keepValues && prevArea) ? prevArea : a.default;
    if (aInp) { aInp.min = a.min; aInp.max = a.max; aInp.value = aVal; }
    if (aRng) { aRng.min = a.min; aRng.max = a.max; aRng.step = a.step || 5; aRng.value = aVal; }
    if (hint) hint.textContent = `${a.min} — ${a.max} кв.м`;
  }
  // Per-floor: для каждого этажа — высота этажа + площадь этажа.
  desc.floors.forEach((floor, fi) => {
    const label = floor.label || `Этаж ${fi + 1}`;
    const aConstr = floor.constraints && floor.constraints.area;
    const hConstr = floor.constraints && floor.constraints.floor_h;
    // Если у этажа есть area_factor, дефолт площади = глобал × factor; иначе global default
    const factor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
    const aDefault = aConstr ? aConstr.default : Math.round((firstFloor?.constraints?.area?.default || 80) * factor);
    const hDefault = hConstr ? hConstr.default : 300;
    const aVal = (keepValues && prev[`v-area-${fi}`] !== undefined) ? prev[`v-area-${fi}`] : aDefault;
    const hVal = (keepValues && prev[`v-floor-${fi}`] !== undefined) ? prev[`v-floor-${fi}`] : hDefault;

    const wrap = document.createElement('div');
    wrap.className = 'd-param-group';
    wrap.style.borderTop = '1px solid #e0e0e0';
    wrap.style.paddingTop = '8px';
    wrap.innerHTML = `
      <div class="d-param-label" style="font-weight: 600; margin-bottom: 6px;">${label}</div>
      <div class="d-param-sublabel" style="font-size: 12px; color: #666; margin-bottom: 4px;">Высота этажа (см)</div>
      <input class="d-param-input" type="number" id="v-floor-${fi}" value="${hVal}" min="${hConstr?.min ?? 270}" max="${hConstr?.max ?? 360}"
             oninput="dOnFloorParam(${fi})">
      <input class="d-param-range" type="range" id="r-floor-${fi}" value="${hVal}" min="${hConstr?.min ?? 270}" max="${hConstr?.max ?? 360}" step="${hConstr?.step ?? 10}"
             oninput="document.getElementById('v-floor-${fi}').value=this.value; dOnFloorParam(${fi})">
      <div class="d-param-sublabel" style="font-size: 12px; color: #666; margin: 8px 0 4px;">Площадь этажа (кв.м)</div>
      <input class="d-param-input" type="number" id="v-area-${fi}" value="${aVal}" min="${aConstr?.min ?? 40}" max="${aConstr?.max ?? 140}"
             oninput="dOnFloorParam(${fi})">
      <input class="d-param-range" type="range" id="r-area-${fi}" value="${aVal}" min="${aConstr?.min ?? 40}" max="${aConstr?.max ?? 140}" step="${aConstr?.step ?? 5}"
             oninput="document.getElementById('v-area-${fi}').value=this.value; dOnFloorParam(${fi})">
    `;
    cont.appendChild(wrap);
  });
  _dFloorParamsType = S.houseType;
}

// Изменение глобального area: распространяется на все этажи по их area_factor.
function dOnAreaTotal() {
  const aEl = document.getElementById('v-area'), rEl = document.getElementById('r-area');
  if (aEl && rEl) rEl.value = aEl.value;
  const total = parseFloat(aEl.value);
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (desc) {
    desc.floors.forEach((floor, fi) => {
      const factor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
      const target = Math.round(total * factor);
      const aInp = document.getElementById(`v-area-${fi}`);
      const aRng = document.getElementById(`r-area-${fi}`);
      if (aInp) aInp.value = target;
      if (aRng) aRng.value = target;
    });
  }
  if (typeof onParamChange === 'function') onParamChange();
}

// Изменение per-floor параметра. Синхронизируем глобальную «Общая площадь дома» с
// площадью 1-го этажа (контур дома считается от неё) — иначе размеры меняются, а поле нет.
function dOnFloorParam(fi) {
  ['v-floor', 'v-area'].forEach(prefix => {
    const inp = document.getElementById(`${prefix}-${fi}`);
    const rng = document.getElementById(`r${prefix.slice(1)}-${fi}`);
    if (inp && rng) rng.value = inp.value;
  });
  _dSyncGlobalAreaFromFloors();
  if (typeof onParamChange === 'function') onParamChange();
}

// «Общая площадь дома» = площадь 1-го этажа / area_factor[0] (база, по которой
// getHouseFloorPolygon строит контур). Держим поле в синхроне при ручной правке этажа.
function _dSyncGlobalAreaFromFloors() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (!desc || !desc.floors || !desc.floors[0]) return;
  const factor0 = (desc.floors[0].area_factor !== undefined) ? desc.floors[0].area_factor : 1.0;
  const a0 = parseFloat(document.getElementById('v-area-0')?.value);
  const aEl = document.getElementById('v-area'), rEl = document.getElementById('r-area');
  if (isNaN(a0) || !factor0 || !aEl) return;
  let base = Math.round(a0 / factor0);
  const mn = parseFloat(aEl.min), mx = parseFloat(aEl.max);
  if (!isNaN(mn)) base = Math.max(base, mn);
  if (!isNaN(mx)) base = Math.min(base, mx);
  aEl.value = base;
  if (rEl) rEl.value = base;
}

function dOnParam() {
  _dSyncRanges();
  if (typeof onParamChange === 'function') onParamChange();
}

// Ширина дорожки: инпут зеркалится в S.pathWidth (см), затем обновляем превью
// в canvas-редакторе и пересобираем 3D. Canvas и 3D читают только S.pathWidth.
function dOnPathWidth() {
  const v = parseFloat(document.getElementById('v-paths-width')?.value);
  if (!isNaN(v) && v > 0) S.pathWidth = v;
  if (typeof drawSnapCanvas === 'function') drawSnapCanvas('paths');
  if (typeof onParamChange === 'function') onParamChange();
}

function dSetFenceHeight(m) {
  S.fenceH = m;
  _dSyncFenceHeight();
  if (typeof onParamChange === 'function') onParamChange();
}

// Подсветить активную кнопку высоты забора из S.fenceH (при открытии редактора/сбросе).
function _dSyncFenceHeight() {
  document.querySelectorAll('#fence-h-seg .bed-h-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.m) === S.fenceH);
  });
}

function _dSyncRanges() {
  // Глобальные слайдеры
  [['v-area','r-area'],['v-found','r-found']].forEach(([inp,rng]) => {
    const iEl = document.getElementById(inp), rEl = document.getElementById(rng);
    if (iEl && rEl) rEl.value = iEl.value;
  });
}

// Собирает все параметры для HouseBuilder (используется из viewer3d-core.js).
function dCollectParams() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const baseH = parseFloat(document.getElementById('v-found')?.value || 80);
  const areaTotal = parseFloat(document.getElementById('v-area')?.value || 80);
  const floorAreas = [], floorHs = [];
  if (desc) {
    desc.floors.forEach((floor, fi) => {
      const a = parseFloat(document.getElementById(`v-area-${fi}`)?.value);
      const h = parseFloat(document.getElementById(`v-floor-${fi}`)?.value);
      if (!isNaN(a)) floorAreas.push(a); else floorAreas.push(areaTotal * (floor.area_factor || 1.0));
      if (!isNaN(h)) floorHs.push(h); else floorHs.push(300);
    });
  }
  return {
    area:    areaTotal,
    floorH:  floorHs[0] || 300, // для совместимости со старым API
    baseH:   baseH,
    floorAreas,
    floorHs,
  };
}

// ══════════════════════════════════════════════
// STEP 3 — Workspace
// ══════════════════════════════════════════════
// Сигнатура параметров, определяющих КОНТУР дома (площади), на момент последнего
// входа в workspace. Высота этажа/фундамента контур не меняют — их правка проект
// не сбрасывает (3D пересобирается сам).
let _dParamsSig = null;

function _dParamsSignature() {
  const c = (typeof dCollectParams === 'function') ? dCollectParams() : null;
  return c ? JSON.stringify({ houseType: S.houseType, area: c.area, floorAreas: c.floorAreas }) : null;
}

function _dInitWorkspace() {
  // Мягкий сброс: проект обнуляется только если контур дома изменился с прошлого
  // входа в workspace (площади / тип). «Сходил на шаг 2 посмотреть и вернулся» —
  // ничего не трогает.
  const sig = _dParamsSignature();
  if (_dParamsSig !== null && sig !== _dParamsSig) _dResetAllConfigurations();
  _dParamsSig = sig;

  dActiveItem = null;
  dEditorOpen = false;
  _dCloseAllCanvases();
  _dRenderSidebar();
  _dSetPanelLocked(true); // Panel locked until an item is selected

  setTimeout(() => {
    const slot = document.getElementById('d-slot-workspace');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-workspace');
    else setTimeout(() => init3dCanvas('d-slot-workspace'), 100);
  }, 80);
}

// ── SIDEBAR ──
function _dRenderSidebar() {
  const list = document.getElementById('d-sidebar-list');
  list.innerHTML = D_SIDEBAR_ITEMS.map(item => {
    const isActive = dActiveItem === item.id;
    const isCfg = dConfigured.has(item.id);
    const isLocked = dEditorOpen && dActiveItem !== item.id;
    return `
      <div class="d-sb-row">
        <button class="d-sb-btn ${isActive ? 'active' : ''} ${isCfg ? 'configured' : ''} ${isLocked ? 'locked' : ''}"
                data-id="${item.id}"
                onclick="dClickItem('${item.id}')"
                ${isLocked ? 'disabled' : ''}>
          ${item.lbl}
        </button>
        ${isCfg && item.hasEditor ? `<button class="d-sb-edit ${isLocked ? 'locked' : ''}" title="Редактировать"
            onclick="dEditItem('${item.id}')" ${isLocked ? 'disabled' : ''}>✏</button>` : ''}
        ${isCfg ? `<button class="d-sb-delete ${isLocked ? 'locked' : ''}" title="Удалить настройки"
            onclick="dDeleteItem('${item.id}')" ${isLocked ? 'disabled' : ''}>×</button>` : ''}
      </div>`;
  }).join('');

  // Правую панель материалов показываем только когда выбран элемент проекта.
  const panel = document.getElementById('d-panel');
  if (panel) panel.classList.toggle('hidden', !dActiveItem);

}

// ══════════════════════════════════════════════
// ОТДЕЛКА ФАСАДА — выбор ведётся ТОЛЬКО на плане (редактор d-canvas-facade,
// initFacadeCanvas в canvas.js). 3D-пикинг и плавающий тулбар над сценой убраны:
// в 3D видно результат (панели), выбор — на плане. Кнопки ниже вызываются из
// футера план-редактора.
// ══════════════════════════════════════════════

// Перерисовать план-редактор фасада, если он сейчас открыт.
function _dRedrawFacadePlan() {
  if (typeof drawFacadeCanvas === 'function'
      && document.getElementById('d-canvas-facade')?.classList.contains('active')) {
    drawFacadeCanvas();
  }
}

function dFacadeSelectAll() {
  // Выбираем то, что показано на плане (элементы 1-го этажа) — иначе выбор
  // содержал бы недоступные для снятия сегменты верхних этажей.
  const T = (typeof _houseWorldTransform === 'function') ? _houseWorldTransform() : null;
  if (T) for (const e of T.layout.edges) for (const it of e.items) {
    if (it.segId) S.wallZones[it.segId] = true;
  }
  if (typeof _applyFacadeSelection === 'function') _applyFacadeSelection();
  _dRedrawFacadePlan();
}

function dFacadeClear() {
  S.wallZones = {};
  if (typeof _applyFacadeSelection === 'function') _applyFacadeSelection();
  _dRedrawFacadePlan();
}

// ── Delete (×) button — сбросить настройки конкретной позиции ──
function dDeleteItem(secId) {
  if (dEditorOpen) return;
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  const label = item ? item.lbl : secId;
  if (!window.confirm(`Удалить настройки «${label}»?`)) return;

  // Чистим данные позиции
  if (S.pts && S.pts[secId]) S.pts[secId] = [];
  if (secId === 'terrace') { S.terraceRects = []; S.activeTerraceRect = null; }
  if (secId === 'steps')   { S.steps = { ...DEFAULT_STEPS_RECT }; }
  if (secId === 'beds')    { S.beds = []; S.activeBed = null; }
  if (secId === 'facade')  { S.wallZones = {}; }
  if (secId === 'furniture') { S.furniture = []; S.activeFurniture = null; }
  S.sections = S.sections.filter(s => s !== secId);
  if (S.mats && S.mats[secId]) delete S.mats[secId];
  if (S.elementMat && S.elementMat[secId]) delete S.elementMat[secId];
  if (S.estimate && S.estimate[secId]) delete S.estimate[secId];
  dConfigured.delete(secId);

  // Если удаляемая позиция активна — сбрасываем активность
  if (dActiveItem === secId) {
    dActiveItem = null;
    S.matSubMode = null;
  }

  _dRenderSidebar();
  _dSetPanelLocked(false);
  _dRenderPanelContent();

  // Перестроить 3D
  if (typeof buildScene3d === 'function') {
    setTimeout(() => init3dCanvas('d-slot-workspace'), 50);
  }
}

// ── Click on sidebar button ──
function dClickItem(secId) {
  if (dEditorOpen) return; // locked

  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  if (!item) return;

  // If has editor and NOT yet configured → open editor
  if (item.hasEditor && !dConfigured.has(secId)) {
    _dOpenEditor(secId);
    return;
  }

  // Otherwise → select item, show catalog
  _dSelectItem(secId);
}

// ── Edit (pencil) button ──
function dEditItem(secId) {
  if (dEditorOpen) return;
  _dOpenEditor(secId);
}

// ── Select item (no editor) ──
function _dSelectItem(secId) {
  dActiveItem = secId;
  dEditorOpen = false;
  S.matSubMode = null;

  // For non-editor items, add to sections on first click
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  if (item && !item.hasEditor && !dConfigured.has(secId)) {
    dConfigured.add(secId);
    if (!S.sections.includes(secId)) S.sections.push(secId);
  }

  // Map active item to curSec for material application
  const secIdx = SECS.findIndex(s => s.id === secId);
  if (secIdx >= 0) S.curSec = 0; // getActive returns single item

  _dRenderSidebar();
  _dSetPanelLocked(false);
  _dRenderPanelContent();

  // Rebuild 3D
  if (typeof buildScene3d === 'function') {
    setTimeout(() => {
      init3dCanvas('d-slot-workspace');
    }, 50);
  }
}

// ── Open editor ──
function _dOpenEditor(secId) {
  dActiveItem = secId;
  dEditorOpen = true;

  // Add to sections if not yet
  if (!S.sections.includes(secId)) S.sections.push(secId);

  _dRenderSidebar();
  _dSetPanelLocked(true);

  // Show canvas
  _dCloseAllCanvases();
  const canvasEl = document.getElementById('d-canvas-' + secId);
  if (canvasEl) canvasEl.classList.add('active');

  const initFn = D_CANVAS_INIT[secId];
  if (initFn) setTimeout(() => initFn(), 80);
}

// ── Confirm editor (Готово) ──
function dConfirmCanvas(secId) {
  dConfigured.add(secId);
  dEditorOpen = false;
  _dCloseAllCanvases();

  dActiveItem = secId;
  S.matSubMode = null;
  S.curSec = 0;

  _dRenderSidebar();
  _dSetPanelLocked(false);
  _dRenderPanelContent();

  // Rebuild 3D
  setTimeout(() => {
    init3dCanvas('d-slot-workspace');
  }, 100);
}

// ── Canvas helpers ──
function _dCloseAllCanvases() {
  document.querySelectorAll('.d-center-canvas').forEach(el => el.classList.remove('active'));
}

// ── Panel lock/unlock ──
function _dSetPanelLocked(locked) {
  const panel = document.getElementById('d-panel');
  if (panel) panel.classList.toggle('locked', locked);
}

// ══════════════════════════════════════════════
// RIGHT PANEL — Materials / Catalog
// ══════════════════════════════════════════════
function _dRenderPanelContent() {
  const secId = dActiveItem;
  if (!secId) return;

  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  const panelTitle = document.getElementById('d-panel-title');
  if (panelTitle) panelTitle.textContent = item ? item.lbl : 'Материалы';

  // Terrace sub-mode toggle (Терраса / Ограждение)
  const subToggle = document.getElementById('d-panel-sub-toggle');
  if (subToggle) {
    if (secId === 'terrace') {
      const mode = S.matSubMode || 'deck';
      subToggle.innerHTML = `
        <button class="d-sub-btn ${mode==='deck'?'active':''}" onclick="dSetSubMode('deck')">Терраса</button>
        <button class="d-sub-btn ${mode==='railing'?'active':''}" onclick="dSetSubMode('railing')">Ограждение</button>`;
      subToggle.style.display = '';
    } else {
      subToggle.style.display = 'none';
      S.matSubMode = null;
    }
  }

  // Дефолтный раздел каталога для текущего элемента (сбрасываем явный выбор при
  // смене элемента/подрежима). Для ограждения террасы — раздел «Ограждения террасы».
  let defSec = (typeof CONSTRUCTION_TO_SECTION !== 'undefined') ? CONSTRUCTION_TO_SECTION[secId] : null;
  if (secId === 'terrace' && S.matSubMode === 'railing') defSec = 2331; // «Ограждения для террасы из ДПК» (2332 в API — бренд TalverWood)
  S.catSection = defSec || null;

  // Палитра цветов у каждого элемента своя: выбранные для прошлого элемента цвета,
  // которых нет в текущей палитре, вычищаем — иначе невидимый выбор фильтрует выдачу.
  const _palette = new Set(_elementColors(secId, S.matSubMode).map(c => c.id));
  S.catColors = new Set([...S.catColors].filter(n => _palette.has(n)));

  // Render swatches
  dRenderSwatches();
  // Auto-show catalog results
  dShowResults();
}

function dSetSubMode(mode) {
  S.matSubMode = mode;
  _dRenderPanelContent();
}

// ── Samples ──
function dRenderSwatches() {
  const grid = document.getElementById('d-samples-grid');
  const lbl = document.getElementById('d-samples-lbl');
  if (!grid || !lbl) return;

  const all = S.samples;
  if (!all || !all.length) {
    grid.innerHTML = '<span style="font-size:13px;color:#bbb;">Добавьте образцы из каталога</span>';
    lbl.textContent = 'Образцы:';
    return;
  }
  lbl.textContent = `Образцы (${all.length}):`;
  grid.innerHTML = all.map((s, i) => `
    <div class="swatch ${S.activeSample && S.activeSample.id === s.id && S.activeSample._idx === i ? 'swatch-active' : ''}"
         title="${s.name}" onclick="dApplySwatch(${i})"
         style="background:${s.color || '#d9d9d9'}; cursor:pointer;">
      <button class="swatch-del" onclick="event.stopPropagation(); dRemoveSwatch(${i})">✕</button>
      <span class="swatch-name" style="color:${_dIsLight(s.color) ? '#333' : '#fff'}">${s.name}</span>
    </div>`).join('');
}

// Элементы с настилом — материал у каждого свой (S.elementMat[el]).
// Забор здесь же: его планки текстурируются товаром как настил (остальные части
// модуля красятся сплошным цветом в buildFence3d) — TODO.md → ЗАБОРЫ.
const DECK_MAT_ELEMENTS = ['terrace', 'steps', 'paths', 'beds', 'pool_terrace', 'pier', 'fence'];
// Текущий активный элемент красится как настил? (Ограждение террасы — нет.)
function _activeIsDeck() {
  if (dActiveItem === 'terrace' && S.matSubMode === 'railing') return false;
  return DECK_MAT_ELEMENTS.includes(dActiveItem);
}

// Применяет образец (текстуры/цвет) к АКТИВНОМУ элементу. Деко-элементы — через
// S.elementMat[el] + пересборку (каждый независимо); прочие (фасад/забор/ограждение)
// — прежним способом (цвет live / глобально).
function _applySampleToActive(sample) {
  S.activeSample = sample;                 // для подсветки образца
  _setEstimateForActive(sample);           // смета обновляется вместе с материалом
  if (_activeIsDeck()) {
    // productId/name сохраняем рядом с текстурами: по ним расчёт террасы на бэкенде
    // узнаёт выбранную доску (_deckingBoardProductId), 3D-слой их игнорирует.
    // colorName — имя цвета товара из каталога: по нему забор красит непланочные
    // части «под доску» (_fenceFrameColor в viewer3d-builders.js).
    const meta = { productId: sample.id || null, name: sample.name || '',
                   colorName: sample.colorName || '' };
    S.elementMat[dActiveItem] = sample.textures ? { textures: sample.textures, ...meta }
                              : (sample.color ? { color: sample.color, ...meta } : null);
    if (typeof buildScene3d === 'function') buildScene3d();
  } else if (dActiveItem === 'furniture') {
    // Мебель: товар назначается ТОЧКЕ плана — выбранной, иначе первой свободной
    // «по порядку номеров». Модель встаёт в эту точку при пересборке сцены.
    _assignFurnitureProduct(sample);
  } else if (dActiveItem === 'facade') {
    // Фасад: материал панелей ложится на выбранные сегменты (S.wallZones) без
    // пересборки сцены; пустой выбор = весь фасад.
    S.elementMat.facade = sample.textures ? { textures: sample.textures }
                        : (sample.color ? { color: sample.color } : null);
    if (typeof _applyFacadeSelection === 'function' && typeof threeState !== 'undefined' && threeState) {
      _applyFacadeSelection();
    }
  } else if (sample.color && typeof applyMaterialToScene === 'function') {
    applyMaterialToScene(sample.color);    // забор/ограждение — цвет
  }
  dRenderSwatches();
}

// Назначает товар точке мебели: активной, иначе первой без товара (по номерам),
// иначе — последней (перезаписываем, чтобы «Применить» всегда давал результат).
// После назначения выбор ПЕРЕВОДИТСЯ на следующую свободную точку — иначе повторное
// «Применить» било бы в ту же точку (она осталась активной) и вся мебель садилась
// бы на одно место. Явный выбор точки кликом на плане при этом сохраняет смысл
// «заменить товар в этой точке».
// Возвращает индекс точки или -1, если точек нет.
function _assignFurnitureProduct(sample) {
  const pts = S.furniture || [];
  if (!pts.length) {
    alert('Сначала поставьте точку на плане: «Садовая мебель» → карандаш ✏ → клик по плану.');
    return -1;
  }
  let idx = (S.activeFurniture !== null && pts[S.activeFurniture]) ? S.activeFurniture : -1;
  if (idx < 0) idx = pts.findIndex(p => !p.product);
  if (idx < 0) idx = pts.length - 1;
  pts[idx].product = { id: sample.id, name: sample.name, modelUrl: sample.modelUrl || '' };
  // Следующая свободная — сначала после текущей, потом с начала; нет свободных — null
  // (тогда следующее «Применить» перезапишет последнюю точку).
  let next = -1;
  for (let k = 1; k <= pts.length; k++) {
    const j = (idx + k) % pts.length;
    if (!pts[j].product) { next = j; break; }
  }
  S.activeFurniture = (next >= 0) ? next : null;
  if (typeof buildScene3d === 'function') buildScene3d();
  if (typeof drawFurnitureCanvas === 'function'
      && document.getElementById('d-canvas-furniture')?.classList.contains('active')) {
    drawFurnitureCanvas();
  }
  return idx;
}

// ── Индикатор загрузки 3D-моделей ──────────────────────────────────────────
// Модели мебели из каталога весят 4–12 МБ и грузятся 3–10 с; без индикатора
// сцена просто «молчит». Ключ — обычно URL модели; label — что показать
// пользователю; pct — 0..100 или null, если размер файла неизвестен.
const _d3dLoads = new Map();          // key → { label, pct }

function d3dLoadingSet(key, label, pct) {
  _d3dLoads.set(key, { label: label || 'модель', pct: (typeof pct === 'number') ? pct : null });
  _d3dLoadingRender();
}
function d3dLoadingClear(key) {
  if (_d3dLoads.delete(key)) _d3dLoadingRender();
}
function _d3dLoadingRender() {
  const box = document.getElementById('d-3d-loading');
  const bar = document.getElementById('d-3d-loading-bar');
  const fill = document.getElementById('d-3d-loading-fill');
  const txt = document.getElementById('d-3d-loading-txt');
  if (!box || !bar || !fill || !txt) return;
  const items = [..._d3dLoads.values()];
  if (!items.length) { box.classList.remove('on'); return; }
  const known = items.filter(i => i.pct !== null);
  const pct = known.length ? Math.round(known.reduce((s, i) => s + i.pct, 0) / known.length) : null;
  const head = (items.length === 1) ? `Загрузка модели «${items[0].label}»` : `Загрузка моделей (${items.length})`;
  txt.textContent = head + (pct !== null ? ` — ${pct}%` : '…');
  bar.classList.toggle('indet', pct === null);
  fill.style.width = (pct !== null ? pct : 40) + '%';
  box.classList.add('on');
}

function dApplySwatch(idx) {
  const s = S.samples[idx];
  if (!s) return;
  _applySampleToActive({ ...s, _idx: idx });
}

function dRemoveSwatch(i) {
  S.samples.splice(i, 1);
  dRenderSwatches();
}

function _dIsLight(hex) {
  if (!hex) return true;
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
}

// ── Catalog filters ──
// Набор цветов для текущего элемента проекта (свой на тип, имена/цвета из COLORS.md).
// id = название цвета (стабилен между типами; tooltip = название из каталога).
function _elementColors(elId, subMode) {
  let key = elId;
  if (elId === 'terrace' && subMode === 'railing') key = 'railing';
  else if (elId === 'paths' || elId === 'pool_terrace' || elId === 'pier') key = 'terrace';
  const map = (typeof ELEMENT_COLOR_NAMES !== 'undefined') ? ELEMENT_COLOR_NAMES : {};
  const names = map[key] || map.terrace || [];
  const hexMap = (typeof CATALOG_COLOR_HEX !== 'undefined') ? CATALOG_COLOR_HEX : {};
  return names.map(n => ({ id: n, hex: hexMap[n] || '#999999', label: n }));
}

function _dRenderColorGrid() {
  const grid = document.getElementById('d-color-grid');
  if (!grid) return;
  // Мебель: у товаров каталога поле color пустое (проверено 2026-08-02) — любой
  // выбранный чип обнулил бы выдачу. Прячем блок, пока бэкенд не заполнит цвета.
  const sect = document.getElementById('d-color-section');
  const isFurniture = (dActiveItem === 'furniture');
  if (sect) sect.style.display = isFurniture ? 'none' : '';
  if (isFurniture) { S.catColors = new Set(); grid.innerHTML = ''; return; }
  grid.innerHTML = _elementColors(dActiveItem, S.matSubMode).map(c =>
    `<div class="d-color-dot ${S.catColors.has(c.id) ? 'selected' : ''}"
          title="${c.label}" style="background:${c.hex};"
          onclick="dToggleColor('${c.id.replace(/'/g, "\\'")}')"></div>`
  ).join('');
}

function _dRenderPriceGrid() {
  const grid = document.getElementById('d-price-grid');
  if (!grid) return;
  // Мебель: цена за изделие (десятки тысяч ₽), а тиры заданы в ₽/м.пог для доски —
  // фильтр по ним бессмыслен, прячем блок целиком и сбрасываем выбор.
  const sect = document.getElementById('d-price-section');
  const isFurniture = (dActiveItem === 'furniture');
  if (sect) sect.style.display = isFurniture ? 'none' : '';
  if (isFurniture) { S.catPrice = null; grid.innerHTML = ''; return; }
  grid.innerHTML = PRICE_TIERS.map(t =>
    `<button class="d-price-btn ${S.catPrice === t.id ? 'selected' : ''}"
             onclick="dSelectPrice('${t.id}')">
       ${t.lbl}<br><span style="font-size:11px;font-weight:400;opacity:.7">${t.sub}</span>
     </button>`
  ).join('');
}

function dToggleColor(cid) {
  if (S.catColors.has(cid)) S.catColors.delete(cid);
  else S.catColors.add(cid);
  _dRenderColorGrid();
  dShowResults();
}

// ── Фильтр по цвету ──
// У товаров API нет отдельного поля цвета — цвет входит в НАЗВАНИЕ товара
// («Террасная доска … венге, м.пог»), см. COLORS.md. Поэтому цвета товара
// определяем по тексту: ищем имена палитры (CATALOG_COLOR_HEX) как отдельные
// слова. Длинные имена в приоритете: «тёмно-серый» в названии занимает диапазон
// целиком и НЕ засчитывается как «Серый».
function _colorNorm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }

const _COLOR_NAMES_BY_LEN = (typeof CATALOG_COLOR_HEX !== 'undefined')
  ? Object.keys(CATALOG_COLOR_HEX).sort((a, b) => b.length - a.length)
  : [];

function _detectColorNames(text) {
  const norm = _colorNorm(text);
  const found = new Set();
  const taken = [];                       // занятые диапазоны [start, end)
  const isLetter = ch => !!ch && /[0-9a-zа-я]/.test(ch);
  for (const name of _COLOR_NAMES_BY_LEN) {
    const cn = _colorNorm(name);
    let idx = norm.indexOf(cn);
    while (idx !== -1) {
      const end = idx + cn.length;
      // Только целое слово («тик» ≠ «пластик») и вне уже занятых диапазонов.
      const wholeWord = !isLetter(norm[idx - 1]) && !isLetter(norm[end]);
      const overlaps = taken.some(([s, e]) => idx < e && end > s);
      if (wholeWord && !overlaps) { found.add(name); taken.push([idx, end]); }
      idx = norm.indexOf(cn, end);
    }
  }
  return found;
}

// Цвета позиции: тексты перебираются ПО ПРИОРИТЕТУ, берём первый, где что-то
// распозналось. Название точнее описания: у товара конкретного цвета («…дуб»)
// preview_text перечисляет цвета всей линейки («венге, серый, шоколад…») и давал
// ложные совпадения. Описание остаётся fallback'ом для позиций без цвета в
// названии (многоцветные MIX-панели, заглушки).
function _itemColors(textsOf, it) {
  for (const t of textsOf(it)) {
    const c = _detectColorNames(t);
    if (c.size) return c;
  }
  return new Set();
}

// Оставляет позиции, чей цвет входит в выбранные (OR по выбранным цветам).
// Позиции без распознанного цвета при активном фильтре скрываются.
// textsOf(item) — массив текстов по убыванию приоритета (см. _itemColors).
function _filterByColors(items, textsOf) {
  if (!S.catColors.size) return items;
  return items.filter(it => {
    const colors = _itemColors(textsOf, it);
    for (const c of S.catColors) if (colors.has(c)) return true;
    return false;
  });
}

function dSelectPrice(tid) {
  S.catPrice = S.catPrice === tid ? null : tid;
  _dRenderPriceGrid();
  dShowResults();
}

// ══════════════════════════════════════════════
// КАТАЛОГ ИЗ API (ResourceManager) + fallback на заглушки
// ══════════════════════════════════════════════
let _rm = null;                 // singleton ResourceManager
const _catalogCache = {};       // bitrix_id -> ProductResource[] | null
const _catalogLoading = {};     // bitrix_id -> bool

function _getRM() {
  if (!_rm && typeof ResourceManager !== 'undefined') {
    try { _rm = new ResourceManager(); } catch (e) { console.warn('[catalog] RM init:', e); _rm = null; }
  }
  return _rm;
}

// Активный раздел каталога: явный выбор пользователя (S.catSection) или дефолт по
// текущему элементу проекта (CONSTRUCTION_TO_SECTION), иначе террасная доска.
function _activeSectionId() {
  if (S.catSection) return S.catSection;
  const def = (typeof CONSTRUCTION_TO_SECTION !== 'undefined') ? CONSTRUCTION_TO_SECTION[dActiveItem] : null;
  return def || 2314;
}

// Загружает товары раздела (section_id) один раз и кэширует.
//   [] — раздел реально пуст (fallback на заглушки, не перезапрашиваем);
//   null — ошибка/недоступно (перезапросим при следующем показе);
//   undefined — ещё не грузили.
async function _ensureCatalogSection(sectionId) {
  if (Array.isArray(_catalogCache[sectionId])) return _catalogCache[sectionId];
  if (_catalogLoading[sectionId]) return undefined;
  const rm = _getRM();
  if (!rm || typeof Filter === 'undefined') return null;
  _catalogLoading[sectionId] = true;
  try {
    // Текстурированные товары (с texture_urls для превью/3D) бэкенд отдаёт только под тегом
    // раздела (SECTION_TAGS). Без тега вернулись бы товары без текстур → превью не приходят.
    const tag = (typeof SECTION_TAGS !== 'undefined') ? SECTION_TAGS[sectionId] : null;
    // Наборы из SECTION_TAG_ONLY (мебель) тянем ТОЛЬКО по тегу: их товары лежат в
    // разных разделах, section_id отрезал бы часть выдачи.
    const tagOnly = (typeof SECTION_TAG_ONLY !== 'undefined') && SECTION_TAG_ONLY.has(sectionId) && tag;
    const filters = tagOnly ? [] : [new Filter(FilterType.SECTION_ID, sectionId)];
    if (tag) filters.push(new Filter(FilterType.TAGS, [tag]));
    filters.push(new Filter(FilterType.LIMIT, 50));
    const res = await rm.getResources(...filters);
    // res === null → ошибка запроса → null (повторяемо); иначе массив (возможно пустой).
    _catalogCache[sectionId] = res ? (res.products || []) : null;
  } catch (e) {
    console.warn('[catalog] section load failed', sectionId, e);
    _catalogCache[sectionId] = null;
  }
  _catalogLoading[sectionId] = false;
  return _catalogCache[sectionId];
}

function _productPrice(p) {
  const v = p && p.prices && p.prices[0] ? parseFloat(p.prices[0].price) : NaN;
  return isNaN(v) ? null : v;
}

// Клиентский фильтр по выбранному ценовому тиру. Границы — по реальному
// распределению цен каталога (₽/м.пог, ревизия 2026-07-31: 250–1305 с разрывами
// на ~500 и ~900); подписи тиров — PRICE_TIERS в state.js, держать в синхроне.
function _filterRealByPrice(products) {
  if (!S.catPrice) return products;
  const num = p => _productPrice(p) ?? 0;
  if (S.catPrice === 'budget')   return products.filter(p => num(p) < 500);
  if (S.catPrice === 'balanced') return products.filter(p => num(p) >= 500 && num(p) <= 900);
  if (S.catPrice === 'premium')  return products.filter(p => num(p) > 900);
  // МПК: надёжный признак — принадлежность разделу 2329 «Террасная доска из МПК»
  // (тег mpk, ревизия API 2026-07-31); подстрока в названии — fallback.
  if (S.catPrice === 'mpk')      return products.filter(p =>
    (p.sections || []).includes(2329) || /мпк/i.test(p.name || ''));
  return products;
}

// Селектор раздела каталога (реальные разделы API из CATALOG_SECTIONS).
function _dRenderSectionSelect() {
  const host = document.getElementById('d-section-row');
  if (!host || typeof CATALOG_SECTIONS === 'undefined') return;
  const active = _activeSectionId();
  host.innerHTML = `
    <label class="d-section-lbl">Раздел каталога:</label>
    <select class="d-section-select" onchange="dSelectCatSection(this.value)">
      ${CATALOG_SECTIONS.map(s => `<option value="${s.id}" ${s.id === active ? 'selected' : ''}>${s.label}</option>`).join('')}
    </select>`;
}

function dSelectCatSection(id) {
  S.catSection = parseInt(id, 10) || null;
  dShowResults();
}

// Плейсхолдер «идёт загрузка раздела» (вместо заглушек-досок, чтобы не создавать
// ложного впечатления «доска везде», пока медленный API отвечает).
function _dRenderCatalogLoading() {
  const list = document.getElementById('d-mat-list');
  if (!list) return;
  list.innerHTML = '<div class="d-cat-loading"><div class="d-cat-spinner"></div>Загрузка товаров раздела…</div>';
}

// ── Catalog results (auto-shown) ──
// Показываем товары реального раздела каталога. Пока грузится — «Загрузка…»;
// раздел реально пуст или API недоступен — fallback на заглушки STUB_RESULTS.
function dShowResults() {
  _dRenderColorGrid();
  _dRenderPriceGrid();
  _dRenderSectionSelect();
  const secId = _activeSectionId();
  const cached = _catalogCache[secId];
  if (Array.isArray(cached)) {
    if (cached.length) _dRenderRealResults(cached);
    else               _dRenderStubResults();   // раздел реально пуст → заглушки
    return;
  }
  // undefined (не грузили) или null (прошлая попытка не удалась) → грузим.
  _dRenderCatalogLoading();
  if (!_catalogLoading[secId]) {
    _ensureCatalogSection(secId).then(() => dShowResults());
  }
}

// URL картинки из поля каталога. Битрикс отдаёт такие поля по-разному: строкой-URL,
// объектом ({src|url|path}) или числовым id файла — id адресом не является, его
// отбрасываем. Кавычки вырезаем: URL подставляется внутрь style="…url('…')".
function _pictureUrl(v) {
  if (!v) return '';
  if (typeof v === 'object') return _pictureUrl(v.src || v.url || v.path || v.SRC || '');
  if (typeof v !== 'string') return '';
  const s = v.trim().replace(/['"]/g, '');
  return /^\d+$/.test(s) ? '' : s;
}

// Миниатюра карточки товара: у доски превью материала — сама DPK-текстура, у прочих
// товаров (мебель) её нет, поэтому падаем на картинки каталога. Фото товара
// показываем целиком (contain), текстуру — с заполнением (cover).
function _productThumbStyle(p) {
  const tex = (p.textureUrls && p.textureUrls.textures_dpc_diffusion) || '';
  if (tex) return `background-image:url('${tex}');background-size:cover;background-position:center;`;
  const pic = _pictureUrl(p.previewPicture) || _pictureUrl(p.detailPicture);
  if (pic) return `background-image:url('${pic}');background-size:contain;background-repeat:no-repeat;`
                + 'background-position:center;background-color:#fff;';
  return 'background:#bbb;';
}

function _dRenderRealResults(allProducts) {
  const list = document.getElementById('d-mat-list');
  if (!list) return;
  // Цвет — приоритетно из ПОЛЯ color (появилось в API 2026-07-29, имена совпадают
  // с палитрой COLORS.md); затем название; preview_text — fallback (см. _itemColors).
  const products = _filterByColors(_filterRealByPrice(allProducts),
    p => [p.color || '', p.name || '', p.previewText || '']);
  if (!products.length) {
    list.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">Нет товаров под выбранные фильтры</div>';
    return;
  }
  list.innerHTML = products.map(p => {
    const price = _productPrice(p);
    const thumbStyle = _productThumbStyle(p);
    const desc = (p.previewText && p.previewTextType !== 'html') ? p.previewText : '';
    return `
    <div class="d-mat-card" id="dmc-${p.id}">
      <div class="d-mat-head" onclick="dToggleMatCard(${p.id})">
        <div class="d-mat-thumb" style="${thumbStyle}"></div>
        <div class="d-mat-info">
          <div class="d-mat-name">${p.name || ''}</div>
          <div class="d-mat-price">${price != null ? 'от ' + Math.round(price) + ' ₽' : 'цена по запросу'}</div>
        </div>
        <button class="d-mat-exp">▼</button>
      </div>
      <div class="d-mat-body"><div class="d-mat-detail">
        <div class="d-mat-desc">${desc}</div>
        <div class="d-mat-actions">
          <button class="d-mat-btn d-mat-btn-apply" onclick="dApplyRealMat(event, ${p.id})">Применить</button>
        </div>
      </div></div>
    </div>`;
  }).join('');
}

function _dRenderStubResults() {
  let results = [...STUB_RESULTS];
  if (S.catPrice === 'budget')        results = results.filter(r => r.id === 4);
  else if (S.catPrice === 'balanced') results = results.filter(r => [1, 4].includes(r.id));
  else if (S.catPrice === 'premium')  results = results.filter(r => [2, 3].includes(r.id));
  else if (S.catPrice === 'mpk')      results = [{
    id: 99, name: 'Deckron МПК Классик 145×22',
    short: 'Массив прессованного кедра, премиум',
    detail: 'Массив прессованного кедра (МПК) — натуральный кедр под давлением 800 атм. Плотность выше дуба. Не гниёт, не трескается, не требует обработки.',
    price: 'от 10 000 ₽/м²', color: '#A0522D',
    url: 'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/deckron',
  }];
  // Цвета заглушек: сначала название, затем текст («Цвета: тик, венге, серый…»).
  results = _filterByColors(results, m => [m.name, `${m.short || ''} ${m.detail || ''}`]);

  const list = document.getElementById('d-mat-list');
  if (!list) return;
  if (!results.length) {
    list.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">Нет товаров под выбранные фильтры</div>';
    return;
  }
  list.innerHTML = results.map(m => `
    <div class="d-mat-card" id="dmc-${m.id}">
      <div class="d-mat-head" onclick="dToggleMatCard(${m.id})">
        <div class="d-mat-thumb" style="background:${m.color || '#bbb'}"></div>
        <div class="d-mat-info">
          <div class="d-mat-name">${m.name}</div>
          <div class="d-mat-short">${m.short}</div>
          <div class="d-mat-price">${m.price}</div>
        </div>
        <button class="d-mat-exp">▼</button>
      </div>
      <div class="d-mat-body"><div class="d-mat-detail">
        <div class="d-mat-desc">${m.detail}</div>
        <div class="d-mat-actions">
          <button class="d-mat-btn d-mat-btn-apply"
                  onclick="dApplyMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}', '${m.price}')">
            Применить
          </button>
          <button class="d-mat-btn d-mat-btn-compare"
                  onclick="dCompareMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}')">
            Сравнить
          </button>
        </div>
        <a href="${m.url}" target="_blank"
           style="display:block;margin-top:10px;font-size:11px;color:#555;text-decoration:underline;">
          Подробнее на outdoor-mebel.ru ↗
        </a>
      </div></div>
    </div>`).join('');
}

// Применить реальный товар к активному элементу (каждый элемент — независимо).
async function dApplyRealMat(e, pid) {
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '…';
  let product = null;
  for (const k in _catalogCache) {
    const arr = _catalogCache[k];
    if (Array.isArray(arr)) { const f = arr.find(p => p.id === pid); if (f) { product = f; break; } }
  }
  const rm = _getRM();
  if (!product && rm) { try { product = await rm.getProductById(pid); } catch (_) {} }
  if (!product) { btn.textContent = orig; return; }
  try { await product.loadTextures(); } catch (_) {}

  // В образцы кладём с превью-цветом и текстурами (чтобы повторное применение работало).
  let idx = S.samples.findIndex(s => s.id === product.id);
  if (idx < 0) {
    // price кладём в образец, чтобы повторное применение свотча тоже обновляло смету.
    S.samples.push({ id: product.id, name: product.name, color: '#C8A96E',
                     textures: product.textures, colorName: product.color || '',
                     price: _productPrice(product) });
    idx = S.samples.length - 1;
  }
  // modelUrl нужен мебели (GLB-модель товара); для прочих элементов он просто пуст.
  // price — чтобы «Применить» сразу обновляло смету (_setEstimateForActive).
  _applySampleToActive({ id: product.id, name: product.name, color: null,
                         textures: product.textures, modelUrl: product.modelUrl || '',
                         colorName: product.color || '',
                         price: _productPrice(product), _idx: idx });

  btn.textContent = '✓'; btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 700);
}

function dToggleMatCard(mid) {
  const el = document.getElementById('dmc-' + mid);
  const was = el.classList.contains('open');
  document.querySelectorAll('.d-mat-card.open').forEach(c => c.classList.remove('open'));
  if (!was) el.classList.add('open');
}

function dApplyMat(e, mid, name, color, priceStr) {
  S.samples.push({ id: mid, name, color, price: priceStr });
  _applySampleToActive({ id: mid, name, color, price: priceStr, _idx: S.samples.length - 1 });
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 600);
}

function dCompareMat(e, mid, name, color) {
  const btn = e.currentTarget;
  btn.textContent = '✓ Запомнен';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'Сравнить'; btn.style.fontWeight = '700'; }, 1000);
}

// Заглушки: цена приходит строкой ("от 2 400 ₽/м²") → вытаскиваем число.
function _parsePriceNum(s) {
  if (typeof s === 'number') return s;
  const digits = String(s || '').replace(/[^\d]/g, '');
  const v = parseInt(digits, 10);
  return isNaN(v) ? null : v;
}

// Записывает товар в смету активного элемента. Вызывается из «Применить»:
// отдельной кнопки «В смету» больше нет — применённый материал И ЕСТЬ выбор
// для сметы, а два действия на карточке путали (материал в 3D один, в смете другой).
function _setEstimateForActive(sample) {
  if (!dActiveItem) return;
  if (!('price' in sample)) return;   // источник цены не передал — строку сметы не трогаем
  const price = _parsePriceNum(sample.price);
  if (price == null) { delete S.estimate[dActiveItem]; return; }
  S.estimate[dActiveItem] = { id: sample.id, name: sample.name, price };
}

// ── Геометрические метрики элементов (для сметы) ──
const _GRIDm = () => (typeof GRID !== 'undefined' ? GRID : 32);

function _rectsAreaM2(rects) {
  const G = _GRIDm(); let a = 0;
  for (const r of (rects || [])) a += (r.w * G) * (r.h * G);
  return a;
}
function _polyLenM(pts) {
  if (!pts) return 0;
  const G = _GRIDm();
  const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts.filter(p => !p.break)];
  let L = 0;
  for (const s of segs) for (let i = 0; i < s.length - 1; i++) {
    L += Math.hypot((s[i + 1].x - s[i].x) * G, (s[i + 1].y - s[i].y) * G);
  }
  return L;
}
function _polyAreaM2(pts) {
  const G = _GRIDm();
  const p = (pts || []).filter(q => !q.break);
  if (p.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += (p[j].x * G) * (p[i].y * G) - (p[i].x * G) * (p[j].y * G);
  }
  return Math.abs(a) / 2;
}
// Ширина доски из названия товара в метрах; не распознали — 0.14 м.
//
// Порядок размеров в каталоге НЕ единый: «доска 20*140*2900» (толщина×ширина×длина),
// но «ступень узкая 150*25*3000» (ширина×толщина×длина). Поэтому не полагаемся на
// позицию: из группы размеров выбрасываем длину (≥ 1000 мм), из оставшихся ширина —
// БОЛЬШЕЕ (толщина доски ДПК — 12–25 мм, ширина — от 80 мм).
// Прежняя версия брала первое число пары и почти всегда падала на фолбэк 0.14: у
// террасной доски он совпадал с реальными 140 мм и ошибку не было видно, а ступени
// (320 мм) и фасадные панели (177 мм) считались с завышением погонажа в 1.3–2.3 раза.
const BOARD_MIN_W_MM = 80, BOARD_MAX_W_MM = 400;

function _boardWidthM(name) {
  const m = /(\d{1,4})\s*[*хxX×]\s*(\d{1,4})(?:\s*[*хxX×]\s*(\d{1,4}))?/.exec(name || '');
  if (m) {
    const dims = [m[1], m[2], m[3]].filter(Boolean).map(Number).filter(v => v < 1000);
    const w = dims.length ? Math.max(...dims) : 0;
    if (w >= BOARD_MIN_W_MM && w <= BOARD_MAX_W_MM) return w / 1000;
  }
  return 0.14;
}

// Метрика элемента: {kind:'deck'|'linear'|'piece', value, text}.
function _elementMetric(el) {
  if (el === 'terrace') { const a = _rectsAreaM2(S.terraceRects); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'steps')   { const G = _GRIDm(); const a = (S.steps.w * G) * (S.steps.h * G); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'paths')   { const len = _polyLenM(S.pts.paths); const w = (S.pathWidth || 120) / 100; const a = len * w; return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'pool_terrace') { const a = _polyAreaM2(S.pts.pool_terrace); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'pier')    { const a = _polyAreaM2(S.pts.pier); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'fence')   { const len = _polyLenM(S.pts.fence); return len > 0 ? { kind: 'linear', value: len, text: len.toFixed(1) + ' м' } : null; }
  if (el === 'beds')    { const n = (S.beds || []).length; return n > 0 ? { kind: 'piece', value: n, text: n + ' шт' } : null; }
  if (el === 'furniture') {
    // Считаем только точки с выбранным товаром (пустые — просто места под мебель).
    const n = (S.furniture || []).filter(p => p.product).length;
    return n > 0 ? { kind: 'piece', value: n, text: n + ' шт' } : null;
  }
  if (el === 'facade')  {
    // Площадь выбранных сегментов стен (пустой выбор = весь фасад) — из viewer3d.
    const a = (typeof facadeSelectedAreaM2 === 'function') ? facadeSelectedAreaM2() : 0;
    return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null;
  }
  return null;
}

// Считает смету: строки по элементам + итог. Расчёт ориентировочный:
//   deck   — площадь → погонаж доски (площадь / ширина доски × 1.1 запас) × цена/м.пог;
//   linear — длина × 1.05 × цена/м.пог;
//   piece  — количество × цена/шт.
function _computeEstimate() {
  const order = ['terrace', 'steps', 'paths', 'pool_terrace', 'pier', 'fence', 'beds', 'facade', 'furniture'];
  const rows = [];
  for (const el of order) {
    if (!S.sections.includes(el)) continue;
    const metric = _elementMetric(el);
    if (!metric || metric.value <= 0) continue;
    const lbl = (D_SIDEBAR_ITEMS.find(i => i.id === el) || {}).lbl || el;
    const mat = S.estimate[el] || null;
    let qtyUnits = null, subtotal = null;
    if (mat && mat.price) {
      if (metric.kind === 'deck') {
        const lin = Math.ceil(metric.value / _boardWidthM(mat.name) * 1.1);
        qtyUnits = lin + ' м.пог'; subtotal = lin * mat.price;
      } else if (metric.kind === 'linear') {
        const lin = Math.ceil(metric.value * 1.05);
        qtyUnits = lin + ' м.пог'; subtotal = lin * mat.price;
      } else {
        qtyUnits = metric.value + ' шт'; subtotal = metric.value * mat.price;
      }
    }
    rows.push({ el, lbl, metric, mat, qtyUnits, subtotal });
  }
  const total = rows.reduce((s, r) => s + (r.subtotal || 0), 0);
  return { rows, total };
}

function _fmtRub(n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; }

// ══════════════════════════════════════════════
// РАСЧЁТ ТЕРРАСЫ НА БЭКЕНДЕ (POST /api/v1/calculate_terrace/)
//
// Бэкенд считает полную спецификацию: доска, лаги, кляймеры, уголки, саморезы,
// подложки, полуступени + работы. Наш клиентский расчёт (_computeEstimate)
// остаётся для остальных элементов — у них своей ручки пока нет.
//
// Запрос: { vertices, doorDirection, deckingBoardProductId, terraceHeight }
//   vertices  — контур террасы в МИЛЛИМЕТРАХ, обход по порядку, у каждой вершины
//               vertexType: 'house' (лежит на стене дома) | 'free';
//   doorDirection — сторона света, см. TERRACE_CALC_NORTH ниже;
//   terraceHeight — высота настила над землёй, мм (= высота фундамента).
// ══════════════════════════════════════════════

// Ось «север» на плане. План: x вправо, y вниз (как canvas и мировой Z).
// Берём картографическое соглашение «север — вверх», т.е. N = −y.
// doorDirection трактуем как СТОРОНУ, где стоит дом с главной дверью, если
// смотреть с террасы: в примере бэкендера дом стоит по ребру y=0 (сверху), а
// направление указано 'N'. NB: пример не различает эту трактовку и обратную
// («куда смотрит дверь» при N = +y) — они дают одну и ту же ОСЬ и различаются
// только знаком. Для приоритета лаг важна ось, поэтому риск мал; если бэкендер
// подтвердит обратный знак — инвертировать здесь одной строкой.
const TERRACE_CALC_NORTH = { x: 0, y: -1 };

function _compassFromVec(vx, vy) {
  // Доминантная ось; север = TERRACE_CALC_NORTH, восток — вправо от него.
  const n = TERRACE_CALC_NORTH;
  const north = vx * n.x + vy * n.y;              // проекция на север
  const east  = vx * (-n.y) + vy * n.x;           // поворот севера на +90° по часовой
  return (Math.abs(north) >= Math.abs(east))
    ? (north >= 0 ? 'N' : 'S')
    : (east  >= 0 ? 'E' : 'W');
}

// Контур террасы в метрах плана (x вправо, y вниз). Берём union-контур блоков —
// тот же, по которому строится ограждение (_terraceUnionLoops из viewer3d-railing.js;
// он работает с любыми координатами, лишь бы rect'ы были в одной системе).
// Возвращает внешний контур (самый большой по площади) или null.
function _terracePlanLoop() {
  const rects = (S.terraceRects || []).filter(r => r && r.w > 0 && r.h > 0);
  if (!rects.length || typeof _terraceUnionLoops !== 'function') return null;
  const G = _GRIDm();
  const loops = _terraceUnionLoops(rects.map(r => ({
    minX: r.x * G, maxX: (r.x + r.w) * G,
    minZ: r.y * G, maxZ: (r.y + r.h) * G,
  })));
  if (!loops.length) return null;
  const area = loop => {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      a += p.x * q.z - q.x * p.z;
    }
    return Math.abs(a) / 2;
  };
  const outer = loops.reduce((best, l) => (area(l) > area(best) ? l : best), loops[0]);
  return outer.map(p => ({ x: p.x, y: p.z }));   // z контура = y плана
}

// Вершина лежит на стене дома? Рёбра дома берём из getHousePolygonNorm (canvas.js),
// нормированные 0..1 → метры плана. Допуск 0.15 м покрывает люфт снапа к стене.
function _vertexOnHouse(pt, houseEdges, tol) {
  for (const e of houseEdges) {
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    let t = ((pt.x - e.x1) * dx + (pt.y - e.y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(pt.x - (e.x1 + dx * t), pt.y - (e.y1 + dy * t));
    if (d <= tol) return true;
  }
  return false;
}

// Направление главной двери. Берём раскладку фасада 1-го этажа (_houseWorldTransform
// из canvas.js): дверь с флагом main, иначе первая попавшаяся. Сторону «наружу»
// определяем пробой точки по нормали (как рисуется створка на плане).
function _mainDoorDirection() {
  if (typeof _houseWorldTransform !== 'function') return null;
  const T = _houseWorldTransform();
  if (!T || !T.layout || !T.layout.edges) return null;
  let found = null;
  for (const e of T.layout.edges) {
    for (const it of e.items) {
      if (it.type !== 'door') continue;
      if (!found || it.main) found = { e, it };
      if (it.main) break;
    }
    if (found && found.it.main) break;
  }
  if (!found) return null;
  const { e, it } = found;
  const mid = T.toNorm(e.x + e.dx * (it.start + it.width / 2),
                       e.z + e.dz * (it.start + it.width / 2));
  const len = Math.hypot(e.dx, e.dz) || 1;
  let nx = -e.dz / len, ny = e.dx / len;          // нормаль к стене в плане
  const probe = 0.5 / _GRIDm();                   // 0.5 м в нормированных единицах
  if (_normPtInHouse(mid.x + nx * probe, mid.y + ny * probe)) { nx = -nx; ny = -ny; }
  // Наружная нормаль показывает ОТ дома; doorDirection — сторона, где дом (см. выше).
  return _compassFromVec(-nx, -ny);
}

// id террасной доски для расчёта: сначала явный выбор «В смету», затем применённый
// к террасе товар (S.elementMat.terrace.productId пишется в _applySampleToActive).
function _deckingBoardProductId() {
  const est = S.estimate && S.estimate.terrace;
  if (est && est.id) return est.id;
  const mat = S.elementMat && S.elementMat.terrace;
  if (mat && mat.productId) return mat.productId;
  return null;
}

// Собирает тело запроса или причину, по которой расчёт невозможен.
// { payload } | { error }
function buildTerraceCalcRequest() {
  if (!S.sections.includes('terrace')) return { error: 'Терраса не выбрана в проекте.' };
  const loop = _terracePlanLoop();
  if (!loop || loop.length < 3) return { error: 'Терраса не размечена на плане.' };
  const productId = _deckingBoardProductId();
  if (!productId) return { error: 'Выберите террасную доску в каталоге («Применить» или «В смету»).' };

  const G = _GRIDm();
  const houseEdges = (!isEmptyLot() && typeof getHousePolygonNorm === 'function')
    ? getHousePolygonNorm().edges.map(e => ({
        x1: e.x1 * G, y1: e.y1 * G, x2: e.x2 * G, y2: e.y2 * G,
      }))
    : [];
  // Начало координат — в углу bbox контура, чтобы не гонять смещение сетки участка.
  const ox = Math.min(...loop.map(p => p.x)), oy = Math.min(...loop.map(p => p.y));
  const mm = v => Math.round(v * 1000);
  const vertices = loop.map(p => ({
    x: mm(p.x - ox), y: mm(p.y - oy),
    vertexType: _vertexOnHouse(p, houseEdges, 0.15) ? 'house' : 'free',
  }));
  // Высота настила над землёй = высота фундамента (см → мм); без дома — 35 см, как в 3D.
  const foundCm = parseFloat(document.getElementById('v-found')?.value || 80);
  const terraceHeight = isEmptyLot() ? 350 : Math.round(foundCm * 10);
  return {
    payload: {
      vertices,
      doorDirection: _mainDoorDirection() || 'N',
      deckingBoardProductId: productId,
      terraceHeight,
    },
  };
}

// ── Запрос к бэкенду + кэш по телу запроса ──
const TERRACE_CALC_PATH = '/api/v1/calculate_terrace/';
let _terraceCalc = null;    // { key, state:'loading'|'ok'|'err', data, error }

async function _fetchTerraceCalc(payload) {
  const domain = (typeof RESOURCE_API_DOMAIN !== 'undefined') ? RESOURCE_API_DOMAIN : '';
  const res = await fetch(domain + TERRACE_CALC_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Запускает расчёт, если тело запроса изменилось; перерисовывает блок по готовности.
function _ensureTerraceCalc() {
  const req = buildTerraceCalcRequest();
  if (req.error) { _terraceCalc = { key: 'x', state: 'err', error: req.error }; return; }
  const key = JSON.stringify(req.payload);
  if (_terraceCalc && _terraceCalc.key === key && _terraceCalc.state !== 'err') return;
  _terraceCalc = { key, state: 'loading' };
  _fetchTerraceCalc(req.payload)
    .then(data => { _terraceCalc = { key, state: 'ok', data }; _dRenderTerraceCalc(); })
    .catch(e => {
      console.warn('[calculate_terrace]', e);
      _terraceCalc = { key, state: 'err', error: 'Сервис расчёта недоступен (' + e.message + ').' };
      _dRenderTerraceCalc();
    });
}

function terraceCalcTotal(data) {
  if (!data) return 0;
  const mats = Object.values(data.materials || {}).reduce((s, m) => s + (m.totalCost || 0), 0);
  const works = (data.works || []).reduce((s, w) => s + (w.cost || 0), 0);
  return mats + works;
}

function _dRenderTerraceCalc() {
  const host = document.getElementById('d-terrace-calc');
  if (!host) return;
  const c = _terraceCalc;
  const head = '<div class="est-title">Терраса — расчёт по спецификации</div>';
  if (!c || c.state === 'err') {
    host.innerHTML = head + `<div class="est-empty">${(c && c.error) || 'Расчёт недоступен.'}</div>`;
    return;
  }
  if (c.state === 'loading') {
    host.innerHTML = head + '<div class="d-cat-loading"><div class="d-cat-spinner"></div>Считаем террасу…</div>';
    return;
  }
  const mats = Object.values(c.data.materials || {});
  const works = c.data.works || [];
  if (!mats.length && !works.length) {
    host.innerHTML = head + '<div class="est-empty">Бэкенд вернул пустой расчёт.</div>';
    return;
  }
  const row = (name, tag, qty, unit, price, cost) => `
    <tr>
      <td>${tag || ''}</td>
      <td class="est-mat">${name || ''}</td>
      <td class="est-r">${qty != null ? qty : '—'} ${unit || ''}</td>
      <td class="est-r">${price != null ? _fmtRub(price) : '—'}</td>
      <td class="est-r">${cost != null ? _fmtRub(cost) : '—'}</td>
    </tr>`;
  host.innerHTML = head + `
    <table class="est-table">
      <thead><tr><th>Позиция</th><th>Наименование</th><th class="est-r">Кол-во</th><th class="est-r">Цена</th><th class="est-r">Сумма</th></tr></thead>
      <tbody>
        ${mats.map(m => row(m.name, m.ruTag, m.totalDimensionCount, m.dimension,
                            m.pricePerDimension, m.totalCost)).join('')}
        ${works.map(w => row(w.name, 'Работы', null, '', null, w.cost)).join('')}
      </tbody>
      <tfoot><tr><td colspan="4" class="est-r">Итого по террасе:</td><td class="est-r est-total">${_fmtRub(terraceCalcTotal(c.data))}</td></tr></tfoot>
    </table>
    <div class="est-note">Спецификация и работы посчитаны бэкендом по контуру террасы, высоте настила и выбранной
    доске. Строка «Терраса» в таблице выше — стоимость «голой» доски по площади; здесь —
    полная спецификация: подконструкция, крепёж и работы.</div>`;
}

// ══════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════
function dShowSummary() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const rows = [
    ['Тип дома', S.houseType === 'no_house' ? 'Участок без дома' : (S.houseType || 'не выбран')],
    ['Общая площадь', (document.getElementById('v-area')?.value || '—') + ' кв.м'],
    ['Фундамент', (document.getElementById('v-found')?.value || '—') + ' см'],
  ];
  // Per-floor параметры (если есть дескриптор с этажами)
  if (desc && desc.floors) {
    desc.floors.forEach((floor, fi) => {
      const a = document.getElementById(`v-area-${fi}`)?.value;
      const h = document.getElementById(`v-floor-${fi}`)?.value;
      const label = floor.label || `Этаж ${fi + 1}`;
      if (a || h) rows.push([label, `${a || '—'} кв.м, h=${h || '—'} см`]);
    });
  }
  rows.push(
    ['Настроено', dConfigured.size
      ? [...dConfigured].map(s => D_SIDEBAR_ITEMS.find(x => x.id === s)?.lbl || s).join(', ')
      : 'не выбрано'],
  );
  const infoHTML = rows.map(([k, v]) =>
    `<div class="sum-row"><span class="sum-k">${k}</span><span class="sum-v">${v}</span></div>`
  ).join('');

  // ── Предварительная смета ──
  const est = _computeEstimate();
  let estHTML = '<div class="est-title">Предварительная смета</div>';
  if (!est.rows.length) {
    estHTML += '<div class="est-empty">Разметьте конструкции, чтобы рассчитать смету.</div>';
  } else {
    estHTML += `
      <table class="est-table">
        <thead><tr><th>Элемент</th><th>Объём</th><th>Материал</th><th class="est-r">Кол-во</th><th class="est-r">Сумма</th></tr></thead>
        <tbody>
          ${est.rows.map(r => `
            <tr>
              <td>${r.lbl}</td>
              <td>${r.metric.text}</td>
              <td class="est-mat">${r.mat ? r.mat.name : '<span class="est-nomat">материал не выбран</span>'}</td>
              <td class="est-r">${r.qtyUnits || '—'}</td>
              <td class="est-r">${r.subtotal != null ? _fmtRub(r.subtotal) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4" class="est-r">Итого:</td><td class="est-r est-total">${_fmtRub(est.total)}</td></tr></tfoot>
      </table>
      <div class="est-note">Расчёт ориентировочный: цены из каталога; расход доски с запасом 10%, забора — 5%.</div>`;
  }

  // Блок расчёта террасы бэкендом — заполняется асинхронно (_dRenderTerraceCalc).
  document.getElementById('d-sum-body').innerHTML =
    infoHTML + estHTML + '<div id="d-terrace-calc"></div>';
  // Расчёт не должен ломать «Итог»: исключение при сборке запроса раньше обрывало
  // dShowSummary до _dRenderTerraceCalc, и блок оставался пустым — без заголовка и
  // без сообщения, то есть неотличимо от «фичи вообще нет в этой сборке».
  try {
    _ensureTerraceCalc();
  } catch (e) {
    console.error('[terrace calc] не удалось собрать запрос', e);
    _terraceCalc = { key: 'x', state: 'err', error: 'Не удалось собрать запрос: ' + e.message };
  }
  _dRenderTerraceCalc();
  document.getElementById('d-summary-overlay').classList.add('active');
}

function dCloseSummary() {
  document.getElementById('d-summary-overlay').classList.remove('active');
}

// ══════════════════════════════════════════════
// TOGGLES / ACTIVE SECTION
// (Слой совместимости с мобильным флоу удалён вместе с nav.js/ui.js/catalog.js —
// no-op заглушки goTo/updProg/selHouse/tci/renderSec/renderSwatches никого не
// обслуживали. getActive и ttg остаются: их использует viewer3d и index.html.)
// ══════════════════════════════════════════════
// Парные toggle'ы крыльца ↔ террасы: навес и ограждение синхронизируются автоматически.
const TG_PAIRS = {
  'porch-canopy':    'terrace-roof',
  'terrace-roof':    'porch-canopy',
  'porch-railing':   'terrace-railing',
  'terrace-railing': 'porch-railing',
};
function ttg(el) {
  el.classList.toggle('on');
  const isOn = el.classList.contains('on');
  const id = el.dataset.id;
  if (id) S.toggles[id] = isOn;             // зеркало для 3D-слоя (tgOn)
  const partnerId = id && TG_PAIRS[id];
  if (partnerId) {
    const partner = document.querySelector(`.tg[data-id="${partnerId}"]`);
    if (partner) partner.classList.toggle('on', isOn);
    S.toggles[partnerId] = isOn;
  }
}

// getActive() — returns the currently active section for material application
function getActive() {
  if (dActiveItem) {
    const sec = SECS.find(s => s.id === dActiveItem);
    if (sec) return [sec];
  }
  return SECS.slice(0, 1); // fallback
}

// Resize handler
window.addEventListener('resize', () => {
  if (typeof resizeThree === 'function') resizeThree();
});

// ══════════════════════════════════════════════
