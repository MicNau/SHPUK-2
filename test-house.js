// ══════════════════════════════════════════════
// TEST-HOUSE.JS
// Тестовое приложение для проверки модульной системы 3D-домов.
// Загружает JSON-дескриптор из assets/houses/<typeId>.json,
// параллельно тянет все референсированные GLB-модули,
// реализует обход периметра (turtle graphics), параметрическую
// трансформацию окон/дверей и подмену материалов mat_*.
//
// СПЕЦИФИКАЦИИ:
//   HOUSE_DESCRIPTOR_FORMAT.md (v2.0)
//   HOUSE_MODULES_SPEC.md (v2)
//
// ОГРАНИЧЕНИЯ ТЕКУЩЕЙ ИТЕРАЦИИ:
//   ✓ Стены, столбы, фундамент, окна, двери (параметрические)
//   ✓ Подмена материалов
//   ✓ Один этаж
//   ✗ Крыша (TODO)
//   ✗ Dormer/roof_windows (TODO)
//   ✗ Декор (chimney/gutters/cornice) (TODO)
//   ✗ Многоэтажность (TODO)
//
// КОНВЕНЦИЯ ОСЕЙ В МОДУЛЯХ (после GLB-импорта в Three.js Y-up):
//   X = ширина модуля
//   Y = высота
//   Z = глубина (origin на одной грани, тело в -Z)
//   → local Z=0 face = INTERIOR face (room-side)
//   → local -depth face = EXTERIOR face (street-side)
//
// ПОЗИЦИОНИРОВАНИЕ В МИРЕ:
//   Перимeтр обходим по часовой стрелке (top-down view: X right, Z down).
//   Walking +X, INTERIOR направление = (-dz, dx) = +Z.
//   Чтобы тело модуля корректно ушло внутрь здания,
//   позиция шифтится на wt в interior direction:
//     pos = (wx - dz*wt, y, wz + dx*wt)
//   Pillar центрируется на углу:
//     pos = (item.x - ps/2, y, item.z + ps/2)
// ══════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

// ── Архитектурные константы ────────────────────
const FOUNDATION_OVERHANG = 0.10;  // фундамент шире стены на это значение наружу
const ROOF_EAVE           = 0.30;  // свес карниза за стену

// ── Логгер ────────────────────────────────────
const log = (msg, kind = '') => {
  const el = $('log');
  if (!el) { console.log(msg); return; }
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
};

// ── Глобальное состояние сцены ─────────────────
let renderer, scene, camera, controls;
let houseGroup, outlineGroup, axesHelper;
let _state = { desc: null, modules: null, materialOverrides: {} };

