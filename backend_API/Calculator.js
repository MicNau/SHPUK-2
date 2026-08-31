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

const CalculationOption = {
    ONLY_MATERIALS: 'onlyMaterials',
    ONLY_MAIN_MATERIALS: 'onlyMainMaterials',
    ONLY_WORKS: 'onlyWorks',
};


const CalculationType = {
    TERRACE: 'terrace',
    STEPS: 'steps',
    FENCE: 'fence',
    RAILING: 'railing',
    PATH: 'path',
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
    furniture: 'calculate_furniture/',
    garden_beds: 'calculate_garden_beds/',
    project: 'calculate_project/',
};

// Основные материалы объекта: по ним работает onlyMainMaterials. У мебели и
// грядок ролей нет вовсе, у проекта с объединёнными материалами они теряются
// при сложении по товарам, поэтому смета отдаётся целиком.
const MAIN_MATERIALS = {
    terrace: ['deckingBoard', 'halfStep'],
    steps: ['step', 'riser', 'facadeBoard'],
    fence: ['section', 'picket'],
    railing: ['section'],
    path: ['deckingBoard'],
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
     *   furniture - {items};
     *   garden_beds - {items};
     *   project   - {objects, mergeMaterials}.
     *
     * @param {string} type - значение CalculationType.
     * @param {object} request - тело запроса как в API.
     * @param {string|null} option - значение CalculationOption.
     * @returns {Promise<object>} {materials, works} с учётом опции. У проекта
     *   без объединения материалов — {objects} со сметой каждого объекта.
     * @throws {CalculationError}
     */
    async getCalculation(type, request, option = null) {
        return this._calculate(type, request, option);
    }

    /**
     * Общая стоимость расчёта: сумма позиций сметы и работ, оставшихся
     * после опции.
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

        return Calculator._shape(data, type, option);
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
     * @returns {object}
     */
    static _shape(result, type, option) {
        // Проект без объединения материалов отдаёт смету по объектам: опция
        // применяется к каждому со своим типом, тип и имя остаются на месте.
        if (result.objects) {
            return {
                objects: result.objects.map(object => ({
                    type: object.type,
                    name: object.name,
                    ...Calculator._shape(object, object.type, option),
                })),
            };
        }

        const materials = result.materials || {};
        const works = result.works || [];

        if (option === CalculationOption.ONLY_WORKS) {
            return {works};
        }

        if (option === CalculationOption.ONLY_MAIN_MATERIALS) {
            const keys = MAIN_MATERIALS[type];
            if (!keys) {
                return {materials};
            }

            const main = {};
            for (const key of keys) {
                if (materials[key]) main[key] = materials[key];
            }
            return {materials: main};
        }

        if (option === CalculationOption.ONLY_MATERIALS) {
            return {materials};
        }

        return {materials, works};
    }

    /**
     * Сумма по тому, что осталось в результате после опции.
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

        for (const material of Object.values(result.materials || {})) {
            total += material.totalCost || 0;
        }
        for (const work of result.works || []) {
            total += work.cost || 0;
        }
        return total;
    }
}
