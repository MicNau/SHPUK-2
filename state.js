// STATE.JS — глобальное состояние, константы каталога
// Зависимости: нет

// ══════════════════════════════════════════════
// ДАННЫЕ
// ══════════════════════════════════════════════
const SECS = [
  {id:'terrace',      lbl:'Терраса/Крыльцо',    req:'terrace'},
  {id:'steps',        lbl:'Ступени',            req:'steps'},
  {id:'paths',        lbl:'Дорожки',            req:'paths'},
  {id:'fence',        lbl:'Забор',              req:'fence'},
  {id:'facade',       lbl:'Фасад',              req:'facade'},
  {id:'beds',         lbl:'Грядки',             req:'beds'},
  {id:'furniture',    lbl:'Мебель',             req:'furniture'},
  {id:'pool_terrace', lbl:'Терраса у бассейна', req:'pool_terrace'},
  {id:'pier',         lbl:'Причал',             req:'pier'},
];

// Порядок шагов конфигурации (до шага 10)
// Ключ — id секции, значение — id экрана
// Маппинг легаси-имён типа дома («человеческие» названия из старого мобильного
// флоу) → typeId дескриптора ('type_NN') или 'no_house'. ЕДИНЫЙ источник:
// им пользуются getHouseTypeId (viewer3d-core.js) и dSelHouse (nav-desktop.js) —
// раньше карта дублировалась в обоих файлах.
const HOUSE_TYPE_MAP = {
  'Одноэтажный дом':  'type_01',
  'Двухэтажный дом':  'type_09',
  'Дом с мансардой':  'type_10',
  'Участок без дома': 'no_house',
};

// Дефолтный rect ступеней (нормализованные 0..1 координаты сетки GRID=32 м):
// 2×1.5 м у нижнего края дома. Единый источник для стартового состояния S.steps
// и сбросов (nav-desktop.js) — раньше числа дублировались в трёх местах.
const DEFAULT_STEPS_RECT = { x: 0.45, y: 0.65, w: 0.0625, h: 0.046875 };

const SEC_SCREEN = {
  terrace:      '6',
  pool_terrace: '6b',
  paths:        '6c',
  pier:         '6d',
  porch:        '7',
  fence:        '8',
  // facade убран — сразу переходит к шагу 10
};

// 16 цветов для фильтра
const CATALOG_COLORS = [
  {id:'c1',  hex:'#5C3317', label:'Тёмный дуб'},
  {id:'c2',  hex:'#8B6331', label:'Светлый дуб'},
  {id:'c3',  hex:'#C8A96E', label:'Натуральный'},
  {id:'c4',  hex:'#F5DEB3', label:'Пшеничный'},
  {id:'c5',  hex:'#E8D5B0', label:'Сосна'},
  {id:'c6',  hex:'#D2B48C', label:'Бежевый'},
  {id:'c7',  hex:'#A0522D', label:'Терракот'},
  {id:'c8',  hex:'#704214', label:'Шоколад'},
  {id:'c9',  hex:'#3D2B1F', label:'Венге'},
  {id:'c10', hex:'#1C1C1C', label:'Антрацит'},
  {id:'c11', hex:'#808080', label:'Серый'},
  {id:'c12', hex:'#B0C4B1', label:'Зелёный'},
  {id:'c13', hex:'#E0E0E0', label:'Светло-серый'},
  {id:'c14', hex:'#F5F5F5', label:'Белый'},
  {id:'c15', hex:'#C0A080', label:'Тауп'},
  {id:'c16', hex:'#9B7653', label:'Орех'},
];

