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
// СОСТОЯНИЕ ИТЕРАЦИИ:
//   ✓ Стены, столбы, фундамент, окна (single/double/wide), двери (single/onehalf/double/slide×2)
//   ✓ Подмена материалов через mat_* имена (applyMaterialOverride)
//   ✓ Многоэтажность: 1, 1.5, 2+ этажа (floor.area_factor, floor.start_offset)
//   ✓ Крыша: hip, gable, gable_cross, flat — все через декомпозицию ortho-полигона на rectangles
//   ✓ Декор: cornice по периметру, chimney на крыше с правильной высотой, inter-floor cornice
//   ✓ 10 типов формы: rect (hip+gable), L, T, S, +, П, O с двором, 2-этажный, 1.5-этажный
//   ✗ Cornice на convex-углах остаётся зазор cd×cd — TODO: нужен mod_cornice_corner.glb с трапециевидным сечением
//   ✗ Porch (крыльцо: колонны + ступенька у входной двери) — модули есть, builder не написан
//   ✗ Dormer/velux (мансардные окна на скате) — модули есть, позиционирование на наклонной плоскости не реализовано
//   ✗ Mansard-крыша (наклонные стены 2-го этажа вместо вертикальных) — не реализовано
//   ✗ Handle двери обрезается при scale.x leaf'а — требует пересборки GLB (handle как sibling, не child of leaf)
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
    hip:         ['roof_hip_slope', 'roof_hip_ridge'],
    gable:       ['roof_gable_slope', 'roof_gable_front'],
    gable_cross: ['roof_gable_slope', 'roof_gable_front'],
    flat:        ['roof_flat_edge'],
  };
  (roofMods[desc.roof_type] || []).forEach(m => ids.add(m));
  // Декор по features-секции дескриптора
  if (desc.features) {
    if (desc.features.chimney)  ids.add('chimney');
    if (desc.features.gutters)  ids.add('gutter');
    if (desc.features.cornice)  ids.add('cornice');
    if (desc.features.downpipe) ids.add('downpipe');
    if (desc.features.porch)    { ids.add('porch_column'); ids.add('porch_step'); }
  }
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
  // Spec convention: filenames like assets/houses/house_<typeId>.json (typeId = "type_01" → "house_type_01.json")
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
function computeOutline(perimeter, vars, pillarSize, startX = 0, startZ = 0) {
  let x = startX, z = startZ;
  let dx = 1, dz = 0;          // стартуем лицом на +X
  const items = [];
  let bbMinX = startX, bbMaxX = startX, bbMinZ = startZ, bbMaxZ = startZ;

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
// Blender при дублировании добавляет ".001", ".002" — отсекаем суффикс перед поиском alias.
const canonName = (n) => {
  if (!n) return n;
  const base = n.replace(/\.\d+$/, '');
  return NAME_ALIASES[base] || base;
};

// Один раз на каждый тип модуля выводим в console.log имена и native-bbox всех meshes —
// помогает быстро видеть, чего детектор не нашёл (например, "Glass.001" вместо "glass").
const _dumpedTypes = new Set();
function dumpModuleParts(modelId, parts) {
  if (_dumpedTypes.has(modelId)) return;
  _dumpedTypes.add(modelId);
  console.groupCollapsed(`[parts] ${modelId} — детектированные части`);
  for (const [name, p] of Object.entries(parts)) {
    console.log(
      `  ${name.padEnd(16)} bbox X[${p.minX.toFixed(3)}..${p.maxX.toFixed(3)}] (size ${p.sizeX.toFixed(3)}) ` +
      `Y[${p.minY.toFixed(3)}..${p.maxY.toFixed(3)}] (size ${p.sizeY.toFixed(3)}) ` +
      `Z[${p.minZ.toFixed(3)}..${p.maxZ.toFixed(3)}] (size ${p.sizeZ.toFixed(3)}) ` +
      `pos(${p.posX.toFixed(3)}, ${p.posY.toFixed(3)})`
    );
  }
  console.groupEnd();
}

// Детектирует нативные размеры параметрического модуля из bbox-ов его детей.
// Это нужно потому, что spec алгоритм (section 5.2) предполагает origin
// frame_right/frame_top на ВНЕШНЕЙ грани, а наши legacy GLB имеют origin
// на МИНИМАЛЬНОЙ грани (стандартное Blender-моделирование).
// Также реальные дефолты из GLB могут не совпадать с дескриптором.
function detectNativeDims(group) {
  const native = {
    nativeW: 0,
    nativeH: 0,
    jambW: 0.05,    // thickness вертикальных стоек (по frame_left)
    headerH: 0.05,  // thickness верхней перекладины (по frame_top)
    bottomH: 0.05,  // thickness нижней перекладины (для окон) (по frame_bottom)
    parts: {},      // name → { minX, maxX, minY, maxY, sizeX, sizeY, posX, posY, centerX, centerY }
                    // Запоминаем bbox каждого меша, чтобы scale/position-формулы могли
                    // корректно учитывать реальные нативные размеры детали (а не предполагать,
                    // что glass = full opening, leaf = full opening и т.д.).
  };
  group.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const name = canonName(child.name);
    const pos = child.geometry.attributes.position;
    if (!pos) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    native.parts[name] = {
      minX, maxX, minY, maxY, minZ, maxZ, sizeX, sizeY, sizeZ,
      posX: child.position.x, posY: child.position.y,
      centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, centerZ: (minZ + maxZ) / 2,
    };
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

function transformParametricModule(group, params, modelId) {
  // ВАЖНО: используем detected-native, а не descriptor defaults — иначе
  // расхождение между моделью GLB и дескриптором даёт ошибки позиционирования.
  const native = detectNativeDims(group);
  const parts = native.parts;
  if (modelId) dumpModuleParts(modelId, parts);
  const w = params.w, h = params.h;
  const dW = native.nativeW;
  const dH = native.nativeH;
  const jambW = native.jambW;
  const headerH = native.headerH;
  const bottomH = native.bottomH;
  const so = params.sill_overhang || 0;

  // Целевые размеры открытия (между рамами)
  const targetOpenW = Math.max(0.01, w - 2 * jambW);
  const targetOpenH = Math.max(0.01, h - headerH - bottomH);
  const openMidY = bottomH + targetOpenH / 2;  // центр открытия по Y (для glass, mullions)

  // Хелпер: масштабировать меш по X так, чтобы его native bbox [minX..maxX] →
  // целевой диапазон [targetLeft..targetRight] в local-координатах группы.
  // Корректно работает для любого native posX/origin (центрированного, угового).
  function fitX(child, p, targetLeft, targetRight) {
    if (!p || p.sizeX < 0.001) return;
    const sx = (targetRight - targetLeft) / p.sizeX;
    child.scale.x = sx;
    child.position.x = targetLeft - p.minX * sx;
  }
  function fitY(child, p, targetBottom, targetTop) {
    if (!p || p.sizeY < 0.001) return;
    const sy = (targetTop - targetBottom) / p.sizeY;
    child.scale.y = sy;
    child.position.y = targetBottom - p.minY * sy;
  }
  // Для плоских квадов (sizeY≈0) реальная вертикаль может лежать в Z (legacy GLB,
  // где glass/curtain смоделированы в Blender как XY-plane → glTF XZ-plane).
  // Тогда «вертикальная» ось меша = local Z, а «толщина» по миру (после parent rotation) = Y world.
  // fitVertical выбирает ось автоматически.
  function fitVertical(child, p, targetBottom, targetTop) {
    if (!p) return;
    const targetH = targetTop - targetBottom;
    if (p.sizeY > 0.001) {
      const sy = targetH / p.sizeY;
      child.scale.y = sy;
      child.position.y = targetBottom - p.minY * sy;
    } else if (p.sizeZ > 0.001) {
      // Плоскость лежит в XZ. Масштабируем через scale.z; центр смещаем через position.y,
      // так как в final-сцене высота квада лежит вдоль world Y (благодаря parent rotation X = -π/2).
      const sz = targetH / p.sizeZ;
      child.scale.z = sz;
      child.position.y = (targetBottom + targetTop) / 2;
    }
  }

  group.traverse(child => {
    const name = canonName(child.name);
    const p = parts[name];
    switch (name) {
      case 'frame_left':
        // Левая стойка: левая грань на 0, правая на jambW. Высота — на всю h.
        if (p) {
          fitX(child, p, 0, jambW);
          fitY(child, p, 0, h);
        }
        break;
      case 'frame_right':
        // Правая стойка: правая грань на w, левая на w - sizeX (фиксированная толщина).
        if (p) {
          fitX(child, p, w - p.sizeX, w);
          fitY(child, p, 0, h);
        }
        break;
      case 'frame_top':
        // Верхняя перекладина: верхняя грань на h, нижняя на h - sizeY. Ширина — на всю w.
        if (p) {
          fitX(child, p, 0, w);
          fitY(child, p, h - p.sizeY, h);
        }
        break;
      case 'frame_bottom':
        // Нижняя перекладина: нижняя грань на 0, верхняя на sizeY. Ширина — на всю w.
        if (p) {
          fitX(child, p, 0, w);
          fitY(child, p, 0, p.sizeY);
        }
        break;
      case 'sill':
        // Подоконник: ширина = w + 2·sill_overhang, центрированно (учитывает any-origin).
        if (p) fitX(child, p, -so, w + so);
        break;
      case 'glass':
        // Стекло: точно по open-window прямоугольнику [jambW..w-jambW] × [bottomH..h-headerH].
        // У legacy GLB glass — плоский XZ-quad (sizeY=0), вертикаль лежит вдоль local Z;
        // fitVertical автоматически переключается между Y и Z в зависимости от ориентации меша.
        if (p) {
          fitX(child, p, jambW, w - jambW);
          fitVertical(child, p, bottomH, h - headerH);
        }
        break;
      case 'curtain':
        // Шторы — обычно за стеклом, тот же диапазон что glass.
        if (p) {
          fitX(child, p, jambW, w - jambW);
          fitVertical(child, p, bottomH, h - headerH);
        }
        break;
      case 'mullion_v':
        // Вертикальный средник: по центру открытия по X, по высоте от bottomH до h-headerH.
        if (p) {
          // Сохраняем native sizeX (ширина средника фиксирована), центрируем
          fitX(child, p, w / 2 - p.sizeX / 2, w / 2 + p.sizeX / 2);
          fitY(child, p, bottomH, h - headerH);
        }
        break;
      case 'mullion_h':
        // Горизонтальный средник: по ширине открытия, по центру открытия по Y.
        if (p) {
          fitX(child, p, jambW, w - jambW);
          fitY(child, p, openMidY - p.sizeY / 2, openMidY + p.sizeY / 2);
        }
        break;
      case 'flashing':
        // Оклад (для velux/dormer): копирует w × h.
        if (p) {
          fitX(child, p, 0, w);
          fitY(child, p, 0, h);
        }
        break;
      case 'threshold':
        // Порог: ширина = w. Y = 0 (на верх фундамента, поверх native -0.067 у legacy GLB).
        if (p) {
          fitX(child, p, 0, w);
          // По Y оставляем native размер, но position.y = 0 (поверх фундамента).
          child.position.y = 0;
        }
        break;
      case 'leaf_main': {
        // Главная створка. Native имеет уже правильные пропорции (для onehalf — ~0.67 от open,
        // для double — ~0.5, для slide — ~0.5 или 1.0). Мы ставим её НА ПЕТЛЮ (target_left = jambW)
        // и масштабируем по реальной ширине target main leaf.
        if (!p) break;
        let targetMainW;
        if (params.leaves === 1.5)             targetMainW = targetOpenW * 2 / 3;
        else if (params.leaves === 2)          targetMainW = targetOpenW / 2;
        else if (params.mechanism === 'slide') targetMainW = targetOpenW / Math.max(1, params.leaves || 1);
        else                                    targetMainW = targetOpenW;
        fitX(child, p, jambW, jambW + targetMainW);
        fitY(child, p, bottomH, h - headerH);
        break;
      }
      case 'leaf_minor': {
        // Дополнительная створка. Стоит правее main, занимает остаток открытия.
        if (!p) break;
        let mainW, minorW;
        if (params.leaves === 1.5) {
          mainW = targetOpenW * 2 / 3;
          minorW = targetOpenW * 1 / 3;
        } else if (params.leaves === 2 && params.mechanism === 'slide') {
          mainW = targetOpenW / 2;
          minorW = targetOpenW / 2;
        } else {
          mainW = targetOpenW / 2;
          minorW = targetOpenW / 2;
        }
        const minorLeft = jambW + mainW;
        fitX(child, p, minorLeft, minorLeft + minorW);
        fitY(child, p, bottomH, h - headerH);
        break;
      }
      case 'rail_top':
      case 'rail_bottom':
        // Рельсы раздвижной двери: на всю ширину рамы.
        if (p) fitX(child, p, 0, w);
        break;
      // handle, handle_minor — фиксированный размер. Их native position при ремасштабировании leaf
      // остаётся прежним; если они являются child of leaf_main в GLB, то наследуют scale parent.
      // В test-prototype не пытаемся это компенсировать — нужно пересобрать GLB как siblings.
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
        transformParametricModule(mod, fill.params, fill.model);
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
// ДЕКОР: chimney, gutters, cornice, downpipe, porch
// Размещаем по дескриптору features. Native GLB модули предполагаются:
//   • gutter:  длина 1м по X, origin на (0, 0, 0), идёт вдоль +X.
//   • cornice: то же.
//   • chimney: размер ~0.5×1×0.5 м, origin на min-X/min-Y/min-Z.
//   • downpipe: высота ~3м, диаметр ~0.1, origin внизу-снаружи.
//   • porch_column, porch_step: фиксированные.
// Если native размеры другие — детектим bbox и подгоняем.
// ══════════════════════════════════════════════
// Детектирует полный native bbox модуля (X, Y, Z) с учётом дочерних позиций.
function detectNativeBbox(mod) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  mod.traverse(c => {
    if (!c.isMesh || !c.geometry || !c.geometry.attributes.position) return;
    const pos = c.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = c.position.x + pos.getX(i);
      const y = c.position.y + pos.getY(i);
      const z = c.position.z + pos.getZ(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  });
  return { minX, maxX, minY, maxY, minZ, maxZ,
           sizeX: maxX - minX, sizeY: maxY - minY, sizeZ: maxZ - minZ };
}

function detectNativeSizeX(mod) {
  const bb = detectNativeBbox(mod);
  return Math.max(0.01, bb.sizeX);
}

// Один раз на каждый decor-модуль выводим в log-панель его bbox — помогает понять
// конвенцию native GLB (где origin, какой axis смотрит наружу и т.п.).
const _dumpedDecor = new Set();
function dumpDecorBbox(id, bb) {
  if (_dumpedDecor.has(id)) return;
  _dumpedDecor.add(id);
  log(
    `[decor-bbox] ${id}: X[${bb.minX.toFixed(3)}..${bb.maxX.toFixed(3)}] sizeX=${bb.sizeX.toFixed(3)} ` +
    `Y[${bb.minY.toFixed(3)}..${bb.maxY.toFixed(3)}] sizeY=${bb.sizeY.toFixed(3)} ` +
    `Z[${bb.minZ.toFixed(3)}..${bb.maxZ.toFixed(3)}] sizeZ=${bb.sizeZ.toFixed(3)}`,
    'dim'
  );
}

function buildDecorFromFeatures(parent, modules, desc, outline, baseY, wallTopY, angleDeg, eave, sharedCorniceMat) {
  if (!desc.features) return;
  let counts = { gutter: 0, cornice: 0, downpipe: 0, chimney: 0 };

  // Decomposition (нужно для расчёта высоты крыши в точке chimney)
  const rects = decomposeOrthoPolygonIntoRectangles(outline);
  const tanA = Math.tan((angleDeg || 22) * Math.PI / 180);

  // Gutters — водостоки вдоль карниза. Если cornice уже есть, gutter не рендерим
  // (они визуально дублируют друг друга — cornice = декоративная полоса под скатом,
  // gutter = тонкий водосток, и оба сидят на верху стены, перекрываясь).
  if (desc.features.gutters && !desc.features.cornice) {
    for (const item of outline.items) {
      if (item.type !== 'wall') continue;
      if (item.runLength < 0.5) continue;
      const g = cloneModule(modules, 'gutter');
      if (!g) break;
      const bb = detectNativeBbox(g);
      dumpDecorBbox('gutter', bb);
      g.scale.x = item.runLength / bb.sizeX;
      const endX = item.x + item.dx * item.runLength;
      const endZ = item.z + item.dz * item.runLength;
      // Сдвиг наружу в exterior direction (= world (dz, -dx)) на -bb.minZ,
      // чтобы Z-минимум gutter лёг на внешнюю грань стены.
      const shift = -bb.minZ;
      g.position.set(
        endX + item.dz * shift,
        wallTopY - bb.maxY,
        endZ - item.dx * shift
      );
      g.rotation.y = edgeRotation(item.dx, item.dz);
      setupShadows(g);
      parent.add(g);
      counts.gutter++;
    }
  }

  // Cornice — декоративный карниз. Native body в Z[-0.15..0] — direction body такая, что
  // после edgeRotation тело уходит ВНУТРЬ стены. Флипаем через scale.z = -1, тогда тело
  // (Z[0..0.15]) уходит в local +Z = world EXTERIOR.
  // На convex-углах cornice двух перпендикулярных стен оставляют дыру cd×cd
  // (cd = cornice depth). Закрываем её отдельным "угловым блоком" — BoxGeometry размером
  // cd × sizeY × cd, поставленным на каждом convex pillar в outer-corner-квадранте.
  if (desc.features.cornice) {
    for (const item of outline.items) {
      if (item.type !== 'wall') continue;
      if (item.runLength < 0.5) continue;
      const c = cloneModule(modules, 'cornice');
      if (!c) break;
      const bb = detectNativeBbox(c);
      dumpDecorBbox('cornice', bb);
      c.scale.x = item.runLength / bb.sizeX;
      c.scale.z = -1;
      const endX = item.x + item.dx * item.runLength;
      const endZ = item.z + item.dz * item.runLength;
      c.position.set(endX, wallTopY - bb.maxY, endZ);
      c.rotation.y = edgeRotation(item.dx, item.dz);
      // Подменяем material clone'а на shared instance — тогда верхний карниз
      // и межэтажный slab используют один material, и override mat_cornice
      // меняет их синхронно.
      if (sharedCorniceMat) {
        c.traverse(child => { if (child.isMesh) child.material = sharedCorniceMat; });
      } else {
        // Без shared: переименуем native material в mat_cornice для material override
        c.traverse(child => { if (child.isMesh && child.material) child.material.name = 'mat_cornice'; });
      }
      setupShadows(c);
      parent.add(c);
      counts.cornice++;
    }
    // TODO: на convex-углах cornice оставляют дыру cd×cd. Для корректного закрытия нужен
    // отдельный угловой GLB-модуль mod_cornice_corner.glb с трапециевидным сечением
    // (имитирующим профиль cornice), который встанет на каждом convex-углу как L-образный кусок.
    // BoxGeometry-cap здесь не подходит — у cornice трапециевидное сечение, а box даёт
    // прямоугольное и визуально не стыкуется с основным сегментом.
    // Воркэраунд возможен через процедурную ExtrudeGeometry с тем же сечением, но требует
    // знания точного профиля cornice (либо явно в дескрипторе, либо детектом из GLB —
    // что нетривиально).
  }

  // Downpipe — водосточные трубы на convex-углах. Native height детектим, масштабируем до wallH.
  if (desc.features.downpipe) {
    const wallH = wallTopY - baseY;
    for (const item of outline.items) {
      if (item.type !== 'pillar') continue;
      if (item.turn < 0) continue;
      const d = cloneModule(modules, 'downpipe');
      if (!d) break;
      const bb = detectNativeBbox(d);
      dumpDecorBbox('downpipe', bb);
      // Масштабируем по Y до wallH
      d.scale.y = wallH / Math.max(0.1, bb.sizeY);
      // Position у внешнего угла дома, верх трубы = wallTopY
      d.position.set(item.x, baseY - bb.minY * d.scale.y, item.z);
      setupShadows(d);
      parent.add(d);
      counts.downpipe++;
    }
  }

  // Chimney — на крыше. Высоту крыши в точке (cx,cz) считаем по rect декомпозиции:
  //   roofHeight = min(dx, dz) * tan(α), где dx, dz — расстояния до ближайших рёбер rect'а.
  if (desc.features.chimney) {
    const c = cloneModule(modules, 'chimney');
    if (c) {
      const bb = detectNativeBbox(c);
      dumpDecorBbox('chimney', bb);
      const pos = (desc.features.chimney.position) || [0.5, 0.5];
      const obb = outline.bbox;
      const cx = obb.minX + pos[0] * (obb.maxX - obb.minX);
      const cz = obb.minZ + pos[1] * (obb.maxZ - obb.minZ);
      // Найти rect декомпозиции, содержащий точку (cx,cz). Если несколько — берём с самой высокой крышей.
      let maxRoofH = 0;
      for (const r of rects) {
        if (cx < r.minX - 0.001 || cx > r.maxX + 0.001) continue;
        if (cz < r.minZ - 0.001 || cz > r.maxZ + 0.001) continue;
        const dx = Math.min(cx - r.minX, r.maxX - cx) + eave;
        const dz = Math.min(cz - r.minZ, r.maxZ - cz) + eave;
        const halfShort = (r.maxX - r.minX < r.maxZ - r.minZ) ? (r.maxX - r.minX) / 2 + eave : (r.maxZ - r.minZ) / 2 + eave;
        // Высота крыши в точке = min(dx, dz) * tan(α), ограничено halfShort * tan(α)
        const h = Math.min(Math.min(dx, dz), halfShort) * tanA;
        if (h > maxRoofH) maxRoofH = h;
      }
      // Y: низ chimney утопает в крыше на drop метров, чтобы chimney "врезался" в кровлю,
      // а не парил над коньком. drop задаётся в дескрипторе (по умолчанию 0.5 м).
      const drop = (desc.features.chimney.drop !== undefined) ? desc.features.chimney.drop : 0.5;
      c.position.set(cx, wallTopY + maxRoofH - drop - bb.minY, cz);
      setupShadows(c);
      parent.add(c);
      counts.chimney++;
    }
  }

  log(`[decor] gutter=${counts.gutter}, cornice=${counts.cornice}, downpipe=${counts.downpipe}, chimney=${counts.chimney}`, 'dim');
}

// ══════════════════════════════════════════════
// STRAIGHT SKELETON для orthogonal polygons (Aichholzer-Aurenhammer, event-driven).
// Используется для построения hip/gable-крыш на любых ortho-формах (L, +, П, S, О с двором).
//
// Идея:
//   1) Каждое ребро полигона "движется внутрь" со скоростью 1 (перпендикулярно само себе).
//   2) Вершина = пересечение двух соседних рёбер. Двигается вдоль биссектрисы:
//      bisector = (interior_normal_prev + interior_normal_next), для ortho-вершины |.| = sqrt(2).
//   3) События во "времени t" (t = глубина сжатия = высота крыши / tan α):
//      • Edge event: соседние биссектрисы сходятся в точку, ребро между ними коллапсирует.
//      • Split event: биссектриса reflex-вершины пересекает противоположное ребро, полигон делится.
//   4) После всех событий — skeleton-дерево (графа skeleton-нод).
//   5) Каждое исходное ребро владеет "face" — областью в плане между ребром и skeleton-путями
//      от его концов. Это footprint одной плоскости крыши.
//
// Для ortho-полигонов всё считается просто (углы только ±90°, биссектрисы под 45°).
// ══════════════════════════════════════════════

const SS_EPS = 1e-6;

// Создаём активную вершину для SS. Хранит "путь" — точки, через которые проходила вершина
// от создания до смерти. Эти точки + полигональные концы исходного ребра образуют face крыши.
function makeSSVertex(x, z, prevDir, nextDir, isReflex) {
  // Биссектриса = сумма interior-normals двух смежных рёбер. Для ortho: |sum| = sqrt(2).
  const pnX = -prevDir.dz, pnZ = prevDir.dx;  // interior_normal of prev edge (CW: (-dz, dx))
  const nnX = -nextDir.dz, nnZ = nextDir.dx;
  const bxRaw = pnX + nnX, bzRaw = pnZ + nnZ;
  const mag = Math.hypot(bxRaw, bzRaw);
  const bisX = mag > SS_EPS ? bxRaw / mag : 0;
  const bisZ = mag > SS_EPS ? bzRaw / mag : 0;
  return {
    x, z,
    bornT: 0,            // время появления (0 для исходных, >0 для созданных событием)
    bisX, bisZ,           // единичный вектор биссектрисы
    bisSpeed: mag,        // sqrt(2) для ortho — скорость вершины вдоль bisX/bisZ
    prevDir, nextDir,     // dir-векторы смежных рёбер (для вычисления событий)
    isReflex,
    prev: null, next: null,
    active: true,
    pathNodes: [],        // skeleton-узлы, через которые прошла эта вершина (для построения face)
  };
}

// Позиция вершины в момент времени t (t ≥ bornT)
function ssPosAt(v, t) {
  const dt = t - v.bornT;
  return [v.x + v.bisX * v.bisSpeed * dt, v.z + v.bisZ * v.bisSpeed * dt];
}

// Время edge event для пары соседних вершин V, V.next.
// Решаем: V_pos(t) == V_next_pos(t). Для ortho-полигонов это сводится к шинкингу ребра.
// Ребро между V и V.next имеет направление nextDir(V). Биссектрисы V и V.next имеют
// компоненты вдоль/поперёк этого направления. Шинкинг = - sum of along-edge-components.
function ssEdgeEventTime(v) {
  if (!v.active || !v.next || !v.next.active) return null;
  const n = v.next;
  // Вектор edge (от V к V.next)
  const ex = n.x - v.x, ez = n.z - v.z;
  const eLen = Math.hypot(ex, ez);
  if (eLen < SS_EPS) return v.bornT;  // уже совпали
  const edx = ex / eLen, edz = ez / eLen;
  // Проекция bisector*speed на edge-направление: насколько каждая вершина "сдвигается вдоль ребра"
  // в сторону другой вершины.
  // Для V (двигается в сторону V.next): + edge_dir.
  // Для N (двигается от V.next в сторону V): - edge_dir.
  const vProj = (v.bisX * edx + v.bisZ * edz) * v.bisSpeed;       // должно быть > 0 если V приближается к N
  const nProj = (n.bisX * edx + n.bisZ * edz) * n.bisSpeed;       // должно быть < 0 если N приближается к V
  const closeRate = vProj - nProj;  // суммарная скорость сближения
  if (closeRate <= SS_EPS) return null;  // не сходятся (или расходятся)
  return v.bornT + eLen / closeRate;
}

// Время split event: reflex-вершина V встречает edge (other → other.next).
// Геометрия: бисектриса V — это луч (V.x, V.z) + t*(bisX, bisZ)*bisSpeed.
// Ребро (other → other.next) тоже движется со временем (его прямая сдвигается перпендикулярно
// внутрь полигона со скоростью 1). Уравнение прямой ребра в момент t:
//   (P - (other.pos_at_t)) · edge_normal = 0
// где edge_normal — интерьерная нормаль (CW: (-edge.dz, edge.dx)).
// other.pos_at_t = other.x + other.bisX * other.bisSpeed * (t - other.bornT)
// V.pos_at_t = V.x + V.bisX * V.bisSpeed * (t - V.bornT)
// Подставляем V.pos_at_t в уравнение прямой и решаем для t.
function ssSplitEventTime(v, other) {
  if (!v.active || !other.active || !other.next || !other.next.active) return null;
  if (v === other || v === other.next || v.next === other || v.prev === other) return null;
  // Edge direction (other → other.next) на момент 0
  const ex = other.next.x - other.x, ez = other.next.z - other.z;
  const eLen = Math.hypot(ex, ez);
  if (eLen < SS_EPS) return null;
  const edx = ex / eLen, edz = ez / eLen;
  // Interior normal (CW)
  const nx = -edz, nz = edx;
  // Уравнение ребра на момент t: (P - O) · n = 1*(t - other.bornT)   [ребро движется внутрь со скоростью 1]
  // где O = other.pos at other.bornT = (other.x, other.z), N — interior normal.
  // Точнее, точка на ребре в момент t = O + e_dir*s + n*(t - other.bornT) для некоторого s ∈ [0, eLen-shrink].
  // P_v(t) - O = (V.x - other.x, V.z - other.z) + (V.bisX*V.bisSpeed)*(t - V.bornT) - (other.bisX*other.bisSpeed)*(t - other.bornT)
  // Проекция этого на n должна равняться 1*(t - other.bornT).
  // Группируем по t:
  //   (Vx0_rel · n) + t*(V.bisX*sp - other.bisX*sp_o)·n - V.bornT*V.bisX*sp·n + other.bornT*other.bisX*sp_o·n = 1*(t - other.bornT)
  // Упростим в обобщённой форме:
  //   A + t*B = (t - other.bornT)
  // где A = (V.x - other.x)*nx + (V.z - other.z)*nz + V.bornT*(other.bisX*other.bisSpeed*nx + other.bisZ*other.bisSpeed*nz)
  //                              - V.bornT*(V.bisX*V.bisSpeed*nx + V.bisZ*V.bisSpeed*nz)... сложно.
  // Упрощаю: считаем что v.bornT = other.bornT = 0 (для исходных вершин это так). Для созданных событием —
  // используем их актуальные позиции и bornT, см. ниже.
  //
  // Простая форма (когда обе вершины с bornT=0):
  //   A + t*B = t,   t = A / (1 - B)
  // где A = (V - O) · N, B = (V.bisVec - other.bisVec) · N.
  //
  // Для общего случая (bornT≠0): V_pos(t) = V_orig + V.bis*(t - V.bornT). Но реальные исходные
  // координаты V — это уже точка в момент V.bornT. Нам нужно:
  //   (V_pos(t) - O_pos(t)) · N = 0 ?? нет, ребро ОТСТУПИЛО внутрь на (t - other.bornT)*1.
  //   (V_pos(t) - O_orig) · N = (t - other.bornT)
  // где O_orig = (other.x, other.z) и N = unit normal в момент other.bornT.
  // V_pos(t) = (V.x, V.z) + V.bis_vec * (t - V.bornT)
  // (V_pos(t) - O_orig) · N = (V.x - other.x)*nx + (V.z - other.z)*nz + (V.bisX*V.bisSpeed*nx + V.bisZ*V.bisSpeed*nz)*(t - V.bornT) = (t - other.bornT)
  // Обозначим A0 = (V.x - other.x)*nx + (V.z - other.z)*nz,  K = (V.bisX*nx + V.bisZ*nz)*V.bisSpeed.
  // A0 + K*(t - V.bornT) = t - other.bornT
  // K*t - K*V.bornT + A0 = t - other.bornT
  // t*(K - 1) = -A0 + K*V.bornT - other.bornT
  // t = (K*V.bornT - other.bornT - A0) / (K - 1)
  const A0 = (v.x - other.x) * nx + (v.z - other.z) * nz;
  const K = (v.bisX * nx + v.bisZ * nz) * v.bisSpeed;
  const denom = K - 1;
  if (Math.abs(denom) < SS_EPS) return null;
  const t = (K * v.bornT - other.bornT - A0) / denom;
  if (t < v.bornT + SS_EPS) return null;
  // Проверяем: точка пересечения должна лежать ВНУТРИ ребра (другие edge events исключают концы).
  const px = v.x + v.bisX * v.bisSpeed * (t - v.bornT);
  const pz = v.z + v.bisZ * v.bisSpeed * (t - v.bornT);
  const ox = other.x + other.bisX * other.bisSpeed * (t - other.bornT);
  const oz = other.z + other.bisZ * other.bisSpeed * (t - other.bornT);
  const oNx = other.next.x + other.next.bisX * other.next.bisSpeed * (t - other.next.bornT);
  const oNz = other.next.z + other.next.bisZ * other.next.bisSpeed * (t - other.next.bornT);
  const eLenT = Math.hypot(oNx - ox, oNz - oz);
  if (eLenT < SS_EPS) return null;
  const edxT = (oNx - ox) / eLenT, edzT = (oNz - oz) / eLenT;
  const s = (px - ox) * edxT + (pz - oz) * edzT;
  if (s < SS_EPS || s > eLenT - SS_EPS) return null;  // вне ребра
  return t;
}

// Декомпозиция ortho-полигона на МАКСИМАЛЬНЫЕ ПЕРЕСЕКАЮЩИЕСЯ axis-aligned прямоугольники.
// Алгоритм:
//   1) Уникальные z-координаты вершин делят план на горизонтальные slab'ы.
//   2) В каждом slab'е находим x-интервалы внутри полигона.
//   3) Для каждого x-интервала I в slab'е s, расширяем s вверх и вниз настолько, насколько
//      все соседние slab'ы содержат интервал I' ⊇ I. Получаем "максимальный вертикальный бар" для I.
//   4) Удаляем дубликаты и rects, содержащиеся в других.
//
// Прямоугольники могут пересекаться — это намеренно: hip-крыши на пересекающихся прямоугольниках
// взаимно "поглощают" друг друга в местах пересечения, без видимых стыков и ступенек
// (особенно если halfShort одинаковый — крыши идеально совпадают по высоте конька).
function decomposeOrthoPolygonIntoRectangles(outline) {
  const corners = outline.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) return [];

  const N = corners.length;
  const verticalEdges = [];
  for (let i = 0; i < N; i++) {
    const a = corners[i], b = corners[(i + 1) % N];
    if (Math.abs(a.x - b.x) < SS_EPS) {
      verticalEdges.push({
        x: a.x,
        zMin: Math.min(a.z, b.z),
        zMax: Math.max(a.z, b.z),
      });
    }
  }

  const zSet = new Set();
  corners.forEach(c => zSet.add(Math.round(c.z * 1000) / 1000));
  const zSorted = [...zSet].sort((a, b) => a - b);
  if (zSorted.length < 2) return [];

  // Шаг 1-2: формируем slab'ы с x-интервалами.
  const slabs = [];
  for (let i = 0; i < zSorted.length - 1; i++) {
    const z0 = zSorted[i], z1 = zSorted[i + 1];
    if (z1 - z0 < SS_EPS) continue;
    const zMid = (z0 + z1) / 2;
    const xs = [];
    for (const e of verticalEdges) {
      if (zMid > e.zMin + SS_EPS && zMid < e.zMax - SS_EPS) xs.push(e.x);
    }
    xs.sort((a, b) => a - b);
    const intervals = [];
    for (let j = 0; j + 1 < xs.length; j += 2) {
      if (xs[j + 1] - xs[j] > SS_EPS) intervals.push({ x0: xs[j], x1: xs[j + 1] });
    }
    slabs.push({ z0, z1, intervals });
  }

  // Шаг 3: для каждого интервала в каждом slab'е находим максимальный вертикальный бар.
  // Бар расширяется вверх (smaller z) и вниз (larger z), пока интервал содержится в каждом
  // соседнем slab'е (т.е. там есть какой-то x-интервал, в котором наш помещается).
  const candidates = [];
  for (let s = 0; s < slabs.length; s++) {
    for (const intv of slabs[s].intervals) {
      let zMin = slabs[s].z0, zMax = slabs[s].z1;
      // Расширение вверх (к меньшим z)
      for (let s2 = s - 1; s2 >= 0; s2--) {
        const contains = slabs[s2].intervals.some(I =>
          I.x0 <= intv.x0 + SS_EPS && I.x1 >= intv.x1 - SS_EPS
        );
        if (contains) zMin = slabs[s2].z0;
        else break;
      }
      // Расширение вниз (к большим z)
      for (let s2 = s + 1; s2 < slabs.length; s2++) {
        const contains = slabs[s2].intervals.some(I =>
          I.x0 <= intv.x0 + SS_EPS && I.x1 >= intv.x1 - SS_EPS
        );
        if (contains) zMax = slabs[s2].z1;
        else break;
      }
      candidates.push({ minX: intv.x0, maxX: intv.x1, minZ: zMin, maxZ: zMax });
    }
  }

  // Шаг 4: удаляем дубликаты и rects, строго содержащиеся в других candidates.
  const isContained = (a, b) =>
    b.minX <= a.minX + SS_EPS && b.maxX >= a.maxX - SS_EPS &&
    b.minZ <= a.minZ + SS_EPS && b.maxZ >= a.maxZ - SS_EPS;
  const isEqual = (a, b) =>
    Math.abs(a.minX - b.minX) < SS_EPS && Math.abs(a.maxX - b.maxX) < SS_EPS &&
    Math.abs(a.minZ - b.minZ) < SS_EPS && Math.abs(a.maxZ - b.maxZ) < SS_EPS;
  const result = [];
  for (let i = 0; i < candidates.length; i++) {
    const ci = candidates[i];
    let contained = false;
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      if (isContained(ci, candidates[j]) && !isEqual(ci, candidates[j])) {
        contained = true; break;
      }
    }
    if (contained) continue;
    if (result.some(r => isEqual(r, ci))) continue;
    result.push(ci);
  }
  return result;
}

// Minkowski-инфлейт ortho-полигона на eave: каждое ребро сдвигается наружу на eave перпендикулярно себе.
// У convex-вершины новый угол лежит на расстоянии eave*sqrt(2) "наружу" вдоль bisector;
// у reflex — на eave*sqrt(2) "внутрь" (соседние ребра встретились дальше внутри полигона).
// Это даёт правильный свес для hip-крыши на любой ortho-форме.
function inflateOrthoOutline(outline, eave) {
  if (eave <= 0) return outline;
  const items = outline.items;
  const newPillarPos = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'pillar') continue;
    const prevW = items[(i - 1 + items.length) % items.length];
    const nextW = items[(i + 1) % items.length];
    // Сумма interior-normals соседних рёбер (CW interior = (-dz, dx))
    const bx = -prevW.dz + -nextW.dz;
    const bz = prevW.dx + nextW.dx;
    // Для convex: сдвигаем наружу (-bisector). Для reflex: внутрь (+bisector).
    const sign = item.turn < 0 ? +1 : -1;
    newPillarPos[i] = { x: item.x + sign * bx * eave, z: item.z + sign * bz * eave };
  }
  // Конструируем новые items: pillars с новыми позициями, walls с пересчитанными startX/Z и runLength.
  const newItems = [];
  let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'pillar') {
      const np = newPillarPos[i];
      newItems.push({ ...item, x: np.x, z: np.z });
      if (np.x < bbMinX) bbMinX = np.x; if (np.x > bbMaxX) bbMaxX = np.x;
      if (np.z < bbMinZ) bbMinZ = np.z; if (np.z > bbMaxZ) bbMaxZ = np.z;
    } else {
      // Wall: концы = соседние pillars (новые позиции). Start = prev pillar, end = next pillar.
      const prevP = newPillarPos[(i - 1 + items.length) % items.length];
      const nextP = newPillarPos[(i + 1) % items.length];
      const dx = nextP.x - prevP.x, dz = nextP.z - prevP.z;
      const newRun = Math.hypot(dx, dz);
      newItems.push({ ...item, x: prevP.x, z: prevP.z, runLength: newRun });
    }
  }
  return { items: newItems, bbox: { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ } };
}

