# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус
- **Фронтенд** разбит на файлы, PBR-визуализация работает; десктоп-UI создан и отлажен (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance). UI без скруглений; кнопки действий редакторов — в правом нижнем углу.
- **Конструкции:** терраса/крыльцо (multi-rect) с **ограждением** (GLB-модуль `mod_railing`, единый контур объединения блоков) и навесом, ступени, дорожки (монолитная лента), забор (стандартные секции 2 м, высота полотна 1.5/1.9 м — `S.fenceH`), **грядки** (GLB-плантер 3×1, дискретная высота). Растительность сейчас **отключена** (легко вернуть — см. ниже).
- **Материалы:** каждый деко-элемент (терраса/ступени/дорожки/грядки/бассейн/причал) красится **независимо** (`S.elementMat`). PBR-текстуры товара ложатся на deck-материал с кубическим UV.
- **Материалы дома:** на шаге «Параметры дома» — выбор квадратными образцами (крыша: черепица/металл зелёный/металл красный; фундамент: бетон/камень; стены: штукатурка/кирпич/сайдинг). Накладываются по имени материала меша (`_applyHouseMaterials`): крыша — per-slope UV (полосы вниз по скату), цоколь/труба исправлены (труба = металл водостоков), откосы окон белые, рамы/двери коричневые, стекло 50%, шторы (`mat_curtain`) — белые с картой нормалей `assets/curtain_norm.jpg`. Текстуры — варианты `roof/wall/base_*_0N` в `assets/`.
- **Каталог:** подключён боевой REST-API `sollersdev.ru` через клиент `ResourceManager.js`. Реальные разделы/товары/цены/текстуры; материал привязан к разделу каталога по элементу (`CONSTRUCTION_TO_SECTION`). **Превью и 3D-текстуры (`texture_urls`, картинки `/static/DPK/...`) бэкенд отдаёт только у товаров, помеченных тегом** — поэтому запрос товаров идёт с тег-фильтром по разделу (`SECTION_TAGS` в `state.js`: 2314/2329→`terrasnaya_doska`, 2330→`dpk_steps`, 2683/2680/2345→`walls`); без тега раздел вернул бы товары без текстур. Локально работает через dev-прокси `devserver.py` (обход отсутствия CORS + ретраи к нестабильному апстриму). **Фильтр по цвету** работает: у товаров API нет поля цвета — имя цвета (палитра `CATALOG_COLOR_HEX` из COLORS.md) детектируется в названии товара как отдельное слово, длинные имена в приоритете («тёмно-серый» ≠ «Серый»). **Смета** считается по геометрии × цена из каталога.
- **Модульная система GLB** для домов (см. `HOUSE_MODULES_SPEC.md`): 30 GLB-модулей; JS-загрузчик/сборщик `shared/house-builder.js` написан (`loadHouseType`, `buildHouseFromDescriptor`); процедурный `buildHouseMeshes` остаётся fallback.
- **Бэкенд (свой):** не начат. Каталожный API — внешний (`sollersdev.ru`). **CORS включён** (`Access-Control-Allow-Origin: *` на `/api` и `/static`), поэтому браузер может ходить на него напрямую — прокся для продакшна не нужна (нужна только для VPN-обхода/ретраев локально).
- **Деплой (GitHub Pages, статика без прокси):** домен API выбирается по хосту в `index.html` — `localhost/127.0.0.1` → `''` (локальный прокси `devserver.py`), любой другой хост → `https://sollersdev.ru` напрямую (CORS). На статике same-origin `''` не работает (нет `/api`).

## Запуск (dev)
- **Сервер:** `python devserver.py [порт]` (по умолчанию 8848) или двойной клик по `run-server.bat`. Раздаёт сайт + проксирует на `sollersdev.ru` всё, **чего нет локально** (явно `/api`,`/static`, плюс любые `/upload/...` и т.п. — картинки/текстуры товаров), делая их same-origin (без CORS). Открыть: `http://localhost:8848`.
- **VPN (Outline):** при включённом Outline российский сервер каталога недоступен (полный туннель). `run-server.bat` сам (через UAC) добавляет точечный маршрут к IP каталога в обход VPN (см. переменные `CATALOG_IP`/`LAN_GATEWAY` в начале бата). Claude/прочее остаётся в туннеле.
- **Важно:** просто открыть `index.html` файлом (`file://`) нельзя — нужен HTTP-хост. Домен API (`RESOURCE_API_DOMAIN` в `index.html`) теперь **выбирается автоматически по `location.hostname`**: `localhost`/`127.0.0.1` → `''` (через локальный прокси `devserver.py`), иначе → `'https://sollersdev.ru'` напрямую (CORS включён). Ручное переключение больше не требуется.

---

## Структура файлов (текущая)

```
/frontend — десктопная версия (3-column workspace)
  index.html              # 3 экрана: выбор дома → параметры+3D → workspace.
                          # Хедера нет; «Итог» — плавающая кнопка (.d-fab-summary) в правом
                          # нижнем углу, видна только на шаге 3.
                          # Initial loading state в d-house-grid — виден до выполнения JS.
  styles-desktop.css      # все стили (3-column layout, sidebar, panel, loading-индикаторы).
                          # Шаг «Параметры»: заголовок и «Назад/Дальше» приколочены,
                          # скролл только у .d-params-scroll. Правая панель материалов
                          # (.d-panel) скрыта (.hidden), пока не выбран элемент проекта.
  nav-desktop.js          # dGoTo, sidebar, canvas editors, right panel, catalog,
                          # карусель домов + прогресс-каунтер генерации превью

/frontend — legacy мобильные файлы УДАЛЕНЫ (styles.css, nav.js, ui.js, catalog.js
  не были подключены ни одним HTML; лежат в git-истории). Вместе с ними удалены
  мёртвые заглушки совместимости в nav-desktop.js (goTo/updProg/selHouse/tci/
  renderSec/renderSwatches) и константы SEC_SCREEN/CATALOG_COLORS/TOTAL/step.

/frontend — общие файлы
  state.js                # S (+ elementMat, estimate, catSection, beds, bedH, fenceH,
                          # toggles, pathWidth), SECS, PRICE_TIERS, STUB_RESULTS,
                          # CATALOG_SECTIONS, CONSTRUCTION_TO_SECTION, SECTION_TAGS,
                          # CATALOG_COLOR_HEX (имя→hex) + ELEMENT_COLOR_NAMES (набор цветов на тип, по COLORS.md),
                          # HOUSE_TYPE_MAP (легаси-имя → typeId), DEFAULT_STEPS_RECT,
                          # хелперы isEmptyLot() и tgOn(id)
  ResourceManager.js      # клиент каталожного API sollersdev.ru (ResourceManager, Filter,
                          # FilterType, Presets, ProductResource). Домен — глобал RESOURCE_API_DOMAIN.
  canvas.js               # pan/zoom движок, snap-canvas, крыльцо (drag+resize), грядки (beds)
  viewer3d-core.js        # ядро 3D: сцена, HDRI, PBR-материалы, UV, buildScene3d-оркестратор.
                          # Дом строится через HouseBuilder.buildHouseFromDescriptor (см. shared/house-builder.js);
                          # ensureHouseLoaded() — async-кэш дескриптора и GLB-модулей.
                          # _housePoly — кэш полигона этажа на сборку (билдеры не пересчитывают).
  viewer3d-builders.js    # строители конструкций (выделен из core): дом-fallback
                          # (buildHouseMeshes), настилы/подкладки, грядки, кэш GLB
                          # ограждения, ступени, крыльцо, дорожки, забор
  viewer3d-railing.js     # периметр террасы (skip-диапазоны), union-контур блоков,
                          # buildRailing3d (GLB mod_railing), навесы террасы
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

devserver.py              # dev-сервер: статика + прокси → sollersdev.ru. Проксирует всё,
                          # чего нет локально (явно /api,/static + /upload/... картинки товаров);
                          # переписывает ссылки апстрима (http/https/www) в относительные.
                          # (обход CORS, ретраи к нестабильному апстриму).
                          # Статика отдаётся с Cache-Control: no-store (cache-bust ?v=N только
                          # на скриптах; иначе браузер кэширует index.html и тянет старые ссылки).
run-server.bat            # запуск devserver.py двойным кликом (Windows). Через UAC добавляет
                          # маршрут к IP каталога в обход VPN (Outline), затем поднимает сервер.
texture-viewer.html       # отдельная утилита: PBR-визуализатор текстур. Бокс 5×5×1 м,
                          # орбит-камера, тайл 1 м (box-UV). Карты (альбедо/нормаль/
                          # шероховатость/металл/AO) грузятся с диска drag&drop или кнопками
                          # (авто-раскладка по имени файла). Three.js из vendor/three; работает
                          # и через сервер, и офлайн (file://). Не связан с основным приложением.

ARCHITECTURE.md
HOUSE_DESCRIPTOR_FORMAT.md   # формат JSON-дескриптора дома (spec v2)
HOUSE_MODULES_SPEC.md        # спецификация модульной системы 3D-домов (spec v2)
COLORS.md                    # цвета товаров по категориям каталога (источник палитры фильтра)
```

### Порядок подключения скриптов

**Основной фронт (index.html):**
```
Three.js r128 → OrbitControls → RGBELoader → EXRLoader → GLTFLoader
state.js → canvas.js
→ shared/house-builder.js
→ RESOURCE_API_DOMAIN (inline) → ResourceManager.js  (каталожный API; зависит от THREE)
→ viewer3d-core.js → viewer3d-builders.js → viewer3d-railing.js
→ viewer3d-entourage.js → nav-desktop.js

viewer3d-core/builders/railing — classic scripts с общей глобальной областью
видимости; кросс-файловые обращения только на этапе вызова (runtime), поэтому
важен лишь порядок подключения.
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
  sections: ['terrace', 'steps'], // выбранные конструкции (sidebar — кнопки с ✓)
  pts: {
    pool_terrace: [{x,y}, ...],   // полигон (нормализованные 0..1)
    paths:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
    pier:         [{x,y}, ...],
    fence:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
  },
  // Терраса/Крыльцо — массив прямоугольников (multi-rect редактор).
  terraceRects:      [{ x, y, w, h }, ...], // нормализованные 0..1, кратные SNAP/GRID
  activeTerraceRect: 0,            // индекс выбранного rect или null
  // Ступени — один прямоугольник; глубина в плане пересчитывается из bh.
  steps:        { x, y, w, h },
  // Грядки — массив rect'ов фиксированного размера 3×1 м (resize запрещён, только
  // перемещение + поворот 90°). Ориентация ортогональная: длинная сторона вдоль X (w>h)
  // или вдоль Y (w<h). Высота борта — глобальная (S.bedH), дискретно 0.15/0.20/0.27/0.30 м.
  beds:         [{ x, y, w, h }, ...], // нормализованные 0..1
  activeBed:    0,                     // индекс выбранной грядки или null
  bedH:         0.20,                  // высота борта (м), одна на все грядки
  mats:         {},                // выбранные материалы по секции
  samples:      [{ id, name, color }], // накопленные образцы
  activeSample: null,              // текущий образец для примерки
  matSubMode:   null,              // 'deck' | 'railing' — подрежим материала террасы
  curSec:       0,
  catColors:    Set,               // выбранные ЦВЕТА каталога (имена из COLORS.md) — фильтр работает
  catPrice:     null,
  catShowResults: false,
  toggles:      {},                // тумблеры редакторов (data-id → bool); 3D читает через tgOn(id)
  pathWidth:    120,               // ширина дорожки, см (инпут v-paths-width зеркалится сюда)
};
```
`S.houseType` — typeId дескриптора (`'type_NN'`), `'no_house'` (пустой участок) или null
(не выбран); проверка «без дома» — только через `isEmptyLot()`.

