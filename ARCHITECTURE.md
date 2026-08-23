# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус
- **Фронтенд** разбит на файлы, PBR-визуализация работает; десктоп-UI создан и отлажен (sidebar-кнопки, snap-сетка 0.5 м, multi-line, collision avoidance). UI без скруглений; кнопки действий редакторов — в правом нижнем углу.
- **Конструкции:** терраса/крыльцо (multi-rect; высота настила настраивается 10 см…фундамент), **ограждение террасы** — ОТДЕЛЬНЫЙ элемент проекта: рисуется ломаной (точки прилипают к кромкам настила и стенам дома с отступом в полсечения столба), строится из GLB-модуля `mod_railing`, там же включается навес; ступени, дорожки (монолитная лента), **забор** (условный вид до появления модели у товара; шаг секции 2 м, высота полотна 1.5/1.9 м — `S.fenceH`), **грядки** (GLB-плантер 3×1; до выбора товара — габаритный прямоугольник, после — высота борта из товара). Растительность сейчас **отключена** (легко вернуть — см. ниже).
- **Материалы:** каждый деко-элемент (терраса/ступени/дорожки/грядки/забор/**ограждение**/бассейн/причал) красится **независимо** (`S.elementMat` — список в `DECK_MAT_ELEMENTS`); применённый товар он же выбор для сметы. Терраса у бассейна и причал берут ТОТ ЖЕ набор карточек, что терраса (раздел 2314 + палитра `terrace`), но доска у каждого своя и строка сметы отдельная. PBR-текстуры товара ложатся на deck-материал с кубическим UV (ребро 1 м, `UV_TILE` — единое для всей сцены); исключение — ограждение, у него UV приходят из GLB-модуля.
- **Садовая мебель:** точки размещения на плане (поставить/подвинуть/повернуть на 90°/удалить, нумерованные); товар из каталога назначается точке (выбранной или первой свободной по номерам, дальше выбор сам переходит на следующую свободную) и спавнится в 3D — на настиле террасы, если точка на ней, иначе на земле. Модель берётся из каталога (`glb_file_url`, тег `furniture`); локальный фолбэк — для товаров без модели. Загрузка моделей (4–12 МБ) показывается индикатором прогресса над сценой. См. «Садовая мебель» ниже.
- **Отделка фасада:** выбор элементов стен (сегменты между проёмами + «оконные колонки» — стена над/под проёмом) на ПЛАНЕ 1-го этажа в редакторе; углы отделываются автоматически «под ближайшую вставку»; пустой выбор = весь фасад. В 3D виден результат (`S.wallZones` + `S.elementMat.facade`).
- **Материалы дома:** на шаге «Параметры дома» — выбор квадратными образцами (крыша: черепица/металл зелёный/металл красный; фундамент: бежевый/коричневый/тёмно-серый — только цвет; стены: белый/бежевый/коричневый — только цвет; **рамы окон и двери: дерево/белый/тёмно-коричневый**). Накладываются по имени материала меша (`_applyHouseMaterials`): крыша — per-slope UV (полосы вниз по скату), цоколь/труба исправлены (труба = металл водостоков), откосы окон белые, рамы/двери (`mat_frame*`/`mat_door`) — цвет из `S.frameMat`, стекло 50%, шторы (`mat_curtain`) — белые с картой нормалей `assets/curtain_norm.jpg`. Текстуры — варианты `roof/wall/base_*_0N` в `assets/`. Группы материалов задаются в `HOUSE_MATERIALS` (state.js) по соглашению «ключ группы ↔ `S['<kind>Mat']`», UI строится по ним автоматически.
- **Каталог:** подключён боевой REST-API `sollersdev.ru` через клиент `ResourceManager.js`. Реальные разделы/товары/цены/текстуры; материал привязан к разделу каталога по элементу (`CONSTRUCTION_TO_SECTION`). **Превью и 3D-текстуры (`texture_urls`, картинки `/static/DPK/...`) бэкенд отдаёт только у товаров, помеченных тегом** — поэтому запрос товаров идёт с тег-фильтром по разделу (`SECTION_TAGS` в `state.js`; ревизия 2026-07-29/31: 2314/2315→`dpk`, 2329→`mpk`, 2680/2681→`walls`, 2348→`fences`, 2331→`fencing` — старые `dpk_steps` и walls-на-2683 бэкенд больше не отдаёт); без тега раздел вернул бы товары без текстур. Разделы без товаров на бэкенде (ступени 2330, грядки 2357, фасады/ступени МПК 2345/2668) показывают заглушки `STUB_RESULTS` — у них вместо превью плоский цвет, это признак «раздела нет на бэкенде», а не сбоя фронта. **Миниатюра карточки** (`_productThumbStyle`): DPK-текстура товара → `preview_picture` → `detail_picture` → серый квадрат; текстура рисуется `cover`, фото товара — `contain` на белом. До v=129 бралась только DPK-текстура, поэтому мебель (у неё их нет) шла с серыми квадратами. Локально работает через dev-прокси `devserver.py` (обход отсутствия CORS + ретраи к нестабильному апстриму). **Фильтр по цвету**: приоритетно по полю `color` товара (появилось в API 2026-07-29, имена совпадают с COLORS.md), затем детекция в названии как отдельного слова, длинные имена в приоритете («тёмно-серый» ≠ «Серый»). **Смета** считается по геометрии × цена из каталога.
- **Модульная система GLB** для домов (см. `HOUSE_MODULES_SPEC.md`): 30 GLB-модулей; JS-загрузчик/сборщик `shared/house-builder.js` написан (`loadHouseType`, `buildHouseFromDescriptor`); процедурный `buildHouseMeshes` остаётся fallback.
- **Расчёт террасы на бэкенде:** `POST /api/v1/calculate_terrace/` — полная спецификация (доска, лаги, кляймеры, уголки, саморезы, подложки, полуступени) + работы, по контуру террасы, высоте настила и выбранной доске. Показывается в «Итоге» отдельным блоком под ориентировочной сметой. См. «Расчёт террасы» ниже.
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
                          # terraceH, pts.railing, toggles, pathWidth), SECS, PRICE_TIERS, STUB_RESULTS,
                          # CATALOG_SECTIONS, CONSTRUCTION_TO_SECTION, SECTION_TAGS,
                          # CATALOG_COLOR_HEX (имя→hex) + ELEMENT_COLOR_NAMES (набор цветов на тип, по COLORS.md),
                          # HOUSE_TYPE_MAP (легаси-имя → typeId), DEFAULT_STEPS_RECT,
                          # хелперы isEmptyLot() и tgOn(id)
  ResourceManager.js      # клиент каталожного API sollersdev.ru (ResourceManager, Filter,
                          # FilterType, Presets, ProductResource). Домен — глобал RESOURCE_API_DOMAIN.
  backend_API/            # выгрузка бэкендера, правится на их стороне:
                          #   Calculator.js       — обёртка над расчётными ручками, подключена как есть;
                          #   calculation_api.md  — контракт шести расчётов + PDF-смета;
                          #   calculator.md       — как пользоваться обёрткой;
                          #   readme.txt          — справочник каталожного API. Замечание 6
                          #                         («структура продукта изменится, добавится
                          #                         trade_offers») УСТАРЕЛО: каждое торговое
                          #                         предложение — самостоятельный товар со своей
                          #                         ценой, превью и текстурами, структура не
                          #                         меняется (со слов бэкендера, 2026-08-18);
                          #   ResourceManager.js  — ИХ копия каталожного менеджера, НЕ подключается
                          #                         (рабочий файл — ResourceManager.js в корне; их
                          #                         версия отстаёт, полезное переносится вручную).
  canvas.js               # pan/zoom движок, snap-canvas (дорожки/забор/ограждение),
                          # прямоугольный редактор (терраса, бассейн, причал — initRectCanvas),
                          # ступени (_stepsNormalize),
                          # грядки, точки мебели, план фасада. Канвас на всё окно (fitCanvasToWrap).
                          # Прилипание: стены дома и кромки блоков (EDGE_SNAP_DIST), у ограждения —
                          # кромки настила и стены с отступом RAIL_INSET
  viewer3d-core.js        # ядро 3D: сцена, HDRI, PBR-материалы, UV, buildScene3d-оркестратор.
                          # Дом строится через HouseBuilder.buildHouseFromDescriptor (см. shared/house-builder.js);
                          # ensureHouseLoaded() — async-кэш дескриптора и GLB-модулей.
                          # _housePoly — кэш полигона этажа на сборку (билдеры не пересчитывают).
  viewer3d-builders.js    # строители конструкций (выделен из core): дом-fallback
                          # (buildHouseMeshes), настилы/подкладки, грядки, кэш GLB
                          # ограждения, ступени, крыльцо, дорожки, забор
  viewer3d-railing.js     # ограждение: по нарисованной ломаной (buildRailingLine3d) и по
                          # периметру террасы (skip-диапазоны), union-контур блоков,
                          # buildRailing3d (GLB mod_railing, материал через matOverride),
                          # RAIL_INSET (полсечения столба), навесы террасы
  viewer3d-entourage.js   # антураж (общий для обеих платформ): GLB-модели → PNG cross-billboard → процедурный fallback;
                          # автоматически определяет IS_MOBILE (UA + ширина окна) для подбора параметров
  shared/house-builder.js # ⭐ Общий модуль модульной сборки дома по JSON-дескриптору.
                          # IIFE namespace HouseBuilder: { setLogger, loadHouseType,
                          # buildHouseFromDescriptor, applyMaterialOverride, drawOutlineOverlay,
                          # decomposeOrthoPolygonIntoRectangles, getHouseFloorPolygon,
                          # getHouseFacadeLayout }. См. «Конвенции модульной сборки» ниже.

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
        fences/   mod_fence_001.glb, mod_fence_002.glb, mod_fence_003.glb  # секции забора
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
                          # POST тоже проксируется (do_POST) — нужен расчётным ручкам
                          # каталога, напр. /api/v1/calculate_terrace/.
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