// Главная функция: строит straight skeleton для outline и угла alphaDeg.
// Возвращает { nodes, faces, tanAlpha } где:
//   nodes  — массив { x, z, t } skeleton-узлов
//   faces  — массив полигонов в плане; каждый face = { edgeIdx, polygon: [[x,z,t], ...] }
//            polygon содержит 2 точки исходного ребра (t=0) + skeleton-узлы (t>0).
//   tanAlpha — для подъёма t → высота крыши.
function computeStraightSkeleton(outline, alphaDeg) {
  const tanAlpha = Math.tan((alphaDeg || 22) * Math.PI / 180);

  // Извлекаем pillar-углы из outline.items, плюс соответствующие prev/next wall-направления.
  const items = outline.items;
  const corners = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'pillar') continue;
    const prevWall = items[(i - 1 + items.length) % items.length];
    const nextWall = items[(i + 1) % items.length];
    corners.push({
      x: item.x, z: item.z,
      prevDir: { dx: prevWall.dx, dz: prevWall.dz },
      nextDir: { dx: nextWall.dx, dz: nextWall.dz },
      isReflex: item.turn < 0,
    });
  }
  const N = corners.length;
  if (N < 3) return null;
  // ВРЕМЕННО: текущая реализация split-событий некорректно собирает face-полигоны
  // (топология после split разделяет исходное ребро на 2 куска, что моя простая
  // leftPath/rightPath модель не отражает). Для non-rectangular форм пропускаем SS —
  // buildRoof откатится на bbox-hip. См. TODO в комментарии перед функцией.
  const hasReflex = corners.some(c => c.isReflex);
  if (hasReflex) {
    log(`[roof-SS] reflex-вершины (${corners.filter(c=>c.isReflex).length}) — SS пропущен, fallback на bbox`, 'dim');
    return null;
  }

  // Создаём вершины linked-list, связываем prev/next
  const initialVerts = corners.map(c => makeSSVertex(c.x, c.z, c.prevDir, c.nextDir, c.isReflex));
  for (let i = 0; i < N; i++) {
    initialVerts[i].prev = initialVerts[(i - 1 + N) % N];
    initialVerts[i].next = initialVerts[(i + 1) % N];
  }

  // Создаём face per исходное ребро. Face polygon в плане строится с двух концов
  // ребра, постепенно отслеживая skeleton-узлы по которым проходят его концы.
  // На каждое ребро (v → v.next) приходится один face. Сохраняем ссылку в edgeFace[v.id].
  // Для удобства даём каждой исходной вершине индекс.
  const edgeFaces = [];  // [{ leftPath: [pts], rightPath: [pts], dead: false }]
  // leftPath = путь от начала ребра (v) вверх в skeleton, по мере того как v движется.
  // rightPath = путь от конца ребра (v.next) вверх в skeleton.
  for (let i = 0; i < N; i++) {
    const v = initialVerts[i];
    const n = v.next;
    edgeFaces.push({
      v0: { x: v.x, z: v.z },
      v1: { x: n.x, z: n.z },
      leftPath:  [],   // skeleton-узлы вдоль "правого" края face (двигается v)
      rightPath: [],   // skeleton-узлы вдоль "левого" края face (двигается n)
    });
    v.faceIdx = i;     // ребро (v → v.next) имеет индекс i
  }

  // Каждая вершина V "владеет" двумя сторонами face: правой стороной face[V.prev] и левой стороной face[V].
  // Когда V прошла через skeleton-узел S, добавляем S в:
  //   • rightPath of edgeFaces[V.prev.faceIdx]
  //   • leftPath  of edgeFaces[V.faceIdx]
  function recordNodeForVertex(v, node) {
    // edgeFaces[v.prev.faceIdx].rightPath получает node
    // edgeFaces[v.faceIdx].leftPath получает node
    if (v.prev) edgeFaces[v.prev.faceIdx].rightPath.push(node);
    edgeFaces[v.faceIdx].leftPath.push(node);
  }

  // Очередь событий — простой массив с сортировкой при extract (O(N²), но для N≤20 это OK).
  const events = [];
  function pushEvent(ev) { if (ev) events.push(ev); }
  function popEarliest() {
    if (!events.length) return null;
    let minIdx = 0;
    for (let i = 1; i < events.length; i++) if (events[i].t < events[minIdx].t) minIdx = i;
    return events.splice(minIdx, 1)[0];
  }

  function scheduleEventsFor(v) {
    if (!v.active) return;
    const et = ssEdgeEventTime(v);
    if (et !== null) pushEvent({ t: et, type: 'edge', v });
    if (v.isReflex) {
      // Сканируем все non-adjacent рёбра. Запускаем split event против каждого подходящего.
      for (let other = v.next.next; other && other !== v.prev; other = other.next) {
        if (!other.active) continue;
        const st = ssSplitEventTime(v, other);
        if (st !== null) pushEvent({ t: st, type: 'split', v, other });
      }
    }
  }

  // Начальные события
  for (const v of initialVerts) scheduleEventsFor(v);

  // Skeleton-узлы (все skeleton-вершины кроме исходных)
  const skeletonNodes = [];

  // Защита от бесконечного цикла
  const maxIter = N * 50;
  let iter = 0;

  while (events.length > 0 && iter < maxIter) {
    iter++;
    const ev = popEarliest();
    if (!ev.v.active) continue;

    if (ev.type === 'edge') {
      const v = ev.v, n = v.next;
      if (!n.active) continue;
      // Создаём skeleton-узел в точке встречи
      const [nx, nz] = ssPosAt(v, ev.t);
      const node = { x: nx, z: nz, t: ev.t };
      skeletonNodes.push(node);
      // Записываем узел в face-paths v и n
      recordNodeForVertex(v, node);
      recordNodeForVertex(n, node);
      // Деактивируем v и n, создаём новую вершину в их месте, наследующую соседей
      const newPrev = v.prev, newNext = n.next;
      if (newPrev === newNext) {
        // Только 2 вершины осталось — полигон коллапсирует в конец.
        v.active = false; n.active = false;
        // Финальный узел уже создан. Завершаем для этого "куска".
        // (Других вершин нет, обработка прекращается.)
        // Также добавим узел в pathы newPrev (если он ещё активен)
        if (newPrev && newPrev.active) recordNodeForVertex(newPrev, node);
        newPrev.active = false;
        continue;
      }
      // Новая вершина W: позиция = node, prev_dir = v.prev_dir (сохраняется), next_dir = n.next_dir.
      const W = makeSSVertex(nx, nz, v.prevDir, n.nextDir, false);
      W.bornT = ev.t;
      W.prev = newPrev; W.next = newNext;
      W.faceIdx = v.faceIdx;  // edge v→v.next исчез, теперь edge w.prev→w занимает face[v.prev.faceIdx]
      // ВАЖНО: face индексы — у новой вершины W мы наследуем faceIdx от n (так как edge W → W.next = это бывшее ребро n → n.next).
      W.faceIdx = n.faceIdx;
      // Но "слева" от W теперь то же самое что было слева от V (то есть edge v.prev→v).
      // Это означает: W.prev.faceIdx должно дать edge от W.prev к W, что = бывшее ребро v.prev → v.
      // Эта инвариантность сохраняется естественно: W.prev = newPrev = v.prev, и v.prev.faceIdx уже указывал на edge v.prev→v.
      newPrev.next = W;
      newNext.prev = W;
      v.active = false; n.active = false;
      // Планируем новые события для W и его соседей (т.к. их edge-времена изменились)
      scheduleEventsFor(W);
      scheduleEventsFor(newPrev);
    } else if (ev.type === 'split') {
      // Reflex-вершина V "вонзается" в ребро (other → other.next).
      // Точка встречи — позиция V в момент ev.t. Полигон делится на два loop'а.
      const v = ev.v, other = ev.other;
      if (!v.active || !other.active || !other.next.active) continue;
      const [px, pz] = ssPosAt(v, ev.t);
      const node = { x: px, z: pz, t: ev.t };
      skeletonNodes.push(node);
      recordNodeForVertex(v, node);
      // В рассечении: V превращается в две новые вершины W1 и W2 в одной и той же точке,
      // каждая с разным prev/next:
      //   W1: prev = v.prev, next = other.next.  (формирует loop "по левой стороне")
      //   W2: prev = other,  next = v.next.       (формирует loop "по правой стороне")
      const W1 = makeSSVertex(px, pz, v.prevDir, other.nextDir, false);
      const W2 = makeSSVertex(px, pz, other.nextDir.dx === v.nextDir.dx ? other.nextDir : { dx: -other.nextDir.dx, dz: -other.nextDir.dz }, v.nextDir, false);
      // Простейший вариант prev/next для W2: prev = other (его nextDir используется как W2.prevDir),
      // next = v.next.
      W2.prevDir = { dx: other.nextDir.dx, dz: other.nextDir.dz };
      W2.nextDir = { dx: v.nextDir.dx, dz: v.nextDir.dz };
      // Пересчитаем bisector W2 (мог не корректно зайти из конструктора из-за хитростей)
      // Используем тот же подход что в makeSSVertex
      const W2_pnX = -W2.prevDir.dz, W2_pnZ = W2.prevDir.dx;
      const W2_nnX = -W2.nextDir.dz, W2_nnZ = W2.nextDir.dx;
      const W2_bxRaw = W2_pnX + W2_nnX, W2_bzRaw = W2_pnZ + W2_nnZ;
      const W2_mag = Math.hypot(W2_bxRaw, W2_bzRaw);
      W2.bisX = W2_mag > SS_EPS ? W2_bxRaw / W2_mag : 0;
      W2.bisZ = W2_mag > SS_EPS ? W2_bzRaw / W2_mag : 0;
      W2.bisSpeed = W2_mag;
      W1.bornT = ev.t; W2.bornT = ev.t;
      // Перевязываем ссылки
      W1.prev = v.prev;       W1.next = other.next;
      W2.prev = other;        W2.next = v.next;
      v.prev.next = W1;
      other.next.prev = W1;
      other.next = W2;
      v.next.prev = W2;
      // Face индексы: W1 наследует faceIdx от ... edge W1 → W1.next = от v → ребро бывшее other → other.next, итого W1.faceIdx = other.faceIdx.
      // edge W1.prev → W1 = бывшее v.prev → v, что = edgeFaces[v.prev.faceIdx]. OK.
      W1.faceIdx = other.faceIdx;
      // W2: edge W2 → W2.next = бывшее v → v.next, faceIdx = v.faceIdx.
      W2.faceIdx = v.faceIdx;
      // edge other → W2 — это новое ребро в split, формально не имеющее исходного аналога.
      // Аналогично у W1.prev → W1 — ребро от прежнего v.prev → v, у W1 → other.next — новое от split.
      // Точная привязка face-paths в этом случае сложная; рисуем приблизительно.

      v.active = false;
      // Планируем новые события
      scheduleEventsFor(W1);
      scheduleEventsFor(W2);
      scheduleEventsFor(W1.prev);
      scheduleEventsFor(W2.prev);
      scheduleEventsFor(other);
    }
  }

  // Завершение: для каждого face добавляем v0, leftPath..., reversed rightPath..., v1 — это контур face.
  const faces = edgeFaces.map((f, i) => {
    const poly = [];
    poly.push({ x: f.v0.x, z: f.v0.z, t: 0 });
    for (const n of f.leftPath) poly.push({ x: n.x, z: n.z, t: n.t });
    for (let j = f.rightPath.length - 1; j >= 0; j--) {
      const n = f.rightPath[j];
      // Не дублируем последний узел, если он совпадает с предыдущим
      const last = poly[poly.length - 1];
      if (Math.hypot(n.x - last.x, n.z - last.z) < SS_EPS) continue;
      poly.push({ x: n.x, z: n.z, t: n.t });
    }
    poly.push({ x: f.v1.x, z: f.v1.z, t: 0 });
    return { edgeIdx: i, polygon: poly };
  });

  return { nodes: skeletonNodes, faces, tanAlpha, iterations: iter };
}