---

## Архитектура viewer3d

### viewer3d-core.js / viewer3d-builders.js / viewer3d-railing.js

Монолит viewer3d-core.js разрезан на три файла (общая глобальная область
видимости, порядок подключения важен — см. выше). Ниже функции помечены
файлом: **[core]** — сцена/материалы/оркестратор, **[builders]** — строители
конструкций, **[railing]** — периметр/ограждение/навесы.

**Инициализация [core]:**
- `init3dCanvas(slotId)` — создаёт renderer, scene, camera, OrbitControls, освещение, землю. При повторном вызове перемещает renderer в новый слот (`moveThreeTo`).
- `_autoLoadHdri()` — при старте пробует загрузить `assets/environment.hdr`. Нашёл → PMREMGenerator → `scene.environment`, скрывает процедурное небо.
- `_injectHdriButton()` — кнопка ручной загрузки `.hdr`/`.exr` на шаге 10.
- `_applyHdri()` — при применении HDRI корректирует баланс освещения: `sunLight.intensity = 1.8`, `ambLight.intensity = 0.0`, `toneMappingExposure = 0.85` для сохранения контрастных теней.

**Загрузка текстур [core]:**
- Общий `_loadTexBase(prefix, filename, repeat, encoding, onLoad)` — `TextureLoader.load`
  возвращает текстуру сразу и дозаполняет по загрузке (placeholder-хак с
  `Object.assign` убран — копировал id/uuid и путал кэши рендерера).
- `_loadTex` — albedo (sRGB), `_loadNorm` — normal map, `_loadData` — roughness/AO (linear).
- Кэш в `threeState.texCache`; при ошибке текстура остаётся пустой (материал — цветом).

**Процедурные текстуры (ground) [core]:**
- `_makeGroundMat()` — создаёт MeshStandardMaterial с процедурными diffuse + normal map.
- `_generateGroundTex()` — 1024×1024 canvas с органическими эллиптическими пятнами (не круглыми). Используется `ctx.save/translate/rotate/scale` для разнообразия форм.
- `_generateGrassNormal()` — 512×512 процедурная normal map с 60 000 травинок, имитирующая газонную поверхность. RepeatWrapping 14×14.

**UV-проекция [core]:**
- `_applyBoxUV(mesh, tileSize, groupOffset)` — кубическая UV-проекция, вычисляется на CPU из локальных позиций вершин + суммарного смещения групп-родителей.
- `_wallUVHelper(grp, grpOff)` — рекурсивно обходит группу стен, передаёт накопленный offset.

**Геометрия:**
- `buildScene3d()` **[core]** — оркестратор: дом, терраса, крыльцо, дорожки, забор, перила.
  Тумблеры читает через `tgOn(id)` (S.toggles), ширину дорожки — из `S.pathWidth`;
  полигон этажа дома считает один раз и кэширует в `_housePoly` для всех билдеров.
- `buildHouseMeshes()` **[builders]** — стены с окнами/дверью, цоколь, двускатная крыша с UV (процедурный fallback).
- `xWallWithWins(len, wins, extZ)` — стена по X с окнами и внешними подоконниками. `extZ` определяет сторону подоконника (0 = ближняя, wt = дальняя).
- `zWallWithDoor(zLen, hasDoor, hasWins, extX)` — стена по Z с дверью/окнами и подоконниками. `extX` определяет сторону.
- `buildTerrace3d()` **[builders]** — настил из досок + лаги + опоры по полигону + юбка (skirt panels, deck-материал, толщина 0.06). Высота настила = `foundH - 0.01` (на 1 см ниже цоколя, чтобы избежать z-fighting). Используется для **бассейна и причала** (полигональные секции).
- `_buildTerracePoly()` **[builders]** — настил **составной террасы** (секция `terrace`, multi-rect): призма по плановому полигону (верх-настил + «юбка» + низ), нормали верха `+Y`, нормализация обхода контура. **Миттер на углах:** в `buildScene3d` каждое крыло подрезается до угловой ячейки, а ячейка заполняется двумя треугольниками — доски двух перпендикулярных крыльев сходятся по диагонали 45°. Работает для перекрытия, встык и обёртки вокруг выпуклого угла дома (L/П/O); T/+-врезки пропускаются. **Направление досок — вдоль ближайшей стены дома** (`plankDir`: переднее/заднее крыло → вдоль X, боковое → вдоль Z; fallback без дома — длинная сторона), поэтому картинка стабильна и не зависит от разбивки на блоки.
- `buildPorch3d()` **[builders]** — площадка + ступени с автоопределением направления + боковые панели (deck-материал, толщина 0.06).
- `buildPaths3d()` / `_buildPathRibbon()`, `buildFence3d()` **[builders]** — поддерживают multi-line через `splitAtBreaks()`. Дорожка — монолитная лента с миттером кромок на углах (`_offsetPolyline`); доски-перекладины идут **строго ⟂ локальной осевой каждого сегмента**. Каждый сегмент строится своими вершинами, UV-координата `V` = проекция точки на ось ИМЕННО этого сегмента (по центру совпадает с накопленной длиной → планки выровнены на стыке, к кромкам угла — чистый миттер-шов без «ёлочки»/скоса). **Пересечения линий (T-стыки/ответвления):** `_trimPathJunctions` укорачивает КОНЕЦ линии, упирающийся во ВНУТРЕННОСТЬ ребра другой линии, до ближнего края той дорожки (на полуширину для перпендикуляра) — лента примыкает, а не перекрывает. Свободные концы и стыки «конец-в-конец» не трогаются; чистое пересечение серединами (X) не обрабатывается (для сети-дерева не встречается).
- `buildRailing3d()` **[railing]** (навесы — там же: `buildTerraceCanopies`, `_terraceCanopyParams`, `_buildCanopySlab`; кэш GLB `ensureRailingLoaded` — [builders]) — ограждение террасы из GLB-модуля `mod_railing.glb` (`post`/`rails`/`balu_short`/`balu_floor`). Строится по **единому контуру объединения** блоков террасы (`_terraceUnionLoops` + `_insetOrthoPolygon`) — без разрывов на стыках. Секции фикс. ширины ~1 м (одинаковы везде) + узкий «добор»; `rails` тянутся масштабом, балясины — нативного сечения (число по шагу 0.1 м, узор «2/5/8 от настила» = `balu_floor`). При навесе высокие столбы-опоры (бокс до низа навеса, высота из `canopyPlaneH`) на углах и каждые ~2 м; дедуп столбов на стыках (`_railPostReg`/`placePostAt`). Загрузка/кэш GLB — `ensureRailingLoaded()`.
- `_buildProceduralSky()` **[core]** — ShaderMaterial небо с солнечным ореолом (до HDRI).

**Освещение и тени:**
- Направленный свет (`sunLight`): shadow camera 26×26, near 0.5, far 80, bias -0.0003, normalBias 0.02, radius 3 (mobile) / 5 (desktop).
- При HDRI: sunLight.intensity 1.8, ambLight.intensity 0.0, exposure 0.85.

**Площадка под домом (тёмная отмостка):**
- Толщина 5 см, расширена на 30 см наружу от стен.
- **Повторяет реальный контур дома** (Г/П/Т/+-формы), а НЕ его bbox: строится в
  `HouseBuilder.buildHouseFromDescriptor` через `buildPadSlab(outline, 0.30, 0.05, mat)` —
  outline инфлейтится наружу (`inflateOrthoOutline`), затем триангулируется в плоский слаб
  (Earcut, как полигональная flat-крыша). У вогнутых углов (бухты Г/П-форм) отмостка не
  «залезает» в пустой угол — там остаётся газон. Материал меша — `mat_house_pad`.
- **Терраса и ступени** получают свою подкладку под ними (`buildConstructionPad` в
  `viewer3d-builders.js`, материал `mat_construction_pad`): axis-aligned footprint конструкции
  в мире + 30 см наружу, тонкая плита от земли. Перекрывается с pad-ом дома и соседними
  подкладками бесшовно (одинаковый цвет/высота). НЕ кладётся в `deckMeshes`, чтобы смена
  deck-материала не перекрашивала отмостку. Для **ступеней** footprint берётся по bbox
  реальной геометрии лестницы (`stairGroup` в `buildSteps3d`), а НЕ по drawn-rect `S.steps`
  (его глубину `buildSteps3d` игнорирует — пересчитывает на `n × stepDepth`).
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
| Canvas wrapper IDs (cw-*) совпадают | canvas.js ищет элементы по `cw-` + name — одинаковые ID в обеих версиях |

---

## Десктопный UI (index.html)

### 3 экрана:

1. **d-screen-1** — выбор типа дома (fullscreen grid карточек)
2. **d-screen-2** — параметры + 3D (left: area/floor/foundation с range-слайдерами, center: 3D)
3. **d-screen-3** — рабочая область (3 колонки):
   - **Left sidebar** (300px) — кнопочное меню позиций (single-selection). Клик → выбор для каталога или открытие canvas-редактора. Карандаш (✏) для повторного редактирования.
   - **Center** — 3D-вид или canvas-редактор (overlay поверх 3D)
   - **Right panel** (340px) — материалы: фильтры цвета/цены → результаты (auto-show) → образцы.
     Палитра цвета — **своя на тип элемента** (`_elementColors(dActiveItem, S.matSubMode)` → `ELEMENT_COLOR_NAMES`/`CATALOG_COLOR_HEX`, по COLORS.md; терраса+railing — отдельные наборы). У каждого квадрата `title` = название цвета из каталога (tooltip при наведении).

### Sidebar (nav-desktop.js):
- **`dActiveItem`** — текущая выбранная позиция (single-selection).
- **`dEditorOpen`** — блокирует панель и другие кнопки пока canvas-редактор открыт.
- **`dConfigured`** (Set) — отмечает позиции, прошедшие через "Готово".
- Клик по некотронутой позиции с редактором → открывается canvas. Клик по сконфигурированной → выбор для каталога.
- Для террасы в панели всегда отображается sub-toggle "Терраса / Ограждение" (`S.matSubMode`).

### Canvas-редакторы:
Каждая секция с редактором (terrace, steps, paths, fence, beds, pool_terrace, pier) имеет свой `d-center-canvas` overlay.
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
| Velux на скате | ✅ в shared. GLB-модуль трансформируется параметрически + правосторонний базис ската (`axisAlong, axisUp, normal`). Размещение БЕЗ выреза в скате (frame поднят на 6 см над плоскостью). Custom flat glass **сажается в раму** (верх рамы измеряется самокалибровкой по вершинам GLB вдоль нормали → стекло чуть ниже канта, не «висит»); под стеклом — **полигон-штора** (`mat_curtain`, белый + карта нормалей). Стекло velux — некалёное (metalness 0), чтобы штора читалась. Окно/стекло/штора — выше плоскости крыши. |
| Dormer на скате | ✅ в shared. Процедурная сборка: walls (BoxGeometry) + 2 ската мини-крыши + 2 фронтона. Конёк перпендикулярен главному, угол совпадает с углом главной крыши. `basePt.y` опускается на `(d/2)*tan(angle)` чтобы передняя часть села на скат. Размеры подбираются так, чтобы задняя стенка ушла под скат (`d ≥ h/tan + w/2`). Окно во фронтоне с custom flat glass перед стеной. |
| Процедурный билдер `buildHouseMeshes()` | ✅ в `viewer3d-builders.js`, используется как fallback пока `ensureHouseLoaded()` в полёте |
| Подключение в основной фронтенд (`viewer3d-core.js` + `nav-desktop.js`) | ✅ `HOUSE_TYPE_MAP` (state.js) + `ensureHouseLoaded`; `dSelectHouseAndGo` запускает preload; в `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor` |

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