// Палитра именованных цветов каталога (имя → hex). Имена — из COLORS.md.
const CATALOG_COLOR_HEX = {
  'Венге': '#3B2A1F', 'Серый': '#8C8C8C', 'Антрацит': '#2C2C30', 'Орех': '#7A4E2A',
  'Тик': '#B5793A', 'Красный': '#9C4332', 'Песочный': '#D8C49E', 'Светло-коричневый': '#B08D5B',
  'Темно-коричневый': '#3E2A1A', 'Бежевый': '#D6BE97', 'Чёрный': '#1A1A1A', 'Белый': '#F2F2F0',
  'Слоновая кость': '#EAE0C8', 'Коричневый': '#6B4423', 'Шоколадный': '#4A2F1E',
  'Тёмно-серый': '#4A4A4D', 'Суар': '#6E4B2A', 'Каштан': '#6A3A28', 'Светло-серый': '#C9C9C9',
  'Дуб': '#9C7A4D', 'Кремовый': '#EFE2C8', 'Шоколад': '#4A2F1E',
  'Chocolate mix': '#5A3A22', 'Suar mix': '#6E4B2A', 'Snow mix': '#ECECE8', 'Sand mix': '#D8C49E',
  'Grey dark': '#4A4A4D', 'White': '#F2F2F0',
};

// Набор цветов на тип элемента (имена из COLORS.md). railing — подрежим террасы
// (Ограждения для террасы). paths/pool_terrace/pier берут набор террасной доски.
const ELEMENT_COLOR_NAMES = {
  terrace: ['Венге', 'Серый', 'Антрацит', 'Орех', 'Тик', 'Красный', 'Песочный'],
  railing: ['Антрацит', 'Орех', 'Светло-коричневый', 'Темно-коричневый', 'Бежевый', 'Серый',
            'Песочный', 'Чёрный', 'Белый', 'Венге'],
  steps: ['Венге', 'Серый', 'Антрацит', 'Орех', 'Тик', 'Слоновая кость', 'Красный', 'Чёрный',
          'Темно-коричневый', 'Песочный', 'Светло-коричневый', 'Бежевый', 'Коричневый',
          'Шоколадный', 'Тёмно-серый', 'Белый', 'Суар', 'Каштан'],
  fence: ['Венге', 'Серый', 'Антрацит', 'Орех', 'Коричневый', 'Чёрный', 'Белый',
          'Темно-коричневый', 'Песочный', 'Светло-коричневый', 'Светло-серый', 'Бежевый',
          'Тёмно-серый', 'Слоновая кость', 'Красный'],
  facade: ['Chocolate mix', 'Suar mix', 'Snow mix', 'Sand mix', 'Grey dark', 'White', 'Орех',
           'Серый', 'Венге', 'Антрацит', 'Тик', 'Чёрный', 'Темно-коричневый', 'Песочный',
           'Светло-коричневый', 'Бежевый', 'Дуб', 'Коричневый', 'Кремовый', 'Шоколад'],
  beds: ['Венге', 'Серый', 'Коричневый'],
};

const PRICE_TIERS = [
  {id:'budget',    lbl:'Бюджетно',             sub:'до 2 000 ₽/м²'},
  {id:'balanced',  lbl:'Сбалансировано',        sub:'2 000 – 5 000 ₽/м²'},
  {id:'premium',   lbl:'Премиальное качество',  sub:'от 5 000 ₽/м²'},
  {id:'mpk',       lbl:'Доска из МПК',          sub:'от 10 000 ₽/м²'},
];

// Реальные разделы каталога API (bitrix_id). Курируем подмножество «товарных»
// категорий, у которых реально есть продукты (часть родительских разделов пуста —
// товары только в дочерних, см. readme API). Используются в селекторе раздела.
const CATALOG_SECTIONS = [
  { id: 2314, label: 'Террасная доска ДПК' },
  { id: 2315, label: 'Универсальная доска ДПК' },
  { id: 2330, label: 'Ступени из ДПК' },
  { id: 2357, label: 'Грядки из ДПК' },
  { id: 2332, label: 'Ограждения террасы ДПК' },
  { id: 2348, label: 'Штакетник из ДПК' },
  { id: 2683, label: 'Фасадные панели ДПК' },
  { id: 2442, label: 'Садовые диваны' },
  { id: 2448, label: 'Садовые столы' },
];

