# HOUSE_MODULES_SPEC.md — Спецификация модульной системы 3D-домов

## Статус: ЧЕРНОВИК v2 — обновлено

### Изменения v2

- Окна и двери стали **параметрическими** (масштабируемые части в одном GLB)
- Угловые L-элементы заменены на универсальный **столб (pillar)**
- Добавлены **мансардные окна** (velux) и **слуховые окна** (dormer/люкарна)
- Двери: распашные 1/1.5/2 створки + раздвижные 1/2 створки
- Описаны соглашения по именованию дочерних объектов в GLB

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

Стена собирается из **секций** — полос фиксированной высоты, которые масштабируются по длине.
На каждом повороте периметра ставится **столб (pillar)** — универсальный угловой элемент
квадратного сечения. Стены стыкуются к граням столба.

```
       pillar                                                  pillar
        ┌──┐──────────────────────────────────────────────────┌──┐
        │██│               wall_top                           │██│
        │██├──────────────────────────────────────────────────┤██│
        │██│  wall_fill │ window │ wall_fill │ window │ fill  │██│
        │██├──────────────────────────────────────────────────┤██│
        │██│               wall_bottom                        │██│
        └──┘──────────────────────────────────────────────────└──┘
       pillar                                                  pillar
```

### 2.2. Номенклатура модулей

| ID модуля | Файл | Описание | Масштабируется | Параметрический |
|-----------|------|----------|----------------|:---:|
| **Стены** |
| `wall_segment` | `mod_wall_segment.glb` | Глухой прямоугольный участок стены (1×1×0.2 м, unit box) | X (длина), Y (высота) | — |
| `pillar` | `mod_pillar.glb` | Угловой столб (1×1×1 м, unit cube) | X, Y, Z | — |
| **Окна (параметрические)** |
| `window_single` | `mod_window_single.glb` | Одностворчатое окно (рама, стекло, подоконник, штора) | — | ✓ w, h |
| `window_double` | `mod_window_double.glb` | Двустворчатое окно (+ вертикальный импост) | — | ✓ w, h |
| `window_wide` | `mod_window_wide.glb` | Панорамное окно (+ горизонтальный и вертикальный импосты) | — | ✓ w, h |
| **Мансардные окна (параметрические)** |
| `window_velux` | `mod_window_velux.glb` | Мансардное окно в плоскости ската (рама, стекло, оклад) | — | ✓ w, h |
| `dormer` | `mod_dormer.glb` | Слуховое окно / люкарна (стенки, мини-крыша, встроенное окно) | — | ✓ w, h, depth |
| **Двери (параметрические)** |
| `door_single` | `mod_door_single.glb` | Распашная одностворчатая дверь | — | ✓ w, h |
| `door_onehalf` | `mod_door_onehalf.glb` | Распашная полуторастворчатая дверь | — | ✓ w, h |
| `door_double` | `mod_door_double.glb` | Распашная двустворчатая дверь | — | ✓ w, h |
| `door_slide_single` | `mod_door_slide_single.glb` | Раздвижная одностворчатая дверь | — | ✓ w, h |
| `door_slide_double` | `mod_door_slide_double.glb` | Раздвижная двустворчатая дверь | — | ✓ w, h |
| **Фундамент** |
| `base_segment` | `mod_base_segment.glb` | Участок цоколя (1×1×0.2 м) | X (длина), Y (высота) | — |
| `base_pillar` | `mod_base_pillar.glb` | Угловой столб цоколя (1×1×1 м) | X, Y, Z | — |
| **Крыша** |
| `roof_gable_slope` | `mod_roof_gable_slope.glb` | Скат двускатной крыши (1 м²) | X, Z (по скату) | — |
| `roof_gable_front` | `mod_roof_gable_front.glb` | Фронтон двускатной крыши | X (ширина), Y (высота) | — |
| `roof_hip_slope` | `mod_roof_hip_slope.glb` | Скат вальмовой крыши | X, Z | — |
| `roof_hip_ridge` | `mod_roof_hip_ridge.glb` | Конёк/ребро вальмовой крыши | длина | — |
| `roof_flat_edge` | `mod_roof_flat_edge.glb` | Парапет плоской крыши | X (длина) | — |
| **Декор** |
| `cornice_segment` | `mod_cornice.glb` | Карнизный свес (1 п.м.) | X (длина) | — |
| `chimney` | `mod_chimney.glb` | Дымоход | — | — |
| `gutter_segment` | `mod_gutter.glb` | Водосток (1 п.м.) | X | — |
| `downpipe` | `mod_downpipe.glb` | Водосточная труба | Y (высота) | — |
| `porch_column` | `mod_porch_column.glb` | Колонна крыльца | Y (высота) | — |
| `porch_step` | `mod_porch_step.glb` | Ступень крыльца | X (ширина) | — |
| **Участок (отдельная номенклатура)** |
| `fence_panel_*` | `mod_fence_panel_wood.glb` и т.д. | Секция забора | X (ширина) | — |
| `fence_post` | `mod_fence_post.glb` | Столб забора | Y (высота) | — |
| `bench_*` | `mod_bench_a.glb` | Скамейка | — | — |
| `planter_*` | `mod_planter_a.glb` | Грядка / клумба | X, Z | — |
| `lamp_*` | `mod_lamp_a.glb` | Садовый фонарь | — | — |