Сделано в итерации v=118 (Отделка фасада — выбор сегментов на плане + внятный план дома):

- **`getHouseFacadeLayout(desc, params)`** (house-builder, public API) — плановая раскладка фасада 1-го этажа: рёбра с элементами (сегменты стен с ТЕМИ ЖЕ segId, что кладёт `buildEdgeWall` в 3D, окна, двери) в мировых координатах дома. Выбор на плане и в 3D — один `S.wallZones`.
- **План-редактор фасада** (`initFacadeCanvas`/`drawFacadeCanvas` в canvas.js, `d-canvas-facade` в index.html): facade теперь `hasEditor:true`. Кликабельные полосы-сегменты по рёбрам (выбранные — синим, штрихи на границах), клик тоглит сегмент и живо обновляет 3D (`_applyFacadeSelection` без пересборки). Кнопки «Выбрать всё»/«Сбросить»/«✓ Готово», счётчик. Верхние этажи выбираются в 3D-режиме после «Готово». Пока редактор открыт, 3D-пикинг и плавающий тулбар выключены (`!dEditorOpen` в `_dSyncFacadeMode`).
- **Внятный план дома во всех редакторах:** `_drawHouseOpenings` (canvas.js) рисует поверх контура окна (проём + тонкая синяя линия) и двери (проём + створка + пунктирная дуга открывания внутрь) по той же раскладке. Терраса/ступени теперь ставятся с оглядкой на реальные двери.
- **Фикс:** дефолт `pillar_size` в `getHouseFloorPolygon` был 0.25 против `wall_thickness||0.2` у билдера — при отсутствии `pillar_size` в дескрипторе контур на плане расходился с 3D на сантиметры. Выровнено.
- Кэш раскладки `_hwtCache` по (desc, area) — пересчёт только при смене.
- Cache-bust: `canvas.js?v=27`, `nav-desktop.js?v=46`, `shared/house-builder.js?v=75`.

Сделано в итерации v=117 (Отделка фасада — выбор сегментов в 3D):

- **Стабильные id вертикальных сегментов стен.** `buildEdgeWall` (house-builder) присваивает каждому полноростовому wall-сегменту `userData.segId` (`f{этаж}:e{ребро}:s{сегмент}`) + размеры `segW`/`segH`. Перемычки над/под окнами и фронтоны id не получают (не вертикальные элементы периметра). Id детерминированы для фиксированных дескриптора и площадей (смена контура сбрасывает проект вместе с `S.wallZones`).
- **Выбор сегментов кликом в 3D.** Элемент «Отделка фасада» на шаге 3 включает `S.facadeMode`: raycast-пикинг (`_initFacadePicking`/`_pickFacadeSegment` в viewer3d-core) тоглит сегменты в `S.wallZones`; клик отличается от orbit-drag по смещению/времени, стекло прозрачно для луча, сквозь дом выбор не проходит. Выбранные подсвечиваются emissive-синим.
- **Материал панелей per-segment.** `S.elementMat.facade` (текстуры товара walls-тега или цвет) ложится на выбранные сегменты через `_applyFacadeSelection` БЕЗ пересборки сцены; родной материал кэшируется в `userData._baseMat`, мировой box-UV ставится один раз. Пустой выбор = «весь фасад» (легаси-поведение «Применить»).
- **Тулбар над 3D** (`.d-facade-bar`): подсказка, счётчик выбранного, «Выбрать всё» / «Сбросить».
- **Смета:** `facade` в `_computeEstimate` — площадь выбранных сегментов (`facadeSelectedAreaM2`), пустой выбор = весь фасад.
- Cache-bust: `state.js?v=26`, `nav-desktop.js?v=45`, `viewer3d-core.js?v=117`, `shared/house-builder.js?v=74`, `styles-desktop.css?v=5`.

Сделано в итерации v=116 (рефакторинг по код-ревью, пп. 7–13):

- **3D-слой не читает DOM (п.7).** Тумблеры редакторов зеркалятся в `S.toggles` (в `ttg`/`_dCacheToggleDefaults`/сбросе), 3D читает через `tgOn(id)` (state.js); ширина дорожки — `S.pathWidth` (canvas и 3D берут только из S). Полигон этажа дома считается один раз за сборку и кэшируется в `_housePoly` — билдеры берут его из кэша вместо ≤5 повторных `getHouseFloorPolygon` с чтением `v-area` из DOM (заодно ушло расхождение клампованной/сырой площади между домом и конструкциями).
- **Дедуп констант (п.8).** `HOUSE_TYPE_MAP` — единый источник в state.js ('Участок без дома' → 'no_house'); `DEFAULT_STEPS_RECT` вместо трёх копий чисел.
- **Разрез viewer3d-core.js (п.9).** 3.4 тыс. строк → `viewer3d-core.js` (сцена/материалы/UV/оркестратор buildScene3d) + `viewer3d-builders.js` (дом-fallback, настилы, грядки, ступени, крыльцо, дорожки, забор) + `viewer3d-railing.js` (периметр, ограждение GLB, навесы). Код перенесён без изменений; общая глобальная область видимости, важен порядок подключения (см. «Порядок подключения скриптов»).
- **Легаси удалено (п.10).** nav.js, ui.js, catalog.js, styles.css (не подключались; в git-истории), no-op заглушки совместимости в nav-desktop.js, мёртвые `SEC_SCREEN`/`CATALOG_COLORS`/`TOTAL`/`step` в state.js. Репозиторий git уже существовал (origin: MicNau/SHPUK-2).
- **_loadTex без placeholder-хака (п.11).** `TextureLoader.load` возвращает текстуру сразу — placeholder + `Object.assign` (копировал id/uuid, путал кэши рендерера) убраны; три загрузчика сведены к `_loadTexBase`.
- **Мягкий сброс шага 2 (п.13).** Проект обнуляется только если при возврате в workspace изменился КОНТУР дома (тип/площади — `_dParamsSig`); высоты этажа/фундамента сброса не вызывают. Введённые значения параметров при повторном входе на шаг 2 сохраняются (`keepValues` в `_dRenderFloorParams`).
- Cache-bust: `state.js?v=25`, `canvas.js?v=26`, `nav-desktop.js?v=44`, `viewer3d-core.js?v=116` + новые `viewer3d-builders.js?v=1`, `viewer3d-railing.js?v=1`.

Сделано в итерации v=115 (фиксы код-ревью: пустой участок, дубли слушателей, цвето-фильтр):

- **«Пустой участок» починен.** Десктоп писал в `S.houseType` `null`, а все проверки «без дома» сравнивали с легаси-строкой `'Участок без дома'` → на пустом участке рисовался процедурный fallback-дом (в 3D и на canvas-планах). Теперь: `dSelectHouseAndGo` хранит `'no_house'` явно (отличим от «ещё не выбрано»), единая проверка — `isEmptyLot()` в `state.js`; ею пользуются `buildScene3d` (`isNoHouse`) и canvas.js (фон дома, снап к стенам). У карточки «Пустой участок» появился `data-typeid="no_house"` — подсветка выбора заработала.
- **Дубли слушателей snap-canvas.** `initSnapCanvas` вешал click/wheel/touch на wrap при КАЖДОМ открытии редактора (клонирование canvas не помогало — слушатели на wrap): после N открытий один клик ставил N точек. Теперь guard `wrap._snapBound` (как у террасы/ступеней/грядок), а обработчики `attachPanZoom` читают `CV[name]` свежим (пересоздание состояния при переоткрытии больше не оставляет их со стухшей ссылкой).
- **Гонка `ensureHouseLoaded`.** Коллбек загрузки дескриптора теперь проверяет, что `_houseCache.typeId` не сменился за время загрузки — быстрое переключение типов больше не подкладывает устаревший дескриптор под новый тип.
- **Цвето-фильтр каталога заработал.** У товаров API нет поля цвета — цвет входит в название («…венге, м.пог»), см. COLORS.md. `_detectColorNames(text)` ищет имена палитры (`CATALOG_COLOR_HEX`) в тексте как целые слова, длинные имена в приоритете («тёмно-серый» не засчитывается как «Серый»); `_filterByColors` применяется и к реальным товарам, и к заглушкам; OR-семантика по выбранным цветам. Цвет позиции — из НАЗВАНИЯ; `preview_text`/`detail` — только fallback, когда в названии цвета нет (`_itemColors`): у товара конкретного цвета описание перечисляет цвета всей линейки и давало ложные совпадения. При смене элемента выбранные цвета, отсутствующие в палитре нового элемента, вычищаются. Пустая выдача — «Нет товаров под выбранные фильтры».
- **ResourceManager:** `SORT_FILEDS` → `SORT_FIELDS`, убран отладочный `console.log` в TAGS-обработчике, `loadTextures` больше не считает загрузку успешной при упавших текстурах (каждый catch инкрементит счётчик сбоев; флаг = «0 сбоев») — повторная попытка загрузки теперь реально происходит.
- **devserver.py:** `_proxying` сбрасывается в начале каждого запроса (при keep-alive флаг «залипал» и статика теряла `no-store`).
- Cache-bust: `state.js?v=24`, `canvas.js?v=25`, `ResourceManager.js?v=2`, `viewer3d-core.js?v=115`, `nav-desktop.js?v=43`.

Сделано в итерации v=93 (крыша разбеливалась):

- **Текстура крыши была намного светлее исходника.** Причина: крыша смотрит вверх → ловит максимум яркого HDRI-неба через `scene.environment` (IBL), а у `mat_roof` был `envMapIntensity = 1`. Цвет/sRGB/металличность ни при чём (color белый, map sRGB, metalness 0). Фикс: в `_applyHouseMaterials` для `mat_roof` ставим `envMapIntensity = 0.25` — черепица/металл совпадают с исходником. Cache-bust: `viewer3d-core.js?v=91`.

Сделано в итерации v=92 (доводка материалов/света дома — 2-й фидбэк):

- **Труба = материал водостоков.** В house-builder труба (`chimney`) переименована в `mat_metal` целиком (тело + колпак). В `_applyHouseMaterials` добавлена ветка `mat_metal` — единый металл (цвет `0x66666b`, metalness 0.85, roughness 0.30) на водостоки И трубу. `mat_concrete` (колпак) больше не используется.
- **Откосы окон/дверей — белые** (уточнение: «простенки» = внутренние поверхности проёма, не наружная стена). Откоса в GLB-модуле окна нет (он образован гранями стен), поэтому `buildOpeningReveal` в `transformParametricModule` добавляет лайнер из 4 тонких белых слэбов (`mat_reveal`, `0xf2f2f0`) по периметру проёма (x∈[jambW,w−jambW], y∈[bottomH,h−headerH]), уходящих вглубь стены (−z). Дочерние к модулю → наследуют положение/поворот. Наружные заполнения над/под окном остаются `mat_wall` (кирпич/сайдинг). Ветка `mat_reveal` в `_applyHouseMaterials` страхует белый цвет.
- **Свет: убран пересвет, тени глубже.** `HemisphereLight` 0.7→0.3 (тени не размывались заливкой), солнце 2.0/1.8→1.6/1.5, exposure 1.0/0.85→0.82/0.72. Текстуры больше не разбеливаются, тени контрастнее.
- **Verified (real app):** труба = серый металл водостока; простенки белые на кирпиче (на штукатурке малозаметны — корректно); кирпич/штукатурка не пересвечены, теневая сторона тёмная.
- Cache-bust: `viewer3d-core.js?v=90`, `shared/house-builder.js?v=65`.

Сделано в итерации v=91 (материалы дома на шаге «Параметры дома»):

