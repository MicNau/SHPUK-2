# API каталога и ресурсный менеджер


Домен: `https://sollersdev.ru`

## Эндпоинты

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/v1/sections/` | плоский список разделов каталога |
| GET | `/api/v1/sections/flat/` | то же самое |
| GET | `/api/v1/sections/tree/` | разделы деревом |
| GET | `/api/v1/products/?<фильтры>` | список товаров, пакетно |
| GET | `/api/v1/products/<id>/` | один товар по id(c суффиксом конфигурации, то есть то что в ResorceManager называется id) |

Возвращаются только активные и доступные товары.

## Объекты

### Раздел каталога

```json
{
    "bitrix_id": 2314,
    "name": "Террасная доска из ДПК",
    "code": "terrasnaya-doska-iz-dpk",
    "parent_bitrix_id": null,
    "sort": 1
}
```

В дереве у каждого раздела дополнительно есть `children` с такими же объектами.

### Товар

```json
{
    "id": 196435,
    "name": "Универсальная доска AIWOODek 140*18 мм, м.пог",
    "color": "",
    "code": "dpk_doska_universalnaya_holzhof",
    "xml_id": "69083",
    "sort": 1,
    "main_section_id": 2315,
    "sections": [2316, 2995, 2315],
    "preview_text": "",
    "preview_text_type": "html",
    "preview_picture": {
        "id": 524427,
        "url": "https://outdoor-mebel.ru/upload/iblock/...jpg",
        "name": "",
        "type": ""
    },
    "detail_picture": { "...": "то же самое" },
    "glb_file_url": null,
    "texture_urls": {
        "textures_dpc_diffusion": "https://sollersdev.ru/static/DPK/diffusion/....png",
        "textures_dpc_normal": "https://sollersdev.ru/static/DPK/normal/....png",
        "textures_dpc_roughness": "https://sollersdev.ru/static/DPK/roughness/....png"
    },
    "variants_id": [19972101, 19972102],
    "prices": [
        { "price": "364.00", "currency": "RUB" }
    ]
}
```

`variants_id` — другие товары, взаимозаменяемые с этим: тот же товар в другом
цвете или с другой текстурой.

`color` — легаси-поле, сохраняется для обратной совместимости. Оно лежит вне
характеристик, поэтому параметрическим фильтром не ищется.

### Пакетный ответ

```json
{
  "total": 219,
  "page": 1,
  "pages": 5,
  "limit": 50,
  "products": [ "...товары..." ]
}
```

## Фильтры

Фильтры применяются последовательно: возвращается пересечение по всем выборкам.
**Хотя бы один фильтр обязателен** — запрос без фильтров получает 400.
Неизвестный параметр в строке запроса тоже даёт 400, молча он не игнорируется.

| Параметр | Значение |
|---|---|
| `section_id` | принимается, но выборку не сужает — по договорённости с фронт-командой |
| `ids` | составные id конфигураций через запятую |
| `base_ids` | id товаров каталога через запятую, все конфигурации каждого |
| `price_min` | минимальная цена, включительно |
| `price_max` | максимальная цена, включительно |
| `tags` | теги через запятую, см. ниже |
| `properties` | фильтр по характеристикам, JSON-массив предикатов |
| `sort` | поле сортировки: `sort` (по умолчанию), `id`, `name`, `price` |
| `sort_order` | `ASC` (по умолчанию) или `DESC` |
| `limit` | товаров на странице: от 1 до 500, по умолчанию 50 |
| `page` | страница, по умолчанию 1. Значение больше числа страниц вернёт последнюю |

### Теги

Структура каталога в Bitrix не всегда позволяет отделить нужный товар: в разделе
«Террасная доска из ДПК» лежат и доски, и аксессуары к ним. Теги это обходят.

`walls`, `fences`, `dpk`, `mpk`, `steps`, `furniture`, `garden_beds`,
`fencing`

Тегов можно передать несколько через запятую, и подходит товар с любым из
них: `tags=furniture,garden_beds` вернёт и мебель, и грядки. Пересечения по
тегам не бывает — тег у товара один.

Неизвестный тег даёт 400 со списком непонятых значений — молча он не
отбрасывается, иначе выдача по оставшимся тегам выглядела бы правильной.

Теги `terrasnaya_doska` и `dpk_steps` сняты: они отбирали по названию товара
в обход структуры каталога, а теперь тот же отбор делают `dpk` и `steps`.
Запрос с ними отвечает 400.

### Фильтр по характеристикам

Предикаты едут JSON-ом одним параметром:

```
/api/v1/products/?tags=fences&properties=[{"property":"dimensions.height","op":"eq","value":1800}]
```

- `property` — путь внутри характеристик товара, точка единственный разделитель
- `op` — `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`
- `value` — скаляр, для `in` непустой массив скаляров

Предикаты складываются по И, ИЛИ не поддерживается. JSON выбран из-за типов:
`1800` и `"1800"` в базе разные значения, и число, пришедшее строкой, ничего не
найдёт.

## Ресурсный менеджер

`ResourceManager.js` берёт на себя сеть, загрузку текстур и кеширование, чтобы не
собирать запросы руками. Написан в асинхронном стиле.

### Перечисления

- `FilterType` — какие бывают фильтры
- `PropertyOp` — операции сравнения для фильтра по характеристикам: `EQ`, `NE`, `LT`, `LTE`, `GT`, `GTE`, `IN`
- `PropertyPath` — согласованные пути до характеристик: `HEIGHT`, `WIDTH`, `LENGTH`, `FENCING_POST_CAP_TYPE`, `FENCING_POST_WIDTH`, `GARDEN_BED_CORNER_BRACKET_TYPE`, `PRICE_CATEGORY`
- `PriceCategory` — значения ценовой категории: `BUDGET`, `BALANCE`, `PREMIUM` (`budget`, `balance`, `premium`)
- `SORT_FILEDS` — поля сортировки
- `SORT_ORDER` — порядок сортировки

### Filter

```js
const byPrice = new Filter(FilterType.PRICE_MAX, 1000)
const byName  = new Filter(FilterType.SORT, SORT_FILEDS.NAME)
const byProps = new Filter(FilterType.PROPERTIES, [
    { property: 'dimensions.height', op: PropertyOp.EQ,  value: 1800 },
    { property: 'dimensions.length', op: PropertyOp.LTE, value: 3000 },
])
```

### Ценовая категория

Категория лежит в характеристиках по пути `price_category`, значение одно из
трёх: `budget`, `balance`, `premium`. Значения латиницей — это ключ, а не
подпись: как назвать категорию в интерфейсе, решает фронт.

```js
const budget = new Filter(FilterType.PROPERTIES, [
    { property: PropertyPath.PRICE_CATEGORY, op: PropertyOp.EQ, value: PriceCategory.BUDGET },
])

