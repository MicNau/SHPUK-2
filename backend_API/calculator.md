# Calculator

Клиентский сервис расчётов: обёртка над API, чтобы не собирать запросы
руками. Берёт на себя адрес, метод, заголовки, разбор ответа и ошибок.

Тело запроса совпадает с описанным в [calculation_api.md](calculation_api.md) —
методы принимают ровно тот объект, который ушёл бы в API. Формат один, держать
в голове два не нужно.

## Подключение

```js
const calculator = new Calculator('https://sollersdev.ru/api/v1/');
```

Адрес со слэшем на конце; без аргумента берётся продовый. Один экземпляр можно
держать на всё приложение — состояния он не хранит.

## Методы

Их два, оба асинхронные:

- `getCalculation(type, request, option)` — объект расчёта `{materials, works}`
  в том виде, в каком его отдаёт API, урезанный по опции;
- `getTotalCost(type, request, option)` — только стоимость числом: сумма
  того, что осталось после опции. Без опции это материалы вместе с работами.

В результате `getCalculation` при любой опции есть ещё `description` —
краткое описание объекта строкой: «Терраса: доска TalverWood». Его
собирает сервер, опция его не урезает.

- У одиночного объекта оно рядом со сметой.
- У проекта по объектам — в каждом объекте, рядом с `type` и `name`.
- У объединённого проекта оно, как и смета, одно, рядом со сметой. В нём
  описания всех объектов через точку с запятой: «Терраса: доска
  TalverWood; Дорожка: доска TalverWood».

Тип объекта — значение `CalculationType`, от него зависит форма тела запроса:

| Тип | `CalculationType` | Тело запроса |
|---|---|---|
| Терраса | `TERRACE` | `{vertices, doorDirection, deckingBoardProductId}` |
| Ступени | `STEPS` | `{vertices, height, stepProductId}` |
| Забор | `FENCE` | `{lines, gateCount, sectionProductId, picketProductId}` |
| Оградка | `RAILING` | `{lines, sectionProductId}` |
| Дорожка | `PATH` | `{vertices, deckingBoardProductId}` |
| Фасад | `FACADE` | `{pieces}` |
| Мебель | `FURNITURE` | `{items}` |
| Грядки | `GARDEN_BEDS` | `{items}` |
| Проект | `PROJECT` | `{objects, mergeMaterials}` |

Идентификатор товара можно не передавать или прислать `null` — тогда расчёт
возьмёт товар по умолчанию.

```js
const calculation = await calculator.getCalculation(CalculationType.TERRACE, {
    vertices,
    doorDirection: 'N',
    deckingBoardProductId: 196304,
});

const cost = await calculator.getTotalCost(
    CalculationType.FENCE,
    {lines, gateCount: 1},
);
```

Тип передаётся аргументом, поэтому экрану, где объект выбирается
пользователем, не нужен `switch`: тип лежит в состоянии и уходит в вызов как
есть.

## Опции

Третьим аргументом можно передать одну опцию из `CalculationOption`. Вариантов
четыре, от короткого к полному:

| Опция | Что возвращается | `getTotalCost` |
|---|---|---|
| `ONLY_MAIN_MATERIALS` | `{materials}` — только основные материалы | сумма основных |
| `MATERIALS_BRIEF` | `{name, materialsTotal}` — название объекта и стоимость всех материалов, без строк | стоимость всех материалов |
| `ONLY_MATERIALS` | `{materials}` — все материалы | сумма всех материалов |
| `ALL_WITH_WORKS` | `{materials, works}` — все материалы и работы | материалы и работы |

Без опции — то же, что `ALL_WITH_WORKS`.

Бриф — одна строка вида «Терраса — 46 466 ₽»: название объекта
(`Терраса`, `Ступени`, `Забор`, `Оградка`, `Дорожка`, `Фасад`, `Мебель`,
`Грядки`, `Проект`) и стоимость всех материалов, без работ и без самих позиций.

