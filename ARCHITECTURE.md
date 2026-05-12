# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус
- **Фронтенд** разбит на файлы, PBR-визуализация работает; десктоп-UI создан и отлажен (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance).
- **Растительность** работает с трёхуровневым fallback (GLB → PNG → процедурный canvas).
- **Модульная система GLB** для домов (см. `HOUSE_MODULES_SPEC.md`): спецификация v2 согласована, **полный комплект из 30 GLB-модулей собран** и разложен по подпапкам (`assets/houses/modules/{walls,windows,doors,base,roof,decor,site}`); исходные `.blend`-файлы в `3d_sources/`. JS-загрузчик/сборщик дома по дескриптору **не написан** — пока работает процедурный билдер `buildHouseMeshes` как fallback.
- **Бэкенд** не начат (план: FastAPI + расчётный модуль + БД).

---

## Структура файлов (текущая)

```
/frontend — мобильная версия (wizard)
  index.html              # разметка + script-теги (детектор платформы перенесён в viewer3d-entourage.js)
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
  viewer3d-core.js        # сцена, HDRI, PBR-материалы, buildScene3d.
                          # Дом строится через HouseBuilder.buildHouseFromDescriptor (см. shared/house-builder.js);
                          # старый процедурный buildHouseMeshes остаётся как fallback пока loadHouseType в полёте.
                          # HOUSE_TYPE_MAP маппит S.houseType → typeId дескриптора.
                          # ensureHouseLoaded() — async-кэш дескриптора и GLB-модулей.
  viewer3d-entourage.js   # антураж (общий для обеих платформ): GLB-модели → PNG cross-billboard → процедурный fallback;
                          # автоматически определяет IS_MOBILE (UA + ширина окна) для подбора параметров
  shared/house-builder.js # ⭐ Общий модуль модульной сборки дома по JSON-дескриптору.
                          # IIFE namespace HouseBuilder: { setLogger, loadHouseType,
                          # buildHouseFromDescriptor, applyMaterialOverride, drawOutlineOverlay,
                          # decomposeOrthoPolygonIntoRectangles }. Подключается и в test-house,
                          # и в основной фронт. См. «Тестовое приложение модульной сборки» ниже.

  assets/                 # текстуры, HDRI, растительность, дома и модули
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

    houses/               # дескрипторы домов и GLB-модули
      house_type_01.json  # одноэтажный с вальмовой крышей (формат spec v2)
      house_type_02.json  # одноэтажный с двускатной крышей
      house_type_03.json  # Г-образный с плоской крышей
      modules/
        walls/    mod_wall_segment.glb, mod_pillar.glb
        windows/  mod_window_single.glb, mod_window_double.glb, mod_window_wide.glb,
                  mod_window_velux.glb, mod_dormer.glb
        doors/    mod_door_single.glb, mod_door_onehalf.glb, mod_door_double.glb,
                  mod_door_slide_single.glb, mod_door_slide_double.glb
        base/     mod_base_segment.glb, mod_base_pillar.glb
        roof/     mod_roof_gable_slope.glb, mod_roof_gable_front.glb,
                  mod_roof_hip_slope.glb, mod_roof_hip_ridge.glb, mod_roof_flat_edge.glb
        decor/    mod_cornice.glb, mod_chimney.glb, mod_gutter.glb,
                  mod_downpipe.glb, mod_porch_column.glb, mod_porch_step.glb
        site/     mod_fence_panel_wood.glb, mod_fence_post.glb,
                  mod_bench_a.glb, mod_planter_a.glb, mod_lamp_a.glb

3d_sources/               # исходные .blend для GLB-модулей (не отдаётся клиенту)
  walls/, base/           # (пусто — содержимое в legacy windows/Modules.blend)
  windows/                # Modules.blend (legacy: walls + 3 окна), mod_window_velux.blend, mod_dormer.blend
  doors/                  # Modules_doors.blend, Modules_doors_slide.blend (legacy),
                          # mod_door_slide_single.blend, mod_door_slide_double.blend
  roof/                   # mod_roof_*.blend (5 шт.)
  decor/                  # mod_cornice.blend, mod_chimney.blend, mod_gutter.blend,
                          # mod_downpipe.blend, mod_porch_column.blend, mod_porch_step.blend
  site/                   # mod_fence_panel_wood.blend, mod_fence_post.blend,
                          # mod_bench_a.blend, mod_planter_a.blend, mod_lamp_a.blend

/backend                  # ещё не создан
  main.py
  calculator.py
  models.py
  database.py
  /migrations

ARCHITECTURE.md
HOUSE_DESCRIPTOR_FORMAT.md   # формат JSON-дескриптора дома (spec v2)
HOUSE_MODULES_SPEC.md        # спецификация модульной системы 3D-домов (spec v2)
README.md
```

