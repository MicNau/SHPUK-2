// PROJECT-IO.JS — снимок проекта: сохранение на сервер и загрузка по ссылке.
//
// «Отправить заявку» в смете шлёт бэкенду имя, почту и ОПИСАНИЕ проекта
// (ResourceManager.saveProject). Сервер кладёт описание как есть, возвращает
// ключ и присылает менеджеру и пользователю письмо со ссылкой; открытая по ней
// страница читает ключ из query-параметра и восстанавливает состояние
// (ResourceManager.getProject). Расчёт в описание НЕ входит — смету бэкенд
// считает сам по этим данным.
//
// Формат описан в PROJECT_FORMAT.md (им же бэкенд проверяет, что пришли не
// мусорные данные). Здесь только сборка и применение.
//
// Единицы: все длины — МИЛЛИМЕТРЫ, координаты — от левого верхнего угла участка
// (сетка GRID×GRID м). Внутри приложение считает в долях 0..1, но наружу такие
// числа отдавать нельзя: они ничего не значат без размера участка.

const PROJECT_FORMAT_VERSION = 1;
const PROJECT_QUERY_KEY = 'project';     // ?project=<saveId>

function _pioGridMm() {
  return ((typeof GRID !== 'undefined') ? GRID : 32) * 1000;
}

const _pioMm  = v => Math.round(v * _pioGridMm());          // доля плана → мм
const _pioNorm = v => (v || 0) / _pioGridMm();              // мм → доля плана
const _pioRect = r => ({ x: _pioMm(r.x), y: _pioMm(r.y), w: _pioMm(r.w), h: _pioMm(r.h) });
const _pioRectBack = r => ({ x: _pioNorm(r.x), y: _pioNorm(r.y),
                             w: _pioNorm(r.w), h: _pioNorm(r.h) });
const _pioPts = pts => (pts || []).map(p => (p.break
  ? { break: true }
  : { x: _pioMm(p.x), y: _pioMm(p.y) }));
const _pioPtsBack = pts => (pts || []).map(p => (p.break
  ? { break: true }
  : { x: _pioNorm(p.x), y: _pioNorm(p.y) }));

// Товар, назначенный элементу: то, что нужно бэкенду для сметы, и то, по чему
// сцена восстановит внешний вид (текстуры и модель приедут из каталога заново,
// поэтому здесь только идентификаторы и то, что каталогом не отдаётся).
function _pioProduct(el) {
  const est = (S.estimate && S.estimate[el]) || null;
  const mat = (S.elementMat && S.elementMat[el]) || null;
  if (!est && !mat) return null;
  const out = {};
  if (est) { out.productId = est.id; out.name = est.name || ''; }
  else if (mat && mat.productId) out.productId = mat.productId;
  if (mat && mat.color) out.color = mat.color;
  return Object.keys(out).length ? out : null;
}

function _pioNum(id, def) {
  const el = document.getElementById(id);
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) ? v : def;
}