```js
const brief = await calculator.getCalculation(
    CalculationType.TERRACE,
    {vertices, doorDirection: 'N'},
    CalculationOption.MATERIALS_BRIEF,
);
// {name: 'Терраса', materialsTotal: 46466}
```

Опции `ONLY_WORKS` больше нет: вызов с ней отбивается как неизвестная опция.

Основные материалы заданы в `MAIN_MATERIALS`: у террасы доска и полуступень, у
ступеней ступень, подступенок и фасадная доска, у забора секции и штакетник, у
оградки секции, у дорожки доска. У мебели, грядок и фасада основными считаются
все позиции: у фасада смета ключуется товарами, а не ролями, и отличить доску
по ключу нельзя.
У проекта без объединения опция применяется к каждому объекту по его типу. В
объединённой смете ключи позиций товарные, поэтому основная позиция узнаётся
по её полю `roles`: она остаётся, если хоть одна её роль основная у
какого-то объекта проекта. Готовые изделия (мебель, грядки) ролей не имеют и
остаются всегда. Если сервер `roles` не отдаёт, объединённая смета
приходит целиком.

Двух опций сразу быть не может, неизвестное значение опции или типа объекта
тоже не пройдёт — всё это отбивается до запроса.

## Что возвращает каждая опция

Все двенадцать случаев — четыре опции на трёх запросах: одна терраса, проект
по объектам и проект с объединёнными материалами. Терраса 6×4 м у дома, в
проекте к ней добавлена дорожка 1,2×5 м; товары по умолчанию, цены условные.

```js
const terrace = {
    vertices: [
        {x: 0, y: 0, vertexType: 'house'},
        {x: 6000, y: 0, vertexType: 'house'},
        {x: 6000, y: 4000, vertexType: 'free'},
        {x: 0, y: 4000, vertexType: 'free'},
    ],
    doorDirection: 'N',
};
const path = {
    vertices: [
        {x: 0, y: 0, vertexType: 'start'},
        {x: 1200, y: 0, vertexType: 'start'},
        {x: 1200, y: 5000, vertexType: 'free'},
        {x: 0, y: 5000, vertexType: 'free'},
    ],
};

const request = terrace;
const project = merge => ({
    objects: [
        {type: CalculationType.TERRACE, name: 'Терраса у входа', ...terrace},
        {type: CalculationType.PATH, name: 'Дорожка к калитке', ...path},
    ],
    mergeMaterials: merge,
});
```

Чтобы примеры читались, в позициях опущены `productId`, `ruTag` и
`productUrl` — они приходят так же, как в ответе API. Под каждым случаем —
что вернёт `getTotalCost` с той же опцией.

Что видно по примерам:

- **Бриф** — только название и стоимость всех материалов. У проекта по
  объектам — строка на объект с его именем из запроса, у объединённого
  проекта — одна строка «Проект».
- **Основные материалы объединённого проекта** отбираются по `roles`: ключи
  там — идентификаторы товаров, и одна строка доски собрала доску террасы и
  дорожки.
- `getTotalCost` с брифом равен `materialsTotal` — стоимости всех
  материалов, а не только показанных.
- **Описание** — всегда строка. У проекта по объектам оно своё у каждого
  объекта, у объединённого проекта одно на всю смету.
- У товаров по умолчанию бренда нет, поэтому в описании вместо бренда их
  имя — «доска Террасная доска ДПК». У товара с брендом будет «доска
  TalverWood».

### Терраса

`getCalculation(CalculationType.TERRACE, request, option)`

#### 1. Терраса — `ONLY_MAIN_MATERIALS`

`getTotalCost` — 13 500

```json
{
  "materials": {
    "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
    "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]}
  },
  "description": "Терраса: доска Террасная доска ДПК"
}
```

#### 2. Терраса — `MATERIALS_BRIEF`

`getTotalCost` — 46 466

```json
{"name": "Терраса", "materialsTotal": 46466, "description": "Терраса: доска Террасная доска ДПК"}
```

#### 3. Терраса — `ONLY_MATERIALS`

`getTotalCost` — 46 466

