# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус: фронтенд разбит на файлы, PBR-визуализация работает, GLB-растительность готова (ожидают ассеты), десктоп-UI создан и отлажен (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance), бэкенд не начат

---

## Структура файлов (текущая)

```
/frontend — мобильная версия (wizard)
  index.html              # разметка + JS-детектор платформы, подключает viewer3d-*
  styles.css              # все стили (мобильный wizard, max-width 480px)
  nav.js                  # goTo, updProg, getStepOrder и навигационные хелперы
  ui.js                   # шаг 10: секции, образцы, примерка
  catalog.js              # каталог, фильтры, результаты, selMat

/frontend — десктопная версия (3-column workspace)
  index-desktop.html      # 3 экрана: выбор дома → параметры+3D → workspace
  styles-desktop.css      # все стили (3-column layout, topbar, sidebar, panel)
  nav-desktop.js          # dGoTo, sidebar, canvas editors, right panel, catalog

/frontend — общие файлы (используются обеими версиями)
  state.js                # S, SECS, SEC_SCREEN, CATALOG_COLORS, PRICE_TIERS, STUB_RESULTS
  canvas.js               # pan/zoom движок, snap-canvas, крыльцо (drag+resize)
  viewer3d-core.js        # сцена, HDRI, PBR-материалы, buildScene3d, все 3D-строители
  viewer3d-desktop.js     # антураж десктоп: GLB-модели → PNG cross-billboard → процедурный fallback
  viewer3d-mobile.js      # антураж мобиль: GLB-модели → PNG cross-billboard → процедурный fallback

  assets/                 # текстуры, HDRI и 3D-модели растительности
    README.md             # описание соглашения по именам файлов
    environment.hdr       # HDRI карта окружения (опционально)
    wall_diff.jpg / wall_norm.jpg / wall_roug.jpg
    roof_diff.jpg / roof_norm.jpg / roof_roug.jpg
    base_diff.jpg / base_norm.jpg
    deck_diff.jpg / deck_norm.jpg / deck_roug.jpg
    bush_a.glb / bush_b.glb           # 3D-кусты (Blender → glTF Binary)
    tree_a.glb / tree_b.glb           # 3D-деревья (Blender → glTF Binary)
    bush_a.png / bush_b.png           # PNG-спрайты кустов (fallback)
    tree_a.png / tree_b.png           # PNG-спрайты деревьев (fallback)

/backend                  # ещё не создан
  main.py
  calculator.py
  models.py
  database.py
  /migrations

ARCHITECTURE.md
README.md
```

### Порядок подключения скриптов

**Мобильная (index.html):**
```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader → GLTFLoader
state.js → nav.js → canvas.js
→ [JS-детектор] → viewer3d-core.js → viewer3d-desktop.js | viewer3d-mobile.js
ui.js → catalog.js
```

**Десктопная (index-desktop.html):**
```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader → GLTFLoader
state.js → canvas.js → viewer3d-core.js → viewer3d-desktop.js → nav-desktop.js
```

Все скрипты подключаются с query-string `?v=N` для сброса кэша браузера (текущая: v=13).

Детектор платформы в `index.html` (клиентский):
```javascript
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
              || window.innerWidth < 768;
```
При появлении бэкенда: заменить на серверный выбор через шаблон FastAPI (Jinja2).

---

## Объект состояния S (фронтенд)

```javascript
const S = {
  houseType: 'Одноэтажный дом',  // string | null
  sections: ['terrace', 'porch'], // выбранные конструкции из шага 5
  pts: {
    terrace:      [{x,y}, ...],   // точки полигона (нормализованные 0..1)
    pool_terrace: [{x,y}, ...],
    paths:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
    pier:         [{x,y}, ...],
    fence:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
  },
  porch:        { x, y, w, h },  // нормализованные координаты 0..1, кратные SNAP/GRID
  mats:         {},               // выбранные материалы по секции
  samples:      [{ id, name, color }], // накопленные образцы
  activeSample: null,             // текущий образец для примерки
  matSubMode:   null,             // 'deck' | 'railing' — подрежим материала террасы
  curSec:       0,
  catColors:    Set,
  catPrice:     null,
  catShowResults: false,
};
let step = 1; // текущий шаг (число или 'catalog' | 'summary')
```

---

## Архитектура viewer3d

### viewer3d-core.js — общий код обеих версий