// ── Снимок ───────────────────────────────────────────────────────────────
function buildProjectSnapshot() {
  const floors = [];
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (desc && desc.floors) {
    desc.floors.forEach((f, i) => floors.push({
      index: i,
      heightMm: Math.round(_pioNum('v-floor-' + i, 300) * 10),
      areaM2: _pioNum('v-area-' + i, 0),
    }));
  }
  const snap = {
    version: PROJECT_FORMAT_VERSION,
    app: 'shpuk-configurator',
    savedAt: new Date().toISOString(),
    units: 'mm',
    plot: { sizeMm: _pioGridMm() },
    house: {
      typeId: S.houseType || null,
      areaM2: _pioNum('v-area', 0),
      foundationMm: Math.round(_pioNum('v-found', 0) * 10),
      floors,
      materials: { roof: S.roofMat, base: S.baseMat, wall: S.wallMat, frame: S.frameMat },
    },
    elements: {},
  };
  const el = snap.elements;

  for (const sec of ['terrace', 'pool_terrace']) {
    const rects = (typeof secRects === 'function') ? secRects(sec) : [];
    if (!rects.length) continue;
    el[sec] = { product: _pioProduct(sec), rects: rects.map(_pioRect) };
    if (sec === 'terrace' && S.terraceH != null) el[sec].deckHeightMm = Math.round(S.terraceH * 1000);
    if (sec === 'pool_terrace' && S.pool) {
      el[sec].pool = { kind: S.pool.kind || 'rect', ..._pioRect(S.pool) };
    }
  }
  // Ступени и ограждение пишем, только если раздел ВКЛЮЧЁН в проект. У ступеней
  // в состоянии всегда лежит заготовка (DEFAULT_STEPS_RECT), у ограждения могут
  // остаться старые разрывы — без этой проверки они уходили в снимок, и при
  // открытии проекта по ссылке появлялись ступени, которых никто не строил
  // (баг 2026-09-26). Рисует сцена их тоже только для включённого раздела.
  const inProject = sec => (S.sections || []).includes(sec);
  const stairs = (inProject('steps') && typeof stepsAll === 'function') ? stepsAll() : [];
  if (stairs.length) {
    el.steps = {
      product: _pioProduct('steps'),
      railing: !!(S.toggles && S.toggles['steps-railing']),
      items: stairs.map(_pioRect),
    };
  }
  if ((S.pts.paths || []).length) {
    el.paths = { product: _pioProduct('paths'), widthMm: Math.round((S.pathWidth || 120) * 10),
                 points: _pioPts(S.pts.paths) };
  }
  if ((S.pts.fence || []).length) {
    el.fence = { product: _pioProduct('fence'), heightMm: Math.round((S.fenceH || 0) * 1000),
                 points: _pioPts(S.pts.fence) };
    if (S.fenceGate) el.fence.gate = { x: _pioMm(S.fenceGate.x), y: _pioMm(S.fenceGate.y) };
  }
  if (inProject('railing')) {
    el.railing = { product: _pioProduct('railing'),
                   postWidthMm: S.railPostW || null,
                   entries: (S.railingEntries || []).map(e => (e ? { t0: e.t0, t1: e.t1 } : null)) };
  }
  if ((S.beds || []).length) {
    el.beds = { product: _pioProduct('beds'), heightMm: Math.round((S.bedH || 0) * 1000),
                mount: S.bedMount || null, items: (S.beds || []).map(_pioRect) };
  }
  if ((S.furniture || []).length) {
    el.furniture = { items: (S.furniture || []).map(f => ({
      x: _pioMm(f.x), y: _pioMm(f.y), rotDeg: Math.round((f.rot || 0) * 180 / Math.PI),
      productId: (f.product && f.product.id) || null,
      name: (f.product && f.product.name) || '',
    })) };
  }
  for (const sec of (typeof FACADE_SECS !== 'undefined' ? FACADE_SECS : ['facade'])) {
    const zones = (typeof facadeZones === 'function') ? facadeZones(sec) : {};
    const ids = Object.keys(zones);
    if (!ids.length) continue;
    const prod = _pioProduct(sec);
    el[sec] = {
      product: prod,
      segments: ids,                       // id кусков — по ним восстанавливается выбор
      // Участки обшивки в системе стены: то же, что уходит в расчёт фасада.
      pieces: (typeof facadePieces === 'function')
        ? facadePieces(sec, (prod && prod.productId) || null) : [],
    };
  }
  return snap;
}