### Порядок подключения скриптов

**Мобильная (index.html):**
```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader → GLTFLoader
state.js → nav.js → canvas.js
→ viewer3d-core.js → viewer3d-entourage.js
ui.js → catalog.js
```

**Десктопная (index-desktop.html):**
```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader → GLTFLoader
state.js → canvas.js
→ shared/house-builder.js
→ viewer3d-core.js → viewer3d-entourage.js → nav-desktop.js
```

**Тестовая песочница (test-house.html):**
```
Three.js r128 → OrbitControls → GLTFLoader
→ shared/house-builder.js → test-house.js
```

В обоих случаях `shared/house-builder.js` подключается **до** кода, который его использует.
Test-house инжектит свой panel-логгер через `HouseBuilder.setLogger(log)`.

Все скрипты подключаются с query-string `?v=N` для сброса кэша браузера (текущая: v=14).

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

### viewer3d-entourage.js

Единый файл антуража для обеих платформ. Платформа определяется автоматически на старте:
`IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768`.
Используется и здесь (для подбора параметров), и в `viewer3d-core.js` (через `typeof IS_MOBILE !== 'undefined'`).

Трёхуровневая fallback-цепочка для растительности:

1. **GLB модели** (bush_a.glb, bush_b.glb, tree_a.glb, tree_b.glb) — загружаются через GLTFLoader. Автоматическое масштабирование по bounding box, центрирование по основанию, включение теней.
2. **PNG спрайты** (bush_a.png, tree_a.png и т.д.) — cross-billboard (пересекающиеся PlaneGeometry). Кусты: 2 плоскости. Деревья: 2 на мобиле, 3 на десктопе (больше объёма).
3. **Процедурные canvas-текстуры** — `_fallbackBush()` и `_fallbackTree()` создают 256×256 canvas с эллиптическими кронами и стволами.

Защита от stale-callback: счётчик `_vegGen` инкрементируется при каждом `_buildEntourage()`. Если GLB-загрузчик завершился после новой пересборки сцены, его модели игнорируются.

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

**Текущее состояние:**

| Слой | Статус |
|------|--------|
| Спецификация модулей (HOUSE_MODULES_SPEC.md, v2) | ✅ согласована |
| Формат дескриптора (HOUSE_DESCRIPTOR_FORMAT.md, v2) | ✅ согласован, расширен полями `floor.start_offset`, `floor.area_factor`, `features.inter_floor_cornice` |
| Дескрипторы домов в `assets/houses/` | ✅ 10 типов: rect+hip (01), rect+gable (02), L (03), + (04), T (05), S (06), П (07), О-с-двором (08), 2-этажный (09), 1.5-этажный мансарда (10) |
| GLB-модули | ✅ 30 модулей собраны в `assets/houses/modules/<категория>/` |
| Исходные `.blend`-файлы | ✅ в `3d_sources/<категория>/` |
| JS-загрузчик `loadHouseType()` | ✅ в `shared/house-builder.js` (общий для test-house и основного фронта) |
| JS-сборщик `buildHouseFromDescriptor()` | ✅ в `shared/house-builder.js`. Поддерживает: ortho-полигоны с reflex-углами, многоэтажность с per-floor offset и area_factor |
| Декомпозиция полигона на rects + hip/gable per rect | ✅ `decomposeOrthoPolygonIntoRectangles` в shared |
| `transformParametricModule()` | ✅ в shared, с детектом native bbox (X/Y/Z) для всех частей: frame_*, leaf_*, glass, curtain, mullion_*, sill, threshold |
| `applyMaterialOverride()` | ✅ в shared (принимает parent, color-пикеры по `mat_*`) |
| Декор: cornice / chimney / inter-floor cornice | ✅ в shared. Углы cornice — TODO (требуется GLB cornice_corner) |
| Процедурный билдер `buildHouseMeshes()` | ✅ в `viewer3d-core.js`, используется как fallback пока `ensureHouseLoaded()` в полёте |
| Подключение в основной фронтенд (`viewer3d-core.js` + `nav-desktop.js`) | ✅ `HOUSE_TYPE_MAP` + `ensureHouseLoaded` + `dSelHouse` запускает preload; в `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor` |