// Дефолтный раздел каталога для каждого элемента проекта (sidebar) → bitrix_id.
const CONSTRUCTION_TO_SECTION = {
  terrace: 2314, paths: 2314, pool_terrace: 2314, pier: 2314,
  steps: 2330, beds: 2357, fence: 2348, facade: 2683, furniture: 2442,
};

// Тег раздела для выборки ТЕКСТУРИРОВАННЫХ товаров. Превью и 3D-текстуры (texture_urls)
// бэкенд отдаёт только у товаров, помеченных тегом (см. пресеты бэкендера). Без тега раздел
// возвращает все товары, но без texture_urls — тогда превью/текстуры «не приходят». Ключ — bitrix_id.
const SECTION_TAGS = {
  2314: 'terrasnaya_doska',   // террасная доска ДПК
  2329: 'terrasnaya_doska',   // террасная доска МПК
  2330: 'dpk_steps',          // ступени ДПК
  2683: 'walls',              // фасадные панели ДПК
  2680: 'walls',              // фасадные системы ДПК
  2345: 'walls',              // фасадные панели МПК
};

// Материалы дома (шаг «Параметры дома»). Образцы — квадраты: с текстурой (img из
// assets/) или однотонные (color). id используются в 3D (_houseTexSet в viewer3d-core).
const HOUSE_MATERIALS = {
  roof: {
    label: 'Материал крыши',
    items: [
      { id: 'tile',        img: 'assets/roof_diff_01.jpg' }, // черепица
      { id: 'metal_green', img: 'assets/roof_diff_02.jpg' }, // металл зелёный
      { id: 'metal_red',   img: 'assets/roof_diff_03.jpg' }, // металл красный
    ],
  },
  base: {
    label: 'Материал фундамента',
    items: [
      { id: 'concrete', color: '#9a9a9a' },                  // бетон (без текстуры, серый)
      { id: 'stone',    img: 'assets/base_diff_01.jpg' },    // камень
    ],
  },
  wall: {
    label: 'Материал стен',
    items: [
      { id: 'stucco', color: '#efe2c8' },                    // штукатурка (без текстуры, св.-бежевая)
      { id: 'brick',  img: 'assets/wall_diff_01.jpg' },      // кирпич
      { id: 'siding', img: 'assets/wall_diff_02.jpg' },      // сайдинг
    ],
  },
};

// Позиции из каталога outdoor-mebel.ru — Доска ДПК универсальная
const STUB_RESULTS = [
  {
    id:1, ic:'🟫',
    name:'TalverWood Стандарт 150×25',
    short:'ДПК, двусторонняя, вельвет/гладкая, 5 цветов',
    detail:'Доска ДПК бренда TalverWood. Состав: 60% древесная мука, 40% полимер. Размер: 150×25×4000 мм. Поверхность с двух сторон: вельвет + гладкая. Цвета: тик, венге, серый, кофе, белый. Гарантия 10 лет.',
    price:'от 1 850 ₽/м²',
    color:'#8B6331',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/talverwood',
  },
  {
    id:2, ic:'🟤',
    name:'AIWOODek Premium 140×22',
    short:'ДПК, полнотелая, скрытый крепёж, 8 цветов',
    detail:'Террасная доска AIWOODek Premium. Полнотелый профиль — повышенная жёсткость. Размер: 140×22×4000 мм. Система скрытого крепежа в комплекте. Фактура: натуральное дерево. Цвета: 8 вариантов от светлого дуба до антрацита.',
    price:'от 2 400 ₽/м²',
    color:'#704214',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/terrasnaya_doska_aiwood',
  },
  {
    id:3, ic:'🪵',
    name:'NauticPrime Prestige 163×23',
    short:'ДПК, широкая, коэкструзия, морозостойкая',
    detail:'Доска NauticPrime серии Prestige. Технология коэкструзии — защитный полимерный слой снаружи. Ширина 163 мм — меньше стыков. Устойчива к морозу до −50°C и УФ-излучению. Не требует покраски весь срок службы (25 лет).',
    price:'от 3 700 ₽/м²',
    color:'#5C3317',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/nauticprime',
  },
  {
    id:4, ic:'⬜',
    name:'POLIVAN Eco Line 120×28',
    short:'ДПК, лёгкая полая, бюджетный сегмент',
    detail:'Доска POLIVAN серии Eco Line. Полый профиль — снижает вес и стоимость настила. Размер: 120×28×3000 мм. Простой монтаж на лаги с шагом 300–400 мм. Оптимальный выбор для дачных террас и беседок.',
    price:'от 1 350 ₽/м²',
    color:'#D2B48C',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/polivan',
  },
];

