// NAV.JS — навигация между шагами
// Зависимости: state.js, canvas.js (init*), viewer3d.js (init3dCanvas), ui.js (renderSec)

// НАВИГАЦИЯ
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
    '2':  ()=>init3dCanvas('slot-2'),
    '3':  ()=>init3dCanvas('slot-3'),
    '4':  ()=>init3dCanvas('slot-4'),
    '6':  ()=>initSnapCanvas('terrace'),
    '6b': ()=>initSnapCanvas('pool_terrace'),
    '6c': ()=>initPathsCanvas(),
    '6d': ()=>initSnapCanvas('pier'),
    '7':  ()=>initPorchCanvas(),
    '8':  ()=>initSnapCanvas('fence'),
    '10': ()=>{ init3dCanvas('three-container'); renderSec(); },
  };
  if (cvMap[String(s)]) {
    const fn = cvMap[String(s)];
    const slotIds = {'2':'slot-2','3':'slot-3','4':'slot-4','10':'three-container'};
    const sid = slotIds[String(s)];
    // Ждём пока слот получит реальный размер (display:flex + CSS анимация)
    const tryInit = (attempt) => {
      const el = sid ? document.getElementById(sid) : null;
      if (el && el.offsetWidth === 0 && attempt < 8) {
        setTimeout(() => tryInit(attempt + 1), 60);
      } else {
        fn();
      }
    };
    setTimeout(() => tryInit(0), 60);
  }
}

function updProg() {
  const numericSteps = {'6b':6,'6c':6,'6d':6};
  const n = typeof step === 'number' ? step : (numericSteps[step] || TOTAL);
  document.getElementById('pfill').style.width = Math.round(n/TOTAL*100)+'%';
  document.getElementById('plbl').textContent = 'Шаг '+n+' из '+TOTAL;
}

// Возвращает упорядоченный список активных шагов-экранов (id секций имеющих экран)
function getStepOrder() {
  const order = ['terrace','porch','paths','fence','pool_terrace','pier'];
  return order.filter(id => S.sections.includes(id));
}

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
  // Крыльцо: если есть терраса, показываем план с террасой
  goToAfter('terrace');
}

// Переход НАЗАД со стороны конкретной секции
function goToPrev(secId) {
  const order = getStepOrder();
  const idx = order.indexOf(secId);
  if (idx > 0) goTo(SEC_SCREEN[order[idx - 1]]);
  else goTo(5);
}

function goBack10() {
  const order = getStepOrder();
  const last = order[order.length - 1];
  if (last) goTo(SEC_SCREEN[last]);
  else goTo(5);
}

function selHouse(el, name) {
  document.querySelectorAll('.house-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected'); S.houseType = name;
}
function tci(el) { el.classList.toggle('checked'); }
function ttg(el) { el.classList.toggle('on'); }

// ══════════════════════════════════════════════