**Инициализация:**
- `init3dCanvas(slotId)` — создаёт renderer, scene, camera, OrbitControls, освещение, землю. При повторном вызове перемещает renderer в новый слот (`moveThreeTo`).
- `_autoLoadHdri()` — при старте пробует загрузить `assets/environment.hdr`. Нашёл → PMREMGenerator → `scene.environment`, скрывает процедурное небо.
- `_injectHdriButton()` — кнопка ручной загрузки `.hdr`/`.exr` на шаге 10.
- `_applyHdri()` — при применении HDRI корректирует баланс освещения: `sunLight.intensity = 1.8`, `ambLight.intensity = 0.0`, `toneMappingExposure = 0.85` для сохранения контрастных теней.

**Загрузка текстур:**
- `_loadTex(filename, repeat)` — albedo, sRGBEncoding, с кэшом и placeholder.
- `_loadNorm(filename, repeat)` — normal map, LinearEncoding.
- `_loadData(filename, repeat)` — roughness/AO, LinearEncoding.
- Земля загружается отдельным загрузчиком без placeholder (избегаем `Object.assign` по uuid).

**Процедурные текстуры (ground):**
- `_makeGroundMat()` — создаёт MeshStandardMaterial с процедурными diffuse + normal map.
- `_generateGroundTex()` — 1024×1024 canvas с органическими эллиптическими пятнами (не круглыми). Используется `ctx.save/translate/rotate/scale` для разнообразия форм.
- `_generateGrassNormal()` — 512×512 процедурная normal map с 60 000 травинок, имитирующая газонную поверхность. RepeatWrapping 14×14.

**UV-проекция:**
- `_applyBoxUV(mesh, tileSize, groupOffset)` — кубическая UV-проекция, вычисляется на CPU из локальных позиций вершин + суммарного смещения групп-родителей.
- `_wallUVHelper(grp, grpOff)` — рекурсивно обходит группу стен, передаёт накопленный offset.

**Геометрия:**
- `buildScene3d()` — главный строитель: дом, терраса, крыльцо, дорожки, забор, перила.
- `buildHouseMeshes()` — стены с окнами/дверью, цоколь, двускатная крыша с UV.
- `xWallWithWins(len, wins, extZ)` — стена по X с окнами и внешними подоконниками. `extZ` определяет сторону подоконника (0 = ближняя, wt = дальняя).
- `zWallWithDoor(zLen, hasDoor, hasWins, extX)` — стена по Z с дверью/окнами и подоконниками. `extX` определяет сторону.
- `buildTerrace3d()` — настил из досок + лаги + опоры по полигону + юбка (skirt panels, deck-материал, толщина 0.06). Высота настила = `foundH - 0.01` (на 1 см ниже цоколя, чтобы избежать z-fighting).
- `buildPorch3d()` — площадка + ступени с автоопределением направления + боковые панели (deck-материал, толщина 0.06).
- `buildPaths3d()`, `buildFence3d()` — поддерживают multi-line через `splitAtBreaks()`.
- `buildRailing3d()` — ограждение террасы.
- `_buildProceduralSky()` — ShaderMaterial небо с солнечным ореолом (до HDRI).

**Освещение и тени:**
- Направленный свет (`sunLight`): shadow camera 26×26, near 0.5, far 80, bias -0.0003, normalBias 0.02, radius 3 (mobile) / 5 (desktop).
- При HDRI: sunLight.intensity 1.8, ambLight.intensity 0.0, exposure 0.85.

**Площадка под домом:**
- Box 5 см высотой, на 30 см шире фундамента по каждой стороне.
- Материал: чёрный (`0x000000`), roughness 0.95.

**Коллизия растительности (`occupiedZones`):**
- `threeState.occupiedZones` — массив зон, с которыми растительность не должна пересекаться.
- Типы зон: `rect` (дом, крыльцо), `poly` (терраса, причал), `path` (дорожки с шириной).
- Вычисляются перед вызовом `_buildEntourage()`.

**Растительность (`vegGroup`):**
- Отдельная группа в сцене (`threeState.vegGroup`), очищается при каждом `buildScene3d()`.
- Генерационный счётчик `_vegGen` — предотвращает дублирование при async-загрузке GLB.

**Хуки для версионных файлов:**
- `_buildEntourage(scene)` — вызывается при инициализации.
- `_onAnimFrame(t)` — каждый кадр.

### viewer3d-desktop.js и viewer3d-mobile.js

Обе версии используют трёхуровневую fallback-цепочку для растительности:

1. **GLB модели** (bush_a.glb, bush_b.glb, tree_a.glb, tree_b.glb) — загружаются через GLTFLoader. Автоматическое масштабирование по bounding box, центрирование по основанию, включение теней.
2. **PNG спрайты** (bush_a.png, tree_a.png и т.д.) — cross-billboard (пересекающиеся PlaneGeometry). Mobile: 2 плоскости для кустов и деревьев. Desktop: 2 для кустов, 3 для деревьев.
3. **Процедурные canvas-текстуры** — `_fallbackBush()` и `_fallbackTree()` создают 256×256 canvas с эллиптическими кронами и стволами.

Каждый тип (кусты/деревья) загружается независимо — если GLB кустов отсутствует, но GLB деревьев есть, кусты будут спрайтами, а деревья — 3D-моделями.

Материалы спрайтов: `alphaTest: 0.15`, `depthWrite: false`, `toneMapped: false`, `color: (0.75, 0.75, 0.75)`, `side: DoubleSide`.

### PBR материалы (viewer3d-core.js → getHouseMats)

| Материал | Тип | Текстуры из assets/ | UV | Особенности |
|----------|-----|---------------------|----|-------------|
| `wall` — штукатурка | MeshStandardMaterial | wall_diff/norm/roug | кубическая, 2 м/тайл | |
| `base` — цоколь | MeshStandardMaterial | base_diff/norm | кубическая, 1 м/тайл | |
| `roof` — крыша | MeshStandardMaterial | roof_diff/norm/roug | по скату, 8 м/тайл | |
| `glass` — стекло | MeshPhysicalMaterial | — | — | opacity 0.38, metalness 0.82, color 0x4a6878 |
| `frame` — рамы | MeshStandardMaterial | — | — | metalness 0.28, polygonOffset: -1/-1 |
| `door` — дверь | MeshStandardMaterial | — | — | цвет #5c3a1e |
| `deck` — ДПК настил | MeshStandardMaterial | deck_diff/norm/roug | геометрические UV досок | |
| `ground` — земля | MeshStandardMaterial | процедурные | repeat 14×14 (normal) | _generateGroundTex + _generateGrassNormal |

Все материалы получают `envMap` автоматически при загрузке HDRI.

### Соглашение по GLB-моделям растительности

| Файл | Описание | Примерный размер |
|------|----------|------------------|
| `bush_a.glb` | Куст, вариант A | ~1–1.5 м высота |
| `bush_b.glb` | Куст, вариант B | ~1–1.5 м высота |
| `tree_a.glb` | Дерево, вариант A | ~3–5 м высота |
| `tree_b.glb` | Дерево, вариант B | ~3–5 м высота |

**Требования к экспорту из Blender:**
- Формат: glTF Binary (.glb)
- Масштаб: 1 unit = 1 метр
- Origin: у основания ствола (Y=0)
- Ось вверх: Y-up (стандарт glTF)
- Материалы: Principled BSDF (PBR)
- Полигонаж: до 5–10 тыс. треугольников на модель
- Текстуры: embedded в GLB
- Draco-сжатие: НЕ использовать (Three.js r128 требует отдельный декодер)

Размер в файле не критичен — код автоматически масштабирует модель.

### Соглашение по именам файлов assets/

Подробная таблица с размерами и источниками в `assets/README.md`.
Рекомендованные источники: polyhaven.com (CC0), ambientcg.com.

---

## JSON-контракт (планируемый)

`POST /api/calculate` — запрос:

```json
{
  "project": { "house_type": "Одноэтажный дом", "area": 120, "floor_height": 300 },
  "constructions": {
    "terrace":      { "enabled": true, "area_m2": 24.5, "perimeter_m": 20.0, "has_railing": true },
    "porch":        { "enabled": true, "width_m": 2.4, "depth_m": 1.5 },
    "fence":        { "enabled": true, "perimeter_m": 48.0 },
    "paths":        { "enabled": false },
    "pier":         { "enabled": false },
    "pool_terrace": { "enabled": false }
  },
  "materials": {
    "terrace": { "product_id": 2, "name": "AIWOODek Premium 140×22" }
  }
}
```

Ответ:

```json
{
  "summary": {
    "total_rub": 187400,
    "items": [
      { "construction": "terrace", "label": "Терраса", "material": "AIWOODek Premium 140×22",
        "area_m2": 24.5, "price_per_m2": 2400, "qty_boards": 148, "subtotal_rub": 58800 }
    ]
  }
}
```

---

## API эндпоинты (планируемые)

| Метод | URL | Описание |
|-------|-----|----------|
| `POST` | `/api/calculate` | Принимает конфигурацию, возвращает смету |
| `GET`  | `/api/catalog` | Список материалов (`section`, `price_tier`, `colors`) |
| `GET`  | `/api/catalog/{id}` | Один товар |
| `POST` | `/api/projects` | Сохранить проект |
| `GET`  | `/api/projects/{id}` | Загрузить проект |

