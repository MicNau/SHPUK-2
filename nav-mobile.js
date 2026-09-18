// NAV-MOBILE.JS — вертикальная раскладка для телефона (ветка Mobile).
//
// Вход ОДИН: index.html грузит обе раскладки, режим выбирается по ширине окна
// (M_BREAKPOINT). Разметка не дублируется — мобильный каркас ПЕРЕСТАВЛЯЕТ те же
// узлы, что и десктопная: список разделов, 3D-вид, каталог и кнопка сметы едут
// в свои зоны, а идентификаторы остаются прежними. Поэтому вся логика
// nav-desktop.js (рендер разделов, каталог, смета, editor3d) работает как есть,
// а здесь лежит только раскладка, навигация по четырём экранам и подсказки.
//
// Экраны:
//   1 — выбор дома (вертикальный скролл карточек, «Дальше» при возврате);
//   2 — параметры дома (левая панель десктопа, 3D-вида нет);
//   3 — благоустройство: список разделов, а в открытом разделе сверху 3D-вид,
//       снизу его настройки и кнопки; внизу «К параметрам дома» и «Каталог»,
//       самой нижней — «Смета»;
//   4 — каталог: скролл карточек товаров, внизу «Меню».
// «Применить» в каталоге возвращает на экран 3, «Меню» — к списку разделов.

const M_BREAKPOINT = 820;       // CSS-пиксели: ниже этой ширины включается мобильный режим
let M_ON = false;

function mIsMobile() {
  return window.matchMedia(`(max-width: ${M_BREAKPOINT}px)`).matches;
}

// ══════════════════════════════════════════════
// КАРКАС
// ══════════════════════════════════════════════
// Узлы, переставленные в мобильные зоны, с их исходным местом: при возврате в
// десктопный режим (окно расширили, телефон повернули) каждый едет обратно.
const _mMoved = [];

function _mMove(node, host) {
  if (!node || !host) return;
  _mMoved.push({ node, parent: node.parentNode, next: node.nextSibling });
  host.appendChild(node);
}

function _mEl(cls, id, html) {
  const el = document.createElement('div');
  el.className = cls;
  if (id) el.id = id;
  if (html) el.innerHTML = html;
  return el;
}

function mBuildFrame() {
  const ws = document.querySelector('#d-screen-3 .d-workspace');
  const view = document.querySelector('#d-screen-3 .d-center-view');
  const sidebar = document.querySelector('#d-screen-3 .d-sidebar');
  const panel = document.getElementById('d-panel');
  const footer = panel && panel.querySelector('.d-panel-footer');
  if (!ws || !view || !sidebar || !panel) return;

  // Экран 3: вид сверху, настройки снизу, панель кнопок и «Смета» под ними.
  const zone3d = _mEl('m-3d', 'm-3d');
  const zoneSec = _mEl('m-sec', 'm-sec');
  const bar = _mEl('m-bar', 'm-bar',
    `<button class="d-btn d-btn-back" onclick="dBack()">← К параметрам дома</button>
     <button class="d-btn d-btn-back" id="m-btn-catalog" onclick="mGoCatalog()">Каталог</button>`);
  _mMove(view, zone3d);
  _mMove(sidebar, zoneSec);
  ws.appendChild(zone3d);
  ws.appendChild(zoneSec);
  ws.appendChild(bar);
  if (footer) _mMove(footer, ws);      // «Смета» — самая нижняя кнопка экрана

  // Экран 4: каталог целиком, внизу возврат к списку разделов.
  const scr4 = _mEl('d-screen', 'd-screen-4');
  const catBar = _mEl('m-bar', null,
    `<button class="d-btn d-btn-back" onclick="mBackToMenu()">← Меню</button>`);
  _mMove(panel, scr4);
  scr4.appendChild(catBar);
  document.body.appendChild(scr4);
  _mMoved.push({ node: scr4, parent: null, next: null });   // экран 4 — только мобильный
}

function mTeardownFrame() {
  for (let i = _mMoved.length - 1; i >= 0; i--) {
    const m = _mMoved[i];
    if (!m.parent) { m.node.remove(); continue; }
    m.parent.insertBefore(m.node, m.next);
  }
  _mMoved.length = 0;
  document.querySelectorAll('#d-screen-3 .m-3d, #d-screen-3 .m-sec, #d-screen-3 .m-bar')
    .forEach(el => el.remove());
}