- **Выбор материалов дома** (крыша/фундамент/стены) квадратными образцами в левой панели шага 2 (без подписей у образцов). Данные — `HOUSE_MATERIALS` (state.js); выбор — `S.roofMat/baseMat/wallMat` (НЕ сбрасываются при входе на шаг 2 — это параметр дома). UI: `_dRenderHouseMaterials`/`dSetHouseMat` (nav-desktop), стили `.d-hm-*`. Образцы с текстурой — `background-image` из `assets/`, однотонные — цветом.
  - Крыша: черепица (`roof_*_01`) / металл зелёный (`*_02`) / металл красный (`*_03`).
  - Фундамент: бетон (однотонный серый) / камень (`base_*_01`).
  - Стены: штукатурка (однотонная св.-бежевая) / кирпич (`wall_*_01`) / сайдинг (`wall_*_02`).
- **Наложение на 3D-дом** (`viewer3d-core.js`). Дом (HouseBuilder) был плоско-цветным; теперь после сборки `_applyHouseMaterials(houseGroup)` находит меши по имени материала (`mat_roof`/`mat_wall`/`mat_base`) и накладывает текстуры выбранного варианта (`_houseTexSet`) с **мировым box-UV** (`_applyWorldBoxUV` — проекция по нормали в мировых координатах через `matrixWorld`, клон геометрии т.к. GLB-инстансы делят геометрию). Однотонные (штукатурка/бетон) — просто цвет. Тайлы: крыша 2 м, стены 1.5 м, цоколь 1 м.
- **Деревянные части — коричневые** (`HOUSE_WOOD_COLOR`): рамы/двери (`mat_frame*`/`mat_door`) красятся в `_applyHouseMaterials`; перила/колонны/балясины — через `PORCH_COLUMN_COLOR`.
- **Фикс битых имён текстур.** Ассеты переименованы в варианты (`wall_diff_01`, `roof_diff_01/02/03`, `base_diff_01`…); `getHouseMats` грузил старые имена — 404. Теперь wall/base/roof в `getHouseMats` идут через `_houseTexSet`.

**Доводка по фидбэку (v=89/v=64):**
- **Крыша — одинаковая ориентация полос на всех скатах** (`_applyRoofUV`). Мировой box-UV проецировал сверху (XZ) → полосы шли по-разному. Теперь UV per-face: V вдоль линии спуска ската, U поперёк → вертикальные полосы металла идут вниз по скату на всех скатах одинаково; ряды черепицы горизонтальны вдоль свеса. Геометрия `toNonIndexed`, нормаль грани из позиций.
- **Фикс перепутанных имён в GLB** (house-builder v=64). Цоколь (`base_segment`/`base_pillar`) в GLB назван `mat_wall`, труба (`chimney`) — `mat_base` → материал фундамента ложился на трубу, стен — на цоколь. При сборке `setMatName`: цоколь → `mat_base`, тело трубы → `mat_wall` (труба под цвет стен; колпак `mat_concrete` не трогаем).
- **Стекло** — opacity 0.5 (было 0.2/0.38). `mat_glass` в `_applyHouseMaterials` + `M.glass`.
- **Дерево темнее** — `HOUSE_WOOD_COLOR = 0x4a2f18` (был `0x6e4a2a`, читался как беж под ярким светом); + metalness 0 / roughness 0.65 / map снят.
- **Verified (real app):** металл-крыша — полосы вертикальны на фронтальном/боковом/вальмовом скатах; камень → цоколь (не труба), труба под стену; стекло ~50%; рамы коричневые.
- Cache-bust: `state.js?v=21`, `viewer3d-core.js?v=89`, `shared/house-builder.js?v=64`, `nav-desktop.js?v=38`, `styles-desktop.css?v=3`.

Сделано в итерации v=90 (переход к «Размеры дома» обнуляет проект):

- **Переход на шаг 2 («Размеры дома») полностью обнуляет проект.** Меняя габариты дома, размещённые конструкции/материалы становятся невалидными (привязаны к старой геометрии). Теперь `_dInitParamsView` (вход на шаг 2) вызывает `_dResetAllConfigurations`, который очищает ВСЁ: конструкции (terrace/steps/paths/fence/beds/pool/pier), материалы по элементам (`elementMat`), смету, накопленные образцы (`samples`), фильтры каталога (`catColors/catPrice/catSection`), активный образец, UI-состояние (`dActiveItem/dConfigured/toggle'ы`). 3D-объекты удаляются следующей пересборкой (`init3dCanvas → buildScene3d` чистит `houseGroup`). Дом остаётся. **Verified (real app):** конфигурация (3 секции, образцы, смета, 7 fence-мешей и т.д.) → переход к параметрам → всё = 0, 3D-объекты удалены, на сцене только дом. Раньше `_dResetAllConfigurations` сохранял образцы/фильтры и вызывался только при смене типа дома. Cache-bust: `nav-desktop.js?v=37`.

Сделано в итерации v=89 (фикс «съезжания» разметки при повторном редактировании):

- **Bugfix: терраса/ступени/грядки «съезжали» при повторном открытии редактора.** Дом строится размером `area` → его стены обычно НЕ кратны сетке 0.5 м (напр. area=80 → дом 10.95×7.3 м). При перетаскивании rect прилипает к стене (off-grid позиция, корректно). Но `initTerraceCanvas`/`initStepsCanvas`/`initBedsCanvas` при **открытии** принудительно переснапивали все rect'ы на сетку (`r.x = snapNorm(r.x)…`) — и rect, стоявший вплотную к стене, отрывался от неё (сдвиг до ~0.25 м + менялась высота). **Фикс:** убран переснап существующих rect'ов при открытии — они уже расставлены корректно (сетка или стена) при создании/перетаскивании. **Verified (real app):** цикл «открыл→Готово→открыл» ×3 — зазор до стены остаётся 0, высота/позиция не меняются (раньше первый переоткрыт давал зазор 2.3 см и +0.2 м к высоте). Cache-bust: `canvas.js?v=24`.

Сделано в итерации v=88 (UX/UI: без скруглений, кнопки в футер, связь с каталогом):

- **Убраны скругления у всех элементов.** `--r: 0` + глобальное `*, *::before, *::after { border-radius: 0 !important; }` (styles-desktop.css?v=2). Острые углы у кнопок, карточек, инпутов, переключателей, цветовых точек.
- **Кнопки действий редактора — в правый нижний угол.** Блок `.d-canvas-actions` («＋…», «Отменить», «✓ Готово») перенесён из `.d-canvas-header` в `.d-canvas-footer` всех 7 редакторов; `.d-canvas-footer .d-canvas-actions { margin-left:auto }` прижимает вправо (настройки/переключатели — слева, кнопки — справа внизу).
- **«Нет связи с каталогом» — флапающий апстрим.** Диагностика: `sollersdev.ru` периодически виснет на TLS-рукопожатии (~1 из 3 запросов виснет >7с; и `urllib`, и `curl`), между ними отвечает за ~3с. Из-за этого запросы разделов часто проваливались → фронт показывал заглушки-доски (это и есть «доска везде» из прошлой задачи — один корень). **Фикс:** `devserver.py` теперь ретраит апстрим (`ATTEMPTS=6`, `ATTEMPT_TIMEOUT=7с`, браузерный UA, `Connection: close`) — независимые сбои → почти всегда успех за 1-2 ретрая. Проверено: все разделы стабильно отдают 200.
- **Загрузка раздела вместо заглушек-досок.** `dShowResults`: пока раздел грузится — индикатор `_dRenderCatalogLoading` («Загрузка товаров раздела…», прямоугольная индет-полоса `.d-cat-spinner`), а не `STUB_RESULTS`. Заглушки — только если раздел реально пуст или загрузка не удалась. Привязка раздела к элементу (CONSTRUCTION_TO_SECTION) была корректной и раньше — мешал только обрыв связи.
- **Verified (real app):** скругления = 0; кнопки в футере справа-внизу; забор → «Загрузка…» → реальные товары забора («Штакетник ДПК», «Заборная доска AIWOODek»), не террасная доска.
- Cache-bust: `styles-desktop.css?v=2`, `nav-desktop.js?v=36`; `devserver.py` (ретраи).

Сделано в итерации v=87 (материал настила — независимо по элементу):

- **Bugfix: терраса/ступени/дорожки/грядки красились одновременно.** Все деко-элементы делили один `M.deck`, поэтому применение материала меняло их разом. Теперь у каждого свой материал: `S.elementMat[el] = {textures}|{color}` (state.js v20). В `buildScene3d` перед сборкой каждого деко-элемента `M.deck` подменяется на `_resolveDeckMat(_baseDeck, el)` (клон базового с текстурами/цветом элемента, либо сам базовый как дефолт); в конце `M.deck` восстанавливается. `DECK_ELEMENTS = [terrace, steps, paths, beds, pool_terrace, pier]`. Клоны освобождаются `clearGroup` при пересборке.
- **UI** (nav-desktop v35): `_applySampleToActive(sample)` — единая точка применения: для деко-элемента пишет в `S.elementMat[dActiveItem]` + пересборка; для фасада/забора/ограждения — прежняя перекраска цветом. `_activeIsDeck()` учитывает под-режим (ограждение террасы — не настил). `dApplyRealMat`/`dApplyMat`/`dApplySwatch` идут через него. Глобальное применение deck-текстур из `S.activeSample` в `buildScene3d` убрано (осталось только фасад/крыльцо по цвету). Сброс `S.elementMat` в `_dResetAllConfigurations`/`dDeleteItem`.
- **Verified (real app):** терраса (красный), проступи ступеней (синий ×4), дорожка (зелёный) — три независимых материала одновременно в сцене.
- Cache-bust: `state.js?v=20`, `viewer3d-core.js?v=87`, `nav-desktop.js?v=35`.

Сделано в итерации v=86 (фикс инвертированных нормалей дорожки):

- **Bugfix: нормали ленты дорожки были вывернуты** (`_buildPathRibbon`, viewer3d v=86). Намотка треугольников ленты давала нормали верхней грани −Y (вниз), нижней +Y (вверх). При diffuse + `DoubleSide` это незаметно (шейдер разворачивает нормаль к камере), но при наложении **normalMap** товара (или дефолтного `deck_norm`) нормали «выворачивались» — поверхность дорожки выглядела инвертированной, сквозь неё проступала трава. Фикс: после сборки `idx` разворачиваем намотку каждого треугольника (`swap idx[t+1]↔idx[t+2]`) → `computeVertexNormals` даёт наружные нормали (верх +Y, низ −Y, кромки наружу), normalMap кладётся корректно. Терраса (BoxGeometry) не затронута. **Verified (real app):** верхние нормали ленты = +1, нижние = −1; дорожка с реальной текстурой товара рендерится чисто. Cache-bust: `viewer3d-core.js?v=86`.

Сделано в итерации v=86 (смета по реальным ценам):

