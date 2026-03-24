# HOUSE_MODULES_SPEC.md — Спецификация модульной системы 3D-домов

## Статус: ЧЕРНОВИК — обсуждение архитектуры

---

## 1. Концепция

Дом собирается из **модульных GLB-компонентов** как конструктор.
Каждый тип дома описывается **JSON-файлом** (house descriptor), который определяет:
- какие модули использовать
- как их расположить
- граничные значения параметров (площадь, высота этажа, фундамент)
- какие окна, двери, тип кровли

**Ключевой принцип**: один набор GLB-модулей → множество конфигураций домов.

---

## 2. Каталог модулей (GLB-компоненты)

### 2.1. Структура стены

Стена собирается из **секций** — полос фиксированной высоты, которые масштабируются по длине:

```
┌──────────────────────────────────────────┐
│               wall_top                    │  ← Верхняя обвязка (фриз)
├──────────────────────────────────────────┤
│  wall_fill │ window │ wall_fill │ window │  ← Средняя зона (заполнение + проёмы)
├──────────────────────────────────────────┤
│               wall_bottom                 │  ← Нижняя обвязка (цоколь/отлив)
└──────────────────────────────────────────┘
```

### 2.2. Номенклатура модулей

| ID модуля | Файл | Описание | Масштабируется |
|-----------|------|----------|----------------|
| **Стены** |
| `wall_segment` | `mod_wall_segment.glb` | Глухой прямоугольный участок стены (1×1×0.2 м, unit box) | X (длина), Y (высота) |
| `wall_corner_ext` | `mod_wall_corner_ext.glb` | Внешний угол стены (L-образный, 0.2×H) | Y (высота) |
| `wall_corner_int` | `mod_wall_corner_int.glb` | Внутренний угол (если нужен) | Y (высота) |
| **Окна** |
| `window_single` | `mod_window_single.glb` | Одностворчатое окно с рамой, стеклом, подоконником, шторой | — (фиксированный) |
| `window_double` | `mod_window_double.glb` | Двустворчатое окно (с шторой) | — |
| `window_wide` | `mod_window_wide.glb` | Панорамное окно (с шторой) | — |
| **Двери** |
| `door_entrance` | `mod_door_entrance.glb` | Входная дверь с рамой и порогом | — |
| `door_patio` | `mod_door_patio.glb` | Раздвижная/панорамная дверь на террасу | — |
| **Фундамент** |
| `base_segment` | `mod_base_segment.glb` | Участок цоколя (1×1×0.2 м) | X (длина), Y (высота) |
| `base_corner` | `mod_base_corner.glb` | Угловой элемент цоколя | Y (высота) |
| **Крыша** |
| `roof_gable_slope` | `mod_roof_gable_slope.glb` | Скат двускатной крыши (1 м²) | X, Z (по скату) |
| `roof_gable_front` | `mod_roof_gable_front.glb` | Фронтон двускатной крыши | X (ширина), Y (высота) |
| `roof_hip_slope` | `mod_roof_hip_slope.glb` | Скат вальмовой крыши | X, Z |
| `roof_hip_ridge` | `mod_roof_hip_ridge.glb` | Конёк/ребро вальмовой крыши | длина |
| `roof_flat_edge` | `mod_roof_flat_edge.glb` | Парапет плоской крыши | X (длина) |
| **Декор** |
| `cornice_segment` | `mod_cornice.glb` | Карнизный свес (1 п.м.) | X (длина) |
| `chimney` | `mod_chimney.glb` | Дымоход | — |
| `gutter_segment` | `mod_gutter.glb` | Водосток (1 п.м.) | X |
| `downpipe` | `mod_downpipe.glb` | Водосточная труба | Y (высота) |
| `porch_column` | `mod_porch_column.glb` | Колонна крыльца | Y (высота) |
| `porch_step` | `mod_porch_step.glb` | Ступень крыльца | X (ширина) |
| **Участок (отдельная номенклатура)** |
| `fence_panel_*` | `mod_fence_panel_wood.glb` и т.д. | Секция забора | X (ширина) |
| `fence_post` | `mod_fence_post.glb` | Столб забора | Y (высота) |
| `bench_*` | `mod_bench_a.glb` | Скамейка | — |
| `planter_*` | `mod_planter_a.glb` | Грядка / клумба | X, Z |
| `lamp_*` | `mod_lamp_a.glb` | Садовый фонарь | — |

### 2.3. Принцип масштабирования модулей

Каждый GLB-модуль моделируется как **unit-элемент** в стандартном размере.
Код масштабирует его по нужной оси:

```
wall_segment.glb: 1m × 1m × 0.2m (ширина × высота × толщина)
  → scale.x = нужная_длина / 1.0
  → scale.y = нужная_высота / 1.0
  → scale.z = 1.0 (толщина стены фиксирована)
```

