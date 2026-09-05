// NAV-DESKTOP.JS — desktop navigation, sidebar, panel, canvas editors
// Dependencies: state.js, canvas.js (init*), viewer3d-core.js

// ══════════════════════════════════════════════
// DESKTOP STATE
// ══════════════════════════════════════════════
let dStep = 1;
let dActiveItem = null;     // currently selected sidebar item id
const dConfigured = new Set(); // items that completed configuration

// All sidebar items.
// hidden: true — раздел есть в коде, но в меню не показывается. Так временно убрана
// «Отделка фасада» (TODO.md, этап 1 п.14): её редактор и расчёт ещё понадобятся,
// поэтому код остаётся на месте.
const D_SIDEBAR_ITEMS = [
  { id: 'terrace',       lbl: 'Терраса/Крыльцо',     hasEditor: true  },
  { id: 'railing',       lbl: 'Ограждения террасы',  hasEditor: true  },
  { id: 'steps',         lbl: 'Ступени',             hasEditor: true  },
  { id: 'paths',         lbl: 'Дорожки',             hasEditor: true  },
  { id: 'fence',         lbl: 'Забор',               hasEditor: true  },
  { id: 'facade',        lbl: 'Отделка фасада',      hasEditor: true },
  { id: 'beds',          lbl: 'Грядки',              hasEditor: true  },
  { id: 'furniture',     lbl: 'Садовая мебель',      hasEditor: true  },
  { id: 'pool_terrace',  lbl: 'Терраса у бассейна',  hasEditor: true  },
];
// Пункты, реально попадающие в меню (и в замер ширины левой панели).
const D_MENU_ITEMS = D_SIDEBAR_ITEMS.filter(i => !i.hidden);

// ══════════════════════════════════════════════
// SCREEN NAVIGATION
// ══════════════════════════════════════════════
function dGoTo(s) {
  const prev = document.getElementById('d-screen-' + dStep);
  if (prev) prev.classList.remove('active');

  dStep = s;
  const el = document.getElementById('d-screen-' + s);
  if (el) el.classList.add('active');

  // Режим фасада живёт только на шаге 3 — при уходе гасим (иначе клики по 3D
  // на шаге 2 продолжали бы тоглить сегменты).

  // Хедер убран; «СМЕТА» — плавающая кнопка (см. _dSyncSummaryBtn).
  _dSyncSummaryBtn();
  _dSyncSectionHint();          // подсказка раздела живёт только на шаге 3

  if (s === 1) { _dInitHouseGrid(); _dSyncSelectNext(); }
  else if (s === 2) _dInitParamsView();
  else if (s === 3) _dInitWorkspace();
}

// Ширина панелей и кегль заголовков. Считаем по РЕАЛЬНЫМ метрикам шрифта, а не
// константами: у Segoe UI и запасных шрифтов ширина одной и той же строки отличается
// на 10-15%, и в константу пришлось бы закладывать запас — панель осталась бы шире.
// Ширину задаёт САМАЯ ДЛИННАЯ СТРОКА МЕНЮ (подпись + кнопка «Изменить»): уже неё
// панель обрезала бы название элемента. Заголовки под эту ширину подбираются кеглем
// (правка 2026-09-03: раньше ширину диктовал заголовок 36-м кеглем, и панели были
// шире нужного, а интерфейс не влезал в 860 px по высоте).
const SIDEBAR_PAD = 20;          // отступ заголовка слева и справа (см. .d-sidebar-title)
const SIDEBAR_TITLES = ['Благоустройство', 'Параметры дома'];   // заголовки обеих левых панелей
const SB_ITEM_FZ = 15;           // кегль подписи пункта меню  (.d-sb-btn)
const SB_EDIT_FZ = 14;           // кегль кнопки «Изменить»    (.d-sb-edit)
const TITLE_FZ_MIN = 18, TITLE_FZ_MAX = 28;   // рамки кегля заголовков панелей
const PANEL_TITLE_RESERVE = 92;  // в правой панели: паддинги 2×16 + кнопка 32 + зазор 8 + запас
function _dSyncSidebarWidth() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;'
                      + 'font-size:36px;font-weight:400;';
  document.body.appendChild(probe);
  const widest = (list, size, weight) => {
    probe.style.fontSize = size + 'px'; probe.style.fontWeight = weight;
    let w = 0;
    for (const t of list) { probe.textContent = t; w = Math.max(w, probe.getBoundingClientRect().width); }
    return w;
  };
  // Строка меню: подпись SB_ITEM_FZ/700 (активный пункт жирнее) + паддинги кнопки 2×12
  // + рамки 2×2 + зазор 2px + кнопка «Изменить» + паддинг списка 2×8.
  const labelW = widest(D_MENU_ITEMS.map(i => i.lbl), SB_ITEM_FZ, 700);
  const editW = widest(['Изменить'], SB_EDIT_FZ, 600) + 24;
  const rowW = labelW + 24 + 4 + 2 + editW + 16;
  // Заголовки (левые панели и названия разделов в правой) при кегле 100 — по ним
  // подбирается их кегль под получившуюся ширину; зависимость линейная.
  const titleW100 = widest([...SIDEBAR_TITLES, ...D_MENU_ITEMS.map(i => i.lbl)], 100, 400);
  probe.remove();
  // Ширина не должна быть меньше той, в которой заголовок читается минимальным кеглем.
  const needLeft  = titleW100 * TITLE_FZ_MIN / 100 + 2 * SIDEBAR_PAD;
  const needRight = titleW100 * TITLE_FZ_MIN / 100 + PANEL_TITLE_RESERVE;
  const w = Math.ceil(Math.max(rowW, needLeft, needRight));
  document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  // Правая панель — ТОЙ ЖЕ ширины, что левая (требование продукта 2026-08-31).
  document.documentElement.style.setProperty('--panel-w', w + 'px');
  // ОДИН кегль на все заголовки — и левых панелей, и разделов в правой (требование
  // продукта 2026-09-03): самое длинное название должно вставать в строку в обеих.
  const avail = Math.min(w - 2 * SIDEBAR_PAD, w - PANEL_TITLE_RESERVE);
  const fz = Math.max(TITLE_FZ_MIN, Math.min(TITLE_FZ_MAX, Math.floor(100 * avail / titleW100)));
  document.documentElement.style.setProperty('--panel-title-fz', fz + 'px');
}

// Сразу рендерим сетку при загрузке (step 1 активен по умолчанию)
if (typeof document !== 'undefined') {
  const _initOnReady = () => {
    _dCacheToggleDefaults(); _dInitHouseGrid(); _dSyncSidebarWidth();
    // Шрифт мог ещё не загрузиться — пересчитываем, когда метрики окончательные.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(_dSyncSidebarWidth);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initOnReady);
  } else {
    _initOnReady();
  }
}

// ══════════════════════════════════════════════
// STEP 1 — House selection
// ══════════════════════════════════════════════
let _dHousesIndex = null; // кэш списка домов

// Загружает индекс домов и рендерит сетку (5 в ряд, вертикальный скролл).
async function _dInitHouseGrid() {
  const grid = document.getElementById('d-house-grid');
  if (!grid) return;
  if (grid.dataset.rendered === '1') return; // уже отрисовано
  try {
    // ?ts=Date.now() — жёсткий cache-bust против застрявшего в кэше старого index.json
    // (некоторые preview-режимы / file:// игнорируют cache:'no-store').
    const idx = await fetch('assets/houses/index.json?ts=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    _dHousesIndex = idx;
    grid.innerHTML = idx.houses.map(h => `
      <div class="d-house-card" data-typeid="${h.id}" onclick="dSelectHouseAndGo('${h.id}')">
        <div class="hcp">
          <div class="hc-ph">3D-превью</div>
        </div>
        <div class="hcl">${h.name}${h.subtitle ? `<span class="hcl-sub">${h.subtitle}</span>` : ''}</div>
      </div>
    `).join('');
    grid.dataset.rendered = '1';
    // Стартовое сообщение прогресс-каунтера
    const prog = document.getElementById('d-house-progress');
    if (prog) {
      prog.classList.remove('done');
      prog.textContent = `Готовим превью домов (0 / ${idx.houses.length})…`;
    }
    // Запускаем фоновый рендер 3D-превью (после небольшой задержки, чтобы UI успел отрисоваться)
    setTimeout(() => _dRenderHousePreviews().catch(e => console.warn('[house-preview]', e)), 100);
  } catch (e) {
    console.error('[house-grid] не удалось загрузить index.json:', e);
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#999;">Ошибка загрузки списка домов</div>';
  }
}

// Кэш отрендеренных превью (typeId → dataURL). Между переходами туда-сюда не пересчитываем.
const _dPreviewCache = {};

// Рендерит 3D-превью для всех домов из индекса. Использует ОДИН shared WebGL-рендерер,
// чтобы не упираться в лимит контекстов браузера. Снимок → JPEG dataURL → <img>.
async function _dRenderHousePreviews() {
  if (!_dHousesIndex || typeof THREE === 'undefined' || typeof HouseBuilder === 'undefined') return;
  const W = 240, H = 180;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false; // для скорости

  const prog = document.getElementById('d-house-progress');
  const total = _dHousesIndex.houses.length;
  let done = 0;
  const updateProg = () => {
    if (!prog) return;
    if (done >= total) {
      prog.textContent = '';
      prog.classList.add('done');
    } else {
      prog.textContent = `Готовим превью домов (${done} / ${total})…`;
    }
  };

  for (const h of _dHousesIndex.houses) {
    if (_dPreviewCache[h.id]) {
      _dApplyPreviewToCard(h.id, _dPreviewCache[h.id]);
      done++; updateProg();
      continue;
    }
    try {
      // Загрузка дескриптора + GLB-модулей. HTTP-кэш дедуплицирует общие модули между домами.
      const { desc, modules } = await HouseBuilder.loadHouseType(h.id);

      // Минимальная сцена для рендера
      const scene = new THREE.Scene();
      // Белый фон без земли: подписи карточки лежат поверх превью, и попадать они
      // должны на чистый белый, а не на газон.
      scene.background = new THREE.Color(0xffffff);
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.95);
      sun.position.set(10, 14, 8);
      scene.add(sun);

      const houseGroup = new THREE.Group();
      scene.add(houseGroup);

      // Параметры — берём дефолты из дескриптора
      const firstFloor = desc.floors[0];
      const areaDef   = firstFloor?.constraints?.area?.default   || 80;
      const floorHDef = firstFloor?.constraints?.floor_h?.default || 300;
      const baseHDef  = desc.constraints?.base_h?.default || 80;

      HouseBuilder.buildHouseFromDescriptor(houseGroup, desc, modules,
        { area: areaDef, floorH: floorHDef, baseH: baseHDef }, {}
      );

      // Iso-ракурс по bbox дома
      const bbox = new THREE.Box3().setFromObject(houseGroup);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const FOV = 32;
      const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 200);

      // Дом должен целиком уместиться в верхней части превью: снизу PREVIEW_LABEL_PX
      // занимает подпись карточки, туда попадать он не должен. Кадрируем по реальной
      // проекции bbox, а не по maxDim: у двухэтажных домов и Г-образных силуэтов
      // габарит по одной оси плохо предсказывает, сколько места дом займёт в кадре.
      const corners = [];
      for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(
        (i & 1) ? bbox.max.x : bbox.min.x,
        (i & 2) ? bbox.max.y : bbox.min.y,
        (i & 4) ? bbox.max.z : bbox.min.z));
      const PREVIEW_LABEL_PX = 60, PREVIEW_PAD_PX = 10;
      const bandW = W - 2 * PREVIEW_PAD_PX;
      const bandH = H - PREVIEW_LABEL_PX - PREVIEW_PAD_PX;
      const bandCx = W / 2;
      const bandCy = PREVIEW_PAD_PX + bandH / 2;

      // Три прохода: замерили проекцию → поправили дистанцию и точку прицела → повторили.
      const aim = center.clone();
      let dist = maxDim * 2;
      for (let pass = 0; pass < 3; pass++) {
        cam.position.set(aim.x + dist * 0.75, aim.y + dist * 0.55, aim.z + dist * 0.85);
        cam.lookAt(aim);
        cam.updateMatrixWorld(true);

        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of corners) {
          const p = c.clone().project(cam);
          const px = (p.x + 1) / 2 * W, py = (1 - p.y) / 2 * H;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px);
          y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }

        dist *= Math.max((y1 - y0) / bandH, (x1 - x0) / bandW);
        // Прицел сдвигаем в сторону, ПРОТИВОПОЛОЖНУЮ нужному сдвигу картинки:
        // камера смотрит выше — дом уезжает вниз, и наоборот.
        const visH = 2 * dist * Math.tan(FOV * Math.PI / 360);
        const visW = visH * (W / H);
        const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        aim.addScaledVector(up,    -((y0 + y1) / 2 - bandCy) / H * visH);
        aim.addScaledVector(right,  ((x0 + x1) / 2 - bandCx) / W * visW);
      }
      cam.position.set(aim.x + dist * 0.75, aim.y + dist * 0.55, aim.z + dist * 0.85);
      cam.lookAt(aim);

      renderer.render(scene, cam);
      const dataURL = renderer.domElement.toDataURL('image/jpeg', 0.82);
      _dPreviewCache[h.id] = dataURL;
      _dApplyPreviewToCard(h.id, dataURL);

      // Dispose геометрии и материалов сцены, чтобы освободить GPU-память
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => m && m.dispose());
        }
      });

      done++; updateProg();

      // Даём браузеру вдохнуть, чтобы UI не подвисал
      await new Promise(r => setTimeout(r, 0));
    } catch (e) {
      console.warn(`[preview] ${h.id}:`, e);
      done++; updateProg();
    }
  }
  renderer.dispose();
  done = total; updateProg();
}

function _dApplyPreviewToCard(typeId, dataURL) {
  const hcp = document.querySelector(`.d-house-card[data-typeid="${typeId}"] .hcp`);
  if (!hcp) return;
  hcp.innerHTML = `<img class="preview-img" src="${dataURL}" alt="">`;
}

// Полный сброс ВСЕХ настроек проекта: конструкции (терраса/крыльцо/дорожки/забор/
// грядки/…), материалы по элементам, смета, накопленные образцы, каталожные фильтры
// и UI-состояние. Вызывается при смене типа дома И при возврате в workspace с
// ИЗМЕНЁННЫМ контуром дома (площади — см. _dInitWorkspace): размещённое становится
// невалидным. Просто заглянуть на шаг 2 и вернуться — сброса НЕ вызывает.
// 3D-объекты удаляются при следующей пересборке сцены (buildScene3d чистит houseGroup).
function _dResetAllConfigurations() {
  S.sections = [];
  // Ключи те же, что в state.js: пропущенный ключ (например railing) обнулял бы
  // весь редактор — S.pts[name].push падал бы на undefined.
  S.pts = { paths: [], fence: [], railing: [] };
  for (const secId of Object.keys(RECT_SECTIONS)) {   // terrace, pool_terrace
    secRects(secId).length = 0;
    setSecActiveIdx(secId, null);
  }
  S.stepsList = [{ ...DEFAULT_STEPS_RECT }]; S.activeSteps = 0;
  S.beds = [];
  S.activeBed = null;
  S.bedH = 0.20;
  S.fenceH = FENCE_H;
  S.furniture = [];
  S.activeFurniture = null;
  S.wallZones = {};   // выбор сегментов фасада привязан к контуру дома
  S.mats = {};
  S.elementMat = {};
  S.estimate = {};
  S.catFilters = {};        // фильтры каталога у каждого раздела свои
  S.catSection = null;
  S.curSec = 0;
  dConfigured.clear();
  dActiveItem = null;
  // Тумблеры разделов возвращаем к значениям по умолчанию. Разметка панели
  // раздела рисуется динамически, поэтому DOM может быть пуст — источником
  // служит S.toggles (см. state.js).
  document.querySelectorAll('.tg').forEach(tg => {
    const isInitiallyOn = tg.dataset.initialOn === '1';
    tg.classList.toggle('on', isInitiallyOn);
    if (tg.dataset.id) S.toggles[tg.dataset.id] = isInitiallyOn;
  });
  // Ширина дорожки — к дефолту (S + инпут).
  S.pathWidth = 120;
  const pwInp = document.getElementById('v-paths-width');
  if (pwInp) pwInp.value = 120;
}

// Запоминаем стартовое состояние toggle'ов один раз при инициализации UI
// (чтобы _dResetAllConfigurations мог их вернуть к этим значениям).
function _dCacheToggleDefaults() {
  document.querySelectorAll('.tg').forEach(tg => {
    if (tg.dataset.initialOn === undefined) {
      tg.dataset.initialOn = tg.classList.contains('on') ? '1' : '0';
    }
    // Зеркалим стартовое состояние в S.toggles — 3D-слой читает тумблеры
    // только оттуда (tgOn в state.js), DOM из viewer3d-* не трогается.
    if (tg.dataset.id) S.toggles[tg.dataset.id] = tg.classList.contains('on');
  });
}

// «Дальше» на первом экране показываем, только если дом уже выбран: при первом
// заходе идти некуда, а на возврате повторный клик по карточке сбросил бы все
// настройки конструкций (см. _dResetAllConfigurations ниже).
function _dSyncSelectNext() {
  const box = document.getElementById('d-select-actions');
  if (box) box.classList.toggle('active', !!S.houseType);
}

