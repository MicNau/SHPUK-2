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
  { id: 'terrace',       lbl: 'Терраса',             hasEditor: true  },
  { id: 'porch',         lbl: 'Крыльцо',             hasEditor: true  },
  { id: 'paths',         lbl: 'Дорожки',             hasEditor: true  },
  { id: 'fence',         lbl: 'Забор',               hasEditor: true  },
  { id: 'facade',        lbl: 'Отделка фасада',      hasEditor: false },
  { id: 'beds',          lbl: 'Грядки',              hasEditor: false },
  { id: 'furniture',     lbl: 'Садовая мебель',      hasEditor: false },
  { id: 'pool_terrace',  lbl: 'Терраса у бассейна',  hasEditor: true  },
  { id: 'pier',          lbl: 'Причал',              hasEditor: true  },
];

// Canvas init functions map
const D_CANVAS_INIT = {
  terrace:      () => initSnapCanvas('terrace'),
  pool_terrace: () => initSnapCanvas('pool_terrace'),
  paths:        () => initPathsCanvas(),
  pier:         () => initSnapCanvas('pier'),
  porch:        () => initPorchCanvas(),
  fence:        () => initSnapCanvas('fence'),
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

  const labels = {
    1: 'Шаг 1: Выберите тип дома',
    2: 'Шаг 2: Параметры дома',
    3: 'Шаг 3: Конфигуратор',
  };
  document.getElementById('d-step-label').textContent = labels[s] || '';
  document.getElementById('d-btn-summary').style.display = s === 3 ? '' : 'none';

  if (s === 1) _dInitHouseGrid();
  else if (s === 2) _dInitParamsView();
  else if (s === 3) _dInitWorkspace();
}

// Сразу рендерим сетку при загрузке (step 1 активен по умолчанию)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _dInitHouseGrid);
  } else {
    _dInitHouseGrid();
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

// Универсальная функция выбора дома по typeId. Без отдельной кнопки «Дальше» —
// сразу переходим на step 2.
function dSelectHouseAndGo(typeId) {
  document.querySelectorAll('.d-house-card, .d-house-card-empty').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.d-house-card[data-typeid="${typeId}"]`) ||
               document.querySelector(`.d-house-card-empty[data-typeid="${typeId}"]`);
  if (card) card.classList.add('selected');

  // S.houseType хранит typeId напрямую (например, "type_10"). Для "no_house" — special-case.
  S.houseType = (typeId === 'no_house') ? null : typeId;

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
  // Маппинг старых русских имён на typeId. Можно расширять или удалить когда legacy не нужен.
  const legacyMap = {
    'Одноэтажный дом':  'type_01',
    'Двухэтажный дом':  'type_09',
    'Дом с мансардой':  'type_10',
    'Участок без дома': 'no_house',
  };
  dSelectHouseAndGo(legacyMap[name] || 'type_01');
}

// ══════════════════════════════════════════════
// STEP 2 — Parameters + 3D
// ══════════════════════════════════════════════
function _dInitParamsView() {
  // Перерендерим параметры по дескриптору (если уже загружен) или по дефолтам.
  _dRenderFloorParams();
  _dSyncRanges();
  setTimeout(() => {
    const slot = document.getElementById('d-slot-params');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-params');
    else setTimeout(() => init3dCanvas('d-slot-params'), 100);
  }, 80);
}

// Рендерит per-floor контролы (высота этажа + площадь этажа) на основе дескриптора.
// Глобальный area-слайдер служит для синхронной установки площадей всех этажей.
function _dRenderFloorParams() {
  const cont = document.getElementById('d-floors-params');
  if (!cont) return;
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
    if (aInp) { aInp.min = a.min; aInp.max = a.max; aInp.value = a.default; }
    if (aRng) { aRng.min = a.min; aRng.max = a.max; aRng.step = a.step || 5; aRng.value = a.default; }
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

    const wrap = document.createElement('div');
    wrap.className = 'd-param-group';
    wrap.style.borderTop = '1px solid #e0e0e0';
    wrap.style.paddingTop = '8px';
    wrap.innerHTML = `
      <div class="d-param-label" style="font-weight: 600; margin-bottom: 6px;">${label}</div>
      <div class="d-param-sublabel" style="font-size: 12px; color: #666; margin-bottom: 4px;">Высота этажа (см)</div>
      <input class="d-param-input" type="number" id="v-floor-${fi}" value="${hDefault}" min="${hConstr?.min ?? 270}" max="${hConstr?.max ?? 360}"
             oninput="dOnFloorParam(${fi})">
      <input class="d-param-range" type="range" id="r-floor-${fi}" value="${hDefault}" min="${hConstr?.min ?? 270}" max="${hConstr?.max ?? 360}" step="${hConstr?.step ?? 10}"
             oninput="document.getElementById('v-floor-${fi}').value=this.value; dOnFloorParam(${fi})">
      <div class="d-param-sublabel" style="font-size: 12px; color: #666; margin: 8px 0 4px;">Площадь этажа (кв.м)</div>
      <input class="d-param-input" type="number" id="v-area-${fi}" value="${aDefault}" min="${aConstr?.min ?? 40}" max="${aConstr?.max ?? 140}"
             oninput="dOnFloorParam(${fi})">
      <input class="d-param-range" type="range" id="r-area-${fi}" value="${aDefault}" min="${aConstr?.min ?? 40}" max="${aConstr?.max ?? 140}" step="${aConstr?.step ?? 5}"
             oninput="document.getElementById('v-area-${fi}').value=this.value; dOnFloorParam(${fi})">
    `;
    cont.appendChild(wrap);
  });
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

// Изменение per-floor параметра. Не синхронизируем «обратно» глобальный area —
// пользователь сознательно отрегулировал один этаж индивидуально.
function dOnFloorParam(fi) {
  ['v-floor', 'v-area'].forEach(prefix => {
    const inp = document.getElementById(`${prefix}-${fi}`);
    const rng = document.getElementById(`r${prefix.slice(1)}-${fi}`);
    if (inp && rng) rng.value = inp.value;
  });
  if (typeof onParamChange === 'function') onParamChange();
}

function dOnParam() {
  _dSyncRanges();
  if (typeof onParamChange === 'function') onParamChange();
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
function _dInitWorkspace() {
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
      </div>`;
  }).join('');
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

  // Keep item selected
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