### 2.3. Принцип масштабирования простых модулей

Каждый масштабируемый GLB-модуль моделируется как **unit-элемент** в стандартном размере.
Код масштабирует его по нужной оси:

```
wall_segment.glb: 1m × 1m × 0.2m (ширина × высота × толщина)
  → scale.x = нужная_длина / 1.0
  → scale.y = нужная_высота / 1.0
  → scale.z = 1.0 (толщина стены фиксирована)

pillar.glb: 1m × 1m × 1m (unit cube)
  → scale.x = pillar_size (= wall_thickness, обычно 0.20)
  → scale.y = wall_height
  → scale.z = pillar_size
```

**Важно для моделирования**: текстуры должны быть настроены на **world-space tiling**
(или код пересчитает UV после масштабирования). Это позволяет тайлить текстуру
штукатурки одинаково на участках стены разной длины.

### 2.4. Параметрические модули — принцип сборки из частей

Окна, двери и слуховые окна — **параметрические**: код изменяет положение и масштаб
их дочерних объектов для достижения нужного размера. Все части одного модуля находятся
в **одном GLB-файле** как дочерние объекты корневого узла.

Модель в Blender делается в **дефолтном** размере (например, окно 0.90 × 1.20 м).
Код при сборке считывает целевые `w` и `h` из дескриптора и трансформирует дочерние
объекты по правилам, описанным в разделе 2.5.

### 2.5. Соглашения по именованию дочерних объектов в GLB

Код ищет дочерние объекты по точным именам. Ниже — полный перечень для каждого типа модуля.

#### Окно (`window_single`, `window_double`, `window_wide`)

```
mod_window_single.glb:
├── frame_left      — левая стойка рамы (профиль фиксированного сечения)
├── frame_right     — правая стойка рамы
├── frame_top       — верхняя перекладина рамы
├── frame_bottom    — нижняя перекладина рамы
├── sill            — подоконник (внутренний свес)
├── glass           — стекло (плоскость)
└── curtain         — штора (плоскость за рамой)

mod_window_double.glb (дополнительно):
├── mullion_v       — вертикальный импост (разделитель створок)
└── (остальные — как у single)

mod_window_wide.glb (дополнительно):
├── mullion_v       — вертикальный импост
├── mullion_h       — горизонтальный импост
└── (остальные — как у single)
```

**Алгоритм трансформации окна** (целевые размеры: `w`, `h`):

```javascript
// frameW — ширина профиля рамы (из дескриптора: frame_profile, обычно 0.05 м)
// sillOH — свес подоконника за раму (из дескриптора: sill_overhang, обычно 0.03 м)

frame_left:   position.x = 0;           scale.y = h;
frame_right:  position.x = w;           scale.y = h;
frame_top:    position.y = h;           scale.x = w;
frame_bottom: position.y = 0;           scale.x = w;
sill:         position.y = 0;           scale.x = w + sillOH * 2;
glass:        position.set(w/2, h/2);   scale.x = w - frameW*2;  scale.y = h - frameW*2;
curtain:      position.set(w/2, h/2);   scale.x = w;             scale.y = h;

// Для double — импост по центру:
mullion_v:    position.x = w / 2;       scale.y = h;

// Для wide — крестообразный импост:
mullion_v:    position.x = w / 2;       scale.y = h;
mullion_h:    position.y = h / 2;       scale.x = w;
```

Рама (`frame_*`) — профиль фиксированного сечения (например, 50 мм), масштабируется
только по длине. Стекло и штора — плоскости, масштабируются по обеим осям.

#### Дверь (все типы: `door_single`, `door_onehalf`, `door_double`, `door_slide_*`)