**Открытые TODO в test-house (некритично для портирования, можно делать инкрементально):**
- Cornice на convex-углах: нужен GLB `mod_cornice_corner.glb` с трапециевидным сечением (повторяет профиль `mod_cornice.glb`), чтобы закрыть зазор `cd × cd` на каждом convex-углу.
- Porch (крыльцо): builder для расстановки `mod_porch_column.glb` и `mod_porch_step.glb` у входной двери. GLB-модули готовы.
- Dormer/velux: позиционирование на наклонной плоскости + вырез отверстия в скате.
- Mansard-крыша: наклонные стены 2-го этажа вместо вертикальных.
- Handle двери: сейчас обрезается при `scale.x` leaf'а (handle — child of leaf в GLB). Нужна пересборка GLB с handle как sibling.
- Per-floor UI sliders (для разной высоты/площади этажей в test-house).

**Известное расхождение имён в legacy-GLB.** Существующие модули из `Modules.blend` (single/double/wide окна) используют `Glass` (с заглавной) и `treshold` (опечатка) вместо требуемых спекой `glass` и `threshold`. **Новые** модули, собранные после согласования v2, идут строго по спеке. При написании `transformParametricModule()` нужно либо пересобрать legacy-GLB с правильными именами, либо сделать парсер case-insensitive с alias-таблицей `{Glass:'glass', treshold:'threshold'}` — выбор за реализатором.

---

## Recent cleanup (tech debt)

Сделано в итерации v=15 (портирование test-house → основной фронт):

- **Создан `shared/house-builder.js`** (~1080 строк, IIFE namespace `HouseBuilder`). Содержит всю geometric/loader/render логику модульной сборки дома. Используется и в test-house (как playground), и в основном фронте.
- **`test-house.js`**: `rebuild()` теперь вызывает `HouseBuilder.loadHouseType()` и `HouseBuilder.buildHouseFromDescriptor(houseGroup, ..., {outlineGroup, controls, materialOverrides})`. Локальные дубли функций сохранены как dead code, но не используются (можно удалить в следующей итерации).
- **`viewer3d-core.js`**: добавлены `HOUSE_TYPE_MAP` (S.houseType → typeId), `_houseCache`, `ensureHouseLoaded()` (async с дедупликацией), `rebuildHouseAsync()`. В `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor` если кэш готов; иначе fallback на старый процедурный `buildHouseMeshes` пока loader в полёте.
- **`nav-desktop.js`**: `dSelHouse()` запускает `ensureHouseLoaded()` сразу при выборе типа дома (preload пока пользователь смотрит step 1), затем `buildScene3d()` для отрисовки.
- **Cache-bust**: `viewer3d-core.js?v=15`, `nav-desktop.js?v=15`, `shared/house-builder.js?v=1`.

Сделано ранее (v=14):