// ══════════════════════════════════════════════
// СОСТОЯНИЕ
// ══════════════════════════════════════════════
const S = {
  houseType: null,
  sections: [],
  // pool_terrace/paths/pier/fence — polygon-режим (массив точек).
  // terrace — multi-rect (см. terraceRects).
  pts: { pool_terrace:[], paths:[], pier:[], fence:[] },
  // Терраса/Крыльцо: массив прямоугольников (boolean union в 3D).
  // Все координаты нормированные 0..1 (как в canvas).
  terraceRects: [],
  activeTerraceRect: null, // индекс выбранного rect или null
  // Ступени: один rect (положение + ширина = от пользователя; глубина в 3D
  // пересчитывается автоматически из количества подступенков).
  steps: { ...DEFAULT_STEPS_RECT },
  // Грядки: массив прямоугольников фиксированного размера 3×1 м. Ориентация
  // ортогональная — длинная сторона (3 м) вдоль X (w>h) или вдоль Y (w<h).
  // Размер не меняется (только перемещение + поворот на 90°). Координаты 0..1.
  beds: [],
  activeBed: null,   // индекс выбранной грядки или null
  bedH: 0.20,        // высота борта грядки в метрах (одна на все; 0.15/0.20/0.27/0.30)
  fenceH: 1.5,       // высота полотна забора в метрах (1.5 | 1.9)
  mats: {},
  // Материал настила по элементу (терраса/ступени/дорожки/грядки/бассейн/причал):
  // elementId -> { textures } | { color }. Применяется независимо в buildScene3d.
  elementMat: {},
  samples: [],    // [{id, name, color}] — накопленные образцы
  activeSample: null, // {id, name, color} — текущий выбранный для примерки
  curSec: 0,
  matSubMode: null,    // 'railing' when editing terrace railing material
  catColors: new Set(),
  catPrice: null,
  catSection: null,    // выбранный раздел каталога (bitrix_id) или null = дефолт по элементу
  catShowResults: false,
  estimate: {},        // elementId -> { id, name, price } — выбранный в смету товар по элементу
  // Тумблеры canvas-редакторов (id из data-id → bool): 'terrace-railing',
  // 'terrace-roof', 'steps-railing', 'steps-sheathing'… Зеркалируются из DOM
  // в ttg/_dCacheToggleDefaults — 3D-слой читает ТОЛЬКО отсюда (tgOn), не DOM.
  toggles: {},
  pathWidth: 120,      // ширина дорожки, см (инпут v-paths-width зеркалится сюда)
  // Материалы дома (шаг «Параметры дома»).
  roofMat: 'tile',     // tile | metal_green | metal_red
  baseMat: 'concrete', // concrete | stone
  wallMat: 'stucco',   // stucco | brick | siding
};
const TOTAL = 10;
let step = 1;

// Участок без дома. Единый источник истины для canvas.js / viewer3d-core.js:
// десктоп хранит в S.houseType typeId ('type_NN') или 'no_house' («Пустой участок»);
// null — тип ещё не выбран (дом тоже не рисуем). Легаси-строка — от старого мобильного флоу.
function isEmptyLot() {
  return !S.houseType || S.houseType === 'no_house' || S.houseType === 'Участок без дома';
}

// Состояние тумблера редактора по data-id ('terrace-roof', 'steps-railing'…).
// Единственный способ чтения тумблеров из 3D-слоя (viewer3d-*): DOM там не трогаем.
function tgOn(id) {
  return !!(S.toggles && S.toggles[id]);
}

// ══════════════════════════════════════════════