```
mod_door_single.glb:
├── frame_left      — левая стойка дверной коробки
├── frame_right     — правая стойка
├── frame_top       — верхняя перекладина
├── threshold       — порог
├── leaf_main       — основное полотно двери
└── handle          — ручка (фиксированный размер)

mod_door_onehalf.glb (дополнительно):
├── leaf_minor      — малая (неподвижная) створка
└── (остальные — как у single)

mod_door_double.glb (дополнительно):
├── leaf_minor      — вторая створка
└── (остальные — как у single)

mod_door_slide_single.glb:
├── frame_left
├── frame_right
├── frame_top
├── rail_top        — верхний направляющий рельс
├── rail_bottom     — нижний направляющий рельс (или утопленная направляющая)
├── leaf_main       — сдвижная панель (стекло или глухая)
└── handle

mod_door_slide_double.glb (дополнительно):
├── leaf_minor      — вторая сдвижная панель
└── (остальные — как у slide_single)
```

**Алгоритм трансформации двери** (целевые размеры: `w`, `h`):

```javascript
frame_left:   position.x = 0;           scale.y = h;
frame_right:  position.x = w;           scale.y = h;
frame_top:    position.y = h;           scale.x = w;
threshold:    position.y = 0;           scale.x = w;
leaf_main:    scale.x = leafW;          scale.y = h;
              // leafW зависит от типа:
              //   single:   w - frameW*2
              //   onehalf:  (w - frameW*2) * 0.67
              //   double:   (w - frameW*2) / 2
              //   slide_*:  w / leaves
leaf_minor:   scale.x = minorW;         scale.y = h;
              // onehalf:  (w - frameW*2) * 0.33
              // double:   (w - frameW*2) / 2
              // slide_double: w / 2
handle:       // только репозиционируется, не масштабируется
```

#### Мансардное окно (`window_velux`)

```
mod_window_velux.glb:
├── frame_left      — левая стойка
├── frame_right     — правая стойка
├── frame_top       — верхняя перекладина
├── frame_bottom    — нижняя перекладина
├── glass           — стекло
└── flashing        — оклад (гидроизоляционная рамка вокруг окна)
```

Трансформация — как у обычного окна. Модуль размещается **в плоскости ската крыши**,
код вычисляет позицию и поворот по параметрам из `roof_windows` дескриптора.

При установке velux код **вырезает прямоугольник** в геометрии ската и вставляет модуль.

#### Слуховое окно / люкарна (`dormer`)

```
mod_dormer.glb:
├── wall_front      — передняя стенка (масштабируется по w и h)
├── wall_left       — левая боковая щека (масштабируется по depth и h)
├── wall_right      — правая боковая щека
├── roof_left       — левый мини-скат (масштабируется по w и depth)
├── roof_right      — правый мини-скат
├── cornice         — мини-карниз (опционально)
└── window/         — встроенное окно (параметрическое, структура как у window_single)
    ├── frame_left
    ├── frame_right
    ├── frame_top
    ├── frame_bottom
    ├── glass
    └── sill
```

**Параметры dormer**: `w` (ширина фронта), `h` (высота стенки), `depth` (глубина выступа от ската).

```javascript
wall_front:   scale.x = w;         scale.y = h;
wall_left:    scale.z = depth;     scale.y = h;    position.x = 0;
wall_right:   scale.z = depth;     scale.y = h;    position.x = w;
roof_left:    scale.x = w / 2;    scale.z = depth;
roof_right:   scale.x = w / 2;    scale.z = depth;
// Встроенное окно трансформируется по тому же алгоритму, что обычное окно
```

При установке dormer код **вырезает область** в геометрии ската, размещает модуль
в вычисленной позиции и ориентирует фронт наружу.

---

## 3. JSON-дескриптор типа дома (house descriptor)

### 3.1. Концепция планировки — обход периметра

Планировка этажа задаётся как **обход периметра по часовой стрелке** от левого верхнего
угла (на плане: min X, min Z). Это подход «turtle graphics»:

- Стартуем в точке `[0, 0]`, смотрим **вправо** (направление +X)
- Команда `run` — двигаемся в текущем направлении, рисуя стену заданной длины
- Команда `turn` — поворачиваемся (положительный = по часовой, отрицательный = против)
- Каждый `run` содержит описание **фасада** (что находится на этом отрезке стены)
- Каждый `turn` автоматически ставит **столб (pillar)** в текущей точке

Контур должен быть **замкнутым** — конечная точка совпадает с начальной.

### 3.2. Столбы вместо L-углов

На каждый `turn` (любого знака) ставится один `pillar` в текущей точке.
Столб — кубоид квадратного сечения (`pillar_size × pillar_size`), высотой в стену.

