// ══════════════════════════════════════════════
// NAV.JS — навигация между шагами
// Зависимости: state.js (S, SECS, SEC_SCREEN, TOTAL, step)
//              canvas.js (initSnapCanvas, initPathsCanvas, initPorchCanvas, drawSnapCanvas)
//              viewer3d.js (init3dCanvas)
//              ui.js (renderSec)
// ══════════════════════════════════════════════

function goTo(s) {
  const prev = document.getElementById('screen-' + step);
  if (prev) prev.classList.remove('active');
  step = s;
  const el = document.getElementById('screen-' + s);
  if (el) el.classList.add('active');
  updProg();
  window.scrollTo(0, 0);

  const cvMap = {
    '6':  () => initSnapCanvas('terrace'),
    '6b': () => initSnapCanvas('pool_terrace'),
    '6c': () => initPathsCanvas(),
    '6d': () => initSnapCanvas('pier'),
    '7':  () => initPorchCanvas(),
    '8':  () => initSnapCanvas('fence'),
    '10': () => { setTimeout(() => { init3dCanvas(); renderSec(); }, 80); },
  };
  if (cvMap[String(s)]) setTimeout(cvMap[String(s)], 60);
}

function updProg() {
  const numericSteps = {'6b':6, '6c':6, '6d':6};
  const n = typeof step === 'number' ? step : (numericSteps[step] || TOTAL);
  document.getElementById('pfill').style.width = Math.round(n / TOTAL * 100) + '%';
  document.getElementById('plbl').textContent = 'Шаг ' + n + ' из ' + TOTAL;
}

// Упорядоченный список активных секций, у которых есть экран
function getStepOrder() {
  const order = ['terrace', 'pool_terrace', 'paths', 'pier', 'porch', 'fence'];
  return order.filter(id => S.sections.includes(id));
}

// Шаг 5 → первый активный экран (или сразу шаг 10)
function goToConditional() {
  S.sections = [...document.querySelectorAll('.ci.checked')].map(e => e.dataset.id);
  const first = getStepOrder()[0];
  if (first) goTo(SEC_SCREEN[first]);
  else goTo(10);
}

// Переход ВПЕРЁД после конкретной секции
function goToAfter(secId) {
  const order = getStepOrder();
  const idx = order.indexOf(secId);
  const next = order[idx + 1];
  if (next) goTo(SEC_SCREEN[next]);
  else goTo(10);
}

// Переход вперёд со шага 6 (терраса)
function goToAfter6() {
  goToAfter('terrace');
}

// Переход НАЗАД со стороны конкретной секции
function goToPrev(secId) {
  const order = getStepOrder();
  const idx = order.indexOf(secId);
  if (idx > 0) goTo(SEC_SCREEN[order[idx - 1]]);
  else goTo(5);
}

// Назад с шага 10 — к последнему canvas-шагу или к шагу 5
function goBack10() {
  const order = getStepOrder();
  const last = order[order.length - 1];
  if (last) goTo(SEC_SCREEN[last]);
  else goTo(5);
}

// ── UI-хелперы ───────────────────────────────
function selHouse(el, name) {
  document.querySelectorAll('.house-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  S.houseType = name;
}

function tci(el) { el.classList.toggle('checked'); }
function ttg(el) { el.classList.toggle('on'); }
