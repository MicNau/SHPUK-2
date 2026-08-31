const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
 
 const FilterType =  Object.freeze({
    SECTION_ID: 'SECTION_ID',
    SECTION_NAME: "SECTION_NAME",
    SECTION_CODE: "SECTION_CODE",
    PRODUCT_IDS: 'PRODUCT_IDS',
    BASE_IDS: 'BASE_IDS',
    PRICE_MAX: 'PRICE_MAX',
    PRICE_MIN: 'PRICE_MIN',
    TAGS: 'TAGS',
    PROPERTIES: 'PROPERTIES',
    SORT: 'SORT',
    SORT_ORDER: 'SORT_ORDER',
    LIMIT: 'LIMIT',
    PAGE: 'PAGE',
});

const SORT_FILEDS = Object.freeze({
    SORT: "sort",
    ID: "id",
    NAME: "name",
    PRICE: "price"
});

const SORT_ORDER = Object.freeze({
    ASC: "ASC",
    DESC: "DESC"
});

const PropertyOp = Object.freeze({
    EQ: 'eq',
    NE: 'ne',
    LT: 'lt',
    LTE: 'lte',
    GT: 'gt',
    GTE: 'gte',
    IN: 'in',
});

const PropertyPath = Object.freeze({
    HEIGHT: 'dimensions.height',
    WIDTH: 'dimensions.width',
    LENGTH: 'dimensions.length',

    FENCING_POST_CAP_TYPE: 'components.post_cap.type',
    FENCING_POST_WIDTH: 'components.post.dimensions.width',

    GARDEN_BED_CORNER_BRACKET_TYPE: 'components.corner_bracket.type',

    PRICE_CATEGORY: 'price_category',
});

// Ценовая категория товара: значение характеристики по пути
// PropertyPath.PRICE_CATEGORY. Значения латиницей, потому что это ключ, а не
// подпись: показывать его пользователю должен интерфейс, своими словами.
const PriceCategory = Object.freeze({
    BUDGET: 'budget',    // бюджет
    BALANCE: 'balance',  // баланс
    PREMIUM: 'premium',  // премиум
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
        
        this.previewText = data.preview_text;
        this.previewTextType = data.preview_text_type;
        
        this.previewPicture = data.preview_picture;
        this.detailPicture = data.detail_picture;
        
        this.prices = data.prices || [];

        this.properties = data.properties || {};
        this.color = data.color || "";
        this.glbFileUrl = data.glb_file_url || null;
        this.productVariants = data.variants_id || [];
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
        this.previewText = productData.preview_text || this.previewText;
        this.previewTextType = productData.preview_text_type || this.previewTextType;
        this.previewPicture = productData.preview_picture || this.previewPicture;         
        this.detailPicture = productData.detail_picture || this.detailPicture;
        this.prices = productData.prices || this.prices;
        this.properties = productData.properties || this.properties;
        this.color = productData.color || this.color;
        this.glbFileUrl = productData.glb_file_url || this.glbFileUrl;
        this.productVariants = productData.variants_id || this.productVariants;
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

        const textureLoader = new THREE.TextureLoader();
        for (let [textureName, textureUrl] of Object.entries(this.textureUrls)){
            if (textureUrl != ""){
                promises.push(
                    textureLoader.loadAsync(textureUrl)
                        .then(texture => { this.textures[textureName] = texture; })
                        .catch(err => {
                            console.warn(`Failed to load ${textureName}:`, err);
                            this.textures[textureName] = null;
                        })
                );
            }
            else{
                this.textures[textureName] = null;
            }
        }

        try {
            await Promise.all(promises);
            this.isTextureLoadedSuccessed = true;
            return true
        } 
        catch (error) {
            console.warn(`Failed to load textures for product ${this.id}:`, error);
            this.isTextureLoadedSuccessed = false
            return false
        }
    }
}

class ResourceManager {
    #flatCache = null;
    #treeCache = null;
    #productsCache = new Map();
    #api_domain = 'https://sollersdev.ru'

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
        [FilterType.BASE_IDS]: (value) => ({'base_ids': value.join(',')}),
        [FilterType.PRICE_MAX]: (value) => ({'price_max': value}),
        [FilterType.PRICE_MIN]: (value) => ({'price_min': value}),
        [FilterType.TAGS]: (value) => {
            console.log(value)
            return {'tags': value.join(',') }
        },
        [FilterType.PROPERTIES]: (value) => ({'properties': JSON.stringify(value)}),
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
        [FilterType.SORT]: (value) => {
            const validSorts = Object.values(SORT_FILEDS);
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
                throw new Error('LIMIT must be an integer bigger that 1');
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
}
let manager = new ResourceManager()
//let products = await manager.getResources(new Filter(FilterType.PRICE_MAX, 500), new Filter(FilterType.SECTION_NAME, "Террасная доска из ДПК"))
//let pr = products.products[4]