- **Дедупликация antoura**: `viewer3d-desktop.js` (283 строки) + `viewer3d-mobile.js` (275 строк) → один `viewer3d-entourage.js` с авто-детектом `IS_MOBILE` (UA + `innerWidth < 768`). Минус ~270 строк дублей.
- **Унификация cache-bust**: моб. `?v=8` и десктоп `?v=13` → общий **`?v=14`**.
- **Упрощение мобильного загрузчика**: IIFE с `loadScript`/детектором заменён на обычные `<script>` теги (детект перенесён внутрь `viewer3d-entourage.js`).
- **Утечка GPU-памяти в `clearGroup`**: материалы, создаваемые в каждом `buildScene3d` (10 мат. из `getHouseMats` + `padMat` + `fenceMat` + `railMat`), не диспозились между rebuilds. Теперь `clearGroup(group, disposeMaterials)` собирает уникальные материалы в `Set` и диспозит их. Для `vegGroup` флаг `false` — там GLB-клоны шарят материал с источником в загрузчике (`THREE.Object3D.clone()` shallow-копирует материал), dispose сломал бы следующие `clone()`.
- **Удалена отладка**: 6 `console.log('[3D]')` из `buildHouseMeshes`.
- **`.gitignore`**: убран markdown-фрейминг, добавлен `*.blend1/2/3` (Blender autosave).
- **3 «осиротевших» `.blend1`** из корня перенесены в подпапки `3d_sources/{windows,doors,doors}/`, где лежат их `.blend`-сиблинги.
- **`house_type_01.json` приведён к spec v2**: размеры окон/дверей как `{min,max,default}`, ID модулей `door_entrance/door_patio` → `door_single/door_slide_double` (по спеке), добавлены `mullions`, `leaves`, `mechanism`, `frame_profile`, `pillar_size`, `mat_concrete`, `mat_flashing`.
- **Обновлены документационные ссылки** на старые `viewer3d-{desktop,mobile}.js` в `ARCHITECTURE.md`, `HOUSE_MODULES_SPEC.md`, шапке `viewer3d-core.js`.

---

## Следующие шаги

1. ~~**Десктопная версия UI**~~ ✅ — создана и отлажена.
2. ~~**Подготовить GLB-модели**~~ ✅ — растительность (PNG-fallback готов, GLB опционально) + 30 GLB-модулей дома собраны.
3. ~~**Написать загрузчик и сборщик модульного дома**~~ ✅ — `test-house.html` + `test-house.js`. 10 типов домов (rect+hip, rect+gable, L, +, T, S, П, O-с-двором, 2-этажный, 1.5-этажный). Все 4 типа крыши (hip/gable/gable_cross/flat) через декомпозицию ortho-полигона на прямоугольники. Многоэтажность с per-floor `start_offset`/`area_factor`. Декор (cornice, chimney, inter_floor_cornice). Material override через `mat_*`.
4. ~~**Портировать общий код в основной фронтенд**~~ ✅ — `shared/house-builder.js` создан (~1080 строк), IIFE namespace `HouseBuilder`. Подключён и в `test-house.html`, и в `index-desktop.html`. В `viewer3d-core.js`: `HOUSE_TYPE_MAP` маппит `S.houseType` → typeId, `ensureHouseLoaded()` кэширует дескриптор + GLB-модули, в `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor()` (с fallback на старый `buildHouseMeshes` пока loader в полёте). `dSelHouse` в `nav-desktop.js` запускает preload при выборе типа.
   - **Замечание**: пока используется маппинг **варианта A** (4 карточки шага 1 → 3 типа дескрипторов). Полный набор (10 типов) доступен только в test-house. В будущем UI шага 1 → «карусель» с превью всех типов.
5. **Доработки модульной системы (некритично, инкрементально):**
   - `mod_cornice_corner.glb` — GLB-модуль с трапециевидным сечением для закрытия convex-углов карниза.
   - Porch builder (расстановка `mod_porch_column.glb` + `mod_porch_step.glb` у двери).
   - Dormer/velux на скате крыши.
   - Mansard-крыша (наклонные стены 2-го этажа).
   - Пересборка GLB дверей: handle как sibling leaf_main (не child), чтобы handle не масштабировался вместе со створкой.
   - Карусель типов домов в UI шага 1 (вместо 4 карточек — превью всех 10 дескрипторов).
   - Per-floor sliders area/floor_h (для гибкого тюнинга многоэтажных домов в UI).