**Важно для моделирования**: текстуры должны быть настроены на **world-space tiling**
(или код пересчитает UV после масштабирования). Это позволяет тайлить текстуру
штукатурки одинаково на участках стены разной длины.

---

## 3. JSON-дескриптор типа дома (house descriptor)

### 3.1. Концепция планировки — обход периметра

Планировка этажа задаётся как **обход периметра по часовой стрелке** от левого верхнего
угла (на плане: min X, min Z). Это подход «turtle graphics»:

- Стартуем в точке `[0, 0]`, смотрим **вправо** (направление +X)
- Команда `run` — двигаемся в текущем направлении, рисуя стену заданной длины
- Команда `turn` — поворачиваемся (положительный = по часовой, отрицательный = против)
- Каждый `run` содержит описание **фасада** (что находится на этом отрезке стены)

Контур должен быть **замкнутым** — конечная точка совпадает с начальной.

### 3.2. Параметрические переменные

Длины стен не захардкожены — они выражаются через **переменные**, зависящие от площади.
Код вычисляет переменные при каждом изменении параметров:

```json
"vars": {
  "L":    "sqrt(area * ratio)",
  "W":    "sqrt(area / ratio)",
  "wing": "W * 0.3",
  "arm":  "L * 0.25"
}
```

Выражения поддерживают: `+`, `-`, `*`, `/`, `sqrt()`, скобки, ссылки на другие переменные
и входные параметры (`area`, `ratio`).

### 3.3. Формат дескриптора

```json
{
  "id": "type_a",
  "name": "Одноэтажный дом",
  "description": "Одноэтажный дом с вальмовой крышей",

  "constraints": {
    "base_h":     { "min": 50, "max": 120, "step": 10, "default": 80, "unit": "cm" },
    "roof_angle": { "min": 15, "max": 45,  "step": 5,  "default": 25, "unit": "deg" },
    "wall_thickness": 0.20
  },

  "roof_type": "hip",

  "floors": [
    {
      "id": "floor_1",
      "label": "Первый этаж",

      "constraints": {
        "area":    { "min": 40, "max": 100, "step": 5,  "default": 80,  "unit": "m2" },
        "floor_h": { "min": 270, "max": 360, "step": 10, "default": 300, "unit": "cm" }
      },

      "vars": {
        "L": "sqrt(area * 1.6)",
        "W": "sqrt(area / 1.6)"
      },

      "perimeter": [
        {
          "run": "L",
          "facade": [
            { "wall": 1.2 },
            { "window": "single" },
            { "wall": "fill" },
            { "window": "single" },
            { "wall": 1.2 }
          ]
        },
        { "turn": 90 },
        {
          "run": "W",
          "facade": [
            { "wall": "fill" },
            { "door": "entrance" },
            { "wall": "fill" }
          ]
        },
        { "turn": 90 },
        {
          "run": "L",
          "facade": [
            { "wall": 1.2 },
            { "window": "single" },
            { "wall": "fill" },
            { "window": "single" },
            { "wall": 1.2 }
          ]
        },
        { "turn": 90 },
        {
          "run": "W",
          "facade": [
            { "wall": 1.2 },
            { "window": "single" },
            { "wall": "fill" },
            { "window": "single" },
            { "wall": 1.2 }
          ]
        },
        { "turn": 90 }
      ]
    }
  ],

  "features": {
    "chimney": { "position": [0.3, 0.6], "model": "chimney" },
    "gutters": true,
    "cornice": true
  },

  "materials_map": {
    "mat_wall":     { "label": "Стены",              "swappable": true },
    "mat_base":     { "label": "Цоколь",             "swappable": true },
    "mat_roof":     { "label": "Крыша",              "swappable": true },
    "mat_frame":    { "label": "Рамы окон",          "swappable": true },
    "mat_door":     { "label": "Дверь",              "swappable": true },
    "mat_wood":     { "label": "Дерев. отделка",     "swappable": true },
    "mat_metal":    { "label": "Металл (водосток)",  "swappable": true },
    "mat_concrete": { "label": "Бетон (ступени)",    "swappable": true },
    "mat_curtain":  { "label": "Шторы",              "swappable": true }
  }
}
```

### 3.4. Пример: крестообразный план

```
         ┌─────────┐
         │    N     │
    ┌────┤         ├────┐
    │  W │  center  │ E │
    └────┤         ├────┘
         │    S     │
         └─────────┘
```

Обход по часовой стрелке от верхнего-левого угла крыла N:

```json
{
  "id": "floor_1",
  "label": "Первый этаж",

  "constraints": {
    "area":    { "min": 60, "max": 120, "step": 5, "default": 90, "unit": "m2" },
    "floor_h": { "min": 270, "max": 320, "step": 10, "default": 300, "unit": "cm" }
  },

  "vars": {
    "core": "sqrt(area * 0.6)",
    "arm":  "sqrt(area * 0.1)",
    "comment": "core — центральный квадрат, arm — длина крыла"
  },

  "perimeter": [
    {"_comment": "── Крыло N, верх →"},
    { "run": "core", "facade": [
        { "wall": 0.8 }, { "window": "single" }, { "wall": "fill" }, { "window": "single" }, { "wall": 0.8 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло N → Крыло E, спуск ↓"},
    { "run": "arm", "facade": [{ "wall": "fill" }] },
    { "turn": -90, "_comment": "поворот НАРУЖУ — создаёт выступ" },

    {"_comment": "── Крыло E, верх →"},
    { "run": "arm", "facade": [
        { "wall": 0.6 }, { "window": "single" }, { "wall": 0.6 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло E, правый бок ↓"},
    { "run": "core", "facade": [
        { "wall": 0.8 }, { "window": "single" }, { "wall": 0.8 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло E, низ ←"},
    { "run": "arm", "facade": [
        { "wall": 0.6 }, { "window": "single" }, { "wall": 0.6 }
    ]},
    { "turn": -90 },

    {"_comment": "── Крыло E → Крыло S, спуск ↓"},
    { "run": "arm", "facade": [{ "wall": "fill" }] },
    { "turn": 90 },

    {"_comment": "── Крыло S, низ ←"},
    { "run": "core", "facade": [
        { "wall": 0.8 }, { "window": "single" }, { "wall": "fill" }, { "window": "single" }, { "wall": 0.8 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло S → Крыло W, подъём ↑"},
    { "run": "arm", "facade": [{ "wall": "fill" }] },
    { "turn": -90 },

    {"_comment": "── Крыло W, низ ←"},
    { "run": "arm", "facade": [
        { "wall": 0.6 }, { "door": "entrance" }, { "wall": 0.6 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло W, левый бок ↑"},
    { "run": "core", "facade": [
        { "wall": 0.8 }, { "window": "single" }, { "wall": 0.8 }
    ]},
    { "turn": 90 },

    {"_comment": "── Крыло W, верх →"},
    { "run": "arm", "facade": [
        { "wall": 0.6 }, { "window": "single" }, { "wall": 0.6 }
    ]},
    { "turn": -90 },

    {"_comment": "── Крыло W → Крыло N, подъём ↑ (замыкание)"},
    { "run": "arm", "facade": [{ "wall": "fill" }] },
    { "turn": 90 }
  ]
}
```

### 3.5. Правила фасада (`facade`)

Каждый `run` содержит массив `facade` — описание того, что расположено на стене
слева направо (по ходу движения):

| Элемент | Формат | Описание |
|---------|--------|----------|
| `{ "wall": 2.0 }` | Число (метры) | Глухой участок стены фиксированной длины |
| `{ "wall": "fill" }` | `"fill"` | Заполнитель — делит оставшееся место поровну между всеми `fill` в этом run |
| `{ "window": "single" }` | ID модуля | Окно (ширина берётся из модуля, ~0.9 м) |
| `{ "window": "double" }` | ID модуля | Двустворчатое окно (~1.4 м) |
| `{ "window": "wide" }` | ID модуля | Панорамное окно (~2.4 м) |
| `{ "door": "entrance" }` | ID модуля | Входная дверь (~1.0 м) |
| `{ "door": "patio" }` | ID модуля | Патио-дверь (~2.0 м) |

**Высота (Y) окон/дверей** берётся из модуля (определена в GLB).
При необходимости можно переопределить: `{ "window": "single", "y": 1.2 }`.

**Алгоритм расчёта `fill`:**
```
totalRun = вычисленная длина run (из vars)
fixedLen = сумма длин всех фиксированных wall + ширин всех окон/дверей
fillCount = количество элементов "fill"
eachFill = (totalRun - fixedLen) / fillCount
```

Если `eachFill < 0.1` — ошибка в дескрипторе (элементы не помещаются).

### 3.6. Автоматическое размещение окон

Вместо ручного перечисления окон можно использовать `"windows": "auto"`:

```json
{
  "run": "L",
  "facade": "auto_windows",
  "window_type": "single",
  "min_margin": 1.0
}
```

Это эквивалент:
```
winCount = floor(runLength / (windowWidth * 2.9))
margin   = (runLength - winCount * windowWidth) / (winCount + 1)
facade   = [wall(margin), win, wall(margin), win, ..., wall(margin)]
```

### 3.7. Ограничения (constraints)

Конфигуратор читает `constraints` и:
- Устанавливает `min`, `max`, `step` на `<input type="range">` и `<input type="number">`
- Валидирует введённые значения
- Округляет до шага: `area = round(rawArea / step) * step`
- Пересчитывает `vars` → пересчитывает `run` длины → перестраивает 3D

### 3.8. Вычисление контура из perimeter