function dSelectHouseAndGo(typeId) {
  // Новый дом — новая геометрия: разрешаем сцене снова выставить камеру.
  if (typeof resetCameraFraming === 'function') resetCameraFraming();
  document.querySelectorAll('.d-house-card, .d-house-card-empty').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.d-house-card[data-typeid="${typeId}"]`) ||
               document.querySelector(`.d-house-card-empty[data-typeid="${typeId}"]`);
  if (card) card.classList.add('selected');

  // S.houseType хранит typeId напрямую (например, "type_10") или 'no_house' («Пустой
  // участок»). Раньше для no_house писали null — он неотличим от «ещё не выбрано»,
  // а все проверки «без дома» (isEmptyLot в state.js) сравнивали с легаси-строкой.
  const newType = typeId;

  // Если тип дома МЕНЯЕТСЯ — сбрасываем все настройки конструкций (терраса/крыльцо/…),
  // потому что они привязаны к геометрии конкретного дома. При повторном выборе того же
  // типа — настройки сохраняются.
  if (S.houseType !== newType) {
    _dResetAllConfigurations();
  }
  S.houseType = newType;

  // Async preload дескриптора + GLB модулей
  if (typeof ensureHouseLoaded === 'function' && S.houseType) {
    ensureHouseLoaded().then(() => {
      if (typeof threeState !== 'undefined' && threeState) buildScene3d();
      if (dStep === 2) _dRenderFloorParams();
    }).catch(()=>{});
  }
  dGoTo(2);
}


// ══════════════════════════════════════════════
// STEP 2 — Parameters + 3D
// ══════════════════════════════════════════════
function _dInitParamsView() {
  // Мягкий сброс: раньше вход на шаг 2 обнулял проект БЕЗУСЛОВНО (даже «зашёл
  // посмотреть и вернулся»). Теперь сброс происходит при возврате в workspace и
  // только если контур дома реально изменился — см. _dParamsSig в _dInitWorkspace.
  // Перерендерим параметры по дескриптору (если уже загружен) или по дефолтам;
  // введённые значения при том же типе дома сохраняются (keepValues).
  _dRenderFloorParams();
  _dRenderHouseMaterials();
  _dSyncRanges();
  setTimeout(() => {
    const slot = document.getElementById('d-slot-params');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-params');
    else setTimeout(() => init3dCanvas('d-slot-params'), 100);
    // Первый экран с 3D — здесь же показываем, как этим видом управлять (TODO п.1).
    dShow3dHint();
  }, 80);
}

// Материалы дома (крыша/фундамент/стены/рамы) — квадратные образцы без подписей.
// Группы и их порядок берутся из HOUSE_MATERIALS; выбранное значение лежит в
// S['<kind>Mat'] (см. соглашение в state.js), поэтому новая группа материалов
// подхватывается здесь без правок.
function _dRenderHouseMaterials() {
  const host = document.getElementById('d-house-mats');
  if (!host || typeof HOUSE_MATERIALS === 'undefined') return;
  host.innerHTML = Object.keys(HOUSE_MATERIALS).map(kind => {
    const grp = HOUSE_MATERIALS[kind];
    const cur = S[kind + 'Mat'];
    const sw = grp.items.map(it => {
      const bg = it.img ? `background-image:url('${it.img}');background-size:cover;background-position:center;`
                        : `background:${it.color};`;
      const active = (cur === it.id) ? ' active' : '';
      return `<button class="d-hm-sw${active}" style="${bg}" onclick="dSetHouseMat('${kind}','${it.id}')" title="${it.id}"></button>`;
    }).join('');
    return `<div class="d-hm-group">
      <div class="d-hm-label">${grp.label}</div>
      <div class="d-hm-row">${sw}</div>
    </div>`;
  }).join('');
}

function dSetHouseMat(kind, id) {
  if (typeof HOUSE_MATERIALS === 'undefined' || !HOUSE_MATERIALS[kind]) return;
  S[kind + 'Mat'] = id;
  _dRenderHouseMaterials();
  if (typeof onParamChange === 'function') onParamChange(); // пересборка 3D (debounced)
}

// Рендерит per-floor контролы (высота этажа + площадь этажа) на основе дескриптора.
// Глобальный area-слайдер служит для синхронной установки площадей всех этажей.
// При повторном входе на шаг 2 с ТЕМ ЖЕ типом дома введённые значения сохраняются
// (keepValues); дефолты ставятся только после смены типа.
let _dFloorParamsType = null;   // тип дома, для которого параметры отрисованы

function _dRenderFloorParams() {
  const cont = document.getElementById('d-floors-params');
  if (!cont) return;
  const keepValues = (_dFloorParamsType === S.houseType);
  const prev = {};
  cont.querySelectorAll('input[id]').forEach(inp => { prev[inp.id] = inp.value; });
  const prevArea = document.getElementById('v-area')?.value;
  cont.innerHTML = '';
  // Возьмём дескриптор из кэша HouseBuilder (если уже загружен), иначе пропустим.
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (!desc) {
    // Дом без дескриптора (или ещё не загружен) — оставляем только глобальный area.
    return;
  }
  // Обновим диапазон глобального area по первому этажу (как опорному)
  const firstFloor = desc.floors && desc.floors[0];
  if (firstFloor && firstFloor.constraints && firstFloor.constraints.area) {
    const a = firstFloor.constraints.area;
    const aInp = document.getElementById('v-area'), aRng = document.getElementById('r-area');
    const hint = document.getElementById('d-area-range-hint');
    const aVal = (keepValues && prevArea) ? prevArea : a.default;
    if (aInp) { aInp.min = a.min; aInp.max = a.max; aInp.value = aVal; }
    if (aRng) { aRng.min = a.min; aRng.max = a.max; aRng.step = a.step || 5; aRng.value = aVal; }
    if (hint) hint.innerHTML = `<span>${a.min} кв.м</span><span>${a.max} кв.м</span>`;
  }
  // Per-floor: для каждого этажа — высота этажа + площадь этажа.
  desc.floors.forEach((floor, fi) => {
    const label = floor.label || `Этаж ${fi + 1}`;
    const aConstr = floor.constraints && floor.constraints.area;
    const hConstr = floor.constraints && floor.constraints.floor_h;
    // Если у этажа есть area_factor, дефолт площади = глобал × factor; иначе global default
    const factor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
    const aDefault = aConstr ? aConstr.default : Math.round((firstFloor?.constraints?.area?.default || 80) * factor);
    const hDefault = hConstr ? hConstr.default : 300;
    const aVal = (keepValues && prev[`v-area-${fi}`] !== undefined) ? prev[`v-area-${fi}`] : aDefault;
    const hVal = (keepValues && prev[`v-floor-${fi}`] !== undefined) ? prev[`v-floor-${fi}`] : hDefault;

    const wrap = document.createElement('div');
    wrap.className = 'd-param-group';
    wrap.style.borderTop = '1px solid #e0e0e0';
    wrap.style.paddingTop = '8px';
    const hMin = hConstr?.min ?? 270, hMax = hConstr?.max ?? 360;
    const aMin = aConstr?.min ?? 40,  aMax = aConstr?.max ?? 140;
    wrap.innerHTML = `
      <div class="d-floor-title">${label}</div>
      <div class="d-param-head">
        <span class="d-param-label">Высота этажа (см)</span>
        <input class="d-param-input" type="number" id="v-floor-${fi}" value="${hVal}" min="${hMin}" max="${hMax}"
               oninput="dOnFloorParam(${fi})">
      </div>
      <input class="d-param-range" type="range" id="r-floor-${fi}" value="${hVal}" min="${hMin}" max="${hMax}" step="${hConstr?.step ?? 10}"
             oninput="document.getElementById('v-floor-${fi}').value=this.value; dOnFloorParam(${fi})">
      <div class="d-param-unit"><span>${hMin} см</span><span>${hMax} см</span></div>
      <div class="d-param-head" style="margin-top:18px">
        <span class="d-param-label">Площадь этажа (кв.м)</span>
        <input class="d-param-input" type="number" id="v-area-${fi}" value="${aVal}" min="${aMin}" max="${aMax}"
               oninput="dOnFloorParam(${fi})">
      </div>
      <input class="d-param-range" type="range" id="r-area-${fi}" value="${aVal}" min="${aMin}" max="${aMax}" step="${aConstr?.step ?? 5}"
             oninput="document.getElementById('v-area-${fi}').value=this.value; dOnFloorParam(${fi})">
      <div class="d-param-unit"><span>${aMin} кв.м</span><span>${aMax} кв.м</span></div>
    `;
    cont.appendChild(wrap);
  });
  _dFloorParamsType = S.houseType;
  _dSyncAllRangeFills();
}

// ── Заливка слайдеров ──
// У нативного input[type=range] нет «пройденной» части дорожки, поэтому долю
// считаем сами и кладём в CSS-переменную --fill (см. .d-param-range в стилях).
// Значения меняются и программно (dOnAreaTotal, загрузка дескриптора), поэтому
// одного обработчика input мало — после таких правок зовём _dSyncAllRangeFills.
function _dSyncRangeFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max);
  const val = parseFloat(el.value);
  if (!isFinite(max) || !isFinite(val) || max <= min) { el.style.setProperty('--fill', '0%'); return; }
  const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
  el.style.setProperty('--fill', pct + '%');
}

function _dSyncAllRangeFills() {
  document.querySelectorAll('.d-param-range').forEach(_dSyncRangeFill);
}

document.addEventListener('input', e => {
  const el = e.target;
  if (el && el.classList && el.classList.contains('d-param-range')) _dSyncRangeFill(el);
  // Значение можно править и в поле рядом — тогда двигается связанный слайдер.
  if (el && el.classList && el.classList.contains('d-param-input')) _dSyncAllRangeFills();
});
document.addEventListener('DOMContentLoaded', _dSyncAllRangeFills);

// Изменение глобального area: распространяется на все этажи по их area_factor.
function dOnAreaTotal() {
  const aEl = document.getElementById('v-area'), rEl = document.getElementById('r-area');
  if (aEl && rEl) rEl.value = aEl.value;
  const total = parseFloat(aEl.value);
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (desc) {
    desc.floors.forEach((floor, fi) => {
      const factor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
      const target = Math.round(total * factor);
      const aInp = document.getElementById(`v-area-${fi}`);
      const aRng = document.getElementById(`r-area-${fi}`);
      if (aInp) aInp.value = target;
      if (aRng) aRng.value = target;
    });
  }
  if (typeof onParamChange === 'function') onParamChange();
}

// Изменение per-floor параметра. Синхронизируем глобальную «Общая площадь дома» с
// площадью 1-го этажа (контур дома считается от неё) — иначе размеры меняются, а поле нет.
function dOnFloorParam(fi) {
  ['v-floor', 'v-area'].forEach(prefix => {
    const inp = document.getElementById(`${prefix}-${fi}`);
    const rng = document.getElementById(`r${prefix.slice(1)}-${fi}`);
    if (inp && rng) rng.value = inp.value;
  });
  _dSyncGlobalAreaFromFloors();
  if (typeof onParamChange === 'function') onParamChange();
}

// «Общая площадь дома» = площадь 1-го этажа / area_factor[0] (база, по которой
// getHouseFloorPolygon строит контур). Держим поле в синхроне при ручной правке этажа.
function _dSyncGlobalAreaFromFloors() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (!desc || !desc.floors || !desc.floors[0]) return;
  const factor0 = (desc.floors[0].area_factor !== undefined) ? desc.floors[0].area_factor : 1.0;
  const a0 = parseFloat(document.getElementById('v-area-0')?.value);
  const aEl = document.getElementById('v-area'), rEl = document.getElementById('r-area');
  if (isNaN(a0) || !factor0 || !aEl) return;
  let base = Math.round(a0 / factor0);
  const mn = parseFloat(aEl.min), mx = parseFloat(aEl.max);
  if (!isNaN(mn)) base = Math.max(base, mn);
  if (!isNaN(mx)) base = Math.min(base, mx);
  aEl.value = base;
  if (rEl) rEl.value = base;
}

function dOnParam() {
  _dSyncRanges();
  if (typeof onParamChange === 'function') onParamChange();
}

// Ширина дорожки: инпут зеркалится в S.pathWidth (см), затем обновляем превью
// в canvas-редакторе и пересобираем 3D. Canvas и 3D читают только S.pathWidth.
function dOnPathWidth() {
  const v = parseFloat(document.getElementById('v-paths-width')?.value);
  if (!isNaN(v) && v > 0) S.pathWidth = v;
  // Поле и слайдер — два вида одного значения, держим их синхронными.
  const rng = document.getElementById('r-paths-width');
  if (rng && !isNaN(v) && String(v) !== rng.value) { rng.value = v; _dSyncRangeFill(rng); }
  if (typeof drawSnapCanvas === 'function') drawSnapCanvas('paths');
  if (typeof onParamChange === 'function') onParamChange();
}

// Высота настила террасы, см. Диапазон — 15 см … высота фундамента (TODO.md, этап 1
// п.2): выше фундамента настил лезет на цоколь, ниже 15 см его не собрать.
const TERRACE_MIN_CM = 15;
function dTerraceHeightRange() {
  const foundCm = parseFloat(document.getElementById('v-found')?.value || 80);
  return { min: TERRACE_MIN_CM, max: Math.max(TERRACE_MIN_CM, Math.round(foundCm)) };
}

function dSetTerraceHeight(cm) {
  const { min, max } = dTerraceHeightRange();
  const v = Math.min(max, Math.max(min, parseFloat(cm) || min));
  S.terraceH = v / 100;
  // Поле и слайдер — два вида одного значения, держим их синхронными.
  const inp = document.getElementById('v-terrace-h');
  if (inp && String(v) !== inp.value) inp.value = v;
  const rng = document.getElementById('r-terrace-h');
  if (rng && String(v) !== rng.value) rng.value = v;
  if (rng) _dSyncRangeFill(rng);
  if (typeof onParamChange === 'function') onParamChange();
}

// Подтянуть поле к состоянию (открытие редактора, смена высоты фундамента).
function _dSyncTerraceHeight() {
  const inp = document.getElementById('v-terrace-h');
  const rng = document.getElementById('r-terrace-h');
  const hint = document.getElementById('d-terrace-h-hint');
  if (!inp) return;
  // Потолок зависит от высоты фундамента, поэтому диапазон и границы под
  // слайдером пересчитываются при каждом открытии редактора.
  const { min, max } = dTerraceHeightRange();
  inp.min = min; inp.max = max;
  const cur = (typeof S.terraceH === 'number') ? Math.round(S.terraceH * 100) : max;
  const v = Math.min(max, Math.max(min, cur));
  inp.value = v;
  if (rng) { rng.min = min; rng.max = max; rng.value = v; _dSyncRangeFill(rng); }
  S.terraceH = v / 100;
  if (hint) hint.innerHTML = `<span>${min} см</span><span>${max} см</span>`;
}

// Высота забора одна (FENCE_H = 1920 мм, правка 2026-08-30): выбор высоты убран,
// кнопок больше нет. Функции оставлены пустыми заглушками — их зовут старые
// обработчики и сброс редактора.
function dSetFenceHeight() { S.fenceH = FENCE_H; }
function _dSyncFenceHeight() {}

function _dSyncRanges() {
  // Глобальные слайдеры
  [['v-area','r-area'],['v-found','r-found']].forEach(([inp,rng]) => {
    const iEl = document.getElementById(inp), rEl = document.getElementById(rng);
    if (iEl && rEl) rEl.value = iEl.value;
  });
}

// Собирает все параметры для HouseBuilder (используется из viewer3d-core.js).
function dCollectParams() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const baseH = parseFloat(document.getElementById('v-found')?.value || 80);
  const areaTotal = parseFloat(document.getElementById('v-area')?.value || 80);
  const floorAreas = [], floorHs = [];
  if (desc) {
    desc.floors.forEach((floor, fi) => {
      const a = parseFloat(document.getElementById(`v-area-${fi}`)?.value);
      const h = parseFloat(document.getElementById(`v-floor-${fi}`)?.value);
      if (!isNaN(a)) floorAreas.push(a); else floorAreas.push(areaTotal * (floor.area_factor || 1.0));
      if (!isNaN(h)) floorHs.push(h); else floorHs.push(300);
    });
  }
  return {
    area:    areaTotal,
    floorH:  floorHs[0] || 300, // для совместимости со старым API
    baseH:   baseH,
    floorAreas,
    floorHs,
  };
}

// ══════════════════════════════════════════════
// STEP 3 — Workspace
// ══════════════════════════════════════════════
// Сигнатура параметров, определяющих КОНТУР дома (площади), на момент последнего
// входа в workspace. Высота этажа/фундамента контур не меняют — их правка проект
// не сбрасывает (3D пересобирается сам).
let _dParamsSig = null;

function _dParamsSignature() {
  const c = (typeof dCollectParams === 'function') ? dCollectParams() : null;
  return c ? JSON.stringify({ houseType: S.houseType, area: c.area, floorAreas: c.floorAreas }) : null;
}

function _dInitWorkspace() {
  // Мягкий сброс: проект обнуляется только если контур дома изменился с прошлого
  // входа в workspace (площади / тип). «Сходил на шаг 2 посмотреть и вернулся» —
  // ничего не трогает.
  const sig = _dParamsSignature();
  if (_dParamsSig !== null && sig !== _dParamsSig) _dResetAllConfigurations();
  _dParamsSig = sig;

  dActiveItem = null;
  if (typeof e3dSetSection === 'function') e3dSetSection(null);
  _dSyncSectionHint();
  _dRenderSidebar();
  _dSetPanelLocked(true); // Panel locked until an item is selected

  setTimeout(() => {
    const slot = document.getElementById('d-slot-workspace');
    if (slot && slot.offsetWidth > 0) init3dCanvas('d-slot-workspace');
    else setTimeout(() => init3dCanvas('d-slot-workspace'), 100);
  }, 80);
}

// ── ПАНЕЛЬ АКТИВНОГО РАЗДЕЛА (версия 3D-UI) ──
//
// 2D-редактор убран: разметка идёт прямо в сцене (editor3d.js), а под кнопкой
// активного раздела раскрываются его параметры и действия. Кнопок «Изменить» и
// «Дальше» больше нет — раздел активен, значит его можно одновременно
// редактировать в сцене и назначать ему товар в правой панели.
//
// Раньше DOM-узлы переносились из футера канвас-редактора и возвращались
// обратно; теперь разметка описана здесь одной таблицей.
//   params  — HTML параметров (слайдеры, тумблеры). Идентификаторы полей
//             сохранены: на них завязаны _dSyncTerraceHeight, dOnPathWidth, tgOn.
//   actions — кнопки под параметрами; sel:true — кнопка работает только когда
//             в сцене что-то выбрано (её включает _dSyncSectionActions).

const D_TERRACE_H_PARAM = `
  <div class="d-param-group">
    <div class="d-param-head">
      <span class="d-param-label">Высота настила, см.</span>
      <input class="d-param-input" type="number" id="v-terrace-h" min="15" step="5"
             oninput="dSetTerraceHeight(this.value)">
    </div>
    <input class="d-param-range" type="range" id="r-terrace-h" min="15" step="5"
           oninput="dSetTerraceHeight(this.value)">
    <div class="d-param-unit" id="d-terrace-h-hint"><span>15 см</span><span>80 см</span></div>
  </div>`;

const D_SECTION_UI = {
  terrace: {
    params: D_TERRACE_H_PARAM,
    actions: [
      { lbl: 'Ещё одна',          fn: "addRect('terrace')" },
      { lbl: 'Удалить выбранную', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',       fn: "dResetSection('terrace')" },
    ],
  },
  pool_terrace: {
    actions: [
      { lbl: 'Ещё одна',          fn: "addRect('pool_terrace')" },
      { lbl: 'Бассейн ▭',         fn: "dSetPool('rect')" },
      { lbl: 'Бассейн ○',         fn: "dSetPool('round')" },
      { lbl: 'Удалить выбранную', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',       fn: "dResetSection('pool_terrace')" },
    ],
  },
  steps: {
    params: `<div class="tg" onclick="ttg(this)" data-id="steps-railing"><span class="tg-txt">Перила лестницы</span><div class="tg-ind"></div></div>`,
    actions: [
      { lbl: 'Ещё одна',          fn: 'addSteps()' },
      { lbl: 'Удалить выбранную', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',       fn: "dResetSection('steps')" },
    ],
  },
  beds: {
    // Специфические фильтры каталога живут в панели раздела, рядом с его
    // настройками (ТЗ п. 8); цвет и цена — в правой панели (п. 7).
    params: `
      <div class="d-color-section">
        <div class="d-color-title">Высота борта:</div>
        <div class="d-price-grid" id="d-bed-h-grid"></div>
      </div>
      <div class="d-color-section">
        <div class="d-color-title">Крепёж:</div>
        <div class="d-price-grid" id="d-bed-mount-grid"></div>
      </div>`,
    actions: [
      { lbl: 'Ещё одна',          fn: 'addBed()' },
      { lbl: 'Удалить выбранную', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',       fn: "dResetSection('beds')" },
    ],
  },
  paths: {
    params: `
      <div class="d-param-group">
        <div class="d-param-head">
          <span class="d-param-label">Ширина дорожки, см.</span>
          <input class="d-param-input" type="number" id="v-paths-width" value="120" min="60" max="300"
                 oninput="dOnPathWidth()">
        </div>
        <input class="d-param-range" type="range" id="r-paths-width" value="120" min="60" max="300" step="10"
               oninput="document.getElementById('v-paths-width').value=this.value; dOnPathWidth()">
        <div class="d-param-unit"><span>60 см</span><span>300 см</span></div>
      </div>`,
    actions: [
      { lbl: 'Удалить точку', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',   fn: "dResetSection('paths')" },
    ],
  },
  fence: {
    // Высота полотна одна — 1920 мм (правка 2026-08-30), подпись справочная.
    params: `<div class="d-param-note">Высота забора: 1920 мм</div>`,
    actions: [
      { lbl: 'Калитка',       fn: 'dFenceGate()' },
      { lbl: 'Удалить точку', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',   fn: "dResetSection('fence')" },
    ],
  },
  railing: {
    params: `
      <div class="d-color-section">
        <div class="d-color-title">Крышка столба:</div>
        <div class="d-price-grid" id="d-rail-cap-grid"></div>
      </div>
      <div class="d-color-section">
        <div class="d-color-title">Сечение столба:</div>
        <div class="d-price-grid" id="d-rail-post-grid"></div>
      </div>`,
    actions: [
      { lbl: 'Обозначить вход', fn: 'dRailingEntry()' },
      { lbl: 'Удалить всё',     fn: "dResetSection('railing')" },
    ],
  },
  furniture: {
    actions: [
      { lbl: 'Удалить выбранную', fn: 'dDeleteSelected()', sel: true },
      { lbl: 'Удалить всё',       fn: "dResetSection('furniture')" },
    ],
  },
  facade: {
    actions: [
      { lbl: 'Сбросить',    fn: 'dFacadeClear()' },
      { lbl: 'Удалить всё', fn: "dResetSection('facade')" },
    ],
  },
};

function _dSectionUiHtml(secId) {
  const cfg = D_SECTION_UI[secId];
  if (!cfg) return '';
  const params = cfg.params || '';
  const actions = (cfg.actions || []).map(a =>
    `<button class="d-canvas-btn${a.sel ? ' needs-sel' : ''}" onclick="${a.fn}">${a.lbl}</button>`).join('');
  return `<div class="d-sb-accordion" id="d-sb-accordion">${params}
            <div class="d-canvas-actions">${actions}</div>
          </div>`;
}

// Кнопки «Удалить выбранную / Удалить точку» имеют смысл только при выборе в
// сцене. Дёргается из editor3d при каждом выборе — перерисовывать всю панель
// ради одного состояния кнопки незачем.
function _dSyncSectionActions() {
  const has = (typeof e3dSelectedIdx === 'function') && e3dSelectedIdx() !== null;
  document.querySelectorAll('#d-sb-accordion .needs-sel').forEach(b => { b.disabled = !has; });
}

// Удалить выбранный в сцене объект активного раздела. Одна кнопка на все
// разделы: что именно удалять, знает сам раздел.
function dDeleteSelected() {
  const sec = dActiveItem;
  if (!sec) return;
  if (sec === 'terrace' || sec === 'pool_terrace') delActiveRect(sec);
  else if (sec === 'steps')     delActiveSteps();
  else if (sec === 'beds')      delActiveBed();
  else if (sec === 'furniture') delActiveFurniture();
  else if (S.pts && S.pts[sec]) delLinePoint(sec);
  if (typeof onParamChange === 'function') onParamChange();   // delActiveBed сцену не трогает
  if (typeof e3dSync === 'function') e3dSync();
  _dSyncSectionActions();
}

// Раздел, который нельзя открыть, пока не сделано что-то другое. Возвращает
// причину (она же подсказка на кнопке) или '' — ограничений нет.
// Ограждение строится по периметру террасы (railingAutoPoints): без террасы строить
// нечего, раздел был бы пустым (TODO п.4).
function _dSectionBlockedBy(secId) {
  if (secId !== 'railing') return '';
  const hasTerrace = (typeof secRects === 'function')
    && secRects('terrace').some(r => r && r.w > 0 && r.h > 0)
    && S.sections.includes('terrace');
  return hasTerrace ? '' : 'Сначала разметьте террасу — ограждение идёт по её периметру';
}

function _dRenderSidebar() {
  const list = document.getElementById('d-sidebar-list');
  list.innerHTML = D_MENU_ITEMS.map(item => {
    const isActive = dActiveItem === item.id;
    const isCfg = dConfigured.has(item.id);
    // Раздел без выполненного условия (ограждение без террасы) не открывается.
    const needs = _dSectionBlockedBy(item.id);
    // Пока какой-то раздел открыт, остальные приглушаем — так открытый заметнее.
    // Кликабельными они остаются: переключаться между разделами можно свободно,
    // подтверждать («Дальше») больше нечего.
    const isDimmed = !!dActiveItem && !isActive && !needs;
    return `
      <div class="d-sb-row">
        <div class="d-sb-main">
          <button class="d-sb-btn ${isActive ? 'active' : ''} ${isCfg ? 'configured' : ''} ${needs ? 'locked' : ''} ${isDimmed ? 'dimmed' : ''}"
                  data-id="${item.id}"
                  onclick="dClickItem('${item.id}')"
                  ${needs ? `title="${needs}"` : ''}
                  ${needs ? 'disabled' : ''}>
            ${item.lbl}
          </button>
          ${isActive ? _dSectionUiHtml(item.id) : ''}
        </div>
      </div>`;
  }).join('');

  _dSyncSectionActions();
  _dSyncAllRangeFills();
  // Специфические фильтры живут в блоке раздела — наполняем сразу после того,
  // как разметка панели создана заново.
  _dRenderRailFilters();
  _dRenderBedFilters();
  // Поля параметров рисуются заново — вернуть в них значения из состояния.
  if (dActiveItem === 'terrace') _dSyncTerraceHeight();
  if (dActiveItem === 'paths') {
    const v = document.getElementById('v-paths-width'), r = document.getElementById('r-paths-width');
    if (v) v.value = S.pathWidth;
    if (r) { r.value = S.pathWidth; _dSyncRangeFill(r); }
  }
  // Тумблеры рисуются из S.toggles: DOM здесь вторичен (см. tgOn).
  document.querySelectorAll('#d-sb-accordion .tg').forEach(tg => {
    if (tg.dataset.id) tg.classList.toggle('on', !!S.toggles[tg.dataset.id]);
  });

  // «Назад» — выход к параметрам дома. Подтверждать разделы больше не нужно,
  // поэтому кнопка видна всегда.
  const backBtn = document.querySelector('.d-sidebar-actions .d-btn-back');
  if (backBtn) {
    backBtn.classList.remove('hidden');
    backBtn.textContent = '← К параметрам дома';
  }

  // Правую панель материалов показываем только когда выбран элемент проекта.
  const panel = document.getElementById('d-panel');
  if (panel) panel.classList.toggle('hidden', !dActiveItem);

  // Открытый раздел «всплывает»: вместе с параметрами ряд становится высоким и
  // у нижних пунктов уезжает за край панели. Прокручиваем список так, чтобы ряд
  // был виден целиком.
  if (dActiveItem) {
    const row = list.querySelector('.d-sb-btn[data-id="' + dActiveItem + '"]');
    const box = row && row.closest('.d-sb-row');
    if (box) requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest' }));
  }
}

// ══════════════════════════════════════════════
// ОТДЕЛКА ФАСАДА — выбор кликом по самим стенам в 3D (editor3d.js, kind
// 'facade'): мультивыбор, повторный клик снимает, доступны все этажи. Раньше
// выбор шёл на плане и только по первому этажу. Кнопки «выбрать всё» нет —
// по ТЗ она не нужна.
// ══════════════════════════════════════════════

// «Сбросить» — снять отделку со всех сегментов.
function dFacadeClear() {
  S.wallZones = {};
  if (typeof _applyFacadeSelection === 'function') _applyFacadeSelection();
  if (typeof e3dSync === 'function') e3dSync();
}

// ── Delete (×) button — сбросить настройки конкретной позиции ──
function dDeleteItem(secId) {
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  const label = item ? item.lbl : secId;
  if (!window.confirm(`Удалить настройки «${label}»?`)) return;

  // Чистим данные позиции
  if (S.pts && S.pts[secId]) S.pts[secId] = [];
  if (RECT_SECTIONS[secId]) { secRects(secId).length = 0; setSecActiveIdx(secId, null); }
  if (secId === 'steps')   { S.stepsList = [{ ...DEFAULT_STEPS_RECT }]; S.activeSteps = 0; }
  if (secId === 'beds')    { S.beds = []; S.activeBed = null; }
  if (secId === 'facade')  { S.wallZones = {}; }
  if (secId === 'furniture') { S.furniture = []; S.activeFurniture = null; }
  S.sections = S.sections.filter(s => s !== secId);
  if (S.mats && S.mats[secId]) delete S.mats[secId];
  if (S.elementMat && S.elementMat[secId]) delete S.elementMat[secId];
  if (S.estimate && S.estimate[secId]) delete S.estimate[secId];
  dConfigured.delete(secId);

  // Если удаляемая позиция активна — сбрасываем активность
  if (dActiveItem === secId) {
    dActiveItem = null;
  }

  _dRenderSidebar();
  _dSetPanelLocked(false);
  _dRenderPanelContent();

  // Перестроить 3D
  if (typeof buildScene3d === 'function') {
    setTimeout(() => init3dCanvas('d-slot-workspace'), 50);
  }
}

// ── Фильтры грядок: высота борта и крепёж (TODO.md, этап 2 п.11) ──
// Высота борта применяется сразу к 3D (S.bedH); тип крепежа своего поля у товара
// не имеет — отбор по названию, как у крышки столба ограждения.
// Оба фильтра — МУЛЬТИВЫБОР (TODO п.15): в S.bedFilters лежат массивы значений,
// пустой массив = фильтр не задан. Это фильтры КАТАЛОГА: на 3D они не влияют —
// до выбора товара грядка обозначается местом, после рисуется по товару.
function _bedFilterList(kind) {
  const v = S.bedFilters ? S.bedFilters[kind] : null;
  return Array.isArray(v) ? v : (v == null ? [] : [v]);
}

function _dRenderBedFilters() {
  const hg = document.getElementById('d-bed-h-grid');
  if (hg) {
    const on = _bedFilterList('h');
    hg.innerHTML = BED_HEIGHTS.map(h =>
      `<button class="d-price-btn ${on.includes(h) ? 'selected' : ''}"
               onclick="dSetBedFilter('h', ${h})">
         <span class="d-radio"></span><span class="d-price-txt">${h} мм</span>
       </button>`).join('');
  }
  const mg = document.getElementById('d-bed-mount-grid');
  if (mg) {
    const on = _bedFilterList('mount');
    mg.innerHTML = BED_MOUNTS.map(m =>
      `<button class="d-price-btn ${on.includes(m.id) ? 'selected' : ''}"
               onclick="dSetBedFilter('mount', '${m.id}')">
         <span class="d-radio"></span><span class="d-price-txt">${m.lbl}</span>
       </button>`).join('');
  }
}

// Повторный клик снимает своё значение, остальные выбранные остаются.
// Фильтр только ОТБИРАЕТ КАТАЛОГ и на 3D напрямую не влияет: до выбора товара
// грядка обозначается местом, после — рисуется по товару (высота борта берётся
// из него, см. _bedHeightFromProduct).
function dSetBedFilter(kind, value) {
  const list = _bedFilterList(kind);
  S.bedFilters[kind] = list.includes(value)
    ? list.filter(v => v !== value)
    : list.concat([value]);
  _dRenderBedFilters();
  dShowResults();
}

// Крепёж грядки по характеристике каталога components.corner_bracket.type
// ('metal' | 'plastic_joint' | 'plastic_angle' — три значения с 2026-08-27, шарнир
// и угол различимы). Нет характеристики — отбор по названию, как раньше.
function _bedMountMatches(product, mount) {
  const prop = (typeof productProp === 'function') ? productProp(product, PROP_BED_BRACKET) : undefined;
  if (typeof prop === 'string' && prop) return String(prop).toLowerCase() === mount.prop;
  return mount.re.test((product.name || '') + ' ' + (product.previewText || ''));
}

// Отбор товаров грядок по фильтрам: высота борта и тип крепежа. При мультивыборе
// товар подходит, если совпало ЛЮБОЕ из выбранных значений.
function _bedFilterProducts(products) {
  if (dActiveItem !== 'beds') return products;
  let out = products;
  const hs = _bedFilterList('h');
  if (hs.length) {
    const hit = out.filter(p => {
      const h = _bedHeightFromProduct(p);
      return h !== null && hs.includes(Math.round(h * 1000));
    });
    if (hit.length) out = hit;
    else console.info('[beds] по высоте борта ' + hs.join('/') + ' мм товаров не нашлось —',
                      'показываем все: высота распознаётся по названию товара');
  }
  const on = _bedFilterList('mount');
  if (!on.length) return out;
  const mounts = BED_MOUNTS.filter(x => on.includes(x.id));
  if (!mounts.length) return out;
  const hit = out.filter(p => mounts.some(m => _bedMountMatches(p, m)));
  if (hit.length) return hit;
  console.info('[beds] по фильтру «' + mounts.map(m => m.lbl).join(', ') +
               '» товаров не нашлось — показываем все:',
               'у товаров нет поля с типом крепежа, отбор идёт по названию');
  return out;
}

// ── Фильтры ограждения: крышка столба и его сечение (TODO.md, этап 2 п.5) ──
// Оба — ФИЛЬТРЫ КАТАЛОГА с мультивыбором (TODO п.1), на 3D напрямую не влияют:
// до выбора товара ограждение серое, после — рисуется по товару (сечение столба
// берётся из его названия, см. _railPostWFromProduct). Своих полей под крышку и
// сечение у товара нет, поэтому ищем слова в названии/описании; если под фильтр
// не подходит НИ ОДИН товар раздела, фильтр не применяется — иначе каталог просто
// опустел бы на данных, где этих слов нет.
function _railFilterList(kind) {
  const v = S.railFilters ? S.railFilters[kind] : null;
  return Array.isArray(v) ? v : (v == null ? [] : [v]);
}

function _dRenderRailFilters() {
  const cap = document.getElementById('d-rail-cap-grid');
  if (cap) {
    const on = _railFilterList('cap');
    cap.innerHTML = RAIL_CAP_TYPES.map(t =>
      `<button class="d-price-btn ${on.includes(t.id) ? 'selected' : ''}"
               onclick="dSetRailFilter('cap', '${t.id}')">
         <span class="d-radio"></span><span class="d-price-txt">${t.lbl}</span>
       </button>`).join('');
  }
  const post = document.getElementById('d-rail-post-grid');
  if (post) {
    const on = _railFilterList('postW');
    post.innerHTML = RAIL_POST_WIDTHS.map(w =>
      `<button class="d-price-btn ${on.includes(w) ? 'selected' : ''}"
               onclick="dSetRailFilter('postW', ${w})">
         <span class="d-radio"></span><span class="d-price-txt">${w} мм</span>
       </button>`).join('');
  }
}

// Повторный клик снимает своё значение, остальные выбранные остаются.
function dSetRailFilter(kind, value) {
  const list = _railFilterList(kind);
  S.railFilters[kind] = list.includes(value)
    ? list.filter(v => v !== value)
    : list.concat([value]);
  _dRenderRailFilters();
  dShowResults();
}

// Сечение столба товара (100/125 мм): сначала характеристика каталога
// (components.post.dimensions.width), потом название; не распознали — null.
function _railPostWFromProduct(sample) {
  if (sample && typeof sample.postWidthMm === 'number') return sample.postWidthMm;
  const prop = (typeof productProp === 'function') ? productProp(sample, PROP_RAIL_POST_W) : undefined;
  const pv = parseFloat(prop);
  if (!isNaN(pv) && RAIL_POST_WIDTHS.includes(Math.round(pv))) return Math.round(pv);
  const text = [sample && sample.name, sample && sample.previewText].filter(Boolean).join(' ');
  // Как и у высоты борта грядки: `\b` после «мм» не работает — кириллица в
  // ASCII-семантике не словесный символ, конец слова проверяем явно.
  const re = new RegExp(
    `(?:^|[^\\d])(${RAIL_POST_WIDTHS.join('|')})\\s*(?:мм|mm)(?![а-яёa-z0-9])`, 'i');
  const m = re.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

// Отбор товаров ограждения по виду крышки и сечению столба. При мультивыборе
// товар подходит, если совпало ЛЮБОЕ из выбранных значений. Пустой результат
// означает, что в данных нет таких слов — тогда фильтр игнорируем и пишем в консоль.
function _railingFilterProducts(products) {
  if (dActiveItem !== 'railing') return products;
  let out = products;
  const ws = _railFilterList('postW');
  if (ws.length) {
    const hit = out.filter(p => ws.includes(_railPostWFromProduct(p)));
    if (hit.length) out = hit;
    else console.info('[railing] по сечению столба ' + ws.join('/') + ' мм товаров не нашлось —',
                      'показываем все: сечение распознаётся по названию товара');
  }
  const on = _railFilterList('cap');
  if (!on.length) return out;
  const caps = RAIL_CAP_TYPES.filter(x => on.includes(x.id));
  if (!caps.length) return out;
  const hit = out.filter(p => caps.some(t => _railCapMatches(p, t)));
  if (hit.length) return hit;
  console.info('[railing] по фильтру «' + caps.map(t => t.lbl).join(', ') +
               '» товаров не нашлось — показываем все:',
               'вид крышки не распознан ни по характеристике, ни по названию');
  return out;
}

// Вид крышки столба у товара: характеристика каталога (components.post_cap.type),
// иначе имя назначенного товару GLB (mod_railing_dpk/metal/plastic), иначе слово
// в названии.
// Название учитывается, только если в нём вообще говорится о крышке: слово «ДПК»
// в «Ограждение из ДПК …» относится к материалу ограждения, а не к крышке.
function _railCapMatches(product, capType) {
  const prop = (typeof productProp === 'function') ? productProp(product, PROP_RAIL_CAP) : undefined;
  if (typeof prop === 'string' && prop) return String(prop).toLowerCase() === capType.id;
  const m = /mod_railing_(dpk|metal|plastic)\b/i.exec(product.modelUrl || '');
  if (m) return m[1].toLowerCase() === capType.id;
  const txt = (product.name || '') + ' ' + (product.previewText || '');
  return /крышк|колпач|колпак|cap/i.test(txt) && capType.re.test(txt);
}

// ── Короткое сообщение поверх рабочей области ──
// Редакторы объясняют им отказ: «точка ближе 3 м», «сначала выберите точку» и т.п.
// Функция вызывалась из canvas.js и отсюда, но НИГДЕ не была определена: часть
// вызовов молча гасилась проверкой `typeof dToast === 'function'`, а три вызова
// (бассейн, калитка, вход в ограждении) падали с ReferenceError.
let _dToastTimer = null;
function dToast(msg) {
  let el = document.getElementById('d-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'd-toast';
    el.className = 'd-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_dToastTimer);
  _dToastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Бассейн на террасе у бассейна (TODO.md, этап 2 п.14) ──
// Кнопка ставит бассейн выбранной формы; повторное нажатие той же формы убирает,
// другой — меняет форму, сохраняя место и размер. Модели нет: это геометрия с
// задаваемыми на плане размерами.
function dSetPool(kind) {
  if (S.pool && S.pool.kind === kind) {
    S.pool = null;
  } else if (S.pool) {
    S.pool = { ...S.pool, kind };
    if (kind === 'round') { const s = Math.max(S.pool.w, S.pool.h); S.pool.w = s; S.pool.h = s; }
  } else {
    if (!secRects('pool_terrace').length) { dToast('Сначала разметьте террасу у бассейна'); return; }
    S.pool = poolDefault(kind);
  }
  if (typeof drawRectCanvas === 'function') drawRectCanvas('pool_terrace');
  if (typeof onParamChange === 'function') onParamChange();
}

// ── «Калитка» в заборе (TODO.md, этап 2 п.8) ──
// Логика как у входа в ограждении: место фиксированной ширины 1 м. Повторное
// нажатие калитку убирает. Отдельной модели калитки пока нет: в 3D створка строится
// секцией забора той же ширины (просвета нет, см. _fenceGateLeaf), а в смету уходит
// gateCount = 1 — длина забора при этом считается по всей разметке, без вычета.
function dFenceGate() {
  if (S.fenceGate) {
    S.fenceGate = null;
  } else {
    const g = (typeof fenceGateDefault === 'function') ? fenceGateDefault() : null;
    if (!g) { dToast('Нужен участок забора длиннее 1.4 м — калитке нужно место'); return; }
    S.fenceGate = g;
  }
  if (typeof drawSnapCanvas === 'function') drawSnapCanvas('fence');
  if (typeof onParamChange === 'function') onParamChange();
}

// ── «Обозначить вход» в ограждении (TODO.md, этап 2 п.4) ──
// Ставит разрыв на самом длинном свободном участке периметра — ПО ОДНОМУ НА КАЖДУЮ
// независимую террасу (правка 2026-08-30): у отдельно стоящих террас свои контуры,
// и одного общего входа им мало. Дальше пользователь двигает точки прямо на плане.
// Повторное нажатие входы убирает.
function dRailingEntry() {
  const has = Array.isArray(S.railingEntries) && S.railingEntries.some(e => e);
  if (has) {
    S.railingEntries = [];
  } else {
    const list = (typeof railingDefaultEntries === 'function') ? railingDefaultEntries() : [];
    if (!list.some(e => e)) { dToast('Сначала разметьте террасу — вход ставится на её периметре'); return; }
    S.railingEntries = list;
  }
  if (typeof _railingSync === 'function') _railingSync();
  if (typeof drawSnapCanvas === 'function') drawSnapCanvas('railing');
  if (typeof onParamChange === 'function') onParamChange();
}

// ── «Удалить всё» — раздел возвращается в нулевое состояние ──
// (этап 2 п.2). Данные чистятся, редактор закрывается, раздел перестаёт быть
// настроенным: кнопки «Изменить» у него больше нет, следующий клик по разделу
// открывает редактор заново, как при первом заходе (TODO п.3). Раньше редактор
// оставался открытым и сразу подставлял стартовую разметку — «удалить всё» на
// экране выглядело как «переставить заново».
function dResetSection(secId) {
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  const label = item ? item.lbl : secId;
  if (!window.confirm(`Удалить всё в разделе «${label}»?`)) return;

  if (S.pts && S.pts[secId]) S.pts[secId] = [];
  if (RECT_SECTIONS[secId]) { secRects(secId).length = 0; setSecActiveIdx(secId, null); }
  if (secId === 'steps')     S.stepsList = [{ ...DEFAULT_STEPS_RECT }]; S.activeSteps = 0;
  if (secId === 'beds')      { S.beds = []; S.activeBed = null; }
  if (secId === 'furniture') { S.furniture = []; S.activeFurniture = null; }
  if (secId === 'facade')    S.wallZones = {};
  if (secId === 'fence')     S.fenceGate = null;
  if (secId === 'beds')      S.bedFilters = { h: [], mount: [] };
  if (secId === 'pool_terrace') S.pool = null;
  if (secId === 'railing') { S.railingEntries = []; S.railFilters = { cap: [], postW: [] }; S.railPostW = null; }
  if (S.mats && S.mats[secId]) delete S.mats[secId];
  if (S.elementMat && S.elementMat[secId]) delete S.elementMat[secId];
  if (S.estimate && S.estimate[secId]) delete S.estimate[secId];

  // Раздел больше не настроен: закрываем редактор, убираем его из проекта.
  S.sections = S.sections.filter(s => s !== secId);
  dConfigured.delete(secId);
  if (dActiveItem === secId) {
    dActiveItem = null;
    if (typeof e3dSetSection === 'function') e3dSetSection(null);
    _dSyncSectionHint();
  }

  _dRenderSidebar();
  _dSetPanelLocked(!dActiveItem);
  if (dActiveItem) _dRenderPanelContent();
  if (typeof buildScene3d === 'function') setTimeout(() => init3dCanvas('d-slot-workspace'), 50);
}

// ── Клик по кнопке раздела ──
// Кнопок «Изменить» и «Дальше» больше нет: клик делает раздел активным, и он
// сразу и редактируется в сцене, и получает товары из каталога справа.
function dClickItem(secId) {
  const item = D_SIDEBAR_ITEMS.find(i => i.id === secId);
  if (!item) return;
  // Раздел с невыполненным условием (ограждение без террасы) не открываем.
  const blocked = _dSectionBlockedBy(secId);
  if (blocked) { dToast(blocked); return; }
  if (dActiveItem === secId) return;
  _dSelectItem(secId);
}

// ── Сделать раздел активным ──
function _dSelectItem(secId) {
  dActiveItem = secId;

  if (!S.sections.includes(secId)) S.sections.push(secId);
  _dSeedSection(secId);
  // Раздел считается настроенным, как только в нём есть объекты: подтверждать
  // («Дальше») больше нечего.
  if (_dSectionHasContent(secId)) dConfigured.add(secId);

  // Map active item to curSec for material application
  const secIdx = SECS.findIndex(s => s.id === secId);
  if (secIdx >= 0) S.curSec = 0; // getActive returns single item

  _dRenderSidebar();
  _dSetPanelLocked(false);
  _dRenderPanelContent();
  if (typeof e3dSetSection === 'function') e3dSetSection(secId);
  _dSyncSectionHint();

  // Rebuild 3D
  if (typeof buildScene3d === 'function') {
    setTimeout(() => {
      init3dCanvas('d-slot-workspace');
    }, 50);
  }
}

// В разделе есть хоть один объект? От этого зависит отметка «настроен» —
// раньше её ставила кнопка «Дальше».
function _dSectionHasContent(secId) {
  if (RECT_SECTIONS[secId]) return secRects(secId).length > 0;
  if (secId === 'steps')     return (S.stepsList || []).length > 0;
  if (secId === 'beds')      return (S.beds || []).length > 0;
  if (secId === 'furniture') return (S.furniture || []).length > 0;
  if (secId === 'facade')    return Object.keys(S.wallZones || {}).length > 0;
  if (S.pts && S.pts[secId]) return S.pts[secId].length > 0;
  return true;
}

// Стартовая разметка раздела при первом открытии. Раньше её создавали
// init*Canvas редакторов (initRectCanvas, initBedsCanvas, initSnapCanvas);
// редакторы убраны, а заготовка нужна — иначе в сцене нечего выбирать.
function _dSeedSection(secId) {
  if (RECT_SECTIONS[secId]) {
    const rects = secRects(secId);
    if (rects.length === 0) { rects.push(_defaultRect(secId)); setSecActiveIdx(secId, 0); }
    else if (secActiveIdx(secId) === null) setSecActiveIdx(secId, 0);
    return;
  }
  if (secId === 'beds') {
    if (!S.beds || S.beds.length === 0) { S.beds = [_defaultBed()]; S.activeBed = 0; }
    return;
  }
  if (secId === 'steps') { _stepsNormalize(); return; }
  if (secId === 'railing') { _railingSync(); return; }
  // Дорожки и забор заготовки НЕ получают: линия рисуется кликами по земле
  // (клик — начало отрезка, второй клик — конец), см. editor3d.js.
}

// ── Подсказка активного раздела ──
// Висит постоянной плашкой в углу вида, пока раздел открыт (как раньше над
// планом): всплывающее окно «один раз за сессию» пользователь не мог вернуть,
// а работа в сцене без напоминания о жестах неочевидна.
const D_SECTION_HINTS = {
  terrace: 'Тяните террасу за угловые маркеры или за тело. «ЕЩЁ ОДНА» добавляет блок, «УДАЛИТЬ ВЫБРАННУЮ» убирает выбранный.',
  pool_terrace: 'Отдельно стоящая терраса: тяните за углы или за тело. «БАССЕЙН ▭» и «БАССЕЙН ○» ставят бассейн — в настиле на его месте будет вырез; повторное нажатие убирает.',
  steps: 'Лестницу двигают за середину, ширину меняют маркерами по краям. Разворачивается к террасе автоматически, количество ступеней считается от высоты.',
  beds: 'Грядку перетаскивайте мышью; клик по ней разворачивает на 90°.',
  paths: 'Дорожка рисуется отрезками: клик — начало, второй клик — конец. Следующий отрезок — снова клик. Клик по уже поставленной точке склеивает отрезки, Esc отменяет начатый.',
  fence: 'Забор рисуется отрезками: клик — начало, второй клик — конец. Клик по уже поставленной точке склеивает. Ближе 3 м к дому и террасе забор не ставится. «КАЛИТКА» делает проём 1 м.',
  railing: 'Ограждение строится по периметру террасы само и разрывается под лестницей. Нужен разрыв без лестницы — «ОБОЗНАЧИТЬ ВХОД», затем тяните маркеры разрыва по периметру.',
  furniture: 'Мебель появляется в сцене при выборе товара в каталоге. Перетаскивайте её мышью, клик разворачивает на 90°; на террасе она встаёт на настил.',
  facade: 'Кликайте по стенам дома, отмечая места под отделку. Повторный клик снимает выбор. Простенок делится по границам окна на три части.',
};

function _dSyncSectionHint() {
  const el = document.getElementById('d-3d-hint');
  if (!el) return;
  el.textContent = (dStep === 3 && dActiveItem && D_SECTION_HINTS[dActiveItem])
    ? D_SECTION_HINTS[dActiveItem] : '';
}

function dHideEditorHint() {
  const ov = document.getElementById('d-hint-overlay');
  if (ov) ov.classList.remove('active');
}

// ── Подсказка по управлению 3D — всплывающим окном при ПЕРВОМ запуске ──
// ЛКМ по объекту своего раздела — выбор и перетаскивание, по пустому месту —
// вращение камеры (см. editor3d.js).
const HINT_3D_TEXT = 'Левая кнопка мыши — вращение, а на объекте раздела — выбор и перетаскивание.\n'
                   + 'Правая кнопка — перемещение.\n'
                   + 'Колесико — масштаб.';
let _d3dHintShown = false;

function dShow3dHint() {
  if (_d3dHintShown) return;
  const ov = document.getElementById('d-hint-overlay');
  const body = document.getElementById('d-hint-text');
  const title = document.getElementById('d-hint-title');
  if (!ov || !body) return;
  _d3dHintShown = true;
  if (title) title.textContent = 'Управление видом';
  body.textContent = HINT_3D_TEXT;
  ov.classList.add('active');
}

// ── Назад (кнопка внизу сайдбара) ──
function dBack() {
  dGoTo(2);
}

// ── Panel lock/unlock ──
// Правая панель во время canvas-настройки не блокируется, а ПРЯЧЕТСЯ: полупрозрачный
// каталог с подписью «(заблокировано)» сбивал — непонятно, можно ли с ним работать.
function _dSetPanelLocked(locked) {
  const panel = document.getElementById('d-panel');
  if (panel) panel.classList.toggle('hidden', locked);
}

// Кнопка сметы: на шаге 3 показывается ВСЕГДА и активной. Раньше она ждала первого
// применённого товара и до тех пор просто отсутствовала — пользователь не понимал,
// куда она делась. Пустую смету объясняет сам экран («Товары ещё не выбраны»).
function _dSyncSummaryBtn() {
  const btn = document.getElementById('d-btn-summary');
  if (!btn) return;
  const show = (dStep === 3);
  btn.style.display = show ? '' : 'none';
  // Кнопка живёт внизу правой панели: прячем и контейнер, иначе остаются
  // его отступы пустой полосой под списком товаров.
  const footer = btn.closest('.d-panel-footer');
  if (footer) footer.classList.toggle('hidden', !show);
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

  // Дефолтный раздел каталога для текущего элемента (сбрасываем явный выбор при
  // смене элемента/подрежима). Для ограждения террасы — раздел «Ограждения террасы».
  const defSec = (typeof CONSTRUCTION_TO_SECTION !== 'undefined') ? CONSTRUCTION_TO_SECTION[secId] : null;
  S.catSection = defSec || null;

  // Палитра цветов у каждого элемента своя: выбранные для прошлого элемента цвета,
  // которых нет в текущей палитре, вычищаем — иначе невидимый выбор фильтрует выдачу.
  const _palette = new Set(_elementColors(secId).map(c => c.id));
  const _f = catFilter(secId);
  _f.colors = new Set([..._f.colors].filter(n => _palette.has(n)));

  _dRenderFilters();

  // Auto-show catalog results (селектор раздела и блок образцов убраны из UI)
  dShowResults();
}

// ── ФИЛЬТРЫ КАТАЛОГА (правая панель) ──
// Цвет и цена — у всех разделов; специфические (крышка и сечение столба,
// высота борта и крепёж грядки) добавляются своему разделу. Блок свёрнут по
// умолчанию: развёрнутый он занимает половину панели и оттесняет карточки.
let _dFiltersOpen = false;

function _dRenderFilters() {
  _dRenderColorGrid();
  _dRenderPriceGrid();
  _dSyncFiltersBox();
}

function _dSyncFiltersBox() {
  const box = document.getElementById('d-filters-box');
  const btn = document.getElementById('d-filters-toggle');
  if (box) box.classList.toggle('open', _dFiltersOpen);
  if (btn) btn.classList.toggle('open', _dFiltersOpen);
}

function dToggleFilters() {
  _dFiltersOpen = !_dFiltersOpen;
  _dSyncFiltersBox();
}


// Элементы с настилом — материал у каждого свой (S.elementMat[el]).
// Забор здесь же: его планки текстурируются товаром как настил (остальные части
// модуля красятся сплошным цветом в buildFence3d) — TODO.md → ЗАБОРЫ.
const DECK_MAT_ELEMENTS = ['terrace', 'steps', 'paths', 'beds', 'pool_terrace', 'fence',
                           'railing'];
// Текущий активный элемент красится как настил? (Ограждение террасы — нет.)
function _activeIsDeck() {
  return DECK_MAT_ELEMENTS.includes(dActiveItem);
}

// Применяет образец (текстуры/цвет) к АКТИВНОМУ элементу. Деко-элементы — через
// S.elementMat[el] + пересборку (каждый независимо); прочие (фасад/забор/ограждение)
// — прежним способом (цвет live / глобально).
// Высота борта грядки (м) из товара. Каталог различает грядки по высоте доски —
// AIWood 150/200/270/300 мм, NauticPrime 150/225/300 мм (GARDEN_BEDS.md), и выбор
// должен быть виден в 3D. Явного поля у товара нет, поэтому читаем из названия:
// ищем ТОЛЬКО типовые значения рядом с «мм», чтобы не поймать длину («3000 мм»)
// или сечение доски. Не нашли — null, высота остаётся прежней.
const BED_BOARD_HEIGHTS_MM = [150, 200, 225, 270, 300];

function _bedHeightFromProduct(sample) {
  if (sample && typeof sample.bedHeightMm === 'number') return sample.bedHeightMm / 1000;
  // Характеристика каталога (dimensions.height) главнее разбора названия.
  const prop = (typeof productProp === 'function') ? productProp(sample, PROP_BED_H) : undefined;
  const pv = parseFloat(prop);
  if (!isNaN(pv) && BED_BOARD_HEIGHTS_MM.includes(Math.round(pv))) return Math.round(pv) / 1000;
  const text = [sample && sample.name, sample && sample.previewText].filter(Boolean).join(' ');
  // \b после «мм» не работает: в ASCII-семантике кириллица — не словесный символ,
  // поэтому конец слова проверяем явным «дальше не буква и не цифра».
  const re = new RegExp(
    `(?:^|[^\\d])(${BED_BOARD_HEIGHTS_MM.join('|')})\\s*(?:мм|mm)(?![а-яёa-z0-9])`, 'i');
  const m = re.exec(text);
  return m ? parseInt(m[1], 10) / 1000 : null;
}

// Товар ступеней «по умолчанию» подтягивается за доской террасы: если пользователь
// сам ступени не выбирал, берём товар из default_steps_id и красим ими 3D. Пометка
// auto:true отличает автоматический выбор от ручного — ручной не перетираем.
let _defStepsBusy = null;
function _syncDefaultStepsProduct() {
  const id = _defaultStepsProductId();
  const cur = S.elementMat && S.elementMat.steps;
  if (cur && !cur.auto) return;                       // ступени выбраны вручную
  if (!id) { if (cur && cur.auto) { delete S.elementMat.steps; _rebuild3d(); } return; }
  if (cur && cur.auto && cur.productId === id) return; // уже стоит нужный
  if (_defStepsBusy === id) return;
  const rm = _getRM();
  if (!rm) return;
  _defStepsBusy = id;
  rm.getProductById(id).then(async product => {
    _defStepsBusy = null;
    if (!product) return;
    const now = S.elementMat && S.elementMat.steps;
    if (now && !now.auto) return;                     // пока грузили, выбрали вручную
    try { await product.loadTextures(); } catch (_) {}
    const meta = { productId: product.id, name: product.name || '',
                   colorName: product.color || '', properties: product.properties || null,
                   previewText: product.previewText || '', modelUrl: product.modelUrl || '',
                   auto: true };
    S.elementMat.steps = product.textures ? { textures: product.textures, ...meta } : meta;
    console.info('[steps] ступень по умолчанию из доски террасы:', product.name || id);
    _rebuild3d();
  }).catch(() => { _defStepsBusy = null; });
}

function _rebuild3d() { if (typeof buildScene3d === 'function') buildScene3d(); }

function _applySampleToActive(sample) {
  _setEstimateForActive(sample);           // смета обновляется вместе с материалом
  if (_activeIsDeck()) {
    // productId/name сохраняем рядом с текстурами: по ним расчёт террасы на бэкенде
    // узнаёт выбранную доску (_deckingBoardProductId), 3D-слой их игнорирует.
    // colorName — имя цвета товара из каталога (пригождается 3D-слою).
    const meta = { productId: sample.id || null, name: sample.name || '',
                   colorName: sample.colorName || '',
                   // properties/previewText — характеристики товара: вид крышки столба,
                   // сечение столба, высота борта грядки, default_steps_id.
                   properties: sample.properties || null,
                   previewText: sample.previewText || '',
                   // modelUrl: у забора по нему берётся GLB товара (TODO.md → ЗАБОР 2).
                   modelUrl: sample.modelUrl || '' };
    S.elementMat[dActiveItem] = sample.textures ? { textures: sample.textures, ...meta }
                              : (sample.color ? { color: sample.color, ...meta } : null);
    // Грядки: высота борта — свойство ТОВАРА (150/200/225/270/300 мм, см. TODO.md),
    // забираем её из названия и отдаём в 3D. Фильтр высоты сюда не вмешивается: он
    // отбирает каталог, а рисуется то, что выбрано (TODO п.15).
    if (dActiveItem === 'beds') {
      const h = _bedHeightFromProduct(sample);
      if (h) S.bedH = h;
    }
    // Ограждение: сечение столба (100/125 мм) — тоже свойство товара, фильтр
    // раздела только отбирает каталог (TODO п.1).
    if (dActiveItem === 'railing') S.railPostW = _railPostWFromProduct(sample);
    // Доска террасы задаёт ступень по умолчанию (default_steps_id).
    if (dActiveItem === 'terrace') _syncDefaultStepsProduct();
    if (typeof buildScene3d === 'function') buildScene3d();
  } else if (dActiveItem === 'furniture') {
    // Мебель СТАВИТСЯ выбором товара (ТЗ п. 10): предмет появляется перед
    // камерой на ближайшем свободном месте, повторный клик по карточке ставит
    // ещё один. Точек размещения больше нет.
    _assignFurnitureProduct(sample);
  } else if (dActiveItem === 'facade') {
    // Фасад: материал панелей ложится на выбранные сегменты (S.wallZones) без
    // пересборки сцены; пустой выбор = весь фасад.
    S.elementMat.facade = sample.textures ? { textures: sample.textures }
                        : (sample.color ? { color: sample.color } : null);
    if (typeof _applyFacadeSelection === 'function' && typeof threeState !== 'undefined' && threeState) {
      _applyFacadeSelection();
    }
  } else if (sample.color && typeof applyMaterialToScene === 'function') {
    applyMaterialToScene(sample.color);    // забор/ограждение — цвет
  }
}

// Назначает товар точке мебели: активной, иначе первой без товара (по номерам),
// иначе — последней (перезаписываем, чтобы «Применить» всегда давал результат).
// После назначения выбор ПЕРЕВОДИТСЯ на следующую свободную точку — иначе повторное
// «Применить» било бы в ту же точку (она осталась активной) и вся мебель садилась
// бы на одно место. Явный выбор точки кликом на плане при этом сохраняет смысл
// «заменить товар в этой точке».
// Возвращает индекс точки или -1, если точек нет.
// Точка перед камерой в координатах плана: цель орбиты — это то, на что
// пользователь сейчас смотрит.
function _furnitureCameraSpot() {
  if (typeof threeState === 'undefined' || !threeState || typeof worldToCanvas !== 'function') {
    return { x: 0.5, y: 0.5 };
  }
  const t = threeState.controls.target;
  const sz = lastHouseSize();
  const p = worldToCanvas([{ x: t.x, z: t.z }], sz.L, sz.W)[0];
  return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
}

const FURN_SPOT_M = 1.5;      // место под предмет мебели, м

// Что мебели мешает: дом, грядки, лестницы, бассейн и уже стоящая мебель.
// Террасы и дорожки в список НЕ идут — на настил мебель ставить как раз можно.
function _furnitureBlockers() {
  const out = [];
  const add = (x, y, w, h) => { if (w > 0 && h > 0) out.push({ x, y, w, h }); };
  if (typeof isEmptyLot !== 'function' || !isEmptyLot()) {
    const hp = getHousePolygonNorm();
    if (hp && hp.bboxNorm) add(hp.bboxNorm.nx, hp.bboxNorm.ny, hp.bboxNorm.nw, hp.bboxNorm.nh);
  }
  for (const b of (S.beds || [])) add(b.x, b.y, b.w, b.h);
  if (S.sections.includes('steps')) {
    for (const st of (typeof stepsAll === 'function' ? stepsAll() : [S.steps])) {
      if (st) add(st.x, st.y, st.w, st.h);
    }
  }
  if (S.pool) add(S.pool.x, S.pool.y, S.pool.w, S.pool.h);
  const s = FURN_SPOT_M / GRID;
  for (const f of (S.furniture || [])) add(f.x - s / 2, f.y - s / 2, s, s);
  return out;
}

// Ближайшее свободное место к желаемой точке: если там занято, расходимся
// кольцами по сетке снапа. Не нашли за 40 колец — ставим как есть (лучше
// поставить внахлёст, чем не поставить вовсе).
function _furnitureFreeSpot(near) {
  const half = FURN_SPOT_M / 2 / GRID;
  const blockers = _furnitureBlockers();
  const gap = 0.2 / GRID;
  const free = (x, y) => {
    if (x - half < 0 || y - half < 0 || x + half > 1 || y + half > 1) return false;
    const r = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
    return !blockers.some(o => _rectsOverlap(r, o, gap));
  };
  const x0 = snapNorm(near.x), y0 = snapNorm(near.y);
  if (free(x0, y0)) return { x: x0, y: y0 };
  const step = SNAP / GRID;
  for (let k = 1; k <= 40; k++) {
    for (let a = 0; a < 12; a++) {                 // кольцо: 12 направлений
      const ang = a * Math.PI / 6;
      const x = snapNorm(x0 + Math.cos(ang) * k * step);
      const y = snapNorm(y0 + Math.sin(ang) * k * step);
      if (free(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

// Разворот «лицом к камере», округлённый до 90°: ручка поворота крутит теми же
// шагами, и свободный угол из неё было бы не вернуть.
function _furnitureFacingRot(spot) {
  if (typeof threeState === 'undefined' || !threeState) return 0;
  const sz = lastHouseSize();
  const c = worldToCanvas([{ x: threeState.camera.position.x, z: threeState.camera.position.z }],
                          sz.L, sz.W)[0];
  const a = Math.atan2(c.y - spot.y, c.x - spot.x);
  const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  return ((q % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

// Выбор товара в каталоге СТАВИТ предмет мебели (ТЗ п. 10): точек размещения
// больше нет, «Ещё одна» не нужна — повторный клик по карточке ставит второй
// экземпляр. Место — перед камерой, ближайшее свободное.
function _assignFurnitureProduct(sample) {
  if (!Array.isArray(S.furniture)) S.furniture = [];
  const spot = _furnitureFreeSpot(_furnitureCameraSpot());
  S.furniture.push({
    x: spot.x, y: spot.y, rot: _furnitureFacingRot(spot),
    product: { id: sample.id, name: sample.name, modelUrl: sample.modelUrl || '' },
  });
  const idx = S.furniture.length - 1;
  S.activeFurniture = idx;
  if (!S.sections.includes('furniture')) S.sections.push('furniture');
  dConfigured.add('furniture');
  if (typeof buildScene3d === 'function') buildScene3d();
  if (typeof e3dSync === 'function') e3dSync();
  _dSyncSectionActions();
  return idx;
}

// ── Индикатор загрузки 3D-моделей ──────────────────────────────────────────
// Модели мебели из каталога весят 4–12 МБ и грузятся 3–10 с; без индикатора
// сцена просто «молчит». Ключ — обычно URL модели; label — что показать
// пользователю; pct — 0..100 или null, если размер файла неизвестен.
const _d3dLoads = new Map();          // key → { label, pct }

function d3dLoadingSet(key, label, pct) {
  _d3dLoads.set(key, { label: label || 'модель', pct: (typeof pct === 'number') ? pct : null });
  _d3dLoadingRender();
}
function d3dLoadingClear(key) {
  if (_d3dLoads.delete(key)) _d3dLoadingRender();
}
function _d3dLoadingRender() {
  const box = document.getElementById('d-3d-loading');
  const bar = document.getElementById('d-3d-loading-bar');
  const fill = document.getElementById('d-3d-loading-fill');
  const txt = document.getElementById('d-3d-loading-txt');
  if (!box || !bar || !fill || !txt) return;
  const items = [..._d3dLoads.values()];
  if (!items.length) { box.classList.remove('on'); return; }
  const known = items.filter(i => i.pct !== null);
  const pct = known.length ? Math.round(known.reduce((s, i) => s + i.pct, 0) / known.length) : null;
  const head = (items.length === 1) ? `Загрузка модели «${items[0].label}»` : `Загрузка моделей (${items.length})`;
  txt.textContent = head + (pct !== null ? ` — ${pct}%` : '…');
  bar.classList.toggle('indet', pct === null);
  fill.style.width = (pct !== null ? pct : 40) + '%';
  box.classList.add('on');
}


// ── Catalog filters ──
// Набор цветов для текущего элемента проекта (свой на тип, имена/цвета из COLORS.md).
// id = название цвета (стабилен между типами; tooltip = название из каталога).
function _elementColors(elId) {
  let key = elId;
  if (elId === 'paths' || elId === 'pool_terrace') key = 'terrace';
  const map = (typeof ELEMENT_COLOR_NAMES !== 'undefined') ? ELEMENT_COLOR_NAMES : {};
  const names = map[key] || map.terrace || [];
  const hexMap = (typeof CATALOG_COLOR_HEX !== 'undefined') ? CATALOG_COLOR_HEX : {};
  return names.map(n => ({ id: n, hex: hexMap[n] || '#999999', label: n }));
}

// Цвета палитры элемента, у которых есть товары в текущем разделе каталога.
// Совпадение считается тем же способом, что и фильтрация (_itemColors), иначе
// чип мог бы остаться при пустой выдаче.
function _availableColors(elId) {
  const all = _elementColors(elId);
  const products = _catalogCache[_activeSectionId()];
  if (!Array.isArray(products) || !products.length) return all;
  const present = new Set();
  for (const p of products) {
    const cs = _itemColors(x => [x.color || '', x.name || '', x.previewText || ''], p);
    for (const c of cs) present.add(c);
  }
  const found = all.filter(c => present.has(c.id));
  // Если не распознан ни один цвет (например, у товаров пустые поля) — оставляем
  // палитру как есть: пустой фильтр хуже лишних чипов.
  return found.length ? found : all;
}

function _dRenderColorGrid() {
  const grid = document.getElementById('d-color-grid');
  if (!grid) return;
  // Мебель: у товаров каталога поле color пустое (проверено 2026-08-02) — любой
  // выбранный чип обнулил бы выдачу. Прячем блок, пока бэкенд не заполнит цвета.
  const sect = document.getElementById('d-color-section');
  const isFurniture = (dActiveItem === 'furniture');
  if (sect) sect.style.display = isFurniture ? 'none' : '';
  if (isFurniture) { catFilter(dActiveItem).colors = new Set(); grid.innerHTML = ''; return; }
  // Показываем только те цвета палитры, под которые в разделе есть товары:
  // раньше в фильтре висели цвета из COLORS.md, обнулявшие выдачу. Пока каталог
  // не загружен, палитра показывается целиком — иначе фильтр мигал бы пустым.
  const colors = _availableColors(dActiveItem);
  grid.innerHTML = colors.map(c =>
    `<div class="d-color-dot ${catFilter(dActiveItem).colors.has(c.id) ? 'selected' : ''}"
          title="${c.label}" style="background:${c.hex};"
          onclick="dToggleColor('${c.id.replace(/'/g, "\\'")}')"></div>`
  ).join('');
}