```
Вид сверху:

    стена A          стена B
  ──────────┐  ┌──────────
            │██│
            │██│  ← pillar (0.20 × 0.20)
            └──┘
```

- Столб **универсален** — не нужно различать внешние и внутренние углы
- Длина стены уменьшается на `pillar_size / 2` с каждого конца:
  `effective_wall_length = run_length - pillar_size`
- Это автоматически учитывается в расчёте `fill`

### 3.3. Параметрические переменные

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
и входные параметры (`area`).

### 3.4. Формат дескриптора

Полное описание формата — в файле `HOUSE_DESCRIPTOR_FORMAT.md`.

### 3.5. Правила фасада (`facade`)

Каждый `run` содержит массив `facade` — описание того, что расположено на стене
слева направо (по ходу движения):

| Элемент | Формат | Описание |
|---------|--------|----------|
| `{ "wall": 2.0 }` | Число (метры) | Глухой участок стены фиксированной длины |
| `{ "wall": "fill" }` | `"fill"` | Заполнитель — делит оставшееся место поровну между всеми `fill` в этом run |
| `{ "window": "single" }` | ID модуля | Окно (размеры из `modules` дескриптора) |
| `{ "window": "single", "w": 1.10, "h": 1.40 }` | с переопределением | Окно с нестандартными размерами |
| `{ "window": "single", "y": 1.2 }` | с переопределением y | Окно с нестандартной высотой подоконника |
| `{ "door": "single" }` | ID модуля | Дверь (размеры из `modules` дескриптора) |
| `{ "door": "single", "w": 0.80 }` | с переопределением | Дверь с нестандартной шириной |

**Размеры окон и дверей** берутся из секции `modules` дескриптора (значения `default`).
Любой параметр (`w`, `h`, `y`) можно переопределить прямо в элементе фасада.

**Алгоритм расчёта `fill`:**
```
totalRun  = вычисленная длина run (из vars) - pillar_size  // стена между столбами
fixedLen  = сумма длин всех фиксированных wall + ширин всех окон/дверей
fillCount = количество элементов "fill"
eachFill  = (totalRun - fixedLen) / fillCount
```

Если `eachFill < 0.1` — ошибка в дескрипторе (элементы не помещаются).

### 3.6. Автоматическое размещение окон

Вместо ручного перечисления окон можно использовать `"facade": "auto_windows"`:

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
effectiveLen = runLength - pillar_size
winW = modules[window_type].w.default
winCount = floor(effectiveLen / (winW + min_margin * 2))
margin   = (effectiveLen - winCount * winW) / (winCount + 1)
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
function computeOutline(perimeter, vars, pillarSize) {
  const points = [];
  let x = 0, z = 0;
  let dx = 1, dz = 0; // начальное направление: вправо (+X)

  for (const cmd of perimeter) {
    if (cmd.turn !== undefined) {
      // Ставим столб в текущей точке
      points.push({ type: 'pillar', x, z });

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
      points.push({
        type: 'wall', x, z,
        length: len,            // полная длина run
        wallLength: len - pillarSize,  // длина стены между столбами
        dx, dz,
        facade: cmd.facade
      });
      x += dx * len;
      z += dz * len;
    }
  }

  // Проверка замкнутости
  if (Math.abs(x) > 0.01 || Math.abs(z) > 0.01) {
    console.warn('Контур не замкнут! Δx:', x, 'Δz:', z);
  }

  return points; // массив рёбер (wall) и столбов (pillar)
}
```

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
mat_flashing     — оклад мансардного окна (металл, обычно = mat_metal)
```

Новые объекты (мебель, грядки) могут вводить **новые имена** по шаблону `mat_<category>`:
```
mat_fabric       — ткань (мебельная обивка)
mat_planter_soil — грунт (грядки)
mat_planter_wood — дерево (короб грядки)
```

Код при загрузке GLB сканирует все материалы и регистрирует найденные `mat_*` слоты
в таблице заменяемых материалов. Неизвестные имена отображаются как есть.

### 4.3. Именование дочерних объектов в Blender

Для **параметрических модулей** (окна, двери, dormer) дочерние объекты **должны**
иметь точные имена — код ищет их для трансформации:

| Имя объекта | Используется в | Назначение |
|-------------|---------------|------------|
| `frame_left` | окна, двери | Левая стойка рамы/коробки |
| `frame_right` | окна, двери | Правая стойка рамы/коробки |
| `frame_top` | окна, двери | Верхняя перекладина |
| `frame_bottom` | окна | Нижняя перекладина |
| `sill` | окна | Подоконник |
| `glass` | окна, velux | Стекло |
| `curtain` | окна | Штора |
| `mullion_v` | window_double, window_wide | Вертикальный импост |
| `mullion_h` | window_wide | Горизонтальный импост |
| `threshold` | двери | Порог |
| `leaf_main` | двери | Основное полотно двери |
| `leaf_minor` | door_onehalf, door_double, door_slide_double | Малая/вторая створка |
| `handle` | двери | Ручка (не масштабируется, только репозиционируется) |
| `rail_top` | door_slide_* | Верхняя направляющая |
| `rail_bottom` | door_slide_* | Нижняя направляющая |
| `flashing` | window_velux | Оклад (гидроизоляционная рамка) |
| `wall_front` | dormer | Передняя стенка люкарны |
| `wall_left` | dormer | Левая боковая щека |
| `wall_right` | dormer | Правая боковая щека |
| `roof_left` | dormer | Левый мини-скат |
| `roof_right` | dormer | Правый мини-скат |
| `cornice` | dormer | Мини-карниз (опционально) |
| `window` | dormer | Группа-контейнер встроенного окна (внутри — `frame_*`, `glass`, `sill`) |

### 4.4. Unit-размеры модулей

Масштабируемые модули моделируются в **стандартном unit-размере**:

| Модуль | Unit-размер в Blender | Масштабируемые оси |
|--------|-----------------------|--------------------|
| `wall_segment` | 1.0 × 1.0 × 0.2 м (Ш × В × Т) | X (длина), Y (высота) |
| `pillar` | 1.0 × 1.0 × 1.0 м | X, Y, Z |
| `base_segment` | 1.0 × 1.0 × 0.2 м | X, Y |
| `base_pillar` | 1.0 × 1.0 × 1.0 м | X, Y, Z |
| `cornice_segment` | 1.0 × 0.15 × 0.3 м | X (длина) |
| `gutter_segment` | 1.0 × 0.1 × 0.1 м | X |
| `fence_panel_*` | 2.0 × 1.8 × 0.05 м | X |
| `porch_step` | 1.0 × 0.17 × 0.28 м | X |
| `roof_*_slope` | 1.0 × 1.0 м (по скату) | X, Z (по скату) |

Параметрические модули (окна, двери, dormer) моделируются в **дефолтном реальном размере**
из секции `modules` дескриптора. Код трансформирует их дочерние объекты для достижения
целевого размера.

### 4.5. UV-координаты

**Для масштабируемых модулей**: UV должны быть нормализованы на unit-размер.
Код после масштабирования **пересчитает UV** через `_applyBoxUV()`, чтобы тайлинг
текстуры был одинаковый на участках разной длины.

**Для параметрических модулей** (окна, двери, dormer): UV остаются как в Blender
для декоративных частей (рамы, ручки). Для масштабируемых частей (стекло, полотно двери,
стенки dormer) UV пересчитываются кодом.

### 4.6. Организация файлов