```javascript
function computeOutline(perimeter, vars) {
  const points = [];
  let x = 0, z = 0;
  let dx = 1, dz = 0; // начальное направление: вправо (+X)

  for (const cmd of perimeter) {
    if (cmd.turn !== undefined) {
      // Поворот: положительный = по часовой
      const rad = cmd.turn * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const ndx = dx * cos + dz * sin;
      const ndz = -dx * sin + dz * cos;
      dx = Math.round(ndx); dz = Math.round(ndz); // 90° → точные 0/1/-1
      continue;
    }

    if (cmd.run) {
      const len = evalExpr(cmd.run, vars); // "L" → 11.3
      points.push({ x, z, length: len, dx, dz, facade: cmd.facade });
      x += dx * len;
      z += dz * len;
    }
  }

  // Проверка замкнутости
  if (Math.abs(x) > 0.01 || Math.abs(z) > 0.01) {
    console.warn('Контур не замкнут! Δx:', x, 'Δz:', z);
  }

  return points; // массив рёбер с координатами и фасадами
}

---

## 4. Соглашения по GLB-модулям (для Blender)

### 4.1. Общие правила

| Параметр | Значение |
|----------|----------|
| Формат | glTF Binary (.glb) |
| Масштаб | 1 unit = 1 метр |
| Ось вверх | Y-up (стандарт glTF, Blender конвертирует автоматически) |
| Origin | У основания, в левом-нижнем углу (min X, min Y, min Z) |
| Материалы | Principled BSDF (PBR), именованные по соглашению |
| Полигонаж | до 5 000 треугольников на модуль (мобильный бюджет) |
| Текстуры | Embedded в GLB, **не** Draco-сжатые |
| Apply Modifiers | ✓ |
| Apply Transforms | ✓ (Ctrl+A → All Transforms) |

### 4.2. Именование материалов в Blender

Материалы в GLB **должны** иметь точные имена — код ищет их для замены:

```
mat_wall         — штукатурка / облицовка стен
mat_base         — цоколь / фундамент
mat_roof         — кровля
mat_frame        — оконные / дверные рамы
mat_glass        — стекло
mat_door         — полотно двери
mat_wood         — деревянная обшивка (крыльцо, фасадные вставки)
mat_metal        — металлические элементы (водосток, ручки)
mat_concrete     — бетон (ступени, отмостка)
mat_curtain      — шторы за окнами (светлая ткань)
```

Новые объекты (мебель, грядки) могут вводить **новые имена** по шаблону `mat_<category>`:
```
mat_fabric       — ткань (мебельная обивка)
mat_planter_soil — грунт (грядки)
mat_planter_wood — дерево (короб грядки)
```

Код при загрузке GLB сканирует все материалы и регистрирует найденные `mat_*` слоты
в таблице заменяемых материалов. Неизвестные имена отображаются как есть.

### 4.3. Unit-размеры модулей

Модули, которые масштабируются, моделируются в **стандартном unit-размере**:

| Модуль | Unit-размер в Blender | Масштабируемые оси |
|--------|-----------------------|--------------------|
| `wall_segment` | 1.0 × 1.0 × 0.2 м (Ш × В × Т) | X (длина), Y (высота) |
| `base_segment` | 1.0 × 1.0 × 0.2 м | X, Y |
| `cornice_segment` | 1.0 × 0.15 × 0.3 м | X (длина) |
| `gutter_segment` | 1.0 × 0.1 × 0.1 м | X |
| `fence_panel_*` | 2.0 × 1.8 × 0.05 м | X |
| `porch_step` | 1.0 × 0.17 × 0.28 м | X |
| `roof_*_slope` | 1.0 × 1.0 м (по скату) | X, Z (по скату) |

Модули **фиксированного размера** (окна, двери, дымоход, лампы) моделируются в реальных размерах.

### 4.4. UV-координаты

**Для масштабируемых модулей**: UV должны быть нормализованы на unit-размер.
Код после масштабирования **пересчитает UV** через `_applyBoxUV()`, чтобы тайлинг
текстуры был одинаковый на участках разной длины.

**Для фиксированных модулей** (окно, дверь): UV остаются как в Blender, код их не трогает.

### 4.5. Организация файлов

```
assets/
  houses/
    house_type_a.json        # Дескриптор: одноэтажный с вальмовой крышей
    house_type_b.json        # Дескриптор: одноэтажный с двускатной
    house_type_c.json        # Дескриптор: двухэтажный
  modules/
    walls/
      mod_wall_segment.glb
      mod_wall_corner_ext.glb
    windows/
      mod_window_single.glb
      mod_window_double.glb
      mod_window_wide.glb
    doors/
      mod_door_entrance.glb
      mod_door_patio.glb
    base/
      mod_base_segment.glb
      mod_base_corner.glb
    roof/
      mod_roof_gable_slope.glb
      mod_roof_gable_front.glb
      mod_roof_hip_slope.glb
      mod_roof_hip_ridge.glb
    decor/
      mod_cornice.glb
      mod_chimney.glb
      mod_gutter.glb
      mod_downpipe.glb
      mod_porch_column.glb
      mod_porch_step.glb
    site/
      mod_fence_panel_wood.glb
      mod_fence_panel_metal.glb
      mod_fence_post.glb
      mod_bench_a.glb
      mod_planter_a.glb
      mod_lamp_a.glb
      mod_lamp_b.glb
  vegetation/
    bush_a.glb
    bush_b.glb
    tree_a.glb
    tree_b.glb
  textures/
    wall_diff.jpg   # fallback текстуры (если процедурный режим)
    wall_norm.jpg
    roof_diff.jpg
    ...
  environment.hdr