- **Предварительная смета** в окне «Итог» (`dShowSummary`). Кнопка «В смету» теперь реально записывает выбранный товар по элементу: `dEstimateRealMat` (реальные карточки) / `dEstimateMat` (заглушки, цена парсится из строки) → `S.estimate[elementId] = {id, name, price}`. `_computeEstimate` строит таблицу «Элемент / Объём / Материал / Кол-во / Сумма» + итог.
- **Метрики из геометрии** (`_elementMetric`, GRID=32 м): терраса = Σ площадей `terraceRects` (м²); ступени = площадь плана; дорожки = длина×ширина (м²); бассейн/причал = площадь полигона (Гаусс); забор = длина ломаной (м); грядки = количество (шт). Хелперы `_rectsAreaM2`/`_polyLenM`/`_polyAreaM2`.
- **Расчёт сумм (ориентировочный):** deck-элементы — площадь → погонаж доски `area / ширина_доски × 1.1` (ширина парсится из названия товара `_boardWidthM`, дефолт 0.14 м) × цена/м.пог; забор — `длина × 1.05` × цена/м.пог; грядки — количество × цена/шт. Единицы цен в API не размечены, поэтому смета помечена как ориентировочная (примечание в UI). Стили `.est-*` в styles-desktop.css.
- **Фикс кэша разделов:** сбой запроса раздела теперь кэшируется как `null` (повторяемо при следующем показе), а не как `[]` — раньше транзиентная ошибка (на фоне тяжёлой загрузки текстур) навсегда помечала раздел пустым. `_ensureCatalogSection` возвращает закэшированное только если это массив; `dShowResults` перезагружает при `undefined`/`null`.
- **Verified (real app):** терраса 18 м² (Универсальная доска 140 мм → 142 м.пог × 364 ₽ = 51 688 ₽) + забор 11 м (12 м.пог × 250 ₽ = 3 000 ₽) + 2 грядки (× 4 500 ₽ = 9 000 ₽) → **итого 63 688 ₽**; таблица и итог отрисованы в «Итог».
- Cache-bust: `state.js?v=19`, `nav-desktop.js?v=34`.

Сделано в итерации v=85 (реальные разделы каталога):

- **Разделы каталога подключены.** Правая панель теперь тянет товары из реального **раздела** API (`section_id`), а не из одного пресета. Каждому элементу проекта сопоставлен дефолтный раздел (`CONSTRUCTION_TO_SECTION` в state.js): терраса/дорожки/бассейн/причал→2314 (Террасная доска ДПК), ступени→2330, грядки→2357, забор→2348 (Штакетник), фасад→2683 (Фасадные панели), мебель→2442 (Садовые диваны); ограждение террасы (sub-mode railing)→2332. В панели — **селектор раздела** (`_dRenderSectionSelect`, `#d-section-row`) из курированного списка реальных секций `CATALOG_SECTIONS` (9 категорий, у которых есть товары — часть родительских секций API пуста, товары только в дочерних). `dSelectCatSection` переключает раздел.
- **Кэш per-section** (`_catalogCache[bitrix_id]`, `_ensureCatalogSection`): `[]`=пусто, `null`=ошибка, `undefined`=не грузили. `dShowResults` показывает товары активного раздела (`_activeSectionId` = `S.catSection` ∨ дефолт элемента), пока грузится/пусто/ошибка — fallback на `STUB_RESULTS`. `dApplyRealMat` ищет товар по всем кэшам.
- **Текстуры — только на deck.** Флаг `applyToDeck` на образце: текстуры товара кладутся на deck-материал только если образец выбран из «деко»-раздела (терраса/ступени/дорожки/грядки/бассейн/причал). Для забора/фасада/мебели (нет пайплайна наложения на их меши) образец просто запоминается, деке не трогается (`_applyDeckProductTextures` возвращает `applied`; гейт в `buildScene3d`). Иначе фактура мебели (у товаров мебели тоже есть `texture_urls`) ошибочно ложилась на настил.
- **Verified (real app):** забор→авто-раздел «Штакетник» (16 тов.), терраса→«Террасная доска» (текстура на настил), переключение разделов, мебель не портит деке.
- Cache-bust: `state.js?v=18`, `viewer3d-core.js?v=85`, `nav-desktop.js?v=32`.

Сделано в итерации v=84 (интеграция каталожного API sollersdev.ru):

- **Каталожный API подключён** (`ResourceManager.js`, версия `?v=1`). Это клиент к боевому REST-API `https://sollersdev.ru/api/v1` (разделы, продукты с ценами и **PBR-текстурами** diffusion/normal/roughness). Файл — плоские глобалы (`ResourceManager`, `Filter`, `FilterType`, `Presets`, `ProductResource`, `SORT_FIELDS`, `SORT_ORDER`), зависит от `THREE` (грузится после three.min.js, до nav-desktop.js).
  - **Домен API** — глобал `RESOURCE_API_DOMAIN` (в `index.html`). `''` = same-origin (через dev-прокси), `'https://sollersdev.ru'` = напрямую. **С v=111+ выбирается автоматически по `location.hostname`** (localhost → прокси, иначе → напрямую): бэкенд включил CORS, прямой доступ работает (в т.ч. на GitHub Pages). Это единственная правка в `ResourceManager.js` относительно оригинала.
  - **CORS-проблема и dev-прокси.** Боевой API НЕ отдаёт `Access-Control-Allow-Origin` (проверено) → из браузера напрямую недоступен. Решение для локальной разработки — `devserver.py`: раздаёт статику проекта и проксирует `/api/*` и `/static/*` на sollersdev.ru, переписывая в JSON абсолютные ссылки `https://sollersdev.ru` → относительные (`/static/...`), чтобы и `fetch`, и `THREE.TextureLoader` работали same-origin. Запуск: `python devserver.py [порт]`. **Для продакшна прокси не нужен** — попросить бэкенд добавить CORS на `/api/*` и `/static/*`, затем выставить `RESOURCE_API_DOMAIN='https://sollersdev.ru'`.
  - **UI** (`nav-desktop.js` v=31): `dShowResults` пытается показать реальный каталог (`_ensureRealCatalog` → ДПК-доски, `Presets.terrasnaya_doska_dpk()`, LIMIT 12), при недоступности — fallback на `STUB_RESULTS` (`_dRenderStubResults`). Карточки реальных товаров (`_dRenderRealResults`): превью = diffusion-текстура, реальные имя/цена; «Применить» → `dApplyRealMat` грузит текстуры товара и кладёт в `S.activeSample.textures`. Образцы (`S.samples`) и `dApplySwatch` понимают текстуры. Ценовой фильтр — клиентский по числовой цене.
  - **3D** (`viewer3d-core.js` v=84): в `buildScene3d` блок активного образца применяет либо текстуры (`_applyDeckProductTextures` → `M.deck.map/normalMap/roughnessMap`, `RepeatWrapping`, цвет белый, diffusion в sRGB), либо цвет (как раньше). Текстуры ложатся на deck-материал (террасы, дорожки, борта грядок), тайлинг через существующий кубический UV (`_applyBoxUV`, мир/`DECK_TILE`).
  - **Известно/TODO:** грядёт `trade_offers` (вариации товара) — структура продукта изменится (цены/текстуры/превью переедут внутрь), не завязываться жёстко. `preview_picture.url` пока null. Цены в ₽/м.пог, а тиры фильтра — ₽/м² (рассинхрон единиц). ~~Цвето-фильтр на реальные товары не влияет (нет поля цвета)~~ — с v=43 фильтрует по имени цвета в названии товара (`_detectColorNames`). Текстуры только у ДПК-досок.
  - Cache-bust: `ResourceManager.js?v=1`, `viewer3d-core.js?v=84`, `nav-desktop.js?v=31`.

Сделано в итерации v=82–v=83 (растительность отключена, секционный забор):

- **Растительность отключена** (viewer3d v=82). Вызов `_buildEntourage` в `buildScene3d` закомментирован — кусты/деревья в сцену не добавляются (`vegGroup` очищается, остаётся пустым). Файл `viewer3d-entourage.js` не тронут; вернуть — раскомментировать вызов. **Verified (real app):** `vegGroup.children.length === 0` при размеченной сцене.
- **Забор из стандартных секций** (viewer3d v=83). Раньше `buildFence3d` ставил столбы только в вершинах ломаной и растягивал одно полотно на весь пролёт. Теперь каждый пролёт делится на секции по `FENCE_SECTION_W = 2.0` м (полотно `FENCE_PANEL_H = 1.4` м, толщина `0.04`, просвет под полотном `0.05`); последняя секция — остаток (подрезанная панель). Столбы (`FENCE_POST_W = 0.10`, выше полотна на `FENCE_POST_CAP = 0.10`) ставятся на границах секций и углах, дедуплицируются на стыках сегментов (`postMap` по округлённым координатам). Размеры — константы (легко поменять под производителя; при желании — вывести в UI). **Verified (real app):** L-забор 6 м + 5 м → 6 секций (длины панелей `[1.9×5, 0.9]`), 7 столбов; полотно `0.04×1.4×1.9`.
- Cache-bust: `viewer3d-core.js?v=83`.

Сделано в итерации v=81 (новый раздел «Грядки»):

- **Раздел «Грядки» (`beds`)** — новый редактор и 3D-сборка. Грядка = rect фиксированного размера 3×1 м; на плане задаётся только место и ортогональная ориентация (поворот 90° = swap `w↔h` вокруг центра, `rotateActiveBed`), resize запрещён. Высота борта — глобальная (`S.bedH`), дискретно 150/200/270/300 мм (селектор в футере редактора, `dSetBedHeight`).
  - **Canvas-редактор** (`canvas.js` v=23): `initBedsCanvas/drawBedsCanvas/attachBedsEvents/addBed/delActiveBed/rotateActiveBed/hitBeds/applyBedDrag`. Перемещение всей грядки со снапом любой кромки к сетке + рёбрам дома/террас (`snapBedMove` поверх общих `_snapTargets`/`_nearestTarget`; w/h не меняются — в отличие от `snapDraggedRect`, который на edge-snap деформирует rect). Грядки рисуются и фоном в других редакторах (`drawPreviousLayers`).
  - **3D** (`viewer3d-core.js` v=81): `buildBeds3d` грузит GLB `mod_planter_a.glb` (`ensurePlanterLoaded`, кэш `_planterCache`, async-rebuild как у дома). Модель смоделирована в натуральном 3×1 м, родная высота борта `PLANTER_NATIVE_H = 0.1566`. На **дерево** (узел `planter_wood`) кладётся `M.deck` + мировой кубический UV `_applyBoxUV(·, DECK_TILE)` — масштаб как у террасы/дорожек (трансформ запекается в геометрию через `applyMatrix4`, чтобы UV считался в мировых координатах); **земля** (`planter_soil`) сохраняет свой материал `M.soil` (тёмно-коричневый `0x3c2a18`), её верх держится на `bedH − PLANTER_SOIL_GAP` (родной отступ от борта ~65 мм при любой высоте). Высота — масштаб по Y (`sy = bedH/PLANTER_NATIVE_H`). Ориентация по `wZ>wX` → поворот матрицы +90° по Y. Дерево добавляется и в `deckMeshes` → перекрашивается вместе с террасой/дорожками. Грядки попадают в `occupiedZones` (растительность их обходит) и в `hasLayout`.
  - **UI** (`nav-desktop.js` v=30): `beds.hasEditor=true`, `D_CANVAS_INIT.beds`, сброс/удаление в `_dResetAllConfigurations`/`dDeleteItem`, `dSetBedHeight`. Overlay `d-canvas-beds` + селектор высоты в `index.html`; стили `.bed-h-*` в `styles-desktop.css`. **Verified (real app):** обе ориентации, высота 300 мм, deck-текстура на бортах, земля у борта, дерево обходит грядки.
- Cache-bust: `state.js?v=17`, `canvas.js?v=23`, `viewer3d-core.js?v=81`, `nav-desktop.js?v=30`.

Сделано в итерации v=57–v=65 (бокс-терраса с UV, навес/перила/колонны, материалы, доводка лестницы):