function _dRenderPriceGrid() {
  const grid = document.getElementById('d-price-grid');
  if (!grid) return;
  // Мебель: цена за изделие (десятки тысяч ₽), а тиры заданы в ₽/м.пог для доски —
  // фильтр по ним бессмыслен, прячем блок целиком и сбрасываем выбор.
  const sect = document.getElementById('d-price-section');
  const isFurniture = (dActiveItem === 'furniture');
  if (sect) sect.style.display = isFurniture ? 'none' : '';
  if (isFurniture) { catFilter(dActiveItem).prices = new Set(); grid.innerHTML = ''; return; }
  grid.innerHTML = PRICE_TIERS.map(t =>
    `<button class="d-price-btn ${catFilter(dActiveItem).prices.has(t.id) ? 'selected' : ''}"
             onclick="dSelectPrice('${t.id}')">
       <span class="d-radio"></span>
       <span class="d-price-lbl">${t.lbl}<span class="d-price-sub">${t.sub}</span></span>
     </button>`
  ).join('');
}

function dToggleColor(cid) {
  const colors = catFilter(dActiveItem).colors;
  if (colors.has(cid)) colors.delete(cid);
  else colors.add(cid);
  _dRenderColorGrid();
  dShowResults();
}

// ── Фильтр по цвету ──
// У товаров API нет отдельного поля цвета — цвет входит в НАЗВАНИЕ товара
// («Террасная доска … венге, м.пог»), см. COLORS.md. Поэтому цвета товара
// определяем по тексту: ищем имена палитры (CATALOG_COLOR_HEX) как отдельные
// слова. Длинные имена в приоритете: «тёмно-серый» в названии занимает диапазон
// целиком и НЕ засчитывается как «Серый».
function _colorNorm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }

const _COLOR_NAMES_BY_LEN = (typeof CATALOG_COLOR_HEX !== 'undefined')
  ? Object.keys(CATALOG_COLOR_HEX).sort((a, b) => b.length - a.length)
  : [];

function _detectColorNames(text) {
  const norm = _colorNorm(text);
  const found = new Set();
  const taken = [];                       // занятые диапазоны [start, end)
  const isLetter = ch => !!ch && /[0-9a-zа-я]/.test(ch);
  for (const name of _COLOR_NAMES_BY_LEN) {
    const cn = _colorNorm(name);
    let idx = norm.indexOf(cn);
    while (idx !== -1) {
      const end = idx + cn.length;
      // Только целое слово («тик» ≠ «пластик») и вне уже занятых диапазонов.
      const wholeWord = !isLetter(norm[idx - 1]) && !isLetter(norm[end]);
      const overlaps = taken.some(([s, e]) => idx < e && end > s);
      if (wholeWord && !overlaps) { found.add(name); taken.push([idx, end]); }
      idx = norm.indexOf(cn, end);
    }
  }
  return found;
}

// Цвета позиции: тексты перебираются ПО ПРИОРИТЕТУ, берём первый, где что-то
// распозналось. Название точнее описания: у товара конкретного цвета («…дуб»)
// preview_text перечисляет цвета всей линейки («венге, серый, шоколад…») и давал
// ложные совпадения. Описание остаётся fallback'ом для позиций без цвета в
// названии (многоцветные MIX-панели, заглушки).
function _itemColors(textsOf, it) {
  for (const t of textsOf(it)) {
    const c = _detectColorNames(t);
    if (c.size) return c;
  }
  return new Set();
}