`shared/house-builder.js` подключается **до** кода, который его использует.
Логгер сборщика по умолчанию пишет в консоль; переопределяется через
`HouseBuilder.setLogger(fn)`.

Все скрипты подключаются с query-string `?v=N` для сброса кэша браузера; при правке файла
версию поднимать обязательно. Актуальный срез (совпадает с `index.html`):

```
styles-desktop.css?v=13   state.js?v=41              canvas.js?v=38
shared/house-builder.js?v=82                          ResourceManager.js?v=5
viewer3d-core.js?v=126    viewer3d-builders.js?v=10   viewer3d-railing.js?v=5
viewer3d-entourage.js?v=14                            nav-desktop.js?v=68
```

`viewer3d-entourage.js` автоматически детектит `IS_MOBILE` (UA + `innerWidth<768`)
для подбора параметров растительности.

---

## Объект состояния S (фронтенд)

```javascript
const S = {
  houseType: 'Одноэтажный дом',  // string | null
  sections: ['terrace', 'steps'], // выбранные конструкции (sidebar — кнопки с ✓)
  pts: {
    paths:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
    fence:        [{x,y}, ...],   // ломаная; {break:true} — разделитель линий
    railing:      [{x,y}, ...],   // ограждение террасы — ломаная ВНУТРИ террасы
  },
  // Три секции с ОДНИМ прямоугольным редактором (реестр RECT_SECTIONS в state.js;
  // доступ — secRects/secActiveIdx/setSecActiveIdx). Отличие только в примыкании
  // к дому: терраса пристраивается (снап к стенам, vertexType 'house'), терраса у
  // бассейна и причал — ОТДЕЛЬНО СТОЯЩИЕ (снап к сетке и своим блокам, все 'free').
  terraceRects:      [{ x, y, w, h }, ...], // нормализованные 0..1, кратные SNAP/GRID
  activeTerraceRect: 0,            // индекс выбранного rect или null
  poolRects:         [{ x, y, w, h }, ...], // терраса у бассейна
  activePoolRect:    null,
  pierRects:         [{ x, y, w, h }, ...], // причал
  activePierRect:    null,
  // Ступени — один прямоугольник. Пользователь задаёт только ШИРИНУ: глубина и
  // разворот вычисляются (_stepsNormalize) из высоты фундамента и ближайшей стороны террасы.
  steps:        { x, y, w, h },
  // Грядки — массив rect'ов фиксированного размера 3×1 м (resize запрещён, только
  // перемещение + поворот 90°). Ориентация ортогональная: длинная сторона вдоль X (w>h)
  // или вдоль Y (w<h). Высота борта — глобальная (S.bedH), приходит из товара.
  beds:         [{ x, y, w, h }, ...], // нормализованные 0..1
  activeBed:    0,                     // индекс выбранной грядки или null
  bedH:         0.20,                  // высота борта (м); в редакторе НЕ задаётся —
                                       // берётся из выбранного товара (_bedHeightFromProduct)
  mats:         {},                // выбранные материалы по секции
  // elementMat[el] — применённый товар элемента: { textures|color, productId, name,
  // colorName, modelUrl }. Он же выбор для сметы (отдельной кнопки «В смету» нет).
  elementMat:   {},
  estimate:     {},                // el → { id, name, price } — пишется вместе с материалом
  terraceH:     null,              // высота настила террасы, м (null = вровень с фундаментом)
  curSec:       0,
  catColors:    Set,               // выбранные ЦВЕТА каталога (имена из COLORS.md) — фильтр работает
  catPrice:     null,
  catShowResults: false,
  furniture:    [{ x, y, rot, product }], // точки садовой мебели (номер = индекс+1), product | null
                                   // rot — поворот, рад, кратно π/2 (0 = «перёд» модели вдоль +X)
  activeFurniture: null,           // индекс выбранной точки
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
- `buildTerrace3d()` **[builders]** — настил из досок + лаги + опоры по произвольному полигону + юбка (skirt panels, deck-материал, толщина 0.06). Высота настила = `foundH - 0.01` (на 1 см ниже цоколя, чтобы избежать z-fighting). Полигональных секций в UI больше нет (бассейн и причал переведены на прямоугольники), функция остаётся как построитель по контуру.
- `_buildRectDecks(polys, deckH, hEdges)` **[core, локальная в buildScene3d]** — настил ПРЯМОУГОЛЬНЫХ секций: терраса/крыльцо (`hEdges` = рёбра дома), терраса у бассейна и причал (`hEdges = null` → доски вдоль длинной стороны блока, причал на отметке 0.5 м). Внутри — подкладки, миттер углов и `_buildTerracePoly` на каждое крыло.
- `_buildTerracePoly()` **[builders]** — настил **составной террасы** (multi-rect секции): призма по плановому полигону (верх-настил + «юбка» + низ), нормали верха `+Y`, нормализация обхода контура. **Миттер на углах:** в `buildScene3d` каждое крыло подрезается до угловой ячейки, а ячейка заполняется двумя треугольниками — доски двух перпендикулярных крыльев сходятся по диагонали 45°. Работает для перекрытия, встык и обёртки вокруг выпуклого угла дома (L/П/O); T/+-врезки пропускаются. **Направление досок — вдоль ближайшей стены дома** (`plankDir`: переднее/заднее крыло → вдоль X, боковое → вдоль Z; fallback без дома — длинная сторона), поэтому картинка стабильна и не зависит от разбивки на блоки.
- `buildPorch3d()` **[builders]** — площадка + ступени с автоопределением направления + боковые панели (deck-материал, толщина 0.06).
- `buildPaths3d()` / `_buildPathRibbon()`, `buildFence3d()` **[builders]** — поддерживают multi-line через `splitAtBreaks()`. Дорожка — монолитная лента с миттером кромок на углах (`_offsetPolyline`); доски-перекладины идут **строго ⟂ локальной осевой каждого сегмента**. Каждый сегмент строится своими вершинами, UV-координата `V` = проекция точки на ось ИМЕННО этого сегмента (по центру совпадает с накопленной длиной → планки выровнены на стыке, к кромкам угла — чистый миттер-шов без «ёлочки»/скоса). **Пересечения линий (T-стыки/ответвления):** `_trimPathJunctions` укорачивает КОНЕЦ линии, упирающийся во ВНУТРЕННОСТЬ ребра другой линии, до ближнего края той дорожки (на полуширину для перпендикуляра) — лента примыкает, а не перекрывает. Свободные концы и стыки «конец-в-конец» не трогаются; чистое пересечение серединами (X) не обрабатывается (для сети-дерева не встречается).
- `buildRailingLine3d()` / `buildRailing3d()` **[railing]** (навесы — там же: `buildTerraceCanopies`, `_terraceCanopyParams`, `_buildCanopySlab`; кэш GLB `ensureRailingLoaded` — [builders]) — ограждение из GLB-модуля `mod_railing.glb` (`post`/`rails`/`balu_short`/`balu_floor`). В текущем флоу вызывается `buildRailingLine3d` — по **нарисованной ломаной** (`S.pts.railing`); сегменты передаются в `buildRailing3d` через `segsOverride`, материал — через `matOverride` (см. «Ограждения террасы»). Без `segsOverride` работает прежний путь: **единый контур объединения** блоков террасы (`_terraceUnionLoops` + `_insetOrthoPolygon` на `RAIL_INSET`) — без разрывов на стыках, с пропусками у стен и лестницы. Секции фикс. ширины ~1 м (одинаковы везде) + узкий «добор»; `rails` тянутся масштабом, балясины — нативного сечения (число по шагу 0.1 м, узор «2/5/8 от настила» = `balu_floor`). При навесе высокие столбы-опоры (бокс до низа навеса, высота из `canopyPlaneH`) на углах и каждые ~2 м; дедуп столбов на стыках (`_railPostReg`/`placePostAt`). Загрузка/кэш GLB — `ensureRailingLoaded()`.
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
| `wall` — стены | MeshStandardMaterial | только цвет (белый/бежевый/коричневый) | кубическая, 1 м/тайл | |
| `base` — цоколь | MeshStandardMaterial | base_diff/norm | кубическая, 1 м/тайл | |
| `roof` — крыша | MeshStandardMaterial | roof_diff/norm/roug | по скату, 1 м/тайл | |
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

### Садовая мебель — точки размещения и GLB-модели из каталога

**Поток данных.** Пользователь ставит на плане точки (`S.furniture = [{x, y, rot, product}]`,
номер точки = индекс+1), затем назначает им товары из каталога. Одна точка — один
предмет мебели.

| Слой | Что делает | Где |
|------|-----------|-----|
| План-редактор | постановка/выбор/перетаскивание/поворот/удаление точек, снап 0.5 м | `initFurnitureCanvas` / `drawFurnitureCanvas` / `rotateActiveFurniture`, canvas.js |
| Назначение товара | «Применить» → выбранная точка, иначе первая свободная ПО ПОРЯДКУ НОМЕРОВ; после назначения выбор переходит на следующую свободную | `_assignFurnitureProduct`, nav-desktop.js |
| Источник модели | поле товара → локальный фолбэк | `furnitureModelUrl`, viewer3d-builders.js |
| Загрузка/кэш | GLTFLoader, кэш по URL, прогресс в индикатор, пересборка сцены по готовности | `ensureFurnitureModel`, viewer3d-builders.js |
| Индикатор загрузки | плашка с прогрессом над 3D/редактором | `d3dLoadingSet` / `d3dLoadingClear`, nav-desktop.js + `#d-3d-loading` |
| Расстановка | центр по точке, основание на отметку поверхности, поворот вокруг точки | `buildFurniture3d` + `surfaceYAt` в `buildScene3d` |
| Смета | поштучно (точки с товаром) | `_elementMetric('furniture')` |