- **Терраса = единый бокс с кубическим UV** (`buildTerraceBox3d`, viewer3d v=57). Раньше терраса собиралась из досок/лаг/опор/юбки — теперь один `BoxGeometry` на rect от земли до `deckHeight`. Кубическая проекция (`_applyDeckUV` поверх `_applyBoxUV`) с общим масштабом `DECK_TILE = 1.5` (≈ доска 0.14 м). Доски идут вдоль длинной стороны (`plankAlongX = W >= D`; при необходимости верхняя грань поворачивается на 90° через `_rotateBoxTopUV90`). Текстура `deck_diff.jpg` — доски горизонтальны (грувы = const V), поэтому по умолчанию планки вдоль X. Боковые грани дают дощатую «юбку». Тот же `_applyDeckUV` применён к проступям ступеней — единый масштаб. `pool_terrace`/`pier` остались на старом `buildTerrace3d` (свободные полигоны).
- **Перила выключены на стыках террасных rect'ов** (v=58). `buildRailing3d` принимает `otherRects` (мировые bbox прочих rect). `_interTerraceSkipRanges`/`_railInterTerraceSkip` сэмплирует точку наружу от кромки; если она внутри другого rect — ребро внутреннее, перила пропускаются. Контур только по внешнему периметру union (без boolean-операции).
- **Общий расчёт периметра** `terracePerimeterSegments(worldPts, houseL, houseW, otherRects)` (v=59) — вынесен в модуль вместе с `_railEdgesSkipRanges`, `_railSplitBySkipRanges`, `_railHouseEdges`, `_railStepsEdges`. Перила И колонны навеса используют одни сегменты. **Колонны навеса** ставятся по концам сегментов перил (`_terraceColumnPoints`: углы периметра + края проёма лестницы + промежуточные с шагом `CANOPY_COL_SPACING = 2.5`) — опоры всегда на углах ограждения.
- **GLB-колонны навеса** (v=60). `mod_porch_column.glb` теперь грузится всегда (`collectModuleIds` в house-builder.js v=63 — не зависит от `features.porch`). Колонны навеса строятся через `HouseBuilder.placeScaledGlb` (fallback — BoxGeometry).
- **Материал перил = цвет колонн** (v=61). Поручень и балясины террасы и ступеней — единый материал цвета `PORCH_COLUMN_COLOR = 0xc7a878` (раньше балясины серые `M.post`). Перила больше не делят `M.deck` с настилом (нет бага с `dispose` при перекраске).
- **Inset перил и колонн** (v=61). `RAIL_INSET = 0.10` + `_insetWorldRect` — периметр сжимается внутрь на 10 см, перила/колонны не свисают за кромку настила. Навес-крыша по полному bbox, колонны чуть утоплены под свесом.
- **Колонны у стены убраны** (v=62). `_terraceColumnPoints` фильтрует точки ближе 0.55 м к ребру outline дома — навес там примыкает к стене, опора не нужна.
- **Балясины обходят колонны** (v=63). `drawRailSeg` получает `colPts`; балясины пропускаются в радиусе `colClear ≈ 0.11` вокруг колонн (не протыкают), `margin` уменьшен до `colClear` (перила подходят вплотную). `colPts` считаются только если навес включён.
- **Убраны «обрубки» поручня** (v=64). Слепое удлинение `handExt` на концах торчало за тонкий GLB-ствол и в пустоту на свободных концах. Поручень рисуется ровно от конца до конца (конец = центр колонны → и так заходит в ствол). Мин. длина сегмента поднята до 0.15.
- **Лестница: inset перил** (v=65). Перила лестницы сдвинуты к центру (`STAIR_RAIL_INSET = 0.12`, `latOff = stairWidth/2 − inset`) — не конфликтуют с углом террасы.
- **Убраны ньюэл-стойки лестницы** (v=66). Вертикальные столбы на концах марша (верхний `bh`→поручень, нижний земля→поручень) удалены по требованию дизайна — остались наклонный поручень и балясины.
- **Дорожки: возврат к доскам ВДОЛЬ** (v=80). По решению пользователя вернули «первый вариант» (v=75): UV `U = длина, V = поперёк` → доски идут вдоль дорожки, волокно deck_diff смотрится естественно. Своп UV (поперёк) и ресемплинг (`_resamplePolyline`) убраны — продольным доскам ресемплинг не нужен, лента снова 1 квад на отрезок (минимум полигонов). Миттер-стыки на углах сохранены. **Verified (real app)** — доски вдоль, угол поворачивает чисто.
- **Дорожки: ресемплинг ленты + текстура поперёк принята как есть** (v=79). (1) `_resamplePolyline` дробит осевую на подотрезки ≤0.3 м перед смещением — иначе единственный квад сегмента с миттерным (скошенным) дальним концом перекашивал всю текстуру по диагонали. Теперь прямые участки = короткие прямоугольные квады (доски строго поперёк), скос локализован у самого угла. (2) Диагональная «штриховка» на поперечных досках — это **волокно фото `deck_diff.jpg`** (направленная фактура); проверено, что UV корректны (грувы перпендикулярны — рендер), и что и своп UV, и поворот самой текстуры дают одно и то же (не баг рендера, не муар — анизотропия не влияет, normalMap ни при чём). По решению пользователя оставлено как есть (направление важнее фактуры). Чистая фактура поперёк потребовала бы другой текстуры доски. **Остаётся:** небольшой скошенный участок текстуры у самих углов (миттер); при желании — отдельная доработка.
- **Дорожки: доски ПОПЕРЁК + прямоугольные концы в редакторе** (v=76). (1) В `_buildPathRibbon` поменяли местами оси UV: теперь `U = поперёк (ширина)`, `V = длина по осевой` → грувы текстуры (const V) идут поперёк дорожки, доски ложатся **поперёк** (по просьбе; v=75 делал вдоль). (2) В canvas-редакторе превью дорожки (`drawSnapCanvas` и оверлей `drawPreviousLayers`) переключено с `lineCap/lineJoin='round'` на `'butt'/'miter'` — отрезки рисуются прямоугольниками без скругления на концах, углы острые (как миттер в 3D). **Verified (real app)** — 3D: доски поперёк на обоих отрезках Г-дорожки; редактор: прямоугольные концы + острый угол.
- **Дорожки: доски вдоль направления дорожки** (v=75). В v=74 UV был мировой (`x/T, z/T`) → доски всегда вдоль мировой оси X, поэтому на отрезках, идущих не по X, лежали «поперёк». Теперь `_buildPathRibbon` считает UV **вдоль ленты**: `U = накопленная длина по осевой / DECK_TILE`, `V = поперёк (pathW) / DECK_TILE`. Грувы текстуры (= const V) идут вдоль U → доски тянутся по направлению дорожки и поворачивают на углах вместе с лентой (миттер). Проверено рендером (Г-дорожка): доски вдоль каждого отрезка. **Verified (real app).**
- **Дорожки: монолитная лента, миттер на углах, мгновенная ширина** (v=74). Раньше `buildPaths3d` собирал дорожку из **дискретных досок** (box на каждую доску вдоль каждого сегмента) — много полигонов, а на углах доски просто накладывались. Теперь дорожка строится как **монолитная лента**: `_offsetPolyline(pts, halfW)` смещает осевую полилинию влево/вправо со **стыками-миттерами на углах** (биссектриса нормалей соседних сегментов, лимит миттера ×3 на острых углах) — как навес террасы; `_buildPathRibbon` собирает один `BufferGeometry` (верх/низ/кромки/торцы) с мировым UV (`x/DECK_TILE`, `z/DECK_TILE`) — текстура досок совпадает с настилом, `DoubleSide`. Один меш на штрих (segment между `break`'ами) вместо десятков досок. Толщина плиты `PATH_H = 0.05`. Поле «Ширина дорожки» получило `oninput="dOnPathWidth()"` (новая функция в nav-desktop): сразу перерисовывает превью в canvas-редакторе (`drawSnapCanvas('paths')`) и пересобирает 3D (`onParamChange`) — раньше ширина применялась только при повторном входе в редактор. Проверено рендером реального приложения (Г-дорожка с углом 90°, узкая/широкая, штрихи с разрывом). **Verified (real app).**
- **Верх поручня лестницы входит в колонну** (v=73). После удаления ньюэлов (v=66) верхний конец наклонного поручня лестницы висел в воздухе: он стоял на кромке настила (`topPz = topZ`), а колонна террасы на углу проёма — на линии перил (внутрь на `RAIL_INSET`), плюс не было вертикальной опоры. По X они уже соосны (v=67), но по глубине оставался зазор ~`RAIL_INSET`. Теперь верхний конец поручня продлевается НАЗАД вдоль ската на `(RAIL_INSET + CANOPY_COL_HALF)·slope/run` — конец входит в ствол колонны (вверх и внутрь, колонна высокая — перекрытие незаметно). Балясины считаются по прежней линии (`topZ`→низ), чтобы не сбить их привязку к ступеням. Проверено рендером реального приложения (терраса-обхват + лестница): оба поручня лестницы стыкуются с колоннами. **Verified (real app).**
- **Прижим балясин к тонкому стволу GLB-колонны** (v=72). После v=71 балясины прижимались на `colClear = CANOPY_COL_HALF + balW/2 ≈ 0.10` — это габарит колонны (0.14). Но у GLB `mod_porch_column` 0.14 — это ширина **базы/капители**, а **ствол** на высоте перил заметно тоньше, поэтому к стволу оставался видимый зазор (на тестовом стенде с боксами-колоннами 0.14 это не проявлялось — отсюда ложное «verified» в v=71). Уменьшил `colClear` до `balW/2 + 0.035 ≈ 0.055` — балясины подходят к стволу; лёгкое перекрытие с короткой базой незаметно. **Проверено рендером реального приложения** (GLB-колонны, тот же код): балясины вплотную к каждой колонне, включая угловую. Урок: проверять на реальных GLB-ассетах, а не на упрощённых боксах. **Verified (real app).**
- **Балясины доходят вплотную до колонн** (v=71). Раньше балясины ставились равным шагом по всему сегменту и пропускались в радиусе `colClear = CANOPY_COL_HALF + balW` (~0.11) вокруг колонн — это плюс дискретный шаг оставляли заметный зазор у каждой колонны (перила «не доходили» до столба). Теперь `drawRailSeg` ставит балясины **пролётами между колоннами**: проецирует точки колонн на ось сегмента (`stops`), и в каждом пролёте `[stop_k+clear .. stop_{k+1}-clear]` раскладывает балясины равным шагом, где `clear = CANOPY_COL_HALF + balW/2 + 0.01` (~0.10) — кромка крайней балясины у самой кромки столба. Свободные концы сегмента (не у колонны) получают отступ `balW`. Поручень по-прежнему рисуется на всю длину сегмента (конец = центр колонны). Проверено рендером (перекрытие и стык) — балясины прижаты к колоннам, зазора нет. **Verified.**
- **Колонна на стыке не пробивает навес** (v=70). Высота колонн навеса считалась как `max(planeH)` по дедуплицируемым на стыке точкам. У шва соседнее крыло near-конёк имеет высокий `planeH`, но реальный навес над колонной — низкий скат другого крыла; колонна получала завышенную высоту и протыкала плиту. Теперь высота = **низ навеса над точкой** = `min(planeH)` по всем крыльям, чьи (расширенные) bbox накрывают точку (вальма — нижняя огибающая скатов). Расширенные bbox крыльев (`rects[i].ext`) запоминаются на этапе сборки плит; `canopyHeightAt(x,z)` берёт минимум. Проверено рендером (перекрытие и стык) — колонны заподлицо с навесом. **Verified.**
- **Вальмовый стык навесов и для перекрытия, и для стыка встык** (v=69). v=68 строил шов только при существенном перекрытии rect'ов; если крылья террасы **примыкают встык** (привязка кромок в редакторе), перекрытия нет — навесы строились как два полных ската и рвались на углу (ступенька/прорезь). Теперь для каждой пары **перпендикулярных** крыльев (`P.ridgeAlongX !== Q.ridgeAlongX`) строится угловая «коробка»: по оси своего ската — диапазон `P`, по оси ската соседа — диапазон `Q`; `I` = угол у дома (оба конька), `U` = внешний угол (оба свеса, там колонна). Bbox ската **расширяется** до коробки, затем режется по диагонали `I→U` (оставляем сторону центра rect). Так шов-вальма «угловая колонна → угол дома» получается одинаково и при перекрытии, и при стыке. Добавлена проверка смежности по обеим осям (чтобы не делать вальму между несоседними rect'ами). `_terraceCanopyParams` теперь отдаёт `ridgeAlongX/ridgeAtMaxX/ridgeAtMaxZ`. Проверено рендером на изолированном стенде для обоих случаев. **Verified.**
- **Стыковка навесов составной террасы + дедуп колонн** (v=68). Раньше каждый террасный rect строил свой навес (наклонный `BoxGeometry`) и колонны независимо → на стыке L/T/П дублировались опоры и навесы рвались (перекрытие двух плит, z-fighting). Теперь `buildTerraceCanopy3d` (per-rect) заменён оркестратором `buildTerraceCanopies`: навес каждого rect строится как плита по **плановому полигону**, обрезанному по **диагонали перекрытия** с соседями — `_clipFootByDiagonal` (Sutherland–Hodgman, выпукло). Диагональ идёт от угла перекрытия, где оба ската высокие (у дома, `I` = argmax `planeH_P+planeH_Q`), к противоположному «уличному» углу с колонной (`U`); оставляется сторона центра rect → шов-вальма точно по линии «угловая колонна → угол дома», плиты делят перекрытие без двойного покрытия (на шве высоты совпадают, `planeH_P=planeH_Q`). Плита — custom `BufferGeometry` (`_buildCanopySlab`: веер сверху/снизу + боковины, материал-клон с `DoubleSide`). Параметры ската вынесены в `_terraceCanopyParams` (bbox + опорная стена + `planeH(x,z)`). Колонны собираются по всем rect и дедуплицируются (радиус 0.30), высота каждой = `planeH` в её точке (低 у eave, выше у ската). **Ограничение:** обрабатываются перекрывающиеся rect (типовой L-wrap); чисто примыкающие встык (без перекрытия) и вогнутые (valley) стыки — отдельная фича.
- **Колонна навеса соосна перилам лестницы** (v=67). Проём перил террасы под лестницу сужается на `STAIR_RAIL_INSET` (вынесен в модульную константу) с каждой внутренней границы — конец перил террасы и колонна навеса на углу проёма встают на ту же линию, что и перила лестницы (которые сдвинуты внутрь на тот же inset через `latOff`). Раньше колонна стояла на боковой грани ступеней, а поручень лестницы — на 0.12 внутри (сдвиг «терялся»). Сужение в `terracePerimeterSegments` (общем для перил и колонн), граница у угла террасы не двигается.
- **Canvas-редактор: snap и захват** (canvas v=20–v=21):
  - `snapDraggedRect(kind, ds, dx, dy, excludeTerraceIdx)` — унифицированный снап (move/resize) для террасы и ступеней. К стене/террасе липнет ТОЛЬКО движущаяся кромка; противоположная остаётся на сетке (раньше move сдвигал rect целиком — дальние углы уходили с сетки; resize терял wall-snap из-за финального `snapNorm`).
  - `_snapTargets(excludeTerraceIdx)` собирает цели снапа: рёбра дома + рёбра прочих террасных rect (ступени снапаются ко всем террасным rect; редактируемый rect исключается).
  - Радиус попадания угла = `HANDLE_R / scale` (совпадает с визуальным кружком) — при зуме-аут клик больше не промахивается (срыв захвата / move вместо resize).
  - `attachTerraceEvents`/`attachStepsEvents` вешают слушатели один раз (guard `wrap._terraceBound`/`_stepsBound`), `CV[...]` читается свежим — без дублей и устаревшего `cx`.