// Оставляет позиции, чей цвет входит в выбранные (OR по выбранным цветам).
// Позиции без распознанного цвета при активном фильтре скрываются.
// textsOf(item) — массив текстов по убыванию приоритета (см. _itemColors).
function _filterByColors(items, textsOf) {
  const _sel = catFilter(dActiveItem).colors;
  if (!_sel.size) return items;
  return items.filter(it => {
    const colors = _itemColors(textsOf, it);
    for (const c of _sel) if (colors.has(c)) return true;
    return false;
  });
}

// Тиры можно включать вместе: выдача — объединение, как у фильтра цвета.
function dSelectPrice(tid) {
  const prices = catFilter(dActiveItem).prices;
  if (prices.has(tid)) prices.delete(tid);
  else                 prices.add(tid);
  _dRenderPriceGrid();
  dShowResults();
}

// ══════════════════════════════════════════════
// КАТАЛОГ ИЗ API (ResourceManager) + fallback на заглушки
// ══════════════════════════════════════════════
let _rm = null;                 // singleton ResourceManager
const _catalogCache = {};       // bitrix_id -> ProductResource[] | null
const _catalogLoading = {};     // bitrix_id -> bool
const _catalogFails = {};       // bitrix_id -> сколько раз запрос раздела не удался
const CATALOG_MAX_TRIES = 2;    // после стольких неудач раздел считаем недоступным
// Сервер может не отвечать вовсе. Тогда лимита «две попытки на раздел» мало: пользователь
// ходит по разделам, и каждый начинает свои попытки. Считаем неудачи по ВСЕМУ каталогу и
// после CATALOG_MAX_FAILS перестаём запрашивать что-либо, один раз показав окно
// «Каталог временно недоступен…» (правка 2026-08-30).
const CATALOG_MAX_FAILS = 3;
let _catalogFailTotal = 0;
let _catalogDown = false;       // каталог признан недоступным — запросов больше не шлём
let _catalogDownShown = false;  // окно показано (одного раза достаточно)
const CATALOG_DOWN_TEXT = 'Каталог временно недоступен, попробуйте позже. '
                        + 'Приносим наши извинения.';

// Отмечает неудачу запроса каталога и, когда их накопилось слишком много, гасит
// дальнейшие запросы и показывает окно.
function _catalogNoteFail(sectionId) {
  _catalogFails[sectionId] = (_catalogFails[sectionId] || 0) + 1;
  _catalogFailTotal++;
  if (_catalogFailTotal >= CATALOG_MAX_FAILS && !_catalogDown) {
    _catalogDown = true;
    console.warn('[catalog] сервер не отвечает —', _catalogFailTotal,
                 'неудачных запроса подряд, запросы остановлены');
    _dShowCatalogDown();
  }
}

// Окно «Каталог временно недоступен» — то же, что подсказки редакторов.
function _dShowCatalogDown() {
  if (_catalogDownShown) return;
  _catalogDownShown = true;
  const ov = document.getElementById('d-hint-overlay');
  const body = document.getElementById('d-hint-text');
  const title = document.getElementById('d-hint-title');
  if (!ov || !body) { if (typeof dToast === 'function') dToast(CATALOG_DOWN_TEXT); return; }
  if (title) title.textContent = 'Каталог недоступен';
  body.textContent = CATALOG_DOWN_TEXT;
  ov.classList.add('active');
}

function _getRM() {
  if (!_rm && typeof ResourceManager !== 'undefined') {
    try { _rm = new ResourceManager(); } catch (e) { console.warn('[catalog] RM init:', e); _rm = null; }
  }
  return _rm;
}

// Активный раздел каталога: явный выбор пользователя (S.catSection) или дефолт по
// текущему элементу проекта (CONSTRUCTION_TO_SECTION), иначе террасная доска.
function _activeSectionId() {
  if (S.catSection) return S.catSection;
  const def = (typeof CONSTRUCTION_TO_SECTION !== 'undefined') ? CONSTRUCTION_TO_SECTION[dActiveItem] : null;
  return def || 2314;
}