```
assets/
  houses/
    house_type_a.json        # Дескриптор: одноэтажный с вальмовой крышей
    house_type_b.json        # Дескриптор: одноэтажный с двускатной
    house_type_c.json        # Дескриптор: двухэтажный
  modules/
    walls/
      mod_wall_segment.glb
      mod_pillar.glb
    windows/
      mod_window_single.glb
      mod_window_double.glb
      mod_window_wide.glb
      mod_window_velux.glb
      mod_dormer.glb
    doors/
      mod_door_single.glb
      mod_door_onehalf.glb
      mod_door_double.glb
      mod_door_slide_single.glb
      mod_door_slide_double.glb
    base/
      mod_base_segment.glb
      mod_base_pillar.glb
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
  const ps = desc.constraints.pillar_size || wt;  // сечение столба
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

    // Мерж модулей: корневые + modules_override этажа
    const floorModules = mergeModules(desc.modules, floorDef.modules_override);

    // Вычисляем контур из perimeter
    const outline = computeOutline(floorDef.perimeter, vars, ps);

    // Межэтажное перекрытие (кроме первого этажа)
    if (fi > 0) {
      buildSlab(group, modules, outline, yOffset, wt);
      yOffset += 0.2;
    }

    // 2. Фундамент (только для первого этажа — по контуру)
    if (fi === 0) {
      buildBaseFromOutline(group, modules, outline, baseH, wt, ps);
    }

    // 3. Столбы и стены этажа
    outline.forEach((item, idx) => {
      if (item.type === 'pillar') {
        buildPillar(group, modules, item, wallH, yOffset, ps);
      } else if (item.type === 'wall') {
        buildEdgeWall(group, modules, floorModules, item, wallH, yOffset, wt, ps, fi, idx);
      }
    });

    floorOutlines.push({ outline, wallH, yBase: yOffset });
    yOffset += wallH;
  }

  // 4. Крыша (по контуру верхнего этажа)
  const top = floorOutlines[floorOutlines.length - 1];
  buildRoofFromOutline(group, modules, desc.roof_type, top.outline,
                       top.yBase + top.wallH, desc.constraints.roof_angle);

  // 5. Мансардные / слуховые окна (если есть)
  if (desc.roof_windows) {
    buildRoofWindows(group, modules, desc.roof_windows, desc.modules, top);
  }

  // 6. Декор (карнизы, водостоки, дымоход)
  buildDecor(group, modules, desc.features, floorOutlines);

  // 7. Назначение зон материалов (из S.wallZones)
  applyWallZones(group);

  return group;
}

// Ставит столб в точке поворота
function buildPillar(group, modules, pillarItem, wallH, yOffset, ps) {
  const seg = cloneModule(modules, 'pillar');
  seg.scale.set(ps, wallH, ps);
  // Столб центрируется на точке поворота
  seg.position.set(pillarItem.x - ps/2, yOffset, pillarItem.z - ps/2);
  _applyBoxUV(seg, 2.0);
  group.add(seg);
}

// Строит стену одного ребра контура
function buildEdgeWall(group, modules, floorModules, edge, wallH, yOffset, wt, ps, floorIdx, edgeIdx) {
  const { x, z, wallLength, dx, dz, facade } = edge;

  // Стена начинается от грани столба (смещение на ps/2 от точки turn)
  const startX = x + dx * ps / 2;
  const startZ = z + dz * ps / 2;

  // Вычисляем fill-длины (используем wallLength, а не полный run)
  const fills = resolveFills(facade, wallLength, floorModules);
  // fills = [{ type, width, model?, params? }, ...]

  let cursor = 0;
  fills.forEach((el, si) => {
    const wx = startX + dx * cursor;
    const wz = startZ + dz * cursor;
    const segId = `floor_${floorIdx}_edge_${edgeIdx}_seg_${si}`;

    if (el.type === 'wall') {
      // Масштабированный wall_segment
      const seg = cloneModule(modules, 'wall_segment');
      seg.scale.x = el.width;
      seg.scale.y = wallH;
      seg.position.set(wx, yOffset, wz);
      seg.rotation.y = Math.atan2(dx, dz);
      seg.userData.segId = segId;
      _applyBoxUV(seg, 2.0);
      group.add(seg);
    }
    else if (el.type === 'window' || el.type === 'door') {
      // Параметрический модуль — клонируем и трансформируем дочерние объекты
      const mod = cloneModule(modules, el.model);
      transformParametricModule(mod, el.params); // w, h, frame_profile, ...
      const cx = wx + dx * el.width / 2;
      const cz = wz + dz * el.width / 2;
      mod.position.set(cx, yOffset + (el.params.y || 0), cz);
      mod.rotation.y = Math.atan2(dx, dz);
      group.add(mod);

      // Стена над/под окном (wall_segment масштабированный)
      buildWallAroundOpening(group, modules, el, wallH, wx, wz, yOffset, dx, dz, segId);
    }

    cursor += el.width;
  });
}

// Трансформирует дочерние объекты параметрического модуля
function transformParametricModule(moduleGroup, params) {
  const { w, h, frame_profile: fp, sill_overhang: so } = params;

  moduleGroup.traverse(child => {
    if (!child.isMesh) return;
    switch (child.name) {
      case 'frame_left':   child.position.x = 0;    child.scale.y = h; break;
      case 'frame_right':  child.position.x = w;    child.scale.y = h; break;
      case 'frame_top':    child.position.y = h;    child.scale.x = w; break;
      case 'frame_bottom': child.position.y = 0;    child.scale.x = w; break;
      case 'sill':         child.position.y = 0;    child.scale.x = w + (so||0)*2; break;
      case 'glass':
        child.position.set(w/2, h/2, child.position.z);
        child.scale.set(w - fp*2, h - fp*2, 1);
        break;
      case 'curtain':
        child.position.set(w/2, h/2, child.position.z);
        child.scale.set(w, h, 1);
        break;
      case 'mullion_v':    child.position.x = w/2;  child.scale.y = h; break;
      case 'mullion_h':    child.position.y = h/2;  child.scale.x = w; break;
      case 'threshold':    child.scale.x = w; break;
      case 'leaf_main':    child.scale.set(params.leafW, h, 1); break;
      case 'leaf_minor':   child.scale.set(params.minorW, h, 1); break;
      case 'handle':       child.position.x = params.handleX; break;
      // dormer-специфичные — аналогично
    }
  });
}
```