```

---

## 5. Алгоритм сборки дома (код)

### 5.1. Загрузка

```javascript
// При старте: загружаем дескриптор + все модули одним Promise.all
async function loadHouseType(typeId) {
  const desc = await fetch(`assets/houses/${typeId}.json`).then(r => r.json());

  // Собираем список уникальных модулей из дескриптора
  const moduleIds = extractModuleIds(desc);

  // Загружаем все GLB параллельно
  const modules = {};
  await Promise.all(moduleIds.map(id =>
    loadGLB(`assets/modules/${moduleCategory(id)}/${id}.glb`)
      .then(gltf => { modules[id] = gltf.scene; })
  ));

  return { desc, modules };
}
```

### 5.2. Сборка

```javascript
function buildHouseFromDescriptor(desc, modules, params) {
  // params: { floors: [{ area, floorH }, ...], baseH } — из UI, уже валидированы

  const wt = desc.constraints.wall_thickness;
  const baseH = params.baseH / 100;
  const group = new THREE.Group();

  // 1. Этажи — снизу вверх
  let yOffset = baseH;
  const floorOutlines = []; // [{outline, wallH, yBase}]

  for (let fi = 0; fi < desc.floors.length; fi++) {
    const floorDef = desc.floors[fi];
    const fp = params.floors[fi];
    const wallH = fp.floorH / 100;

    // Вычисляем переменные: area → L, W, wing, arm и т.д.
    const vars = evalVars(floorDef.vars, { area: fp.area });

    // Вычисляем контур из perimeter
    const outline = computeOutline(floorDef.perimeter, vars);

    // Межэтажное перекрытие (кроме первого этажа)
    if (fi > 0) {
      buildSlab(group, modules, outline, yOffset, wt);
      yOffset += 0.2;
    }

    // 2. Фундамент (только для первого этажа — по контуру)
    if (fi === 0) {
      buildBaseFromOutline(group, modules, outline, baseH, wt);
    }

    // 3. Стены этажа — обходим контур, строим каждое ребро
    outline.forEach((edge, ei) => {
      buildEdgeWall(group, modules, edge, wallH, yOffset, wt, fi, ei);
      // edge.facade определяет содержимое стены
      // Каждый wall-сегмент получает ID: floor_{fi}_edge_{ei}_seg_{si}
    });

    floorOutlines.push({ outline, wallH, yBase: yOffset });
    yOffset += wallH;
  }

  // 4. Крыша (по контуру верхнего этажа)
  const top = floorOutlines[floorOutlines.length - 1];
  buildRoofFromOutline(group, modules, desc.roof_type, top.outline,
                       top.yBase + top.wallH, desc.constraints.roof_angle);

  // 5. Декор (карнизы, водостоки, дымоход)
  buildDecor(group, modules, desc.features, floorOutlines);

  // 6. Назначение зон материалов (из S.wallZones)
  applyWallZones(group);

  return group;
}

