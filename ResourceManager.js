
const FilterType =  Object.freeze({
    SECTION_ID: 'SECTION_ID',
    SECTION_NAME: "SECTION_NAME",
    SECTION_CODE: "SECTION_CODE",
    PRODUCT_IDS: 'PRODUCT_IDS',
    BASE_IDS: 'BASE_IDS',            // выборка по корневым товарам (все их конфигурации)
    PRICE_MAX: 'PRICE_MAX',
    PRICE_MIN: 'PRICE_MIN',
    TAGS: 'TAGS',
    PROPERTIES: 'PROPERTIES',        // отбор по характеристикам товара
    COLORS: 'COLORS',                // отбор по названиям цветов (2026-11-13)
    SORT: 'SORT',
    SORT_ORDER: 'SORT_ORDER',
    LIMIT: 'LIMIT',
    PAGE: 'PAGE',
});

// Параметр границы диапазона из ответа getFilters → тип фильтра
// (backend_API/ResourceManager.js, 2026-11-13).
const RANGE_PARAM_FILTERS = Object.freeze({
    price_min: FilterType.PRICE_MIN,
    price_max: FilterType.PRICE_MAX,
});

const SORT_FIELDS = Object.freeze({
    SORT: "sort",
    ID: "id",
    NAME: "name",
    PRICE: "price"
});

const SORT_ORDER = Object.freeze({
    ASC: "ASC",
    DESC: "DESC"
});

// Операции предикатов FilterType.PROPERTIES (backend_API/ResourceManager.js, 2026-08-26).
const PropertyOp = Object.freeze({
    EQ: 'eq',
    NE: 'ne',
    LT: 'lt',
    LTE: 'lte',
    GT: 'gt',
    GTE: 'gte',
    IN: 'in',
});

// Пути характеристик товара — согласованный словарь (backend_API/ResourceManager.js,
// ревизия 2026-08-31). Наши константы PROP_* в state.js держать в синхроне с ним.
const PropertyPath = Object.freeze({
    HEIGHT: 'dimensions.height',
    WIDTH: 'dimensions.width',
    LENGTH: 'dimensions.length',

    FENCING_POST_CAP_TYPE: 'components.post_cap.type',
    FENCING_POST_WIDTH: 'components.post.dimensions.width',

    GARDEN_BED_CORNER_BRACKET_TYPE: 'components.corner_bracket.type',

    PRICE_CATEGORY: 'price_category',

    CORE_TYPE: 'core_type',
    BOARD_DIRECTION: 'board_direction',
    FENCE_TYPE: 'fence_type',
    BRAND: 'brand',                     // бренд товара (ДПК, ступени, ограждения; 2026-10-16)
});

// Ценовая категория товара: значение характеристики по пути
// PropertyPath.PRICE_CATEGORY. Значения латиницей, потому что это ключ, а не
// подпись: показывать его пользователю должен интерфейс, своими словами.
const PriceCategory = Object.freeze({
    BUDGET: 'budget',    // эконом
    BALANCE: 'balance',  // средний
    PREMIUM: 'premium',  // премиум
});

// Сечение доски: значение характеристики по пути PropertyPath.CORE_TYPE.
// У товаров, где сечение не задано, пути в properties нет вовсе — такой товар
// не попадёт ни в solid, ни в hollow.
const CoreType = Object.freeze({
    SOLID: 'solid',    // полнотелая
    HOLLOW: 'hollow',  // пустотелая
});

// Направление фасадной доски на стене: значение характеристики по пути
// PropertyPath.BOARD_DIRECTION. У товаров, где направление не задано, пути
// в properties нет вовсе.
const BoardDirection = Object.freeze({
    HORIZONTAL: 'horizontal',  // горизонтально
    VERTICAL: 'vertical',      // вертикально
});