6. **Бэкенд** — FastAPI + расчётный модуль + БД (в работе у команды бэкенда).

---

## Тестовое приложение модульной сборки (`test-house.html`)

Изолированная HTML-страница для проверки, что генерация дома по JSON-дескриптору работает как задумано (спека v2). Не интегрировано с основным конфигуратором — отдельный набор файлов. Все правки парадигмы (rotation, pillar positioning, parametric scaling) валидируются здесь до портирования в `viewer3d-core.js`.

**Файлы:**
- `test-house.html` — UI: 3D-вьюпорт + панель параметров (3 слайдера) + панель материалов + лог
- `test-house.js` — вся логика: загрузчик, обход периметра, билдеры стен/столбов/фундамента/крыши, параметрическая трансформация, замена материалов

**Как запустить:**
```bash
cd E:/_WORK/__Shpuk/_AI_TEST/SHPUK-Desktop
python -m http.server 8765
# В браузере: http://127.0.0.1:8765/test-house.html
```
(`file://` не подходит из-за CORS на `fetch` JSON-дескриптора и GLB.)

**Демонстрируемые типы домов:**
| ID | Название | Перимeтр | Крыша |
|----|----------|----------|-------|
| `type_01` | Одноэтажный с вальмовой | прямоугольник | hip |
| `type_02` | Одноэтажный с двускатной | прямоугольник | gable |
| `type_03` | Г-образный одноэтажный | L (turn=−90 в выступе) | flat (polygon) |

### Что реализовано

- **Loader** — `loadHouseType(typeId)` фетчит `assets/houses/house_<typeId>.json`, собирает уникальные module ID из периметра и `roof_type`, параллельно загружает все GLB через `GLTFLoader` с graceful degradation (отсутствующий модуль логируется warn, не валит сборку).
- **Eval vars** — выражения `"sqrt(area * 1.5)"` и т.п. вычисляются через `new Function` (input — наш JSON, инжекций не боимся).
- **Outline** — turtle-graphics обход периметра, поддержка `turn=±90`, проверка замкнутости. Каждому pillar присваиваются флаги `sx`/`sz` (±1) — interior-квадрант от угла, вычисленный из суммы interior-направлений соседних стен.
- **Pillars** — позиционируются **полностью внутри периметра** в interior-квадранте (на CW-обходе: `interior = (-dz, dx)`). Это даёт корректную работу и для inward (turn=+90), и для outward (turn=−90) углов.
- **Walls / windows / doors** — позиционируются в **конце** заполнителя с поворотом `ry = π - atan2(dz, dx)`. Эта пара (rotation + endpoint position) гарантирует, что local +Z (внешняя грань модуля) смотрит наружу здания, а local +X выстраивается в обратном направлении обхода (модуль «рисуется назад» к началу заполнителя). Подробнее — в разделе «Конвенции» ниже.
- **Foundation** — построение по тому же outline, что и стены, но **шире на `FOUNDATION_OVERHANG = 0.10 м`** в exterior-направлении (видимый «карниз» цоколя). Pillar'ы цоколя расширены до `ps + overhang` со сдвигом тоже наружу.
- **Roofs**:
  - `hip` — 6 вершин (4 угла основания с eave + 2 точки конька), 6 треугольников (2 трапеции по длинным сторонам + 2 треугольника по коротким). Конёк по длинной оси, длина = `|L − W|`. Винайдинг подобран так, что нормали смотрят наружу.
  - `gable` — конёк во всю длину (от края до края). 2 длинных прямоугольных ската (mat_roof) + 2 треугольных фронтона на торцах (mat_wall, отдельный меш — чтобы перекрашивались как стены).
  - `flat` — **полигональная** через `THREE.Shape` + `ExtrudeGeometry` (встроенный Earcut). Корректно работает на L/П/T-формах: слаб точно повторяет outline. Без eave (Minkowski offset для произвольного полигона не реализован).