// ── Применение снимка ────────────────────────────────────────────────────
// Возвращает true, если состояние принято. Геометрию применяем всегда, а дом
// грузим асинхронно — сцена соберётся, когда дескриптор приедет.
function applyProjectSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || !snap.elements) return false;
  const h = snap.house || {};
  if (h.typeId) S.houseType = h.typeId;
  const setNum = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.value = v; };
  if (h.areaM2) setNum('v-area', h.areaM2);
  if (h.areaM2) setNum('r-area', h.areaM2);
  if (h.foundationMm) { setNum('v-found', h.foundationMm / 10); setNum('r-found', h.foundationMm / 10); }
  if (h.materials) {
    if (h.materials.roof)  S.roofMat  = h.materials.roof;
    if (h.materials.base)  S.baseMat  = h.materials.base;
    if (h.materials.wall)  S.wallMat  = h.materials.wall;
    if (h.materials.frame) S.frameMat = h.materials.frame;
  }
  // Поэтажные поля появляются только после рендера параметров — значения
  // запоминаем и проставляем, когда поля будут (см. _pioApplyFloors).
  _pioPendingFloors = (h.floors || []).slice();

  const el = snap.elements || {};
  // Идентификаторы товаров копим здесь: сами товары (с текстурами, моделью и
  // характеристиками) подтягиваются с бэкенда уже после применения снимка —
  // см. _pioProductIds и dRestoreProducts.
  _pioProductIds = {};
  _pioFurnitureIds = [];
  const useProduct = (sec, p) => {
    if (!p) return;
    if (p.productId) {
      S.estimate[sec] = { id: p.productId, name: p.name || '', price: 0 };
      _pioProductIds[sec] = p.productId;
    }
    if (p.color) S.elementMat[sec] = { color: p.color };
  };

  for (const sec of ['terrace', 'pool_terrace']) {
    const src = el[sec];
    if (!src) continue;
    const rects = (src.rects || []).map(_pioRectBack);
    // secRects отдаёт сам массив состояния — наполняем его на месте, чтобы не
    // терять связь с S (ключ массива у каждого раздела свой, см. RECT_SECTIONS).
    const dst = (typeof secRects === 'function') ? secRects(sec) : null;
    if (dst) { dst.length = 0; rects.forEach(r => dst.push(r)); }
    if (typeof setSecActiveIdx === 'function') setSecActiveIdx(sec, rects.length ? 0 : null);
    if (!S.sections.includes(sec)) S.sections.push(sec);
    if (sec === 'terrace' && src.deckHeightMm) S.terraceH = src.deckHeightMm / 1000;
    if (sec === 'pool_terrace' && src.pool) {
      S.pool = { kind: src.pool.kind || 'rect', ..._pioRectBack(src.pool) };
    }
    useProduct(sec, src.product);
  }
  if (el.steps) {
    S.stepsList = (el.steps.items || []).map(_pioRectBack);
    S.activeSteps = S.stepsList.length ? 0 : null;
    if (S.toggles) S.toggles['steps-railing'] = !!el.steps.railing;
    if (!S.sections.includes('steps')) S.sections.push('steps');
    useProduct('steps', el.steps.product);
  }
  if (el.paths) {
    S.pts.paths = _pioPtsBack(el.paths.points);
    if (el.paths.widthMm) S.pathWidth = el.paths.widthMm / 10;
    if (!S.sections.includes('paths')) S.sections.push('paths');
    useProduct('paths', el.paths.product);
  }
  if (el.fence) {
    S.pts.fence = _pioPtsBack(el.fence.points);
    S.fenceGate = el.fence.gate
      ? { x: _pioNorm(el.fence.gate.x), y: _pioNorm(el.fence.gate.y) } : null;
    if (!S.sections.includes('fence')) S.sections.push('fence');
    useProduct('fence', el.fence.product);
  }
  if (el.railing) {
    S.railingEntries = (el.railing.entries || []).map(e => (e ? { t0: e.t0, t1: e.t1 } : null));
    if (el.railing.postWidthMm) S.railPostW = el.railing.postWidthMm;
    if (!S.sections.includes('railing')) S.sections.push('railing');
    useProduct('railing', el.railing.product);
  }
  if (el.beds) {
    S.beds = (el.beds.items || []).map(_pioRectBack);
    S.activeBed = S.beds.length ? 0 : null;
    if (el.beds.heightMm) S.bedH = el.beds.heightMm / 1000;
    S.bedMount = el.beds.mount || null;
    if (!S.sections.includes('beds')) S.sections.push('beds');
    useProduct('beds', el.beds.product);
  }
  if (el.furniture) {
    S.furniture = (el.furniture.items || []).map(f => ({
      x: _pioNorm(f.x), y: _pioNorm(f.y), rot: (f.rotDeg || 0) * Math.PI / 180,
      product: f.productId ? { id: f.productId, name: f.name || '' } : null,
    }));
    for (const f of S.furniture) if (f.product) _pioFurnitureIds.push(f.product.id);
    if (!S.sections.includes('furniture')) S.sections.push('furniture');
  }
  for (const sec of (typeof FACADE_SECS !== 'undefined' ? FACADE_SECS : ['facade'])) {
    const src = el[sec];
    if (!src) continue;
    const zones = {};
    for (const id of (src.segments || [])) zones[id] = true;
    if (sec === 'facade2') S.wallZones2 = zones; else S.wallZones = zones;
    if (!S.sections.includes(sec)) S.sections.push(sec);
    useProduct(sec, src.product);
  }
  return true;
}

// Поэтажные поля появляются после _dRenderFloorParams — дописываем значения,
// когда поля уже есть (иначе дом соберётся с площадями по умолчанию).
let _pioPendingFloors = null;

// Товары снимка: раздел → productId и список идентификаторов мебели. Сами товары
// (текстуры, модель, характеристики) догружаются с бэкенда после применения.
let _pioProductIds = {};
let _pioFurnitureIds = [];

