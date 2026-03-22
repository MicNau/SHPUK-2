# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус: фронтенд разбит на файлы, 3D-визуализация улучшена, бэкенд не начат

---

## Структура файлов (текущая)

```
/frontend
  index.html              # разметка + динамический выбор viewer3d-*.js
  styles.css              # все стили
  state.js                # S, SECS, SEC_SCREEN, CATALOG_COLORS, PRICE_TIERS, STUB_RESULTS
  nav.js                  # goTo, updProg, getStepOrder и навигационные хелперы
  canvas.js               # pan/zoom движок, snap-canvas, крыльцо (drag+resize)
  viewer3d-core.js        # init3dCanvas, HDRI-загрузчик, PBR-текстуры, buildHouse3d
  viewer3d-desktop.js     # антураж десктоп: InstancedMesh трава + шейдер, кусты, деревья
  viewer3d-mobile.js      # антураж мобиль: billboard-спрайты, плоские пятна травы
  catalog.js              # каталог, фильтры, результаты, selMat
  ui.js                   # шаг 10: секции, образцы, итог

/backend                  # ещё не создан
  main.py
  calculator.py
  models.py
  database.py
  /migrations

ARCHITECTURE.md
README.md
```

### Порядок подключения скриптов в index.html

```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader
state.js → nav.js → canvas.js
→ [JS-детектор] → viewer3d-core.js → viewer3d-desktop.js | viewer3d-mobile.js
catalog.js → ui.js
```

Детектор платформы в `index.html` (клиентский):
```javascript
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
              || window.innerWidth < 768;
```
При появлении бэкенда: заменить на серверный выбор файла через шаблон FastAPI (`Jinja2`).

---

## Объект состояния S (фронтенд)

```javascript
const S = {
  houseType: 'Одноэтажный дом',  // string | null
  sections: ['terrace', 'porch'], // выбранные конструкции из шага 5
  pts: {
    terrace:      [{x,y}, ...],   // точки полигона (нормализованные 0..1)
    pool_terrace: [{x,y}, ...],
    paths:        [{x,y}, ...],   // ломаная (не замкнутая)
    pier:         [{x,y}, ...],
    fence:        [{x,y}, ...],
  },
  porch: { x, y, w, h },         // нормализованные координаты 0..1
  mats: {},                       // выбранные материалы по секции
  samples: [{ id, name }],        // накопленные образцы (не заменяют друг друга)
  curSec: 0,
  catColors: Set,
  catPrice: null,
  catShowResults: false,
};
let step = 1;                     // текущий шаг (число или 'catalog' | 'summary')
```

---

## Архитектура viewer3d

### viewer3d-core.js — общий код обеих версий

- `init3dCanvas()` — инициализация renderer, scene, camera, OrbitControls, освещение, земля
- `_injectHdriButton()` — добавляет кнопку «Загрузить HDRI» в `.sh` шага 10
- `_onHdriFile()` — читает `.hdr` / `.exr`, строит PMREM, применяет `scene.environment`
- `getHouseMats()` — возвращает PBR-материалы с процедурными текстурами (см. ниже)
- `buildHouse3d()` — параметрическая модель дома: цоколь, стены с окнами, крыша, терраса
- `_buildProceduralSky()` — ShaderMaterial небо с солнечным ореолом (до загрузки HDRI)
- `resizeThree()` — адаптация при изменении размера окна

Хуки для версионных файлов:
- `_buildEntourage(scene)` — вызывается один раз при инициализации
- `_onAnimFrame(t)` — вызывается каждый кадр (анимация травы на десктопе)

### viewer3d-desktop.js

| Функция | Описание |
|---------|----------|
| `_buildDesktopGrass(scene)` | 14 000 стеблей через `InstancedMesh`. Шейдер ветра через `mat.onBeforeCompile` — синусоидальное покачивание нарастает к верхушке (квадратичная зависимость от `uv.y`). Градиент цвета корень→верхушка в `fragmentShader`. |
| `_buildDesktopBushes(scene)` | 14 кустов: 2–3 цилиндра-ствола + 5–9 сфер-листьев трёх оттенков зелёного. |
| `_buildDesktopTrees(scene)` | 10 деревьев: цилиндр-ствол + 2–3 слоя конусов-кроны. |

### viewer3d-mobile.js

| Функция | Описание |
|---------|----------|
| `_buildMobileBushes(scene)` | 12 `THREE.Sprite` с canvas-текстурой куста. 2 материала → 2 draw calls. |
| `_buildMobileTrees(scene)` | 10 `THREE.Sprite` с canvas-текстурой дерева. 2 материала → 2 draw calls. |
| `_buildMobileGrassPatches(scene)` | 200 крестов из плоских `Mesh` (PlaneGeometry) с canvas-текстурой пучка травы. |

### PBR материалы (viewer3d-core.js → getHouseMats)