// Загружает товары раздела (section_id) один раз и кэширует.
//   [] — раздел реально пуст (fallback на заглушки, не перезапрашиваем);
//   null — ошибка/недоступно (перезапросим, но не больше CATALOG_MAX_TRIES раз);
//   undefined — ещё не грузили.
async function _ensureCatalogSection(sectionId) {
  if (Array.isArray(_catalogCache[sectionId])) return _catalogCache[sectionId];
  if (_catalogLoading[sectionId]) return undefined;
  // Сервер не отвечает вовсе — запросы прекращены совсем (см. _catalogNoteFail).
  if (_catalogDown) return null;
  // Раздел уже отвечал ошибкой (например, 400 на section_id) — больше не долбим сервер.
  if ((_catalogFails[sectionId] || 0) >= CATALOG_MAX_TRIES) return null;
  const rm = _getRM();
  if (!rm || typeof Filter === 'undefined') return null;
  _catalogLoading[sectionId] = true;
  try {
    // Текстурированные товары (с texture_urls для превью/3D) бэкенд отдаёт только под тегом
    // раздела (SECTION_TAGS). Без тега вернулись бы товары без текстур → превью не приходят.
    const tag = (typeof SECTION_TAGS !== 'undefined') ? SECTION_TAGS[sectionId] : null;
    // Наборы из SECTION_TAG_ONLY (мебель) тянем ТОЛЬКО по тегу: их товары лежат в
    // разных разделах, section_id отрезал бы часть выдачи.
    // Наборы из SECTION_MERGE показываются одним списком (доска ДПК + МПК): берём их
    // МУЛЬТИТЕГОМ и без section_id — он отрезал бы вторую половину выдачи.
    const merge = ((typeof SECTION_MERGE !== 'undefined') && SECTION_MERGE[sectionId]) || [];
    const tags = tag ? [tag, ...merge.map(id => SECTION_TAGS[id]).filter(Boolean)] : [];
    const tagOnly = tags.length > 1
      || ((typeof SECTION_TAG_ONLY !== 'undefined') && SECTION_TAG_ONLY.has(sectionId) && tag);
    const filters = tagOnly ? [] : [new Filter(FilterType.SECTION_ID, sectionId)];
    if (tags.length) filters.push(new Filter(FilterType.TAGS, tags));
    // Объединённому набору лимит вдвое: 50 позиций делились бы между двумя тегами.
    filters.push(new Filter(FilterType.LIMIT, tags.length > 1 ? 100 : 50));
    const res = await rm.getResources(...filters);
    // res === null → ошибка запроса → null (повторяемо); иначе массив (возможно пустой).
    let products = res ? (res.products || []) : null;
    // Пусто, хотя тег есть → товары тега могут лежать НЕ в этом разделе (так было
    // с мебелью, из-за чего появился SECTION_TAG_ONLY). Перезапрашиваем только по
    // тегу: лучше показать товары из соседнего раздела, чем пустой список и заглушки.
    if (tag && !tagOnly && products && products.length === 0) {
      const byTag = await rm.getResources(new Filter(FilterType.TAGS, tags),
                                          new Filter(FilterType.LIMIT, 50));
      const alt = byTag ? (byTag.products || []) : [];
      if (alt.length) {
        console.info(`[catalog] раздел ${sectionId}: по section_id+тегу пусто, взяли ${alt.length} товар(ов) по тегу «${tag}»`);
        products = alt;
      }
    }
    // На стенде должно быть видно, что именно приехало по разделу: пустой раздел
    // и ошибка запроса выглядят в интерфейсе одинаково («товаров нет»).
    console.info('[catalog] раздел', sectionId,
                 tags.length ? `(тег${tags.length > 1 ? 'и' : ''} «${tags.join(', ')}»)` : '(без тега)',
                 '→', products === null ? 'ошибка запроса' : products.length + ' товар(ов)');
    _catalogCache[sectionId] = products;
    if (products === null) _catalogNoteFail(sectionId);
    // Ответ получен — счётчики сбрасываем: связь есть, прежние сбои были разовыми.
    else { _catalogFails[sectionId] = 0; _catalogFailTotal = 0; }
  } catch (e) {
    console.warn('[catalog] section load failed', sectionId, e);
    _catalogCache[sectionId] = null;
    _catalogNoteFail(sectionId);
  }
  _catalogLoading[sectionId] = false;
  return _catalogCache[sectionId];
}

function _productPrice(p) {
  const v = p && p.prices && p.prices[0] ? parseFloat(p.prices[0].price) : NaN;
  return isNaN(v) ? null : v;
}

// Клиентский фильтр по выбранному ценовому тиру. Границы — по реальному
// распределению цен каталога (₽/м.пог, ревизия 2026-07-31: 250–1305 с разрывами
// на ~500 и ~900); подписи тиров — PRICE_TIERS в state.js, держать в синхроне.
// Предикаты тиров. МПК: надёжный признак — принадлежность разделу 2329
// «Террасная доска из МПК» (тег mpk, ревизия API 2026-07-31); подстрока в
// названии — fallback.
const PRICE_TIER_MATCH = {
  budget:   p => (_productPrice(p) ?? 0) < 500,
  balanced: p => { const v = _productPrice(p) ?? 0; return v >= 500 && v <= 900; },
  premium:  p => (_productPrice(p) ?? 0) > 900,
  mpk:      p => (p.sections || []).includes(2329) || /мпк/i.test(p.name || ''),
};

// Ценовая категория ТОВАРА — свойство price_category (появилось у доски 2026-08-31).
// Если она есть, тир берём по ней, а не по порогам цены: у бэкенда категория
// расставлена в админке и точнее наших 500/900 ₽. Синонимы — на случай, если
// сервер отдаёт русские или иные названия; незнакомое значение оставляет
// товар на прежнем правиле по цене.
const PROP_PRICE_CATEGORY = 'price_category';
// Значения — PriceCategory из backend_API/ResourceManager.js (budget/balance/premium);
// синонимы оставлены на случай русских подписей в админке.
const PRICE_CATEGORY_ALIASES = {
  budget:   ['budget', 'эконом', 'бюджет'],
  balanced: ['balance', 'balanced', 'standard', 'middle', 'баланс', 'стандарт', 'средний'],
  premium:  ['premium', 'lux', 'премиум', 'люкс'],
};
function _priceCategoryOf(p) {
  const v = (typeof productProp === 'function') ? productProp(p, PROP_PRICE_CATEGORY) : undefined;
  return (typeof v === 'string' && v) ? v.toLowerCase() : null;
}
// Совпадает ли категория товара с тиром: null — категории нет или она незнакомая,
// тогда решает прежний предикат по цене.
function _tierByCategory(p, tier) {
  const cat = _priceCategoryOf(p);
  if (!cat) return null;
  const known = Object.keys(PRICE_CATEGORY_ALIASES)
    .some(t => PRICE_CATEGORY_ALIASES[t].some(a => cat.includes(a)));
  if (!known) return null;
  const list = PRICE_CATEGORY_ALIASES[tier];
  return list ? list.some(a => cat.includes(a)) : null;
}

// Несколько выбранных тиров объединяются: товар проходит, если подошёл хотя бы
// под один. Раньше тир был один и включение второго снимало первый.
function _filterRealByPrice(products) {
  const _tiers = catFilter(dActiveItem).prices;
  if (!_tiers.size) return products;
  return products.filter(p => {
    for (const t of _tiers) {
      const byCat = _tierByCategory(p, t);
      if (byCat !== null) { if (byCat) return true; continue; }
      const m = PRICE_TIER_MATCH[t];
      if (m && m(p)) return true;
    }
    return false;
  });
}

// Селектор раздела каталога (реальные разделы API из CATALOG_SECTIONS).
function _dRenderSectionSelect() {
  const host = document.getElementById('d-section-row');
  if (!host || typeof CATALOG_SECTIONS === 'undefined') return;
  const active = _activeSectionId();
  host.innerHTML = `
    <label class="d-section-lbl">Раздел каталога:</label>
    <select class="d-section-select" onchange="dSelectCatSection(this.value)">
      ${CATALOG_SECTIONS.map(s => `<option value="${s.id}" ${s.id === active ? 'selected' : ''}>${s.label}</option>`).join('')}
    </select>`;
}

function dSelectCatSection(id) {
  S.catSection = parseInt(id, 10) || null;
  dShowResults();
}

// Плейсхолдер «идёт загрузка раздела» (вместо заглушек-досок, чтобы не создавать
// ложного впечатления «доска везде», пока медленный API отвечает).
function _dRenderCatalogLoading() {
  const list = document.getElementById('d-mat-list');
  if (!list) return;
  list.innerHTML = '<div class="d-cat-loading"><div class="d-cat-spinner"></div>Загрузка товаров раздела…</div>';
}

// ── Catalog results (auto-shown) ──
// Показываем товары реального раздела каталога. Пока грузится — «Загрузка…»;
// раздел реально пуст или API недоступен — fallback на заглушки STUB_RESULTS.
function dShowResults() {
  _dRenderColorGrid();
  _dRenderPriceGrid();
  const secId = _activeSectionId();
  const cached = _catalogCache[secId];
  if (Array.isArray(cached)) {
    if (cached.length) _dRenderRealResults(cached);
    else               _dRenderStubResults();   // раздел реально пуст → заглушки
    return;
  }
  // Раздел отвечал ошибкой CATALOG_MAX_TRIES раз (например, 400 на section_id), либо
  // каталог целиком признан недоступным — показываем заглушки, а не вечную «Загрузку»:
  // иначе dShowResults и _ensureCatalogSection зацикливались, перезапрашивая сервер.
  if (_catalogDown || (_catalogFails[secId] || 0) >= CATALOG_MAX_TRIES) {
    _dRenderStubResults();
    if (_catalogDown) _dShowCatalogDown();
    return;
  }
  // undefined (не грузили) или null (прошлая попытка не удалась) → грузим.
  _dRenderCatalogLoading();
  if (!_catalogLoading[secId]) {
    _ensureCatalogSection(secId).then(() => dShowResults());
  }
}

// ── Фото товара ──
// Открывается кнопкой «Посмотреть» в развёрнутой карточке (лупа с миниатюры
// убрана по TODO). Затемнение — как у окна сметы.

function dShowPhoto(ev, url) {
  if (ev) ev.stopPropagation();   // клик по лупе не должен сворачивать карточку
  const ov = document.getElementById('d-photo-overlay');
  const img = document.getElementById('d-photo-img');
  if (!ov || !img) return;
  img.src = url;
  ov.classList.add('active');
}

function dHidePhoto() {
  const ov = document.getElementById('d-photo-overlay');
  if (ov) ov.classList.remove('active');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') dHidePhoto();
});

// URL картинки из поля каталога. Битрикс отдаёт такие поля по-разному: строкой-URL,
// объектом ({src|url|path}) или числовым id файла — id адресом не является, его
// отбрасываем. Кавычки вырезаем: URL подставляется внутрь style="…url('…')".
function _pictureUrl(v) {
  if (!v) return '';
  if (typeof v === 'object') return _pictureUrl(v.src || v.url || v.path || v.SRC || '');
  if (typeof v !== 'string') return '';
  const s = v.trim().replace(/['"]/g, '');
  return /^\d+$/.test(s) ? '' : s;
}

// Миниатюра карточки товара: у доски превью материала — сама DPK-текстура, у прочих
// товаров (мебель) её нет, поэтому падаем на картинки каталога. Фото товара
// показываем целиком (contain), текстуру — с заполнением (cover).
function _productThumbStyle(p) {
  const tex = (p.textureUrls && p.textureUrls.textures_dpc_diffusion) || '';
  if (tex) return `background-image:url('${tex}');background-size:cover;background-position:center;`;
  const pic = _pictureUrl(p.previewPicture) || _pictureUrl(p.detailPicture);
  if (pic) return `background-image:url('${pic}');background-size:contain;background-repeat:no-repeat;`
                + 'background-position:center;background-color:#fff;';
  return 'background:#bbb;';
}

// Товар уже применён к активному элементу? По нему кнопка «Применить» гаснет.
function _isProductApplied(pid) {
  const el = dActiveItem;
  const em = el && S.elementMat ? S.elementMat[el] : null;
  return !!(em && em.productId === pid);
}

function _dRenderRealResults(allProducts) {
  const list = document.getElementById('d-mat-list');
  if (!list) return;
  // Цвет — приоритетно из ПОЛЯ color (появилось в API 2026-07-29, имена совпадают
  // с палитрой COLORS.md); затем название; preview_text — fallback (см. _itemColors).
  const products = _bedFilterProducts(_railingFilterProducts(_filterByColors(_filterRealByPrice(allProducts),
    p => [p.color || '', p.name || '', p.previewText || ''])));
  if (!products.length) {
    list.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">Нет товаров под выбранные фильтры</div>';
    return;
  }
  // В «Садовой мебели» по кнопке открывается фото товара, в остальных разделах —
  // текстура (TODO.md, этап 1 п.11). Раздел берём по пункту меню: _activeSectionId()
  // возвращает НОМЕР раздела каталога, а не его id.
  const viewLabel = (dActiveItem === 'furniture') ? 'Посмотреть' : 'Посмотреть текстуру';
  list.innerHTML = products.map(p => {
    const price = _productPrice(p);
    const thumbStyle = _productThumbStyle(p);
    const desc = (p.previewText && p.previewTextType !== 'html') ? p.previewText : '';
    const bigPic = _pictureUrl(p.detailPicture) || _pictureUrl(p.previewPicture)
      || (p.textureUrls && p.textureUrls.textures_dpc_diffusion) || '';
    return `
    <div class="d-mat-card" id="dmc-${p.id}">
      <div class="d-mat-head" onclick="dToggleMatCard(${p.id})">
        <div class="d-mat-thumb" style="${thumbStyle}"></div>
        <div class="d-mat-info">
          <div class="d-mat-name">${p.name || ''}</div>
          <div class="d-mat-price">${price != null ? 'от ' + Math.round(price) + ' ₽' : 'цена по запросу'}</div>
        </div>
        <button class="d-mat-exp">▼</button>
      </div>
      <div class="d-mat-body"><div class="d-mat-detail">
        <div class="d-mat-desc">${desc}</div>
        <div class="d-mat-actions">
          ${bigPic ? `<button class="d-mat-btn d-mat-btn-view"
             onclick="dShowPhoto(event, '${bigPic.replace(/'/g, "\\'")}')">${viewLabel}</button>` : ''}
          <button class="d-mat-btn d-mat-btn-apply" onclick="dApplyRealMat(event, ${p.id})"
                  ${_isProductApplied(p.id) ? 'disabled' : ''}>Применить</button>
        </div>
      </div></div>
    </div>`;
  }).join('');
}

function _dRenderStubResults() {
  let results = [...STUB_RESULTS];
  // Заглушки фильтруются по тем же тирам; выбранные объединяются.
  const STUB_TIER_IDS = { budget: [4], balanced: [1, 4], premium: [2, 3] };
  const picked = [...catFilter(dActiveItem).prices];
  if (picked.length && !picked.includes('mpk')) {
    const ids = new Set(picked.flatMap(t => STUB_TIER_IDS[t] || []));
    results = results.filter(r => ids.has(r.id));
  } else if (picked.includes('mpk')) {
    const ids = new Set(picked.flatMap(t => STUB_TIER_IDS[t] || []));
    results = results.filter(r => ids.has(r.id));
    results.push({
      id: 99, name: 'Deckron МПК Классик 145×22',
      short: 'Массив прессованного кедра, премиум',
      detail: 'Массив прессованного кедра (МПК) — натуральный кедр под давлением 800 атм. Плотность выше дуба. Не гниёт, не трескается, не требует обработки.',
      price: 'от 10 000 ₽/м²', color: '#A0522D',
      url: 'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/deckron',
    });
  }
  // Цвета заглушек: сначала название, затем текст («Цвета: тик, венге, серый…»).
  results = _filterByColors(results, m => [m.name, `${m.short || ''} ${m.detail || ''}`]);

  const list = document.getElementById('d-mat-list');
  if (!list) return;
  if (!results.length) {
    list.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">Нет товаров под выбранные фильтры</div>';
    return;
  }
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
                  onclick="dApplyMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}', '${m.price}')">
            Применить
          </button>
          <button class="d-mat-btn d-mat-btn-compare"
                  onclick="dCompareMat(event, ${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.color || '#C8A96E'}')">
            Сравнить
          </button>
        </div>
        <a href="${m.url}" target="_blank"
           style="display:block;margin-top:10px;font-size:11px;color:#555;text-decoration:underline;">
          Подробнее на outdoor-mebel.ru ↗
        </a>
      </div></div>
    </div>`).join('');
}

// Применить реальный товар к активному элементу (каждый элемент — независимо).
async function dApplyRealMat(e, pid) {
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '…';
  let product = null;
  for (const k in _catalogCache) {
    const arr = _catalogCache[k];
    if (Array.isArray(arr)) { const f = arr.find(p => p.id === pid); if (f) { product = f; break; } }
  }
  const rm = _getRM();
  if (!product && rm) { try { product = await rm.getProductById(pid); } catch (_) {} }
  if (!product) { btn.textContent = orig; return; }
  try { await product.loadTextures(); } catch (_) {}

  // modelUrl нужен мебели (GLB-модель товара); для прочих элементов он просто пуст.
  // price — чтобы «Применить» сразу обновляло смету (_setEstimateForActive).
  _applySampleToActive({ id: product.id, name: product.name, color: null,
                         textures: product.textures, modelUrl: product.modelUrl || '',
                         colorName: product.color || '',
                         // Характеристики товара — по ним 3D берёт вид крышки столба,
                         // сечение столба, высоту борта грядки и default_steps_id.
                         // Раньше они сюда не доезжали, и всё это читалось только из
                         // названия (исправлено 2026-08-31).
                         properties: product.properties || null,
                         previewText: product.previewText || '',
                         price: _productPrice(product) });

  // Применённый товар нельзя применить повторно: кнопка гаснет, у остальных
  // карточек — снова активна (применить можно только один товар на элемент).
  btn.textContent = orig;
  const list = document.getElementById('d-mat-list');
  if (list) list.querySelectorAll('.d-mat-btn-apply').forEach(b => { b.disabled = false; });
  btn.disabled = true;
}

function dToggleMatCard(mid) {
  const el = document.getElementById('dmc-' + mid);
  const was = el.classList.contains('open');
  document.querySelectorAll('.d-mat-card.open').forEach(c => c.classList.remove('open'));
  if (was) return;
  el.classList.add('open');
  // Раскрытая карточка целиком в поле зрения: у карточки внизу списка кнопки
  // «Посмотреть»/«Применить» оказывались за краем контейнера. Центровать не нужно
  // (TODO п.10) — прокручиваем НА МИНИМУМ (`block: 'nearest'`): верхние карточки
  // остаются на месте, нижняя всплывает ровно настолько, чтобы кнопки были видны.
  // Ждём КОНЦА анимации раскрытия: пока max-height едет, карточка ещё низкая, и
  // прокрутка не доводит список до конца. Таймер — страховка, если transitionend
  // не придёт. Прокрутка мгновенная: smooth-анимация в части окружений не запускается.
  const body = el.querySelector('.d-mat-body');
  let scrolled = false;
  const toView = () => {
    if (scrolled) return;
    scrolled = true;
    if (body) body.removeEventListener('transitionend', toView);
    el.scrollIntoView({ block: 'nearest' });
  };
  if (body) body.addEventListener('transitionend', toView);
  setTimeout(toView, 450);
}

function dApplyMat(e, mid, name, color, priceStr) {
  _applySampleToActive({ id: mid, name, color, price: priceStr });
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.background = '#444';
  setTimeout(() => { btn.textContent = orig; btn.style.background = '#000'; }, 600);
}

function dCompareMat(e, mid, name, color) {
  const btn = e.currentTarget;
  btn.textContent = '✓ Запомнен';
  btn.style.fontWeight = '400';
  setTimeout(() => { btn.textContent = 'Сравнить'; btn.style.fontWeight = '700'; }, 1000);
}

// Заглушки: цена приходит строкой ("от 2 400 ₽/м²") → вытаскиваем число.
function _parsePriceNum(s) {
  if (typeof s === 'number') return s;
  const digits = String(s || '').replace(/[^\d]/g, '');
  const v = parseInt(digits, 10);
  return isNaN(v) ? null : v;
}

// Записывает товар в смету активного элемента. Вызывается из «Применить»:
// отдельной кнопки «В смету» больше нет — применённый материал И ЕСТЬ выбор
// для сметы, а два действия на карточке путали (материал в 3D один, в смете другой).
function _setEstimateForActive(sample) {
  if (!dActiveItem) return;
  if (!('price' in sample)) return;   // источник цены не передал — строку сметы не трогаем
  const price = _parsePriceNum(sample.price);
  if (price == null) { delete S.estimate[dActiveItem]; _dSyncSummaryBtn(); return; }
  S.estimate[dActiveItem] = { id: sample.id, name: sample.name, price };
  _dSyncSummaryBtn();
}

// ── Геометрические метрики элементов (для сметы) ──
const _GRIDm = () => (typeof GRID !== 'undefined' ? GRID : 32);

function _rectsAreaM2(rects) {
  const G = _GRIDm(); let a = 0;
  for (const r of (rects || [])) a += (r.w * G) * (r.h * G);
  return a;
}
function _polyLenM(pts) {
  if (!pts) return 0;
  const G = _GRIDm();
  const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts.filter(p => !p.break)];
  let L = 0;
  for (const s of segs) for (let i = 0; i < s.length - 1; i++) {
    L += Math.hypot((s[i + 1].x - s[i].x) * G, (s[i + 1].y - s[i].y) * G);
  }
  return L;
}
// Ширина доски из названия товара в метрах; не распознали — 0.14 м.
//
// Порядок размеров в каталоге НЕ единый: «доска 20*140*2900» (толщина×ширина×длина),
// но «ступень узкая 150*25*3000» (ширина×толщина×длина). Поэтому не полагаемся на
// позицию: из группы размеров выбрасываем длину (≥ 1000 мм), из оставшихся ширина —
// БОЛЬШЕЕ (толщина доски ДПК — 12–25 мм, ширина — от 80 мм).
// Прежняя версия брала первое число пары и почти всегда падала на фолбэк 0.14: у
// террасной доски он совпадал с реальными 140 мм и ошибку не было видно, а ступени
// (320 мм) и фасадные панели (177 мм) считались с завышением погонажа в 1.3–2.3 раза.
const BOARD_MIN_W_MM = 80, BOARD_MAX_W_MM = 400;

function _boardWidthM(name) {
  const m = /(\d{1,4})\s*[*хxX×]\s*(\d{1,4})(?:\s*[*хxX×]\s*(\d{1,4}))?/.exec(name || '');
  if (m) {
    const dims = [m[1], m[2], m[3]].filter(Boolean).map(Number).filter(v => v < 1000);
    const w = dims.length ? Math.max(...dims) : 0;
    if (w >= BOARD_MIN_W_MM && w <= BOARD_MAX_W_MM) return w / 1000;
  }
  return 0.14;
}

// Площадь дорожек с ВЫЧЕТОМ перекрытий (TODO п.7): считается по тем же
// непересекающимся линиям, что уходят в смету объектами (_pathProjectObjects),
// поэтому цифра в панели и задание на расчёт всегда сходятся.
function _pathsAreaM2() {
  const w = (S.pathWidth || 120) / 100;
  const lines = _pathCenterLines();
  if (!lines.length) return 0;
  const cut = (typeof pathLinesNoOverlap === 'function') ? pathLinesNoOverlap(lines, w / 2) : lines;
  let L = 0;
  for (const wp of cut) for (let i = 1; i < wp.length; i++) {
    L += Math.hypot(wp[i].x - wp[i - 1].x, wp[i].z - wp[i - 1].z);
  }
  return L * w;
}

// Осевые линии дорожек в метрах плана ({x,z} — как ждут геометрические хелперы).
function _pathCenterLines() {
  const pts = S.pts.paths || [];
  const G = _GRIDm();
  const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts.filter(p => !p.break)];
  const lines = [];
  for (const seg of segs) {
    const raw = seg.filter(p => !p.break).map(p => ({ x: p.x * G, z: p.y * G }));
    const wp = [];
    for (const p of raw) {
      if (!wp.length || Math.hypot(p.x - wp[wp.length - 1].x, p.z - wp[wp.length - 1].z) > 0.05) wp.push(p);
    }
    if (wp.length >= 2) lines.push(wp);
  }
  return lines;
}

