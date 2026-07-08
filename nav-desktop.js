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
  { id: 'facade',        lbl: 'Отделка фасада',      hasEditor: false },
  { id: 'beds',          lbl: 'Грядки',              hasEditor: true  },
  { id: 'furniture',     lbl: 'Садовая мебель',      hasEditor: false },
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
  fence:        () => { initSnapCanvas('fence'); _dSyncFenceHeight(); },
  beds:         () => initBedsCanvas(),
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

// Сохраняем legacy dSelHouse для совместимости (на случай старых вызовов из мобильной/общей логики).
function dSelHouse(el, name) {
  dSelectHouseAndGo(HOUSE_TYPE_MAP[name] || 'type_01');   // карта — в state.js
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

// Материалы дома (крыша/фундамент/стены) — квадратные образцы без подписей.
function _dRenderHouseMaterials() {
  const host = document.getElementById('d-house-mats');
  if (!host || typeof HOUSE_MATERIALS === 'undefined') return;
  const sel = { roof: S.roofMat, base: S.baseMat, wall: S.wallMat };
  host.innerHTML = ['roof', 'base', 'wall'].map(kind => {
    const grp = HOUSE_MATERIALS[kind];
    const sw = grp.items.map(it => {
      const bg = it.img ? `background-image:url('${it.img}');background-size:cover;background-position:center;`
                        : `background:${it.color};`;
      const active = (sel[kind] === it.id) ? ' active' : '';
      return `<button class="d-hm-sw${active}" style="${bg}" onclick="dSetHouseMat('${kind}','${it.id}')" title="${it.id}"></button>`;
    }).join('');
    return `<div class="d-hm-group">
      <div class="d-hm-label">${grp.label}</div>
      <div class="d-hm-row">${sw}</div>
    </div>`;
  }).join('');
}

function dSetHouseMat(kind, id) {
  if (kind === 'roof')      S.roofMat = id;
  else if (kind === 'base') S.baseMat = id;
  else if (kind === 'wall') S.wallMat = id;
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

// Высота грядки (одна на все). mm ∈ {150, 200, 270, 300}. Подсвечивает активную
// кнопку и пересобирает 3D (если грядки уже видны в сцене).
function dSetBedHeight(mm) {
  S.bedH = mm / 1000;
  document.querySelectorAll('#bed-h-seg .bed-h-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mm, 10) === mm);
  });
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
  if (secId === 'terrace' && S.matSubMode === 'railing') defSec = 2332;
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
const DECK_MAT_ELEMENTS = ['terrace', 'steps', 'paths', 'beds', 'pool_terrace', 'pier'];
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
  if (_activeIsDeck()) {
    S.elementMat[dActiveItem] = sample.textures ? { textures: sample.textures }
                              : (sample.color ? { color: sample.color } : null);
    if (typeof buildScene3d === 'function') buildScene3d();
  } else if (sample.color && typeof applyMaterialToScene === 'function') {
    applyMaterialToScene(sample.color);    // фасад/забор/ограждение — цвет
  }
  dRenderSwatches();
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
  grid.innerHTML = _elementColors(dActiveItem, S.matSubMode).map(c =>
    `<div class="d-color-dot ${S.catColors.has(c.id) ? 'selected' : ''}"
          title="${c.label}" style="background:${c.hex};"
          onclick="dToggleColor('${c.id.replace(/'/g, "\\'")}')"></div>`
  ).join('');
}

function _dRenderPriceGrid() {
  const grid = document.getElementById('d-price-grid');
  if (!grid) return;
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
    const filters = [new Filter(FilterType.SECTION_ID, sectionId)];
    const tag = (typeof SECTION_TAGS !== 'undefined') ? SECTION_TAGS[sectionId] : null;
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

// Клиентский фильтр по выбранному ценовому тиру (реальные цены — ₽/м.пог).
function _filterRealByPrice(products) {
  if (!S.catPrice) return products;
  const num = p => _productPrice(p) ?? 0;
  if (S.catPrice === 'budget')   return products.filter(p => num(p) < 2000);
  if (S.catPrice === 'balanced') return products.filter(p => num(p) >= 2000 && num(p) <= 5000);
  if (S.catPrice === 'premium')  return products.filter(p => num(p) > 5000);
  if (S.catPrice === 'mpk')      return products.filter(p => /мпк/i.test(p.name || ''));
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

function _dRenderRealResults(allProducts) {
  const list = document.getElementById('d-mat-list');
  if (!list) return;
  // Цвет — из названия товара; preview_text только как fallback (см. _itemColors).
  const products = _filterByColors(_filterRealByPrice(allProducts),
    p => [p.name || '', p.previewText || '']);
  if (!products.length) {
    list.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">Нет товаров под выбранные фильтры</div>';
    return;
  }
  list.innerHTML = products.map(p => {
    const price = _productPrice(p);
    const thumb = (p.textureUrls && p.textureUrls.textures_dpc_diffusion) || '';
    const thumbStyle = thumb
      ? `background-image:url('${thumb}');background-size:cover;background-position:center;`
      : 'background:#bbb;';
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
          <button class="d-mat-btn d-mat-btn-estimate" onclick="dEstimateRealMat(event, ${p.id})">В смету</button>
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
                  onclick="dApplyMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}')">
            Применить
          </button>
          <button class="d-mat-btn d-mat-btn-compare"
                  onclick="dCompareMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}')">
            Сравнить
          </button>
          <button class="d-mat-btn d-mat-btn-estimate"
                  onclick="dEstimateMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.price}')">
            В смету
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
    S.samples.push({ id: product.id, name: product.name, color: '#C8A96E', textures: product.textures });
    idx = S.samples.length - 1;
  }
  _applySampleToActive({ id: product.id, name: product.name, color: null, textures: product.textures, _idx: idx });

  btn.textContent = '✓'; btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 700);
}

function dToggleMatCard(mid) {
  const el = document.getElementById('dmc-' + mid);
  const was = el.classList.contains('open');
  document.querySelectorAll('.d-mat-card.open').forEach(c => c.classList.remove('open'));
  if (!was) el.classList.add('open');
}

function dApplyMat(e, mid, name, color) {
  S.samples.push({ id: mid, name, color });
  _applySampleToActive({ id: mid, name, color, _idx: S.samples.length - 1 });
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

function _estimateToast(btn) {
  btn.textContent = '✓ В смете';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'В смету'; btn.style.fontWeight = '700'; }, 1000);
}

// Заглушки: цена приходит строкой ("от 2 400 ₽/м²") → вытаскиваем число.
function _parsePriceNum(s) {
  if (typeof s === 'number') return s;
  const digits = String(s || '').replace(/[^\d]/g, '');
  const v = parseInt(digits, 10);
  return isNaN(v) ? null : v;
}

function dEstimateMat(e, mid, name, priceStr) {
  if (dActiveItem) S.estimate[dActiveItem] = { id: mid, name, price: _parsePriceNum(priceStr) };
  _estimateToast(e.currentTarget);
}

// Реальный товар «В смету»: записываем выбор для активного элемента проекта.
function dEstimateRealMat(e, pid) {
  let product = null;
  for (const k in _catalogCache) {
    const arr = _catalogCache[k];
    if (Array.isArray(arr)) { const f = arr.find(p => p.id === pid); if (f) { product = f; break; } }
  }
  if (product && dActiveItem) {
    S.estimate[dActiveItem] = { id: product.id, name: product.name, price: _productPrice(product) };
  }
  _estimateToast(e.currentTarget);
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
// Ширина доски из названия товара ("140х22мм" → 0.14 м), иначе 0.14 м.
function _boardWidthM(name) {
  const m = /(\d{2,3})\s*[*хxX×]\s*(\d{1,3})/.exec(name || '');
  if (m) { const w = parseInt(m[1], 10); if (w >= 80 && w <= 300) return w / 1000; }
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
  return null;
}

// Считает смету: строки по элементам + итог. Расчёт ориентировочный:
//   deck   — площадь → погонаж доски (площадь / ширина доски × 1.1 запас) × цена/м.пог;
//   linear — длина × 1.05 × цена/м.пог;
//   piece  — количество × цена/шт.
function _computeEstimate() {
  const order = ['terrace', 'steps', 'paths', 'pool_terrace', 'pier', 'fence', 'beds'];
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

  document.getElementById('d-sum-body').innerHTML = infoHTML + estHTML;
  document.getElementById('d-summary-overlay').classList.add('active');
}

function dCloseSummary() {
  document.getElementById('d-summary-overlay').classList.remove('active');
}

// ══════════════════════════════════════════════
// COMPATIBILITY — overrides for mobile nav functions
// ══════════════════════════════════════════════
function goTo(s) { /* no-op on desktop */ }
function updProg() { /* no-op */ }
function goToConditional() { /* no-op */ }
function goToAfter() { /* no-op */ }
function goToPrev() { /* no-op */ }
function goBack10() { /* no-op */ }
function selHouse(el, name) { dSelHouse(el, name); }
function tci(el) { el.classList.toggle('checked'); }
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

// Override renderSec/renderSwatches for desktop
function renderSec() { _dRenderPanelContent(); }
function renderSwatches() { dRenderSwatches(); }

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