function pioApplyPendingFloors() {
  if (!_pioPendingFloors || !_pioPendingFloors.length) return false;
  let done = false;
  for (const f of _pioPendingFloors) {
    const h = document.getElementById('v-floor-' + f.index);
    const a = document.getElementById('v-area-' + f.index);
    if (h && f.heightMm) { h.value = f.heightMm / 10; done = true; }
    if (a && f.areaM2)   { a.value = f.areaM2; done = true; }
    const rh = document.getElementById('r-floor-' + f.index);
    const ra = document.getElementById('r-area-' + f.index);
    if (rh && f.heightMm) rh.value = f.heightMm / 10;
    if (ra && f.areaM2)   ra.value = f.areaM2;
  }
  if (done) _pioPendingFloors = null;
  return done;
}

// ── Сохранение и загрузка ────────────────────────────────────────────────
// Ошибку ResourceManager глотает (возвращает null), поэтому причину показываем
// общими словами: детали видны в консоли.
// Тело для сметы в письме (ревизия API 2026-09-20): то же, что уходит в
// calculate_project, плюс тип. Прислали — к письму приложится смета в PDF, не
// прислали — письмо уйдёт с одной ссылкой на проект. Сам расчёт бэкенд делает
// сам: в описании проекта (data) его по-прежнему нет.
function _pioCalculation() {
  if (typeof buildProjectCalcRequest !== 'function') return null;
  let req = null;
  try { req = buildProjectCalcRequest(); } catch (_) { return null; }
  if (!req || !req.payload) return null;                   // нечего считать — шлём без сметы
  const type = (typeof CalculationType !== 'undefined') ? CalculationType.PROJECT : 'project';
  return { type, ...req.payload };
}

// Текст отказа для окна заявки: сервер объясняет причину, и молчать о ней
// нельзя — иначе «попробуйте ещё раз» уводит от настоящей проблемы.
function _pioSaveErrorText(rm) {
  const e = rm && rm.lastSaveError;
  if (!e) return 'Не удалось отправить заявку. Попробуйте ещё раз.';
  if (e.status === 429) return 'Слишком много заявок подряд. Попробуйте через несколько минут.';
  if (e.status === 413) return 'Проект слишком большой для отправки. Напишите нам, разберёмся.';
  if (e.message) return 'Сервер не принял заявку: ' + e.message;
  if (!e.status) return 'Сервис недоступен. Проверьте связь и попробуйте ещё раз.';
  return `Не удалось отправить заявку (ошибка ${e.status}). Попробуйте ещё раз.`;
}

// Тело запроса заявки целиком — им же отправляем и его же кладём в файл.
function pioRequestBody(name, email) {
  return { name: name || '', email: email || '',
           data: buildProjectSnapshot(), calculation: _pioCalculation() };
}

// Последняя попытка отправки: тело и ответ сервера. Нужна выгрузке в файл —
// в ней должно лежать ровно то, что ушло, а не собранное заново.
let _pioLastAttempt = null;

// Запрос в JSON-файл: с сайта заявка не уходит, а из репозитория уходит, и
// разбираться в этом бэкенду проще по тому, что реально отправлялось.
// В файле три части: request — тело как есть (его можно послать серверу
// повторно), response — ответ (код 0 значит, что ответа не было вовсе: сеть,
// CORS или заблокированный запрос), meta — откуда и куда отправляли.
function pioDumpRequest(name, email) {
  const a = _pioLastAttempt || { body: pioRequestBody(name, email), response: null,
                                 at: new Date().toISOString() };
  const domain = (typeof RESOURCE_API_DOMAIN !== 'undefined') ? RESOURCE_API_DOMAIN : null;
  const dump = {
    request: a.body,
    response: a.response,
    meta: {
      at: a.at,
      page: (typeof location !== 'undefined') ? location.href : '',
      apiDomain: (domain === '') ? '(тот же домен, локальный прокси)'
                                 : (domain || '(не задан)'),
      endpoint: (domain || '') + '/api/v1/create_project/',
      formatVersion: PROJECT_FORMAT_VERSION,
      userAgent: (typeof navigator !== 'undefined') ? navigator.userAgent : '',
    },
  };
  try {
    const stamp = dump.meta.at.replace(/[:T]/g, '-').slice(0, 16);
    const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url;
    a2.download = `shpuk-request-${stamp}.json`;
    document.body.appendChild(a2);
    a2.click();
    a2.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.warn('[project] файл не сохранился', e); }
  console.info('[project] запрос заявки:', dump);
  return dump;
}