### 5.3. Сборка мансардных / слуховых окон

```javascript
function buildRoofWindows(group, modules, roofWindows, moduleDefs, topFloor) {
  for (const rw of roofWindows) {
    // 1. Вычисляем 3D-позицию на скате
    const pos = computeRoofPosition(rw.slope, rw.position_along, rw.position_up, topFloor);

    // 2. Клонируем модуль
    const mod = cloneModule(modules, rw.module);

    // 3. Трансформируем по параметрам
    if (rw.module === 'window_velux') {
      transformParametricModule(mod, {
        w: rw.w, h: rw.h,
        frame_profile: moduleDefs.window_velux.frame_profile
      });
    } else if (rw.module === 'dormer') {
      transformDormer(mod, {
        w: rw.w, h: rw.h, depth: rw.depth,
        window: rw.window  // параметры встроенного окна
      });
    }

    // 4. Позиционируем и ориентируем на скате
    mod.position.copy(pos.origin);
    mod.quaternion.copy(pos.rotation);
    group.add(mod);

    // 5. Вырезаем отверстие в геометрии ската
    cutRoofOpening(group, pos, rw);
  }
}
```

### 5.4. Замена материалов

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

### 5.5. Зоны материалов стен (локальная облицовка)

Каждый wall_segment при сборке получает `userData.segId`:

```javascript
// При сборке стены:
mesh.userData.segId = `floor_${floorIdx}_edge_${edgeIdx}_seg_${segIdx}`;
// Примеры: "floor_0_edge_0_seg_0", "floor_0_edge_2_seg_1", "floor_1_edge_1_seg_0"
```

**Применение зон:**