// Тип забора: значение характеристики по пути PropertyPath.FENCE_TYPE.
// У товаров, где тип не задан, пути в properties нет вовсе.
const FenceType = Object.freeze({
    WOVEN: 'woven',  // плетёный
    BOARD: 'board',  // из доски
});

const PROPERTY_PATH = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;

const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);

class Filter {
    constructor(type, value) {
        this.type = type;
        this.value = value;
    }

    validate(validators){
        validators[this.type](this.value)
    }
    async toQueryParam(handlers){
        return await handlers[this.type](this.value)
    }
}

// Готовые наборы фильтров под разделы каталога. Пополняются бэкендером —
// см. backend_API/ResourceManager.js, откуда они перенесены сюда 2026-08-18.
const Presets = {
    terrasnaya_doska_dpk: () => [
        new Filter(FilterType.TAGS, ['dpk']),
        new Filter(FilterType.SECTION_CODE, 'terrasnaya-doska-iz-dpk')
    ],
    terrasnaya_doska_mpk: () => [
        new Filter(FilterType.TAGS, ['mpk']),
        new Filter(FilterType.SECTION_CODE, 'terrasnaya-doska-iz-mpk')
    ],
    universalnaya_doska_dpk: () => [
        new Filter(FilterType.TAGS, ['dpk']),
        new Filter(FilterType.SECTION_CODE, 'doska-dpk-universalnaya')
    ],
    steps_dpk: () => [
        new Filter(FilterType.TAGS, ['steps']),
        new Filter(FilterType.SECTION_CODE, 'stupeni-iz-dpk')
    ],
    walls_dpk: () => [
        new Filter(FilterType.TAGS, ['walls']),
        new Filter(FilterType.SECTION_CODE, 'fasadnye-sistemy-iz-dpk')
    ],
    walls_mpk: () => [
        new Filter(FilterType.TAGS, ['walls']),
        new Filter(FilterType.SECTION_CODE, 'fasadnye-paneli-iz-mpk')
    ],
}


class ProductResource {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.code = data.code;
        this.xmlId = data.xml_id;
        this.sort = data.sort;
        
        this.mainSectionId = data.main_section_id;
        this.sections = data.sections || [];
        // Торговые предложения (variants_id) — ссылки на соседние предложения товара.
        // Каждое предложение у бэкенда самостоятельный ресурс: своя цена, превью и
        // текстуры; отдельного массива предложений внутри товара не будет. Замечание
        // про будущий trade_offers в backend_API/readme.txt устарело (со слов
        // бэкендера, 2026-08-18) — структура продукта не меняется, править нечего.
        this.productVariants = data.variants_id || [];
        this.previewText = data.preview_text;
        this.previewTextType = data.preview_text_type;
        this.color = data.color || '';   // имя цвета товара (появилось в API 2026-07-29)
        // URL 3D-модели товара (садовая мебель): в ответе API — glb_file_url
        // (добавлено 2026-08-02). model_url / texture_urls.model_glb оставлены как
        // запасные имена на случай смены схемы.
        this.glbFileUrl = data.glb_file_url || '';
        this.modelUrl = this.glbFileUrl
          || data.model_url || (data.texture_urls && data.texture_urls.model_glb) || '';
        
        this.previewPicture = data.preview_picture;
        this.detailPicture = data.detail_picture;
        
        this.prices = data.prices || [];

        // Характеристики товара и его конфигурации (API 2026-08-26). Имена путей
        // согласованы с бэкендом и лежат константами PROP_* в state.js.
        this.properties = data.properties || {};
        this.variants = data.variants || {};
        this.baseId = data.base_id ?? data.id;
        this.configId = data.config_id ?? null;

        this.textureUrls= data.texture_urls || {
            "textures_dpc_diffusion": "",
            "textures_dpc_normal": "",
            "textures_dpc_roughness": "",
        }