// ══════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ СЦЕНЫ
// ══════════════════════════════════════════════
function initScene() {
  const slot = $('viewport');

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  slot.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4a6680);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(15, 10, 15);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(5, 1.5, 5);
  controls.maxPolarAngle = Math.PI / 2.05;

  // Освещение
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x5a8a3c, 0.6));

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(15, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  // Земля
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x556b3a, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Сетка-помощник
  const grid = new THREE.GridHelper(40, 40, 0x444444, 0x2a2a2a);
  grid.position.y = 0.001;
  scene.add(grid);

  // Оси (опционально)
  axesHelper = new THREE.AxesHelper(3);
  axesHelper.visible = false;
  scene.add(axesHelper);

  // Группы
  houseGroup = new THREE.Group();
  scene.add(houseGroup);
  outlineGroup = new THREE.Group();
  scene.add(outlineGroup);

  // Анимация
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ══════════════════════════════════════════════
// LOADER: фетч дескриптора + параллельная загрузка модулей
// ══════════════════════════════════════════════

function moduleCategory(id) {
  if (id === 'wall_segment' || id === 'pillar')           return 'walls';
  if (id.startsWith('window_') || id === 'dormer')        return 'windows';
  if (id.startsWith('door_'))                              return 'doors';
  if (id.startsWith('base_'))                              return 'base';
  if (id.startsWith('roof_'))                              return 'roof';
  return 'decor';
}

function collectModuleIds(desc) {
  const ids = new Set();
  // Базовый набор для любого дома
  ids.add('wall_segment');
  ids.add('pillar');
  ids.add('base_segment');
  ids.add('base_pillar');
  // По типу крыши
  const roofMods = {
    hip:   ['roof_hip_slope', 'roof_hip_ridge'],
    gable: ['roof_gable_slope', 'roof_gable_front'],
    flat:  ['roof_flat_edge'],
  };
  (roofMods[desc.roof_type] || []).forEach(m => ids.add(m));
  // Сканируем периметр на ссылки на window/door
  for (const floor of desc.floors) {
    for (const cmd of floor.perimeter) {
      if (typeof cmd !== 'object' || cmd._comment !== undefined) continue;
      if (cmd.facade === 'auto_windows' && cmd.window_type) {
        ids.add('window_' + cmd.window_type);
      } else if (Array.isArray(cmd.facade)) {
        for (const el of cmd.facade) {
          if (el.window) ids.add('window_' + el.window);
          if (el.door)   ids.add('door_'   + el.door);
        }
      }
    }
  }
  return ids;
}

async function loadHouseType(typeId) {
  // Spec convention: filenames like assets/houses/house_<typeId>.json (typeId = "type_a" → "house_type_a.json")
  const url = `assets/houses/house_${typeId}.json`;
  log(`[loader] Fetch descriptor: ${url}`);
  const desc = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${url}`);
    return r.json();
  });
  log(`[loader] Descriptor: "${desc.name}" — ${desc.roof_type} roof, ${desc.floors.length} floor(s)`, 'ok');

  const moduleIds = collectModuleIds(desc);
  log(`[loader] Modules to fetch (${moduleIds.size}): ${[...moduleIds].join(', ')}`, 'dim');

  const gltfLoader = new THREE.GLTFLoader();
  const modules = {};
  await Promise.all([...moduleIds].map(id => new Promise(resolve => {
    const path = `assets/houses/modules/${moduleCategory(id)}/mod_${id}.glb`;
    gltfLoader.load(
      path,
      gltf => { modules[id] = gltf.scene; resolve(); },
      undefined,
      () => { log(`[loader] ⚠ missing: ${path}`, 'warn'); modules[id] = null; resolve(); }
    );
  })));

  const ok = Object.values(modules).filter(Boolean).length;
  log(`[loader] Loaded ${ok}/${moduleIds.size} modules`, ok === moduleIds.size ? 'ok' : 'warn');

  return { desc, modules };
}

// ══════════════════════════════════════════════
// EVAL: безопасное вычисление выражений из vars
// (input — наш собственный JSON, не пользовательский ввод)
// ══════════════════════════════════════════════
function evalExpr(expr, vars) {
  if (typeof expr === 'number') return expr;
  const replaced = String(expr).replace(/\bsqrt\b/g, 'Math.sqrt');
  const argNames = Object.keys(vars);
  const argVals = argNames.map(n => vars[n]);
  try {
    return new Function(...argNames, `"use strict"; return (${replaced});`)(...argVals);
  } catch (e) {
    log(`[eval] "${expr}" failed: ${e.message}`, 'err');
    return 0;
  }
}

function evalVars(varsObj, context) {
  const vars = { ...context };
  for (const [name, expr] of Object.entries(varsObj)) {
    if (name.startsWith('_')) continue;
    vars[name] = evalExpr(expr, vars);
  }
  return vars;
}

// ══════════════════════════════════════════════
// OUTLINE: turtle-graphics обход периметра
// Возвращает плоский список items: pillars (на углах) + walls (между ними)
// ══════════════════════════════════════════════
function computeOutline(perimeter, vars, pillarSize) {
  let x = 0, z = 0;
  let dx = 1, dz = 0;          // стартуем лицом на +X
  const items = [];
  let bbMinX = 0, bbMaxX = 0, bbMinZ = 0, bbMaxZ = 0;

  for (const cmd of perimeter) {
    // Не делаем early continue по _comment — он может присутствовать рядом
    // с действительной командой (run/turn). Если ни run, ни turn нет — игнорим.
    if (cmd.run !== undefined) {
      const len = evalExpr(cmd.run, vars);
      items.push({
        type: 'wall',
        x, z, dx, dz,
        runLength: len,
        // wallLength, startOffset, endOffset — заполняем во втором проходе,
        // когда известны типы поворотов соседних pillar'ов.
        facade: cmd.facade,
        window_type: cmd.window_type,
        min_margin: cmd.min_margin || 1.0,
      });
      x += dx * len;
      z += dz * len;
      bbMinX = Math.min(bbMinX, x); bbMaxX = Math.max(bbMaxX, x);
      bbMinZ = Math.min(bbMinZ, z); bbMaxZ = Math.max(bbMaxZ, z);
    } else if (cmd.turn !== undefined) {
      // turn>0 = inward (CW), turn<0 = outward (concave). Сохраняем для расчёта offset'ов стен.
      items.push({ type: 'pillar', x, z, turn: cmd.turn });
      const rad = cmd.turn * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const ndx = dx * c - dz * s;
      const ndz = dx * s + dz * c;
      dx = Math.round(ndx);
      dz = Math.round(ndz);
    }
  }

  // Аннотируем каждый pillar interior-квадрантом (sx, sz) — куда уходит тело
  // относительно угла. Знаки берём как сумму interior направлений соседних стен:
  //   interior(edge) = (-edge.dz, edge.dx)  [для CW обхода]
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'pillar') continue;
    const prev = items[(i - 1 + items.length) % items.length];
    const next = items[(i + 1) % items.length];
    if (prev.type !== 'wall' || next.type !== 'wall') continue;
    const inX = (-prev.dz) + (-next.dz);
    const inZ = prev.dx + next.dx;
    item.sx = Math.sign(inX) || 1;
    item.sz = Math.sign(inZ) || 1;
  }

  // Аннотируем каждую WALL её startOffset / endOffset / wallLength.
  // Логика:
  //   • inward (turn > 0): pillar занимает ps в направлении ЛОКАЛЬНОЙ стены
  //     (тело pillar'а в interior-квадранте лежит вдоль перимeтра). Стена должна
  //     уйти на ps от угла, чтобы не пересечься с pillar'ом → offset = ps.
  //   • outward (turn < 0, concave-corner): тело pillar'а уходит ПОПЕРЁК
  //     перимeтра (в сторону interior). Стена идёт прямо до угла → offset = 0.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'wall') continue;
    const startPillar = items[(i - 1 + items.length) % items.length];
    const endPillar   = items[(i + 1) % items.length];
    const startTurn = (startPillar && startPillar.type === 'pillar') ? startPillar.turn : 90;
    const endTurn   = (endPillar   && endPillar.type   === 'pillar') ? endPillar.turn   : 90;
    item.startOffset = (startTurn > 0) ? pillarSize : 0;
    item.endOffset   = (endTurn   > 0) ? pillarSize : 0;
    item.wallLength  = item.runLength - item.startOffset - item.endOffset;
  }

  if (Math.abs(x) > 0.01 || Math.abs(z) > 0.01) {
    log(`[outline] ⚠ contour not closed: Δx=${x.toFixed(3)}, Δz=${z.toFixed(3)}`, 'warn');
  } else {
    log(`[outline] ✓ contour closed; ${items.filter(i => i.type === 'wall').length} edges`, 'ok');
  }

  return { items, bbox: { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ } };
}

// ══════════════════════════════════════════════
// FILLS: разрешение элементов фасада в полосы заданной ширины
// ══════════════════════════════════════════════
function asValue(rangeOrNum, fallback) {
  if (rangeOrNum === undefined || rangeOrNum === null) return fallback;
  if (typeof rangeOrNum === 'number') return rangeOrNum;
  if (typeof rangeOrNum === 'object' && rangeOrNum.default !== undefined) return rangeOrNum.default;
  return fallback;
}

function makeWindowFill(modulesDef, variant, override) {
  const def = modulesDef['window_' + variant];
  if (!def) { log(`[fills] no def for window_${variant}`, 'err'); return null; }
  const dW = asValue(def.w, 0.9);
  const dH = asValue(def.h, 1.2);
  const dY = asValue(def.y, 0.9);
  return {
    type: 'window',
    model: 'window_' + variant,
    width: override.w !== undefined ? override.w : dW,
    params: {
      w:  override.w !== undefined ? override.w : dW,
      h:  override.h !== undefined ? override.h : dH,
      y:  override.y !== undefined ? override.y : dY,
      dW, dH,
      frame_profile: def.frame_profile || 0.05,
      sill_overhang: def.sill_overhang || 0.03,
    }
  };
}

function makeDoorFill(modulesDef, variant, override) {
  const def = modulesDef['door_' + variant];
  if (!def) { log(`[fills] no def for door_${variant}`, 'err'); return null; }
  const dW = asValue(def.w, 0.9);
  const dH = asValue(def.h, 2.1);
  return {
    type: 'door',
    model: 'door_' + variant,
    width: override.w !== undefined ? override.w : dW,
    params: {
      w:  override.w !== undefined ? override.w : dW,
      h:  override.h !== undefined ? override.h : dH,
      y:  0,
      dW, dH,
      frame_profile: def.frame_profile || 0.05,
      leaves: def.leaves,
      mechanism: def.mechanism,
    }
  };
}

function resolveFills(edge, modulesDef) {
  const wallLength = edge.wallLength;
  const facade = edge.facade;

  // Авто-окна
  if (facade === 'auto_windows') {
    const wt = edge.window_type || 'single';
    const def = modulesDef['window_' + wt];
    if (!def) return [{ type: 'wall', width: wallLength }];
    const winW = asValue(def.w, 0.9);
    const winH = asValue(def.h, 1.2);
    const winY = asValue(def.y, 0.9);
    const minMargin = edge.min_margin;
    const winCount = Math.max(1, Math.floor(wallLength / (winW + minMargin * 2)));
    const margin = (wallLength - winCount * winW) / (winCount + 1);
    if (margin < 0.05) return [{ type: 'wall', width: wallLength }];
    const fills = [];
    for (let i = 0; i < winCount; i++) {
      fills.push({ type: 'wall', width: margin });
      fills.push({
        type: 'window', model: 'window_' + wt, width: winW,
        params: { w: winW, h: winH, y: winY, dW: winW, dH: winH,
                  frame_profile: def.frame_profile || 0.05,
                  sill_overhang: def.sill_overhang || 0.03 }
      });
    }
    fills.push({ type: 'wall', width: margin });
    return fills;
  }

  if (!Array.isArray(facade)) return [{ type: 'wall', width: wallLength }];

  const resolved = facade.map(el => {
    if (el.wall !== undefined) {
      const isFill = el.wall === 'fill';
      return { type: 'wall', width: isFill ? null : el.wall, isFill };
    }
    if (el.window) return makeWindowFill(modulesDef, el.window, el);
    if (el.door)   return makeDoorFill(modulesDef, el.door, el);
    return null;
  }).filter(Boolean);

  // Распределяем 'fill' между фиксированными
  const fixedSum = resolved.filter(f => !f.isFill).reduce((s, f) => s + f.width, 0);
  const fillCount = resolved.filter(f => f.isFill).length;
  if (fillCount > 0) {
    const fillWidth = (wallLength - fixedSum) / fillCount;
    if (fillWidth < 0.05) {
      log(`[fills] not enough room (wall=${wallLength.toFixed(2)}, fixed=${fixedSum.toFixed(2)})`, 'err');
    }
    resolved.forEach(f => { if (f.isFill) f.width = Math.max(0.05, fillWidth); });
  } else if (Math.abs(wallLength - fixedSum) > 0.01) {
    // Нет fills вообще, а fixedSum != wallLength → стена не покрыта целиком.
    // Логируем warn (раньше это давало невидимую «дыру» в фасаде).
    const gap = wallLength - fixedSum;
    log(`[fills] ⚠ no fills, but ${gap > 0 ? 'gap' : 'overflow'} ${gap.toFixed(2)} м (wall=${wallLength.toFixed(2)}, fixed=${fixedSum.toFixed(2)}). Добавь { "wall": "fill" } в facade.`, 'warn');
  }
  return resolved;
}

// ══════════════════════════════════════════════
// BUILDERS
// ══════════════════════════════════════════════

function cloneModule(modules, id) {
  const src = modules[id];
  if (!src) { log(`[clone] missing module: ${id}`, 'err'); return null; }
  const clone = src.clone(true);
  // Material clone — нужен для возможности подмены, не задевая источник
  clone.traverse(c => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      c.material = Array.isArray(c.material)
        ? mats.map(m => m.clone())
        : mats[0].clone();
      // Сохраняем оригинальное имя для подмены через mat_*
      if (Array.isArray(c.material)) c.material.forEach((m, i) => m.name = mats[i].name);
      else                            c.material.name = mats[0].name;
    }
  });
  return clone;
}

function setupShadows(obj) {
  obj.traverse(c => {
    if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
  });
}

// Алиасы legacy-имён → канонические по спеке (см. ARCHITECTURE.md)
const NAME_ALIASES = { 'Glass': 'glass', 'treshold': 'threshold', 'Handle': 'handle' };
const canonName = (n) => NAME_ALIASES[n] || n;

// Детектирует нативные размеры параметрического модуля из bbox-ов его детей.
// Это нужно потому, что spec алгоритм (section 5.2) предполагает origin
// frame_right/frame_top на ВНЕШНЕЙ грани, а наши legacy GLB имеют origin
// на МИНИМАЛЬНОЙ грани (стандартное Blender-моделирование).
// Также реальные дефолты из GLB могут не совпадать с дескриптором.
function detectNativeDims(group) {
  const native = {
    nativeW: 0,
    nativeH: 0,
    jambW: 0.05,    // thickness вертикальных стоек
    headerH: 0.05,  // thickness верхней перекладины
    bottomH: 0.05,  // thickness нижней перекладины (для окон)
  };
  group.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const name = canonName(child.name);
    const pos = child.geometry.attributes.position;
    if (!pos) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const sizeX = maxX - minX, sizeY = maxY - minY;
    // World-space расширение (учитываем child.position)
    const xMaxWorld = child.position.x + maxX;
    const yMaxWorld = child.position.y + maxY;
    if (name === 'frame_left')   native.jambW = sizeX;
    if (name === 'frame_right')  native.nativeW = Math.max(native.nativeW, xMaxWorld);
    if (name === 'frame_top')   { native.headerH = sizeY; native.nativeH = Math.max(native.nativeH, yMaxWorld); }
    if (name === 'frame_bottom') native.bottomH = sizeY;
    // Если frame_top отсутствует, попробуем оценить по leaf_main (дверь без frame_top — редкий случай)
    if (name === 'leaf_main' && native.nativeH === 0) native.nativeH = yMaxWorld;
  });
  if (native.nativeW === 0) native.nativeW = 1.0;
  if (native.nativeH === 0) native.nativeH = 1.0;
  return native;
}

function transformParametricModule(group, params) {
  // ВАЖНО: используем detected-native, а не descriptor defaults — иначе
  // расхождение между моделью GLB и дескриптором даёт ошибки позиционирования.
  const native = detectNativeDims(group);
  const w = params.w, h = params.h;
  const dW = native.nativeW;
  const dH = native.nativeH;
  const jambW = native.jambW;
  const headerH = native.headerH;
  const bottomH = native.bottomH;
  const so = params.sill_overhang || 0;

  // Native sizes для glass и opening
  const nativeOpenW = Math.max(0.01, dW - 2 * jambW);
  const nativeOpenH = Math.max(0.01, dH - headerH - bottomH);
  const targetOpenW = Math.max(0.01, w - 2 * jambW);
  const targetOpenH = Math.max(0.01, h - headerH - bottomH);

  group.traverse(child => {
    const name = canonName(child.name);
    switch (name) {
      case 'frame_left':
        child.position.x = 0;
        child.scale.y = h / dH;
        break;
      case 'frame_right':
        // FIXED: было w, стало w - jambW (origin на левой грани frame_right)
        child.position.x = w - jambW;
        child.scale.y = h / dH;
        break;
      case 'frame_top':
        // FIXED: было h, стало h - headerH (origin на нижней грани header)
        child.position.y = h - headerH;
        child.scale.x = w / dW;
        break;
      case 'frame_bottom':
        child.position.y = 0;
        child.scale.x = w / dW;
        break;
      case 'sill': {
        // Подоконник может быть длиннее проёма на 2*sill_overhang
        const dSW = dW + so * 2;
        child.scale.x = (w + so * 2) / dSW;
        break;
      }
      case 'glass':
        child.position.x = w / 2;
        child.position.y = h / 2;
        child.scale.x = targetOpenW / nativeOpenW;
        child.scale.y = targetOpenH / nativeOpenH;
        break;
      case 'curtain':
        child.position.x = w / 2;
        child.position.y = h / 2;
        child.scale.x = w / dW;
        child.scale.y = h / dH;
        break;
      case 'mullion_v':
        child.position.x = w / 2;
        child.scale.y = h / dH;
        break;
      case 'mullion_h':
        child.position.y = h / 2;
        child.scale.x = w / dW;
        break;
      case 'flashing':
        child.scale.x = w / dW;
        child.scale.y = h / dH;
        break;
      case 'threshold':
        // FIXED: native t.y = -0.067 загоняло порог внутрь фундамента.
        // Поднимаем порог до Y=0 (на верх фундамента, полностью видимый).
        child.position.y = 0;
        child.scale.x = w / dW;
        break;
      case 'leaf_main': {
        let leafW;
        if (params.leaves === 1.5)                 leafW = targetOpenW * 0.67;
        else if (params.leaves === 2)              leafW = targetOpenW / 2;
        else if (params.mechanism === 'slide')     leafW = w / (params.leaves || 1);
        else                                       leafW = targetOpenW;
        child.scale.x = leafW / nativeOpenW;
        child.scale.y = h / dH;
        break;
      }
      case 'leaf_minor': {
        let minorW;
        if (params.leaves === 1.5)                                    minorW = targetOpenW * 0.33;
        else if (params.leaves === 2 && params.mechanism === 'slide') minorW = w / 2;
        else                                                           minorW = targetOpenW / 2;
        child.scale.x = minorW / (nativeOpenW / 2);
        child.scale.y = h / dH;
        break;
      }
      case 'rail_top':
      case 'rail_bottom':
        child.scale.x = w / dW;
        break;
      // handle, handle_minor — не трансформируем (фиксированный размер)
    }
  });
}

// Поворот, при котором OUTER FACE модуля смотрит в exterior:
// ry = π - atan2(dz, dx)
// При этом local +X → world -(dx,dz), поэтому модуль позиционируется
// в КОНЕЦ сегмента и «рисуется назад» к началу.
function edgeRotation(dx, dz) { return Math.PI - Math.atan2(dz, dx); }

// Pillar полностью в interior-квадранте от угла. Тело local X[0,ps] Z[-ps,0]:
//   sx > 0: pos.x = item.x      (тело +X от угла)
//   sx < 0: pos.x = item.x - ps  (тело -X от угла)
//   sz > 0: pos.z = item.z + ps  (тело +Z от угла, т.к. body в local -Z)
//   sz < 0: pos.z = item.z      (тело -Z от угла)
function pillarPosition(item, ps) {
  const sx = item.sx || 1, sz = item.sz || 1;
  return {
    x: (sx > 0) ? item.x : item.x - ps,
    z: (sz > 0) ? item.z + ps : item.z,
  };
}

function buildPillar(parent, modules, item, wallH, yOffset, ps) {
  const p = cloneModule(modules, 'pillar');
  if (!p) return;
  p.scale.set(ps, wallH, ps);
  const pos = pillarPosition(item, ps);
  p.position.set(pos.x, yOffset, pos.z);
  setupShadows(p);
  parent.add(p);
}

function buildBasePillar(parent, modules, item, baseH, ps, overhang) {
  const p = cloneModule(modules, 'base_pillar') || cloneModule(modules, 'pillar');
  if (!p) return;
  const psExt = ps + overhang;
  p.scale.set(psExt, baseH, psExt);
  // Pillar в interior-квадранте от угла + расширение наружу на overhang.
  // sx > 0: pos.x = item.x - overhang  (тело +X[item.x-overhang, item.x+ps])
  // sx < 0: pos.x = item.x - ps        (тело -X[item.x-ps, item.x+overhang])
  // sz > 0: pos.z = item.z + ps        (т.к. body local -Z, world Z[item.z-overhang, item.z+ps])
  // sz < 0: pos.z = item.z + overhang  (world Z[item.z-ps, item.z+overhang])
  const sx = item.sx || 1, sz = item.sz || 1;
  const posX = (sx > 0) ? item.x - overhang : item.x - ps;
  const posZ = (sz > 0) ? item.z + ps : item.z + overhang;
  p.position.set(posX, 0, posZ);
  setupShadows(p);
  parent.add(p);
}

function buildEdgeWall(parent, modules, modulesDef, edge, wallH, yOffset, wt, ps) {
  const fills = resolveFills(edge, modulesDef);

  // Смещения зависят от типа угла (inward/outward) — заданы computeOutline'ом
  const startX = edge.x + edge.dx * edge.startOffset;
  const startZ = edge.z + edge.dz * edge.startOffset;
  const ry = edgeRotation(edge.dx, edge.dz);

  let cursor = 0;
  for (const fill of fills) {
    // Позиционируем в КОНЕЦ заполнителя — модуль развернётся назад на свою длину
    const endX = startX + edge.dx * (cursor + fill.width);
    const endZ = startZ + edge.dz * (cursor + fill.width);
    const sillY = (fill.params && fill.params.y) || 0;

    if (fill.type === 'wall') {
      const seg = cloneModule(modules, 'wall_segment');
      if (seg) {
        // Native Z thickness в GLB = 0.2; масштабируем до wt из дескриптора
        seg.scale.set(fill.width, wallH, wt / 0.2);
        seg.position.set(endX, yOffset, endZ);
        seg.rotation.y = ry;
        setupShadows(seg);
        parent.add(seg);
      }
    } else if (fill.type === 'window' || fill.type === 'door') {
      const mod = cloneModule(modules, fill.model);
      if (mod) {
        transformParametricModule(mod, fill.params);
        mod.position.set(endX, yOffset + sillY, endZ);
        mod.rotation.y = ry;
        setupShadows(mod);
        parent.add(mod);

        // Перемычка над проёмом
        const topH = wallH - (sillY + fill.params.h);
        if (topH > 0.05) {
          const lintel = cloneModule(modules, 'wall_segment');
          if (lintel) {
            lintel.scale.set(fill.width, topH, wt / 0.2);
            lintel.position.set(endX, yOffset + sillY + fill.params.h, endZ);
            lintel.rotation.y = ry;
            setupShadows(lintel);
            parent.add(lintel);
          }
        }

        // Стена под подоконником (только для окон)
        if (fill.type === 'window' && sillY > 0.05) {
          const sub = cloneModule(modules, 'wall_segment');
          if (sub) {
            sub.scale.set(fill.width, sillY, wt / 0.2);
            sub.position.set(endX, yOffset, endZ);
            sub.rotation.y = ry;
            setupShadows(sub);
            parent.add(sub);
          }
        }
      }
    }

    cursor += fill.width;
  }
}

function buildBaseFromOutline(parent, modules, outline, baseH, wt, ps, overhang) {
  const exteriorWt = wt + overhang;  // фундамент толще стены на overhang (наружу)
  for (const item of outline.items) {
    if (item.type === 'pillar') {
      buildBasePillar(parent, modules, item, baseH, ps, overhang);
    } else if (item.type === 'wall') {
      // Используем те же турно-зависимые offset'ы, что и у стен
      const startX = item.x + item.dx * item.startOffset;
      const startZ = item.z + item.dz * item.startOffset;
      const wallLength = item.wallLength;
      if (wallLength <= 0.01) continue;
      const seg = cloneModule(modules, 'base_segment') || cloneModule(modules, 'wall_segment');
      if (!seg) continue;
      const endX = startX + item.dx * wallLength;
      const endZ = startZ + item.dz * wallLength;
      // Сдвиг наружу на overhang: exterior = (dz, -dx) * overhang
      const offX = endX + item.dz * overhang;
      const offZ = endZ - item.dx * overhang;
      seg.scale.set(wallLength, baseH, exteriorWt / 0.2);
      seg.position.set(offX, 0, offZ);
      seg.rotation.y = edgeRotation(item.dx, item.dz);
      setupShadows(seg);
      parent.add(seg);
    }
  }
}

// ══════════════════════════════════════════════
// HIP ROOF (процедурная геометрия)
// 4 угла основания (с eave) + 2 точки конька = 6 вершин.
// 2 трапеции (длинные скаты) + 2 треугольника (короткие).
// ══════════════════════════════════════════════
function buildHipRoof(parent, baseY, bbox, angleDeg, eave) {
  const x0 = bbox.minX - eave;
  const x1 = bbox.maxX + eave;
  const z0 = bbox.minZ - eave;
  const z1 = bbox.maxZ + eave;
  const L = x1 - x0;
  const W = z1 - z0;
  const longAxisX = L >= W;
  const halfShort = (longAxisX ? W : L) / 2;
  const rise = halfShort * Math.tan((angleDeg || 22) * Math.PI / 180);
  const ridgeY = baseY + rise;
  const ridgeLen = Math.abs(L - W);

  let v4, v5;
  if (longAxisX) {
    const ridgeZ = (z0 + z1) / 2;
    const rx0 = x0 + (L - ridgeLen) / 2;
    const rx1 = rx0 + ridgeLen;
    v4 = [rx0, ridgeY, ridgeZ];
    v5 = [rx1, ridgeY, ridgeZ];
  } else {
    const ridgeX = (x0 + x1) / 2;
    const rz0 = z0 + (W - ridgeLen) / 2;
    const rz1 = rz0 + ridgeLen;
    v4 = [ridgeX, ridgeY, rz0];
    v5 = [ridgeX, ridgeY, rz1];
  }

  const verts = [
    [x0, baseY, z0],   // 0: SW (юго-запад)
    [x1, baseY, z0],   // 1: SE
    [x1, baseY, z1],   // 2: NE
    [x0, baseY, z1],   // 3: NW
    v4, v5,            // 4, 5: концы конька
  ];

  // Winding выбран так, чтобы нормали смотрели НАРУЖУ (вверх+в сторону).
  let triangles;
  if (longAxisX) {
    triangles = [
      [0, 4, 5], [0, 5, 1],   // South (длинная трапеция)
      [2, 4, 3], [2, 5, 4],   // North (длинная трапеция)
      [0, 3, 4],              // West (треугольник)
      [1, 5, 2],              // East (треугольник)
    ];
  } else {
    // ridge вдоль Z; W > L
    triangles = [
      [0, 3, 5], [0, 5, 4],   // West
      [2, 1, 4], [2, 4, 5],   // East
      [0, 4, 1],              // South
      [3, 2, 5],              // North
    ];
  }

  const positions = [];
  const indices = [];
  for (const v of verts) positions.push(...v);
  for (const t of triangles) indices.push(...t);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x8b3a3a,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,    // на всякий случай — обе стороны видимы
  });
  mat.name = 'mat_roof';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof] hip: rise=${rise.toFixed(2)}m, ridgeLen=${ridgeLen.toFixed(2)}m, eave=${eave}`, 'dim');
}