---

## Схема БД (планируемая)

```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY, brand VARCHAR(100), name VARCHAR(200),
  section VARCHAR(50), price_rub INTEGER, price_tier VARCHAR(20),
  colors TEXT[], width_mm INTEGER, thickness_mm INTEGER, length_mm INTEGER,
  description TEXT, url VARCHAR(500)
);
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMP DEFAULT now(),
  config_json JSONB, estimate_json JSONB
);
```

---

## Расчётный модуль (логика, ещё не реализован)

- **Площадь настила** → формула Гаусса по точкам полигона из canvas
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
| viewer3d-core + desktop/mobile | Общая логика один раз, антураж отдельно под каждую платформу |
| IS_MOBILE через UA + innerWidth | Достаточно для прототипа; при бэкенде заменить на серверный выбор |
| RGBELoader/EXRLoader/GLTFLoader через CDN | Надёжнее динамического loadScript |
| CPU box-UV вместо onBeforeCompile | onBeforeCompile с worldpos_vertex несовместим с r128; CPU надёжнее |
| Отдельный загрузчик для ground | Object.assign копирует uuid текстуры, ломает GL-кэш рендерера |
| Процедурная земля (canvas diffuse + normal) | Нет тайлинга, органичный вид, не нужны внешние текстуры |
| Эллиптические пятна на ground | Круглые выглядят искусственно; rotate+scale создают органику |
| Процедурная normal map с 60000 травинок | Иллюзия травяного покрова без внешних текстур |
| polygonOffset на frame material | Z-fighting между рамами и стенами из-за сведения полигонов |
| Подоконники вместо откосов (reveals) | Откосы создавали артефакты внутри стекла |
| HDRI: sun 1.8 + amb 0.0 + exposure 0.85 | HDRI заливает тени; повышенная интенсивность солнца компенсирует |
| Стекло: opacity 0.38, metalness 0.82 | Уменьшает видимость внутренностей через стекло |
| alphaTest + toneMapped:false для спрайтов | Убирает белую обводку PNG и пересвет от ACESFilmic |
| MeshPhysicalMaterial для стекла | transmission + ior дают реалистичное преломление |
| GLB → PNG → canvas fallback chain | Позволяет постепенно улучшать качество, добавляя 3D-модели |
| Draco не используется | r128 требует отдельный WASM-декодер, лишняя зависимость |
| Туман отключён | Мешает восприятию участка на типичных дистанциях камеры |
| Образцы накапливаются, не заменяют | UX: клиент хочет сравнивать несколько материалов |
| Cache-busting через ?v=N | Браузеры агрессивно кэшируют JS; без версии изменения не загружаются |
| FastAPI для бэкенда | Python удобен для расчётного модуля, быстрый старт |
| Приглушённый ground | Снижена насыщенность и светлота процедурной текстуры земли |
| Камера не ниже земли | controls.change → camera.position.y >= 0.3 |
| Площадка под домом чёрная | Визуально отделяет цоколь от земли, не конфликтует с материалами |
| Терраса на 1 см ниже цоколя | Избегает z-fighting между настилом террасы и верхней гранью фундамента |
| Юбка террасы/крыльца 6 см | Толщина 0.06 (была 0.025) — закрывает зазоры между смежными конструкциями |
| Боковые панели крыльца — deck-материал | Визуальная целостность с террасой, а не с цоколем |
| Snap-сетка 0.5 м | Более точное позиционирование, чем шаг 1 м; крупные/мелкие точки для ориентации |
| Прилипание к стенам — порог 1 м | Достаточно для удобства, но не мешает делать узкие террасы (~2 м) |
| Multi-line через {break:true} | Позволяет рисовать несколько отдельных дорожек/заборов в одном canvas |
| Крыльцо snap при init | Начальные координаты кратны SNAP/GRID, snapNorm() при инициализации canvas |
| Sidebar — single-selection кнопки | Чеклист путал: пользователь не понимал, что включение делает в 3D |
| Editor lock (dEditorOpen) | Блокирует панель и другие кнопки пока canvas открыт — фокус на задаче |
| vegGroup + _vegGen | Растительность в отдельной группе, генерационный счётчик отсекает stale callbacks |
| occupiedZones для растительности | Деревья/кусты не пересекаются с террасами, дорожками и т.п. |
| Антураж после разметки | _buildEntourage вызывается только при наличии размеченных конструкций |
| Ограничение размеров | Площадь 40–100 м², этаж 270–360 см, фундамент 50–120 см |
| Десктоп UI — отдельный HTML | Мобильный wizard и десктоп 3-column слишком разные для media queries |
| nav-desktop.js переопределяет goTo() | Совместимость с canvas.js/viewer3d-core, которые могут вызывать goTo() |
| Canvas wrapper IDs (cw-*) совпадают | canvas.js ищет элементы по `cw-` + name — одинаковые ID в обеих версиях |