```json
{
  "materials": {
    "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
    "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
    "angleBracket": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
    "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 8, "totalCost": 1920, "roles": ["rubberSupports"]},
    "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 111, "totalCost": 21090, "roles": ["joist"]},
    "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 528, "totalCost": 8976, "roles": ["deckingClip"]}
  },
  "description": "Терраса: доска Террасная доска ДПК"
}
```

#### 4. Терраса — `ALL_WITH_WORKS`

`getTotalCost` — 72 866

```json
{
  "materials": {
    "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
    "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
    "angleBracket": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
    "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 8, "totalCost": 1920, "roles": ["rubberSupports"]},
    "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 111, "totalCost": 21090, "roles": ["joist"]},
    "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 528, "totalCost": 8976, "roles": ["deckingClip"]}
  },
  "works": [
    {"name": "Монтаж террасной доски из ДПК", "dimension": "м²", "pricePerDimension": 1100, "totalDimensionCount": 24, "cost": 26400}
  ],
  "description": "Терраса: доска Террасная доска ДПК"
}
```

### Проект по объектам

`getCalculation(CalculationType.PROJECT, project(false), option)`

#### 5. Проект по объектам — `ONLY_MAIN_MATERIALS`

`getTotalCost` — 13 500

```json
{
  "objects": [
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
        "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]}
      },
      "type": "terrace",
      "name": "Терраса у входа",
      "description": "Терраса: доска Террасная доска ДПК"
    },
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 45, "totalCost": 0, "roles": ["deckingBoard"]}
      },
      "type": "path",
      "name": "Дорожка к калитке",
      "description": "Дорожка: доска Террасная доска ДПК"
    }
  ]
}
```

#### 6. Проект по объектам — `MATERIALS_BRIEF`

`getTotalCost` — 54 405

```json
{
  "objects": [
    {"name": "Терраса у входа", "materialsTotal": 46466, "type": "terrace", "description": "Терраса: доска Террасная доска ДПК"},
    {"name": "Дорожка к калитке", "materialsTotal": 7939, "type": "path", "description": "Дорожка: доска Террасная доска ДПК"}
  ]
}
```

#### 7. Проект по объектам — `ONLY_MATERIALS`

`getTotalCost` — 54 405

```json
{
  "objects": [
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
        "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
        "angleBracket": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
        "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 8, "totalCost": 1920, "roles": ["rubberSupports"]},
        "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 111, "totalCost": 21090, "roles": ["joist"]},
        "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 528, "totalCost": 8976, "roles": ["deckingClip"]}
      },
      "type": "terrace",
      "name": "Терраса у входа",
      "description": "Терраса: доска Террасная доска ДПК"
    },
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 45, "totalCost": 0, "roles": ["deckingBoard"]},
        "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 27, "totalCost": 5130, "roles": ["joist"]},
        "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 2, "totalCost": 480, "roles": ["rubberSupports"]},
        "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 132, "totalCost": 2244, "roles": ["deckingClip"]},
        "starterClip": {"name": "Кляймер стартовый", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 5, "totalCost": 85, "roles": ["starterClip"]}
      },
      "type": "path",
      "name": "Дорожка к калитке",
      "description": "Дорожка: доска Террасная доска ДПК"
    }
  ]
}
```

#### 8. Проект по объектам — `ALL_WITH_WORKS`

`getTotalCost` — 87 405