// Рендерит hip-крышу по straight skeleton. Каждый face триангулируется (ShapeUtils.triangulateShape)
// в 2D, затем поднимается на высоту t * tanAlpha.
function buildHipRoofFromSS(parent, baseY, ss, color) {
  if (!ss || !ss.faces || !ss.faces.length) {
    log('[roof-SS] no faces, fallback to bbox hip', 'warn');
    return false;
  }
  const positions = [];
  const indices = [];
  let triangleCount = 0;
  for (const face of ss.faces) {
    const poly = face.polygon;
    if (poly.length < 3) continue;
    // 2D-вершины для Earcut
    const pts2D = poly.map(p => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(pts2D, []);
    if (!tris.length) {
      log(`[roof-SS] face ${face.edgeIdx}: triangulation failed (${poly.length} verts)`, 'warn');
      continue;
    }
    const base = positions.length / 3;
    // Добавляем 3D-вершины с высотой = baseY + t*tanAlpha
    for (const p of poly) {
      positions.push(p.x, baseY + p.t * ss.tanAlpha, p.z);
    }
    // Треугольники
    for (const t of tris) {
      indices.push(base + t[0], base + t[1], base + t[2]);
      triangleCount++;
    }
  }
  if (!triangleCount) return false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: color || 0x8b3a3a, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  });
  mat.name = 'mat_roof';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof-SS] hip: ${ss.faces.length} faces, ${triangleCount} triangles, ${ss.nodes.length} skeleton nodes`, 'dim');
  return true;
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
// Универсальный билдер плоской плиты по полигону. Используется и для flat-крыши, и для
// межэтажного перекрытия (slab). Параметры:
//   • points2D — массив THREE.Vector2 (X, Z) в плановом порядке CW.
//   • baseY    — Y нижней грани плиты.
//   • slabH    — толщина плиты по Y.
//   • matName  — имя материала (для material override через mat_*).
//   • color    — цвет mesh.
function buildSlabPolygon(parent, points2D, baseY, slabH, matName, color) {
  if (points2D.length < 3) return;
  const triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
  if (!triangles.length) return;
  const positions = [];
  const indices = [];
  const N = points2D.length;
  const yTop = baseY + slabH;
  const yBot = baseY;
  for (const p of points2D) positions.push(p.x, yTop, p.y);
  for (const p of points2D) positions.push(p.x, yBot, p.y);
  for (const t of triangles) indices.push(t[0], t[1], t[2]);
  for (const t of triangles) indices.push(t[0] + N, t[2] + N, t[1] + N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    indices.push(i, j + N, i + N);
    indices.push(i, j, j + N);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // flatShading: true → шейдер использует face normal, а не интерполированную vertex normal.
  // Без этого top face и side face разделяют вершины, и computeVertexNormals усредняет
  // нормали, давая градиент по высоте на боковой грани.
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: true,
  });
  mat.name = matName;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Межэтажный карниз: выступающая за периметр стен тонкая плита на уровне yOffset.
// Используется только если в дескрипторе включён features.inter_floor_cornice.
// Параметр extension — насколько плита выступает наружу (по умолчанию 0.05 м).
// Толщина плиты по Y — 0.05 м (тонкая полоса как декоративный карниз).
// Цвет берётся из cornice GLB material (если передан corniceColor), без текстуры —
// иначе текстура с профилем cornice растягивается на плоский квад и даёт визуальный шум.
function buildInterFloorSlab(parent, outline, yOffset, extension, corniceColor) {
  const expanded = (extension > 0) ? inflateOrthoOutline(outline, extension) : outline;
  const corners = expanded.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) return;
  const points2D = corners.map(c => new THREE.Vector2(c.x, c.z));
  const SLAB_THICKNESS = 0.20;
  const color = (corniceColor !== undefined) ? corniceColor : 0xc8b89c;
  buildSlabPolygon(parent, points2D, yOffset - SLAB_THICKNESS, SLAB_THICKNESS, 'mat_cornice', color);
  log(`[slab] inter-floor cornice at Y=${yOffset.toFixed(2)}, extension=${extension.toFixed(2)}m, thickness=${SLAB_THICKNESS}m`, 'dim');
}

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
  // Для hip/gable пробуем сначала straight-skeleton (работает на L/+/П/S/любых ortho-полигонах).
  // Если SS не справился (вернул false) — fallback на bbox-версию.
  if (roofType === 'hip') {
    // Стратегия: декомпозируем ortho-полигон на axis-aligned прямоугольники (horizontal slab sweep)
    // и строим полную вальмовую крышу на каждом. Прямоугольники могут частично перекрываться
    // в местах стыков — но эти перекрытия внутри тела крыши, не видны. Свесы (eave) добавляются
    // на каждый rect. Работает для любой ortho-формы без split-events.
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log('[roof] decomposition failed, fallback на bbox-hip', 'warn');
      return buildHipRoof(parent, baseY, bbox, angleDeg, eave);
    }
    log(`[roof] hip: декомпозиция на ${rects.length} прямоугольник(ов)`, 'dim');
    // Сортируем rects по площади убыванию — большие сначала, меньшие сверху (накладываются).
    // Это упорядочивает render-order для случая when overlap.
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    // Каждый последующий rect получает крошечный y-offset (1 мм), чтобы избежать z-fighting
    // в местах, где плоскости hip-крыш разных rect'ов совпадают идеально.
    // Микро-смещение визуально не заметно (1 мм vs метровые расстояния), но устраняет мерцание.
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      buildHipRoof(parent, baseY + i * 0.001, rectBbox, angleDeg, eave);
    }
    return;
  }
  if (roofType === 'gable' || roofType === 'gable_cross') {
    // Два стиля gable:
    //   "gable"       — главный rect → gable, остальные → hip (gable + hip-пристройки).
    //   "gable_cross" — все rect → gable (cross-gable, фронтоны на торцах каждого rect).
    // На стыках cross-gable фронтоны "прорезают" соседние скаты — это валидный
    // архитектурный приём (см. ruplans.ru/proekti/proekti_6069.html и подобные).
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log('[roof] gable: decomposition failed, fallback на bbox', 'warn');
      return buildGableRoof(parent, baseY, bbox, angleDeg, eave);
    }
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    if (roofType === 'gable_cross') {
      log(`[roof] gable_cross: ${rects.length} rect, все gable`, 'dim');
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
        buildGableRoof(parent, baseY + i * 0.001, rectBbox, angleDeg, eave);
      }
    } else {
      log(`[roof] gable: ${rects.length} rect (1 gable main + ${rects.length - 1} hip)`, 'dim');
      // Сначала вспомогательные hip-крыши, главный gable поверх (на самом высоком y-offset).
      for (let i = 1; i < rects.length; i++) {
        const r = rects[i];
        const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
        buildHipRoof(parent, baseY + (i - 1) * 0.001, rectBbox, angleDeg, eave);
      }
      const main = rects[0];
      const mainBbox = { minX: main.minX, maxX: main.maxX, minZ: main.minZ, maxZ: main.maxZ };
      buildGableRoof(parent, baseY + (rects.length - 1) * 0.001, mainBbox, angleDeg, eave);
    }
    return;
  }
  return buildHipRoof(parent, baseY, bbox, angleDeg, eave);  // дефолтный fallback
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
  let prevOutline = null;  // outline предыдущего этажа — для intermediate roof (1.5 этажа)

  // Pre-clone cornice GLB чтобы вытащить из него цвет — используем его для inter-floor slab.
  // Slab — простая программная плита без текстуры (текстура cornice профиля растягивается
  // на плоский квад и даёт визуальный мусор). Только color совпадает.
  let sharedCorniceColor;
  let sharedCorniceMat = null;
  if ((desc.features?.cornice || desc.features?.inter_floor_cornice) && modules.cornice) {
    const sample = cloneModule(modules, 'cornice');
    if (sample) {
      sample.traverse(child => {
        if (child.isMesh && child.material && !sharedCorniceMat) {
          sharedCorniceMat = child.material;
        }
      });
      if (sharedCorniceMat) {
        sharedCorniceMat.name = 'mat_cornice';
        if (sharedCorniceMat.color) sharedCorniceColor = sharedCorniceMat.color.getHex();
      }
    }
  }

  for (let fi = 0; fi < desc.floors.length; fi++) {
    const floor = desc.floors[fi];
    // Высоту этажа берём из params (один UI-слайдер для упрощения)
    const wallH = params.floorH / 100;
    totalWallH += wallH;

    // Каждый этаж может иметь свой area_factor (для 1.5-этажа: floor_2 area_factor = 0.6
    // означает, что второй этаж по площади = 60% от первого).
    const areaFactor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
    const floorArea = params.area * areaFactor;
    const vars = evalVars(floor.vars, { area: floorArea });
    log(`[builder] floor ${fi} (area_factor=${areaFactor}, area=${floorArea.toFixed(1)}): ${Object.entries(vars).map(([k,v])=>`${k}=${v.toFixed(2)}`).join(', ')}`, 'dim');

    // Опциональный start_offset — позиция первого pillar этажа относительно (0,0).
    // Используется для центрирования верхних этажей внутри нижнего (например, mansard).
    // Значения могут быть выражениями от vars (например "ox", "(L1-L2)/2").
    const offsetSpec = floor.start_offset || { x: 0, z: 0 };
    const startX = evalExpr(offsetSpec.x !== undefined ? offsetSpec.x : 0, vars);
    const startZ = evalExpr(offsetSpec.z !== undefined ? offsetSpec.z : 0, vars);

    const outline = computeOutline(floor.perimeter, vars, ps, startX, startZ);

    if (fi === 0) {
      buildBaseFromOutline(houseGroup, modules, outline, baseH, wt, ps, FOUNDATION_OVERHANG);
    } else {
      // Опциональный межэтажный карниз — выступающая плита на стыке этажей.
      // Управляется через desc.features.inter_floor_cornice (bool или {depth: ...}).
      const ifc = desc.features && desc.features.inter_floor_cornice;
      if (ifc) {
        const depth = (typeof ifc === 'object' && ifc.depth !== undefined) ? ifc.depth : 0.05;
        buildInterFloorSlab(houseGroup, prevOutline, yOffset, depth, sharedCorniceColor);
      }
      // TODO (Этап 2): для 1.5-этажа здесь же построить intermediate flat-roof на той части
      // prevOutline, которая НЕ покрыта текущим outline (= полигон prev минус полигон current).
    }

    for (const item of outline.items) {
      if (item.type === 'pillar') {
        buildPillar(houseGroup, modules, item, wallH, yOffset, ps);
      } else if (item.type === 'wall') {
        buildEdgeWall(houseGroup, modules, desc.modules, item, wallH, yOffset, wt, ps);
      }
    }

    yOffset += wallH;
    prevOutline = outline;
    lastOutline = outline;
  }

  // Крыша поверх верхнего этажа.
  // Для flat — используем РЕАЛЬНЫЙ полигон outline (поддерживает L/П/T-формы);
  // для hip/gable — пока bbox (на сложных формах будут артефакты, TODO).
  if (lastOutline) {
    const angleDef = desc.constraints.roof_angle;
    const angleDeg = (angleDef && angleDef.default !== undefined) ? angleDef.default : 22;
    buildRoof(houseGroup, yOffset, lastOutline.bbox, lastOutline, desc.roof_type || 'hip', angleDeg, ROOF_EAVE);
    // Декор: gutters, cornice, downpipe, chimney — поверх стен и под/на крыше
    buildDecorFromFeatures(houseGroup, modules, desc, lastOutline, baseH, yOffset, angleDeg, ROOF_EAVE, sharedCorniceMat);
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
// Применяем диапазоны area/floor_h/base_h из descriptor.constraints к UI-слайдерам.
// Без этого слайдеры остаются на хардкоженных min/max в HTML и можно выкрутить
// area ниже того, на что рассчитан фасад дескриптора (showcase из 8 модулей).
function applyConstraintsToSliders(desc) {
  const floor0 = desc.floors && desc.floors[0];
  const fc = floor0 ? floor0.constraints || {} : {};
  const dc = desc.constraints || {};
  const apply = (rangeId, displayId, c) => {
    if (!c) return;
    const r = $(rangeId), d = $(displayId);
    if (c.min !== undefined)  r.min  = c.min;
    if (c.max !== undefined)  r.max  = c.max;
    if (c.step !== undefined) r.step = c.step;
    // Если текущее value вне нового диапазона — клампим к default или к min/max.
    let v = parseFloat(r.value);
    if (Number.isNaN(v)) v = c.default !== undefined ? c.default : c.min;
    if (c.min !== undefined && v < c.min) v = c.default !== undefined ? c.default : c.min;
    if (c.max !== undefined && v > c.max) v = c.default !== undefined ? c.default : c.max;
    r.value = v;
    if (d) d.textContent = v;
  };
  apply('area',   'vArea',  fc.area);
  apply('floorH', 'vFloor', fc.floor_h);
  apply('baseH',  'vBase',  dc.base_h);
}

async function rebuild() {
  const typeId = $('houseTypeSel').value;
  if (!_state.desc || _state.desc.id !== typeId) {
    try {
      const loaded = await loadHouseType(typeId);
      _state.desc = loaded.desc;
      _state.modules = loaded.modules;
      _state.materialOverrides = {}; // сбрасываем при смене типа
      setupMaterialControls(loaded.desc);
      applyConstraintsToSliders(loaded.desc);
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
