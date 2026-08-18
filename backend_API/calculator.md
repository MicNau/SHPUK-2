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
  в том виде, в каком его отдаёт API;
- `getTotalCost(type, request, option)` — только общая стоимость числом, сумма
  позиций сметы и работ.

Тип объекта — значение `CalculationType`, от него зависит форма тела запроса:

| Тип | `CalculationType` | Тело запроса |
|---|---|---|
| Терраса | `TERRACE` | `{vertices, doorDirection, deckingBoardProductId}` |
| Ступени | `STEPS` | `{vertices, height, stepProductId}` |
| Забор | `FENCE` | `{lines, gateCount, sectionProductId, picketProductId}` |
| Оградка | `RAILING` | `{lines, sectionProductId}` |
| Дорожка | `PATH` | `{vertices, deckingBoardProductId}` |
| Мебель | `FURNITURE` | `{items}` |

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

Вторым аргументом можно передать одну опцию из `CalculationOption`:

| Опция | Что возвращается |
|---|---|
| `ONLY_MATERIALS` | только `materials` |
| `ONLY_MAIN_MATERIALS` | только основные материалы объекта |
| `ONLY_WORKS` | только `works` |

Опция влияет и на стоимость: `getTotalCost` считает по тому, что осталось после
урезания.

```js
const materialsCost = await calculator.getTotalCost(
    CalculationType.STEPS,
    {vertices, height: 600},
    CalculationOption.ONLY_MATERIALS,
);
```

Основные материалы заданы в `MAIN_MATERIALS`: у террасы доска и полуступень, у
ступеней ступень, подступенок и фасадная доска, у забора секции и штакетник, у
оградки секции, у дорожки доска. У мебели основными считаются все позиции.

Двух опций сразу быть не может, неизвестное значение опции или типа объекта
тоже не пройдёт — всё это отбивается до запроса.

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

```js
const cart = {198835: 2, 197293: 1};

const furniture = await calculator.getCalculation(
    CalculationType.FURNITURE,
    {items: cart},
);
```

### Стоимость дорожки без работ

```js
const cost = await calculator.getTotalCost(
    CalculationType.PATH,
    {vertices, deckingBoardProductId: board.id},
    CalculationOption.ONLY_MATERIALS,
);
```

## Чего сервис не делает

- **Ничего не пересчитывает.** Запас, единицы продажи и стоимость приходят из
  API уже посчитанными. Вторая реализация на клиенте разошлась бы с сервером.
- **Не проверяет геометрию.** Правила «сколько нужно точек» и «какие вершины
  помечать» живут в расчёте; клиент ловит только пустое тело запроса.
- **Не отменяет запросы и не откладывает их.** Дебаунс при перерисовке — забота
  вызывающего кода.
