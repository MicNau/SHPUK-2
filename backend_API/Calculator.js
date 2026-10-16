/**
 * Calculator — обёртка над API расчётов.
 *
 * Берёт на себя сетевую часть: адрес, метод, заголовки, разбор ответа и
 * ошибок. Тело запроса совпадает с тем, что описано в calculation_api.md:
 * методы принимают ровно тот же объект, который ушёл бы в API, чтобы
 * разработчику не приходилось держать в голове два формата.
 *
 * Два метода на все типы объектов:
 *   getCalculation - объект расчёта: материалы и работы;
 *   getTotalCost   - только общая стоимость числом.
 * Тип объекта передаётся первым аргументом значением CalculationType.
 *
 * Смета в PDF собирается фоновой задачей, поэтому у неё свои методы:
 *   getReport       - запустить сборку и дождаться ссылки на файл;
 *   startReport     - только запустить, вернёт идентификатор задачи;
 *   getReportStatus - состояние задачи;
 *   waitReport      - дождаться уже запущенной.
 */

const CalculationErrorKind = {
    VALIDATION: 'validation',
    GEOMETRY: 'geometry',
    MATERIALS: 'materials',
    SERVER: 'server',
    NETWORK: 'network',
    TIMEOUT: 'timeout',
};

const ReportStatus = {
    PENDING: 'pending',
    READY: 'ready',
    FAILED: 'failed',
};

// Четыре варианта ответа, от короткого к полному. Без опции — то же, что
// ALL_WITH_WORKS.
const CalculationOption = {
    ONLY_MAIN_MATERIALS: 'onlyMainMaterials',
    MATERIALS_BRIEF: 'materialsBrief',
    ONLY_MATERIALS: 'onlyMaterials',
    ALL_WITH_WORKS: 'allWithWorks',
};


const CalculationType = {
    TERRACE: 'terrace',
    STEPS: 'steps',
    FENCE: 'fence',
    RAILING: 'railing',
    PATH: 'path',
    FACADE: 'facade',
    FURNITURE: 'furniture',
    GARDEN_BEDS: 'garden_beds',
    PROJECT: 'project',
};

const CALCULATION_PATHS = {
    terrace: 'calculate_terrace/',
    steps: 'calculate_steps/',
    fence: 'calculate_fence/',
    railing: 'calculate_railing/',
    path: 'calculate_path/',
    facade: 'calculate_facade/',
    furniture: 'calculate_furniture/',
    garden_beds: 'calculate_garden_beds/',
    project: 'calculate_project/',
};

// Название объекта для брифа.
const OBJECT_NAMES = {
    terrace: 'Терраса',
    steps: 'Ступени',
    fence: 'Забор',
    railing: 'Оградка',
    path: 'Дорожка',
    facade: 'Фасад',
    furniture: 'Мебель',
    garden_beds: 'Грядки',
    project: 'Проект',
};

// Основные материалы объекта: по ним работает onlyMainMaterials. У мебели и
// грядок ролей нет вовсе, а у фасада ключи позиций товарные, поэтому смета
// отдаётся целиком. У проекта с объединёнными материалами основные — это
// основные всех его объектов: роли позиции сервер отдаёт в её поле roles.
const MAIN_MATERIALS = {
    terrace: ['deckingBoard', 'halfStep'],
    steps: ['step', 'riser', 'facadeBoard'],
    fence: ['section', 'picket'],
    railing: ['section'],
    path: ['deckingBoard'],
    facade: null,
    furniture: null,
    garden_beds: null,
    project: null,
};

class CalculationError extends Error {
    constructor(message, {kind, status = null, cause = null} = {}) {
        super(message);
        this.name = 'CalculationError';
        this.kind = kind;
        this.status = status;
        this.cause = cause;
    }
}

class Calculator {
    /**
     * @param {string} baseUrl - адрес API, со слэшем на конце.
     * @param {object} options - {pollInterval, pollAttempts}: как часто и
     *   сколько раз спрашивать о готовности сметы в PDF.
     */
    constructor(baseUrl = 'https://sollersdev.ru/api/v1/',
                {pollInterval = 1000, pollAttempts = 60} = {}) {
        this.baseUrl = baseUrl;
        this.pollInterval = pollInterval;
        this.pollAttempts = pollAttempts;
    }

