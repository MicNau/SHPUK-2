// CATALOG.JS — каталог материалов, фильтры, результаты
// Зависимости: state.js, nav.js, ui.js

// КАТАЛОГ — ФИЛЬТРЫ И РЕЗУЛЬТАТЫ
// ══════════════════════════════════════════════
function openCatalog() {
  S.catShowResults=false;
  S.catColors=new Set(); S.catPrice=null;
  document.getElementById('screen-'+step).classList.remove('active');
  step='catalog';
  document.getElementById('screen-catalog').classList.add('active');
  // Кнопка назад всегда возвращает к шагу 10
  document.getElementById('cat-back-btn').onclick = () => goTo(10);
  renderCatalogFilters();
  document.getElementById('plbl').textContent='Каталог';
}

function renderCatalogFilters() {
  S.catShowResults=false;
  document.getElementById('cat-title').textContent='Террасная доска';
  document.getElementById('cat-action-btn').textContent='ПОДОБРАТЬ →';
  document.getElementById('cat-action-btn').onclick=showCatalogResults;
  document.getElementById('cat-back-btn').onclick = () => goTo(10);

  document.getElementById('cat-body').innerHTML=`
    <div class="filter-section">
      <div class="filter-title">Цвет (можно несколько):</div>
      <div class="color-grid" id="color-grid">
        ${CATALOG_COLORS.map(c=>`
          <div class="color-dot" id="cd-${c.id}" title="${c.label}"
               style="background:${c.hex};"
               onclick="toggleColor('${c.id}')"></div>`).join('')}
      </div>
    </div>
    <div class="filter-divider"></div>
    <div class="filter-section">
      <div class="filter-title">Ценовой диапазон:</div>
      <div class="price-btns" id="price-btns">
        ${PRICE_TIERS.map(t=>`
          <button class="price-btn" id="pb-${t.id}" onclick="selectPrice('${t.id}')">
            ${t.lbl}<br><span style="font-size:11px;font-weight:400;opacity:.7">${t.sub}</span>
          </button>`).join('')}
      </div>
    </div>
  `;
}

function toggleColor(cid) {
  if (S.catColors.has(cid)) S.catColors.delete(cid);
  else S.catColors.add(cid);
  document.querySelectorAll('.color-dot').forEach(el => {
    el.classList.toggle('selected', S.catColors.has(el.id.replace('cd-','')));
  });
}

function selectPrice(tid) {
  S.catPrice = S.catPrice===tid ? null : tid;
  document.querySelectorAll('.price-btn').forEach(el =>
    el.classList.toggle('selected', el.id==='pb-'+S.catPrice));
}

function showCatalogResults() {
  let results = [...STUB_RESULTS];

  if (S.catPrice === 'budget')        results = results.filter(r => r.id === 4);
  else if (S.catPrice === 'balanced') results = results.filter(r => [1,4].includes(r.id));
  else if (S.catPrice === 'premium')  results = results.filter(r => [2,3].includes(r.id));
  else if (S.catPrice === 'mpk')      results = [{
    id:99,
    name:'Deckron МПК Классик 145×22',
    short:'Массив прессованного кедра, премиум',
    detail:'Массив прессованного кедра (МПК) — натуральный кедр под давлением 800 атм. Плотность выше дуба. Не гниёт, не трескается, не требует обработки. Цвет сохраняется 30+ лет. Срок службы не ограничен.',
    price:'от 10 000 ₽/м²',
    color:'#A0522D',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/deckron',
  }];

  S.catShowResults = true;
  document.getElementById('cat-title').textContent = `Результаты (${results.length})`;
  // Кнопка действия теперь ведёт к примерке
  document.getElementById('cat-action-btn').textContent = 'К ПРИМЕРКЕ →';
  document.getElementById('cat-action-btn').onclick = () => goTo(10);
  // Кнопка назад возвращает к фильтрам
  document.getElementById('cat-back-btn').onclick = () => {
    renderCatalogFilters();
    document.getElementById('cat-action-btn').textContent = 'ПОДОБРАТЬ →';
    document.getElementById('cat-action-btn').onclick = showCatalogResults;
    document.getElementById('cat-back-btn').onclick = () => goTo(10);
  };

  document.getElementById('cat-body').innerHTML = `
    <div class="cat-results">
      ${results.map(m => `
        <div class="mat-card" id="mc-${m.id}">
          <div class="mat-head" onclick="toggleCard(${m.id})">
            <div class="mat-thumb" style="background:${m.color||'#bbb'}"></div>
            <div class="mat-hi">
              <div class="mat-name">${m.name}</div>
              <div class="mat-short">${m.short}</div>
              <div style="font-size:13px;font-weight:700;margin-top:4px;color:#333">${m.price}</div>
            </div>
            <button class="mat-exp">▼</button>
          </div>
          <div class="mat-body"><div class="mat-bi">
            <div class="mat-det">${m.detail}</div>
            <div class="mat-acts">
              <button class="btn-smp" onclick="selMat(event,${m.id},'${m.name.replace(/'/g,"\\'")}','${m.color||'#C8A96E'}')">+ В образцы</button>
            </div>
            <a href="${m.url}" target="_blank"
               style="display:block;margin-top:10px;font-size:12px;color:#555;text-decoration:underline;">
              Подробнее на outdoor-mebel.ru ↗
            </a>
          </div></div>
        </div>`).join('')}
    </div>`;
}

function toggleCard(mid) {
  const el=document.getElementById('mc-'+mid);
  const was=el.classList.contains('open');
  document.querySelectorAll('.mat-card.open').forEach(c=>c.classList.remove('open'));
  if (!was) el.classList.add('open');
}
function selMat(e, mid, name, color) {
  // Добавляем образец с цветом
  S.samples.push({id: mid, name, color});
  // Визуальная обратная связь: кнопка мигает
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓ Добавлено';
  btn.style.background = '#444';
  setTimeout(()=>{ btn.textContent = orig; btn.style.background = '#000'; }, 800);
}

// ══════════════════════════════════════════════
// ИТОГ
// ══════════════════════════════════════════════
function showSummary() {
  const rows=[
    ['Тип дома', S.houseType||'не выбран'],
    ['Площадь', (document.getElementById('v-area')?.value||'—')+' кв.м'],
    ['Высота этажа', (document.getElementById('v-floor')?.value||'—')+' см'],
    ['Фундамент', (document.getElementById('v-found')?.value||'—')+' см'],
    ['Что строим', S.sections.length?S.sections.map(s=>SECS.find(x=>x.id===s)?.lbl||s).join(', '):'не выбрано'],
    ...Object.entries(S.mats).map(([k,v])=>[SECS.find(s=>s.id===k)?.lbl||k, v.name]),
  ];
  document.getElementById('sum-body').innerHTML=rows.map(([k,v])=>
    `<div class="sum-row"><span class="sum-k">${k}</span><span class="sum-v">${v}</span></div>`
  ).join('');
  const prev=document.getElementById('screen-'+step);
  if (prev) prev.classList.remove('active');
  step='summary';
  document.getElementById('screen-summary').classList.add('active');
  document.getElementById('pfill').style.width='100%';
  document.getElementById('plbl').textContent='Готово!';
}

// Resize Three.js when app window size changes
window.addEventListener('resize', () => { resizeThree(); });