**Отметка поверхности** (`surfaceYAt(x, z)` в buildScene3d): точка внутри блока террасы
или террасы у бассейна → настил (`bh − 0.01`); внутри блока причала → 0.5 м; иначе земля (0).
Все три секции прямоугольные, поэтому проверка — попадание в bbox блока.
Мебель на террасе не проваливается под настил.

**Поворот точки** (`pt.rot`, радианы, кратно π/2). «Перёд» предмета — **локальная ось +X
модели**; при `rot = 0` он смотрит вдоль мирового +X, т.е. вправо на плане (`canvasToWorld`:
x плана → X мира, y плана → Z мира). Поворот идёт вокруг оси Y, поэтому на плане стрелка
вращается против часовой стрелки, а экранное направление стрелки = `(cos rot, −sin rot)`.
Новая точка наследует поворот у выбранной — расстановка «в ряд» без лишних кликов.
В 3D клон модели кладётся в **группу-пивот** в точке плана: вращать сам клон нельзя —
его origin не совпадает с центром bbox, и предмет уезжал бы с точки по дуге.
Точка без модели (товар не выбран, модель грузится или не загрузилась) показана
маркером-подставкой со стрелкой «переда» — место в сцене видно всегда.

**Индикатор загрузки моделей.** Файлы каталога — 4–12 МБ, 3–10 с на модель. `ensureFurnitureModel`
шлёт прогресс GLTFLoader в `d3dLoadingSet(url, название, %)`; плашка `#d-3d-loading` лежит
в `.d-center-view` поверх и 3D, и открытого canvas-редактора. Ключ — URL модели, поэтому
две точки с одним товаром дают одну запись; при нескольких моделях показывается их число и
средний процент. Если сервер не отдал `Content-Length`, процент неизвестен → бегущая полоса.
API общего назначения: годится для любой долгой 3D-загрузки, не только мебели.

**Контракт с бэкендом (работает с 2026-08-02).** Мебель отдаётся по **тегу `furniture`**
(`GET /api/v1/products/?tags=furniture` — 20 позиций), URL модели в поле **`glb_file_url`**.
Клиент: `ProductResource.glbFileUrl` (+ `modelUrl` как алиас, туда же падают запасные
`model_url` / `texture_urls.model_glb`, см. ResourceManager.js). Локальный фолбэк
(`mod_bench_a.glb` / `mod_lamp_a.glb`) остаётся на случай товара без модели.

**Выборка ТОЛЬКО по тегу.** Товары мебели разбросаны по 8 разделам (2430 «Садовая мебель» —
лишь 9 из 20), поэтому набор запрашивается без `section_id`: `SECTION_TAG_ONLY = {2430}`
в state.js, обработка — в `_ensureCatalogSection`. Ключ 2430 служит идентификатором набора
для UI-селектора и кэша.

**Фильтры цвета и цены для мебели скрыты** (`_dRenderColorGrid` / `_dRenderPriceGrid`):
у товаров мебели поле `color` пустое, а ценовые тиры заданы в ₽/м.пог для доски, тогда как
мебель стоит 5–308 тыс. ₽ за изделие. Иначе любой выбранный чип обнулял бы выдачу.

**Требования к GLB мебели** (те же, что для растительности, плюс уточнения):
- glTF Binary (.glb), 1 unit = 1 метр, Y-up, текстуры embedded, без Draco;
- **origin не критичен**: посадка идёт по нижней грани bbox (`bbox.min.y` → отметка
  поверхности), центрирование в плане — по центру bbox. НО любая лишняя геометрия ниже
  видимого основания (скрытая плоскость, «земля» из сцены экспорта) поднимет предмет
  над поверхностью — экспортировать только сам объект;
- модель отдаётся в НАТУРАЛЬНУЮ величину — код её НЕ масштабирует (в отличие от
  растительности): проверено, высота стола в сцене совпала с паспортной (0.45 м);
- полигонаж: желательно до ~20 тыс. треугольников. Фактически у первых моделей
  18–48 тыс. (стол DeckWOOD Dual — 47.8 тыс.) — для единичных предметов приемлемо,
  но при десятке точек на сцене стоит проредить.

**Открытые вопросы по данным** (не блокируют):
- `color` у мебели пустой — когда заполнят, снять скрытие цвето-фильтра;
- цены обещаны к автообновлению (со слов бэкендера, 2026-08-03) — сейчас 5 090…308 330 ₽;
- моделей 20 на 20 товаров, ссылки уникальные, отдаются с `Access-Control-Allow-Origin: *`
  (проверено), поэтому прокси для них не нужен.

### Превью и фото товаров — чего не хватает на бэкенде

Разбор багов 3–5 из TODO (нет тамбнэйлов и превью у мебели, грядок, отделки
фасада, частично у ограждений и дорожек, то же у заборов). Обходных путей на
фронте нет — не хватает данных в API:

- **Фото товара.** `preview_picture` и `detail_picture` приходят объектами с
  `url: null` — это прямо записано в их же `backend_API/readme.txt`, «Замечания
  по продуктам», п. 1. Пока URL не появятся, показывать нечего: миниатюра
  падает на текстуру, а без неё — на серый фон.
- **Текстуры (`texture_urls`).** Отдаются только у товаров, помеченных тегом
  раздела (`SECTION_TAGS` в state.js). Разделы без тега — ступени 2330 и
  грядки 2357 — приходят без текстур, поэтому превью пустое. У фасада (2680),
  забора (2348) и ограждений (2331) тег есть, но заполнены не все товары —
  отсюда «частично».

Проверить со стороны фронта нечего: и то и другое — наполнение каталога.

### Расчёты на бэкенде — `Calculator` (backend_API/Calculator.js)

Ручек расчёта семь: шесть по типам объектов и одна совокупная (контракт —
`backend_API/calculation_api.md`, версия 2026-08-22):

```
POST /api/v1/calculate_terrace/   calculate_steps/   calculate_fence/
     calculate_railing/           calculate_path/    calculate_furniture/
     calculate_project/
```

Сеть держит обёртка бэкендера `Calculator`: адрес, метод, разбор ответа и ошибок.
Своего fetch у нас нет — формат запроса живёт в их библиотеке и контракте.
Экземпляр создаёт `_dCalculator()` (nav-desktop.js) с базой `RESOURCE_API_DOMAIN + '/api/v1/'`,
то есть локально запросы идут через dev-прокси, а на статике — прямо на sollersdev.ru.

**Считается проект целиком** — `calculate_project/` с `mergeMaterials: false`,
то есть со сметой по каждому объекту (`buildProjectCalcRequest` → `_ensureProjectCalc`
→ `_dRenderProjectCalc`). Объекты собирает `_projectObjects`:

| Элемент | Тело объекта | Откуда геометрия |
|---|---|---|
| Терраса, терраса у бассейна, причал | `{vertices, doorDirection, deckingBoardProductId, terraceHeight}` | `buildTerraceCalcRequest(secId)` (union-контур блоков секции). У отдельно стоящих все вершины `free`, дом в расчёте не участвует; высота причала — 500 мм |
| Ступени | `{vertices, height, stepProductId}` | прямоугольник `S.steps`; вершины на кромке террасы помечаются `terrace` |
| Дорожки | `{vertices, deckingBoardProductId}` | `_pathProjectObjects`: осевая + ширина → кромки тем же `_offsetPolyline`, что и 3D-лента; контур `right[0], left[0] … leftN-1, rightN-1 … right[1]`, опорная («стартовая») сторона — первые две вершины. Каждая линия разметки (разрывы) — отдельный объект; примыкания линий подрезаны как в 3D (`_trimPathJunctions`) |
| Ограждение, забор | `{lines, …ProductId}` | ломаные `S.pts[el]`, разрывы делят на линии |
| Мебель | `{items}` | точки `S.furniture` с назначенным товаром |

**Что в проект не попадает.** Ступени без примыкания к террасе пропускаются: такой расчёт заведомо падает
(«ступеням неоткуда начинаться»), **а ошибка одного объекта роняет весь проект** —
это поведение контракта, поэтому в запрос кладём только заведомо считаемое.
Клиентский `_computeEstimate` остаётся верхней таблицей «Итога».

**Ошибки** приходят как `CalculationError` с полем `kind` (`geometry`, `materials`,
`server`, `network`, `validation`, `timeout`). Ветвиться нужно по `kind`, а не по
тексту: `message` предназначен для показа. Маппинг в сообщения — `_calcErrorText`;
ошибки геометрии показываются пользователю как есть (это про его контур), ошибки
каталога прячутся за «расчёт временно недоступен».

**Верхняя таблица не временная**: она показывает стоимость «голой» доски по площади
(и объёмы по элементам) — это отдельная нужная продукту цифра. Когда появятся остальные
ручки, в ней меняются суммы, а геометрия остаётся.

**Запрос** (`buildTerraceCalcRequest` в nav-desktop.js):

| Поле | Что кладём |
|------|-----------|
| `vertices` | внешний union-контур блоков террасы (`_terracePlanLoop` → `_terraceUnionLoops`), в **миллиметрах**, начало координат — угол bbox контура; у каждой вершины `vertexType`: `house`, если она лежит на ребре дома (`getHousePolygonNorm().edges`, допуск 0.15 м), иначе `free` |
| `doorDirection` | сторона света главной двери (`_mainDoorDirection`) |
| `deckingBoardProductId` | id доски: `S.estimate.terrace.id`, затем `S.elementMat.terrace.productId` — оба пишутся одним «Применить». Необязателен: без него расчёт идёт на товаре по умолчанию, поэтому выбор доски расчёт больше не блокирует |
| `terraceHeight` | высота настила над землёй в мм = высота фундамента (без дома — 350) |

Контур строится тем же `_terraceUnionLoops`, что и ограждение, — функция
координатно-нейтральна, ей передаются rect'ы в **метрах плана** (нормированные ×
`GRID`), а не в мировых. Поэтому расчёт не зависит от состояния 3D-сцены.

