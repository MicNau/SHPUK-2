// UI.JS — шаг 10: секции, образцы, примерка
// Зависимости: state.js, viewer3d.js

// СЕКЦИИ МАТЕРИАЛОВ (ШАГ 10)
// ══════════════════════════════════════════════
function getActive() {
  return SECS.filter(s => S.sections.length===0 || S.sections.includes(s.req));
}
function renderSec() {
  const active=getActive(); if (!active.length) return;
  if (S.curSec>=active.length) S.curSec=0;
  const sec=active[S.curSec];
  document.getElementById('sec-title').textContent=sec.lbl;
  document.getElementById('sec-nav').innerHTML=active.map((s,i)=>
    `<div class="sec-tab ${i===S.curSec?'active':''}" onclick="switchSec(${i})">${s.lbl}</div>`
  ).join('');
  renderSwatches();
}
function renderSwatches() {
  const grid = document.getElementById('samples-grid');
  const lbl  = document.getElementById('sample-lbl');
  const all  = S.samples; // массив {id, name, color}
  if (!all || !all.length) {
    grid.innerHTML = '<span class="samples-empty">Добавьте образцы из каталога</span>';
    lbl.textContent = 'Образцы:';
    return;
  }
  lbl.textContent = `Образцы (${all.length}):`;
  grid.innerHTML = all.map((s,i) => `
    <div class="swatch ${S.activeSample && S.activeSample.id===s.id && S.activeSample._idx===i ? 'swatch-active':''}"
         title="${s.name}" onclick="applySwatch(${i})"
         style="background:${s.color || '#d9d9d9'}; cursor:pointer;">
      <button class="swatch-del" onclick="event.stopPropagation(); removeSwatch(${i})">✕</button>
      <span class="swatch-name" style="color:${isLightColor(s.color)?'#333':'#fff'}">${s.name}</span>
    </div>`).join('');
}

function isLightColor(hex) {
  if (!hex) return true;
  const c = hex.replace('#','');
  const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
  return (r*0.299 + g*0.587 + b*0.114) > 150;
}

function applySwatch(idx) {
  const s = S.samples[idx];
  if (!s || !s.color) return;
  S.activeSample = { ...s, _idx: idx };

  // Применяем цвет к mesh'ам текущей секции
  if (threeState) {
    applyMaterialToScene(s.color);
  }

  // Обновляем UI (подсветка активного)
  renderSwatches();
}
function removeSwatch(i) {
  S.samples.splice(i,1);
  renderSwatches();
}
function switchSec(i) { S.curSec=i; renderSec(); }

// ══════════════════════════════════════════════