// Строит стену одного ребра контура
function buildEdgeWall(group, modules, edge, wallH, yOffset, wt, floorIdx, edgeIdx) {
  const { x, z, length, dx, dz, facade } = edge;

  // Вычисляем fill-длины
  const fills = resolveFills(facade, length);
  // fills = [{ type, width, model? }, ...] — все элементы с реальными ширинами

  let cursor = 0; // позиция вдоль ребра
  fills.forEach((el, si) => {
    const wx = x + dx * cursor;
    const wz = z + dz * cursor;
    const segId = `floor_${floorIdx}_edge_${edgeIdx}_seg_${si}`;

    if (el.type === 'wall') {
      // Масштабированный wall_segment
      const seg = cloneModule(modules, 'wall_segment');
      seg.scale.x = el.width;
      seg.scale.y = wallH;
      seg.position.set(wx, yOffset, wz);
      seg.rotation.y = Math.atan2(dx, dz);
      seg.userData.segId = segId;
      _applyBoxUV(seg, 2.0); // пересчёт UV после масштабирования
      group.add(seg);
    }
    else if (el.type === 'window' || el.type === 'door') {
      // Фиксированный модуль (окно/дверь) + заполнение стены вокруг
      const mod = cloneModule(modules, el.model);
      const cx = wx + dx * el.width / 2;
      const cz = wz + dz * el.width / 2;
      mod.position.set(cx, yOffset, cz);
      mod.rotation.y = Math.atan2(dx, dz);
      group.add(mod);
    }

    cursor += el.width;
  });
}
```

### 5.3. Замена материалов

**Глобальная замена** — применяет материал ко всем мешам с данным слотом:

```javascript
function applyMaterialOverride(houseGroup, slot, newProps) {
  // slot: "mat_wall", "mat_roof" и т.д.
  // newProps: { color, map, normalMap, roughness, ... }

  houseGroup.traverse(child => {
    if (!child.isMesh) return;
    if (child.material.name === slot) {
      if (!child._originalMaterial) {
        child._originalMaterial = child.material;
        child.material = child.material.clone();
      }
      Object.assign(child.material, newProps);
      child.material.needsUpdate = true;
    }
  });
}
```

### 5.4. Зоны материалов стен (локальная облицовка)

Каждый wall_segment при сборке получает `userData.segId`:

```javascript
// При сборке стены:
mesh.userData.segId = `floor_${floorIdx}_${side}_seg_${segIdx}`;
// Примеры: "floor_0_front_seg_0", "floor_0_front_seg_2", "floor_1_left_seg_1"
```

**Применение зон:**

```javascript
function applyWallZones(houseGroup) {
  // S.wallZones: { "floor_0_front_seg_0": "mat_wood", ... }
  if (!S.wallZones) return;

  houseGroup.traverse(child => {
    if (!child.isMesh || !child.userData.segId) return;
    const zone = S.wallZones[child.userData.segId];
    if (!zone || zone === child.material.name) return;

    // Заменяем материал этого конкретного сегмента
    const newMat = getMaterialBySlot(zone); // из каталога/кэша
    if (!child._originalMaterial) child._originalMaterial = child.material;
    child.material = newMat.clone();
  });
}
```

**Интерактивный выбор зон (шаг UI «Отделка фасада»):**

```javascript
// Raycaster при движении мыши
function onMouseMoveWallPick(event) {
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(wallSegments);

  // Сбрасываем подсветку с предыдущего
  if (hoveredSeg && hoveredSeg !== selectedSeg) {
    hoveredSeg.material.emissive.set(0x000000);
  }

  if (hits.length > 0) {
    hoveredSeg = hits[0].object;
    if (hoveredSeg !== selectedSeg) {
      hoveredSeg.material.emissive.set(0x222222); // лёгкая подсветка
    }
  } else {
    hoveredSeg = null;
  }
}

function onClickWallPick(event) {
  if (!hoveredSeg) return;

  if (event.ctrlKey) {
    // Мультивыбор
    toggleSelection(hoveredSeg);
  } else {
    // Одиночный выбор
    clearSelection();
    selectSegment(hoveredSeg);
  }
}

function selectSegment(mesh) {
  mesh.material.emissive.set(0x1a5276); // синяя подсветка
  selectedSegments.add(mesh);
}