**Ответ**: `materials` — объект (ключ = роль позиции: `deckingBoard`, `joist`,
`deckingClip`, `screw`…), у каждой `name`/`ruTag`/`dimension`/`pricePerDimension`/
`totalDimensionCount`/`totalCost`; `works` — массив `{name, cost}`. Рендер —
`_dRenderTerraceCalc`, итог — `terraceCalcTotal` (материалы + работы). Расчёт
кэшируется по телу запроса: повторное открытие «Итога» без изменений не дёргает сеть.

**⚠ Открытый вопрос — знак `doorDirection`.** Направление считается по плану
(x вправо, y вниз) с картографическим «север вверх» (`TERRACE_CALC_NORTH`), а сам
код трактует значение как СТОРОНУ, где стоит дом с главной дверью, если смотреть с
террасы. Пример бэкендера (дом по ребру `y=0`, значение `N`) этой трактовке
соответствует, но НЕ отличает её от обратной («куда смотрит дверь» при севере вниз):
обе дают одну и ту же ОСЬ и различаются знаком. Для приоритета лаг важна ось, так что
цена ошибки мала; если бэкендер подтвердит обратный знак — инвертируется одной строкой
в `_mainDoorDirection`.

**⚠ Открытый вопрос — `terraceHeight`.** Мы его шлём, но в опубликованном контракте
у террасы такого поля нет (`height` есть только у ступеней). Пока не подтверждено,
учитывается ли оно: лишнее поле расчёту не мешает, а терять его нельзя, если оно
влияет на подконструкцию.

**⚠ Выбранный товар пока не влияет на расчёт.** По контракту id главного материала
необязателен, и сейчас он вообще не читается — расчёт всегда идёт на товарах по
умолчанию, пока в каталоге не заполнены характеристики. Id всё равно отправляется:
заработает без правок клиента. Оговорка про это стоит под таблицей расчёта.

### Смета в PDF — `POST /api/v1/calculation_report/`

Собирается фоновой задачей: запуск отдаёт `taskId`, состояние опрашивается
(`GET /api/v1/calculation_report/{taskId}/`), у готовой задачи приходит `url` файла.
Всю механику берёт на себя `Calculator.getReport(type, request, onStatus)` — опрос
раз в секунду, до 60 попыток, дальше ошибка с `kind: 'timeout'`.

Тип `project` поддерживается и здесь, поэтому смета выгружается на проект целиком:
кнопка «Смета проекта в PDF» в окне «Итог» (`_dRenderProjectCalc` → `dProjectReport`),
тело запроса — то же, что у расчёта. Ссылка приходит относительной, поэтому
разворачивается по `RESOURCE_API_DOMAIN` (на статике API и страница — разные хосты).

**Локально** запрос идёт через `devserver.py` (в нём есть `do_POST`, проксирующий
тело и Content-Type на апстрим); на статике — напрямую на `sollersdev.ru` (CORS).

### Ограждения террасы — отдельный элемент проекта

Ограждение не подрежим террасы, а **самостоятельный элемент**: свой пункт сайдбара (сразу
за «Терраса/Крыльцо»), свой редактор, свой раздел каталога, свой материал и своя строка сметы.

| Слой | Что делает | Где |
|------|-----------|-----|
| План-редактор | ломаная точек (`S.pts.railing`), рисуется и ведёт себя как забор, multi-line через `{break:true}` | `initSnapCanvas('railing')`, canvas.js |
| Регистрация редактора | пункт `railing` в `D_SIDEBAR_ITEMS` **и** в `D_CANVAS_INIT`, ключ `railing` в `S.pts` (state.js) **и** в `_dResetAllConfigurations` | nav-desktop.js |
| Каталог | раздел 2331 + тег `fencing` (`GET /api/v1/products/?section_id=2331&tags=fencing`) | `SECTION_TAGS` / `CONSTRUCTION_TO_SECTION.railing`, state.js |
| Материал | deck-элемент (`DECK_MAT_ELEMENTS`): `S.elementMat.railing` с текстурами товара | `_resolveDeckMat(_baseDeck, 'railing')`, viewer3d-core.js |
| 3D | секции GLB `mod_railing` по нарисованной ломаной, навес — по тумблеру `railing-roof` | `buildRailingLine3d`, viewer3d-railing.js |
| Смета | погонные метры ломаной, как у забора | `_elementMetric('railing')`, nav-desktop.js |

**Высота настила** берётся из общего `terraceLevel` (см. `S.terraceH`) — ограждение стоит на
той же отметке, что настил, ступени и мебель. Высота самого ограждения стандартная,
не настраивается.

**Прилипание точек** (в обработчике клика `initSnapCanvas`, ветка `name === 'railing'`):
курсор притягивается к кромкам блоков террасы и к стенам дома с порогом `EDGE_SNAP_DIST`
(0.5 м), но **не вплотную** — с отступом `RAIL_INSET` = 0.10 м (полсечения столба, тот же,
которым инсетится контур у автоматических перил, поэтому нарисованное ограждение садится
ровно туда же, куда прежнее «по контуру»). Вплотную столб влезал бы в стену или свешивался
за край настила.

- Кандидаты от кромки настила отсчитываются **внутрь блока**, от стены — **наружу от дома**
  (сторона определяется по центру bbox дома).
- Кромки настила имеют **приоритет** над стенами: там, где терраса пристроена к дому, край
  и стена совпадают, и «наружный» кандидат стены увёл бы точку с настила. Поэтому сначала
  ищется попадание по террасе, и только при промахе — по стенам.
- `RAIL_INSET` объявлен в `viewer3d-railing.js`, который подключается ПОСЛЕ `canvas.js`;
  обращение идёт в рантайме (клик), поэтому порядок не мешает, но защита
  `typeof RAIL_INSET !== 'undefined'` оставлена — canvas.js не должен падать без 3D-слоя.

**NB по текстуре.** Материал товара ложится по UV из GLB-модуля, без кубической проекции
(`_applyBoxUV`), поэтому рисунок на балясинах мельче, чем на настиле. Продукт считает это
приемлемым (2026-08-15); если понадобится единый масштаб — применить `_applyBoxUV` к мешам
ограждения.

### Забор — условный вид и модель товара

Вид забора определяется **выбранным товаром**: у него приходит `glb_file_url` (то же поле,
что у садовой мебели), модель тянется `ensureFenceModel` и ставится секциями по нарисованной
ломаной. **Материалы модели не трогаем** — текстура приходит вместе с ней (TODO.md → ЗАБОР 3).

Пока таких товаров в каталоге нет, забор строится в **условном виде**: столбы + полотно
нейтрального цвета (`FENCE_SCHEMATIC_COLOR`). Это осознанно «черновой» вид — разметка видна
в сцене и считается в смете, но никто не примет её за реальный профиль.

Секции в пролёте — РАВНОЙ ширины: `n = max(1, round(длина / 2))`. Схема «целые по 2 м +
остаток» прижимала к углу узкий огрызок. Высота полотна — `S.fenceH` (1.5/1.9 м), у модели
применяется масштабом от `FENCE_NATIVE_H`.

Локальные модули `assets/houses/modules/fences/mod_fence_00N.glb` в сборке больше не
используются (выбор типа убран по TODO.md → ЗАБОР 2) — они остаются как исходники для
моделей, которые появятся на бэкенде.

### Соглашение по именам файлов assets/

Подробная таблица с размерами и источниками в `assets/README.md`.
Рекомендованные источники: polyhaven.com (CC0), ambientcg.com.

---

## Бэкенд (не начат)

Своего бэкенда пока нет, и текущий фронт в нём не нуждается:

- **Каталог** — внешний REST API `sollersdev.ru` (клиент `ResourceManager.js`), CORS включён.
- **Смета** считается на клиенте (`_computeEstimate` в `nav-desktop.js`): геометрия из `S`
  × цена товара из каталога, с запасом 10% на доску и 5% на забор. Исключение — **терраса**:
  её спецификацию считает внешний бэкенд (`POST /api/v1/calculate_terrace/`, см. раздел
  «Расчёт террасы»); клиентская оценка по площади осталась рядом как ориентир.
- **Проект не сохраняется** — состояние живёт только в памяти вкладки.

Что потребуется от бэкенда, когда дойдут руки: сохранение/загрузка проекта
(конфигурация + смета), отправка заявки менеджеру и — опционально — серверный
пересчёт сметы, если правила расчёта станут сложнее клиентских. Ранняя версия
JSON-контракта `POST /api/calculate` и схемы БД лежит в git-истории этого файла
(до v=124); она описывала устаревшую модель состояния и намеренно удалена.

---

## Решения, принятые в процессе

