// ══════════════════════════════════════════════
// STATE.JS — глобальное состояние и константы
// ══════════════════════════════════════════════

const SECS = [
  {id:'terrace',      lbl:'Терраса',            req:'terrace'},
  {id:'pool_terrace', lbl:'Терраса у бассейна',  req:'pool_terrace'},
  {id:'paths',        lbl:'Дорожки',             req:'paths'},
  {id:'pier',         lbl:'Причал',              req:'pier'},
  {id:'porch',        lbl:'Крыльцо',             req:'porch'},
  {id:'railing',      lbl:'Ограждение',          req:'railing'},
  {id:'fence',        lbl:'Забор',               req:'fence'},
  {id:'facade',       lbl:'Фасад',               req:'facade'},
  {id:'beds',         lbl:'Грядки',              req:'beds'},
  {id:'furniture',    lbl:'Мебель',              req:'furniture'},
];

// Порядок шагов конфигурации — ключ: id секции, значение: id экрана
const SEC_SCREEN = {
  terrace:      '6',
  pool_terrace: '6b',
  paths:        '6c',
  pier:         '6d',
  porch:        '7',
  fence:        '8',
};

// 16 цветов для фильтра каталога
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

const PRICE_TIERS = [
  {id:'budget',   lbl:'Бюджетно',            sub:'до 2 000 ₽/м²'},
  {id:'balanced', lbl:'Сбалансировано',       sub:'2 000 – 5 000 ₽/м²'},
  {id:'premium',  lbl:'Премиальное качество', sub:'от 5 000 ₽/м²'},
  {id:'mpk',      lbl:'Доска из МПК',         sub:'от 10 000 ₽/м²'},
];

// Заглушка каталога (заменится на GET /api/catalog)
const STUB_RESULTS = [
  {
    id:1, ic:'🟫',
    name:'TalverWood Стандарт 150×25',
    short:'ДПК, двусторонняя, вельвет/гладкая, 5 цветов',
    detail:'Доска ДПК бренда TalverWood. Состав: 60% древесная мука, 40% полимер. Размер: 150×25×4000 мм. Поверхность с двух сторон: вельвет + гладкая. Цвета: тик, венге, серый, кофе, белый. Гарантия 10 лет.',
    price:'от 1 850 ₽/м²',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/talverwood',
  },
  {
    id:2, ic:'🟤',
    name:'AIWOODek Premium 140×22',
    short:'ДПК, полнотелая, скрытый крепёж, 8 цветов',
    detail:'Террасная доска AIWOODek Premium. Полнотелый профиль — повышенная жёсткость. Размер: 140×22×4000 мм. Система скрытого крепежа в комплекте. Фактура: натуральное дерево. Цвета: 8 вариантов от светлого дуба до антрацита.',
    price:'от 2 400 ₽/м²',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/terrasnaya_doska_aiwood',
  },
  {
    id:3, ic:'🪵',
    name:'NauticPrime Prestige 163×23',
    short:'ДПК, широкая, коэкструзия, морозостойкая',
    detail:'Доска NauticPrime серии Prestige. Технология коэкструзии — защитный полимерный слой снаружи. Ширина 163 мм — меньше стыков. Устойчива к морозу до −50°C и УФ-излучению. Не требует покраски весь срок службы (25 лет).',
    price:'от 3 700 ₽/м²',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/nauticprime',
  },
  {
    id:4, ic:'⬜',
    name:'POLIVAN Eco Line 120×28',
    short:'ДПК, лёгкая полая, бюджетный сегмент',
    detail:'Доска POLIVAN серии Eco Line. Полый профиль — снижает вес и стоимость настила. Размер: 120×28×3000 мм. Простой монтаж на лаги с шагом 300–400 мм. Оптимальный выбор для дачных террас и беседок.',
    price:'от 1 350 ₽/м²',
    url:'https://outdoor-mebel.ru/catalog/terrasnaya_doska_iz_dpk/doska_dpk_universalnaya/polivan',
  },
];

// ── Состояние приложения ──────────────────────
const S = {
  houseType: null,
  sections: [],
  pts: { terrace:[], pool_terrace:[], paths:[], pier:[], fence:[] },
  porch: { x:0.3, y:0.3, w:0.2, h:0.12 },
  mats: {},
  samples: [],       // [{id, name}] — накопленные образцы
  curSec: 0,
  catColors: new Set(),
  catPrice: null,
  catShowResults: false,
};

const TOTAL = 10;   // всего шагов для прогресс-бара
let step = 1;       // текущий шаг (число или строка: 'catalog', 'summary')