    /**
     * Расчёт объекта.
     *
     * Тело запроса зависит от типа и совпадает с описанным в
     * calculation_api.md:
     *   terrace   - {vertices, doorDirection, deckingBoardProductId};
     *   steps     - {vertices, height, stepProductId};
     *   fence     - {lines, gateCount, sectionProductId, picketProductId};
     *   railing   - {lines, sectionProductId};
     *   path      - {vertices, deckingBoardProductId};
     *   facade    - {pieces};
     *   furniture - {items};
     *   garden_beds - {items};
     *   project   - {objects, mergeMaterials}.
     *
     * @param {string} type - значение CalculationType.
     * @param {object} request - тело запроса как в API.
     * @param {string|null} option - значение CalculationOption.
     * @returns {Promise<object>} по опции:
     *   ONLY_MAIN_MATERIALS - {materials} только основные;
     *   MATERIALS_BRIEF     - {name, materialsTotal}: название объекта и
     *                         стоимость всех материалов, без строк;
     *   ONLY_MATERIALS      - {materials} все;
     *   ALL_WITH_WORKS, null - {materials, works}.
     *   Рядом description — краткое описание строкой; у объединённого
     *   проекта в ней описания всех объектов. У проекта без объединения
     *   материалов — {objects} со сметой и description каждого объекта.
     * @throws {CalculationError}
     */
    async getCalculation(type, request, option = null) {
        return this._calculate(type, request, option);
    }

    /**
     * Общая стоимость расчёта: сумма позиций сметы и работ, оставшихся
     * после опции. У MATERIALS_BRIEF — стоимость всех материалов.
     *
     * @param {string} type - значение CalculationType.
     * @param {object} request - тело запроса как в API.
     * @param {string|null} option - значение CalculationOption.
     * @returns {Promise<number>}
     * @throws {CalculationError}
     */
    async getTotalCost(type, request, option = null) {
        const result = await this._calculate(type, request, option);
        return Calculator._totalCost(result);
    }

    /**
     * Смета в PDF: запускает сборку и дожидается готового файла.
     *
     * Смета собирается фоновой задачей, поэтому одним запросом её не
     * получить: сервис ставит задачу, опрашивает её и отдаёт ссылку.
     *
     * @param {string} type - значение CalculationType.
     * @param {object} request - тело запроса как у расчёта.
     * @param {function} onStatus - вызывается на каждом опросе со статусом.
     * @returns {Promise<string>} ссылка на PDF.
     * @throws {CalculationError}
     */
    async getReport(type, request, onStatus = null) {
        const taskId = await this.startReport(type, request);
        return this.waitReport(taskId, onStatus);
    }

    /**
     * Запуск сборки сметы.
     * @param {string} type - значение CalculationType.
     * @param {object} request - тело запроса как у расчёта.
     * @returns {Promise<string>} идентификатор задачи.
     * @throws {CalculationError}
     */
    async startReport(type, request) {
        if (!CALCULATION_PATHS[type]) {
            throw new CalculationError(`Неизвестный тип объекта: ${type}`, {
                kind: CalculationErrorKind.VALIDATION,
            });
        }

        if (!request || typeof request !== 'object') {
            throw new CalculationError('Не передано тело запроса', {
                kind: CalculationErrorKind.VALIDATION,
            });
        }

        let response;
        try {
            response = await fetch(this.baseUrl + 'calculation_report/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({type, ...request}),
            });
        } catch (error) {
            throw new CalculationError('Сервер расчётов недоступен', {
                kind: CalculationErrorKind.NETWORK, cause: error,
            });
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new CalculationError(
                (data && data.error) || `Ошибка ${response.status}`,
                {kind: Calculator._kindByStatus(response.status), status: response.status});
        }