- Cache-bust: `canvas.js?v=22`, `viewer3d-core.js?v=80`, `nav-desktop.js?v=29`, `shared/house-builder.js?v=63`.

Сделано в итерации v=55–v=56 (локальный хостинг Three.js, доводка ступеней, вырез в перилах под лестницу):

- **Локальный хостинг Three.js** (`vendor/three/`). CDN `cdnjs`/`jsdelivr` в некоторых сетях блокируется (`ERR_CONNECTION_RESET`) — приложение виснет на экране выбора дома, т.к. `three.min.js` не загружается. Все 5 файлов скачаны и хостятся локально: `three.min.js` (590 KB), `OrbitControls.js`, `RGBELoader.js`, `EXRLoader.js`, `GLTFLoader.js`. `index.html` ссылается на `vendor/three/*` вместо CDN.
- **Вырез в перилах террасы под вход на ступени.** `_wallSkipRanges` в `buildRailing3d` обобщена в `_edgesSkipRanges(ax,az,bx,bz,pad, targetEdges)` (принимает массив рёбер параметром). Дополнительно собираются `stepsEdges` — 4 ребра rect `S.steps` в мировых координатах. Оба набора skip-диапазонов (`wallSkip` с pad=0.30 + `stepsSkip` с pad=0.40) объединяются и мержатся → проём в ограждении на ширину лестницы.
- **Подступенок 0 не строится.** Подступенок 0 (вертикальная стенка между уровнем террасы и проступью 0) убран — создавал «полочку»-артефакт под кромкой террасы. Кромка террасы с собственным nosing сама закрывает зазор по высоте. Щёки лестницы переписаны: вершина top-back теперь на `Y = bh − realRise` (= верх первой проступи), а не на `Y = bh` — без «торчащих ушей» выше первой ступени и без z-fighting в районе nosing террасы.
- **Edge-snap rect'ов к рёбрам других rect'ов.** `snapToHouseWalls` в `canvas.js` теперь собирает snap-цели из двух источников: рёбер дома (как раньше) + рёбер всех `S.terraceRects` КРОМЕ `S.activeTerraceRect` (чтобы редактируемый rect не снапался сам на себя). Это даёт: (а) ступеням прилипают к боковым кромкам террасы (не только к стенам дома); (б) новые/перетаскиваемые террасные rect'ы прилипают к соседним без зазоров.
- Cache-bust: `canvas.js?v=19`, `viewer3d-core.js?v=56`.

Сделано в итерации v=40–v=54 (Этапы 1–3 рефакторинга «Терраса/Крыльцо ↔ Ступени», правки навеса террасы):