| Решение | Почему |
|---------|--------|
| Vanilla JS, без фреймворков | Нет сборки, быстрая итерация, достаточно для прототипа |
| Three.js r128 | Стабильная версия; хостится локально в `vendor/three` (CDN недоступны в части сетей) |
| Разбивка на файлы без бандлера | Простота развёртывания, nginx отдаёт статику напрямую |
| viewer3d: core → builders → railing | Монолит на 3.4 тыс. строк разрезан по зонам ответственности; общая глобальная область, важен порядок подключения |
| IS_MOBILE через UA + innerWidth | Осталось от мобильной версии; сейчас влияет только на параметры антуража (он отключён) |
| RGBELoader/EXRLoader/GLTFLoader — локально | Обычные `<script>` вместо динамического loadScript; CDN не используется |
| CPU box-UV вместо onBeforeCompile | onBeforeCompile с worldpos_vertex несовместим с r128; CPU надёжнее |
| Никаких placeholder-текстур | `TextureLoader.load` отдаёт объект сразу; прежний `Object.assign(placeholder, tex)` копировал uuid и ломал GL-кэш |
| Процедурная земля (canvas diffuse + normal) | Нет тайлинга, органичный вид, не нужны внешние текстуры |
| Эллиптические пятна на ground | Круглые выглядят искусственно; rotate+scale создают органику |
| Процедурная normal map с 60000 травинок | Иллюзия травяного покрова без внешних текстур |
| polygonOffset на frame material | Z-fighting между рамами и стенами из-за сведения полигонов |
| Подоконники вместо откосов (reveals) | Откосы создавали артефакты внутри стекла |
| HDRI: sun 1.5 + amb 0.0 + exposure 0.72 | HDRI заливает тени; сильное солнце компенсирует, пониженная экспозиция убирает пересвет текстур |
| Стекло: opacity 0.5, metalness 0.82 | Скрывает отсутствие интерьера за окном |
| alphaTest + toneMapped:false для спрайтов | Убирает белую обводку PNG и пересвет от ACESFilmic |
| MeshStandardMaterial для стекла | `transmission` у MeshPhysicalMaterial в r128 нестабилен; высокий metalness даёт отражение без него |
| GLB → PNG → canvas fallback chain | Позволяет постепенно улучшать качество, добавляя 3D-модели |
| Draco не используется | r128 требует отдельный WASM-декодер, лишняя зависимость |
| Туман отключён | Мешает восприятию участка на типичных дистанциях камеры |
| Применённый материал = выбор для сметы | Отдельная кнопка «В смету» позволяла развести материал в 3D и материал в смете; блок «Образцы» убран вместе с ней (v=136) |
| Cache-busting через ?v=N | Браузеры агрессивно кэшируют JS; версию в `index.html` поднимать при КАЖДОЙ правке файла |
| FastAPI для бэкенда (план) | Python удобен для расчётного модуля; сам бэкенд не начат |
| Приглушённый ground | Снижена насыщенность и светлота процедурной текстуры земли |
| Камера не ниже земли | controls.change → camera.position.y >= 0.3 |
| Площадка под домом чёрная | Визуально отделяет цоколь от земли, не конфликтует с материалами |
| Терраса на 1 см ниже цоколя | Избегает z-fighting между настилом террасы и верхней гранью фундамента |
| Юбка террасы 6 см | Толщина 0.06 закрывает зазоры между смежными конструкциями |
| Кубическая UV — ребро 1 м везде (`UV_TILE`) | Единый масштаб рисунка у дома, террасы, дорожек и грядок |
| Шаг курсора 0.25 м при разметке 0.5 м | Точность позиционирования выше шага сетки; точки разметки крупнее, чтобы план оставался читаемым (`SNAP` / `GRID_STEP`) |
| Канвас редактора на всё окно | Вписанный квадрат оставлял пустые поля по бокам; поле плана центрируется внутри полноразмерного канваса смещением в `ox`/`oy` |
| Ограждение — отдельный элемент, а не подрежим террасы | Строится по НАРИСОВАННОЙ линии (в пределах террасы), имеет свой раздел каталога и свою строку сметы |
| Прилипание к стенам — порог 0.5 м (`EDGE_SNAP_DIST`) | Grid-снап 0.5 м срабатывает ДО wall-снапа, поэтому реальный радиус захвата ≈ порог + полклетки; при 1 м кромка «залипала» за 1.5 м |
| Ограждение прилипает с отступом `RAIL_INSET` = 0.10 м, а не вплотную | Полсечения столба: вплотную столб влезал бы в стену или свешивался за кромку настила. Тот же инсет, что у автоматических перил по контуру, — линия садится туда же |
| У ограждения кромки террасы приоритетнее стен | Где терраса пристроена к дому, край и стена совпадают; «наружный» кандидат стены уводил точку с настила |
| Multi-line через {break:true} | Позволяет рисовать несколько отдельных дорожек/заборов в одном canvas |
| Разметка НЕ переснапивается при открытии | Rect, прижатый к стене дома (не на сетке 0.5 м), иначе «съезжал» при повторном редактировании |
| Sidebar — single-selection кнопки | Чеклист путал: пользователь не понимал, что включение делает в 3D |
| Editor lock (dEditorOpen) | Блокирует панель и другие кнопки пока canvas открыт — фокус на задаче |
| vegGroup + _vegGen | Растительность в отдельной группе, генерационный счётчик отсекает stale callbacks |
| occupiedZones для растительности | Деревья/кусты не пересекаются с террасами, дорожками и т.п. |
| Антураж после разметки | _buildEntourage вызывается только при наличии размеченных конструкций |
| Ограничение размеров | Площадь 40–100 м², этаж 270–360 см, фундамент 50–120 см |
| Только десктопный UI | Мобильный wizard удалён (его файлы — в git-истории); поддерживается один `index.html` |
| Одна высота борта на ВСЕ грядки | Подтверждено продуктом (2026-08-11). Товар применяется к элементу целиком, высота приходит из него (`S.bedH`); отличать грядки друг от друга не требуется, поэтому назначения товара каждой грядке отдельно (как у точек мебели) не делаем |
| Canvas wrapper IDs — `cw-<id>` / `cv-<id>` | canvas.js находит обёртку и canvas по id секции, без явной передачи элементов |

---

## Десктопный UI (index.html)

### 3 экрана:

1. **d-screen-1** — выбор типа дома (fullscreen grid карточек)
2. **d-screen-2** — параметры + 3D (left: area/floor/foundation с range-слайдерами, center: 3D)
3. **d-screen-3** — рабочая область (3 колонки):
   - **Left sidebar** (300px) — кнопочное меню позиций (single-selection). Клик → выбор для каталога или открытие canvas-редактора. Карандаш (✏) для повторного редактирования.
   - **Center** — 3D-вид или canvas-редактор (overlay поверх 3D)
   - **Right panel** (340px) — материалы: фильтры цвета/цены → результаты (auto-show).
     Во время canvas-настройки панель скрыта целиком.
     Палитра цвета — **своя на тип элемента** (`_elementColors(dActiveItem)` → `ELEMENT_COLOR_NAMES`/`CATALOG_COLOR_HEX`, по COLORS.md). У каждого квадрата `title` = название цвета из каталога (tooltip при наведении). Во время работы canvas-редактора панель СКРЫТА целиком.

### Sidebar (nav-desktop.js):
- **`dActiveItem`** — текущая выбранная позиция (single-selection).
- **`dEditorOpen`** — блокирует панель и другие кнопки пока canvas-редактор открыт.
- **`dConfigured`** (Set) — отмечает позиции, прошедшие через "Готово".
- Клик по некотронутой позиции с редактором → открывается canvas. Клик по сконфигурированной → выбор для каталога.
- Порядок пунктов (`D_SIDEBAR_ITEMS`): терраса → **ограждения террасы** → ступени → дорожки →
  забор → фасад → грядки → садовая мебель → бассейн → причал.
- Ограждение террасы — ОТДЕЛЬНЫЙ элемент проекта (свой редактор, раздел каталога, материал и
  строка сметы), подрежима у террасы больше нет. См. «Ограждения террасы».

### Canvas-редакторы:
Каждая секция с редактором (terrace, railing, steps, paths, fence, beds, facade, furniture, pool_terrace, pier) имеет свой
`d-center-canvas` overlay: обёртка `cw-<id>`, canvas `cv-<id>`.
Терраса, терраса у бассейна и причал делят ОДИН редактор — `initRectCanvas(secId)`
(реестр `RECT_SECTIONS`); кнопки «Добавить»/«Удалить» зовут `addRect(secId)` / `delActiveRect(secId)`.
При нажатии «Готово» → `dConfigured.add(secId)`, панель показывается, 3D перестраивается.
Кнопка «← Назад» внизу сайдбара при открытом редакторе работает как ОТМЕНА (`dCancelCanvas`):
элемент, который не был настроен раньше, убирается из проекта.

**Новый редактор = запись в ДВУХ местах:** `D_SIDEBAR_ITEMS` (пункт меню) и `D_CANVAS_INIT`
(инициализация канваса). Без второй редактор откроется пустым и мёртвым — оверлей есть,
состояния `CV[name]` и слушателей нет. Если у секции своя запись в `S.pts`, её ключ обязан
быть и в `state.js`, и в литерале `_dResetAllConfigurations` (nav-desktop.js) — иначе после
смены типа дома `S.pts[name]` станет `undefined`. На этом дважды погорело ограждение (v=141).

### Canvas snap-сетка (canvas.js):
- `GRID=32` (общий размер участка в метрах), `SNAP=0.25` (шаг КУРСОРА),
  `GRID_STEP=0.5` (шаг РАЗМЕТКИ), `CELLS = GRID / GRID_STEP = 64`.
- Крупные точки (каждый 1 м, радиус 2), мелкие (каждые 0.5 м, радиус 1.2). Поле плана белое.
- **Канвас занимает всю область редактора** (как 3D-вид), поле плана — квадрат внутри него:
  `fitCanvasToWrap` кладёт центрирующее смещение в `ox`/`oy`, сторона поля — `planPx(cvEl)`.
- **Прилипание к стенам дома** и кромкам соседних блоков: порог `EDGE_SNAP_DIST = 0.5` м.
  У ограждения (`railing`) прилипание своё — к кромкам настила и стенам, но с отступом
  `RAIL_INSET` = 0.10 м и приоритетом террасы над стенами (см. «Ограждения террасы»).
- **Терраса/крыльцо, ступени, грядки**: drag + resize со снапом (`snapDraggedRect`); уже расставленное при повторном открытии НЕ переснапивается. У ступеней после каждого перетаскивания работает `_stepsNormalize` (глубина и разворот — не от пользователя).
- **Навигация по плану**: колесо — зум, ПРАВАЯ кнопка — перемещение (`attachMousePan`), как в 3D; левая кнопка занята инструментами.
- **Multi-line** (дорожки, забор, ограждение): маркер `{break:true}` в массиве точек, `splitAtBreaks()` разбивает на сегменты.