- **Material override** — для каждого `mat_*` swappable из `materials_map` отрисовывается `<input type=color>`. Меняет `material.color` всех мешей с матчащим `material.name` в `houseGroup`. Reset-кнопка пересобирает сцену со свежими клонами материалов.
- **Live rebuild** — debounce 120 мс на любой слайдер; чекбокс «Контур» рисует фиолетовый периметр-overlay и сферы в pillar-точках для отладки.

### Конвенции (важно для будущих модулей)

**GLB-ориентация после импорта в Three.js (Y-up native):**
- X = ширина, Y = высота, Z = глубина (с подписанным знаком).
- Origin у одного угла; тело уходит в **+X, +Y, −Z**.
- Это значит: `local Z=0` face = **OUTER** (street-side, где Blender Y=0 → glTF Z=0 после `export_yup`).
- `local Z=−depth` face = **INNER** (room-side).
- `wall_segment` нативная толщина 0.2 м (Z range `[−0.2, 0]`); масштабируется до `wt` через `scale.z = wt / 0.2`.

**Размещение модуля на эдже периметра** (с rotation `π − atan2(dz, dx)`):
- Position = endpoint = `(start + (cursor + width) * dir, y, ...)` (а не start).
- Local +X маппится на world `(−dx, 0, −dz)` (модуль рисуется обратно к началу).
- Local +Z (наружная грань) маппится на `(dz, 0, −dx)` = exterior direction для CW-обхода. ✓ внешняя грань смотрит на улицу.
- Этот подход выбран потому, что чистым поворотом вокруг Y невозможно одновременно совместить local +X с walking direction И local +Z с exterior — модули имеют «лево-ориентированную» локальную систему относительно нашей задачи.

**Pillar position (interior-квадрант):**
- `sx = sign(−prev.dz − next.dz)`, `sz = sign(prev.dx + next.dx)` (сумма interior-направлений соседних стен).
- `pos.x = (sx > 0) ? item.x : item.x − ps`
- `pos.z = (sz > 0) ? item.z + ps : item.z` (учитывается, что body GLB-pillar в local −Z).