- **Этап 0 — навес террасы стал односкатным**, низом стыкуется с фронтальной кромкой крыльца, верхом — со «стенной» кромкой плиты крыльца. `buildTerraceCanopy3d` принимает `housePoly` и определяет опорную стену дома (ridge параллелен ребру дома с минимальной дистанцией до центра террасы; сторона ridge — где центр bbox ближе к стене). Геометрия — одна объёмная плита `BoxGeometry` с `M.roof` напрямую (без `clone+flatShading+DoubleSide`, чтобы материал не отличался от плиты крыльца). `canopyLow = 2.30`, `canopyHigh = 2.60`, `canopyT = 0.06` — те же значения, что у крыльца.
- **Этап 1 — снято удаление крыльца при пересечении с террасой.** Удалены `_dCheckPorchPolygonConflict`, `_rectPolygonOverlap`, `_dSilentRemove`, `_dShowToast`, `_pointInPolygon`, `_segmentsIntersect`. Подготовка к объединению крыльца и террасы в одну секцию.
- **Этап 2 — multi-rect редактор «Терраса/Крыльцо».** Старая секция `porch` удалена; `terrace` теперь хранится как `S.terraceRects = [{x,y,w,h}, ...]` + `S.activeTerraceRect`. Новые функции в `canvas.js`: `initTerraceCanvas`, `drawTerraceCanvas`, `attachTerraceEvents`, `addTerraceRect`, `delActiveTerraceRect`, `hitTerrace`, `applyTerraceDrag`. UX: клик на rect активирует его (с handles), drag тела = move, drag углов = resize. Snap 0.5 м + edge-snap к стенам дома (per-corner — снапается только тот угол, который двигается, противоположный фиксирован через `ds.x/ds.y`). Handle hitbox = `HANDLE_R` (раньше `HANDLE_R*2` — съедал клики по соседним rect'ам, ломал переключение активного). Кнопки `+ Прямоугольник` / `✕ Удалить`. В `buildScene3d` цикл по `_terraceRectsToPolygons()` для `buildTerrace3d`/`buildRailing3d`/`buildTerraceCanopy3d`. **MVP-ограничение**: boolean union не сделан — на стыках rects возможен z-fighting досок настила и «лишние» перила (планируется в Этапе 4).
- **Этап 3 — отдельная секция «Ступени» (`S.steps = {x,y,w,h}`).** Один rect drag+resize. В 3D `buildSteps3d`: глубина в плане авто-пересчитывается из `bh` (число подъёмов `n = ceil(bh/STEP_RISE)`). Опорная сторона rect определяется через `insideTerrace(mid)`/`insideHouse(mid)` (raycast) — пара противоположных сторон, у которой одна mid внутри опоры, а другая снаружи; внутренняя = верх лестницы. Знаки `dirX/dirZ` указывают наружу от опоры (направление спуска). Toggle'ы `steps-railing` и `steps-sheathing` (зашить).
  - **Геометрия лестницы (после нескольких итераций):**
    - `STEP_RISE = 0.17`, `STEP_DEPTH = 0.28`, `TREAD_THICKNESS = 0.04`, `RISER_THICKNESS = 0.025`, `STEP_NOSING = 0.035` — `STEP_NOSING > RISER_THICKNESS`, поэтому проступь нависает над подступенком, а не наоборот.
    - `realRise = bh / n` — стандартные равные подъёмы.
    - Подступенок i (всегда): Z от `i·D` до `i·D + RISER_THICKNESS`. Подступенок 0 верхом стыкуется с верхом террасы (Y=bh). Подступенки i≥1 укорочены сверху на `TREAD_THICKNESS` (верх = `bh − i·realRise − TREAD_THICKNESS`), чтобы не пересекать верх предыдущей проступи и убрать z-fighting.
    - Проступь i (только i=0..n-2; нижняя i=n-1 НЕ строится — спуск с предпоследней проступи прямо на землю, без втыкания в грунт): верх на Y=bh−(i+1)·realRise, длина по направлению спуска = `STEP_DEPTH + STEP_NOSING − RISER_THICKNESS`, по длинной оси = `stairWidth + 2·STEP_NOSING` (нависает над щёками с обеих сторон одинаково с фронтальным nosing).
    - Нижний подступенок n-1 идёт прямо до Y=0 (земля).
  - **Щёки (toggle `steps-sheathing`)** — non-convex полигон по реальному силуэту лестницы с включением nosing-кромки и низа проступи. Триангуляция через `THREE.ShapeUtils.triangulateShape` (с разворотом точек в CCW). Профиль строится в 2D (off × Y), конвертируется в 3D на боковой плоскости щеки.
  - **Перила (toggle `steps-railing`):** из того же GLB-модуля, что и ограждение террасы (`mod_railing`), под рейк (обновлено v=111). `rails` наклонены по скату через сдвиговую матрицу (ось X = вектор ската, Y = вертикаль, `scale.x` = длина ската), верх продлевается в колонну террасы. `balu_floor` — по одной на видимую проступь, вертикальные, нативное сечение, высота по уровню проступи (`scale.y`) → учитывает разницу уровней. `post`-ньюэл внизу. См. `buildSteps3d` и раздел `railing` в `HOUSE_MODULES_SPEC.md`.
  - **Опорная сторона + знаки направления** — исправлены за две итерации: алгоритм перешёл от «минимум `distToSupports`» (нестабильно при нескольких сторонах внутри террасы) к paired-check `insideTerrace∪insideHouse`. Знаки `dirX/dirZ` инвертированы — теперь указывают НАРУЖУ от опоры.
- Sidebar (`nav-desktop.js`): `D_SIDEBAR_ITEMS` — кнопка `porch` удалена, добавлена `steps`; `terrace` переименована в «Терраса/Крыльцо». `D_CANVAS_INIT` соответствующий. `_dResetAllConfigurations` + `dDeleteItem` обновлены под `terraceRects` / `steps`.
- **Известные tech-debt после Этапов 1–3:**
  - boolean union для multi-rect террасы (Этап 4) — на стыках z-fighting + «лишние» перила.
  - врезка ступеней в террасу при пересечении (Этап 4) — сейчас при overlap rect'а ступеней и террасы возможен z-fighting.
  - подсказка глубины лестницы в canvas — сейчас глубина rect ступеней в canvas игнорируется в 3D (пересчитывается), пользователь не видит реальную глубину при редактировании.
- Cache-bust: `state.js?v=16`, `canvas.js?v=18`, `viewer3d-core.js?v=54`, `nav-desktop.js?v=28`.

Сделано в итерации v=59–v=62 (новое крыльцо + терраса с навесом, синхронизация опций, обход стен ограждением):

- **Свободное крыльцо вместо привязки к двери.** Раньше `HouseBuilder.buildPorch` ставил крыльцо у двери, размеры брал из `features.porch` дескриптора, повернуть нельзя было. Теперь крыльцо строит **процедурный `buildPorch3d`** (в `viewer3d-core.js`) по нарисованному пользователем прямоугольнику `S.porch`. HouseBuilder-крыльцо отключено (`options.porchEnabled: false` в продакшене; код остался для test-house). Сценарий: пользователь рисует rect в canvas-редакторе → ставится в любом месте дома → `buildPorch3d` сам определяет ближайшую стену и ориентацию ступеней.
- **Ориентация крыльца по правилу «длинная сторона вдоль стены».** Раньше выбиралась просто ближайшая стена дома, и «глубокое-узкое» крыльцо могло встать **боком** к террасе. Теперь среди 4 кандидатов (S/N/E/W) предпочитаются те, у которых ось стены параллельна длинной стороне прямоугольника крыльца (`pw ≥ pd → стена вдоль X`; иначе — вдоль Z), и среди них — ближайшая.
- **Крыльцо: проступи, щёки, GLB-колонны, вальмовый навес.** `buildPorch3d` сильно расширен:
  - Тело крыльца — сплошная плита `M.step` (серая) от земли до `y = bh − nosThick`.
  - Верхняя плита настила — `M.deck`, толщина `nosThick`, единый кусок с свесом по сторонам и над «шагом 0»; UV-доски авто-поворачиваются на 90° при `sDX != 0` чтобы всегда идти вдоль длинной оси.
  - Ступени `i=1..nSteps-1` (i=0 на уровне крыльца не рисуется — её перекрывает плита), с проступью + nosing-выступом по передней и боковым кромкам.
  - Щёки лестницы → продлены до тыла крыльца как один общий полигон («боковина+щека» в материале `M.step`).
  - Колонны навеса берутся из `mod_porch_column.glb` через `HouseBuilder.placeScaledGlb` (экспортирован в API), с fallback на BoxGeometry.
  - Навес: 2 колонны на стороне ступеней, плита `M.roof` шириной `pw + colT + 2 × canopySideOver` с дополнительным свесом `canopyOver` в сторону ступеней, наклон через `rotation.x/z = ±tilt` так, чтобы передняя кромка над ступенями была ниже задней (у стены).
  - Перила: на двух боковых сторонах (НЕ со стороны ступеней, НЕ со стороны дома); плюс наклонный поручень вдоль ступеней + балясины по одной на каждую ступень. Балясины перил-платформы с шагом ~15 см.
  - `porchInset = 0.12 м` — колонны и перила сдвинуты внутрь от внешней кромки (не свисают, не Z-fighting с щекой).
  - `porchGroup.position.y = 0.01` — общий лифт на 1 см от фундамента (избегаем Z-fighting с pad).
- **Терраса: ограждение в новом стиле, обход стен, синхронизация с крыльцом.**
  - `buildRailing3d` теперь рисует: деревянный поручень (`M.deck`) + вертикальные балясины (`M.post`) с шагом 15 см — **идентично крыльцу**.
  - `_wallSkipRanges(ax,az,bx,bz,pad=0.30)` использует `HouseBuilder.getHouseFloorPolygon` для получения рёбер дома. Для каждого ребра террасы считается t-диапазон, где она параллельна стене дома (`|cross| < 0.1` ≈ до ~6°) И в перпендикулярном расстоянии < 0.30 м. Эти диапазоны вырезаются — ограждение больше не «вонзается» в стены.
  - Сохранён обход крыльца (`splitAroundPorch`) — оба эксклюзив применяются последовательно.
- **Навес террасы (новый, `buildTerraceCanopy3d`).**
  - **Вальмовая (hip) крыша** над bbox полигона террасы: 6 вершин (4 угла bbox + 2 точки риджа вдоль длинной оси), 4 ската (2 трапеции + 2 треугольника), нормали наружу+вверх, материал `M.roof` с `DoubleSide` (виден и сверху, и снизу).
  - Высоты согласованы с навесом крыльца: `canopyClear = 2.31`, `canopyRise = 0.36` — низ навеса = передней нижней кромке плиты крыльца (`bh + 2.31`), ридж = задней верхней кромке (`bh + 2.67`).
  - Колонны (`M.post`) на углах + промежуточные на длинных рёбрах с шагом `colSpacing = 2.5 м` (если длина ребра > 3.75 м). Колонна пропускается, если её позиция в радиусе 30 см от стены дома.
- **Удаление крыльца при пересечении с террасой.** `dConfirmCanvas` теперь вызывает `_dCheckPorchPolygonConflict`. Если `S.porch` (rect) пересекается с `terrace`/`pool_terrace`/`pier` (полигон) — крыльцо удаляется silent'ом (`_dSilentRemove`: чистка `S.pts`, `S.sections`, `S.mats`, `dConfigured`) и показывается toast-уведомление: `Крыльцо удалено, т.к. пересекается с «X»`. Геометрия: `_rectPolygonOverlap` через ray-casting + проверку рёбер. Toast — отдельный DOM-узел `#d-toast` с автоhide через 4.5 с.
- **Синхронизация toggle'ов крыльцо ↔ терраса.** `ttg` в `nav-desktop.js` теперь использует словарь пар: `porch-canopy ↔ terrace-roof`, `porch-railing ↔ terrace-railing`. При клике на любой из них класс `.on` переключается у обоих синхронно. Дефолты выровнены: все 4 toggle'а включены при первой загрузке.
- Cache-bust: `viewer3d-core.js?v=39`, `nav-desktop.js?v=25`, `shared/house-builder.js?v=62`.

Сделано в итерации v=58 (реальный полигон в canvas, координаты канвас→мир, reset при смене дома, удаление позиций):

- **Канвас-редакторы рисуют реальный полигон дома.** Раньше дом на плане террасы/забора/дорожек всегда отображался **прямоугольником** (старая функция `getHouseRectNorm`), независимо от выбранного типа — для крестообразных, T-, L-форм это вводило в заблуждение. Добавлена `HouseBuilder.getHouseFloorPolygon(desc, {area})` — возвращает реальный полигон периметра 1-го этажа в метрах (`{corners: [{x,z}], bbox: {minX,maxX,minZ,maxZ}}`). В `canvas.js` функция `getHousePolygonNorm()` использует её для отрисовки контура и edge-snap. Snap к стенам теперь работает по **всем ortho-рёбрам** полигона (не только bbox) — пользователь может прилипать к внутренним углам L/T/+/П-форм. Старая `getHouseRectNorm` оставлена как fallback пока дескриптор грузится.
- **`canvasToWorld` синхронизирован с реальным bbox дома.** Раньше функция предполагала, что дом в мире лежит от `(0,0)` до `(houseL, houseW)`, где `houseL/houseW = sqrt(area*1.6)`. Для крестообразного дома (type_04) реальный bbox в мире: `X ∈ [-ext_x, L-ext_x]` (стартует с `minX ≈ -3.13 м`), а старая формула давала смещение `~3 м` — терраса оказывалась далеко за пределами дома. Теперь в `viewer3d-core.js` модульные переменные `_houseBboxMinX/_houseBboxMinZ` устанавливаются из `HouseBuilder.getHouseFloorPolygon` при наличии дескриптора, и `canvasToWorld` добавляет их к результату. `buildPorch3d` (он считал offset inline) тоже учитывает смещение bbox; `dF/dB/dR/dL` (расстояние крыльца до стен дома) теперь считается от реальных границ bbox.
- **Reset настроек при смене типа дома.** Раньше при смене дома (карусель → выбор другой карточки) все настройки террас/забора/дорожек/материалов сохранялись — они привязаны к геометрии конкретного дома и на новом доме оказывались в неправильных местах. Новая функция `_dResetAllConfigurations()` в `nav-desktop.js` обнуляет `S.pts`, `S.porch`, `S.sections`, `S.mats`, `S.activeSample`, `S.matSubMode`, `S.curSec`, `dConfigured`, `dActiveItem`, `dEditorOpen`. Вызывается из `dSelectHouseAndGo` **только когда тип меняется** (`S.houseType !== newType`) — повторный выбор того же типа сохраняет настройки. `S.samples` (накопленные образцы материалов) не сбрасываются — они не привязаны к дому.
- **Кнопка удаления настроек позиции.** В sidebar для каждого сконфигурированного элемента рядом с ✏ появляется красноватый **`×`**. Клик → confirm-диалог `Удалить настройки «X»?` → `dDeleteItem(secId)` чистит `S.pts[secId]` (или `S.porch` для крыльца), удаляет из `S.sections`, `S.mats`, `dConfigured`; если позиция была активна — сбрасывает `dActiveItem`. CSS `.d-sb-delete` использует `#fde7e7` / `#c53030` для hover — визуальное предупреждение о деструктивном действии.
- Cache-bust: `viewer3d-core.js?v=18`, `nav-desktop.js?v=22`.

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
   - ~~Dormer/velux на скате крыши~~ ✅ (`buildRoofWindows` в `shared/house-builder.js`, velux через GLB в плоскости ската + custom flat glass; dormer процедурный с правосторонним базисом и автоматическим утоплением). У обоих стекло некалёное + **полигон-штора** (`mat_curtain`, белый + карта нормалей) за стеклом. На коротком скате dormer **масштабируется целиком** (w,h,d и окно — одним `scale = min(1, dMaxFit/depth)`, `dMaxFit` по горизонтальному пробегу ската): scale≤1 → не торчит за карниз (fit), а сохранённое соотношение `d/h` держит врезку задней части под крышу (`d·tan(угол) ≥ h`). На большом доме scale=1 (как в дескрипторе).
   - ~~Mansard-крыша~~ ✅ (`buildBrokenMansardRoof` в `shared/house-builder.js` — классическая ломаная крыша Мансар с двумя углами наклона, knee wall опционально).
   - ~~Карусель типов домов в UI шага 1~~ ✅ (сетка 5 карточек × скролл из всех 10 типов через `assets/houses/index.json`, 3D-превью через shared `WebGLRenderer` + JPEG dataURL, one-click переход на step 2).
   - ~~Per-floor sliders area/floor_h~~ ✅ (динамический UI step 2 на основе `desc.floors`, глобальный + per-floor контролы, `params.floorAreas[]` / `floorHs[]` в `HouseBuilder.buildHouseFromDescriptor`). Двусторонняя синхронизация площади: глобальная «Общая площадь дома» → этажи (× `area_factor`, `dOnAreaTotal`) И правка площади 1-го этажа → глобальная (`_dSyncGlobalAreaFromFloors`: `area = floorArea0 / area_factor[0]`), т.к. контур дома (`getHouseFloorPolygon`) считается от глобальной `area`.
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