### Правая панель:
- Фильтры цвета/цены → результаты показываются автоматически (без кнопки "ПОДОБРАТЬ").
- Карточки товаров: «Применить» (у заглушек — ещё «Сравнить»). Отдельной кнопки «В смету» нет:
  применённый материал И ЕСТЬ выбор для сметы — два действия путали (материал в 3D один, в смете другой).
- Селектора раздела каталога и блока «Образцы» нет (убраны в v=136): раздел выбирается элементом
  проекта, а роль «образца» выполняет применённый материал.
- При нажатии «Применить» материал применяется к 3D-сцене и пишется в `S.elementMat[элемент]`
  и `S.estimate[элемент]` (`_setEstimateForActive`); смета и расчёт террасы пересчитываются
  при следующем открытии «СМЕТЫ».
- Плавающая кнопка **«СМЕТА»** видна только на шаге 3 и только когда в смете есть товар
  (`_dSyncSummaryBtn`).

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
| JS-загрузчик `loadHouseType()` | ✅ в `shared/house-builder.js` |
| JS-сборщик `buildHouseFromDescriptor()` | ✅ в `shared/house-builder.js`. Поддерживает: ortho-полигоны с reflex-углами, многоэтажность с per-floor offset и area_factor |
| Декомпозиция полигона на rects + hip/gable per rect | ✅ `decomposeOrthoPolygonIntoRectangles` в shared |
| `transformParametricModule()` | ✅ в shared, с детектом native bbox (X/Y/Z) для всех частей: frame_*, leaf_*, glass, curtain, mullion_*, sill, threshold |
| `applyMaterialOverride()` | ✅ в shared (принимает parent, color-пикеры по `mat_*`) |
| Декор: cornice / chimney / gutter / downpipe / inter-floor cornice | ✅ в shared (углы карниза — `mod_cornice_corner.glb`) |
| Porch (крыльцо) | ✅ в shared. Привязка к двери (с флагом `"main": true`), процедурная сборка: ступени с nosing, щёки с лестничным контуром, 2 колонны, плоский навес с наклоном, перила с балясинами + поручни, наклонные перила вдоль ступеней, чёрный pad. См. `buildPorch` в `shared/house-builder.js`. |
| Pad под домом | ✅ в shared. Строится по реальному bbox outline (`firstOutline.bbox`), стыкуется с pad крыльца. В `viewer3d-core.js` pad строится только как fallback при процедурном `buildHouseMeshes`. |
| Velux на скате | ✅ в shared. GLB-модуль трансформируется параметрически + правосторонний базис ската (`axisAlong, axisUp, normal`). Размещение БЕЗ выреза в скате (frame поднят на 6 см над плоскостью). Custom flat glass **сажается в раму** (верх рамы измеряется самокалибровкой по вершинам GLB вдоль нормали → стекло чуть ниже канта, не «висит»); под стеклом — **полигон-штора** (`mat_curtain`, белый + карта нормалей). Стекло velux — некалёное (metalness 0), чтобы штора читалась. Окно/стекло/штора — выше плоскости крыши. |
| Dormer на скате | ✅ в shared. Процедурная сборка: walls (BoxGeometry) + 2 ската мини-крыши + 2 фронтона. Конёк перпендикулярен главному, угол совпадает с углом главной крыши. `basePt.y` опускается на `(d/2)*tan(angle)` чтобы передняя часть села на скат. Размеры подбираются так, чтобы задняя стенка ушла под скат (`d ≥ h/tan + w/2`). Окно во фронтоне с custom flat glass перед стеной. |
| Процедурный билдер `buildHouseMeshes()` | ✅ в `viewer3d-builders.js`, используется как fallback пока `ensureHouseLoaded()` в полёте |
| Подключение в основной фронтенд (`viewer3d-core.js` + `nav-desktop.js`) | ✅ `HOUSE_TYPE_MAP` (state.js) + `ensureHouseLoaded`; `dSelectHouseAndGo` запускает preload; в `buildScene3d()` вызывается `HouseBuilder.buildHouseFromDescriptor` |

**Открытые TODO (некритично, инкрементально):**
- Handle двери обрезается при `scale.x` створки (в GLB handle — child of leaf); нужна пересборка GLB с handle как sibling.
- `mod_cornice_concave_corner.glb` — L-образный добор для вогнутых углов; сейчас две карнизные планки перекрываются на 15 см (малозаметно).
- Eave для polygon-flat-roof: слаб ровно по outline без свеса; нужен Minkowski offset для произвольного полигона.
- Mansard с наклонными стенами (вместо вертикального knee wall).
- `buildPorch3d` (процедурное крыльцо в `viewer3d-builders.js`) — мёртвый код: в текущем флоу крыльцо = блок террасы. Кандидат на удаление.

**Расхождение имён в legacy-GLB.** Модули из `Modules.blend` (окна single/double/wide) используют `Glass` (с заглавной) и `treshold` (опечатка) вместо спековых `glass`/`threshold`. Решено alias-таблицей `NAME_ALIASES` в `shared/house-builder.js`; новые модули идут строго по спеке.

---

## Журнал итераций (последние)

Полная история — в `git log`; здесь только свежие итерации, чтобы видеть,
что менялось в актуальном коде.

Ревизия документации 2026-08-16 (кода не касалась):

- Добавлен раздел **«Ограждения террасы»** — элемент собирался четырьмя итерациями (v=139…143)
  и был описан только по кускам в журнале: теперь один раздел про редактор, каталог (2331 +
  тег `fencing`), материал, 3D и прилипание с `RAIL_INSET`.
- Из «Следующих шагов» убран закрытый пункт про товары ограждений; добавлен отложенный
  продуктом масштаб текстуры на балясинах.
- В «Порядок подключения скриптов» добавлен актуальный срез `?v=N`, чтобы версии не искать
  по журналу; в решения — две строки про снап ограждения.

Сделано в итерации v=149 (кнопка «СМЕТА» и пустая смета):

- **«СМЕТА» показывается всегда** на шаге 3 (было: только после первого применённого
  товара — кнопка «пропадала», и это читалось как баг). Кнопка живёт внизу правой панели,
  поэтому её не видно, пока панель скрыта: до выбора элемента и во время canvas-редактора.
- **Пустая смета объясняет себя**: конструкции размечены, но ни один товар не применён —
  вместо таблицы из прочерков с итогом 0 ₽ выводится «Товары ещё не выбраны».
  Разметки нет вовсе — прежнее «Разметьте конструкции, чтобы рассчитать смету».
- Из блока расчёта проекта убран длинный поясняющий комментарий (про спецификацию,
  «голый» материал и товары по умолчанию) — по просьбе продукта.
- Cache-bust: `nav-desktop.js?v=83`.

Сделано в итерации v=148 (подкладки притоплены):

- **Все подкладки притоплены**: верх плиты на `PAD_TOP_Y` = 5 мм над землёй, остальные
  45 мм уходят вниз (`HouseBuilder.PAD_TOP_Y`, читают `buildPadSlab`, `buildConstructionPad`
  и процедурный fallback-pad). Две причины: у террасы и лестницы торчал 5-сантиметровый
  ТОРЕЦ плиты (тёмная полоса вдоль настила), а верх плиты совпадал с верхом дорожки
  (обе на 0.05) — на пересечении шёл z-fighting. Толщина плит не менялась: она и была
  одинаковой (50 мм у дома, террасы и лестницы).
- `buildPadSlab` получил необязательный `yTopOverride` — отметку верхней плоскости.

Сделано в итерации v=147 (опоры навеса и цвет отмостки):

- **Навес держат столбы САМОГО ограждения.** Отдельные колонны (`porch_column`) больше не
  строятся, когда ограждение размечено: угловые столбы и каждый второй вытягиваются до низа
  навеса (`makeTallPost`). Проверка шла по тумблеру `terrace-railing`, которого в UI нет с тех
  пор, как ограждение стало отдельным элементом проекта, — поэтому рядом со столбами росли
  «лишние» стойки. Теперь условие — наличие разметки `S.pts.railing`.
- **Цвет отмостки — один на все подкладки** (`HouseBuilder.PAD_COLOR`): дом, крыльцо, терраса,
  ступени. Значение `0x3c3c3c` подобрано ПО РЕНДЕРУ: базовый цвет умножается на освещение
  (~×2.3, с холодным оттенком неба), и в кадре получается ≈ (124,132,145) — средне-серый.
  Замеры: `0x808080` → ≈205 (почти белый), `0x585858` → ≈160, `0x3c3c3c` → ≈134.
- Cache-bust: `shared/house-builder.js?v=84`, `viewer3d-core.js?v=134`,
  `viewer3d-builders.js?v=17`, `viewer3d-railing.js?v=7`.

Сделано в итерации v=146 (навес, низ перил и подкладка):

- **Колонны навеса — из материала ограждения** (`M.railing` в `buildTerraceCanopies`).
  `placeScaledGlb` только переименовывает материалы модуля, цвет остаётся из GLB, поэтому
  рядом с товарным ограждением стойка выглядела «без материала»; теперь материал
  накладывается на обёртку после установки. Нет ограждения — прежний `M.post`.
- **Низ перил лестницы доведён до земли**: точка `B` продлевается по уклону до `Y = 0`,
  столб-ньюэл встаёт на грунт. Раньше низ перил был на уровне последней проступи, а перед
  лестницей проступей уже нет — столб висел в воздухе.
- **Подкладка (отмостка)**: выступ `PAD_OFFSET` = 10 см (было 30 — у террасы и лестницы
  читалась как отдельная площадка), цвет `PAD_COLOR` = `#808080` (был чёрный).
  Оба значения — константы рядом с `buildConstructionPad`.
- Cache-bust: `viewer3d-core.js?v=133`, `viewer3d-builders.js?v=16`, `viewer3d-railing.js?v=6`.

Ревизия документации 2026-08-22 (кода не касалась):

- `TODO.md` переписан как статус: пройденный список от 2026-08-21 свёрнут в таблицы
  «что было → как закрыто», открытыми остались только пробелы бэкенда (баги 3–5),
  проверка расчёта на живом стенде и отсутствие типов расчёта для фасада и грядок.