---

## Десктопный UI (index-desktop.html)

### 3 экрана:

1. **d-screen-1** — выбор типа дома (fullscreen grid карточек)
2. **d-screen-2** — параметры + 3D (left: area/floor/foundation с range-слайдерами, center: 3D)
3. **d-screen-3** — рабочая область (3 колонки):
   - **Left sidebar** (300px) — кнопочное меню позиций (single-selection). Клик → выбор для каталога или открытие canvas-редактора. Карандаш (✏) для повторного редактирования.
   - **Center** — 3D-вид или canvas-редактор (overlay поверх 3D)
   - **Right panel** (340px) — материалы: фильтры цвета/цены → результаты (auto-show) → образцы

### Sidebar (nav-desktop.js):
- **`dActiveItem`** — текущая выбранная позиция (single-selection).
- **`dEditorOpen`** — блокирует панель и другие кнопки пока canvas-редактор открыт.
- **`dConfigured`** (Set) — отмечает позиции, прошедшие через "Готово".
- Клик по некотронутой позиции с редактором → открывается canvas. Клик по сконфигурированной → выбор для каталога.
- Для террасы в панели всегда отображается sub-toggle "Терраса / Ограждение" (`S.matSubMode`).

### Canvas-редакторы:
Каждая секция с редактором (terrace, pool_terrace, paths, pier, porch, fence) имеет свой `d-center-canvas` overlay.
При нажатии "Готово" → `dConfigured.add(secId)`, панель разблокируется, 3D перестраивается.
Обёртки canvas (`cw-*`) и сами canvas (`cv-*`) имеют те же ID, что и в мобильной версии — canvas.js работает без изменений.

### Canvas snap-сетка (canvas.js):
- `GRID=32` (общий размер участка в метрах), `SNAP=0.5` (шаг сетки), `CELLS=64`.
- Крупные точки (каждый 1 м, радиус 2), мелкие (каждые 0.5 м, радиус 1.2).
- **Прилипание к стенам дома** для террас/причала: порог 1 м (`thr = 1.0 / GRID`).
- **Крыльцо**: drag + resize c привязкой через `snapNorm()`. Начальные координаты кратны `SNAP/GRID`.
- **Multi-line** (дорожки, забор): маркер `{break:true}` в массиве точек, `splitAtBreaks()` разбивает на сегменты.

### Правая панель:
- Фильтры цвета/цены → результаты показываются автоматически (без кнопки "ПОДОБРАТЬ").
- Карточки материалов с кнопками "Применить", "Сравнить", "В смету".
- При нажатии "Применить" материал автоматически добавляется в образцы и применяется к 3D-сцене.

---

## Модульная система 3D-домов

**Подробная спецификация модулей**: `HOUSE_MODULES_SPEC.md`
**Формат JSON-дескриптора дома**: `HOUSE_DESCRIPTOR_FORMAT.md`

**Концепция**: дом собирается из модульных GLB-компонентов (стены, окна, двери, части крыши, декор).
Тип дома определяется JSON-дескриптором (`assets/houses/house_type_*.json`), который задаёт:
- набор модулей и их расположение
- ограничения параметров (площадь, высота, шаг)
- тип крыши, окна, декор

Материалы в GLB именуются `mat_wall`, `mat_roof`, `mat_frame` и т.д. — код заменяет их при конфигурации.
Масштабируемые модули (стены, цоколь) моделируются как unit-блоки (1×1×0.2 м).
Фиксированные модули (окна, двери) моделируются в реальном размере.

Текущий процедурный билдер (`buildHouseMeshes`) остаётся как fallback.

---

## Следующие шаги

1. ~~**Десктопная версия UI**~~ ✅ — создана и отлажена (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance, sub-toggle материалов)
2. **Подготовить GLB-модели** — растительность (assets/vegetation/) + модули дома (assets/modules/)
3. **Написать загрузчик и сборщик модульного дома** — loadHouseType() + buildHouseFromDescriptor() + applyMaterialOverride()
4. **Бэкенд** — FastAPI + расчётный модуль + БД
