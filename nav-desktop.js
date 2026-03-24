// NAV-DESKTOP.JS — desktop navigation, sidebar, panel, canvas editors
// Dependencies: state.js, canvas.js (init*), viewer3d-core.js

// ══════════════════════════════════════════════
// DESKTOP STATE
// ══════════════════════════════════════════════
let dStep = 1;
let dActiveCanvas = null;   // current canvas editor open (section id or null)
// (panel is single scrollable view, no separate modes)

// All sidebar items (checkbox + editor items)
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

// Canvas init functions map (section id → init function)
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
  // Hide previous screen
  const prev = document.getElementById('d-screen-' + dStep);
  if (prev) prev.classList.remove('active');

  dStep = s;
  const el = document.getElementById('d-screen-' + s);
  if (el) el.classList.add('active');

  // Update topbar
  const labels = {
    1: 'Шаг 1: Выберите тип дома',
    2: 'Шаг 2: Параметры дома',
    3: 'Шаг 3: Конфигуратор',
  };
  document.getElementById('d-step-label').textContent = labels[s] || '';

  // Show summary button on step 3
  document.getElementById('d-btn-summary').style.display = s === 3 ? '' : 'none';

  // Init 3D / sidebar for each step
  if (s === 2) {
    _dInitParamsView();
  } else if (s === 3) {
    _dInitWorkspace();
  }
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
  // Sync range sliders with inputs
  _dSyncRanges();
  // Init 3D in the params container
  setTimeout(() => {
    const slot = document.getElementById('d-slot-params');
    if (slot && slot.offsetWidth > 0) {
      init3dCanvas('d-slot-params');
    } else {
      setTimeout(() => init3dCanvas('d-slot-params'), 100);
    }
  }, 80);
}

function dOnParam() {
  // Sync range sliders
  _dSyncRanges();
  // Trigger 3D rebuild (reuse existing onParamChange from viewer3d-core)
  if (typeof onParamChange === 'function') onParamChange();
}

function _dSyncRanges() {
  const pairs = [['v-area','r-area'],['v-floor','r-floor'],['v-found','r-found']];
  pairs.forEach(([inp,rng]) => {
    const iEl = document.getElementById(inp);
    const rEl = document.getElementById(rng);
    if (iEl && rEl) rEl.value = iEl.value;
  });
}

// ══════════════════════════════════════════════
// STEP 3 — Workspace
// ══════════════════════════════════════════════
function _dInitWorkspace() {
  // Build sidebar
  _dRenderSidebar();
  // Close any open canvas
  dActiveCanvas = null;
  _dCloseAllCanvases();
  // Init 3D in workspace
  setTimeout(() => {
    const slot = document.getElementById('d-slot-workspace');
    if (slot && slot.offsetWidth > 0) {
      init3dCanvas('d-slot-workspace');
    } else {
      setTimeout(() => init3dCanvas('d-slot-workspace'), 100);
    }
  }, 80);
  // Init right panel
  _dRenderPanel();
  _dRenderPanelTabs();
}

// ── SIDEBAR ──
function _dRenderSidebar() {
  const list = document.getElementById('d-sidebar-list');
  list.innerHTML = D_SIDEBAR_ITEMS.map(item => {
    const checked = S.sections.includes(item.id) ? 'checked' : '';
    const hasData = _dHasData(item.id);
    const status = hasData ? '✓ настроено' : (item.hasEditor ? 'нажмите для настройки' : '');
    return `
      <div class="d-sidebar-item ${checked}"
           data-id="${item.id}"
           onclick="dToggleSidebarItem(this, '${item.id}')">
        <div class="d-sidebar-check"></div>
        <div class="d-sidebar-label">${item.lbl}</div>
        <div class="d-sidebar-status">${status}</div>
      </div>`;
  }).join('');
}

function _dHasData(secId) {
  if (secId === 'porch') return true; // always has default placement
  if (S.pts[secId] && S.pts[secId].length > 0) return true;
  return false;
}

function dToggleSidebarItem(el, secId) {
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  if (!item) return;

  // Toggle checked state
  const isChecked = el.classList.contains('checked');
  if (isChecked) {
    // Uncheck
    el.classList.remove('checked');
    S.sections = S.sections.filter(s => s !== secId);
    // Close canvas if open for this section
    if (dActiveCanvas === secId) dConfirmCanvas(secId);
  } else {
    // Check
    el.classList.add('checked');
    if (!S.sections.includes(secId)) S.sections.push(secId);
    // If has editor, open canvas
    if (item.hasEditor) {
      _dOpenCanvas(secId);
    }
  }
  // Rebuild 3D to show/hide elements
  if (typeof buildScene3d === 'function') {
    setTimeout(() => buildScene3d(), 100);
  }
}

// ── CANVAS EDITORS ──
function _dOpenCanvas(secId) {
  _dCloseAllCanvases();
  dActiveCanvas = secId;

  const canvasEl = document.getElementById('d-canvas-' + secId);
  if (!canvasEl) return;
  canvasEl.classList.add('active');

  // Highlight active sidebar item
  document.querySelectorAll('.d-sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === secId);
  });

  // Init the canvas
  const initFn = D_CANVAS_INIT[secId];
  if (initFn) {
    setTimeout(() => initFn(), 80);
  }
}