async function saveProjectToServer(name, email) {
  const rm = (typeof _getRM === 'function') ? _getRM() : null;
  if (!rm || typeof rm.saveProject !== 'function') return { error: 'Сервис недоступен.' };
  const body = pioRequestBody(name, email);
  const data = body.data;
  _pioLastAttempt = { body, response: null, at: new Date().toISOString() };
  let res = await rm.saveProject(name, email, data, body.calculation);
  _pioLastAttempt.response = res
    ? { status: 'ok', body: res }
    : (rm.lastSaveError || { status: 0, message: '', body: '' });
  // Смета к письму — приятное дополнение, а ссылка на проект — суть заявки.
  // Если сервер забраковал именно данные для расчёта (он проверяет их теми же
  // правилами, что и сам расчёт), повторяем без них: клиент получит письмо со
  // ссылкой, а причина останется в консоли.
  const err = rm.lastSaveError;
  if (!res && err && err.status === 400 && /calculation/i.test(err.message || err.body || '')) {
    console.warn('[project] смета не принята сервером, отправляем заявку без неё:', err.message);
    res = await rm.saveProject(name, email, data, null);
    _pioLastAttempt.retriedWithoutCalculation = true;
    _pioLastAttempt.response = res
      ? { status: 'ok', body: res, note: 'принято со второй попытки, без calculation' }
      : (rm.lastSaveError || _pioLastAttempt.response);
  }
  if (!res) return { error: _pioSaveErrorText(rm), canDump: true };
  return { saveId: res.saveId || res.save_id || res.id || res.key || null, raw: res };
}

function projectKeyFromUrl() {
  try {
    return new URLSearchParams(location.search).get(PROJECT_QUERY_KEY) || null;
  } catch (_) { return null; }
}

async function loadProjectFromServer(saveId) {
  const rm = (typeof _getRM === 'function') ? _getRM() : null;
  if (!rm || typeof rm.getProject !== 'function') return null;
  const res = await rm.getProject(saveId);
  if (!res) return null;
  return res.data || res;
}

// ── Открытие проекта по ссылке из письма ─────────────────────────────────
// Ключ приходит query-параметром (?project=…): читаем, просим у сервера
// описание, применяем и открываем сразу шаг благоустройства — пользователь
// пришёл смотреть готовый проект, а не собирать его заново.
async function pioRestoreFromUrl() {
  const key = projectKeyFromUrl();
  if (!key) return false;
  let data = null;
  try { data = await loadProjectFromServer(key); }
  catch (e) { console.warn('[project] load failed', e); }
  if (!data) { console.warn('[project] проект не найден:', key); return false; }
  if (!applyProjectSnapshot(data)) { console.warn('[project] описание не распознано'); return false; }
  console.info('[project] проект восстановлен по ключу', key);
  // Дом грузится асинхронно; сцену собираем, когда дескриптор приедет.
  if (typeof resetCameraFraming === 'function') resetCameraFraming();
  if (typeof ensureHouseLoaded === 'function' && S.houseType) {
    try { await ensureHouseLoaded(); } catch (_) {}
  }
  if (typeof dGoTo === 'function') dGoTo(2);        // параметры дома — с полями этажей
  pioApplyPendingFloors();
  if (typeof dGoTo === 'function') dGoTo(3);
  if (typeof onParamChange === 'function') onParamChange();
  else if (typeof buildScene3d === 'function') buildScene3d();
  // Показываем проект ЦЕЛИКОМ: по умолчанию камера стоит вплотную к дому, и
  // забор с грядками оказываются за кадром. Вид тот же, что при открытии
  // раздела «по земле». Канвас появляется с задержкой (_dInit3dSlot), поэтому
  // пробуем дважды.
  const frame = () => {
    if (typeof e3dTopView !== 'function' || typeof threeState === 'undefined' || !threeState) return false;
    e3dTopView();
    return true;
  };
  setTimeout(() => { if (!frame()) setTimeout(frame, 600); }, 400);
  // Товары догружаем ПОСЛЕ первой сборки: сцена появляется сразу, а текстуры,
  // модели и характеристики приезжают следом и запускают пересборку. Ждать их до
  // показа нельзя — каталог отвечает не мгновенно.
  if (typeof dRestoreProducts === 'function') {
    try { await dRestoreProducts(_pioProductIds, _pioFurnitureIds); }
    catch (e) { console.warn('[project] товары не восстановились', e); }
  }
  return true;
}

if (typeof document !== 'undefined') {
  const start = () => { if (projectKeyFromUrl()) setTimeout(pioRestoreFromUrl, 400); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
