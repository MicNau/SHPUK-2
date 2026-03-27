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

  if (s === 2) _dInitParamsView();
  else if (s === 3) _dInitWorkspace();
}

// ══════════════════════════════════════════════
// STEP 1 — House selection
// ══════════════════════════════════════════════
function dSelHouse(el, name) {
  document.querySelectorAll('.d-house-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  S.houseType = name;
}

// ══════════════════════════════════════════════
// STEP 2 — Parameters + 3D
// ══════════════════════════════════════════════
function _dInitParamsView() {
  _dSyncRanges();
  setTimeout(() => {
    const slot = document.getElementById('d-slot-params');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-params');
    else setTimeout(() => init3dCanvas('d-slot-params'), 100);
  }, 80);
}

function dOnParam() {
  _dSyncRanges();
  if (typeof onParamChange === 'function') onParamChange();
}

function _dSyncRanges() {
  [['v-area','r-area'],['v-floor','r-floor'],['v-found','r-found']].forEach(([inp,rng]) => {
    const iEl = document.getElementById(inp), rEl = document.getElementById(rng);
    if (iEl && rEl) rEl.value = iEl.value;
  });
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
  const rows = [
    ['Тип дома', S.houseType || 'не выбран'],
    ['Площадь', (document.getElementById('v-area')?.value || '—') + ' кв.м'],
    ['Высота этажа', (document.getElementById('v-floor')?.value || '—') + ' см'],
    ['Фундамент', (document.getElementById('v-found')?.value || '—') + ' см'],
    ['Настроено', dConfigured.size
      ? [...dConfigured].map(s => D_SIDEBAR_ITEMS.find(x => x.id === s)?.lbl || s).join(', ')
      : 'не выбрано'],
    ...Object.entries(S.mats).map(([k, v]) => [
      D_SIDEBAR_ITEMS.find(x => x.id === k)?.lbl || k, v.name
    ]),
  ];
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