function _dCloseAllCanvases() {
  document.querySelectorAll('.d-center-canvas').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.d-sidebar-item').forEach(el => el.classList.remove('active'));
  dActiveCanvas = null;
}

function dConfirmCanvas(secId) {
  _dCloseAllCanvases();
  // Update sidebar status
  _dRenderSidebar();
  // Re-check the checked sections
  document.querySelectorAll('.d-sidebar-item').forEach(el => {
    if (S.sections.includes(el.dataset.id)) el.classList.add('checked');
  });
  // Rebuild 3D
  if (typeof buildScene3d === 'function') {
    setTimeout(() => {
      init3dCanvas('d-slot-workspace');
    }, 100);
  }
}

// ══════════════════════════════════════════════
// RIGHT PANEL — Materials / Catalog
// ══════════════════════════════════════════════
function _dRenderPanel() {
  dRenderSwatches();
  _dRenderColorGrid();
  _dRenderPriceGrid();
}

function _dRenderPanelTabs() {
  const active = SECS.filter(s => S.sections.length === 0 || S.sections.includes(s.req));
  if (!active.length) return;
  if (S.curSec >= active.length) S.curSec = 0;

  const tabs = document.getElementById('d-panel-tabs');
  tabs.innerHTML = active.map((s, i) =>
    `<div class="d-panel-tab ${i === S.curSec ? 'active' : ''}"
          onclick="dSwitchSec(${i})">${s.lbl}</div>`
  ).join('');

  document.getElementById('d-panel-title').textContent = active[S.curSec].lbl;
}

function dSwitchSec(i) {
  S.curSec = i;
  _dRenderPanelTabs();
  dRenderSwatches();
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
          id="dcd-${c.id}" title="${c.label}"
          style="background:${c.hex};"
          onclick="dToggleColor('${c.id}')"></div>`
  ).join('');
}

function _dRenderPriceGrid() {
  const grid = document.getElementById('d-price-grid');
  if (!grid) return;
  grid.innerHTML = PRICE_TIERS.map(t =>
    `<button class="d-price-btn ${S.catPrice === t.id ? 'selected' : ''}"
             id="dpb-${t.id}" onclick="dSelectPrice('${t.id}')">
       ${t.lbl}<br><span style="font-size:11px;font-weight:400;opacity:.7">${t.sub}</span>
     </button>`
  ).join('');
}

function dToggleColor(cid) {
  if (S.catColors.has(cid)) S.catColors.delete(cid);
  else S.catColors.add(cid);
  _dRenderColorGrid();
}

function dSelectPrice(tid) {
  S.catPrice = S.catPrice === tid ? null : tid;
  _dRenderPriceGrid();
}

// ── Catalog results ──
function dShowResults() {
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

  // Show samples divider if there are samples
  const divider = document.getElementById('d-samples-divider');
  if (divider) divider.style.display = S.samples.length ? '' : 'none';
}

function dToggleMatCard(mid) {
  const el = document.getElementById('dmc-' + mid);
  const was = el.classList.contains('open');
  document.querySelectorAll('.d-mat-card.open').forEach(c => c.classList.remove('open'));
  if (!was) el.classList.add('open');
}

function dApplyMat(e, mid, name, color) {
  // Add to samples
  S.samples.push({ id: mid, name, color });
  // Auto-apply to 3D
  S.activeSample = { id: mid, name, color, _idx: S.samples.length - 1 };
  if (typeof applyMaterialToScene === 'function') applyMaterialToScene(color);
  // Flash button
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 600);
  // Update samples view
  dRenderSwatches();
}

function dCompareMat(e, mid, name, color) {
  // Placeholder — save to compare list
  const btn = e.currentTarget;
  btn.textContent = '✓ Запомнен';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'Сравнить'; btn.style.fontWeight = '700'; }, 1000);
}

function dEstimateMat(e, mid, name) {
  // Placeholder — add to estimate
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
    ['Что строим', S.sections.length
      ? S.sections.map(s => D_SIDEBAR_ITEMS.find(x => x.id === s)?.lbl || s).join(', ')
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
// COMPATIBILITY — overrides for functions that canvas.js & viewer3d call
// ══════════════════════════════════════════════

// The mobile nav.js defines goTo(), but we override it for desktop
// so viewer3d-core.js or canvas.js won't break if they call goTo()
function goTo(s) { /* no-op on desktop, all navigation via dGoTo */ }
function updProg() { /* no-op */ }
function goToConditional() { /* no-op */ }
function goToAfter() { /* no-op */ }
function goToPrev() { /* no-op */ }
function goBack10() { /* no-op */ }
function selHouse(el, name) { dSelHouse(el, name); }
function tci(el) { el.classList.toggle('checked'); }
function ttg(el) { el.classList.toggle('on'); }

// Override renderSec for desktop (called by some init flows)
function renderSec() { _dRenderPanelTabs(); dRenderSwatches(); }
function renderSwatches() { dRenderSwatches(); }

// Resize handler
window.addEventListener('resize', () => {
  if (typeof resizeThree === 'function') resizeThree();
});

// ══════════════════════════════════════════════