        this.textures = {
            "textures_dpc_diffusion": null,
            "textures_dpc_normal": null,
            "textures_dpc_roughness": null,
        }
        this.isTextureLoadedSuccessed = false;
    }

    updateByData(productData){
        this.name = productData.name || this.name;
        this.code = productData.code || this.code;
        this.xmlId = productData.xml_id || this.xmlId;
        this.sort = productData.sort || this.sort;
        this.mainSectionId = productData.main_section_id || this.mainSectionId;
        this.sections = productData.sections || this.sections;
        this.productVariants = productData.variants_id || this.productVariants;
        this.previewText = productData.preview_text || this.previewText;
        this.previewTextType = productData.preview_text_type || this.previewTextType;
        this.color = productData.color || this.color;
        this.glbFileUrl = productData.glb_file_url || this.glbFileUrl;
        this.modelUrl = this.glbFileUrl || productData.model_url
          || (productData.texture_urls && productData.texture_urls.model_glb) || this.modelUrl;
        this.previewPicture = productData.preview_picture || this.previewPicture;         
        this.detailPicture = productData.detail_picture || this.detailPicture;
        this.prices = productData.prices || this.prices;
        this.properties = productData.properties || this.properties;
        this.variants = productData.variants || this.variants;
        this.baseId = productData.base_id ?? this.baseId;
        this.configId = productData.config_id ?? this.configId;

        if (productData.texture_urls) {
            for (let key of Object.keys(this.textureUrls)) {
                const newUrl = productData.texture_urls[key];
                if (newUrl && newUrl !== this.textureUrls[key]) {
                    this.textureUrls[key] = newUrl;
                    this.isTextureLoadedSuccessed = false;
                }
            }
        }

        if (!this.isTextureLoadedSuccessed) {
            this.loadTextures(true);
        }
    } 

    async loadTextures(force_reload=false) {
        if (force_reload && this.isTextureLoadedSuccessed) {
            Object.values(this.textures).forEach(texture => {
                if (texture && texture.dispose){
                    texture.dispose();
                }
            });
        }

        if (!force_reload && this.isTextureLoadedSuccessed) return;
        const promises = [];
        // Считаем реальные сбои загрузки: раньше каждый промис глотал ошибку своим
        // catch, Promise.all никогда не реджектился и флаг успеха ставился даже
        // когда ни одна текстура не загрузилась (повторная попытка не выполнялась).
        let failures = 0;

        const textureLoader = new THREE.TextureLoader();
        for (let [textureName, textureUrl] of Object.entries(this.textureUrls)){
            if (textureUrl != ""){
                promises.push(
                    textureLoader.loadAsync(textureUrl)
                        .then(texture => { this.textures[textureName] = texture; })
                        .catch(err => {
                            console.warn(`Failed to load ${textureName}:`, err);
                            this.textures[textureName] = null;
                            failures++;
                        })
                );
            }
            else{
                this.textures[textureName] = null;
            }
        }

        await Promise.all(promises);
        this.isTextureLoadedSuccessed = failures === 0;
        return this.isTextureLoadedSuccessed;
    }
}

class ResourceManager {
    #flatCache = null;
    #treeCache = null;
    #productsCache = new Map();
    // Домен API настраивается глобалом RESOURCE_API_DOMAIN (см. index.html):
    //   '' (пусто)              — same-origin: запросы на /api/... текущего хоста
    //                             (локально dev-прокси devserver.py → sollersdev.ru, без CORS);
    //   'https://sollersdev.ru' — напрямую (когда бэкенд включит CORS-заголовки).
    #api_domain = (typeof RESOURCE_API_DOMAIN !== 'undefined') ? RESOURCE_API_DOMAIN : 'https://sollersdev.ru'