```javascript
function applyWallZones(houseGroup) {
  // S.wallZones: { "floor_0_edge_0_seg_0": "mat_wood", ... }
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
| `_applyBoxUV()` | Всегда для всех стен | Только для масштабированных модулей `wall_segment`, `base_segment`, `pillar` |
| `state.js: S.houseType` | Строка `"Одноэтажный дом"` | ID дескриптора `"type_a"` |
| Шаги 1–3 в UI | Захардкожены | Динамически из `desc.constraints` |
| Угловые элементы | `wall_corner_ext` + `wall_corner_int` | Единый `pillar` |
| Окна/двери | Фиксированные GLB | Параметрические GLB (трансформация дочерних объектов) |

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
- **`transformParametricModule()`** — универсальная функция трансформации параметрических модулей
- **`buildRoofWindows()`** — сборка мансардных и слуховых окон
- **Навес** — опция в `buildTerrace3d()` (toggle, стойки + балки + кровля)
- **Балкон** — ручная разметка на плоскости 2-го этажа в canvas.js
- **Шторы** — `curtain` внутри параметрического GLB окна

### 6.4. Fallback

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

### 7.2. Новый тип окна
1. Смоделировать GLB с именованными дочерними объектами (`frame_*`, `glass`, `sill` и т.д.)
2. Положить в `assets/modules/windows/`
3. Добавить запись в `modules` дескриптора с диапазонами `w`, `h`, `y`
4. Код автоматически подхватит через `transformParametricModule()`

### 7.3. Новый тип двери
1. Смоделировать GLB с именованными дочерними объектами (`frame_*`, `leaf_*`, `handle` и т.д.)
2. Положить в `assets/modules/doors/`
3. Добавить запись в `modules` дескриптора
4. Указать `leaves` и `mechanism`

### 7.4. Новый тип мебели / элемента участка
1. Смоделировать GLB с именованными материалами (`mat_<category>`)
2. Положить в `assets/modules/site/`
3. Добавить в каталог (когда будет бэкенд) или в `STUB_RESULTS`
4. Код автоматически обнаружит `mat_*` материалы и покажет в палитре замены

### 7.5. Новый материал стен / крыши
1. Подготовить текстуры (diffuse, normal, roughness)
2. Добавить в каталог с привязкой к слоту `mat_wall` / `mat_roof`
3. `applyMaterialOverride()` применит к нужным мешам

---

## 8. Приоритеты реализации

| # | Задача | Зависимости |
|---|--------|-------------|
| 1 | Согласовать спецификацию (этот документ) | — |
| 2 | Создать 1 JSON-дескриптор (type_a — одноэтажный) | Согласованная спецификация |
| 3 | Смоделировать минимальный набор GLB: wall_segment, pillar, base_segment, window_single (параметрический), door_single (параметрический), roof_hip_slope | Blender, согласованные соглашения по именам |
| 4 | Написать `loadHouseType()` + `buildHouseFromDescriptor()` + `transformParametricModule()` | JSON-дескриптор + GLB готовы |
| 5 | Написать `applyMaterialOverride()` | GLB с именованными материалами |
| 6 | Интегрировать с UI (шаги 1–3, constraints из JSON) | Код загрузки готов |
| 7 | Добавить ещё типы окон/дверей (double, wide, onehalf, slide) | Рабочий pipeline |
| 8 | Реализовать мансардные/слуховые окна (velux, dormer) | Рабочий pipeline + крыша |
| 9 | Добавить ещё 2 типа дома (type_b, type_c) | Рабочий pipeline |
| 10 | Элементы участка (забор, мебель, грядки) | Рабочий pipeline |

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
- `vars` (пропорции плана могут отличаться)
- `perimeter` (расположение окон/дверей — своё для каждого этажа)
- `modules_override` (переопределение размеров окон/дверей для этажа)

Код собирает этажи снизу вверх, каждый на своём Y-уровне.
Межэтажное перекрытие — автоматическая плита толщиной ~0.2 м между этажами.

Если второй этаж меньше первого → образуется уступ. Код автоматически центрирует
верхний этаж относительно нижнего. На уступе пользователь может вручную разметить
балкон/террасу (как отдельную конструкцию).

### 9.3. Углы — СТОЛБЫ (PILLAR) ✓

Угловые L-элементы (`wall_corner_ext`, `wall_corner_int`) заменены универсальным
столбом квадратного сечения (`pillar`). Столб ставится в каждой точке поворота,
независимо от направления поворота (внешний/внутренний — без разницы).

Стена идёт от грани одного столба до грани следующего.
Эффективная длина стены = `run_length - pillar_size`.

### 9.4. Окна и двери — ПАРАМЕТРИЧЕСКИЕ ✓

Окна и двери — не фиксированные GLB, а параметрические сборки из именованных
дочерних объектов в одном GLB-файле. Код трансформирует части (рамы, стекло,
подоконник, полотно, ручку) для достижения целевого размера.

Размеры задаются как диапазоны (`min`/`max`/`default`) в секции `modules` дескриптора.
Конкретный размер можно переопределить:
- На уровне этажа (`modules_override`)
- На уровне конкретного элемента фасада (`{ "window": "single", "w": 1.10, "h": 1.40 }`)

### 9.5. Мансардные окна — ПАРАМЕТРИЧЕСКИЕ ✓

Два типа:
- **Velux** — мансардное окно в плоскости ската. Параметрическое (w, h).
  Код вырезает прямоугольник в скате и вставляет модуль.
- **Dormer** (люкарна) — слуховое окно, выступающее из ската.
  Параметрическое (w, h, depth). Содержит стенки, мини-крышу и встроенное окно.
  Код вырезает область в скате и ставит модуль.

Расположение задаётся в секции `roof_windows` дескриптора.

### 9.6. Крыльцо, террасы, навесы — ОТДЕЛЬНЫЕ КОНСТРУКЦИИ ✓

Крыльцо, террасы, перила, навесы — **не** часть дескриптора дома.
Они остаются отдельными конструкциями в конфигураторе (шаги 5–8), как сейчас:
- `buildTerrace3d()` — терраса
- `buildPorch3d()` — крыльцо
- `buildFence3d()` — забор
- `buildRailing3d()` — перила
- Навесы — опция в `buildTerrace3d()` (toggle «Навес»)

### 9.7. Локальная облицовка стен — ЗОНЫ МАТЕРИАЛОВ ✓

Каждый `wall_segment` получает уникальный `segId`. Новый шаг UI «Отделка фасада»
позволяет выбирать сегменты мышью и назначать им материалы.

### 9.8. За окнами — шторы ✓

Интерьер не моделируется. Штора (`curtain`) — часть параметрического GLB-модуля окна.
Плоскость за стеклом с материалом `mat_curtain`. Масштабируется вместе с окном.

### 9.9. LOD не нужны ✓

Один набор GLB-модулей для обеих платформ (desktop и mobile).
Бюджет полигонов ограничен на уровне соглашений (до 5 000 треугольников на модуль).

---

## 10. Все вопросы закрыты

Спецификация готова к реализации. Открытых вопросов нет.