- В «Следующих шагах» пункт про обещанные ручки расчёта заменён фактическим
  состоянием (terrace/steps/path/fence/railing/furniture уже подключены) и добавлен
  пункт про превью и фото товаров.

Сделано в итерации v=145 (материалы лестницы и точность залипания):

- **Перила лестницы = материал ограждения террасы, один в один.** Раньше они собирались
  из СВОЕЙ базы (`PORCH_COLUMN_COLOR`), и у товара без PBR-текстур клонировалась именно
  она — отсюда другой цвет и блеск. Теперь `buildScene3d` кладёт разрешённый материал
  ограждения в `M.railing`, лестница берёт его клон (заготовка освобождается сразу после
  сборки, чтобы не копить материалы на пересборках).
- **Зашивка (щёки) и подступенки — материал ТЕРРАСЫ** (`M.terraceSide`). Ориентация:
  у щёк — как у боковины террасы (U по высоте, V вдоль спуска, ребро `TERRACE_SIDE_TILE`),
  у подступенков — горизонтальные доски (`_applyBoxUV` с тем же ребром). У щёк UV не было
  вовсе — текстура товара на них просто не ложилась, поэтому они и выглядели «бетонными».
- **Залипание ступеней стало точнее**: снап учитывает, что перило смещено от кромки
  (`кромка ∓ STAIR_RAIL_INSET`), и работает не только при перемещении:
  при resize подтягивается перетаскиваемая кромка (противоположная стоит на месте),
  а при открытии редактора ступени сами приходят к столбам — ограждение могли
  разметить уже после лестницы.
- Cache-bust: `canvas.js?v=46`, `viewer3d-core.js?v=132`, `viewer3d-builders.js?v=15`.

Сделано в итерации v=144 (TODO 8, 10, 12 + расчёт дорожек):

- **Терраса у бассейна и причал — тот же прямоугольный редактор, что у террасы**
  (реестр `RECT_SECTIONS`, `initRectCanvas(secId)`). Обе секции отдельно стоящие: к дому не
  липнут, в расчёт уходят типом `terrace` со всеми вершинами `free`. Полигональные редакторы
  этих секций и их ветки в `S.pts` удалены.
- **Каталог у трёх террас общий, материал — нет**: бассейн и причал показывают те же карточки,
  что терраса (раздел 2314 + палитра `terrace`, было и раньше), но доску выбирают свою и в смете
  идут отдельными категориями.
- **Дорожки считаются на бэкенде** (`_pathProjectObjects`): осевая + ширина → замкнутый контур
  ленты с опорной («стартовой») стороной, кромки — тем же `_offsetPolyline`, что в 3D, стыки
  подрезаны `_trimPathJunctions`. Каждая линия разметки — отдельный объект дорожки.
- **Ступени «залипают» к столбам ограждения террасы** (`_stepsSnapToRailPost`, TODO.md 10).
  При ПЕРЕМЕЩЕНИИ (не при resize) лестница подтягивается поперёк спуска так, чтобы ось одного
  из её перил (`latOff = max(0.10, ширина/2 − STAIR_RAIL_INSET)` — формула из 3D) пришла в
  ближайший столб. Раскладка столбов на плане — `_railingPostsNorm()`, копия раскладки
  `buildRailing3d` (шаг `RAIL_SECTION_W`, конец отрезка — всегда столб, остаток < 15 см
  растворяется в последней секции); **менять раскладку в 3D — менять и здесь**. Столбы
  показаны кружками в редакторе ступеней, иначе снап выглядит как случайный рывок.
- **Цвета стен дома**: белый, бежевый, коричневый (было одно значение), только цвет, без текстур.
- Cache-bust: `state.js?v=46`, `canvas.js?v=45`, `viewer3d-core.js?v=130`,
  `viewer3d-builders.js?v=14`, `nav-desktop.js?v=81`.

Сделано в итерации v=143 (прилипание в редакторе ограждений):

- **Точки ограждения прилипают к кромкам террасы и стенам дома с отступом** на полсечения
  столба (`RAIL_INSET` = 0.10 м — тот же, которым инсетится контур у автоматических перил,
  так что нарисованное ограждение совпадает с прежним «по контуру»). Прилипание вплотную
  сажало бы столб в стену или свешивало за край настила.
- Кромки настила имеют **приоритет** над стенами: там, где терраса пристроена к дому, край
  и стена совпадают, и у стены есть кандидат «наружу от дома», уводящий точку с настила.
- Cache-bust: `state.js?v=41`, `canvas.js?v=38`.

Сделано в итерации v=142 (ограждения террасы — товары каталога):

- **Тег `fencing`** (ручка бэкенда `GET /api/v1/products/?tags=fencing`, 2026-08-15) привязан
  к разделу 2331. Запрашивается как остальные разделы — `section_id` + тег (подтверждено, что
  все товары тега лежат в одном разделе; в `SECTION_TAG_ONLY` осталась только мебель).
- **Ограждение стало deck-элементом** (`DECK_MAT_ELEMENTS`): у него свой `S.elementMat.railing`
  с текстурами товара. `buildRailing3d` принимает материал (`matOverride`) — раньше цвет перил
  был захардкожен цветом колонн крыльца, а legacy-путь `applyMaterialToScene` для ограждения
  умер вместе с подрежимом террасы.
- NB: текстура ложится по UV из GLB-модуля `mod_railing` (без кубической проекции) — рисунок
  на балясинах мельче, чем на настиле. Если понадобится единый масштаб, применять `_applyBoxUV`
  к мешам ограждения.
- Cache-bust: `state.js?v=40`, `viewer3d-core.js?v=126`, `viewer3d-railing.js?v=5`,
  `nav-desktop.js?v=68`.

Сделано в итерации v=141 (фикс: редактор ограждений не работал):

- **`railing` отсутствовал в `D_CANVAS_INIT`** — редактор открывался, но `initSnapCanvas`
  не вызывался: не создавалось состояние `CV['railing']` и не вешались слушатели, поэтому
  клики по плану не ставили точек. Запись потерялась при правке соседней строки про забор.
- **`_dResetAllConfigurations` пересобирал `S.pts` без ключа `railing`** — после смены типа
  дома `S.pts.railing` становился `undefined`, и `S.pts[name].push` падал. Ключи этого сброса
  обязаны совпадать с `state.js`.
- **Ограждение добавлено в смету** (`_elementMetric('railing')` — погонаж, как у забора) и в
  порядок строк; в сайдбаре «Ограждения террасы» переехали сразу за «Терраса/Крыльцо».
- Cache-bust: `nav-desktop.js?v=67`.

Сделано в итерации v=140 (забор: условный вид + модель товара):

- **Выбор типа забора убран** (превьюшки, `FENCE_TYPES`, `S.fenceType`, `_dRenderFencePreviews`):
  модель приходит С СЕРВЕРА вместе с товаром — `S.elementMat.fence.modelUrl` (`glb_file_url`,
  как у мебели), грузится `ensureFenceModel` с индикатором прогресса.
- **Материалы модели не подменяются** — текстура приходит вместе с ней; прежняя логика
  «текстурим только планки, раму красим под доску» (`_fenceFrameColor`, `_avgTextureColor`) удалена.
- **Пока товаров с моделями нет — условный вид**: столбы + полотно нейтрального цвета.
- Cache-bust: `state.js?v=39`, `viewer3d-builders.js?v=10`, `nav-desktop.js?v=66`,
  `styles-desktop.css?v=13`.

Сделано в итерации v=139 (ограждения — отдельный элемент проекта):

- **«Ограждения террасы» — свой элемент проекта** со своим редактором-ломаной (`S.pts.railing`,
  рисуется как забор) и своим разделом каталога (2331). Перила строятся ПО НАРИСОВАННОЙ линии
  (`buildRailingLine3d`), а не по контуру террасы: где ставить ограждение, решает пользователь.
  Высота стандартная, не настраивается.
- `buildRailing3d` получил необязательный `segsOverride`: с ним сегменты берутся готовыми
  (ломаная), без него — как раньше, по контуру террасы с инсетом и пропусками у стен/лестницы.
- **Терраса по умолчанию без ограждения и навеса** — тумблеры `terrace-railing`/`terrace-roof`
  убраны; **навес включается в настройках ограждений** (`railing-roof`). `TG_PAIRS` опустел:
  парных тумблеров крыльца больше нет.
- **Переключатель ТЕРРАСА/ОГРАЖДЕНИЕ в каталоге убран** вместе с `S.matSubMode` и `dSetSubMode`:
  раздел определяется элементом проекта.
- Cache-bust: `state.js?v=38`, `canvas.js?v=37`, `viewer3d-core.js?v=125`,
  `viewer3d-railing.js?v=4`, `nav-desktop.js?v=65`.

Сделано в итерации v=138 (ступени и высота настила из TODO.md):

- **Ступени: глубина и разворот больше не задаются пользователем** (`_stepsNormalize` в canvas.js).
  Глубина считается из высоты фундамента ровно так же, как в 3D (`n = ceil(bh / STEP_RISE)`
  ступенек по `STEP_DEPTH` + свес), а лестница разворачивается перпендикулярно БЛИЖАЙШЕЙ стороне
  террасы (при её отсутствии — габарита дома) и примыкает к ней вплотную. Тянуть можно только
  ширину: прямоугольник, менявшийся по обеим осям, обещал настройку глубины, которой нет.
- **Высота настила террасы настраивается** — поле в футере редактора, диапазон 10 см … высота
  фундамента (`dSetTerraceHeight`, `S.terraceH`; `null` = вровень с фундаментом). В 3D появился
  единый `terraceLevel`, по которому строятся настил, ограждение, навес, ступени и посадка мебели —
  раньше в семи местах стояло `isNoHouse ? 0.35 : bh`.