**Wall length и start/end offsets — зависят от типа соседнего pillar'а:**
- При **inward**-углe (`turn=+90`): тело pillar'а уходит в interior-квадрант, лежащем **вдоль** перимeтра → стена должна отступить на `ps` от этого угла, чтобы не пересечь pillar.
- При **outward**-углe (`turn=−90`, concave-corner типа inside-of-L): тело pillar'а уходит **поперёк** перимeтра вглубь здания → стена идёт прямо до угла, без отступа.
- Формула: `startOffset = (startPillar.turn > 0) ? ps : 0`, `endOffset = (endPillar.turn > 0) ? ps : 0`, `wallLength = runLength − startOffset − endOffset`. Аннотируется в `computeOutline` после первого прохода (когда уже известны типы поворотов соседних pillar'ов).

**⚠ Гочча в парсере периметра.** В `computeOutline` НЕ нужно делать early `continue` по `_comment` — он может присутствовать **рядом** с действительной командой в одном объекте (`{"turn": -90, "_comment": "..."}`) и тогда команда теряется. Правильно: проверять только `cmd.run`/`cmd.turn`, элементы без них (включая чисто `_comment`) пропускаются естественным образом. (Этот баг проявлялся именно на L-формах: один turn=−90 терялся, контур не замыкался.)

**⚠ Гочча в `resolveFills` — fixedSum vs wallLength.** Если в фасаде нет `{wall: "fill"}` (`fillCount === 0`), `resolveFills` НЕ нормализует ширины — фасад строится ровно по сумме фиксированных значений. Если эта сумма не совпадает с `wallLength` (что неизбежно при изменениях `area` через UI), получится видимая **дыра** в стене (или перекрытия). Парсер теперь выдаёт warn `[fills] ⚠ no fills, but gap N м …` — но build продолжается. Best practice для дескрипторов: **всегда** добавлять хотя бы один `{wall: "fill"}`, чтобы абсорбировать разницу. Этот баг проявился в `house_type_03.json` на 3-й стене (`run: ext`) — фиксированные `0.6 + window 0.9 + 0.6 = 2.1 м` не покрывали `ext ≈ 4 м`, оставляя дыру в ~1.8 м.

**Foundation overhang:**
- Wall: `pos.x += dz * overhang`, `pos.z −= dx * overhang` (сдвиг в exterior direction); `scale.z = (wt + overhang) / 0.2`.
- Pillar: `scale = (ps + overhang, baseH, ps + overhang)`; `pos` смещён на `overhang` от item-точки в exterior-сторону.

**Параметрическая трансформация — корректировки spec section 5.2:**
- Спека алгоритма ставит `frame_right.position.x = w` и `frame_top.position.y = h`. Это работает только если origin frame_right / frame_top на их **внешней** грани (max corner). У наших GLB origin на min corner. **Корректные формулы:** `frame_right.position.x = w − jambW`, `frame_top.position.y = h − headerH`, где `jambW`, `headerH` — реальные размеры профиля рамы из GLB.
- `dW`, `dH` для масштабирования читаются из bbox **загруженного GLB** (`detectNativeDims`), не из `default` дескриптора — они могут разойтись (как у legacy `door_single` 0.9×2.10 vs дескриптор 1.0×2.20 ранее).
- `glass.scale` основывается на native opening size (`dW − 2·jambW × dH − headerH − bottomH`), не на формуле через `frame_profile` (она пересчитывает по другим thickness'ам).
- Threshold native `t.y = -0.067` (легаси door GLB) — мы переопределяем `position.y = 0`, чтобы порог сидел на верху фундамента, полностью видимый.

**Legacy GLB-имена** (mod_window_single/double/wide, mod_door_single/onehalf/double): `Glass` (с заглавной), `treshold` (опечатка), `Handle` (с заглавной). В `test-house.js` маппятся через `NAME_ALIASES = { Glass: 'glass', treshold: 'threshold', Handle: 'handle' }`. Новые модули (velux, dormer, mod_door_slide_*) идут строго по спеке.

### Известные ограничения

- **hip / gable на non-rectangular outline**: используют bbox, дают «навес» в пустых углах L/П-форм. Корректное построение требует декомпозиции полигона на rectangles (TODO). Для L-форм сейчас рекомендуется `roof_type: "flat"` — он строится по реальному outline-полигону.
- **Многоэтажность**: один `params.floorH` применяется ко всем этажам; межэтажные перекрытия (`0.2 м` per spec) не строятся.
- **Dormer / velux на крыше**: модули загружаются, но позиционирование на скате не реализовано.
- **Декор**: `chimney`, `gutters`, `cornice`, `downpipe` — модули есть, размещение по периметру не реализовано.
- **Eave для polygon-flat-roof**: слаб ровно по периметру outline. Свес наружу для произвольного полигона требует Minkowski offset (TODO).

### Реализация polygon-flat-roof

Сначала использовался `THREE.ExtrudeGeometry(shape, { depth })`, но он давал странные результаты для CCW-контуров с вогнутым углом (предположительно из-за нестабильной обработки `autoClose` / отрицательного `depth` в r128). Заменено на ручной `BufferGeometry` через `THREE.ShapeUtils.triangulateShape()` (тот же Earcut под капотом, но без обёртки `Shape`/`Extrude`):
- Top-face: триангуляция Earcut'ом по corner'ам outline.
- Bottom-face: те же треугольники с обратным winding'ом.
- Боковые стенки по периметру: 2 треугольника на каждое ребро.
- Толщина слаба = 0.10 м.
- Логирование вершин полигона и числа треугольников выводится в panel-лог для диагностики.