// Метрика элемента: {kind:'deck'|'linear'|'piece', value, text}.
function _elementMetric(el) {
  if (RECT_SECTIONS[el]) { const a = _rectsAreaM2(secRects(el)); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'steps')   {
    const G = _GRIDm();
    const list = (typeof stepsAll === 'function') ? stepsAll() : (S.steps ? [S.steps] : []);
    const a = list.reduce((sum, st) => sum + (st.w * G) * (st.h * G), 0);
    return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null;
  }
  if (el === 'paths')   { const a = _pathsAreaM2(); return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null; }
  if (el === 'fence')   { const len = _polyLenM(S.pts.fence); return len > 0 ? { kind: 'linear', value: len, text: len.toFixed(1) + ' м' } : null; }
  if (el === 'railing') { const len = _polyLenM(S.pts.railing); return len > 0 ? { kind: 'linear', value: len, text: len.toFixed(1) + ' м' } : null; }
  if (el === 'beds')    { const n = (S.beds || []).length; return n > 0 ? { kind: 'piece', value: n, text: n + ' шт' } : null; }
  if (el === 'furniture') {
    // Считаем только точки с выбранным товаром (пустые — просто места под мебель).
    const n = (S.furniture || []).filter(p => p.product).length;
    return n > 0 ? { kind: 'piece', value: n, text: n + ' шт' } : null;
  }
  if (el === 'facade')  {
    // Площадь выбранных сегментов стен (пустой выбор = весь фасад) — из viewer3d.
    const a = (typeof facadeSelectedAreaM2 === 'function') ? facadeSelectedAreaM2() : 0;
    return a > 0 ? { kind: 'deck', value: a, text: a.toFixed(1) + ' м²' } : null;
  }
  return null;
}

// Считает смету: строки по элементам + итог. Расчёт ориентировочный:
//   deck   — площадь → погонаж доски (площадь / ширина доски × 1.1 запас) × цена/м.пог;
//   linear — длина × 1.05 × цена/м.пог;
//   piece  — количество × цена/шт.
function _computeEstimate() {
  const order = ['terrace', 'railing', 'steps', 'paths', 'pool_terrace', 'fence',
                 'beds', 'facade', 'furniture'];
  const rows = [];
  for (const el of order) {
    if (!S.sections.includes(el)) continue;
    const metric = _elementMetric(el);
    if (!metric || metric.value <= 0) continue;
    const lbl = (D_SIDEBAR_ITEMS.find(i => i.id === el) || {}).lbl || el;
    const mat = S.estimate[el] || null;
    let qtyUnits = null, subtotal = null;
    if (mat && mat.price) {
      if (metric.kind === 'deck') {
        const lin = Math.ceil(metric.value / _boardWidthM(mat.name) * 1.1);
        qtyUnits = lin + ' м.пог'; subtotal = lin * mat.price;
      } else if (metric.kind === 'linear') {
        const lin = Math.ceil(metric.value * 1.05);
        qtyUnits = lin + ' м.пог'; subtotal = lin * mat.price;
      } else {
        qtyUnits = metric.value + ' шт'; subtotal = metric.value * mat.price;
      }
    }
    rows.push({ el, lbl, metric, mat, qtyUnits, subtotal });
  }
  const total = rows.reduce((s, r) => s + (r.subtotal || 0), 0);
  return { rows, total };
}

function _fmtRub(n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; }

// ══════════════════════════════════════════════
// РАСЧЁТ ТЕРРАСЫ НА БЭКЕНДЕ (POST /api/v1/calculate_terrace/)
//
// Бэкенд считает полную спецификацию: доска, лаги, кляймеры, уголки, саморезы,
// подложки, полуступени + работы. Наш клиентский расчёт (_computeEstimate)
// остаётся для остальных элементов — у них своей ручки пока нет.
//
// Запрос: { vertices, doorDirection, deckingBoardProductId, terraceHeight }
//   vertices  — контур террасы в МИЛЛИМЕТРАХ, обход по порядку, у каждой вершины
//               vertexType: 'house' (лежит на стене дома) | 'free';
//   doorDirection — сторона света, см. TERRACE_CALC_NORTH ниже;
//   terraceHeight — высота настила над землёй, мм (= высота фундамента).
// ══════════════════════════════════════════════

// Ось «север» на плане. План: x вправо, y вниз (как canvas и мировой Z).
// Берём картографическое соглашение «север — вверх», т.е. N = −y.
// doorDirection трактуем как СТОРОНУ, где стоит дом с главной дверью, если
// смотреть с террасы: в примере бэкендера дом стоит по ребру y=0 (сверху), а
// направление указано 'N'. NB: пример не различает эту трактовку и обратную
// («куда смотрит дверь» при N = +y) — они дают одну и ту же ОСЬ и различаются
// только знаком. Для приоритета лаг важна ось, поэтому риск мал; если бэкендер
// подтвердит обратный знак — инвертировать здесь одной строкой.
const TERRACE_CALC_NORTH = { x: 0, y: -1 };

function _compassFromVec(vx, vy) {
  // Доминантная ось; север = TERRACE_CALC_NORTH, восток — вправо от него.
  const n = TERRACE_CALC_NORTH;
  const north = vx * n.x + vy * n.y;              // проекция на север
  const east  = vx * (-n.y) + vy * n.x;           // поворот севера на +90° по часовой
  return (Math.abs(north) >= Math.abs(east))
    ? (north >= 0 ? 'N' : 'S')
    : (east  >= 0 ? 'E' : 'W');
}

// Контур террасы в метрах плана (x вправо, y вниз). Берём union-контур блоков —
// тот же, по которому строится ограждение (_terraceUnionLoops из viewer3d-railing.js;
// он работает с любыми координатами, лишь бы rect'ы были в одной системе).
// Возвращает внешний контур (самый большой по площади) или null.
function _terracePlanLoop(secId) {
  const rects = secRects(secId || 'terrace').filter(r => r && r.w > 0 && r.h > 0);
  if (!rects.length || typeof _terraceUnionLoops !== 'function') return null;
  const G = _GRIDm();
  const loops = _terraceUnionLoops(rects.map(r => ({
    minX: r.x * G, maxX: (r.x + r.w) * G,
    minZ: r.y * G, maxZ: (r.y + r.h) * G,
  })));
  if (!loops.length) return null;
  const area = loop => {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      a += p.x * q.z - q.x * p.z;
    }
    return Math.abs(a) / 2;
  };
  const outer = loops.reduce((best, l) => (area(l) > area(best) ? l : best), loops[0]);
  return outer.map(p => ({ x: p.x, y: p.z }));   // z контура = y плана
}

// Вершина лежит на стене дома? Рёбра дома берём из getHousePolygonNorm (canvas.js),
// нормированные 0..1 → метры плана. Допуск 0.15 м покрывает люфт снапа к стене.
function _vertexOnHouse(pt, houseEdges, tol) {
  for (const e of houseEdges) {
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    let t = ((pt.x - e.x1) * dx + (pt.y - e.y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(pt.x - (e.x1 + dx * t), pt.y - (e.y1 + dy * t));
    if (d <= tol) return true;
  }
  return false;
}

// Направление главной двери. Берём раскладку фасада 1-го этажа (_houseWorldTransform
// из canvas.js): дверь с флагом main, иначе первая попавшаяся. Сторону «наружу»
// определяем пробой точки по нормали (как рисуется створка на плане).
function _mainDoorDirection() {
  if (typeof _houseWorldTransform !== 'function') return null;
  const T = _houseWorldTransform();
  if (!T || !T.layout || !T.layout.edges) return null;
  let found = null;
  for (const e of T.layout.edges) {
    for (const it of e.items) {
      if (it.type !== 'door') continue;
      if (!found || it.main) found = { e, it };
      if (it.main) break;
    }
    if (found && found.it.main) break;
  }
  if (!found) return null;
  const { e, it } = found;
  const mid = T.toNorm(e.x + e.dx * (it.start + it.width / 2),
                       e.z + e.dz * (it.start + it.width / 2));
  const len = Math.hypot(e.dx, e.dz) || 1;
  let nx = -e.dz / len, ny = e.dx / len;          // нормаль к стене в плане
  const probe = 0.5 / _GRIDm();                   // 0.5 м в нормированных единицах
  if (_normPtInHouse(mid.x + nx * probe, mid.y + ny * probe)) { nx = -nx; ny = -ny; }
  // Наружная нормаль показывает ОТ дома; doorDirection — сторона, где дом (см. выше).
  return _compassFromVec(-nx, -ny);
}

// ══════════════════════════════════════════════
// РАСЧЁТ ПРОЕКТА (POST /api/v1/calculate_project/)
//
// Одна ручка считает все объекты сразу и отдаёт смету по каждому. Раньше на
// бэкенде считалась только терраса, остальное прикидывал _computeEstimate.
// mergeMaterials: false — нужен разбор по элементам, как в таблице «Итог»;
// общую стоимость складывает сам Calculator.getTotalCost.
// ══════════════════════════════════════════════

// Нормированные координаты плана (0..1 поля) → миллиметры, как ждёт API.
function _ptsToMm(pts) {
  const k = _GRIDm() * 1000;
  return pts.map(p => ({ x: Math.round(p.x * k), y: Math.round(p.y * k) }));
}

// Вершина линии стоит у СТЕНЫ ДОМА? По этому признаку в расчёт уходит
// vertexType: 'house' (контракт бэкенда от 2026-08-31, необязательное поле точки —
// «для точности расчёта»): у такой вершины линия упирается в дом, а не обрывается.
function _vertexAtHouse(pt, tol) {
  const hp = (typeof getHousePolygonNorm === 'function') ? getHousePolygonNorm() : null;
  if (!hp || !hp.corners || hp.corners.length < 3) return false;
  const c = hp.corners;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) continue;
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t)) <= tol) return true;
  }
  return false;
}

// Ломаные элемента: разрывы (break) делят разметку на отдельные линии.
// Концам линии, стоящим на стене дома, проставляется vertexType: 'house' — там
// оградка крепится к дому и столб не нужен (calculation_api.md, «Примыкание к дому»).
// Метить можно ТОЛЬКО первую и последнюю точку: метка на внутренней точке — ошибка 400.
// У забора поле пока ничего не меняет, поэтому шлём его только для оградки.
function _linesToMm(name, markHouse) {
  const pts = S.pts[name] || [];
  const segs = (typeof splitAtBreaks === 'function')
    ? splitAtBreaks(pts)
    : [pts.filter(p => !p.break)];
  const tol = 0.15 / _GRIDm();          // 15 см в долях поля, как у примыкания ступеней
  return segs.filter(s => s.length >= 2).map(seg => {
    const mm = _ptsToMm(seg);
    if (!markHouse) return mm;
    for (const i of [0, seg.length - 1]) {
      if (_vertexAtHouse(seg[i], tol)) mm[i].vertexType = 'house';
    }
    return mm;
  });
}

// Ступень по умолчанию для выбранной доски террасы: свойство default_steps_id
// (контракт бэкенда от 2026-08-31). Поля может не быть или оно может быть null —
// тогда возвращаем null и всё работает как раньше.
const PROP_DEFAULT_STEPS = 'default_steps_id';
function _defaultStepsProductId() {
  const t = (S.elementMat && S.elementMat.terrace) || null;
  const v = (t && typeof productProp === 'function') ? productProp(t, PROP_DEFAULT_STEPS) : undefined;
  const id = (typeof v === 'string') ? parseInt(v, 10) : v;
  return (typeof id === 'number' && isFinite(id) && id > 0) ? id : null;
}

// id товара, выбранного для элемента: сначала явный выбор «В смету», затем
// применённый к элементу материал. null — бэкенд возьмёт товар по умолчанию.
function _elementProductId(el) {
  const est = S.estimate && S.estimate[el];
  if (est && est.id) return est.id;
  const mat = S.elementMat && S.elementMat[el];
  return (mat && mat.productId) || null;
}

// Вершина лежит на кромке террасы? От этого зависит vertexType ступеней:
// ступеням неоткуда начинаться, если фигура не примыкает к террасе.
function _vertexOnTerrace(pt, tol) {
  for (const r of (S.terraceRects || [])) {
    const insideX = pt.x >= r.x - tol && pt.x <= r.x + r.w + tol;
    const insideY = pt.y >= r.y - tol && pt.y <= r.y + r.h + tol;
    if (!insideX || !insideY) continue;
    const dEdge = Math.min(
      Math.abs(pt.x - r.x), Math.abs(pt.x - (r.x + r.w)),
      Math.abs(pt.y - r.y), Math.abs(pt.y - (r.y + r.h)));
    if (dEdge <= tol) return true;
  }
  return false;
}

// Ступени — прямоугольник на плане; высота подъёма = высота настила террасы.
function _stepsProjectObject(name, stair) {
  const s = stair || S.steps;
  if (!s || !(s.w > 0) || !(s.h > 0)) return null;
  const tol = 0.15 / _GRIDm();          // 15 см в долях поля, как у примыкания к дому
  const corners = [
    { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y },
    { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h },
  ];
  const k = _GRIDm() * 1000;
  const vertices = corners.map(c => ({
    x: Math.round(c.x * k), y: Math.round(c.y * k),
    vertexType: _vertexOnTerrace(c, tol) ? 'terrace' : 'free',
  }));
  // Без примыкания к террасе расчёт ступеней заведомо падает («ступеням неоткуда
  // начинаться»), а ошибка одного объекта роняет весь проект. Поэтому такие
  // ступени в запрос не кладём — лучше смета без них, чем никакой.
  if (!vertices.some(v => v.vertexType === 'terrace')) return null;
  const height = Math.round((typeof S.terraceH === 'number' ? S.terraceH : 0.8) * 1000);
  // Свой товар ступеней важнее; если его нет — ступень по умолчанию от доски террасы.
  return { type: CalculationType.STEPS, name, vertices, height,
           stepProductId: _elementProductId('steps') || _defaultStepsProductId() };
}

// Мебель — состав изделий: id товара → количество точек с ним.
function _furnitureProjectObject(name) {
  const items = {};
  for (const p of (S.furniture || [])) {
    if (!p.product || !p.product.id) continue;
    items[p.product.id] = (items[p.product.id] || 0) + 1;
  }
  return Object.keys(items).length
    ? { type: CalculationType.FURNITURE, name, items }
    : null;
}

// Грядки — состав изделий, как у мебели: `items` с идентификаторами конфигураций
// и количеством (calculation_api.md, «Грядки»). Размер грядки — это вариант товара,
// поэтому в расчёт уходит id ВЫБРАННОЙ конфигурации, то есть тот же id, что применён
// к элементу.
function _bedsProjectObject(name) {
  const id = _elementProductId('beds');
  const n = (S.beds || []).length;
  if (!id || !n) return null;
  const type = (typeof CalculationType !== 'undefined') ? CalculationType.GARDEN_BEDS : null;
  if (!type) return null;
  return { type, name, items: { [id]: n } };
}

// ── Дорожки: осевая линия + ширина → замкнутый контур ленты ──
//
// API ждёт КОНТУР (calculation_api.md, «Дорожка»): опорная («стартовая») сторона —
// это ширина дорожки, от неё идёт обход; на каждом повороте у обеих боковых сторон
// появляется по вершине, и число вершин у них должно совпадать. У нас хранится
// осевая ломаная и ширина, поэтому кромки считаем тем же оффсетом с миттером, что
// и 3D-лента (_offsetPolyline из viewer3d-builders) — смета совпадёт с картинкой.
// Порядок вершин: right[0], left[0] (обе 'start'), дальше левая кромка до конца,
// затем правая обратно — как в примере контракта.
// Каждая линия разметки (разрывы {break:true}) — отдельный объект дорожки.
function _pathProjectObjects(name) {
  if (typeof _offsetPolyline !== 'function') return [];
  const halfW = ((S.pathWidth || 120) / 100) / 2;      // м
  // Осевые в метрах плана; {x,z} — как ждёт _offsetPolyline (z = y плана).
  const lines = _pathCenterLines();
  if (!lines.length) return [];
  // Перекрытия вычитаем (TODO п.7): примыкания подрезаются, как в 3D, а куски,
  // накрытые полотном другой дорожки на пересечении, выбрасываются — иначе одна
  // и та же площадь уходила в смету дважды, от каждой из пересекающихся дорожек.
  const trimmed = (typeof pathLinesNoOverlap === 'function')
    ? pathLinesNoOverlap(lines, halfW)
    : ((typeof _trimPathJunctions === 'function') ? _trimPathJunctions(lines, halfW) : lines);
  const productId = _elementProductId('paths');
  const objs = [];
  trimmed.forEach((wp, i) => {
    const { left, right } = _offsetPolyline(wp, halfW);
    const loop = [right[0], ...left, ...right.slice(1).reverse()];
    const ox = Math.min(...loop.map(p => p.x)), oy = Math.min(...loop.map(p => p.z));
    const mm = v => Math.round(v * 1000);
    const vertices = loop.map((p, k) => ({
      x: mm(p.x - ox), y: mm(p.z - oy),
      vertexType: (k <= 1) ? 'start' : 'free',      // опорная сторона right[0]–left[0]
    }));
    objs.push({
      type: CalculationType.PATH,
      name: trimmed.length > 1 ? `${name} ${i + 1}` : name,
      vertices,
      deckingBoardProductId: productId,
    });
  });
  return objs;
}

