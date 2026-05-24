# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус
- **Фронтенд** разбит на файлы, PBR-визуализация работает; десктоп-UI создан и отлажен (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance).
- **Растительность** работает с трёхуровневым fallback (GLB → PNG → процедурный canvas).
- **Модульная система GLB** для домов (см. `HOUSE_MODULES_SPEC.md`): спецификация v2 согласована, **полный комплект из 30 GLB-модулей собран** и разложен по подпапкам (`assets/houses/modules/{walls,windows,doors,base,roof,decor,site}`); исходные `.blend`-файлы в `3d_sources/`. JS-загрузчик/сборщик дома по дескриптору **не написан** — пока работает процедурный билдер `buildHouseMeshes` как fallback.
- **Бэкенд** не начат (план: FastAPI + расчётный модуль + БД).

---

## Структура файлов (текущая)

```
/frontend — десктопная версия (3-column workspace)
  index.html              # 3 экрана: выбор дома → параметры+3D → workspace
                          # Initial loading state в d-house-grid — виден до выполнения JS.
  styles-desktop.css      # все стили (3-column layout, topbar, sidebar, panel,
                          # loading-индикаторы карточек)
  nav-desktop.js          # dGoTo, sidebar, canvas editors, right panel, catalog,
                          # карусель домов + прогресс-каунтер генерации превью

/frontend — legacy мобильные файлы (мобильный wizard удалён, файлы оставлены)
  styles.css, nav.js, ui.js, catalog.js  # не подключены ни одним HTML

/frontend — общие файлы
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

**Основной фронт (index.html):**
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

`shared/house-builder.js` подключается **до** кода, который его использует.
Test-house инжектит свой panel-логгер через `HouseBuilder.setLogger(log)`.

Все скрипты подключаются с query-string `?v=N` для сброса кэша браузера. Текущие версии
указаны ниже в разделе «Recent cleanup».

`viewer3d-entourage.js` автоматически детектит `IS_MOBILE` (UA + `innerWidth<768`)
для подбора параметров растительности.

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

## Десктопный UI (index.html)

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
| Porch (крыльцо) | ✅ в shared. Привязка к двери (с флагом `"main": true`), процедурная сборка: ступени с nosing, щёки с лестничным контуром, 2 колонны, плоский навес с наклоном, перила с балясинами + поручни, наклонные перила вдоль ступеней, чёрный pad. См. `buildPorch` в `shared/house-builder.js`. |
| Pad под домом | ✅ в shared. Строится по реальному bbox outline (`firstOutline.bbox`), стыкуется с pad крыльца. В `viewer3d-core.js` pad строится только как fallback при процедурном `buildHouseMeshes`. |
| Velux на скате | ✅ в shared. GLB-модуль трансформируется параметрически + правосторонний базис ската (`axisAlong, axisUp, normal`). Размещение БЕЗ выреза в скате (frame поднят на 6 см над плоскостью, custom flat glass на 8.5 см). |
| Dormer на скате | ✅ в shared. Процедурная сборка: walls (BoxGeometry) + 2 ската мини-крыши + 2 фронтона. Конёк перпендикулярен главному, угол совпадает с углом главной крыши. `basePt.y` опускается на `(d/2)*tan(angle)` чтобы передняя часть села на скат. Размеры подбираются так, чтобы задняя стенка ушла под скат (`d ≥ h/tan + w/2`). Окно во фронтоне с custom flat glass перед стеной. |
| Процедурный билдер `buildHouseMeshes()` | ✅ в `viewer3d-core.js`, используется как fallback пока `ensureHouseLoaded()` в полёте |
| Подключение в основной фронтенд (`viewer3d-core.js` + `nav-desktop.js`) | ✅ `HOUSE_TYPE_MAP` + `ensureHouseLoaded` + `dSelHouse` запускает preload; в `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor` |

**Открытые TODO (некритично, инкрементально):**
- ~~Cornice на convex-углах~~ ✅ сделано в v=27 (`mod_cornice_corner.glb`).
- ~~Mansard-крыша~~ ✅ сделано в v=22 (`buildBrokenMansardRoof`). Mansard с **наклонными** стенами (вместо вертикальных knee wall) — отдельная фича, не реализовано.
- ~~Балконы~~ ✅ сделано в v=28 (`features.balconies[]`, `buildBalconies`).
- ~~Правильный карниз/rake для gable~~ ✅ сделано в v=28 (фронтон на линии стены + rake soffit).
- ~~GLB porch column/step~~ ✅ сделано в v=28 (`placeScaledGlb` с fallback на BoxGeometry).
- ~~Per-floor UI sliders~~ ✅ сделано в v=22.
- ~~Карусель типов домов~~ ✅ сделано в v=22.
- Handle двери: обрезается при `scale.x` leaf'а (handle — child of leaf в GLB). Нужна пересборка GLB с handle как sibling.
- `mod_cornice_concave_corner.glb` — L-shape для concave-углов; сейчас две cornice'ы overlap'ятся на 15 см в bay-зоне (малозаметно).
- Eave для polygon-flat-roof: слаб ровно по outline без свеса; нужен Minkowski offset для произвольного полигона.

**Известное расхождение имён в legacy-GLB.** Существующие модули из `Modules.blend` (single/double/wide окна) используют `Glass` (с заглавной) и `treshold` (опечатка) вместо требуемых спекой `glass` и `threshold`. **Новые** модули, собранные после согласования v2, идут строго по спеке. При написании `transformParametricModule()` нужно либо пересобрать legacy-GLB с правильными именами, либо сделать парсер case-insensitive с alias-таблицей `{Glass:'glass', treshold:'threshold'}` — выбор за реализатором.

---

## Recent cleanup (tech debt)

Сделано в итерациях v=56–v=57 (фронтоны без щелей, индикатор загрузки, переименование index):

- **Фронтон мансарды (`buildBrokenMansardRoof`) — основание расширено до slope-footprint.** Раньше пятиугольник фронтона строился строго на стене (`wz0/wz1`), а скаты выходили на `eave` (z0/z1). Угол NW/SW рёбер пятиугольника получался ~76° против 70° у ската — между ними была видимая треугольная дыра. Теперь основание пентагона = `z0/z1` (для longAxisX) или `x0/x1` (для longAxisZ); рёбра пентагона лежат точно в плоскости скатов. «Уши» пентагона (за пределами стены) скрыты внутри объёма ската-бруса.
- **`getGableTriangle` — единое расширение основания для всех «фронтонных» крыш.** Раньше расширение `ll/lr` по carniz-оси на `ROOF_EAVE` делалось только для `roof_type === 'mansard'`. Это давало рассинхрон с `buildGableRoof` (gable / gable_cross), где основание уже было на `z0/z1` — для сторон со `gable_windows` (где фронтон строит `buildGableWindows`, а не `buildGableRoof`) появлялась та же треугольная дыра, что и на мансарде. Теперь `expandU = ROOF_EAVE` для `mansard | gable | gable_cross`. Тип 11 (полутораэтажный с `gable_windows` на east/west) фиксится этим изменением.
- **`type_10`: убран `no_rake_overhang: true`, карниз возвращён.** После того как фронтон стал прилегать к скатам, флаг `no_rake_overhang` (отключение rake-выноса) больше не нужен — rake-вынос вернулся стандартный (`ROOF_EAVE = 0.30 м`). `features.cornice: true` тоже вернули.
- **Loading-индикатор для карусели домов.** Раньше после загрузки страницы пользователь видел пустую область сетки ~5 сек, пока скрипты с CDN не дозагрузятся и `_dInitHouseGrid` не отрисует карточки. Теперь в `index.html` внутрь `<div id="d-house-grid">` положен **initial loading state** (`.d-grid-initial-loading` + крутящийся круг + «Загружаем дома…») — браузер рисует его сразу при парсинге HTML, до выполнения JS. После того как `_dInitHouseGrid` подставляет карточки, плейсхолдер исчезает; на месте превью — серые блоки, которые быстро заполняются JPEG-миниатюрами. Над сеткой — глобальный прогресс-каунтер `.d-house-progress` («Готовим превью домов (X / 10)…»), который плавно fade-out по завершении. Per-card спиннеры удалены (фаза генерации превью проходит быстро, отдельные индикаторы избыточны).
- **Переименование `index-desktop.html` → `index.html`.** Старый мобильный `index.html` (wizard, max-width 480px) удалён. Legacy-файлы мобильного UI (`styles.css`, `nav.js`, `ui.js`, `catalog.js`) оставлены в корне, но ни одним HTML не подключаются.
- Cache-bust: `shared/house-builder.js?v=57`, `nav-desktop.js?v=21`.

Сделано в итерациях v=41–v=55 (трубы, мансарда, фронтонные окна, fixes):

- **Downpipe v3 — 3-частный GLB с клонированием center'а.** Пользователь пересобрал `mod_downpipe.glb`: 3 объекта (`downpipe_top` — раструб, `downpipe_center` — цилиндр, `downpipe_bottom` — колено-выпуск). Код больше НЕ масштабирует (scale через Vector3 bracket access не применялся в этой связке Three.js+GLTFLoader). Вместо этого `partCenter` клонируется N раз стопкой: `bot → center₁ → center₂ → … → centerN → top`. `N = floor((fullH − topH − botH) / centerSize)` (floor — труба гарантированно не выше карниза, чтобы не врезаться в скат крутой мансарды). Auto-detect upAxis по самой длинной размерности `partCenter`. Если ось ≠ Y — `d.rotation.x/z = +π/2`.
- **Позиционирование трубы на углу.** `exterior_unit` нормализуется (для прямого угла — диагональ `(±1,±1)/√2`). `d.rotation.y = atan2(−exUnitX, −exUnitZ)` поворачивает native -Z (направление колена и раструба, длинная ось в плане) в exterior — труба смотрит наружу под 45°. `d.position` рассчитан так, чтобы centroid раструба попал на точку `corner + pipeAttachOffset · exterior_unit` (раструб под стыком gutter'ов). Подъём всей трубы: `pipeYLift = 0.20 м` от земли. `pipeAttachOffset = ROOF_EAVE − 0.15 = 0.15 м` — труба прижата к углу.
- **`_buildThickSlope` без yShift.** Раньше брус сдвигался вверх на `cos(α)·thickness`, чтобы низ ската совпадал со стеной. На мансарде это давало РАЗНЫЕ yShift для нижнего (5 см) и верхнего (14 см) скатов — на kink-линии образовывалась видимая ступенька 5–9 см. Теперь yShift=0: верхние плоскости обоих скатов на kink точно совпадают (= `kinkY`), кровля непрерывна. Нижняя грань бруса свешивается ниже плоскости ската на `cos(α)·thickness` — это нормальный «толщина свеса» (карниз).
- **Капельник на kink (отменён).** v=51 добавлял декоративную металлическую полосу на изломе мансарды для маскировки шва. После убирания yShift шов исчез естественно, капельник больше не нужен — удалён.
- **Dormer с собственным углом крыши (`roof_angle`).** Раньше угол мини-крыши dormer'а наследовал угол главной крыши. На крутой мансарде (70°) это давало `dormerRoofRise = 0.6·tan(70°) = 1.65 м` — нелепо высокий фронтон. Теперь `dormerSpec.roof_angle` (опция) задаёт свой пологий угол. Тип 10: `roof_angle: 30°`. Тип 11: `roof_angle: 25°`.
- **Dormer.depth ограничен на крутой мансарде.** На скате с углом α `placeDormer` опускает `basePt.y` на `(depth/2)·tan(α)` чтобы переднюю кромку «посадить» на скат. При `depth=2.20` и `α=70°` опускание = 3.03 м — больше высоты ската! Dormer проваливался. Для type_10 поставлено `depth: 1.30, position_up: 0.88`.
- **Окна в мансардном фронтоне (`features.gable_windows` поддерживает mansard).** `getGableTriangle` теперь возвращает `points2D` массив: треугольник из 3 точек для gable, **пятиугольник из 5 точек** для mansard (`LL → LR → kinkR → top → kinkL`). `buildOneGable` проверяет помещение окна по форме контура (для мансарды — окно должно быть НИЖЕ kink-линии и не вылезать за наклонные стороны трапеции). `buildBrokenMansardRoof` принимает `skipGableSides` (Set) — пятиугольник для нужной стороны пропускается, его строит `buildGableWindows` с дыркой + window GLB. Тип 10 получил `gable_windows` на east+west.
- **Mansard фронтон — на стене (без расширения на eave).** Pentagon строится строго на `wx0/wx1` и `wz0/wz1` (без расширения по eave). Расширение давало «уши» за стеной, под которыми у крутого ската видна была пустота. В `getGableTriangle` для мансарды pentagon-точки `kinkL/kinkR` теперь на `u = horizontalLower − ROOF_EAVE` (с учётом того что фронтон на стене, а horizontalLower считается от eave-кромки).
- **`no_rake_overhang: true` для типа 10.** Свес скатов мансарды по продольной оси отключён — скаты ровно над фронтонной стеной без выступа за неё. Карнизный свес по длинной (eave) стороне сохранён.
- **Cache-bust для JSON-дескрипторов.** `?ts=Date.now()` в `loadHouseType` — гарантия что новый JSON подхватывается даже когда preview-режимы / file:// игнорируют `cache: 'no-store'`.
- **`mod_porch_column.glb`, `mod_porch_step.glb`, `mod_downpipe.glb`** перемоделированы в Blender — все в Z-up конвенции с export_yup=True (вертикаль = Y в glTF).
- **Реалистичность дескрипторов:** добавлены `features.balconies[]` (тип 09), `features.gable_windows[]` (типы 02, 09, 10, 11), `features.no_rake_overhang` (тип 10), `features.porch.*` во многих типах. Удалены типы 06, 07, 08 из карусели (JSON-файлы оставлены в архиве). Добавлены типы 11 (полутораэтажный с gable+dormer) и 12 (стеклянный, плоская крыша). Расширены фасады во всех типах: окна вокруг дверей, разнообразие window_single/double/wide, `main: true` флаг для главной двери, `balcony: true` флаг для балконной.
- Cache-bust финальный: `shared/house-builder.js?v=55`, `nav-desktop.js?v=19`, `GLB_CACHE_VERSION=33`.

Сделано в итерации v=40 (downpipe через Box3.setFromObject):

- **Downpipe — переход на Box3.setFromObject.** Раньше я использовал `mesh.geometry.boundingBox` для локального bbox каждой части, но если в GLB `downpipe_top/center/bottom` — это `Object3D` (Group) с детьми-мешами, такой подход не учитывает иерархию и position children'ов, и трубы выглядели «горизонтально лежащими».
  - Новый helper `_bboxOfObject(obj)` использует `new THREE.Box3().setFromObject(obj)` — обходит всю иерархию объекта и возвращает мировой bbox (с учётом всех вложенных transforms).
  - Алгоритм размещения переписан чище:
    1. `scale.set(1,1,1)` для всех 3 частей + `updateMatrixWorld()`.
    2. Снимаем native bbox.
    3. Auto-detect `upAxis` по самой длинной размерности `partCenter`.
    4. `partCenter.scale[upAxis] = sFactor`, повторно снимаем bbox после scale.
    5. Сдвигаем каждую часть: `position[upAxis] += target_min - current_min`.
    6. Если upAxis ≠ y — поворот группы `rotation.x/-z = -π/2`.
- Cache-bust: `shared/house-builder.js?v=40`.

Сделано в итерации v=39 (auto-detect оси downpipe):

- **Downpipe auto-axis detection.** GLB пользователя имеет 3 части (`downpipe_top/center/bottom`), но ось «вверх» части center может быть не Y (зависит от Blender-конвенции при экспорте). Теперь код определяет ось автоматически по самой длинной размерности `center`-меша: `upAxis = (sizeY ≥ sizeX ∧ sizeY ≥ sizeZ) ? 'y' : (sizeZ ≥ sizeX ? 'z' : 'x')`. По этой оси:
  - `partBottom.position[upAxis] = -bbBot.min[upAxis]` (нижний край на 0)
  - `partCenter.scale[upAxis] = centerH / centerSize` (растягивается)
  - `partTop.position[upAxis] = botH + centerH - bbTop.min[upAxis]`
  - Если upAxis = z или x — добавляется `rotation.x = -π/2` или `rotation.z = -π/2` к группе, чтобы upAxis смотрел в world +Y.
- **`_bboxOfMesh` расширен** — возвращает теперь `min/max` объекты, `sizeX/Y/Z` + legacy `minY/maxY/sizeY` для обратной совместимости.
- **Известная проблема**: на мансарде остаётся ступенчатый шов на kink-линии (между нижним и верхним скатом, ~9–14 см вертикально). Связано с разными `yShift = cosA·thickness` для скатов разных углов наклона. Архитектурно эту ступеньку обычно закрывает «капельник» (kink fascia) — отдельный декоративный элемент, который добавим в следующих итерациях.
- Cache-bust: `shared/house-builder.js?v=39`.

Сделано в итерации v=38 (фронтон шире eave, трёхчастный downpipe, мансарда):

- **Фронтон РАСШИРЕН на eave по карнизной оси.** В `buildGableRoof` и `buildBrokenMansardRoof` фронтонные точки теперь идут не от `wz0/wz1` (стена), а от `z0/z1 = wz0-eave / wz1+eave` (с eave). Фронтонная стена ВЫХОДИТ за стену дома по карнизу — закрывает eave-overhang с торца, и щель «крыша не прилегает к стене» исчезает. Аналогично для longAxisZ: фронтон расширен по X.
- **`_buildThickSlope` сдвигает брус вверх на cosA·thickness** — чтобы нижняя грань бруса (mat_soffit) совпадала с плоскостью ската (заданной topCorners). Это устраняет вертикальный зазор `cosA·thickness ≈ 5 см` между верхом стены и нижней гранью свеса.
- **`no_rake_overhang` убран из type_10/11** — флаг был лишний после расширения фронтона. Rake overhang вернулся, фронтон закрывает eave.
- **Трёхчастный downpipe (`top/center/bottom`).** GLB теперь содержит 3 объекта; `top` и `bottom` сохраняют native размеры, `center` масштабируется по Y. В коде:
  - `_bboxOfMesh(mesh)` — локальный bbox одного меша через `geometry.boundingBox`.
  - В блоке `desc.features.downpipe`: traverse GLB ищет 3 части по имени (`downpipe_top/center/bottom`). Если найдены — bottom на Y=0, center сразу над bottom со scale.y = centerH/native_centerH, top на boтH+centerH. Если структура старая (один меш) — fallback на старое поведение (scale.y по всему).
- **Тип 10 (мансарда)**: `mansard.lower_height: 2.20 → 2.60` (больше места для dormer'ов). Dormer'ы: `position_up: 0.55, h: 0.85, depth: 1.80` (помещаются в нижнем скате без пробивания kink).
- **Тип 12 (стеклянный)**: на N и S добавлен `{ "wall": "fill" }` в обоих концах — раньше сумма фиксированных размеров не покрывала длину стены, образовывались видимые «дыры» в стене.
- Cache-bust: `shared/house-builder.js?v=38`, `GLB_CACHE_VERSION=33` (новый трёхчастный downpipe).

Сделано в итерации v=37 (флаг no_rake_overhang + cornice skip для mansard + чистка type_12):

- **`features.no_rake_overhang: true`** — новый флаг в дескрипторе. Когда установлен, для `gable`/`gable_cross`/`mansard` СКАТЫ НЕ выступают за фронтонную стену по rake-направлению (т.е. вдоль конька). Eave-overhang по карнизной стороне сохраняется. Реализация в `buildGableRoof` и `buildBrokenMansardRoof`: `eaveAlong = noRakeOverhang ? 0 : eave`, для longAxisX rake идёт по X, для longAxisZ — по Z. Передаётся через `buildRoof` options.
- **Cornice skip на фронтонах для mansard.** В `buildDecorFromFeatures` `isFrontalRoof` теперь включает `'mansard'` (раньше только gable/gable_cross). Карниз больше не рисуется на фронтонной стене мансардных домов.
- **Тип 10** (мансарда): `no_rake_overhang: true` + dormer `position_up: 0.70, depth: 2.00` (длиннее по нормали, садятся на скат до конца).
- **Тип 11** (полутораэтажный): `no_rake_overhang: true` + dormer `position_up: 0.55, depth: 2.00`.
- **Тип 12** (стеклянный): убрана раздвижная дверь с южного фасада (заменена на window_double). Высота `door_slide_double` снижена до 2.30 (от native ~2.10, scale близок к 1.0). `window_double.h` снижен до 2.20 (тоже близко к native 1.20, scale ~1.83 — лучше отрисовка).
- Cache-bust: `shared/house-builder.js?v=37`.

Сделано в итерации v=36 (мансарда с толщиной + реалистичная труба + окна-в-пол для type_12):

- **`_buildThickSlope(parent, topCorners, normal, thickness)`** — вынесен в верхний уровень helper для построения объёмного бруса ската (8 вершин, mat_roof сверху + mat_soffit снизу/боковые). Использован в `buildBrokenMansardRoof`.
- **Мансардная крыша с толщиной 15 см.** Каждый из 4 скатов (lower/upper × N/S) теперь — наклонный параллелепипед. Видимая толщина по карнизу + барджборд на rake. Нижняя грань бруса работает как soffit — общий `buildRoofSoffit` для mansard больше НЕ вызывается. Пристройки-hip получают свой `buildBboxSoffit`. Фронтонные пятиугольники остаются плоскими (на bbox, без eave) и используют общий `sharedWallMat`.
- **`mod_downpipe.glb` перемоделирован** через Blender MCP: 168 вершин, 135 граней. Цилиндр D=10 см с 12 гранями, конический раструб сверху (10→14 см), 2 хомута-кольца (D 13 см), колено-выпуск в +Y направлении. Material `mat_metal` — оцинкованный металл (color (0.72,0.74,0.76), roughness 0.35, metallic 0.55). `GLB_CACHE_VERSION = 32`.
- **Тип 12 переделан**: `window_double` (только вертикальный импост, без сетки) вместо `window_wide` (со сеткой 2×2). Параметры окна `y=0.20, h=2.40` — низ окна 20 см от пола, верх 80 см от потолка (при floor_h=280). Теперь окна реально «в пол». Также добавлена раздвижная стеклянная дверь по центру южного фасада (как дополнительный выход в сад).
- **Тип 4**: дверь `door_double` помечена `main: true` (исправление пропущенного флага).
- Cache-bust: `shared/house-builder.js?v=36`, `GLB_CACHE_VERSION=32`.

Сделано в итерации v=35 (фикс меню, gutter в углах, downpipe offset, mansard dormer):

- **`index.json` cache-bust** в `_dInitHouseGrid()` через `?ts=Date.now()` — теперь типы 11, 12 точно подхватываются (некоторые preview-режимы / file:// игнорируют `cache: 'no-store'`).
- **Gutter удлинён на `pillar_size`** в обе стороны: gutter тянется от `item.x - ps/2` до `endX + ps/2`. Соседние gutter-ы перекрываются в углах (раньше была щель ровно в pillar-зоне).
- **Downpipe offset переписан**: не нормализованный (sign), 4 угла дают `(±1, ±1)` диагональ. Смещение по каждой оси = `ps/2 + pipe_half + 0.04`. Для `ps=0.25` и `pipe ≈ 0.10` это ~0.22 м — труба полностью снаружи pillar и стены.
- **Тип 10 dormer'ы подняты**: `position_up: 0.20 → 0.55`, размеры скорректированы (`w: 1.20, h: 0.95, depth: 1.20`). Окна больше не залезают на стену под скатом.
- **Mansard толщина крыши и фронтон-зашивка** — TODO (большая работа, аналогично buildGableRoof v=29 с параллелепипедами). В этой итерации не сделано.
- **Downpipe GLB перемоделирование** — отложено (Blender MCP временно недоступен). Когда Blender будет запущен, сделаю реалистичную трубу: 12-граний цилиндр D=10 см, конический раструб сверху, 2 хомута, колено-выпуск снизу.
- Cache-bust: `shared/house-builder.js?v=35`, `nav-desktop.js?v=19`.

Сделано в итерации v=34 (водостоки наружу, mansard-фронтон на стене, чистка типов 4/5, удалены 6/7/8, добавлены 11/12):

- **Водостоки**: трубу теперь сдвигаем на `0.13 + bbox/2 + 0.03 ≈ 0.20 м` наружу по диагонали — труба стоит рядом с углом, не утопает в pillar.
- **Mansard фронтон на стене (без eave)** — `buildBrokenMansardRoof` теперь имеет 10 дополнительных вершин (10-19) на bbox (без eave) для пятиугольных фронтонных треугольников. Скаты с eave overhang остаются (вершины 0-9 с x0/x1).
- **Тип 3 переделан**: новая планировка — основной прямоугольник + выступ на север (по центру), вход с окнами на южном (длинном) фасаде. Главный вход теперь на широкой стене, не на узком торце выступа.
- **Тип 4 переделан**: рук стало шире (`aw = sqrt(area)*0.50`), короче (`ext_x/z = (L-aw)/2`). Из 5 дверей остались 2: `door_double` (main на верхней руке) + `door_single` (служебный на нижней). Окна по бокам от обеих дверей. Modules: убраны `door_onehalf`, `door_slide_*`. Окна добавлены на всех 12 стенах.
- **Тип 5 переделан**: было 5 дверей, осталось одна — `door_double main` на W. Остальные двери заменены окнами (`window_single` или `window_wide` под перекладиной). Modules: убраны `door_onehalf`, `door_slide_*`. Расширены окна на всех стенах + панорама на N.
- **Удалены типы 6, 7, 8 из карусели** (`index.json`) как слишком экзотичные. JSON-файлы остаются в `assets/houses/` как архив.
- **Тип 11 — новый «полутораэтажный с мансардой»**: gable крыша 45°, 2 dormer'а на южном скате (1.20×1.10×1.20), gable_windows на east+west в треугольной части фронтонов. Прямоугольный план, вход на восточной (короткой) стене с окнами по бокам.
- **Тип 12 — новый «стеклянный»**: плоская крыша, окна в пол (`window_wide` 2.10м высотой, `y=0.30`), главный вход — стеклянная раздвижная `door_slide_double` 2.30м высотой. Простой прямоугольник.
- **`index.json`** теперь содержит 9 типов: 01, 02, 03, 04, 05, 09, 10, 11, 12. Subtitle обновлён (тип 03/04/05 — вальмовая, тип 09 — двускатная, type_10 — мансардная, type_11 — двускатная+dormer, type_12 — плоская).
- **Уменьшено porch.width до 1.8** в типах 1, 2, 3, 7, 9, 10 (перила не лезут в окна вокруг двери).
- Cache-bust JS: `shared/house-builder.js?v=34`.

Сделано в итерации v=33 (водостоки/трубы + gable_window + насыщенные фасады во всех 10 типах):

- **Водостоки/трубы — фикс кода.**
  - `gutters` теперь рендерятся одновременно с `cornice` (раньше взаимоисключали). Для gable пропускаются фронтонные стены (`skipGableEnds` + `isGableEndWall`). Gutter сдвинут наружу на `eave * 0.9` от стены, чтобы висеть на кромке кровли (не прижиматься к cornice).
  - `downpipe` теперь идёт от земли (`Y=0`) до верха стен (`wallTopY`), а не от верха цоколя. Сдвинут наружу на 6 см по диагонали внешнего угла (среднее exterior-нормалей двух прилегающих стен).
- **`features.gable_windows[]` — окна в треугольной части фронтона.** Новая фича. Дескриптор задаёт массив окон по сторонам (`east`/`west` для longAxisX; `north`/`south` для longAxisZ). В коде:
  - `buildGableRoof` принимает `skipGableSides` (Set строк) и не строит треугольник фронтона для этих сторон.
  - Новая функция `buildGableWindows`:
    - `getGableTriangle(bbox, longAxisX, ridgeY, baseY, side)` возвращает 3 угла треугольника + локальный u-axis и exterior normal.
    - `buildOneGable` триангулирует полигон с дыркой через `THREE.ShapeUtils.triangulateShape(points2D, [hole])`, строит mesh с `sharedWallMat`, поверх ставит window GLB с правильной rotation (`ry = atan2(exterior.x, exterior.z)`).
    - Graceful fallback: если окно вылезает за треугольник — warn + плоский фронтон без выреза.
- **Насыщенные фасады во всех 10 типах.**
  - Тип 01: окно слева + дверь main + окно справа на восточном входе.
  - Тип 02: переработан целиком. N: 2 double + 1 wide; S: 3 double (спальни); E: окна по бокам от двери; W: 2 single. Добавлены окна в фронтоне (east + west, 0.9×0.8).
  - Тип 03: переработан. N с панорамным окном, окна вокруг двери на E-выступе.
  - Тип 04 (showcase крест): дверь верхней руки помечена `main: true` + добавлено porch.
  - Тип 05: дверь W помечена `main`, окна по бокам, добавлено porch.
  - Тип 06: дверь S `main`, добавлено porch.
  - Тип 07: дверь E `main` с окнами по бокам, добавлено porch.
  - Тип 08: дверь W `main`, добавлено porch.
  - Тип 09: окна вокруг двери E, добавлены gable_windows на east+west, добавлено porch.
  - Тип 10: окна вокруг двери E, 2 dormer'а на южном скате, добавлено porch.
- **`gutters: true` + `downpipe: true`** во всех 10 дескрипторах.
- **Расширены `materials_map`** во всех типах: `mat_soffit`, `mat_metal` (водосток), `mat_porch_*`.
- Документация: `HOUSE_DESCRIPTOR_FORMAT.md` дополнен таблицей полей `features.gable_windows[]`.
- Cache-bust JS: `shared/house-builder.js?v=33`.

Сделано в итерации v=32 (исправлена ось GLB-моделей крыльца):

- **Bug fix: GLB крыльца моделировались с осью Y вверх.** Blender использует **Z-up**, а я в скрипте создавал вершины как если бы Y был вертикалью. После `export_yup=True` Blender свапает Z→Y и Y→-Z, и моя «вертикальная» колонна высотой 1 unit становилась горизонтально лежащим брусом длиной 1 unit по glTF -Z. В коде `placeScaledGlb` масштабировал её по `target=(0.18, 2.4, 0.18)`, что давало плоскую «доску» 0.18 м толщиной растянутую горизонтально — это и видел пользователь как «колонны повёрнуты на 90°».
- **`mod_porch_column.glb` v3** перегенерирован в правильной Z-up конвенции (Blender bbox X[-0.5..0.5] Y[-0.5..0.5] Z[0..1]). После export Y→вертикаль в glTF.
- **`mod_porch_step.glb` v2** — простой куб с правильной осью, фаска убрана (сверху всё равно проступь-слаб).
- `GLB_CACHE_VERSION = 31` (был 30).
- Cache-bust JS: `shared/house-builder.js?v=32`.

Сделано в итерации v=31 (cache-busting для GLB-моделей):

- **GLB cache-busting.** Раньше при обновлении `.glb` через Blender браузер отдавал старую версию из кэша (запрос без query-string кэшируется FileLoader по URL). Введена константа `GLB_CACHE_VERSION = 30` в `shared/house-builder.js`; путь к GLB теперь `assets/houses/modules/<cat>/mod_<id>.glb?v=${GLB_CACHE_VERSION}`. При обновлении любого GLB в `assets/houses/modules/` нужно поднимать эту константу.
- Cache-bust JS: `shared/house-builder.js?v=31` (т.к. логика loader'а изменена).

Сделано в итерации v=30 (полировка двускатной + выразительная колонна крыльца):

- **Толщина gable снижена до 15 см.** `GABLE_SLOPE_THICKNESS = 0.15` (было 0.20). Брус скатов стал визуально тоньше.
- **Фронтон использует общий wall material.** Раньше в `buildGableRoof` создавался свой `MeshStandardMaterial` с `name='mat_wall'`, и без активного `applyMaterialOverride('mat_wall', color)` цвет фронтона отличался от стен (native GLB цвет ≠ кремовый 0xf5e6c8). Теперь в `buildHouseFromDescriptor` pre-clone'им `wall_segment` GLB, извлекаем его материал в `sharedWallMat`, пробрасываем через `buildRoof` options в `buildGableRoof`. Фронтон рендерится тем же материалом, что и стены — цвета синхронны.
- **`mod_porch_column.glb` v2 — выразительный профиль.** Перегенерирован через Blender MCP. 6-уровневая структура (вместо 3): база (полный размер 1×0.07×1) + переход база→ствол (наклон 0.03) + ствол (0.55×0.80×0.55, фаски 27% от размера = очень выраженные) + переход ствол→капитель + капитель (1×0.07×1). 48 вершин, 42 граней. Native bbox 1×1×1. После масштаба в коде до 0.18×2.4×0.18: база/капитель 18×17×18 см, ствол ~10×192×10 см, фаски ~2.4 см — теперь чётко видны.
- Cache-bust: `shared/house-builder.js?v=30` (в `index-desktop.html` и `test-house.html`).

Сделано в итерации v=29 (объёмная двускатная крыша + GLB декор крыльца + балкон над балконной дверью):

- **Двускатная крыша с толщиной 20 см.** В `buildGableRoof` каждый скат теперь — наклонный параллелепипед (8 вершин), а не плоский треугольник. Верхняя грань = плоскость кровли (`mat_roof`, красный), нижняя грань + 4 торца = `mat_soffit` (бежевый — выполняет роль barge fascia на rake и подшивки на eave). Толщина задана константой `GABLE_SLOPE_THICKNESS = 0.20`. Удалены отдельные функции `buildGableRakeSoffit` / `buildGableEaveSoffit` — их роль теперь играет нижняя грань самого бруса.
- **Cornice скипается на фронтонной стороне.** В `buildDecorFromFeatures` добавлен `isGableEndWall(item, longAxisX)` и флаг `skipGableEnds` (включается, когда `roof_type ∈ {gable, gable_cross}` и outline = 1 rectangle). Cornice на фронтонных стенах не строится; corner cornice на углу, прилегающем хотя бы к одной фронтонной стене, тоже скипается. Для прямоугольного gable получается классический вид: cornice только по карнизным сторонам.
- **Балкон над балконной дверью.** В `makeDoorFill` добавлен флаг `balcony: true` (override.balcony), помечающий балконную дверь в фасаде. В `buildBalcony` появилась поддержка `cfg.align_to_door: true` — балкон ищет дверь на привязанной стене и центрируется над ней (через новую функцию `findBalconyDoorOnWall`, которая использует `resolveFills`). Авто-привязка к двери с `balcony:true` происходит даже без явного `align_to_door`. Если двери нет — балкон по середине стены + `offset_along`. В `house_type_09.json`: на южной стене 2-го этажа auto_windows заменены на явный фасад с `door_slide_double + balcony:true`, добавлено определение `door_slide_double` в `modules`. Балкон размер 2.6×1.4 м.
- **Новые GLB крыльца (через Blender MCP).**
  - **`mod_porch_column.glb`** — деревянный брус с фаской. База (куб 1.0×0.04×1.0) + 8-угольный профиль ствола 0.7×0.7 с фасками 0.10 (высота 0.92) + капитель (1.0×0.04×1.0). Material `mat_porch_column` (тёплое дерево, color (0.78, 0.66, 0.48)). 32 вершины, 22 граней. Native bbox 1×1×1 — масштабируется через `placeScaledGlb`.
  - **`mod_porch_step.glb`** — тело ступени с фаской по передней верхней кромке. 10 вершин, 7 граней (куб + 1 chamfer face 10% от высоты/глубины). Material `mat_porch_step` (серо-бежевый, color (0.74, 0.71, 0.66)).
  - Источники: `3d_sources/decor/mod_porch_column.blend` и `mod_porch_step.blend`.
- Cache-bust: `shared/house-builder.js?v=29` (в `index-desktop.html` и `test-house.html`).

Сделано в итерации v=28 (правильный карниз/rake для gable + GLB porch column/step + балконы):

- **Правильный gable-карниз.** В `buildGableRoof` фронтонная стена теперь строится строго **на линии стены дома** (на `bbox.minX..bbox.maxX` без eave), а скаты по-прежнему выступают за фронтон на `ROOF_EAVE` (rake overhang). Раньше фронтон шёл `x0..x1` (с eave) — выступал за стену с обеих сторон, что архитектурно неверно. Теперь:
  - Slope-mesh: 4 нижних угла с eave + 2 точки ridge на концах ската (с rake overhang).
  - Gable-mesh: 4 угла на bbox (без eave) + 2 точки ridge на линии фронтонной стены.
- **Rake soffit.** Под выступающей частью ската со стороны фронтона строится наклонная плита параллельная скату (`buildGableRakeSoffit`): два «крыла» от карнизной линии до конька, по обе стороны фронтонной стены.
- **Eave soffit.** Карнизные стороны двускатной крыши получают отдельную горизонтальную подшивку (`buildGableEaveSoffit`), не покрывающую rake-зону (иначе пересекалась бы с rake soffit). Для пути `gable` с пристройками-hip пристройки получают отдельный `buildBboxSoffit` (горизонтальная плита по своему bbox). Общий `buildRoofSoffit` для gable/gable_cross больше не вызывается.
- **GLB porch column/step.** Добавлен helper `placeScaledGlb(parent, glbModules, modId, sizeX, sizeY, sizeZ, cx, cyCenter, cz, ry, matName, fallbackColor)`: клонирует GLB, измеряет native bbox через `detectNativeBbox`, масштабирует по 3 осям до целевых размеров и размещает с rotation вокруг Y. Если модуль не загружен или bbox невалидный — fallback на `addBoxAt` (BoxGeometry). В `buildPorch` применён к колоннам (`porch_column`) и к телам ступеней / тела платформы (`porch_step`). Проступи (deck slabs) и навес остаются процедурными — это простые плиты, их GLB не имеет смысла. Сигнатура `buildPorch` расширена параметром `glbModules` (передаётся `modules` из `buildHouseFromDescriptor`).
- **Балконы (`features.balconies`).** Новая фича: массив балконов в дескрипторе. Каждый балкон — `{ floor, side|wall_index, offset_along, width, depth, thickness, has_railing, railing_height, has_supports }`. Привязка к фасаду этажа: `pickBalconyWall(outline, side, wall_index)` выбирает самую длинную стену с подходящей exterior normal (`side="south"` → `exZ > 0.5`, и т.д.). Геометрия: плита (`addBoxAt`) + перила с трёх сторон (front + 2 sides, задняя сторона прижата к стене) — handrail + балясины с шагом 13 см через `buildBalconyRailing`. Опционально консольные опоры от земли до плиты (`has_supports: true`). В `buildHouseFromDescriptor` теперь ведётся массив `floorOutlines[]` / `floorYFloors[]` (нужен для привязки к этажам >= 1). Добавлено в `house_type_09.json` (двухэтажный) — демо-балкон на южном фасаде второго этажа, ширина 2.8 м, глубина 1.2 м.
- **Спека.** `HOUSE_DESCRIPTOR_FORMAT.md` обновлён: добавлена таблица полей `features.balconies[]`, упомянуто использование GLB `porch_column` / `porch_step` с fallback.
- Cache-bust: `shared/house-builder.js?v=28` (в `index-desktop.html` и `test-house.html`).

Сделано в итерации v=27 (cornice_corner GLB + soffit + cornice во всех домах + bug fix inflate):

- **`mod_cornice_corner.glb`** — создан новый GLB-модуль через Blender MCP. Усечённая пирамида 8 вершин / 6 граней: основание 5×5 см (Z=0), верх 15×15 см (Z=0.30 м). Внутренние две грани вертикальные (к стенам), внешние — наклонные (повторяют профиль cornice). Материал `mat_wood`. Исходник: `3d_sources/decor/mod_cornice_corner.blend`. В `buildDecorFromFeatures` ставится на каждый convex pillar (`turn > 0`) с rotation через `Matrix4.makeBasis(prevExt, yUp, nextExt)` — правосторонний базис, ориентирует local +X вдоль prev exterior, local +Z — вдоль next exterior. Закрывает 15×15 см зазор между соседними cornice'ами.
- **`buildRoofSoffit`** — горизонтальная подшивка свеса крыши. Thin sheet (5 см над wallTopY, нормаль вниз) по периметру `inflateOrthoOutline(outline, eave)`. Закрывает «дыру» снизу свеса. Вызывается для hip / gable / gable_cross / mansard (для flat не нужен — сам slab служит подшивкой). Материал `mat_soffit`, светлый бежевый. Для мансарды wallTopY = `roofBaseY` (= `yOffset + knee_height`).
- **Bug fix: `inflateOrthoOutline`** — раньше для concave pillar использовался `sign = +1`, что сдвигало inflated pillar в interior **тела дома** (баг). Должно сдвигать в anti-interior направлении: convex — наружу от дома, concave — в bay-зону. Исправлено на `sign = -1` всегда. Это влияет на `buildRoofSoffit` и `buildInterFloorSlab` для не-прямоугольных форм (Г, +, T, П, S, O).
- **Cornice на правильной высоте у мансарды** — `buildDecorFromFeatures` теперь получает `roofBaseY` (= `yOffset + knee_height`), а не `yOffset`. Карниз стоит над knee wall, прямо под началом ската, а не под коленной стенкой.
- **Cornice добавлен во все 10 домов** — типы 02, 04, 05, 06, 07, 08 раньше не имели `features` блока. Скрипт добавил `features.cornice: true` + `mat_cornice` в `materials_map`.
- **Cornice на concave-углах** — full length на обеих стенах. На concave-углах две cornice'ы сходятся с overlap 15×15 см в bay-зоне (внутри концавного угла, малозаметно). TODO: отдельный `mod_cornice_concave_corner.glb` (L-shape) для идеального стыка.
- Cache-bust: `shared/house-builder.js?v=27`.

Сделано в итерации v=22 (мансарда + per-floor sliders + карусель домов с 3D-превью):

- **Мансарда (ломаная крыша Мансар)** — `buildBrokenMansardRoof` в `shared/house-builder.js`. Параметры в `desc.mansard`: `lower_angle` (крутой нижний скат, ~70°), `upper_angle` (пологий верхний, ~25°), `lower_height` (высота нижнего ската, м), `knee_height` (опц. вертикальная стенка перед началом ската). Фронтоны — пятиугольники (5 вершин: 2 базы + 2 излома + 1 ridge). Для multi-rect декомпозиции главный rect получает ломаную крышу, остальные — hip с углом нижнего ската. `getSlopeFrame` обрабатывает `roof_type='mansard'` отдельно: frame описывает НИЖНИЙ крутой скат (от eave до kink), что используется для размещения velux/dormer. `roof_type='mansard'` добавлен в `collectModuleIds`.
- **`buildKneeWall`** — низкая вертикальная стенка по периметру outline, использует те же модули `wall_segment` + `pillar` что и основные стены.
- **`house_type_10.json` переделан** — раньше был «2-этажный с уменьшенным верхом», теперь настоящая 1.5-этажная мансарда: 1 этаж + `roof_type: "mansard"` с `lower_angle: 70`, `upper_angle: 25`, `lower_height: 2.20`, `knee_height: 0.20`. Угол крыши max до 60°.
- **Per-floor sliders** в шаге 2 UI: HTML заменён на динамический контейнер `<div id="d-floors-params">`, `nav-desktop.js::_dRenderFloorParams()` создаёт по 2 слайдера (площадь + высота этажа) для каждого этажа дескриптора. Глобальный `v-area` синхронно меняет все этажи через `area_factor` (`dOnAreaTotal()`); per-floor слайдер можно использовать индивидуально (`dOnFloorParam(fi)`). `dCollectParams()` собирает `{floorAreas[], floorHs[]}` массивы.
- **`HouseBuilder.buildHouseFromDescriptor`** теперь принимает в `params`: `floorAreas[]`, `floorHs[]`. Если не заданы — fallback на старое поведение (`params.area × area_factor`).
- **Карусель типов домов (шаг 1)** — заменены 4 фиксированные карточки на сетку 5×скролл из всех 10 типов (`assets/houses/index.json`). По клику — немедленный переход на step 2 (без кнопки «Дальше»). Отдельная строка снизу: «Участок без дома» + «Загрузите фото».
- **3D-превью на карточках** — `_dRenderHousePreviews()` использует один shared `WebGLRenderer` (240×180), для каждого типа дома: load descriptor + GLB, build via `HouseBuilder`, render в iso-ракурсе по bbox, snapshot → JPEG dataURL (qual 0.82) → `<img>` в карточке. Кэш `_dPreviewCache` между переходами. HTTP-кэш GLB дедуплицирует общие модули между домами.
- **`flatShading: true`** добавлено в материалы крыши (`buildHipRoof`, `buildGableRoof`, `buildFlatRoofPoly`, `buildBrokenMansardRoof` уже было) — рёбра между скатами теперь чёткие, не сглаживаются `computeVertexNormals`.
- **`HOUSE_TYPE_MAP`** теперь поддерживает прямой typeId (через regex `/^type_\d+$/`). `S.houseType` хранит typeId напрямую (например, `"type_10"`), но legacy русские имена через `legacyMap` в `dSelHouse` всё ещё работают.
- **Cache-bust**: `shared/house-builder.js?v=22`, `viewer3d-core.js?v=17`, `nav-desktop.js?v=18`.

Сделано в итерациях v=16 (porch + velux/dormer + pad-стыковка):

- **Porch builder** (`buildPorch` в `shared/house-builder.js`) — реализован «с нуля» процедурно, без GLB. Привязка к двери: поиск через `findMainDoorPlacement` по items outline 1-го этажа, приоритет — флаг `"main": true`. Параметризация через `features.porch` в дескрипторе: `width`, `depth`, `offset_along`, `step_rise`, `step_run`, `has_canopy`, `canopy_height`, `canopy_slope`, `has_railing`, `railing_height`. Геометрия: ступени с nosing-плитой (выступ вперёд и по бокам), щёки с лестничным контуром через `ShapeUtils.triangulateShape`, 2 колонны на оси щёк, плоский навес с наклоном к ступеням, перила платформы (поручень + балясины с шагом 26 см), наклонные перила вдоль ступеней (балясины на каждой ступени + newel post). Материалы: `mat_porch_step` (тела ступеней/щёк), `mat_porch_deck` (проступи/плиты), `mat_porch_column`, `mat_porch_canopy`, `mat_porch_railing`.
- **Pad дома перенесён в HouseBuilder** — теперь строится по реальному bbox `firstOutline.bbox`, не по формулам `houseL/houseW` в `viewer3d-core.js` (которые рассчитывались с другим RATIO и не совпадали с координатами дескриптора). Pad крыльца стыкуется с pad дома: заходит на 30 см под стену, Y центра = `padThick/2`. В `viewer3d-core.js` pad остался только в fallback-ветке (когда HouseBuilder ещё не загружен).
- **Velux** (`placeVelux`) — мансардное окно в плоскости ската. Использует **правосторонний** базис ската: `xAxis = axisUp × normal` (важно — `makeBasis(alongHoriz, up, normalHoriz)` даёт ЛЕВОСТОРОННИЙ базис с `det=-1`, и `setFromRotationMatrix` для такого возвращает невалидный quaternion). GLB рамы поднят на 6 см над скатом, поверх — custom plane glass на 8.5 см над скатом (GLB-стекло native — горизонтальная плита в XZ, после ротации уходит перпендикулярно скату — не работает).
- **Dormer** (`placeDormer`) — слуховое окно «дом-образный». Процедурный: walls + 2 ската + 2 фронтона, конёк ПЕРПЕНДИКУЛЯРЕН главному коньку (`+Z = глубина dormer'а`), угол ската мини-крыши = `(w/2) * slopeTan` (= углу главной крыши). `basePt.y -= (d/2) * slopeTan` — передняя нижняя часть садится на скат, задняя глубже в скате. Условие скрытия задней крыши: `h + (w/2)*slopeTan ≤ d*slopeTan` ⇒ `d ≥ h/slopeTan + w/2`. GLB-стекло окна скрыто (`visible = false`), вместо него custom flat plane на 5 см впереди стены (рама на 10 см впереди — фрейм полностью снаружи).
- **Расширение спеки дескриптора** (`HOUSE_DESCRIPTOR_FORMAT.md`): `features.porch.*` (полный набор полей), `door.main` (флаг главного входа), `roof_windows[].rect_index`. В `house_type_01.json` добавлен `features.porch` (с `offset_along: -0.20` чтобы крыльцо не вылезало за южный угол) и 2 `roof_windows`: 2 velux на южном скате + 1 dormer на северном.
- **fetch дескриптора с `cache: 'no-store'`** — иначе браузер может «застрять» на старой версии JSON даже после hard reload скриптов.
- **Cache-bust**: `shared/house-builder.js?v=16`, `viewer3d-core.js?v=16`.

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
   - ~~Porch builder~~ ✅ (`buildPorch` в `shared/house-builder.js`, привязка к двери с флагом `"main": true`, процедурно с ступенями/nosing/щёками/колоннами/навесом/перилами).
   - ~~Dormer/velux на скате крыши~~ ✅ (`buildRoofWindows` в `shared/house-builder.js`, velux через GLB в плоскости ската + custom flat glass; dormer процедурный с правосторонним базисом и автоматическим утоплением).
   - ~~Mansard-крыша~~ ✅ (`buildBrokenMansardRoof` в `shared/house-builder.js` — классическая ломаная крыша Мансар с двумя углами наклона, knee wall опционально).
   - ~~Карусель типов домов в UI шага 1~~ ✅ (сетка 5 карточек × скролл из всех 10 типов через `assets/houses/index.json`, 3D-превью через shared `WebGLRenderer` + JPEG dataURL, one-click переход на step 2).
   - ~~Per-floor sliders area/floor_h~~ ✅ (динамический UI step 2 на основе `desc.floors`, глобальный + per-floor контролы, `params.floorAreas[]` / `floorHs[]` в `HouseBuilder.buildHouseFromDescriptor`).
   - ~~`mod_cornice_corner.glb`~~ ✅ (создан через Blender MCP, усечённая пирамида с трапециевидным сечением; ставится на convex-pillars).
   - ~~Soffit (подшивка свеса)~~ ✅ (`buildRoofSoffit` — плоская плита по `inflateOrthoOutline(outline, eave)` под скатами).
   - ~~GLB-модули `mod_porch_column.glb` / `mod_porch_step.glb`~~ ✅ (подключены в v=28 через `placeScaledGlb` с автомасштабированием по детектированному bbox + fallback на BoxGeometry).
   - ~~Балконы~~ ✅ (v=28 — `features.balconies[]`: плита + перила с трёх сторон, опциональные опоры, привязка к фасадам этажей >= 1 через `side` или `wall_index`; демо в `house_type_09.json`).
   - ~~Правильный карниз/rake для двускатной крыши~~ ✅ (v=28 — фронтон на линии стены, скат с rake overhang, наклонный rake soffit + горизонтальный eave soffit).
   - `mod_cornice_concave_corner.glb` — L-shape filling bay-corner для идеального стыка cornice'ов на concave-углах (сейчас они просто overlap'ятся на 15 см, что незаметно).
   - Пересборка GLB дверей: handle как sibling leaf_main (не child), чтобы handle не масштабировался вместе со створкой.
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