// Gable roof: 2 прямоугольных ската + 2 треугольных фронтона (mat_wall).
// Конёк идёт от края до края по длинной оси (без укорочения, в отличие от hip).
function buildGableRoof(parent, baseY, bbox, angleDeg, eave) {
  const x0 = bbox.minX - eave;
  const x1 = bbox.maxX + eave;
  const z0 = bbox.minZ - eave;
  const z1 = bbox.maxZ + eave;
  const longAxisX = (bbox.maxX - bbox.minX) >= (bbox.maxZ - bbox.minZ);

  let v4, v5, rise;
  if (longAxisX) {
    const halfShort = (z1 - z0) / 2;
    rise = halfShort * Math.tan((angleDeg || 30) * Math.PI / 180);
    const ridgeY = baseY + rise;
    const ridgeZ = (z0 + z1) / 2;
    v4 = [x0, ridgeY, ridgeZ];   // ridge west end (от края до края — без укорочения)
    v5 = [x1, ridgeY, ridgeZ];
  } else {
    const halfShort = (x1 - x0) / 2;
    rise = halfShort * Math.tan((angleDeg || 30) * Math.PI / 180);
    const ridgeY = baseY + rise;
    const ridgeX = (x0 + x1) / 2;
    v4 = [ridgeX, ridgeY, z0];
    v5 = [ridgeX, ridgeY, z1];
  }

  const verts = [
    [x0, baseY, z0],   // 0
    [x1, baseY, z0],   // 1
    [x1, baseY, z1],   // 2
    [x0, baseY, z1],   // 3
    v4, v5,
  ];

  // Скаты (mat_roof) и фронтоны (mat_wall) — отдельные меши, разные материалы
  let slopeTriangles, gableTriangles;
  if (longAxisX) {
    slopeTriangles = [
      [0, 5, 1], [0, 4, 5],   // South — длинный прямоугольник (наружу +Y, -Z)
      [2, 4, 3], [2, 5, 4],   // North — длинный прямоугольник (наружу +Y, +Z)
    ];
    gableTriangles = [
      [3, 0, 4],   // West — треугольный фронтон (вертикальный)
      [1, 2, 5],   // East — треугольный фронтон
    ];
  } else {
    // Конёк по Z; W > L
    slopeTriangles = [
      [0, 5, 3], [0, 4, 5],   // West
      [2, 4, 1], [2, 5, 4],   // East
    ];
    gableTriangles = [
      [0, 1, 4],   // South
      [2, 3, 5],   // North
    ];
  }

  function makeMesh(triangles, color, matName) {
    const positions = [];
    const indices = [];
    for (const v of verts) positions.push(...v);
    for (const t of triangles) indices.push(...t);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
    });
    mat.name = matName;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }

  makeMesh(slopeTriangles, 0x8b3a3a, 'mat_roof');
  makeMesh(gableTriangles, 0xf5e6c8, 'mat_wall');
  log(`[roof] gable: rise=${rise.toFixed(2)}m, eave=${eave}`, 'dim');
}

