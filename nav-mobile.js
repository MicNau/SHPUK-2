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
//       снизу его настройки и кнопки; внизу «Назад» и «Каталог»,
//       самой нижней — «Смета»;
//   4 — каталог: скролл карточек товаров, внизу «Меню».
// «Применить» в каталоге возвращает на экран 3 с развёрнутым видом, «Меню» — к
// списку разделов. После первой настройки раздела его настройки уезжают вниз,
// вид занимает экран; язычок «︿» внизу вида возвращает их (правка 2026-11-20).

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
    `<button class="d-btn d-btn-back" onclick="mBack()">← Назад</button>
     <button class="d-btn d-btn-back" id="m-btn-catalog" onclick="mGoCatalog()">Каталог</button>`);
  _mMove(view, zone3d);
  // Язычок свернуть/развернуть настройки (правка 2026-11-20) — поверх вида.
  const tg = document.createElement('button');
  tg.type = 'button';
  tg.className = 'm-sec-tg';
  tg.id = 'm-sec-tg';
  tg.onclick = () => mSetCollapsed(!_mCollapsed);
  zone3d.appendChild(tg);
  _mMove(sidebar, zoneSec);
  _mWatchSettings(zoneSec);
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
  const scr = document.getElementById('d-screen-3');
  if (scr) scr.classList.remove('m-open', 'm-collapsed');
  _mCollapsed = false;
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
  // Карточку связанного товара (терраса ↔ ступени ↔ ограждение) раскрываем, когда
  // каталог уже виден: в скрытом списке её не прокрутить к центру.
  if (typeof _dApplyLinkFocus === 'function') setTimeout(_dApplyLinkFocus, 60);
}

// «Назад» на экране благоустройства (правка 2026-11-13; было «К параметрам
// дома»): из открытого раздела — к списку элементов, из списка — к параметрам.
function mBack() {
  if (dActiveItem) mBackToMenu();
  else dBack();
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
  // Новый раздел (или возврат к списку) — настройки снова на виду: сначала
  // пользователь их видит, сворачиваются они после первой настройки.
  if (dActiveItem !== _mCollapsedSec) {
    _mCollapsedSec = dActiveItem;
    if (_mCollapsed) mSetCollapsed(false, true);
  }
  _mSyncCollapseBtn();
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

// «Применить» в каталоге возвращает на экран элемента, и вид сразу развёрнут на
// всё место: товар применён — его надо рассмотреть (правка 2026-11-20).
function mAfterApply() {
  if (!M_ON || dStep !== 4) return;
  mShowScreen(3);
  mSetCollapsed(true, true);
}

// ══════════════════════════════════════════════
// СВОРАЧИВАНИЕ НАСТРОЕК (правка 2026-11-20)
// ══════════════════════════════════════════════
// После первой настройки в разделе блок настроек уезжает вниз, вид занимает
// всю площадь до «Сметы»; язычок внизу вида («︿» / «﹀») возвращает и прячет
// их. Настройка — это кнопка или переключатель раздела, поле (по окончании
// ввода), окно размеров или прохода (по «Применить»), а в 3D — законченное
// перетаскивание, точка линии, поворот, выбор куска фасада (mAfterSetting
// зовут nav-desktop.js и editor3d.js). Пока палец на экране, вид не меняет
// размер — сворачиваем только между жестами.
let _mCollapsed = false;
let _mCollapsedSec = null;     // раздел, для которого действует состояние

function _mSyncCollapseBtn() {
  const tg = document.getElementById('m-sec-tg');
  if (!tg) return;
  tg.textContent = _mCollapsed ? '︿' : '﹀';
  tg.setAttribute('aria-label', _mCollapsed ? 'Показать настройки' : 'Скрыть настройки');
  tg.title = tg.getAttribute('aria-label');
}

function mSetCollapsed(on, instant) {
  const scr = document.getElementById('d-screen-3');
  if (!M_ON || !scr) return;
  on = !!on && !!dActiveItem;
  if (on === _mCollapsed) { _mSyncCollapseBtn(); return; }
  _mCollapsed = on;
  _mSyncCollapseBtn();
  const parts = scr.querySelectorAll('.m-sec, .m-bar');
  const apply = () => {
    parts.forEach(el => el.classList.remove('m-slide-out', 'm-slide-in'));
    const a0 = _mViewAspect();
    scr.classList.toggle('m-collapsed', _mCollapsed);
    if (!_mCollapsed && !instant) parts.forEach(el => el.classList.add('m-slide-in'));
    _mKeepFraming(a0, _mViewAspect());
    if (typeof resizeThree === 'function') { resizeThree(); setTimeout(resizeThree, 60); }
  };
  if (on && !instant) {
    // Уезжают вниз, потом вид забирает место.
    parts.forEach(el => el.classList.add('m-slide-out'));
    setTimeout(() => { if (_mCollapsed) apply(); }, 180);
  } else apply();
}

// Пропорции зоны вида (ширина / высота); 0 — вида нет.
function _mViewAspect() {
  const v = document.getElementById('m-3d');
  return v && v.offsetHeight ? v.offsetWidth / v.offsetHeight : 0;
}

// Вид вытянулся по высоте — угол обзора камеры задан по вертикали, и без
// поправки картинка увеличилась бы в a0/a1 раз (×2,5 на телефоне): терраса и
// дом уходили за края экрана. Сохранить ширину кадра целиком — дом мельчал
// посреди пустого участка. Середина: камера отъезжает на (a0/a1)^0.7, картинка
// крупнее примерно на треть и по ширине почти не обрезается. При
// разворачивании настроек — обратно.
const M_FRAME_POW = 0.7;
function _mKeepFraming(a0, a1) {
  const ts = (typeof threeState !== 'undefined') ? threeState : null;
  if (!ts || !ts.camera || !ts.controls || !a0 || !a1) return;
  const cam = ts.camera, tgt = ts.controls.target;
  const off = cam.position.clone().sub(tgt);
  const d = off.length();
  if (!d) return;
  const c = ts.controls;
  const nd = Math.min(c.maxDistance || Infinity, Math.max(c.minDistance || 0, d * Math.pow(a0 / a1, M_FRAME_POW)));
  cam.position.copy(tgt).add(off.multiplyScalar(nd / d));
  c.update();
}

// Настройка сделана — сворачиваем (если раздел открыт и мы на его экране).
function mAfterSetting() {
  if (!M_ON || dStep !== 3 || !dActiveItem || _mCollapsed) return;
  mSetCollapsed(true);
}

// Окно поверх (размеры, проход, подсказка) — настройка ещё не сделана: свернём
// по его «Применить» (mAfterSetting из nav-desktop.js).
function _mDialogOpen() {
  return !!document.querySelector('.d-hint-overlay.active, .d-summary-overlay.active');
}

function _mWatchSettings(zone) {
  const later = () => setTimeout(() => { if (!_mDialogOpen()) mAfterSetting(); }, 120);
  zone.addEventListener('click', ev => {
    const t = ev.target.closest('#d-sb-accordion button, #d-sb-accordion .tg');
    if (t && !t.disabled) later();
  });
  // Поля и ползунки — по окончании ввода (change), а не на каждое движение.
  zone.addEventListener('change', ev => {
    if (ev.target.closest('#d-sb-accordion')) later();
  });
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
  // Открыто приветствие — очередь ждёт его закрытия (dCloseWelcome).
  if (typeof dWelcomeOpen === 'function' && dWelcomeOpen()) { _mHintBusy = false; return; }
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
    + 'настройки и кнопки. После первой настройки они уезжают вниз, а вид занимает весь экран; '
    + 'вернуть их — кнопка «︿» внизу вида. «Каталог» открывает товары выбранного элемента.'],
  4: ['Каталог', 'Пролистайте карточки товаров. «Применить» ставит товар и возвращает к '
    + '3D-виду, «Меню» — к списку разделов.'],
};