function dApplySwatch(idx) {
  const s = S.samples[idx];
  if (!s || !s.color) return;
  S.activeSample = { ...s, _idx: idx };
  if (typeof applyMaterialToScene === 'function') applyMaterialToScene(s.color);
  dRenderSwatches();
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
function _dRenderColorGrid() {
  const grid = document.getElementById('d-color-grid');
  if (!grid) return;
  grid.innerHTML = CATALOG_COLORS.map(c =>
    `<div class="d-color-dot ${S.catColors.has(c.id) ? 'selected' : ''}"
          title="${c.label}" style="background:${c.hex};"
          onclick="dToggleColor('${c.id}')"></div>`
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

function dSelectPrice(tid) {
  S.catPrice = S.catPrice === tid ? null : tid;
  _dRenderPriceGrid();
  dShowResults();
}

// ── Catalog results (auto-shown) ──
function dShowResults() {
  _dRenderColorGrid();
  _dRenderPriceGrid();

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

  const list = document.getElementById('d-mat-list');
  if (!list) return;
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
                  onclick="dEstimateMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}')">
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

function dToggleMatCard(mid) {
  const el = document.getElementById('dmc-' + mid);
  const was = el.classList.contains('open');
  document.querySelectorAll('.d-mat-card.open').forEach(c => c.classList.remove('open'));
  if (!was) el.classList.add('open');
}

function dApplyMat(e, mid, name, color) {
  S.samples.push({ id: mid, name, color });
  S.activeSample = { id: mid, name, color, _idx: S.samples.length - 1 };
  if (typeof applyMaterialToScene === 'function') applyMaterialToScene(color);
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 600);
  dRenderSwatches();
}

function dCompareMat(e, mid, name, color) {
  const btn = e.currentTarget;
  btn.textContent = '✓ Запомнен';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'Сравнить'; btn.style.fontWeight = '700'; }, 1000);
}

function dEstimateMat(e, mid, name) {
  const btn = e.currentTarget;
  btn.textContent = '✓ В смете';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'В смету'; btn.style.fontWeight = '700'; }, 1000);
}

// ══════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════
function dShowSummary() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const rows = [
    ['Тип дома', S.houseType || 'не выбран'],
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
    ...Object.entries(S.mats).map(([k, v]) => [
      D_SIDEBAR_ITEMS.find(x => x.id === k)?.lbl || k, v.name
    ]),
  );
  document.getElementById('d-sum-body').innerHTML = rows.map(([k, v]) =>
    `<div class="sum-row"><span class="sum-k">${k}</span><span class="sum-v">${v}</span></div>`
  ).join('');
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
function ttg(el) { el.classList.toggle('on'); }

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