```json
{
  "objects": [
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 165, "totalCost": 0, "roles": ["deckingBoard"]},
        "halfStep": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
        "angleBracket": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
        "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 8, "totalCost": 1920, "roles": ["rubberSupports"]},
        "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 111, "totalCost": 21090, "roles": ["joist"]},
        "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 528, "totalCost": 8976, "roles": ["deckingClip"]}
      },
      "works": [
        {"name": "Монтаж террасной доски из ДПК", "dimension": "м²", "pricePerDimension": 1100, "totalDimensionCount": 24, "cost": 26400}
      ],
      "type": "terrace",
      "name": "Терраса у входа",
      "description": "Терраса: доска Террасная доска ДПК"
    },
    {
      "materials": {
        "deckingBoard": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 45, "totalCost": 0, "roles": ["deckingBoard"]},
        "joist": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 27, "totalCost": 5130, "roles": ["joist"]},
        "rubberSupports": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 2, "totalCost": 480, "roles": ["rubberSupports"]},
        "deckingClip": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 132, "totalCost": 2244, "roles": ["deckingClip"]},
        "starterClip": {"name": "Кляймер стартовый", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 5, "totalCost": 85, "roles": ["starterClip"]}
      },
      "works": [
        {"name": "Монтаж дорожки из ДПК", "dimension": "м²", "pricePerDimension": 1100, "totalDimensionCount": 6, "cost": 6600}
      ],
      "type": "path",
      "name": "Дорожка к калитке",
      "description": "Дорожка: доска Террасная доска ДПК"
    }
  ]
}
```

### Проект с объединёнными материалами

`getCalculation(CalculationType.PROJECT, project(true), option)`

#### 9. Проект с объединёнными материалами — `ONLY_MAIN_MATERIALS`

`getTotalCost` — 13 500

```json
{
  "materials": {
    "-1": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 210, "totalCost": 0, "roles": ["deckingBoard"]},
    "-7": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]}
  },
  "description": "Терраса: доска Террасная доска ДПК; Дорожка: доска Террасная доска ДПК"
}
```

#### 10. Проект с объединёнными материалами — `MATERIALS_BRIEF`

`getTotalCost` — 54 405

```json
{"name": "Проект", "materialsTotal": 54405, "description": "Терраса: доска Террасная доска ДПК; Дорожка: доска Террасная доска ДПК"}
```

#### 11. Проект с объединёнными материалами — `ONLY_MATERIALS`

`getTotalCost` — 54 405

```json
{
  "materials": {
    "-1": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 210, "totalCost": 0, "roles": ["deckingBoard"]},
    "-7": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
    "-8": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
    "-6": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 10, "totalCost": 2400, "roles": ["rubberSupports"]},
    "-5": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 138, "totalCost": 26220, "roles": ["joist"]},
    "-9": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 660, "totalCost": 11220, "roles": ["deckingClip"]},
    "-10": {"name": "Кляймер стартовый", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 5, "totalCost": 85, "roles": ["starterClip"]}
  },
  "description": "Терраса: доска Террасная доска ДПК; Дорожка: доска Террасная доска ДПК"
}
```

#### 12. Проект с объединёнными материалами — `ALL_WITH_WORKS`

`getTotalCost` — 87 405

```json
{
  "materials": {
    "-1": {"name": "Террасная доска ДПК", "dimension": "м пог", "pricePerDimension": 0, "totalDimensionCount": 210, "totalCost": 0, "roles": ["deckingBoard"]},
    "-7": {"name": "Полуступень ДПК", "dimension": "м пог", "pricePerDimension": 900, "totalDimensionCount": 15, "totalCost": 13500, "roles": ["halfStep"]},
    "-8": {"name": "Уголок стальной", "dimension": "шт", "pricePerDimension": 35, "totalDimensionCount": 28, "totalCost": 980, "roles": ["angleBracket"]},
    "-6": {"name": "Подложка резиновая под лагу 60х80", "dimension": "упаковка 20 шт", "pricePerDimension": 240, "totalDimensionCount": 10, "totalCost": 2400, "roles": ["rubberSupports"]},
    "-5": {"name": "Лага ДПК", "dimension": "м пог", "pricePerDimension": 190, "totalDimensionCount": 138, "totalCost": 26220, "roles": ["joist"]},
    "-9": {"name": "Кляймер рядовой", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 660, "totalCost": 11220, "roles": ["deckingClip"]},
    "-10": {"name": "Кляймер стартовый", "dimension": "шт", "pricePerDimension": 17, "totalDimensionCount": 5, "totalCost": 85, "roles": ["starterClip"]}
  },
  "works": [
    {"name": "Монтаж террасной доски из ДПК", "dimension": "м²", "pricePerDimension": 1100, "totalDimensionCount": 24, "cost": 26400},
    {"name": "Монтаж дорожки из ДПК", "dimension": "м²", "pricePerDimension": 1100, "totalDimensionCount": 6, "cost": 6600}
  ],
  "description": "Терраса: доска Террасная доска ДПК; Дорожка: доска Террасная доска ДПК"
}
```

