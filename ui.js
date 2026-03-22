// ══════════════════════════════════════════════
// UI.JS — шаг 10: секции, образцы, итог
// Зависимости: state.js (S, SECS, step)
//              nav.js (goTo)
//              catalog.js (openCatalog)
// ══════════════════════════════════════════════

// ── Секции материалов (шаг 10) ───────────────
function getActive() {
  return SECS.filter(s => S.sections.length === 0 || S.sections.includes(s.req));
}

function renderSec() {
  const active = getActive();
  if (!active.length) return;
  if (S.curSec >= active.length) S.curSec = 0;

  const sec = active[S.curSec];
  document.getElementById('sec-title').textContent = sec.lbl;
  document.getElementById('sec-nav').innerHTML = active.map((s, i) => `
    <div class="sec-tab ${i === S.curSec ? 'active' : ''}" onclick="switchSec(${i})">${s.lbl}</div>
  `).join('');

  renderSwatches();
}

function renderSwatches() {
  const grid = document.getElementById('samples-grid');
  const lbl  = document.getElementById('sample-lbl');
  const all  = S.samples;

  if (!all || !all.length) {
    grid.innerHTML     = '<span class="samples-empty">Добавьте образцы из каталога</span>';
    lbl.textContent    = 'Образцы:';
    return;
  }

  lbl.textContent = `Образцы (${all.length}):`;
  grid.innerHTML = all.map((s, i) => `
    <div class="swatch" title="${s.name}">
      <button class="swatch-del" onclick="removeSwatch(${i})">✕</button>
      <span class="swatch-name">${s.name}</span>
    </div>
  `).join('');
}

function removeSwatch(i) {
  S.samples.splice(i, 1);
  renderSwatches();
}

function switchSec(i) {
  S.curSec = i;
  renderSec();
}

// ── Итог ─────────────────────────────────────
function showSummary() {
  const rows = [
    ['Тип дома',     S.houseType || 'не выбран'],
    ['Площадь',      (document.getElementById('v-area')?.value  || '—') + ' кв.м'],
    ['Высота этажа', (document.getElementById('v-floor')?.value || '—') + ' см'],
    ['Фундамент',    (document.getElementById('v-found')?.value || '—') + ' см'],
    ['Что строим',   S.sections.length
      ? S.sections.map(s => SECS.find(x => x.id === s)?.lbl || s).join(', ')
      : 'не выбрано'],
    ...Object.entries(S.mats).map(([k, v]) => [SECS.find(s => s.id === k)?.lbl || k, v.name]),
  ];

  document.getElementById('sum-body').innerHTML = rows.map(([k, v]) => `
    <div class="sum-row">
      <span class="sum-k">${k}</span>
      <span class="sum-v">${v}</span>
    </div>
  `).join('');

  const prev = document.getElementById('screen-' + step);
  if (prev) prev.classList.remove('active');
  step = 'summary';
  document.getElementById('screen-summary').classList.add('active');
  document.getElementById('pfill').style.width = '100%';
  document.getElementById('plbl').textContent  = 'Готово!';
}
