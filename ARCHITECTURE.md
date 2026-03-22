# ARCHITECTURE.md — Конфигуратор загородного дома

## Статус: фронтенд разбит на файлы, PBR-визуализация работает, бэкенд не начат

---

## Структура файлов (текущая)

```
/frontend
  index.html              # разметка + JS-детектор платформы, подключает viewer3d-*
  styles.css              # все стили
  state.js                # S, SECS, SEC_SCREEN, CATALOG_COLORS, PRICE_TIERS, STUB_RESULTS
  nav.js                  # goTo, updProg, getStepOrder и навигационные хелперы
  canvas.js               # pan/zoom движок, snap-canvas, крыльцо (drag+resize)
  viewer3d-core.js        # сцена, HDRI, PBR-материалы, buildScene3d, все 3D-строители
  viewer3d-desktop.js     # антураж десктоп: спрайты кустов/деревьев PNG
  viewer3d-mobile.js      # антураж мобиль: спрайты кустов/деревьев PNG
  catalog.js              # каталог, фильтры, результаты, selMat
  ui.js                   # шаг 10: секции, образцы, примерка, итог

  assets/                 # текстуры и HDRI (подхватываются автоматически по имени)
    README.md             # описание соглашения по именам файлов
    environment.hdr       # HDRI карта окружения (опционально)
    wall_diff.jpg / wall_norm.jpg / wall_roug.jpg
    roof_diff.jpg / roof_norm.jpg / roof_roug.jpg
    base_diff.jpg / base_norm.jpg
    deck_diff.jpg / deck_norm.jpg / deck_roug.jpg
    ground_diff.jpg / ground_norm.jpg
    bush_a.png / bush_b.png / tree_a.png / tree_b.png

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
ui.js → catalog.js
```

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
    paths:        [{x,y}, ...],   // ломаная (не замкнутая)
    pier:         [{x,y}, ...],
    fence:        [{x,y}, ...],
  },
  porch:        { x, y, w, h },  // нормализованные координаты 0..1
  mats:         {},               // выбранные материалы по секции
  samples:      [{ id, name, color }], // накопленные образцы
  activeSample: null,             // текущий образец для примерки
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

**Загрузка текстур:**
- `_loadTex(filename, repeat)` — albedo, sRGBEncoding, с кэшом и placeholder.
- `_loadNorm(filename, repeat)` — normal map, LinearEncoding.
- `_loadData(filename, repeat)` — roughness/AO, LinearEncoding.
- Земля загружается отдельным загрузчиком без placeholder (избегаем `Object.assign` по uuid).

**UV-проекция:**
- `_applyBoxUV(mesh, tileSize, groupOffset)` — кубическая UV-проекция, вычисляется на CPU из локальных позиций вершин + суммарного смещения групп-родителей. Не использует `onBeforeCompile` (несовместимо с r128 без `worldSpaceNormals`).
- `_wallUVHelper(grp, grpOff)` — рекурсивно обходит группу стен, передаёт накопленный offset. Вызывается после `parent.add()` когда все позиции групп уже установлены.

**Геометрия:**
- `buildScene3d()` — главный строитель: дом, терраса, крыльцо, дорожки, забор, перила.
- `buildHouseMeshes()` — стены с окнами/дверью, цоколь, двускатная крыша с UV.
- `buildTerrace3d()` — настил из досок + лаги + опоры по полигону.
- `buildPorch3d()` — площадка + ступени с автоопределением направления.
- `buildPaths3d()`, `buildFence3d()`, `buildRailing3d()`.
- `_buildProceduralSky()` — ShaderMaterial небо с солнечным ореолом (до HDRI).

**Хуки для версионных файлов:**
- `_buildEntourage(scene)` — вызывается при инициализации.
- `_onAnimFrame(t)` — каждый кадр.

### viewer3d-desktop.js и viewer3d-mobile.js

Обе версии содержат только `_buildEntourage` со спрайтами кустов и деревьев.
InstancedMesh-трава выключена. Спрайты: `alphaTest: 0.12`, `depthWrite: false`,
`toneMapped: false`, `color: 0xb8b8b8`. При отсутствии PNG — процедурные fallback.

### PBR материалы (viewer3d-core.js → getHouseMats)

| Материал | Тип | Текстуры из assets/ | UV |
|----------|-----|---------------------|----|
| `wall` — штукатурка | MeshStandardMaterial | wall_diff/norm/roug | кубическая, 2 м/тайл |
| `base` — цоколь | MeshStandardMaterial | base_diff/norm | кубическая, 1 м/тайл |
| `roof` — крыша | MeshStandardMaterial | roof_diff/norm/roug | по скату, 8 м/тайл |
| `glass` — стекло | **MeshPhysicalMaterial** | — | transmission 0.88, ior 1.46 |
| `frame` — рамы | MeshStandardMaterial | — | metalness 0.28 |
| `door` — дверь | MeshStandardMaterial | — | цвет #5c3a1e |
| `deck` — ДПК настил | MeshStandardMaterial | deck_diff/norm/roug | геометрические UV досок |
| `ground` — земля | MeshStandardMaterial | ground_diff/norm | repeat 72×72 |

Все материалы получают `envMap` автоматически при загрузке HDRI.
Базовый `color` земли сбрасывается на белый при загрузке текстуры.

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
| RGBELoader/EXRLoader через CDN статически | Надёжнее динамического loadScript |
| CPU box-UV вместо onBeforeCompile | onBeforeCompile с worldpos_vertex несовместим с r128; CPU надёжнее |
| Отдельный загрузчик для ground | Object.assign копирует uuid текстуры, ломает GL-кэш рендерера |
| color:white при загрузке ground | Базовый цвет умножается на диффуз → пересвет без сброса |
| alphaTest + toneMapped:false для спрайтов | Убирает белую обводку PNG и пересвет от ACESFilmic |
| MeshPhysicalMaterial для стекла | transmission + ior дают реалистичное преломление |
| Туман отключён | Мешает восприятию участка на типичных дистанциях камеры |
| Образцы накапливаются, не заменяют | UX: клиент хочет сравнивать несколько материалов |
| FastAPI для бэкенда | Python удобен для расчётного модуля, быстрый старт |