function applyMaterialToSelected(matSlot) {
  for (const seg of selectedSegments) {
    S.wallZones[seg.userData.segId] = matSlot;
  }
  applyWallZones(houseGroup);
  clearSelection();
}
```

---

## 6. Связь с текущим кодом

### 6.1. Что меняется

| Компонент | Сейчас | После |
|-----------|--------|-------|
| `buildHouseMeshes()` | Процедурная геометрия (BoxGeometry) | `buildHouseFromDescriptor()` — сборка из GLB |
| `getHouseMats()` | Создаёт MeshStandardMaterial руками | Берёт материалы из GLB, переопределяет через `applyMaterialOverride()` |
| `_applyBoxUV()` | Всегда для всех стен | Только для масштабированных модулей `wall_segment`, `base_segment` |
| `state.js: S.houseType` | Строка `"Одноэтажный дом"` | ID дескриптора `"type_a"` |
| Шаги 1–3 в UI | Захардкожены | Динамически из `desc.constraints` |

### 6.2. Что НЕ меняется

- `viewer3d-core.js`: инициализация сцены, HDRI, освещение, OrbitControls
- `viewer3d-mobile.js / viewer3d-desktop.js`: растительность
- `buildTerrace3d()`, `buildPorch3d()`, `buildFence3d()`, `buildRailing3d()` — отдельные конструкции (террасы, крыльцо, забор, перила — не часть дескриптора дома)
- `canvas.js`: разметка полигонов
- `nav.js`, `catalog.js` — навигация и каталог

### 6.3. Что добавляется

- **Новый шаг UI «Отделка фасада»** — интерактивный выбор зон стен + назначение материалов с подсветкой
- **`S.wallZones`** — в state.js, хранит назначения материалов по сегментам
- **`S.floors`** — массив параметров этажей `[{ area, floorH }, ...]`
- **Навес** — опция в `buildTerrace3d()` (toggle, стойки + балки + кровля)
- **Балкон** — ручная разметка на плоскости 2-го этажа в canvas.js
- **Шторы** — `PlaneGeometry` с `mat_curtain` за каждым окном

### 6.3. Fallback

Пока GLB-модули не готовы, код использует **текущий процедурный билдер** как fallback:

```javascript
if (modules && Object.keys(modules).length > 0) {
  buildHouseFromDescriptor(desc, modules, params);
} else {
  buildHouseMeshes(parent, M, houseL, houseW, wh, bh, wt); // legacy
}
```

---

## 7. Расширяемость

### 7.1. Новый тип дома
1. Создать `house_type_d.json` с описанием стен, крыши, декора
2. Если нужны новые модули — добавить GLB в `assets/modules/`
3. Добавить запись в UI (шаг 1) — конфигуратор подхватит автоматически

### 7.2. Новый тип мебели / элемента участка
1. Смоделировать GLB с именованными материалами (`mat_<category>`)
2. Положить в `assets/modules/site/`
3. Добавить в каталог (когда будет бэкенд) или в `STUB_RESULTS`
4. Код автоматически обнаружит `mat_*` материалы и покажет в палитре замены

### 7.3. Новый материал стен / крыши
1. Подготовить текстуры (diffuse, normal, roughness)
2. Добавить в каталог с привязкой к слоту `mat_wall` / `mat_roof`
3. `applyMaterialOverride()` применит к нужным мешам

---

## 8. Приоритеты реализации

| # | Задача | Зависимости |
|---|--------|-------------|
| 1 | Согласовать спецификацию (этот документ) | — |
| 2 | Создать 1 JSON-дескриптор (type_a — одноэтажный) | Согласованная спецификация |
| 3 | Смоделировать минимальный набор GLB: wall_segment, base_segment, window_single, door_entrance, roof_hip_slope | Blender, согласованные unit-размеры |
| 4 | Написать `loadHouseType()` + `buildHouseFromDescriptor()` | JSON-дескриптор + GLB готовы |
| 5 | Написать `applyMaterialOverride()` | GLB с именованными материалами |
| 6 | Интегрировать с UI (шаги 1–3, constraints из JSON) | Код загрузки готов |
| 7 | Добавить ещё 2 типа дома (type_b, type_c) | Рабочий pipeline |
| 8 | Элементы участка (забор, мебель, грядки) | Рабочий pipeline |

---

## 9. Принятые решения (бывшие открытые вопросы)

### 9.1. Вальмовая крыша — ГИБРИД ✓

Процедурная геометрия скатов (как сейчас) + GLB-модули для деталей (конёк, карниз, водосток).
Скаты строятся кодом по параметрам дескриптора, материал крыши берётся из GLB-модуля `roof_hip_slope`
(только текстура/материал, не геометрия).

### 9.2. Многоэтажность — ПОЭТАЖНЫЕ ОПРЕДЕЛЕНИЯ ✓

Этажи могут отличаться по планировке и размерам. Дескриптор содержит массив `floors[]`,
где каждый этаж задаёт свои:
- `constraints.area` и `constraints.floor_h` (площадь и высота могут отличаться)
- `proportions.ratio` (пропорции плана могут отличаться)
- `walls` (расположение окон/дверей — своё для каждого этажа)

Код собирает этажи снизу вверх, каждый на своём Y-уровне.
Межэтажное перекрытие — автоматическая плита толщиной ~0.2 м между этажами.

**Пример двухэтажного дескриптора (фрагмент `floors`):**
```json
{
  "floors": [
    {
      "id": "floor_1",
      "label": "Первый этаж",
      "constraints": {
        "area":    { "min": 50, "max": 120, "step": 5,  "default": 90 },
        "floor_h": { "min": 270, "max": 320, "step": 10, "default": 300 }
      },
      "vars": { "L": "sqrt(area * 1.6)", "W": "sqrt(area / 1.6)" },
      "perimeter": [
        { "run": "L", "facade": "auto_windows", "window_type": "single" },
        { "turn": 90 },
        { "run": "W", "facade": [
            { "wall": "fill" }, { "door": "entrance" }, { "wall": "fill" }
        ]},
        { "turn": 90 },
        { "run": "L", "facade": "auto_windows", "window_type": "single" },
        { "turn": 90 },
        { "run": "W", "facade": [
            { "wall": "fill" }, { "door": "patio" }, { "wall": "fill" }
        ]},
        { "turn": 90 }
      ]
    },
    {
      "id": "floor_2",
      "label": "Второй этаж",
      "constraints": {
        "area":    { "min": 40, "max": 100, "step": 5,  "default": 70 },
        "floor_h": { "min": 250, "max": 300, "step": 10, "default": 280 }
      },
      "vars": { "L2": "sqrt(area * 1.5)", "W2": "sqrt(area / 1.5)" },
      "perimeter": [
        { "run": "L2", "facade": "auto_windows", "window_type": "double" },
        { "turn": 90 },
        { "run": "W2", "facade": "auto_windows", "window_type": "single" },
        { "turn": 90 },
        { "run": "L2", "facade": "auto_windows", "window_type": "single" },
        { "turn": 90 },
        { "run": "W2", "facade": "auto_windows", "window_type": "single" },
        { "turn": 90 }
      ]
    }
  ]
}
```

Если второй этаж меньше первого → образуется уступ. Код автоматически центрирует
верхний этаж относительно нижнего. На уступе пользователь может вручную разметить
балкон/террасу (как отдельную конструкцию).

### 9.3. Крыльцо, террасы, навесы — ОТДЕЛЬНЫЕ КОНСТРУКЦИИ ✓

Крыльцо, террасы, перила, навесы — **не** часть дескриптора дома.
Они остаются отдельными конструкциями в конфигураторе (шаги 5–8), как сейчас:
- `buildTerrace3d()` — терраса
- `buildPorch3d()` — крыльцо
- `buildFence3d()` — забор
- `buildRailing3d()` — перила
- Навесы — опция в `buildTerrace3d()` (toggle «Навес»)

Эти конструкции используют свои GLB-модули из `assets/modules/site/`:
- `mod_porch_column.glb`, `mod_porch_step.glb` — для крыльца
- `mod_fence_panel_*.glb`, `mod_fence_post.glb` — для забора
- `mod_canopy_post.glb`, `mod_canopy_beam.glb` — для навеса террасы

Дом из дескриптора **не знает** о пристройках. Пристройки стыкуются с домом
через координаты canvas (как сейчас).

### 9.4. Локальная облицовка стен — ЗОНЫ МАТЕРИАЛОВ ✓

Деревянная облицовка входной зоны (и любая другая локальная отделка) —
это **назначение материала на конкретные сегменты стены**, а не отдельный модуль.

**Каждый `wall_segment`** получает уникальный ID при сборке:
```
front_seg_0, front_seg_1, front_seg_2, ...
back_seg_0, ...
```

**Новый шаг UI — «Отделка фасада»**:

1. Пользователь видит 3D-модель дома
2. При наведении мыши на стеновой сегмент — он **подсвечивается** (outline или цветовой overlay)
3. Клик — сегмент выбран (выделение сохраняется)
4. Пользователь выбирает материал из палитры → он применяется к выбранным сегментам
5. Можно выбрать несколько сегментов (Ctrl+клик) и применить материал разом

**Хранение в состоянии:**
```javascript
S.wallZones = {
  "front_seg_0": "mat_wood",      // дерево
  "front_seg_1": "mat_wall",      // штукатурка (по умолчанию)
  "front_seg_2": "mat_wood",      // дерево
  "left_seg_0":  "mat_stone",     // камень
  // ...
};
```

**Подсветка при наведении:**
```javascript
// Raycaster → пересечение с wall_segment мешами
// При hover: mesh.material.emissive.set(0x333333)
// При уходе: mesh.material.emissive.set(0x000000)
// При выборе: mesh.material.emissive.set(0x1a5276) (синий outline)
```

Это позволяет комбинировать на одном фасаде штукатурку, дерево, камень, металл —
в любых сочетаниях, как на референсных изображениях.

---

## 10. Принятые решения (второй раунд)

### 10.1. Навесы — часть террасы ✓

Навес не является отдельной конструкцией. Он входит в `buildTerrace3d()` как опция:
- В UI террасы добавляется toggle «Навес»
- Если включён — над настилом строятся стойки + кровельный лист
- Модули навеса: `mod_canopy_post.glb` (стойка), `mod_canopy_beam.glb` (балка)
- Кровля навеса — процедурная плоскость с материалом `mat_roof` или `mat_metal`

### 10.2. Балконы — ручная разметка ✓

Балкон на 2-м этаже размечается пользователем вручную (аналогично террасе на 1-м этаже).
Код не предлагает зону автоматически. В `canvas.js` добавляется плоскость 2-го этажа
для разметки балконов.

### 10.3. За окнами — шторы ✓

Интерьер не моделируется. За стеклом размещается плоскость со сплошными шторами:
- Плоскость `PlaneGeometry` на ~5 см за стеклом (внутрь дома)
- Материал `mat_curtain` — светлая ткань, roughness ~0.9, без прозрачности
- Закрывает вид на пустоту внутри дома
- Материал штор можно менять (опционально, через зоны или глобально)

Это устраняет необходимость в интерьерных модулях и значительно упрощает бюджет полигонов.

### 10.4. LOD не нужны ✓

Один набор GLB-модулей для обеих платформ (desktop и mobile).
Бюджет полигонов ограничен на уровне соглашений (до 5 000 треугольников на модуль),
что достаточно для мобильной производительности.

---

## 11. Все вопросы закрыты

Спецификация готова к реализации. Открытых вопросов нет.