## Смета в PDF

Смета собирается на сервере фоновой задачей, поэтому одним запросом её не
получить: сначала задача ставится в очередь, потом опрашивается её состояние.
Всю эту механику берёт на себя `getReport` — он возвращает ссылку на готовый
файл:

```js
const url = await calculator.getReport(CalculationType.TERRACE, {
    vertices,
    doorDirection: 'N',
});

window.open(url, '_blank');
```

Тип объекта и тело запроса — те же, что у расчёта: что уходит в
`getCalculation`, то же уходит и в смету.

Третьим аргументом можно передать обработчик, которому на каждом опросе
приходит состояние задачи — пригодится для индикатора:

```js
const url = await calculator.getReport(CalculationType.PATH, {vertices}, status => {
    if (status === ReportStatus.PENDING) {
        button.textContent = 'Готовим смету…';
    }
});
```

Как часто спрашивать о готовности и сколько ждать, задаётся при создании
калькулятора. По умолчанию опрос идёт раз в секунду, попыток шестьдесят — то
есть смета ждётся до минуты, а дальше приходит ошибка с `kind: 'timeout'`.
Запас нужен на очередь: воркер собирает сметы по две за раз, и при
одновременных запросах файл приходит позже.

```js
const calculator = new Calculator(
    'https://sollersdev.ru/api/v1/',
    {pollInterval: 2000, pollAttempts: 30},
);
```

Если страница не должна ждать, задачу можно запустить и опрашивать отдельно:

```js
const taskId = await calculator.startReport(CalculationType.FENCE, {lines, gateCount: 1});

// когда угодно позже
const state = await calculator.getReportStatus(taskId);
if (state.status === ReportStatus.READY) {
    window.open(state.url, '_blank');
}
```

`getReportStatus` возвращает то, что отдал API: `{status}`, у готовой сметы ещё
`url`, у упавшей — `error` с текстом. Состояния перечислены в `ReportStatus`:
`PENDING`, `READY`, `FAILED`. Дождаться уже запущенной задачи можно через
`waitReport(taskId, onStatus)`.

Сервис не открывает файл сам — что делать со ссылкой, решает страница. Не
хранит идентификатор задачи: после перезагрузки её не найти. Не отменяет
сборку и не кеширует — два одинаковых вызова дадут две задачи и два файла.

## Ошибки

Методы не возвращают `null`, а бросают `CalculationError`. У ошибки есть
`message` для показа, `status` ответа и `kind` — по нему принимается решение,
что делать:

| kind | Когда | Что показать |
|---|---|---|
| `geometry` | 400: контур или параметры не подходят | сообщение рядом с фигурой, это про действия пользователя |
| `materials` | 404/403: товара нет или у него не заполнены характеристики | «расчёт временно недоступен», текст в лог: чинится в каталоге |
| `server` | 500 | общее сообщение, детали в лог |
| `network` | ответ не получен | предложить повторить |
| `validation` | неверный вызов: неизвестный тип, нет тела, неизвестная опция | ошибка разработчика, до сети не доходит |
| `timeout` | смета в PDF не собралась за отведённые попытки | предложить повторить или подождать |

```js
try {
    const calculation = await calculator.getCalculation(CalculationType.PATH, {vertices});
    render(calculation);
} catch (error) {
    if (error.kind === CalculationErrorKind.GEOMETRY) {
        showHint(error.message);
    } else {
        showUnavailable();
        console.error(error);
    }
}
```

Смысл `kind` в том, чтобы не разбирать текст сообщения: он предназначен для
показа, а не для ветвления логики.

## Примеры

### Смета террасы