// Плоская крыша по РЕАЛЬНОМУ полигону outline (через THREE.Shape + ExtrudeGeometry).
// Корректно работает для не-выпуклых форм (L, П, T, +) благодаря встроенному Earcut.
// Eave не применяется (для произвольного полигона требует Minkowski offset, не делаем для теста).
function buildFlatRoofPoly(parent, baseY, outline, eave) {
  const corners = outline.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) { log('[roof] flat poly: <3 corners', 'warn'); return; }

  // Строим геометрию НАПРЯМУЮ через ShapeUtils.triangulateShape (= Earcut),
  // без ExtrudeGeometry. Это даёт явный контроль над тем, что попадает в меш,
  // и обходит особенности обработки autoClose / depth-направления в r128.

  // Полигон в плановом X-Z. Спека ходит CW в плане; для построения top-face
  // нам нужен такой порядок вершин, чтобы при взгляде сверху (с +Y) они шли CCW.
  // С Y-up конвенцией в Three.js это означает: проходим вершины
  // в плановом CW порядке, но т.к. мы смотрим снизу-вверх (как камера на грунт),
  // оригинальный CW в плане = CCW при взгляде сверху на крышу.
  // Reverse НЕ нужен.
  const points2D = corners.map(c => new THREE.Vector2(c.x, c.z));
  log(`[roof] poly corners: ${points2D.map(p => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' → ')}`, 'dim');

  // Триангуляция полигона (Earcut)
  const triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
  log(`[roof] triangulated into ${triangles.length} triangles`, 'dim');

  // Строим BufferGeometry: top-плита + bottom-плита + вертикальные стенки по периметру
  const slabH = 0.10;        // толщина крыши
  const yTop = baseY + slabH;
  const yBot = baseY;

  const positions = [];
  const indices = [];
  const N = points2D.length;

  // Верхние вершины (Y = yTop), индексы [0..N-1]
  for (const p of points2D) positions.push(p.x, yTop, p.y);
  // Нижние вершины (Y = yBot), индексы [N..2N-1]
  for (const p of points2D) positions.push(p.x, yBot, p.y);

  // Top-face треугольники (нормаль вверх) — обход CCW при взгляде сверху,
  // т.к. камера смотрит вниз, нужно обратное (CW в shape coords).
  // Earcut вернул индексы для оригинального CCW; для top-face оставляем как есть.
  for (const t of triangles) indices.push(t[0], t[1], t[2]);
  // Bottom-face: сдвигаем индексы на +N и обратный winding (нормаль вниз)
  for (const t of triangles) indices.push(t[0] + N, t[2] + N, t[1] + N);
  // Боковые стенки по периметру: для каждого ребра (i → next) — 2 треугольника
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const ti = i;          // top i
    const tj = j;          // top j
    const bi = i + N;      // bottom i
    const bj = j + N;      // bottom j
    // Винайдинг: внешняя нормаль смотрит наружу здания
    indices.push(ti, bj, bi);
    indices.push(ti, tj, bj);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x707070, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });
  mat.name = 'mat_roof';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof] flat (polygon): ${N} corners, ${triangles.length} triangles`, 'dim');
}

function buildRoof(parent, baseY, bbox, outline, roofType, angleDeg, eave) {
  if (roofType === 'flat')  return buildFlatRoofPoly(parent, baseY, outline, eave);
  if (roofType === 'gable') return buildGableRoof(parent, baseY, bbox, angleDeg, eave);
  return buildHipRoof(parent, baseY, bbox, angleDeg, eave);  // hip по умолчанию
}

// ══════════════════════════════════════════════
// MAIN BUILDER
// ══════════════════════════════════════════════
function buildHouseFromDescriptor(desc, modules, params) {
  log(`[builder] ── ${desc.name} ── area=${params.area}, floor_h=${params.floorH}cm, base_h=${params.baseH}cm`);

  // Очистка предыдущей сборки
  while (houseGroup.children.length) houseGroup.remove(houseGroup.children[0]);
  while (outlineGroup.children.length) outlineGroup.remove(outlineGroup.children[0]);

  const wt = desc.constraints.wall_thickness || 0.2;
  const ps = desc.constraints.pillar_size || wt;
  const baseH = params.baseH / 100;

  let yOffset = baseH;
  let lastOutline = null;
  let totalWallH = 0;

  for (let fi = 0; fi < desc.floors.length; fi++) {
    const floor = desc.floors[fi];
    // Высоту этажа берём из params (один UI-слайдер для упрощения)
    const wallH = params.floorH / 100;
    totalWallH += wallH;

    const vars = evalVars(floor.vars, { area: params.area });
    log(`[builder] floor ${fi} vars: ${Object.entries(vars).map(([k,v])=>`${k}=${v.toFixed(2)}`).join(', ')}`, 'dim');

    const outline = computeOutline(floor.perimeter, vars, ps);
    lastOutline = outline;

    if (fi === 0) {
      buildBaseFromOutline(houseGroup, modules, outline, baseH, wt, ps, FOUNDATION_OVERHANG);
    }

    for (const item of outline.items) {
      if (item.type === 'pillar') {
        buildPillar(houseGroup, modules, item, wallH, yOffset, ps);
      } else if (item.type === 'wall') {
        buildEdgeWall(houseGroup, modules, desc.modules, item, wallH, yOffset, wt, ps);
      }
    }

    yOffset += wallH;
  }

  // Крыша поверх верхнего этажа.
  // Для flat — используем РЕАЛЬНЫЙ полигон outline (поддерживает L/П/T-формы);
  // для hip/gable — пока bbox (на сложных формах будут артефакты, TODO).
  if (lastOutline) {
    const angleDef = desc.constraints.roof_angle;
    const angleDeg = (angleDef && angleDef.default !== undefined) ? angleDef.default : 22;
    buildRoof(houseGroup, yOffset, lastOutline.bbox, lastOutline, desc.roof_type || 'hip', angleDeg, ROOF_EAVE);
  }

  // Контур-overlay
  if ($('showOutline').checked && lastOutline) drawOutlineOverlay(lastOutline, baseH);

  // Применяем сохранённые material overrides
  for (const [slot, color] of Object.entries(_state.materialOverrides)) {
    applyMaterialOverride(slot, color);
  }

  // Камера: фрейм по bbox
  if (lastOutline && lastOutline.bbox.maxX > lastOutline.bbox.minX) {
    const bb = lastOutline.bbox;
    const cx = (bb.minX + bb.maxX) / 2;
    const cz = (bb.minZ + bb.maxZ) / 2;
    const sz = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
    controls.target.set(cx, baseH + totalWallH / 2, cz);
    // Камеру не сдвигаем при перестройке — пользователь мог её крутить
  }

  log(`[builder] ✓ done · ${houseGroup.children.length} объектов в сцене`, 'ok');
}

function drawOutlineOverlay(outline, y) {
  const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.8 });
  const points = [];
  for (const item of outline.items) {
    if (item.type === 'wall') {
      points.push(new THREE.Vector3(item.x, y + 0.02, item.z));
      points.push(new THREE.Vector3(item.x + item.dx * item.runLength, y + 0.02, item.z + item.dz * item.runLength));
    }
  }
  if (points.length) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    outlineGroup.add(new THREE.LineSegments(geo, mat));
  }
  // Маркеры в точках поворота
  const sphereGeo = new THREE.SphereGeometry(0.08, 8, 6);
  const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.9 });
  for (const item of outline.items) {
    if (item.type === 'pillar') {
      const m = new THREE.Mesh(sphereGeo, sphereMat);
      m.position.set(item.x, y + 0.05, item.z);
      outlineGroup.add(m);
    }
  }
}

// ══════════════════════════════════════════════
// MATERIAL OVERRIDE
// ══════════════════════════════════════════════
function applyMaterialOverride(slot, color) {
  let count = 0;
  houseGroup.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (m && m.name === slot) {
        m.color.set(color);
        count++;
      }
    }
  });
  return count;
}

function resetMaterialOverride(slot) {
  delete _state.materialOverrides[slot];
  rebuild(); // проще пересобрать со свежими клонами материалов
}

function setupMaterialControls(desc) {
  const container = $('materialControls');
  container.innerHTML = '';
  if (!desc.materials_map) return;
  for (const [slot, info] of Object.entries(desc.materials_map)) {
    if (!info.swappable) continue;
    const row = document.createElement('div');
    row.className = 'material-row';

    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = `${slot} — ${info.label}`;

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = _state.materialOverrides[slot] || '#cccccc';
    picker.oninput = () => {
      _state.materialOverrides[slot] = picker.value;
      const n = applyMaterialOverride(slot, picker.value);
      log(`[mat] ${slot} → ${picker.value} (${n} mesh${n === 1 ? '' : 'es'})`, 'dim');
    };

    const reset = document.createElement('button');
    reset.className = 'reset';
    reset.textContent = '×';
    reset.title = 'Сбросить';
    reset.onclick = () => resetMaterialOverride(slot);

    row.append(lbl, picker, reset);
    container.appendChild(row);
  }
}

// ══════════════════════════════════════════════
// UI WIRING
// ══════════════════════════════════════════════
async function rebuild() {
  const typeId = $('houseTypeSel').value;
  if (!_state.desc || _state.desc.id !== typeId) {
    try {
      const loaded = await loadHouseType(typeId);
      _state.desc = loaded.desc;
      _state.modules = loaded.modules;
      _state.materialOverrides = {}; // сбрасываем при смене типа
      setupMaterialControls(loaded.desc);
    } catch (e) {
      log(`[loader] FAIL: ${e.message}`, 'err');
      return;
    }
  }
  const params = {
    area:  parseFloat($('area').value),
    floorH: parseFloat($('floorH').value),
    baseH: parseFloat($('baseH').value),
  };
  buildHouseFromDescriptor(_state.desc, _state.modules, params);
}

function bindRange(rangeId, displayId) {
  const r = $(rangeId), d = $(displayId);
  let timer = null;
  const onChange = () => {
    d.textContent = r.value;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  };
  r.oninput = onChange;
}

window.addEventListener('DOMContentLoaded', () => {
  initScene();
  bindRange('area', 'vArea');
  bindRange('floorH', 'vFloor');
  bindRange('baseH', 'vBase');
  $('rebuildBtn').onclick = rebuild;
  $('houseTypeSel').onchange = () => { _state.desc = null; rebuild(); };
  $('showOutline').onchange = rebuild;
  $('showAxes').onchange = (e) => { axesHelper.visible = e.target.checked; };
  rebuild();
});