| Материал | Тип | Карты |
|----------|-----|-------|
| `wall` — штукатурка | MeshStandardMaterial | map (шум, тёплый белый) + normalMap (случайный) + roughnessMap |
| `base` — цоколь | MeshStandardMaterial | map (кирпичная кладка с вариацией) |
| `roof` — крыша | MeshStandardMaterial | map (черепица 32×20 пикс.) + roughnessMap |
| `glass` — стекло | **MeshPhysicalMaterial** | transmission 0.88, ior 1.46, reflectivity 0.88 |
| `frame` — рамы | MeshStandardMaterial | metalness 0.28, roughness 0.28 |
| `door` — дверь | MeshStandardMaterial | цвет #4a2e18 |
| `deck` — ДПК | MeshStandardMaterial | map (доски с вельветом, repeat 1×6) |

Все материалы получают `envMap` автоматически при загрузке HDRI.

---

## JSON-контракт (планируемый)

Что конфигуратор отправляет на бэкенд (`POST /api/calculate`):

```json
{
  "project": {
    "house_type": "Одноэтажный дом",
    "area": 120,
    "floor_height": 300
  },
  "constructions": {
    "terrace": {
      "enabled": true,
      "area_m2": 24.5,
      "perimeter_m": 20.0,
      "has_railing": true,
      "has_roof": false
    },
    "porch": {
      "enabled": true,
      "width_m": 2.4,
      "depth_m": 1.5,
      "has_railing": false
    },
    "fence":        { "enabled": true,  "perimeter_m": 48.0 },
    "paths":        { "enabled": false },
    "pier":         { "enabled": false },
    "pool_terrace": { "enabled": false }
  },
  "materials": {
    "terrace": { "product_id": 2, "name": "AIWOODek Premium 140×22" }
  }
}
```

Что бэкенд возвращает:

```json
{
  "summary": {
    "total_rub": 187400,
    "items": [
      {
        "construction": "terrace",
        "label": "Терраса",
        "material": "AIWOODek Premium 140×22",
        "area_m2": 24.5,
        "price_per_m2": 2400,
        "qty_boards": 148,
        "subtotal_rub": 58800
      }
    ]
  }
}
```

---

## API эндпоинты (планируемые)

| Метод | URL | Описание |
|-------|-----|----------|
| `POST` | `/api/calculate` | Принимает конфигурацию, возвращает смету |
| `GET`  | `/api/catalog` | Список материалов с фильтрами |
| `GET`  | `/api/catalog/{id}` | Один товар |
| `POST` | `/api/projects` | Сохранить проект |
| `GET`  | `/api/projects/{id}` | Загрузить проект |

Query-параметры для `/api/catalog`:
- `section=terrace`
- `price_tier=balanced`
- `colors=natural,grey`

---

## Схема БД (планируемая)

```sql
CREATE TABLE products (
  id           SERIAL PRIMARY KEY,
  brand        VARCHAR(100),
  name         VARCHAR(200),
  section      VARCHAR(50),
  price_rub    INTEGER,
  price_tier   VARCHAR(20),   -- 'budget' | 'balanced' | 'premium' | 'mpk'
  colors       TEXT[],
  width_mm     INTEGER,
  thickness_mm INTEGER,
  length_mm    INTEGER,
  description  TEXT,
  url          VARCHAR(500)
);

CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMP DEFAULT now(),
  config_json   JSONB,
  estimate_json JSONB
);
```

---

## Расчётный модуль (логика, ещё не реализован)

- **Площадь настила** → из canvas (формула Гаусса по точкам полигона)
- **Количество досок** = `ceil(area / (board_width_m * board_length_m)) * 1.1`
- **Погонаж лаг** = `area / 0.4` (шаг 400 мм)
- **Крепёж** = `qty_boards * 8` (8 клипс на доску)
- **Подрезка** = +5% прямоугольник / +15% сложная форма

Приоритет: терраса → крыльцо → дорожки.

---

## Решения, принятые в процессе

| Решение | Почему |
|---------|--------|
| Vanilla JS, без фреймворков | Нет сборки, быстрая итерация, достаточно для прототипа |
| Three.js r128 | Стабильная версия, всё необходимое есть на CDN |
| Разбивка на файлы без бандлера | Простота развёртывания, nginx отдаёт статику напрямую |
| viewer3d-core + desktop/mobile | Общая логика один раз, антураж — отдельно под каждую платформу |
| IS_MOBILE через UA + innerWidth | Достаточно для прототипа; при бэкенде заменить на серверный выбор |
| RGBELoader/EXRLoader через CDN | Статическое подключение надёжнее динамического `loadScript` |
| onBeforeCompile для травы | Позволяет добавить шейдер ветра к MeshLambertMaterial без потери instancing |
| MeshPhysicalMaterial для стекла | transmission + ior дают реалистичное преломление без дополнительных проходов |
| Образцы накапливаются, не заменяют | UX: клиент хочет сравнивать несколько материалов |
| Фасад убран из навигации | Упрощение UX по запросу клиента |
| FastAPI для бэкенда | Python удобен для расчётного модуля, быстрый старт |