    #FILTER_HANDLERS = {
        [FilterType.SECTION_ID]: (value) => ({ 'section_id': value }),
        [FilterType.SECTION_NAME]: async (value) => {
                const section = await this.getSectionByName(value);
                return section ? { section_id: section.bitrix_id } : {};
            },
        [FilterType.SECTION_CODE]: async (value) => {
            const section = await this.getSectionByCode(value);
            return section ? { section_id: section.bitrix_id } : {};
        },
        [FilterType.PRODUCT_IDS]: (value) => ({'ids': value.join(',')}),
        // BASE_IDS и PROPERTIES сервер принимает с 2026-08-28 (заглушки сняты):
        // base_ids — id через запятую, properties — JSON-массив предикатов
        // (backend_API/catalog_api.md). Клиентский отбор по характеристикам
        // (_railingFilterProducts / _bedFilterProducts в nav-desktop.js) оставлен:
        // он работает и по уже отфильтрованной выдаче.
        [FilterType.BASE_IDS]: (value) => ({'base_ids': value.join(',')}),
        [FilterType.PRICE_MAX]: (value) => ({'price_max': value}),
        [FilterType.PRICE_MIN]: (value) => ({'price_min': value}),
        [FilterType.TAGS]: (value) => ({'tags': value.join(',') }),
        [FilterType.PROPERTIES]: (value) => ({'properties': JSON.stringify(value)}),
        [FilterType.COLORS]: (value) => ({'colors': value.join(',')}),
        [FilterType.SORT]: (value) => ({'sort': value}),
        [FilterType.SORT_ORDER]: (value) => ({'sort_order': value}),
        [FilterType.LIMIT]: (value) => ({'limit': value}),
        [FilterType.PAGE]: (value) => ({'page': value}),
    };


    #FILTER_VALIDATORS = {
        [FilterType.SECTION_ID]: (value) => {
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error('SECTION_ID must be a positive integer');
            }
        },
        [FilterType.SECTION_NAME]: (value) => {
            if (typeof value !== 'string' || value.trim() === '') {
                throw new Error('SECTION_NAME must be a non-empty string');
            }
        },
        [FilterType.SECTION_CODE]: (value) => {
            if (typeof value !== 'string' || value.trim() === '') {
                throw new Error('SECTION_CODE must be a non-empty string');
            }
        },
        [FilterType.PRODUCT_IDS]: (value) => {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error('PRODUCT_IDS must be a non-empty array');
            }
            if (!value.every(v => Number.isInteger(v) && v > 0)) {
                throw new Error('All PRODUCT_IDS must be positive integers');
            }
        },
        [FilterType.BASE_IDS]: (value) => {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error('BASE_IDS must be a non-empty array');
            }
            if (!value.every(v => Number.isInteger(v) && v > 0)) {
                throw new Error('All BASE_IDS must be positive integers');
            }
        },
        [FilterType.PRICE_MIN]: (value) => {
            if (typeof value !== 'number' || value < 0) {
                throw new Error('PRICE_MIN must be a non-negative number');
            }
        },
        [FilterType.PRICE_MAX]: (value) => {
            if (typeof value !== 'number' || value < 0) {
                throw new Error('PRICE_MAX must be a non-negative number');
            }
        },
        [FilterType.TAGS]: (value) => {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error('TAGS must be a non-empty array of strings');
            }
            if (!value.every(v => typeof v === 'string' && v.trim() !== '')) {
                throw new Error('All TAGS must be non-empty strings');
            }
        },
        [FilterType.PROPERTIES]: (value) => {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error('PROPERTIES must be a non-empty array of predicates');
            }
            const operations = Object.values(PropertyOp);
            for (const predicate of value) {
                if (!predicate || typeof predicate !== 'object') {
                    throw new Error('Each PROPERTIES predicate must be an object');
                }
                if (typeof predicate.property !== 'string' || !PROPERTY_PATH.test(predicate.property)) {
                    throw new Error(`PROPERTIES path must look like "dimensions.height", got: ${predicate.property}`);
                }
                if (!operations.includes(predicate.op)) {
                    throw new Error(`PROPERTIES op must be one of: ${operations.join(', ')}, got: ${predicate.op}`);
                }
                if (predicate.op === PropertyOp.IN) {
                    if (!Array.isArray(predicate.value) || predicate.value.length === 0) {
                        throw new Error(`PROPERTIES op "${PropertyOp.IN}" needs a non-empty array value`);
                    }
                    if (!predicate.value.every(isScalar)) {
                        throw new Error(`PROPERTIES op "${PropertyOp.IN}" accepts only scalar values`);
                    }
                }
                else if (!isScalar(predicate.value)) {
                    throw new Error(`PROPERTIES value for "${predicate.property}" must be a scalar`);
                }
            }
        },
        [FilterType.COLORS]: (value) => {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error('COLORS must be a non-empty array of strings');
            }
            if (!value.every(v => typeof v === 'string' && v.trim() !== '' && !v.includes(','))) {
                throw new Error('All COLORS must be non-empty strings without commas');
            }
        },
        [FilterType.SORT]: (value) => {
            const validSorts = Object.values(SORT_FIELDS);
            if (!validSorts.includes(value)) {
                throw new Error(`SORT must be one of: ${validSorts.join(', ')}`);
            }
        },
        [FilterType.SORT_ORDER]: (value) => {
            if (!['ASC', 'DESC'].includes(value)) {
                throw new Error('SORT_ORDER must be ASC or DESC');
            }
        },
        [FilterType.LIMIT]: (value) => {
            if (!Number.isInteger(value) || value < 1 ) {
                throw new Error('LIMIT must be a positive integer');
            }
        },
        [FilterType.PAGE]: (value) => {
            if (!Number.isInteger(value) || value < 1) {
                throw new Error('PAGE must be a positive integer');
            }
        },
    };

    #validateFilters(filters) {
        for (const filter of filters) {
            try {
                filter.validate(this.#FILTER_VALIDATORS)
            } catch (error) {
                console.error(`Validation failed for ${filter.type}:`, error.message);
                return false;
            }
        }
        return true
    }

    #checkFilterIntersections(filters){
        const seenTypes = new Set();
        for (const filter of filters) {
            if (seenTypes.has(filter.type)) {
                console.warn(`Duplicate filter type: ${filter.type}. Using last value.`);
            }
            seenTypes.add(filter.type);
        }
    }

    async #collectQueryParams(filters){
        const params = new URLSearchParams();
        for (const filter of filters) {
            let filterParams = await filter.toQueryParam(this.#FILTER_HANDLERS)
            for (let [key, value] of Object.entries(filterParams)){
                params.set(key, value);
            }
        }
        return params
    }   

    async #requestProducts(url){
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`HTTP ${response.status}`);
                return null
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch products:', error);
            return null;
        }
    }

    async #loadTexturesBulk(productIds, batchSize=5){
        const products = productIds
            .map(id => this.#productsCache.get(id))
            .filter(p => p && !p.isTextureLoadedSuccessed);

        for (let i = 0; i < products.length; i += batchSize) {
            const batch = products.slice(i, i + batchSize);
            await Promise.all(batch.map(p => p.loadTextures()));
        }
    }

    async getResources(...filters) {
        if (this.#validateFilters(filters)){
            this.#checkFilterIntersections(filters);
            let queryParams = await this.#collectQueryParams(filters);
            const url = `${this.#api_domain}/api/v1/products/?${queryParams}`;
            const response = await this.#requestProducts(url)
            if (response === null){
                return null;
            }
            const products = response.products || [];
            let productIds = []
            for (const productData of products) {
                if (!this.#productsCache.has(productData.id)) {
                    this.#productsCache.set(productData.id, new ProductResource(productData));
                    productIds.push(productData.id)
                }
                else{
                    this.#productsCache.get(productData.id).updateByData(productData)
                }
            }
            this.#loadTexturesBulk(productIds)
            return {
                products: products.map(p => this.#productsCache.get(p.id)),
                total: response.total || 0,
                page: response.page || 1,
                pages: response.pages || 1,
                limit: response.limit || 50
            };
        }
        return null
    }

    /**
     * Фильтры категории: только те, у которых в ней два значения и больше.
     * Ответ — как в catalog_api.md, раздел «Какие фильтры есть у категории».
     * (backend_API/ResourceManager.js, 2026-11-13)
     * @param {string[]} tags
     * @returns {Promise<{tags: string[], total: number, filters: Object[]}|null>}
     */
    async getFilters(tags) {
        const filters = [new Filter(FilterType.TAGS, tags)];
        if (!this.#validateFilters(filters)) return null;
        const params = await this.#collectQueryParams(filters);
        return await this.#requestProducts(`${this.#api_domain}/api/v1/products/filters/?${params}`);
    }

    /**
     * Фильтры для getResources из выбора пользователя по ответу getFilters.
     * selection: {<key фильтра>: [value, ...]} для списков,
     * {<key>: {min, max}} для диапазона. Предикаты по характеристикам
     * собираются в один фильтр PROPERTIES: два таких фильтра схлопнулись бы.
     * @param {Object[]} filters — поле filters ответа getFilters
     * @param {Object} selection
     * @returns {Filter[]}
     */
    static filtersFromSelection(filters, selection) {
        const result = [];
        const predicates = [];
        for (const filter of filters) {
            const chosen = selection[filter.key];
            if (chosen === undefined || chosen === null) continue;
            if (filter.type === 'range') {
                for (const bound of ['min', 'max']) {
                    const type = RANGE_PARAM_FILTERS[(filter.params || {})[bound]];
                    if (type && typeof chosen[bound] === 'number') result.push(new Filter(type, chosen[bound]));
                }
            } else if (Array.isArray(chosen) && chosen.length > 0) {
                if (filter.param === 'colors') {
                    // Название с запятой параметр colors не передаст: пропускаем
                    // его, а не роняем всю выдачу на проверке фильтра.
                    const colors = chosen.filter(color => !String(color).includes(','));
                    if (colors.length < chosen.length) {
                        console.warn('Colors with commas are skipped:', chosen.filter(color => String(color).includes(',')));
                    }
                    if (colors.length > 0) result.push(new Filter(FilterType.COLORS, colors));
                } else if (filter.param === 'properties') {
                    predicates.push({property: filter.property, op: PropertyOp.IN, value: chosen});
                }
            }
        }
        if (predicates.length > 0) result.push(new Filter(FilterType.PROPERTIES, predicates));
        return result;
    }

    async getProductById(productId){
        if (!this.#productsCache.has(productId)) {
            let response = await this.getResources(new Filter(FilterType.PRODUCT_IDS, [productId]))
            if (response){
                return response.products[0] || null
            }
            return null;
        }
        return this.#productsCache.get(productId)
    }

    getCachedProducts(){
        return this.#productsCache
    }

    async getSections(flat = true) {
        if (flat && this.#flatCache) return this.#flatCache;
        if (!flat && this.#treeCache) return this.#treeCache;

        try {
            const data = await this.#requestSections(flat);
            
            if (!data || data.error) {
                console.error('Invalid sections data:', data?.error);
                return null;
            }
            
            if (flat) {
                
                this.#flatCache = data || [];
                return this.#flatCache;
            } else {
                this.#treeCache = data || [];
                return this.#treeCache;
            }
        } catch (error) {
            console.error('Failed to load sections:', error);
            return null;
        }
    }

    async #requestSections(flat = true) {
        const endpoint = this.#api_domain + (flat ? '/api/v1/sections/' : '/api/v1/sections/tree/');
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response.json();
    }

    async getSectionById(id) {
        if (!this.#flatCache) {
            await this.getSections(true);
        }
        return this.#flatCache?.find(s => s.bitrix_id === id) ?? null;
    }

    async getSectionByName(name) {
        if (!this.#flatCache) {
            await this.getSections(true);
        }
        return this.#flatCache?.find(s => s.name === name) || null;
    }

    async getSectionByCode(code) {
        if (!this.#flatCache) {
            await this.getSections(true);
        }
        return this.#flatCache?.find(s => s.code === code) || null;
    }

    // Сохранение и загрузка проекта (backend_API/ResourceManager.js, 2026-09-20).
    // Сервер кладёт присланный data как есть и возвращает ключ; по ключу проект
    // отдаётся обратно. Ошибку методы не поднимают — возвращают null.
    // calculation — необязательные данные для сметы: то же тело, что у
    // calculation_report. Передали — клиенту придёт письмо со сметой в PDF,
    // не передали — письмо уйдёт с одной ссылкой на проект.
    // Отличие от копии бэкенда: причину отказа не выбрасываем. Сервер присылает
    // её текстом ({"error": "Неверный формат проекта — elements.fence.points[0].x:
    // нужно число"}), а пользователь видел только «попробуйте ещё раз» — понять,
    // что именно не так, было нельзя (правка 2026-09-20). Ответ кладётся в
    // lastSaveError; возвращаемое значение прежнее.
    // images — сколько изображений будет догружено uploadProjectImages (2026-11-13):
    // письма ждут их до 2 минут, и только если передан calculation. Сколько сервер
    // ждёт на деле — поле images ответа; 0 — изображения не отправлять.
    lastSaveError = null;

    async saveProject(name, email, data, calculation = null, images = 0) {
        this.lastSaveError = null;
        try {
            const response = await fetch(`${this.#api_domain}/api/v1/create_project/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, data, calculation, images }),
            });
            if (!response.ok) {
                let text = '';
                try { text = await response.text(); } catch (_) {}
                let message = '';
                try { message = (JSON.parse(text) || {}).error || ''; } catch (_) {}
                this.lastSaveError = { status: response.status, message, body: text };
                console.error(`[create_project] HTTP ${response.status}`, message || text);
                return null;
            }
            return await response.json();
        } catch (error) {
            this.lastSaveError = { status: 0, message: '', body: String(error) };
            console.error('Failed to save project:', error);
            return null;
        }
    }

    // Тот же приём заявки, но без писем: проект сохраняется и открывается
    // по своему коду, никто ничего не получает. Для проверок.
    async saveProjectTest(name, email, data, calculation = null) {
        try {
            const response = await fetch(`${this.#api_domain}/api/v1/create_project_test/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, data, calculation }),
            });
            if (!response.ok) {
                console.error(`HTTP ${response.status}`);
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to save project:', error);
            return null;
        }
    }

    // Изображения к заявке (2026-11-13): встают в начало сметы в письме. blobs —
    // Blob или File (JPEG, PNG, WEBP, до 5 МБ каждый, весь запрос до 20 МБ), по
    // порядку показа. Вызывать сразу после saveProject, если в его ответе
    // images > 0. Возвращает {images} или null. Отличие от копии бэкенда — как у
    // saveProject: статус отказа кладётся в lastUploadError ({status}; 0 — сеть).
    // После сетевой ошибки загрузку можно повторить, пока не прошли 2 минуты;
    // 409 — изображения больше не ждут, повторять не нужно.
    lastUploadError = null;

    async uploadProjectImages(saveId, blobs) {
        return this.#uploadImages(`${this.#api_domain}/api/v1/project/${encodeURIComponent(saveId)}/images/`,
                                  blobs, {});
    }

    async #uploadImages(url, blobs, headers) {
        this.lastUploadError = null;
        try {
            const form = new FormData();
            blobs.forEach((blob, index) => form.append('images', blob, `view${index + 1}.jpg`));
            const response = await fetch(url, { method: 'POST', body: form, headers });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                this.lastUploadError = { status: response.status, message: (body && body.error) || '' };
                console.error(`[project images] HTTP ${response.status}`, this.lastUploadError.message);
                return null;
            }
            return await response.json();
        } catch (error) {
            this.lastUploadError = { status: 0, message: String(error) };
            console.error('Failed to upload project images:', error);
            return null;
        }
    }

    // Отладочные методы (backend_API/ResourceManager.js, 2026-11-13): заявка
    // целиком, но без писем, а смета — PDF-файлом. Нужен отладочный токен в
    // заголовке X-Debug-Token: manager.setDebugToken('...'). Порядок как у боевой:
    //   const saved = await manager.saveProjectDebug(name, email, data, calculation, 2);
    //   await manager.uploadProjectImagesDebug(saved.save_id, [blob1, blob2]);
    //   const pdfUrl = await manager.getProjectReportDebug(saved.save_id);
    // В приложении токен задаётся адресом страницы (?debug=<токен>, project-io.js)
    // и в репозитории не хранится.
    #debugToken = null;

    setDebugToken(token) {
        this.#debugToken = token || null;
    }

    get debugToken() { return this.#debugToken; }

    async #debugRequest(path, options = {}) {
        if (!this.#debugToken) {
            console.error('Debug token is not set: call setDebugToken first');
            return null;
        }
        const response = await fetch(`${this.#api_domain}/api/v1/debug/${path}`, {
            method: 'POST',
            ...options,
            headers: {...(options.headers || {}), 'X-Debug-Token': this.#debugToken},
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            this.lastSaveError = { status: response.status, message: (body && body.error) || '', body: '' };
            console.error(`[debug] HTTP ${response.status}`, body?.error ?? '');
            return null;
        }
        return await response.json();
    }

    // Копия saveProject: проект сохраняется со статусом test, писем нет никому.
    async saveProjectDebug(name, email, data, calculation = null, images = 0) {
        this.lastSaveError = null;
        try {
            return await this.#debugRequest('create_project/', {
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, email, data, calculation, images}),
            });
        } catch (error) {
            this.lastSaveError = { status: 0, message: '', body: String(error) };
            console.error('Failed to save debug project:', error);
            return null;
        }
    }

    // Копия uploadProjectImages для проекта из saveProjectDebug.
    async uploadProjectImagesDebug(saveId, blobs) {
        if (!this.#debugToken) {
            console.error('Debug token is not set: call setDebugToken first');
            return null;
        }
        return this.#uploadImages(
            `${this.#api_domain}/api/v1/debug/project/${encodeURIComponent(saveId)}/images/`,
            blobs, {'X-Debug-Token': this.#debugToken});
    }

    // Смета проекта из saveProjectDebug — та, что ушла бы вложением в письме,
    // с загруженными изображениями. Ждёт сборки и возвращает адрес PDF или null.
    async getProjectReportDebug(saveId, {interval = 1000, timeout = 120000} = {}) {
        try {
            const started = await this.#debugRequest(
                `project/${encodeURIComponent(saveId)}/report/`);
            if (!started) return null;
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, interval));
                const response = await fetch(
                    `${this.#api_domain}/api/v1/calculation_report/${started.taskId}/`);
                if (!response.ok) {
                    console.error(`HTTP ${response.status}`);
                    return null;
                }
                const state = await response.json();
                if (state.status === 'ready') return `${this.#api_domain}${state.url}`;
                if (state.status === 'failed') {
                    console.error('Debug report failed:', state.error);
                    return null;
                }
            }
            console.error('Debug report timed out');
            return null;
        } catch (error) {
            console.error('Failed to build debug report:', error);
            return null;
        }
    }

    async getProject(saveId) {
        try {
            const response = await fetch(
                `${this.#api_domain}/api/v1/project/${encodeURIComponent(saveId)}/`);
            if (!response.ok) {
                console.error(`HTTP ${response.status}`);
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to load project:', error);
            return null;
        }
    }
}