```js
const calculator = new Calculator('https://sollersdev.ru/api/v1/');

const calculation = await calculator.getCalculation(CalculationType.TERRACE, {
    vertices: [
        {x: 0, y: 0, vertexType: 'house'},
        {x: 6000, y: 0, vertexType: 'house'},
        {x: 6000, y: 4000, vertexType: 'free'},
        {x: 0, y: 4000, vertexType: 'free'},
    ],
    doorDirection: 'N',
    deckingBoardProductId: null,
});

for (const [key, position] of Object.entries(calculation.materials)) {
    console.log(key, position.name, position.totalDimensionCount,
        position.dimension, position.totalCost);
}
```

### Забор с калитками

У забора два товара: секция задаёт геометрию, штакетник — наполнение.

```js
const fence = await calculator.getCalculation(CalculationType.FENCE, {
    lines: [
        [{x: 0, y: 0}, {x: 6000, y: 0}, {x: 6000, y: 3000}],
        [{x: 8000, y: 0}, {x: 12000, y: 0}],
    ],
    gateCount: 1,
    sectionProductId: null,
    picketProductId: null,
});
```

### Мебель по выбранным изделиям

Ключ — составной идентификатор конфигурации из выдачи каталога, значение —
количество.

```js
const cart = {1988350000: 2, 1972930001: 1};

const furniture = await calculator.getCalculation(
    CalculationType.FURNITURE,
    {items: cart},
);
```

### Грядки

Считаются так же, изделиями каталога: размер грядки — это вариант товара, и
цену своего размера он приносит сам.

```js
const beds = await calculator.getCalculation(
    CalculationType.GARDEN_BEDS,
    {items: {1993400002: 3}},
);
```

### Проект целиком

Объекты передаются массивом, у каждого свой тип, имя и тело своего расчёта.

```js
const project = await calculator.getCalculation(CalculationType.PROJECT, {
    objects: [
        {type: CalculationType.TERRACE, name: 'Терраса у входа', vertices, doorDirection: 'N'},
        {type: CalculationType.STEPS, name: 'Спуск в сад', vertices: stepsVertices, height: 450},
    ],
    mergeMaterials: true,
});
```

С `mergeMaterials: true` приходит обычный `{materials, works}`, только позиции
ключуются идентификатором товара: одинаковые материалы разных объектов
сложены в одну строку, а запас и округление взяты один раз от суммы.

Без объединения ответ содержит `objects` — по одному на каждый объект
запроса, с его типом, именем и своей сметой. Опция урезает смету каждого
объекта по его типу. Бриф проекта — по строке на объект с его именем из
запроса: `{objects: [{type, name, materialsTotal}, ...]}`.

```js
const project = await calculator.getCalculation(CalculationType.PROJECT, {
    objects: [...],
    mergeMaterials: false,
});

for (const object of project.objects) {
    console.log(object.name, Object.keys(object.materials));
}
```

`getTotalCost` работает в обоих случаях: при разложении по объектам он
складывает их сметы сам.

Смета в PDF у проекта тоже своя: `getReport(CalculationType.PROJECT, ...)`
собирает файл, где видно имя каждого объекта. Работы в смете идут отдельным
блоком в самом конце, по всем объектам сразу; итогов два — «Всего» без работ
и «Всего с монтажом».

### Стоимость дорожки без работ и с монтажом

```js
const request = {vertices, deckingBoardProductId: board.id};

const cost = await calculator.getTotalCost(
    CalculationType.PATH, request, CalculationOption.ONLY_MATERIALS);

const costWithWorks = await calculator.getTotalCost(CalculationType.PATH, request);
```

## Чего сервис не делает

- **Ничего не пересчитывает.** Запас, единицы продажи и стоимость приходят из
  API уже посчитанными. Вторая реализация на клиенте разошлась бы с сервером.
- **Не проверяет геометрию.** Правила «сколько нужно точек» и «какие вершины
  помечать» живут в расчёте; клиент ловит только пустое тело запроса.
- **Не отменяет запросы и не откладывает их.** Дебаунс при перерисовке — забота
  вызывающего кода.