        return data.taskId;
    }

    /**
     * Состояние задачи: {status}, у готовой сметы ещё url, у упавшей error.
     * @param {string} taskId
     * @returns {Promise<object>}
     * @throws {CalculationError}
     */
    async getReportStatus(taskId) {
        let response;
        try {
            response = await fetch(this.baseUrl + `calculation_report/${taskId}/`);
        } catch (error) {
            throw new CalculationError('Сервер расчётов недоступен', {
                kind: CalculationErrorKind.NETWORK, cause: error,
            });
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new CalculationError(
                (data && data.error) || `Ошибка ${response.status}`,
                {kind: Calculator._kindByStatus(response.status), status: response.status});
        }

        return data;
    }

    /**
     * Ожидание уже запущенной задачи.
     * @param {string} taskId
     * @param {function} onStatus - вызывается на каждом опросе со статусом.
     * @returns {Promise<string>} ссылка на PDF.
     * @throws {CalculationError}
     */
    async waitReport(taskId, onStatus = null) {
        for (let attempt = 0; attempt < this.pollAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));

            const state = await this.getReportStatus(taskId);
            if (onStatus) {
                onStatus(state.status);
            }

            if (state.status === ReportStatus.READY) {
                return state.url;
            }
            if (state.status === ReportStatus.FAILED) {
                throw new CalculationError(state.error || 'Не удалось сформировать смету', {
                    kind: CalculationErrorKind.GEOMETRY,
                });
            }
        }

        throw new CalculationError('Превышено время ожидания сметы', {
            kind: CalculationErrorKind.TIMEOUT,
        });
    }

    /**
     * Запрос к API и приведение ответа к опции.
     * @param {string} type - тип объекта: путь эндпоинта и основные материалы.
     * @param {object} request - тело запроса.
     * @param {string|null} option - значение CalculationOption.
     * @returns {Promise<object>}
     * @throws {CalculationError}
     */
    async _calculate(type, request, option) {
        const path = CALCULATION_PATHS[type];
        if (!path) {
            throw new CalculationError(`Неизвестный тип объекта: ${type}`, {
                kind: CalculationErrorKind.VALIDATION,
            });
        }

        if (!request || typeof request !== 'object') {
            throw new CalculationError('Не передано тело запроса', {
                kind: CalculationErrorKind.VALIDATION,
            });
        }

        if (option !== null && !Object.values(CalculationOption).includes(option)) {
            throw new CalculationError(`Неизвестная опция расчёта: ${option}`, {
                kind: CalculationErrorKind.VALIDATION,
            });
        }

        let response;
        try {
            response = await fetch(this.baseUrl + path, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(request),
            });
        } catch (error) {
            throw new CalculationError('Сервер расчётов недоступен', {
                kind: CalculationErrorKind.NETWORK, cause: error,
            });
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new CalculationError(
                (data && data.error) || `Ошибка ${response.status}`,
                {kind: Calculator._kindByStatus(response.status), status: response.status});
        }

        return Calculator._shape(data, type, option, request);
    }

    /**
     * Вид ошибки по статусу ответа.
     * @param {number} status
     * @returns {string} значение CalculationErrorKind.
     */
    static _kindByStatus(status) {
        if (status === 400) return CalculationErrorKind.GEOMETRY;
        if (status === 403 || status === 404) return CalculationErrorKind.MATERIALS;
        return CalculationErrorKind.SERVER;
    }

    /**
     * Урезает ответ по опции.
     * @param {object} result - ответ API.
     * @param {string} type - тип объекта.
     * @param {string|null} option - значение CalculationOption.
     * @param {object|null} request - тело запроса: у проекта по нему видно,
     *   из каких объектов он состоит.
     * @returns {object}
     */
    static _shape(result, type, option, request = null) {
        // Проект без объединения материалов отдаёт смету по объектам: опция
        // применяется к каждому со своим типом, тип, имя и описание остаются
        // на месте. В брифе имя объекта из запроса важнее общего названия типа.
        if (result.objects) {
            return {
                objects: result.objects.map(object => ({
                    ...Calculator._shapeEstimate(object, object.type, option),
                    type: object.type,
                    name: object.name,
                    description: object.description,
                })),
            };
        }

        const shaped = Calculator._shapeEstimate(result, type, option, request);

        // Описание от опции не зависит: у одиночного объекта и у объединённой
        // сметы проекта это одна строка рядом со сметой.
        if (result.description !== undefined) {
            shaped.description = result.description;
        }
        return shaped;
    }

    /**
     * Смета одного объекта или объединённого проекта, урезанная по опции.
     * @param {object} result - смета из ответа API.
     * @param {string} type - тип объекта.
     * @param {string|null} option - значение CalculationOption.
     * @param {object|null} request - тело запроса.
     * @returns {object}
     */
    static _shapeEstimate(result, type, option, request = null) {
        const materials = result.materials || {};
        const works = result.works || [];

        if (option === CalculationOption.ONLY_MAIN_MATERIALS) {
            return {materials: Calculator._mainMaterials(materials, type, request)};
        }

        // Бриф — одна строка «Терраса — 46 466 ₽»: название и стоимость всех
        // материалов, сами позиции не отдаются.
        if (option === CalculationOption.MATERIALS_BRIEF) {
            return {
                name: OBJECT_NAMES[type],
                materialsTotal: Calculator._materialsCost(materials),
            };
        }

        if (option === CalculationOption.ONLY_MATERIALS) {
            return {materials};
        }

        return {materials, works};
    }

    /**
     * Основные материалы объекта. Если у типа ролей нет, отдаются все.
     * @param {object} materials - словарь позиций из ответа API.
     * @param {string} type - тип объекта.
     * @param {object|null} request - тело запроса.
     * @returns {object}
     */
    static _mainMaterials(materials, type, request = null) {
        if (type === CalculationType.PROJECT) {
            return Calculator._mainProjectMaterials(materials, request);
        }

        const keys = MAIN_MATERIALS[type];
        if (!keys) {
            return materials;
        }

        const main = {};
        for (const key of keys) {
            if (materials[key]) main[key] = materials[key];
        }
        return main;
    }

    /**
     * Основные материалы объединённой сметы проекта.
     *
     * Ключи позиций здесь товарные, поэтому основная позиция узнаётся по
     * roles: хотя бы одна её роль основная у какого-то объекта проекта.
     * Готовые изделия ролей не имеют и считаются основными, как у мебели и
     * грядок. Сервер, который roles ещё не отдаёт, получает смету целиком.
     * @param {object} materials - словарь позиций из ответа API.
     * @param {object|null} request - тело запроса проекта.
     * @returns {object}
     */
    static _mainProjectMaterials(materials, request) {
        const positions = Object.values(materials);
        if (!positions.some(material => Array.isArray(material.roles))) {
            return materials;
        }

        const roles = new Set();
        for (const object of (request && request.objects) || []) {
            for (const role of MAIN_MATERIALS[object.type] || []) roles.add(role);
        }

        const main = {};
        for (const [key, material] of Object.entries(materials)) {
            const own = material.roles || [];
            if (own.length === 0 || own.some(role => roles.has(role))) {
                main[key] = material;
            }
        }
        return main;
    }

    /**
     * Сумма позиций сметы.
     * @param {object} materials
     * @returns {number}
     */
    static _materialsCost(materials) {
        let total = 0;
        for (const material of Object.values(materials)) {
            total += material.totalCost || 0;
        }
        return total;
    }

    /**
     * Сумма по тому, что осталось в результате после опции. У брифа
     * берётся готовый итог по всем материалам.
     * @param {object} result
     * @returns {number}
     */
    static _totalCost(result) {
        let total = 0;

        // У проекта без объединения материалов общей сметы нет: стоимость
        // набирается по объектам.
        for (const object of result.objects || []) {
            total += Calculator._totalCost(object);
        }

        if (result.materialsTotal !== undefined) {
            total += result.materialsTotal;
        } else {
            total += Calculator._materialsCost(result.materials || {});
        }
        for (const work of result.works || []) {
            total += work.cost || 0;
        }
        return total;
    }
}