- Cache-bust: `state.js?v=37`, `canvas.js?v=36`, `viewer3d-core.js?v=124`, `nav-desktop.js?v=64`,
  `styles-desktop.css?v=12`.

Сделано в итерации v=137 (canvas на всё окно):

- **Область редактора занимает всё окно**, как 3D-вид: раньше `.d-canvas-area` держала
  `aspect-ratio: 1` и канвас был вписанным квадратом с серыми полями по бокам.
- Поле плана (квадрат GRID×GRID м) центрируется внутри канваса: `fitCanvasToWrap` растягивает
  канвас по контейнеру и кладёт смещение **прямо в `ox`/`oy` pan-состояния**. Благодаря этому
  ни рисование, ни попадание курсора править не пришлось — они и так работают относительно
  `ox`/`oy`. Сторона поля — `planPx(cvEl)` = меньшая сторона канваса.
- `applyTransform` теперь чистит ВЕСЬ канвас (`ctx.canvas.width/height`), а не поле плана:
  при панорамировании за пределами квадрата оставались следы.
- NB: редакторы ступеней/террасы/грядок подменяют канвас клоном (сброс слушателей) —
  размеры задаются КЛОНУ после `replaceChild`, иначе он остаётся нулевого размера.
- Cache-bust: `canvas.js?v=35`, `styles-desktop.css?v=11`.

Сделано в итерации v=136 (UX-правки из TODO.md):

- **Акцент кнопок действий** — `--accent` `#f2722c` / `--accent-hover` `#f48549` вместо чёрной
  заливки («Дальше», «Готово», «Применить», «СМЕТА», активная кнопка высоты).
- **Правая панель во время настройки прячется** (`.hidden`), а не блокируется полупрозрачностью
  с подписью «(заблокировано)» — было непонятно, можно ли с ней работать.
- **Селектор «Раздел каталога» и блок «Образцы» убраны** из UI; вместе с образцами удалена вся
  их механика (`S.samples`, `dRenderSwatches`, `dApplySwatch`, `dRemoveSwatch`, `_dIsLight`).
- **Кнопка «Итог» → «СМЕТА»** и показывается только когда в смете есть хотя бы один товар
  (`_dSyncSummaryBtn`, дёргается из `_setEstimateForActive`).
- **Кнопка «Размеры дома» → «Назад»** (`dBack`): при открытом редакторе это ОТМЕНА
  (`dCancelCanvas`) — элемент, который не был настроен раньше, из проекта убирается. Раньше выйти
  можно было только через «Готово», то есть согласившись создать конструкцию.
- **Камера больше не сбрасывается при пересборке сцены.** Виноваты были ДВА места: центрирование
  в хвосте `buildScene3d` и фрейм по bbox внутри `HouseBuilder.buildHouseFromDescriptor` (он
  получает `controls` в options). Оба теперь работают только пока `threeState.camTouched` = false;
  флаг ставится по событию `start` у OrbitControls и сбрасывается при смене типа дома
  (`resetCameraFraming`).
- **Шаг курсора 0.25 м** (`SNAP`) при прежней разметке 0.5 м (`GRID_STEP`); клик-снап переведён
  на `SNAP`, точки сетки — на `GRID_STEP`.
- **Поле плана белое** вместо серого (тем же цветом рисуются разрывы стен под проёмы).
- Cache-bust: `state.js?v=36`, `canvas.js?v=34`, `viewer3d-core.js?v=123`, `nav-desktop.js?v=63`,
  `styles-desktop.css?v=10`.

Сделано в итерации v=135 (высота грядки — из товара):

- **Высота борта грядки берётся из выбранного товара** (`_bedHeightFromProduct` → `S.bedH`):
  каталог различает грядки по высоте доски (AIWood 150/200/270/300 мм, NauticPrime
  150/225/300 мм — `GARDEN_BEDS.md`), а 3D до этого всегда строило 200 мм.
- Явного поля у товара нет, поэтому высота читается **из названия**: только типовые значения
  рядом с «мм», чтобы не поймать длину («3000 мм») или сечение доски. Не нашли — высота
  остаётся прежней. Если бэкенд заведёт поле, достаточно положить его в `sample.bedHeightMm` —
  оно проверяется первым.
- NB: `\b` после «мм» не работает (в ASCII-семантике кириллица — не словесный символ),
  конец слова проверяется явным `(?![а-яёa-z0-9])`.
- Cache-bust: `nav-desktop.js?v=62`.

Сделано в итерации v=134 (фикс угла забора):

- **Планки не сжимались по длине и вылезали за угол.** `_placeFenceSection` тянул локальную
  X у всех частей, а вдоль пролёта у планок и лаг смотрит локальная Z (у среднего стояка — Y):
  масштаб уходил в высоту, длина оставалась 2 м. Ось теперь вычисляется из кватерниона части
  (`_localAxisAlongSpan`), столб и средний стояк сечение не меняют.
- **Секции в пролёте стали равной ширины** (`round(длина / 2)` штук): схема «целые + остаток»
  оставляла у угла огрызок ~0.3 м, который после фикса оси был бы просто сплющенной секцией.
- Cache-bust: `viewer3d-builders.js?v=9`.

Сделано в итерации v=133 (TODO.md: грядки и заборы):

- **Грядки: высота борта убрана из редактора** — её, как цвет и крепёж, выбирают на карточке
  товара (`GARDEN_BEDS.md` в истории, `TODO.md`). `dSetBedHeight` и блок кнопок удалены,
  `S.bedH` остался значением по умолчанию для 3D до появления свойств товара.
- **Грядки: до выбора товара в 3D — габаритный прямоугольник 3×1** (`_buildBedPlaceholders`),
  он же показывается, пока грузится GLB плантера. Раньше без загруженного GLB грядка не
  рисовалась вовсе, а модель с выдуманной высотой появлялась до выбора товара.
- **Забор собирается из GLB-модулей** вместо процедурных боксов; тип секции выбирается
  превьюшками в редакторе (рендерятся тем же способом, что карточки домов). Планки
  текстурируются товаром, рама красится «под доску». Подробности — в разделе «Забор».
- Cache-bust: `state.js?v=35`, `canvas.js?v=33`, `viewer3d-core.js?v=122`,
  `viewer3d-builders.js?v=8`, `nav-desktop.js?v=61`, `styles-desktop.css?v=9`.

Итерации v=15 … v=132 — в git-истории (`git log --oneline`); здесь они удалены,
чтобы документ описывал ТЕКУЩЕЕ состояние, а не путь к нему.

---

## Следующие шаги

Выполненное перенесено в git-историю; здесь — только открытые пункты.

1. **Расчёт фасада и грядок** — своих типов в API нет (есть terrace, steps, path, fence,
   railing, furniture). Терраса, ступени, дорожки, забор, ограждение и мебель уже уходят
   в `calculate_project/`; фасад и грядки считает клиентский `_computeEstimate`.
   NB: весь расчёт проверен только на структуре запроса — из песочницы разработки
   `sollersdev.ru` недоступен, живого ответа бэкенда никто не видел.
2. **Модели заборов** с `glb_file_url`: фронт подхватит их вместе с текстурами и заменит
   условный вид (см. «Забор»).
3. **Свойства товара грядки** (высота борта отдельным полем): сейчас читается из названия
   (`_bedHeightFromProduct`), поле `bedHeightMm` проверяется первым и заработает сразу.
4. **`mod_cornice_concave_corner.glb`** — L-образный добор для стыка карнизов на вогнутых углах.
5. **Пересборка GLB дверей** — handle сделать sibling `leaf_main`, чтобы ручка не масштабировалась
   вместе со створкой.
6. **Разделы каталога без товаров** (ступени, грядки, МПК-фасады/ступени) — фронт показывает
   заглушки; подключить теги, когда появятся.
9. **Превью и фото товаров** — у части разделов бэкенд отдаёт `preview_picture`/`detail_picture`
   с `url: null`, а `texture_urls` приходят только у товаров с тегом. Отсюда пустые карточки
   у мебели, грядок, фасада, части ограждений, дорожек и заборов (TODO.md, баги 3–5).
   Подробности — в разделе «Превью и фото товаров — чего не хватает на бэкенде».
7. **Знак `doorDirection`** в расчёте террасы — продукт считает несущественным (2026-08-11);
   ось верна в любой трактовке, инвертируется одной строкой в `_mainDoorDirection`.
8. **Масштаб текстуры на ограждении** — сейчас UV из GLB-модуля; при необходимости единого
   рисунка со настилом применить `_applyBoxUV` (отложено продуктом, 2026-08-15).

Закрыто с прошлой ревизии: товары ограждений террасы (раздел 2331, тег `fencing`) — приехали
на бэкенд 2026-08-15 и подключены в v=142.

---

## Конвенции модульной сборки (shared/house-builder.js)

Правила, по которым GLB-модули стыкуются в дом. Нарушение любого из них ломает
геометрию неочевидным образом, поэтому они вынесены отдельно от описания кода.
(Раздел вырос из песочницы `test-house.html`; сама песочница удалена, конвенции
действуют в `shared/house-builder.js`.)

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

**Legacy GLB-имена** (mod_window_single/double/wide, mod_door_single/onehalf/double): `Glass` (с заглавной), `treshold` (опечатка), `Handle` (с заглавной). Маппятся через `NAME_ALIASES = { Glass: 'glass', treshold: 'threshold', Handle: 'handle' }`. Новые модули (velux, dormer, mod_door_slide_*) идут строго по спеке.

**Плоская крыша по полигону — только ручной BufferGeometry.** `THREE.ExtrudeGeometry`
на CCW-контурах с вогнутым углом в r128 даёт артефакты (нестабильные `autoClose` /
отрицательный `depth`), поэтому слаб собирается вручную: верх — триангуляция
`THREE.ShapeUtils.triangulateShape()` (Earcut) по outline, низ — те же треугольники с
обратным winding, по периметру — боковые стенки. Толщина 0.10 м. Возврат к Extrude —
регресс.