function mScreenHint(step) {
  const h = M_SCREEN_HINTS[step];
  if (h) mQueueHint('screen' + step, h[0], h[1]);
}

// Подсказки разделов: те же по смыслу, но про палец, а не про мышь. Чего здесь
// нет — берётся из десктопных D_SECTION_HINTS (см. _dHintText).
const M_SECTION_HINTS = {
  terrace: 'Тяните террасу пальцем за угловые маркеры или за тело. «ЗАДАТЬ РАЗМЕРЫ» — длина и ширина выбранного блока числами. «ЕЩЁ ОДНА» добавляет блок, «УДАЛИТЬ ВЫБРАННУЮ» убирает выбранный.',
  pool_terrace: 'Отдельно стоящая терраса: тяните за углы или за тело. «БАССЕЙН ▭» и «БАССЕЙН ○» ставят бассейн — в настиле на его месте будет вырез; повторное касание убирает.',
  steps: 'Лестницу двигают за середину, ширину меняют маркерами по краям. Разворачивается к террасе автоматически, количество ступеней считается от высоты.',
  beds: 'Грядку перетаскивайте пальцем; касание по ней разворачивает её на 90°.',
  paths: 'Дорожка рисуется касаниями: каждое касание добавляет точку, линия тянется дальше. Закончить — повторным касанием последней точки. Касание готовой точки выделяет её — её можно перетащить или удалить. Через дом и террасу дорожка не проходит.',
  fence: 'Забор рисуется касаниями: каждое касание добавляет точку, линия тянется дальше. Закончить — повторным касанием последней точки. Касание готовой точки выделяет её. Через дом и террасу и ближе 3 м к ним забор не проходит. «КАЛИТКА» ставит готовую калитку — маркер двигают по линии.',
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
// Видимая высота окна → --app-h (styles-mobile.css): по ней считаются высоты
// экранов и вида. innerHeight у мобильных браузеров — высота видимой области
// (с адресной строкой и без неё — по факту), в отличие от 100vh.
function mSyncAppHeight() {
  document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
}

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
    mSyncAppHeight();
    window.addEventListener('resize', mSyncAppHeight);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', mSyncAppHeight);
    mApplyMode();
    // Стартовый экран (#d-start) — и на десктопе, и на телефоне (правка
    // 2026-11-20; раньше на телефоне было окно-приветствие). Проект по ссылке
    // (?project=…) открывается сразу, без него.
    const byLink = (typeof projectKeyFromUrl === 'function') && !!projectKeyFromUrl();
    if (byLink) {
      const st = document.getElementById('d-start');
      if (st) st.classList.remove('active');
    }
    if (M_ON) mScreenHint(dStep);
    window.addEventListener('resize', mApplyMode);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