// Объекты проекта. Терраса у бассейна и причал уходят тем же типом TERRACE —
// это отдельно стоящие террасы, все вершины 'free'.
function _projectObjects() {
  const lbl = id => (D_SIDEBAR_ITEMS.find(i => i.id === id) || {}).lbl || id;
  const objs = [];

  for (const secId of Object.keys(RECT_SECTIONS)) {   // terrace, pool_terrace
    if (!S.sections.includes(secId)) continue;
    const req = buildTerraceCalcRequest(secId);
    if (req.payload) objs.push({ type: CalculationType.TERRACE, name: lbl(secId), ...req.payload });
  }
  if (S.sections.includes('steps')) {
    // Лестниц может быть несколько — каждая идёт в расчёт отдельным объектом
    // (правка 2026-08-30). Номер в имени появляется, только когда их больше одной.
    const stairs = (typeof stepsAll === 'function') ? stepsAll() : (S.steps ? [S.steps] : []);
    stairs.forEach((st, i) => {
      const nm = stairs.length > 1 ? `${lbl('steps')} №${i + 1}` : lbl('steps');
      const o = _stepsProjectObject(nm, st);
      if (o) objs.push(o);
    });
  }
  if (S.sections.includes('paths')) {
    for (const o of _pathProjectObjects(lbl('paths'))) objs.push(o);
  }
  for (const el of ['railing', 'fence']) {
    if (!S.sections.includes(el)) continue;
    const lines = _linesToMm(el, el === 'railing');
    if (!lines.length) continue;
    const o = { type: el === 'fence' ? CalculationType.FENCE : CalculationType.RAILING,
                name: lbl(el), lines, sectionProductId: _elementProductId(el) };
    // Калитки в разметке не учитываются — отдельного инструмента для них нет.
    // Калитка в разметке — одна на забор (TODO.md, этап 2 п.8).
    if (el === 'fence') { o.gateCount = S.fenceGate ? 1 : 0; o.picketProductId = null; }
    objs.push(o);
  }
  if (S.sections.includes('beds')) {
    const o = _bedsProjectObject(lbl('beds'));
    if (o) objs.push(o);
  }
  if (S.sections.includes('furniture')) {
    const o = _furnitureProjectObject(lbl('furniture'));
    if (o) objs.push(o);
  }
  return objs;
}

// Тело запроса или причина, по которой считать нечего.
function buildProjectCalcRequest() {
  const objects = _projectObjects();
  if (!objects.length) return { error: 'Разметьте конструкции, чтобы рассчитать смету.' };
  return { payload: { objects, mergeMaterials: false } };
}

// id террасной доски для расчёта: сначала явный выбор «В смету», затем применённый
// к террасе товар (S.elementMat.terrace.productId пишется в _applySampleToActive).
function _deckingBoardProductId(secId) {
  return _elementProductId(secId || 'terrace');
}

// Собирает тело запроса или причину, по которой расчёт невозможен.
// { payload } | { error }
function buildTerraceCalcRequest(secId) {
  const sec = secId || 'terrace';
  const cfg = RECT_SECTIONS[sec];
  if (!S.sections.includes(sec)) return { error: `«${cfg ? cfg.label : sec}» не выбрана в проекте.` };
  const loop = _terracePlanLoop(sec);
  if (!loop || loop.length < 3) return { error: `«${cfg ? cfg.label : sec}» не размечена на плане.` };
  // Доску можно не выбирать: по контракту id необязателен, а сейчас он ещё и не
  // читается — расчёт всегда идёт на товарах по умолчанию (calculation_api.md,
  // «Выбор товаров»). Выбранный id всё равно шлём: заработает, когда в каталоге
  // заполнят характеристики.
  const productId = _deckingBoardProductId(sec);

  const G = _GRIDm();
  // Примыкание к дому считаем ТОЛЬКО для террасы/крыльца. Терраса у бассейна и
  // причал — отдельно стоящие: у них все вершины 'free', дом в расчёте не участвует.
  const houseEdges = (cfg && cfg.house && !isEmptyLot() && typeof getHousePolygonNorm === 'function')
    ? getHousePolygonNorm().edges.map(e => ({
        x1: e.x1 * G, y1: e.y1 * G, x2: e.x2 * G, y2: e.y2 * G,
      }))
    : [];
  // Начало координат — в углу bbox контура, чтобы не гонять смещение сетки участка.
  const ox = Math.min(...loop.map(p => p.x)), oy = Math.min(...loop.map(p => p.y));
  const mm = v => Math.round(v * 1000);
  const vertices = loop.map(p => ({
    x: mm(p.x - ox), y: mm(p.y - oy),
    vertexType: (houseEdges.length && _vertexOnHouse(p, houseEdges, 0.15)) ? 'house' : 'free',
  }));
  // Высота настила над землёй = высота фундамента (см → мм); без дома — 35 см, как в 3D.
  // NB: в опубликованном контракте (calculation_api.md, «Терраса») этого поля нет —
  // там height только у ступеней. Продолжаем слать до ответа бэкендера: лишнее поле
  // расчёту не мешает, а если оно учитывается — терять его нельзя.
  const foundCm = parseFloat(document.getElementById('v-found')?.value || 80);
  // Отметка настила: у пристроенной террасы и у террасы у бассейна — вровень
  // с фундаментом (та же отметка, что в 3D).
  const terraceHeight = isEmptyLot() ? 350 : Math.round(foundCm * 10);
  const payload = {
    vertices,
    doorDirection: _mainDoorDirection() || 'N',
    deckingBoardProductId: productId,
    terraceHeight,
  };
  // Бассейн вырезает часть настила — площадь выреза уходит в задание (TODO.md,
  // этап 2 п.14). Поля в опубликованном контракте нет: шлём как дополнительное,
  // по образцу terraceHeight. Считаем ровно ту часть, что попала на блоки секции.
  if (sec === 'pool_terrace' && S.pool && typeof _poolCutAreaM2 === 'function') {
    const cut = _poolCutAreaM2();
    if (cut > 0.01) {
      payload.poolCutoutArea = Math.round(cut * 1e6);      // мм², как и вершины
      payload.poolShape = S.pool.kind === 'round' ? 'round' : 'rect';
    }
  }
  return { payload };
}

// Площадь выреза под бассейн (м²) — пересечение бассейна с блоками террасы.
function _poolCutAreaM2() {
  if (!S.pool || typeof poolPolygonWorld !== 'function') return 0;
  const lw = (typeof lastHouseSize === 'function') ? lastHouseSize() : { L: 0, W: 0 };
  const poly = poolPolygonWorld(lw.L, lw.W);
  if (!poly) return 0;
  let area = 0;
  for (const pp of (typeof _terraceRectsToPolygons === 'function'
                    ? _terraceRectsToPolygons('pool_terrace') : [])) {
    const w = canvasToWorld(pp, lw.L, lw.W);
    const minX = Math.min(...w.map(p => p.x)), maxX = Math.max(...w.map(p => p.x));
    const minZ = Math.min(...w.map(p => p.z)), maxZ = Math.max(...w.map(p => p.z));
    area += polyAreaM2(clipPolyToRect(poly, minX, maxX, minZ, maxZ));
  }
  return area;
}

// ── Запрос к бэкенду через Calculator + кэш по телу запроса ──
//
// Сетевую часть держит обёртка бэкендера (backend_API/Calculator.js): адрес,
// метод, разбор ответа и ошибок. Свой fetch убран, чтобы формат запроса жил в
// одном месте — в их библиотеке и calculation_api.md.
let _projectCalc = null;    // { key, state:'loading'|'ok'|'err', data, error }
let _calculator = null;

function _dCalculator() {
  if (_calculator) return _calculator;
  if (typeof Calculator === 'undefined') return null;
  const domain = (typeof RESOURCE_API_DOMAIN !== 'undefined') ? RESOURCE_API_DOMAIN : '';
  _calculator = new Calculator(domain + '/api/v1/');
  return _calculator;
}

// Текст для пользователя по виду ошибки. Ветвимся по kind, а не по тексту:
// message предназначен для показа, а не для разбора (calculator.md, «Ошибки»).
function _calcErrorText(e) {
  switch (e && e.kind) {
    case CalculationErrorKind.GEOMETRY:  return e.message;   // про контур — показываем как есть
    case CalculationErrorKind.MATERIALS: return 'Расчёт временно недоступен: в каталоге не заполнены характеристики товара.';
    case CalculationErrorKind.NETWORK:   return 'Сервис расчёта недоступен, попробуйте ещё раз.';
    case CalculationErrorKind.TIMEOUT:   return 'Смета не собралась за отведённое время, попробуйте ещё раз.';
    default: return 'Ошибка расчёта, подробности в консоли.';
  }
}

// Запускает расчёт, если тело запроса изменилось; перерисовывает блок по готовности.
function _ensureProjectCalc() {
  const req = buildProjectCalcRequest();
  if (req.error) { _projectCalc = { key: 'x', state: 'err', error: req.error }; return; }
  const calc = _dCalculator();
  if (!calc) { _projectCalc = { key: 'x', state: 'err', error: 'Сервис расчёта не подключён.' }; return; }
  const key = JSON.stringify(req.payload);
  if (_projectCalc && _projectCalc.key === key && _projectCalc.state !== 'err') return;
  _projectCalc = { key, state: 'loading' };
  calc.getCalculation(CalculationType.PROJECT, req.payload)
    .then(data => { _projectCalc = { key, state: 'ok', data }; _dRenderProjectCalc(); })
    .catch(e => {
      console.warn('[calculate_project]', e);
      _projectCalc = { key, state: 'err', error: _calcErrorText(e) };
      _dRenderProjectCalc();
    });
}

// ── Смета проекта в PDF ──
//
// Собирается фоновой задачей: Calculator ставит её, опрашивает состояние и
// отдаёт ссылку на файл. Тело запроса — то же, что у расчёта. Раньше PDF был
// только по одному объекту; в новой версии API тип project поддерживается и
// здесь, поэтому смета выгружается на проект целиком.
async function dProjectReport() {
  const btn = document.getElementById('d-project-pdf');
  const state = document.getElementById('d-project-pdf-state');
  const setState = t => { if (state) state.textContent = t; };
  const req = buildProjectCalcRequest();
  const calc = _dCalculator();
  if (req.error || !calc) { setState(req.error || 'Сервис расчёта не подключён.'); return; }

  if (btn) btn.disabled = true;
  setState('Ставим задачу…');
  try {
    const url = await calc.getReport(CalculationType.PROJECT, req.payload,
      s => setState(s === ReportStatus.PENDING ? 'Готовим смету…' : ''));
    // Ссылка приходит относительной (/api/v1/calculation_report/file/…). На хосте
    // без прокси статика и API — разные домены, поэтому разворачиваем по домену API.
    const domain = (typeof RESOURCE_API_DOMAIN !== 'undefined') ? RESOURCE_API_DOMAIN : '';
    window.open(domain ? new URL(url, domain).href : url, '_blank');
    setState('');
  } catch (e) {
    console.warn('[calculation_report]', e);
    setState(_calcErrorText(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Итог по объекту: материалы + работы.
function _objectCalcTotal(obj) {
  if (!obj) return 0;
  const mats = Object.values(obj.materials || {}).reduce((s, m) => s + (m.totalCost || 0), 0);
  const works = (obj.works || []).reduce((s, w) => s + (w.cost || 0), 0);
  return mats + works;
}

function _dRenderProjectCalc() {
  const host = document.getElementById('d-project-calc');
  if (!host) return;
  const c = _projectCalc;
  const head = '<div class="est-title">Расчёт по спецификации</div>';
  if (!c || c.state === 'err') {
    host.innerHTML = head + `<div class="est-empty">${(c && c.error) || 'Расчёт недоступен.'}</div>`;
    return;
  }
  if (c.state === 'loading') {
    host.innerHTML = head + '<div class="d-cat-loading"><div class="d-cat-spinner"></div>Считаем проект…</div>';
    return;
  }
  const objects = (c.data && c.data.objects) || [];
  if (!objects.length) {
    host.innerHTML = head + '<div class="est-empty">Бэкенд вернул пустой расчёт.</div>';
    return;
  }
  const row = (name, tag, qty, unit, price, cost) => `
    <tr>
      <td>${tag || ''}</td>
      <td class="est-mat">${name || ''}</td>
      <td class="est-r">${qty != null ? qty : '—'} ${unit || ''}</td>
      <td class="est-r">${price != null ? _fmtRub(price) : '—'}</td>
      <td class="est-r">${cost != null ? _fmtRub(cost) : '—'}</td>
    </tr>`;

  let total = 0;
  const sections = objects.map(o => {
    const mats = Object.values(o.materials || {});
    const works = o.works || [];
    const sum = _objectCalcTotal(o);
    total += sum;
    return `
      <div class="est-obj-title">${o.name || o.type || ''}</div>
      <table class="est-table">
        <thead><tr><th>Позиция</th><th>Наименование</th><th class="est-r">Кол-во</th><th class="est-r">Цена</th><th class="est-r">Сумма</th></tr></thead>
        <tbody>
          ${mats.map(m => row(m.name, m.ruTag, m.totalDimensionCount, m.dimension,
                              m.pricePerDimension, m.totalCost)).join('')}
          ${works.map(w => row(w.name, 'Работы', null, '', null, w.cost)).join('')}
        </tbody>
        <tfoot><tr><td colspan="4" class="est-r">Итого:</td><td class="est-r est-total">${_fmtRub(sum)}</td></tr></tfoot>
      </table>`;
  }).join('');

  host.innerHTML = head + sections + `
    <div class="est-project-total">Итого по проекту: <span class="est-total">${_fmtRub(total)}</span></div>
    <div class="est-actions">
      <button class="d-canvas-btn" id="d-project-pdf" onclick="dProjectReport()">Смета проекта в PDF</button>
      <span class="est-note" id="d-project-pdf-state"></span>
    </div>`;
}

// ══════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════
function dShowSummary() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const rows = [
    ['Тип дома', S.houseType === 'no_house' ? 'Участок без дома' : (S.houseType || 'не выбран')],
    ['Общая площадь', (document.getElementById('v-area')?.value || '—') + ' кв.м'],
    ['Фундамент', (document.getElementById('v-found')?.value || '—') + ' см'],
  ];
  // Per-floor параметры (если есть дескриптор с этажами)
  if (desc && desc.floors) {
    desc.floors.forEach((floor, fi) => {
      const a = document.getElementById(`v-area-${fi}`)?.value;
      const h = document.getElementById(`v-floor-${fi}`)?.value;
      const label = floor.label || `Этаж ${fi + 1}`;
      if (a || h) rows.push([label, `${a || '—'} кв.м, h=${h || '—'} см`]);
    });
  }
  rows.push(
    ['Настроено', dConfigured.size
      ? [...dConfigured].map(s => D_SIDEBAR_ITEMS.find(x => x.id === s)?.lbl || s).join(', ')
      : 'не выбрано'],
  );
  const infoHTML = rows.map(([k, v]) =>
    `<div class="sum-row"><span class="sum-k">${k}</span><span class="sum-v">${v}</span></div>`
  ).join('');

  // ── Предварительная смета ──
  const est = _computeEstimate();
  const hasProduct = !!(S.estimate && Object.keys(S.estimate).length);
  let estHTML = '<div class="est-title">Предварительная смета</div>';
  if (!est.rows.length) {
    estHTML += '<div class="est-empty">Разметьте конструкции, чтобы рассчитать смету.</div>';
  } else if (!hasProduct) {
    // Конструкции размечены, но ни один товар не применён: таблица из прочерков
    // с итогом 0 ₽ выглядела бы поломкой.
    estHTML += '<div class="est-empty">Товары ещё не выбраны.</div>';
  } else {
    estHTML += `
      <table class="est-table">
        <thead><tr><th>Элемент</th><th>Объём</th><th>Материал</th><th class="est-r">Кол-во</th><th class="est-r">Сумма</th></tr></thead>
        <tbody>
          ${est.rows.map(r => `
            <tr>
              <td>${r.lbl}</td>
              <td>${r.metric.text}</td>
              <td class="est-mat">${r.mat ? r.mat.name : '<span class="est-nomat">материал не выбран</span>'}</td>
              <td class="est-r">${r.qtyUnits || '—'}</td>
              <td class="est-r">${r.subtotal != null ? _fmtRub(r.subtotal) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4" class="est-r">Итого:</td><td class="est-r est-total">${_fmtRub(est.total)}</td></tr></tfoot>
      </table>
      <div class="est-note">Расчёт ориентировочный: цены из каталога; расход доски с запасом 10%, забора — 5%.</div>`;
  }

  // Блок расчёта проекта бэкендом — заполняется асинхронно (_dRenderProjectCalc).
  // Пока ни один товар не выбран, его НЕ показываем: спецификация на товарах по
  // умолчанию рядом с «Товары ещё не выбраны» противоречила бы сама себе.
  document.getElementById('d-sum-body').innerHTML =
    infoHTML + estHTML + (hasProduct ? '<div id="d-project-calc"></div>' : '');
  // Расчёт не должен ломать «Итог»: исключение при сборке запроса раньше обрывало
  // dShowSummary до рендера, и блок оставался пустым — без заголовка и без
  // сообщения, то есть неотличимо от «фичи вообще нет в этой сборке».
  if (hasProduct) {
    try {
      _ensureProjectCalc();
    } catch (e) {
      console.error('[project calc] не удалось собрать запрос', e);
      _projectCalc = { key: 'x', state: 'err', error: 'Не удалось собрать запрос: ' + e.message };
    }
    _dRenderProjectCalc();
  }
  document.getElementById('d-summary-overlay').classList.add('active');
}

function dCloseSummary() {
  document.getElementById('d-summary-overlay').classList.remove('active');
}

// ══════════════════════════════════════════════
// TOGGLES / ACTIVE SECTION
// (Слой совместимости с мобильным флоу удалён вместе с nav.js/ui.js/catalog.js —
// no-op заглушки goTo/updProg/selHouse/tci/renderSec/renderSwatches никого не
// обслуживали. getActive и ttg остаются: их использует viewer3d и index.html.)
// ══════════════════════════════════════════════
// Парных тумблеров не осталось: ограждение стало отдельным элементом проекта,
// а навес над террасой убран совсем (TODO.md, этап 1 п.5).
const TG_PAIRS = {};
function ttg(el) {
  el.classList.toggle('on');
  const isOn = el.classList.contains('on');
  const id = el.dataset.id;
  if (id) S.toggles[id] = isOn;             // зеркало для 3D-слоя (tgOn)
  const partnerId = id && TG_PAIRS[id];
  if (partnerId) {
    const partner = document.querySelector(`.tg[data-id="${partnerId}"]`);
    if (partner) partner.classList.toggle('on', isOn);
    S.toggles[partnerId] = isOn;
  }
}

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