// ══════════════════════════════════════════════
// НАВИГАЦИЯ
// ══════════════════════════════════════════════
// Мягкое переключение экрана: dGoTo заново инициализирует шаг (сбрасывает
// активный раздел и пересобирает сцену), а переходы «в каталог и обратно»
// должны сохранять состояние.
function mShowScreen(n) {
  const prev = document.getElementById('d-screen-' + dStep);
  if (prev) prev.classList.remove('active');
  dStep = n;
  const el = document.getElementById('d-screen-' + n);
  if (el) el.classList.add('active');
  if (typeof _dSyncSummaryBtn === 'function') _dSyncSummaryBtn();
  if (typeof _dSyncSectionHint === 'function') _dSyncSectionHint();
  mSyncSection();
  mScreenHint(n);
}

function mGoCatalog() {
  if (!dActiveItem) { dToast('Сначала выберите элемент благоустройства'); return; }
  mShowScreen(4);
}

// «Меню» — назад к списку разделов: активный раздел закрывается, как по клику
// мимо объекта в десктопной сцене.
function mBackToMenu() {
  if (dStep === 4) mShowScreen(3);
  dActiveItem = null;
  if (typeof e3dSetSection === 'function') e3dSetSection(null);
  if (typeof _dSetPanelLocked === 'function') _dSetPanelLocked(true);
  if (typeof _dRenderSidebar === 'function') _dRenderSidebar();
  if (typeof _dSyncSectionHint === 'function') _dSyncSectionHint();
}

// Открытый раздел: сверху вид, снизу его настройки; список разделов при этом
// показывает только открытую строку (остальные — по кнопке «Меню»).
function mSyncSection() {
  if (!M_ON) return;
  const scr = document.getElementById('d-screen-3');
  if (scr) scr.classList.toggle('m-open', !!dActiveItem);
  const cat = document.getElementById('m-btn-catalog');
  if (cat) cat.disabled = !dActiveItem;
  // Открытая строка списка помечается классом: по нему CSS оставляет на экране
  // только её (остальные разделы — по кнопке «Меню»).
  document.querySelectorAll('#d-sidebar-list .d-sb-row').forEach(row => {
    row.classList.toggle('m-active', !!row.querySelector('.d-sb-btn.active'));
  });
}

// Хуки из nav-desktop.js ───────────────────────────────────────────────
function mAfterGoTo(step) {
  if (!M_ON) return;
  mSyncSection();
  mScreenHint(step);
}

function mAfterSidebar() {
  if (!M_ON) return;
  mSyncSection();
  // Вид появляется вместе с первым открытым разделом — здесь же объясняем жесты.
  if (dActiveItem) mQueueHint('view3d', 'Управление видом', M_3D_HINT);
}

// «Применить» в каталоге возвращает к настройкам элемента (ТЗ п. 8).
function mAfterApply() {
  if (!M_ON || dStep !== 4) return;
  mShowScreen(3);
}

// ══════════════════════════════════════════════
// ПОДСКАЗКИ
// ══════════════════════════════════════════════
// Те же окна, что на десктопе (#d-hint-overlay), но по одному за раз: при первом
// заходе на экран их может совпасть несколько (экран + вид + раздел), и они
// перекрывали бы друг друга. Показанные помним в браузере — «первый раз» должен
// пережить перезагрузку страницы.
const M_HINT_KEY = 'shpuk-m-hint-';
const _mHintQueue = [];
let _mHintBusy = false;

function _mHintSeen(key) {
  try { return localStorage.getItem(M_HINT_KEY + key) === '1'; } catch (_) { return false; }
}
function _mHintMark(key) {
  try { localStorage.setItem(M_HINT_KEY + key, '1'); } catch (_) {}
}

function mQueueHint(key, title, text) {
  if (!M_ON || !text || _mHintSeen(key)) return;
  _mHintMark(key);
  _mHintQueue.push({ title, text });
  if (!_mHintBusy) _mHintNext();
}

function _mHintNext() {
  const next = _mHintQueue.shift();
  if (!next) { _mHintBusy = false; return; }
  const ov = document.getElementById('d-hint-overlay');
  const body = document.getElementById('d-hint-text');
  const title = document.getElementById('d-hint-title');
  if (!ov || !body) { _mHintBusy = false; return; }
  _mHintBusy = true;
  if (title) title.textContent = next.title || '';
  body.textContent = next.text;
  ov.classList.add('active');
}

// Вызывается из dHideEditorHint: закрыли одно окно — показываем следующее.
function mHintClosed() {
  if (!M_ON) return;
  _mHintBusy = false;
  _mHintNext();
}

