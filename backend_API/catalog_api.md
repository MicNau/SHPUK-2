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
| `section_id` | id раздела. Возвращает товары раздела и всех его дочерних |
| `ids` | id товаров через запятую |
| `base_ids` | id корневых товаров через запятую, все конфигурации каждого. **Заглушка, сервер пока не принимает** |
| `price_min` | минимальная цена, включительно |
| `price_max` | максимальная цена, включительно |
| `tags` | теги через запятую, см. ниже |
| `properties` | фильтр по характеристикам, JSON-массив предикатов. **Заглушка, сервер пока не принимает** |
| `sort` | поле сортировки: `sort` (по умолчанию), `id`, `name`, `price` |
| `sort_order` | `ASC` (по умолчанию) или `DESC` |
| `limit` | товаров на странице: от 1 до 500, по умолчанию 50 |
| `page` | страница, по умолчанию 1. Значение больше числа страниц вернёт последнюю |

### Теги

Структура каталога в Bitrix не всегда позволяет отделить нужный товар: в разделе
«Террасная доска из ДПК» лежат и доски, и аксессуары к ним. Теги это обходят.

`terrasnaya_doska`, `dpk_steps`, `walls`, `fences`, `dpk`, `mpk`, `steps`,
`furniture`, `garden_beds`, `fencing`

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
this.variants                // какие значения бывают: {"color": ['green', 'red'], "dimensions.height: [1200, 1500]"}
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

## Что сейчас заглушки

эти фильтры **не уезжают в запрос**: валидация работает, параметр не добавляется.

- `FilterType.PROPERTIES`
- `FilterType.BASE_IDS`

Полей `properties`, `variants`, `base_id` и `config_id` сервер тоже пока не
отдаёт: у ресурса они получают пустые значения, а `baseId` откатывается на `id`.