const notPremium = new Filter(FilterType.PROPERTIES, [
    { property: PropertyPath.PRICE_CATEGORY, op: PropertyOp.IN,
      value: [PriceCategory.BUDGET, PriceCategory.BALANCE] },
])
```

Категория у товара одна, поэтому несколько категорий сразу отбираются `IN`, а
не двумя предикатами: они сложились бы по И и не нашли ничего.

Та же категория приходит в `properties` выдачи, так что подписывать товар
можно тем, что уже приехало, без второго запроса.

Фильтры проверяются **до** запроса: кривой предикат падает с сообщением в консоль,
а `getResources` возвращает `null`, не сходив в сеть.

Все предикаты по характеристикам передаются **одним** фильтром `PROPERTIES` с
массивом. Два таких фильтра в одном вызове схлопнутся: последний перетрёт
предыдущий.

Готовые наборы фильтров лежат в `Presets`:

```js
const filters = Presets.terrasnaya_doska_dpk()
```

### ProductResource

```js
this.id                      // id ресурса
this.baseId                  // корневой товар каталога
this.configId                // конфигурация, из которой собран ресурс
this.name
this.code
this.xmlId
this.sort
this.mainSectionId
this.sections                // []
this.previewText
this.previewTextType
this.previewPicture
this.detailPicture
this.prices                  // []
this.properties              // характеристики: путь → значение
this.color                   // цвет: у конфигурации — имя варианта по оси color
this.glbFileUrl              // модель: из характеристик, иначе поле товара
this.productVariants         // id остальных конфигураций того же товара
this.textureUrls             // {textures_dpc_diffusion, textures_dpc_normal, textures_dpc_roughness}
this.textures                // те же ключи, загруженные THREE-текстуры
this.isTextureLoadedSuccessed
```

`id` идентифицирует **конфигурацию**, `baseId` — товар каталога. В `ids` уходит
`id`, в `base_ids` — `baseId`.

Текстуры грузятся фоново через `THREE.TextureLoader`, после успеха
`isTextureLoadedSuccessed` становится `true`. При пакетной выдаче загрузка идёт
чанками, поэтому нужная текстура может быть ещё не готова — тогда её можно
дождаться вручную:

```js
await resource.loadTextures(force_reload = false)   // true при успехе, false при ошибке
```

### Методы ResourceManager

```js
await manager.getResources(...filters)
```

Возвращает `{products, total, page, pages, limit}` или `null` при ошибке. Ресурсы
отдаются сразу, не дожидаясь текстур: их загрузка стартует фоном.

```js
await manager.getProductById(productId)   // по id ресурса
await manager.getSections(flat = true)
await manager.getSectionById(id)
await manager.getSectionByName(name)
await manager.getSectionByCode(code)
manager.getCachedProducts()
```

Всё, кроме последнего, возвращает `null` при ошибке или если объекта нет.

## Конфигурации

`GET /api/v1/products/` отдаёт **конфигурации** товара. Конверт и форма записи
прежние, `ProductResource` собирается из них без единой правки — на стороне
фронта менять ничего не нужно.

Тот же ответ доступен и по адресу `/api/v1/configured_products/`.

Товар с вариантами разворачивается в комбинации: у каждой свой составной `id`,
своё имя, свои текстуры и модель. Товар без вариантов даёт ровно одну запись,
поэтому разбирать два разных случая не нужно.

| Поле | Откуда берётся |
|---|---|
| `id` | `base_id` вместе с кодом конфигурации |
| `base_id` | товар каталога, его же ждёт фильтр `base_ids` |
| `config_id` | код конфигурации внутри товара |
| `name` | имя товара плюс выбранные варианты |
| `color` | имя варианта по оси `color`, иначе поле товара |
| `preview_picture` | превью варианта, иначе картинка товара |
| `glb_file_url` | `glb_url` из характеристик, иначе поле товара |
| `texture_urls` | `textures.diffusion_url`, `textures.normal_url`, `textures.roughness_url` |
| `variants_id` | остальные конфигурации того же товара |
| `properties` | только публичные характеристики |
| `prices` | цена конфигурации, если она у неё своя, иначе цена товара |

В `properties` приезжают не все характеристики, а публичные: габариты
(`dimensions`), текстуры (`textures`), модель (`glb_url`) и ценовая категория
(`price_category`). Товар может показать что-то сверх этого — например
`components.post`, — и тогда оно приедет **вместе** с перечисленным, а не
вместо него. Остальное — роли, ссылки на компоненты, нормы расхода — кухня
расчёта и наружу не идёт.

`prices` у конфигураций одного товара могут отличаться: у грядки на два метра
своя цена, у метровой своя, хотя товар каталога у них общий. Список остаётся
списком прежней формы — подменяется только сумма, валюта берётся из прайса.

Фильтры `price_min` и `price_max` при этом отбирают **корневые товары** по
цене из каталога: они уходят в базу до разворота конфигураций и своих цен
комбинаций не видят.

`variants_id` считается **до** фильтра по характеристикам: переключиться на
другой цвет можно всегда, даже когда выборка сужена.

### Фильтры этого адреса

`base_ids`, `ids`, `tags`, `price_min`, `price_max`, `properties`, `sort`,
`sort_order`, `limit`, `page`. Неизвестный параметр — 400, как и в каталоге.

`ids` здесь принимает **составной id конфигурации**, а `base_ids` — id товара
каталога. Разбирает составной id сервер: формат придумал он, фронту про
устройство знать не нужно.

Сортировка идёт по развёрнутым конфигурациям, а не по товарам: `name` — имя
конфигурации, `price` — цена конфигурации (своя, если она задана, иначе цена
корневого товара), `id` — составной id.

`section_id` принимается, но выборку не сужает — как и раньше.

Код конфигурации — порядковый номер комбинации, а не долговременный
идентификатор: добавили значение в ось, и нумерация после него поехала. Сохранять
надо выбор, а не `id`.