// Перехват десктопных подсказок (раздел, управление видом): в мобильном режиме
// они идут той же очередью. Возвращает true — десктопный показ не нужен.
function mHintTake(key, title, text) {
  if (!M_ON) return false;
  // На экране параметров 3D-вида нет: подсказку об управлении покажем, когда он
  // появится (mAfterSidebar).
  if (key !== 'view3d' || dStep === 3) mQueueHint(key, title, text);
  return true;
}

const M_3D_HINT = 'Одно касание — выбор и перетаскивание объекта.\n'
                + 'Два пальца — поворот и масштаб вида.';

const M_SCREEN_HINTS = {
  1: ['Выбор дома', 'Пролистайте карточки и коснитесь дома — откроются его параметры. '
    + 'Нижняя карточка — участок без строений.'],
  2: ['Параметры дома', 'Задайте площадь, высоту фундамента и этажей, выберите материалы. '
    + 'Дом показывается в 3D на следующем экране.'],
  3: ['Благоустройство', 'Коснитесь элемента в списке: сверху появится 3D-вид, снизу — его '
    + 'настройки и кнопки. «Каталог» открывает товары выбранного элемента.'],
  4: ['Каталог', 'Пролистайте карточки товаров. «Применить» ставит товар и возвращает к '
    + 'настройкам элемента, «Меню» — к списку разделов.'],
};

function mScreenHint(step) {
  const h = M_SCREEN_HINTS[step];
  if (h) mQueueHint('screen' + step, h[0], h[1]);
}

// Подсказки разделов: те же по смыслу, но про палец, а не про мышь. Чего здесь
// нет — берётся из десктопных D_SECTION_HINTS (см. _dHintText).
const M_SECTION_HINTS = {
  terrace: 'Тяните террасу пальцем за угловые маркеры или за тело. «ЕЩЁ ОДНА» добавляет блок, «УДАЛИТЬ ВЫБРАННУЮ» убирает выбранный.',
  pool_terrace: 'Отдельно стоящая терраса: тяните за углы или за тело. «БАССЕЙН ▭» и «БАССЕЙН ○» ставят бассейн — в настиле на его месте будет вырез; повторное касание убирает.',
  steps: 'Лестницу двигают за середину, ширину меняют маркерами по краям. Разворачивается к террасе автоматически, количество ступеней считается от высоты.',
  beds: 'Грядку перетаскивайте пальцем; касание по ней разворачивает её на 90°.',
  paths: 'Дорожка рисуется отрезками: касание — начало, второе — конец. Следующий отрезок — снова касание. Касание по уже поставленной точке склеивает отрезки.',
  fence: 'Забор рисуется отрезками: касание — начало, второе — конец. Касание по уже поставленной точке склеивает. Ближе 3 м к дому и террасе забор не ставится. «КАЛИТКА» ставит готовую калитку — маркер двигают по линии.',
  railing: 'Ограждение строится по периметру террасы само и разрывается под лестницей. Нужен разрыв без лестницы — «ОБОЗНАЧИТЬ ВХОД», затем тяните маркеры разрыва по периметру.',
  furniture: 'Мебель появляется в сцене при выборе товара в каталоге. Перетаскивайте её пальцем, касание разворачивает на 90°; на террасе она встаёт на настил.',
  facade: 'Касайтесь стен дома, отмечая места под отделку. Повторное касание снимает выбор. Простенок и фронтон делятся по границам окна; пояс по линии карниза отделывается вместе с соседней стеной.',

  facade2: 'Касайтесь стен дома, отмечая места под отделку. Повторное касание снимает выбор. Простенок и фронтон делятся по границам окна; пояс по линии карниза отделывается вместе с соседней стеной.',
};

// Вызывается из nav-desktop (_dHintText): мобильный текст, если он есть.
function mHintText(secId) {
  return M_ON ? (M_SECTION_HINTS[secId] || '') : '';
}

// ══════════════════════════════════════════════
// ЗАПУСК
// ══════════════════════════════════════════════
function mApplyMode() {
  const want = mIsMobile();
  if (want === M_ON) return;
  M_ON = want;
  document.body.classList.toggle('m-mode', want);
  if (want) mBuildFrame(); else mTeardownFrame();
  if (typeof e3dSetTouch === 'function') e3dSetTouch(want);
  mSyncSection();
  // Канвас переехал в другую зону — просим сцену пересчитать размер вида.
  if (typeof resizeThree === 'function') setTimeout(resizeThree, 60);
}

if (typeof document !== 'undefined') {
  const start = () => {
    mApplyMode();
    if (M_ON) mScreenHint(dStep);
    window.addEventListener('resize', mApplyMode);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
