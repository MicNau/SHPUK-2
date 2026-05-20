// ══════════════════════════════════════════════
// SHARED/HOUSE-BUILDER.JS
// Общий модуль сборки модульного дома по JSON-дескриптору.
// Используется и в test-house (песочница), и в основном фронте (viewer3d-core.js).
//
// Публичный API (namespace HouseBuilder):
//   setLogger(fn)                                    — установить логгер (test-house пишет в panel)
//   loadHouseType(typeId)                            — async fetch дескриптора + GLB-модулей
//   buildHouseFromDescriptor(houseGroup, desc, modules, params, options)
//   applyMaterialOverride(parent, slot, color)
//   drawOutlineOverlay(outlineGroup, outline, y)
//   decomposeOrthoPolygonIntoRectangles(outline)     — для отладки/расчётов
//
// Зависит от: THREE.js (включая GLTFLoader, ShapeUtils).
//
// СПЕЦИФИКАЦИИ:
//   HOUSE_DESCRIPTOR_FORMAT.md (v2.0)
//   HOUSE_MODULES_SPEC.md (v2)
// ══════════════════════════════════════════════

(function(global) {
'use strict';

// ── Архитектурные константы ────────────────────
const FOUNDATION_OVERHANG = 0.10;  // фундамент шире стены на это значение наружу
const ROOF_EAVE           = 0.30;  // свес карниза за стену
const SS_EPS              = 1e-6;

// ── Настраиваемый логгер ──────────────────────
// По умолчанию пишет в console; test-house подменяет на panel-логгер через setLogger().
let _log = (msg, kind) => console.log(`[house-builder${kind ? ':' + kind : ''}] ${msg}`);
function setLogger(fn) { _log = fn; }
function log(msg, kind = '') { _log(msg, kind); }

// ══════════════════════════════════════════════
// LOADER: фетч дескриптора + параллельная загрузка GLB-модулей
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
  ids.add('wall_segment');
  ids.add('pillar');
  ids.add('base_segment');
  ids.add('base_pillar');
  const roofMods = {
    hip:         ['roof_hip_slope', 'roof_hip_ridge'],
    gable:       ['roof_gable_slope', 'roof_gable_front'],
    gable_cross: ['roof_gable_slope', 'roof_gable_front'],
    mansard:     ['roof_gable_slope', 'roof_gable_front'], // мансарда строится как gable
    flat:        ['roof_flat_edge'],
  };
  (roofMods[desc.roof_type] || []).forEach(m => ids.add(m));
  if (desc.features) {
    if (desc.features.chimney)  ids.add('chimney');
    if (desc.features.gutters)  ids.add('gutter');
    if (desc.features.cornice)  { ids.add('cornice'); ids.add('cornice_corner'); }
    if (desc.features.downpipe) ids.add('downpipe');
    if (desc.features.porch)    { ids.add('porch_column'); ids.add('porch_step'); }
  }
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
  // Мансардные / слуховые окна
  if (desc.roof_windows) {
    for (const rw of desc.roof_windows) {
      if (rw.module) ids.add(rw.module);
      if (rw.module === 'dormer' && rw.window && rw.window.type) {
        ids.add('window_' + rw.window.type);
      }
    }
  }
  return ids;
}

async function loadHouseType(typeId) {
  const url = `assets/houses/house_${typeId}.json`;
  log(`[loader] Fetch descriptor: ${url}`);
  // cache: 'no-store' чтобы дескриптор не кэшировался агрессивно браузером:
  // часто правится при разработке, и старая версия может «застрять» в кэше даже после hard reload скриптов.
  const desc = await fetch(url, { cache: 'no-store' }).then(r => {
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
// ══════════════════════════════════════════════
function computeOutline(perimeter, vars, pillarSize, startX = 0, startZ = 0) {
  let x = startX, z = startZ;
  let dx = 1, dz = 0;
  const items = [];
  let bbMinX = startX, bbMaxX = startX, bbMinZ = startZ, bbMaxZ = startZ;

  for (const cmd of perimeter) {
    if (cmd.run !== undefined) {
      const len = evalExpr(cmd.run, vars);
      items.push({
        type: 'wall',
        x, z, dx, dz,
        runLength: len,
        facade: cmd.facade,
        window_type: cmd.window_type,
        min_margin: cmd.min_margin || 1.0,
      });
      x += dx * len;
      z += dz * len;
      bbMinX = Math.min(bbMinX, x); bbMaxX = Math.max(bbMaxX, x);
      bbMinZ = Math.min(bbMinZ, z); bbMaxZ = Math.max(bbMaxZ, z);
    } else if (cmd.turn !== undefined) {
      items.push({ type: 'pillar', x, z, turn: cmd.turn });
      const rad = cmd.turn * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const ndx = dx * c - dz * s;
      const ndz = dx * s + dz * c;
      dx = Math.round(ndx);
      dz = Math.round(ndz);
    }
  }

  // Аннотируем pillar interior-квадрантом (sx, sz)
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

  // Аннотируем wall startOffset/endOffset/wallLength
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

  // Проверка замкнутости периметра (относительно стартовой точки)
  if (Math.abs(x - startX) > 0.01 || Math.abs(z - startZ) > 0.01) {
    log(`[outline] ⚠ contour not closed: Δx=${(x-startX).toFixed(3)}, Δz=${(z-startZ).toFixed(3)}`, 'warn');
  } else {
    log(`[outline] ✓ contour closed; ${items.filter(i => i.type === 'wall').length} edges`, 'ok');
  }

  return { items, bbox: { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ } };
}

// ══════════════════════════════════════════════
// FILLS
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
    type: 'window', model: 'window_' + variant,
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
    type: 'door', model: 'door_' + variant,
    width: override.w !== undefined ? override.w : dW,
    main: override.main === true,
    params: {
      w:  override.w !== undefined ? override.w : dW,
      h:  override.h !== undefined ? override.h : dH,
      y:  0, dW, dH,
      frame_profile: def.frame_profile || 0.05,
      leaves: def.leaves,
      mechanism: def.mechanism,
    }
  };
}

function resolveFills(edge, modulesDef) {
  const wallLength = edge.wallLength;
  const facade = edge.facade;

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

  const fixedSum = resolved.filter(f => !f.isFill).reduce((s, f) => s + f.width, 0);
  const fillCount = resolved.filter(f => f.isFill).length;
  if (fillCount > 0) {
    const fillWidth = (wallLength - fixedSum) / fillCount;
    if (fillWidth < 0.05) {
      log(`[fills] not enough room (wall=${wallLength.toFixed(2)}, fixed=${fixedSum.toFixed(2)})`, 'err');
    }
    resolved.forEach(f => { if (f.isFill) f.width = Math.max(0.05, fillWidth); });
  } else if (Math.abs(wallLength - fixedSum) > 0.01) {
    const gap = wallLength - fixedSum;
    log(`[fills] ⚠ no fills, but ${gap > 0 ? 'gap' : 'overflow'} ${gap.toFixed(2)} м (wall=${wallLength.toFixed(2)}, fixed=${fixedSum.toFixed(2)}). Добавь { "wall": "fill" } в facade.`, 'warn');
  }
  return resolved;
}

// ══════════════════════════════════════════════
// MODULE CLONE + helpers
// ══════════════════════════════════════════════
function cloneModule(modules, id) {
  const src = modules[id];
  if (!src) { log(`[clone] missing module: ${id}`, 'err'); return null; }
  const clone = src.clone(true);
  clone.traverse(c => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      c.material = Array.isArray(c.material)
        ? mats.map(m => m.clone())
        : mats[0].clone();
      if (Array.isArray(c.material)) c.material.forEach((m, i) => m.name = mats[i].name);
      else                            c.material.name = mats[0].name;
    }
  });
  return clone;
}

function setupShadows(obj) {
  obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

const NAME_ALIASES = { 'Glass': 'glass', 'treshold': 'threshold', 'Handle': 'handle' };
const canonName = (n) => {
  if (!n) return n;
  const base = n.replace(/\.\d+$/, '');
  return NAME_ALIASES[base] || base;
};

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

// ══════════════════════════════════════════════
// PARAMETRIC MODULE TRANSFORMS (окна, двери)
// ══════════════════════════════════════════════
function detectNativeDims(group) {
  const native = {
    nativeW: 0, nativeH: 0,
    jambW: 0.05, headerH: 0.05, bottomH: 0.05,
    parts: {},
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
    const xMaxWorld = child.position.x + maxX;
    const yMaxWorld = child.position.y + maxY;
    if (name === 'frame_left')   native.jambW = sizeX;
    if (name === 'frame_right')  native.nativeW = Math.max(native.nativeW, xMaxWorld);
    if (name === 'frame_top')   { native.headerH = sizeY; native.nativeH = Math.max(native.nativeH, yMaxWorld); }
    if (name === 'frame_bottom') native.bottomH = sizeY;
    if (name === 'leaf_main' && native.nativeH === 0) native.nativeH = yMaxWorld;
  });
  if (native.nativeW === 0) native.nativeW = 1.0;
  if (native.nativeH === 0) native.nativeH = 1.0;
  return native;
}

function transformParametricModule(group, params, modelId) {
  const native = detectNativeDims(group);
  const parts = native.parts;
  if (modelId) dumpModuleParts(modelId, parts);
  const w = params.w, h = params.h;
  const dW = native.nativeW, dH = native.nativeH;
  const jambW = native.jambW, headerH = native.headerH, bottomH = native.bottomH;
  const so = params.sill_overhang || 0;

  const targetOpenW = Math.max(0.01, w - 2 * jambW);
  const targetOpenH = Math.max(0.01, h - headerH - bottomH);
  const openMidY = bottomH + targetOpenH / 2;

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
  function fitVertical(child, p, targetBottom, targetTop) {
    if (!p) return;
    const targetH = targetTop - targetBottom;
    if (p.sizeY > 0.001) {
      const sy = targetH / p.sizeY;
      child.scale.y = sy;
      child.position.y = targetBottom - p.minY * sy;
    } else if (p.sizeZ > 0.001) {
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
        if (p) { fitX(child, p, 0, jambW); fitY(child, p, 0, h); }
        break;
      case 'frame_right':
        if (p) { fitX(child, p, w - p.sizeX, w); fitY(child, p, 0, h); }
        break;
      case 'frame_top':
        if (p) { fitX(child, p, 0, w); fitY(child, p, h - p.sizeY, h); }
        break;
      case 'frame_bottom':
        if (p) { fitX(child, p, 0, w); fitY(child, p, 0, p.sizeY); }
        break;
      case 'sill':
        if (p) fitX(child, p, -so, w + so);
        break;
      case 'glass':
        if (p) { fitX(child, p, jambW, w - jambW); fitVertical(child, p, bottomH, h - headerH); }
        break;
      case 'curtain':
        if (p) { fitX(child, p, jambW, w - jambW); fitVertical(child, p, bottomH, h - headerH); }
        break;
      case 'mullion_v':
        if (p) { fitX(child, p, w / 2 - p.sizeX / 2, w / 2 + p.sizeX / 2); fitY(child, p, bottomH, h - headerH); }
        break;
      case 'mullion_h':
        if (p) { fitX(child, p, jambW, w - jambW); fitY(child, p, openMidY - p.sizeY / 2, openMidY + p.sizeY / 2); }
        break;
      case 'flashing':
        if (p) { fitX(child, p, 0, w); fitY(child, p, 0, h); }
        break;
      case 'threshold':
        if (p) { fitX(child, p, 0, w); child.position.y = 0; }
        break;
      case 'leaf_main': {
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
        if (!p) break;
        let mainW, minorW;
        if (params.leaves === 1.5) { mainW = targetOpenW * 2 / 3; minorW = targetOpenW * 1 / 3; }
        else if (params.leaves === 2 && params.mechanism === 'slide') { mainW = targetOpenW / 2; minorW = targetOpenW / 2; }
        else                                                          { mainW = targetOpenW / 2; minorW = targetOpenW / 2; }
        const minorLeft = jambW + mainW;
        fitX(child, p, minorLeft, minorLeft + minorW);
        fitY(child, p, bottomH, h - headerH);
        break;
      }
      case 'rail_top':
      case 'rail_bottom':
        if (p) fitX(child, p, 0, w);
        break;
    }
  });
}

// ══════════════════════════════════════════════
// LOW-LEVEL BUILDERS (pillar, wall, base)
// ══════════════════════════════════════════════
function edgeRotation(dx, dz) { return Math.PI - Math.atan2(dz, dx); }

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
  const sx = item.sx || 1, sz = item.sz || 1;
  const posX = (sx > 0) ? item.x - overhang : item.x - ps;
  const posZ = (sz > 0) ? item.z + ps : item.z + overhang;
  p.position.set(posX, 0, posZ);
  setupShadows(p);
  parent.add(p);
}

function buildEdgeWall(parent, modules, modulesDef, edge, wallH, yOffset, wt, ps) {
  const fills = resolveFills(edge, modulesDef);
  const startX = edge.x + edge.dx * edge.startOffset;
  const startZ = edge.z + edge.dz * edge.startOffset;
  const ry = edgeRotation(edge.dx, edge.dz);
  let cursor = 0;
  for (const fill of fills) {
    const endX = startX + edge.dx * (cursor + fill.width);
    const endZ = startZ + edge.dz * (cursor + fill.width);
    const sillY = (fill.params && fill.params.y) || 0;
    if (fill.type === 'wall') {
      const seg = cloneModule(modules, 'wall_segment');
      if (seg) {
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
  const exteriorWt = wt + overhang;
  for (const item of outline.items) {
    if (item.type === 'pillar') {
      buildBasePillar(parent, modules, item, baseH, ps, overhang);
    } else if (item.type === 'wall') {
      const startX = item.x + item.dx * item.startOffset;
      const startZ = item.z + item.dz * item.startOffset;
      const wallLength = item.wallLength;
      if (wallLength <= 0.01) continue;
      const seg = cloneModule(modules, 'base_segment') || cloneModule(modules, 'wall_segment');
      if (!seg) continue;
      const endX = startX + item.dx * wallLength;
      const endZ = startZ + item.dz * wallLength;
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
// PORCH: поиск главной двери + сборка крыльца
// ══════════════════════════════════════════════

// Найти главную дверь в outline 1-го этажа.
// Возвращает { edge, cursor, doorWidth, doorHeight } или null.
// Приоритет: door с main:true > первая дверь в обходе.
function findMainDoorPlacement(outline, modulesDef) {
  let firstFound = null;
  for (const edge of outline.items) {
    if (edge.type !== 'wall') continue;
    const fills = resolveFills(edge, modulesDef);
    let cursor = 0;
    for (const f of fills) {
      if (f.type === 'door') {
        const hit = { edge, cursor, doorWidth: f.width, doorHeight: f.params.h };
        if (f.main) return hit;
        if (!firstFound) firstFound = hit;
      }
      cursor += f.width;
    }
  }
  return firstFound;
}

// Локальная система координат двери (на наружной грани стены):
//   along  = направление стены (dx, dz)
//   normal = exterior (dz, -dx)  — наружу здания
// offsetAlong — смещение центра крыльца вдоль стены от центра двери, м (может быть < 0).
function getDoorWorldFrame(door, offsetAlong) {
  const { edge, cursor, doorWidth } = door;
  const dx = edge.dx, dz = edge.dz;
  const c = edge.startOffset + cursor + doorWidth / 2 + (offsetAlong || 0);
  return {
    cx: edge.x + dx * c,
    cz: edge.z + dz * c,
    alongX: dx, alongZ: dz,
    normalX: dz, normalZ: -dx,
  };
}

// Подобрать имя слота материала: предпочитает специфичные (mat_porch_*),
// fallback на общие (mat_wood/mat_concrete/mat_metal/mat_wall). При отсутствии — возвращает специфичное имя
// (т.к. applyMaterialOverride просто не найдёт и не упадёт).
function pickPorchMatName(materialsMap, preferred, fallbacks) {
  if (materialsMap && materialsMap[preferred]) return preferred;
  for (const fb of fallbacks) {
    if (materialsMap && materialsMap[fb]) return fb;
  }
  return preferred;
}

function addBoxAt(parent, sizeX, sizeY, sizeZ, cx, cy, cz, ry, matName, color) {
  const geo = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0 });
  mat.name = matName;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz);
  if (ry) mesh.rotation.y = ry;
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildPorch(parent, desc, outlineFloor0, modulesDef, materialsMap, baseH) {
  const cfg = desc.features && desc.features.porch;
  if (!cfg) return;

  const door = findMainDoorPlacement(outlineFloor0, modulesDef);
  if (!door) { log('[porch] нет дверей в фасаде — крыльцо не построено', 'warn'); return; }

  const w = cfg.width;
  const dep = cfg.depth;
  const stepRise   = cfg.step_rise   !== undefined ? cfg.step_rise   : 0.18;
  const stepRun    = cfg.step_run    !== undefined ? cfg.step_run    : 0.30;
  const hasCanopy  = cfg.has_canopy  !== false; // default true
  const canopyH    = cfg.canopy_height !== undefined ? cfg.canopy_height : 2.40;
  const canopySlp  = cfg.canopy_slope  !== undefined ? cfg.canopy_slope  : 0.12;
  const hasRail    = cfg.has_railing !== false; // default true
  const railH      = cfg.railing_height !== undefined ? cfg.railing_height : 0.95;

  const offsetAlong = (cfg.offset_along !== undefined) ? cfg.offset_along : 0;

  if (w <= 0.1 || dep <= 0.1) { log('[porch] ⚠ width/depth должны быть > 0.1', 'warn'); return; }
  if (w < door.doorWidth) log(`[porch] ⚠ width (${w}) меньше ширины двери (${door.doorWidth.toFixed(2)})`, 'warn');

  const frame = getDoorWorldFrame(door, offsetAlong);
  // ry такой же, как у стены, чтобы локальная X-ось box'ов шла вдоль стены, +Z — наружу
  const ry = edgeRotation(frame.alongX, frame.alongZ);

  // Центр площадки крыльца в плане (в координатах X,Z):
  //  - со стороны стены: центр двери (frame.cx, frame.cz) — это точка НА наружной грани
  //  - площадка выступает на dep наружу: центр платформы = центр + normal * (dep/2)
  const platCx = frame.cx + frame.normalX * (dep / 2);
  const platCz = frame.cz + frame.normalZ * (dep / 2);

  // ── ГЕОМЕТРИЧЕСКИЕ КОНСТАНТЫ ────────────────────
  const colSize    = 0.18;
  const cheekThick = colSize; // 0.18 — колонна полностью на щеке, не свисает
  const axialMidFor = (side) => side * (w / 2 + cheekThick / 2);
  // Проступь (deck slab):
  const nosing      = 0.02;   // выступ ВПЕРЁД от тела, м
  const nosingSide  = 0.02;   // выступ В СТОРОНЫ от щёк, м
  const nosingThick = 0.02;   // толщина проступи по Y, м
  // Полная ширина проступи (тело w + щёки 2*cheekThick + боковой выступ 2*nosingSide)
  const deckW = w + 2 * cheekThick + 2 * nosingSide;
  // Опустим крыльцо вниз на толщину проступи: верх проступи платформы = baseH - nosingThick.
  // Внутри дома пол на baseH (= верх фундамента), переход на крыльцо — небольшая ступенька вниз.
  const porchTopY = baseH - nosingThick;

  // ── МАТЕРИАЛЫ ──────────────────────────────────
  // Тело ступеней / подступенки / тело платформы / щёки — один материал ("риски").
  const stepMat = pickPorchMatName(materialsMap, 'mat_porch_step', ['mat_concrete', 'mat_base']);
  // Верхние плиты (проступи и верх платформы) — другой материал ("декинг").
  const deckMat = pickPorchMatName(materialsMap, 'mat_porch_deck', ['mat_wood', 'mat_porch_step']);

  // ── СТУПЕНИ ────────────────────────────────────
  // stepCount = число rise'ов между порчTopY и землёй. Видимых tread'ов: stepCount-1.
  // (Последний rise — body самой нижней ступени, от Y=0 до её проступи).
  const stepCount = Math.max(1, Math.ceil(porchTopY / stepRise));
  const realRise = porchTopY / stepCount;
  const frontX = frame.cx + frame.normalX * dep;
  const frontZ = frame.cz + frame.normalZ * dep;
  // Tread i (i = 1..stepCount-1):
  //   проступь top Y = porchTopY - i*realRise.
  //   body под проступью (top = проступь_bottom = проступь_top - nosingThick, bottom = next_проступь_top or 0).
  for (let i = 1; i < stepCount; i++) {
    const stepTopY = porchTopY - i * realRise; // верх проступи
    const stepBodyBottomY = (i === stepCount - 1) ? 0 : (porchTopY - (i + 1) * realRise);
    const stepBodyTopY = stepTopY - nosingThick;
    const stepBodyH = stepBodyTopY - stepBodyBottomY;
    const stepBodyCY = (stepBodyTopY + stepBodyBottomY) / 2;
    const nearFromPlatform = (i - 1) * stepRun;
    const farFromPlatform  = i * stepRun;
    const stepCenterFromPlatform = (nearFromPlatform + farFromPlatform) / 2;
    const cx = frontX + frame.normalX * stepCenterFromPlatform;
    const cz = frontZ + frame.normalZ * stepCenterFromPlatform;
    // Тело ступени (под проступью), ширина w
    addBoxAt(parent, w, stepBodyH, stepRun, cx, stepBodyCY, cz, ry, stepMat, 0xb8b3aa);
    // Проступь (deck slab): по бокам шире на cheekThick + nosingSide, вперёд — nosing
    const nosingCY = stepTopY - nosingThick / 2;
    const nosingDepth = stepRun + nosing;
    const nosingShift = nosing / 2;
    const nx = cx + frame.normalX * nosingShift;
    const nz = cz + frame.normalZ * nosingShift;
    addBoxAt(parent, deckW, nosingThick, nosingDepth, nx, nosingCY, nz, ry, deckMat, 0xa68868);
  }
  const stairsEndU = dep + (stepCount - 1) * stepRun;

  // ── ПЛАТФОРМА ─────────────────────────────────
  // Body платформы: ширина w, depth = dep, верх на (porchTopY - nosingThick).
  const platBodyThick = realRise;
  const platBodyTopY = porchTopY - nosingThick;
  const platBodyCY = platBodyTopY - platBodyThick / 2;
  addBoxAt(parent, w, platBodyThick, dep, platCx, platBodyCY, platCz, ry, stepMat, 0xb8b3aa);
  // Верхняя проступь платформы: расширена на cheekThick+nosingSide по бокам и nosing вперёд.
  const platDeckCY = porchTopY - nosingThick / 2;
  const platDeckDepth = dep + nosing;
  const platDeckShift = nosing / 2;
  const platDeckX = platCx + frame.normalX * platDeckShift;
  const platDeckZ = platCz + frame.normalZ * platDeckShift;
  addBoxAt(parent, deckW, nosingThick, platDeckDepth, platDeckX, platDeckCY, platDeckZ, ry, deckMat, 0xa68868);

  // ── КОЛОННЫ (на оси щёк и перил) ────────────────
  const colMat = pickPorchMatName(materialsMap, 'mat_porch_column', ['mat_wood', 'mat_wall']);
  const colH = canopyH;
  for (const side of [-1, +1]) {
    const axMid = axialMidFor(side);
    // Передняя грань колонны = передняя грань платформы (u = dep), стоит на verkhе проступи (porchTopY)
    const cx = frame.cx + frame.alongX * axMid + frame.normalX * (dep - colSize / 2);
    const cz = frame.cz + frame.alongZ * axMid + frame.normalZ * (dep - colSize / 2);
    addBoxAt(parent, colSize, colH, colSize, cx, porchTopY + colH / 2, cz, ry, colMat, 0xc8b89c);
  }

  // ── НАВЕС (плоская плита с наклоном) ─────────────
  if (hasCanopy) {
    const canopyMat = pickPorchMatName(materialsMap, 'mat_porch_canopy', ['mat_roof']);
    // Задний край упирается ровно в стену (u=0) — без врастания.
    // Передний край выходит за колонны (u = dep + frontOverhang).
    const frontOverhang = 0.30;
    const sideOverhang  = 0.10;
    const canopyBackU   = 0.0;
    const canopyFrontU  = dep + frontOverhang;
    const canopySizeZ   = canopyFrontU - canopyBackU; // длина по normal
    const canopySizeX   = deckW + 2 * sideOverhang;   // навес шире щёк
    const canopySizeY   = 0.08;
    const alpha = Math.atan2(canopySlp, canopySizeZ);
    const yCenter = porchTopY + canopyH + canopySlp / 2;
    const uCenter = (canopyBackU + canopyFrontU) / 2;
    const cxCanopy = frame.cx + frame.normalX * uCenter;
    const czCanopy = frame.cz + frame.normalZ * uCenter;
    const geo = new THREE.BoxGeometry(canopySizeX, canopySizeY, canopySizeZ);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.6, metalness: 0.0 });
    mat.name = canopyMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cxCanopy, yCenter, czCanopy);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = ry;
    mesh.rotation.x = alpha;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }

  // ── БОКОВЫЕ ЩЁКИ (СНАРУЖИ тела ступеней, с двух сторон) ────
  const cheekMat = pickPorchMatName(materialsMap, 'mat_porch_step', ['mat_concrete', 'mat_base']);
  for (const side of [-1, +1]) {
    buildPorchCheek(parent, frame, porchTopY, nosingThick, nosing, dep, stepCount, realRise, stepRun, w, side, cheekThick, cheekMat, 0xb8b3aa);
  }

  // ── ПЕРИЛА с балясинами + поручень (горизонтальные, по бокам платформы) ───
  if (hasRail) {
    const railMat = pickPorchMatName(materialsMap, 'mat_porch_railing', ['mat_wood', 'mat_metal']);
    const railUStart = 0.0;
    const railUEnd   = dep;
    const baluRange = { uStart: 0.10, uEnd: dep - colSize - 0.02 };
    for (const side of [-1, +1]) {
      const axMid = axialMidFor(side);
      buildPorchBalustradeHoriz(parent, frame, side, porchTopY, porchTopY + railH, railUStart, railUEnd, baluRange, axMid, ry, railMat, 0x8a6d4a);
    }

    // ── НАКЛОННЫЕ ПЕРИЛА вдоль ступеней ─────
    for (const side of [-1, +1]) {
      const axMid = axialMidFor(side);
      buildPorchBalustradeRake(parent, frame, side, porchTopY, dep, stepCount, realRise, stepRun, railH, axMid, ry, railMat, 0x8a6d4a);
    }
  }

  // ── PAD ПОД КРЫЛЬЦОМ ────
  // Стыкуется с pad-ом дома (строится в buildHouseFromDescriptor по реальному outline).
  // Y и offset согласованы: padThick=0.05, Y центра=padThick/2, offset=0.30.
  const padOffset = 0.30;
  const padThick  = 0.05;
  const padUStart = -padOffset; // заходим под дом на padOffset, в зону pad-а дома
  const padUEnd   = stairsEndU + padOffset;
  const padSizeZ  = padUEnd - padUStart;
  const padSizeX  = deckW + 2 * padOffset;
  const uCenterPad = (padUStart + padUEnd) / 2;
  const padCx = frame.cx + frame.normalX * uCenterPad;
  const padCz = frame.cz + frame.normalZ * uCenterPad;
  const padMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.0 });
  padMat.name = 'mat_porch_pad';
  const padGeo = new THREE.BoxGeometry(padSizeX, padThick, padSizeZ);
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(padCx, padThick / 2, padCz);
  padMesh.rotation.y = ry;
  padMesh.receiveShadow = true;
  parent.add(padMesh);

  log(`[porch] ✓ door@(${frame.cx.toFixed(2)},${frame.cz.toFixed(2)}) w=${w}m, d=${dep}m, steps=${stepCount}×${realRise.toFixed(3)}m`, 'ok');
}

// Боковая щека крыльца — стенка-сэндвич с лестничным профилем.
// Верх щеки идёт по «body top» каждого уровня (= низ проступи). Проступи свешиваются над щекой
// как nosing — это нормально для лестницы (передняя грань щеки = передняя грань body подступенка).
function buildPorchCheek(parent, frame, porchTopY, nosingThick, nosing, dep, stepCount, realRise, stepRun, w, side, T, matName, color) {
  const pts2D = [];
  pts2D.push(new THREE.Vector2(0, 0));                          // back-bottom (у стены, на земле)
  pts2D.push(new THREE.Vector2(0, porchTopY - nosingThick));    // back-top body платформы
  pts2D.push(new THREE.Vector2(dep, porchTopY - nosingThick));  // front-top body платформы (= перед body, без nosing)
  for (let i = 1; i < stepCount; i++) {
    const bodyTopY = porchTopY - i * realRise - nosingThick;
    pts2D.push(new THREE.Vector2(dep + (i - 1) * stepRun, bodyTopY)); // back-top body step i
    pts2D.push(new THREE.Vector2(dep +  i      * stepRun, bodyTopY)); // front-top body step i
  }
  // Последний vertical drop к земле — на передней грани body нижней ступени.
  pts2D.push(new THREE.Vector2(dep + (stepCount - 1) * stepRun, 0));

  const triangles = THREE.ShapeUtils.triangulateShape(pts2D, []);
  if (!triangles.length) return;

  // Inner axial = край тела ступени (axial = ±w/2),
  // outer axial = ±(w/2 + T). Щёки находятся СНАРУЖИ тела ступеней.
  const axialInner = side * (w / 2);
  const axialOuter = side * (w / 2 + T);
  const toWorld = (u, v, axial) => ({
    x: frame.cx + frame.normalX * u + frame.alongX * axial,
    y: v,
    z: frame.cz + frame.normalZ * u + frame.alongZ * axial,
  });

  const positions = [];
  const N = pts2D.length;
  for (const p of pts2D) { const w3 = toWorld(p.x, p.y, axialInner); positions.push(w3.x, w3.y, w3.z); }
  for (const p of pts2D) { const w3 = toWorld(p.x, p.y, axialOuter); positions.push(w3.x, w3.y, w3.z); }

  const indices = [];
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
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  mat.name = matName;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
}

// Горизонтальные перила (на платформе): верхний поручень + балясины с шагом.
// Поручень идёт от uStart до uEnd (включая заход в стену и колонну).
// baluRange — диапазон u, где можно ставить балясины (внутри: чтобы избежать стены/колонны).
// axialPos — координата вдоль стены (фиксированная).
// baseY — низ балясин (= Y верха платформы); topY — верх перил.
// Нижняя планка убрана — её роль играет верхняя грань боковой щеки.
function buildPorchBalustradeHoriz(parent, frame, side, baseY, topY, uStart, uEnd, baluRange, axialPos, ry, matName, color) {
  const railLength = uEnd - uStart;
  if (railLength < 0.1) return;
  const handrailH   = 0.06;
  const handrailW   = 0.08;
  const baluT       = 0.04;
  const baluSpacing = 0.26; // вдвое реже, чем было (0.13)
  const baluBaseY = baseY;
  const baluTopY  = topY - handrailH;
  if (baluTopY <= baluBaseY) return;

  // Верхний поручень — на всю длину (от стены до колонны)
  const uRailCenter = (uStart + uEnd) / 2;
  const cxRail = frame.cx + frame.normalX * uRailCenter + frame.alongX * axialPos;
  const czRail = frame.cz + frame.normalZ * uRailCenter + frame.alongZ * axialPos;
  addBoxAt(parent, handrailW, handrailH, railLength, cxRail, topY - handrailH / 2, czRail, ry, matName, color);

  // Балясины внутри baluRange
  const baluLength = baluRange.uEnd - baluRange.uStart;
  if (baluLength < baluSpacing) return;
  const count = Math.max(2, Math.round(baluLength / baluSpacing));
  const stepU = baluLength / count;
  const baluH = baluTopY - baluBaseY;
  for (let i = 0; i <= count; i++) {
    const u = baluRange.uStart + i * stepU;
    const bx = frame.cx + frame.normalX * u + frame.alongX * axialPos;
    const bz = frame.cz + frame.normalZ * u + frame.alongZ * axialPos;
    addBoxAt(parent, baluT, baluH, baluT, bx, baluBaseY + baluH / 2, bz, ry, matName, color);
  }
}

// Наклонные перила вдоль ступеней: поручень наклонный, балясины разной высоты на каждой ступени.
// baseH здесь — это уровень верха платформы (porchTopY у вызывающего кода).
function buildPorchBalustradeRake(parent, frame, side, baseH, dep, stepCount, realRise, stepRun, railH, axialPos, ry, matName, color) {
  if (stepCount < 2) return; // нужно как минимум 1 видимая ступень
  const handrailH = 0.06;
  const handrailW = 0.08;
  const baluT = 0.04;

  // Поручень: от (u=dep, Y=baseH+railH) до (u=stairsEndU, Y=railH).
  const stairsEndU = dep + (stepCount - 1) * stepRun;
  const uStart = dep;
  const uEnd = stairsEndU;
  const yStart = baseH + railH;
  const yEnd = railH;
  const du = uEnd - uStart;
  const dy = yEnd - yStart; // отрицательно
  const railLen3D = Math.hypot(du, dy);
  const slopeAngle = Math.atan2(-dy, du); // положительный угол наклона передней части ВНИЗ

  // Центр поручня
  const uCenter = (uStart + uEnd) / 2;
  const yCenter = (yStart + yEnd) / 2 - handrailH / 2; // центр Y учитывает толщину
  const cxRail = frame.cx + frame.normalX * uCenter + frame.alongX * axialPos;
  const czRail = frame.cz + frame.normalZ * uCenter + frame.alongZ * axialPos;

  // BoxGeometry: длина по local Z = railLen3D (вдоль normal в плане), толщина по Y, ширина по X
  const geo = new THREE.BoxGeometry(handrailW, handrailH, railLen3D);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
  mat.name = matName;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cxRail, yCenter, czRail);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = ry;
  mesh.rotation.x = slopeAngle; // передний край (+Z) опускается
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);

  // Балясины: i = 1..stepCount-2 (последняя ступень получает newel вместо балясины — иначе они дублируются).
  for (let i = 1; i < stepCount - 1; i++) {
    const u = dep + i * stepRun - 0.02;
    const stepTopY = baseH - i * realRise;
    const yRailAtU = yStart + dy * (u - uStart) / du;
    const baluTopY = yRailAtU - handrailH;
    const baluH = baluTopY - stepTopY;
    if (baluH < 0.05) continue;
    const bx = frame.cx + frame.normalX * u + frame.alongX * axialPos;
    const bz = frame.cz + frame.normalZ * u + frame.alongZ * axialPos;
    addBoxAt(parent, baluT, baluH, baluT, bx, stepTopY + baluH / 2, bz, ry, matName, color);
  }
  // Нижний newel post — на ВЕРХУ нижней ступени (не на земле перед ней),
  // чтобы не «протыкать» проступь.
  {
    const u = stairsEndU - 0.04; // на верху нижней ступени, чуть за её передним краем
    const stepTopY = baseH - (stepCount - 1) * realRise; // = realRise
    const yRailAtU = yStart + dy * (u - uStart) / du;
    const postBottom = stepTopY;
    const postTop = yRailAtU + 0.05; // на 5 см выше поручня
    const postH = postTop - postBottom;
    const postT = baluT * 1.6;
    const bx = frame.cx + frame.normalX * u + frame.alongX * axialPos;
    const bz = frame.cz + frame.normalZ * u + frame.alongZ * axialPos;
    addBoxAt(parent, postT, postH, postT, bx, postBottom + postH / 2, bz, ry, matName, color);
  }
}

// ══════════════════════════════════════════════
// DECOR
// ══════════════════════════════════════════════
function detectNativeBbox(mod) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
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
  const rects = decomposeOrthoPolygonIntoRectangles(outline);
  const tanA = Math.tan((angleDeg || 22) * Math.PI / 180);

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
      const shift = -bb.minZ;
      g.position.set(endX + item.dz * shift, wallTopY - bb.maxY, endZ - item.dx * shift);
      g.rotation.y = edgeRotation(item.dx, item.dz);
      setupShadows(g);
      parent.add(g);
      counts.gutter++;
    }
  }

  if (desc.features.cornice) {
    // Cornice строится на ПОЛНУЮ длину wall (без trim). На concave-углах две cornice'ы
    // от соседних стен пересекаются в bay-зоне (overlap volume 0.15×0.15×0.30 см) — это
    // менее заметно, чем gap, и пересечение скрыто внутри bay-corner. Идеальное решение —
    // отдельный mod_cornice_concave_corner.glb (TODO).
    for (const item of outline.items) {
      if (item.type !== 'wall') continue;
      if (item.runLength < 0.3) continue;
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
      if (sharedCorniceMat) {
        c.traverse(child => { if (child.isMesh) child.material = sharedCorniceMat; });
      } else {
        c.traverse(child => { if (child.isMesh && child.material) child.material.name = 'mat_cornice'; });
      }
      setupShadows(c);
      parent.add(c);
      counts.cornice++;
    }
    // Угловые элементы карниза (mod_cornice_corner.glb) на convex-pillars: turn > 0 на CW-обходе.
    // Закрывают зазор cd×cd между двумя cornice'ами, встречающимися в углу.
    counts.cornice_corner = 0;
    for (let i = 0; i < outline.items.length; i++) {
      const item = outline.items[i];
      if (item.type !== 'pillar' || !(item.turn > 0)) continue;
      const prev = outline.items[(i - 1 + outline.items.length) % outline.items.length];
      const next = outline.items[(i + 1) % outline.items.length];
      if (!prev || !next || prev.type !== 'wall' || next.type !== 'wall') continue;
      const cc = cloneModule(modules, 'cornice_corner');
      if (!cc) break;
      const bbcc = detectNativeBbox(cc);
      dumpDecorBbox('cornice_corner', bbcc);
      cc.scale.z = -1;
      // basis: xAxis = prev exterior, yUp, zAxis = next exterior (right-handed для convex CW-углов).
      const prevExt = new THREE.Vector3(prev.dz, 0, -prev.dx);
      const nextExt = new THREE.Vector3(next.dz, 0, -next.dx);
      const yUp = new THREE.Vector3(0, 1, 0);
      const basis = new THREE.Matrix4().makeBasis(prevExt, yUp, nextExt);
      cc.quaternion.setFromRotationMatrix(basis);
      cc.position.set(item.x, wallTopY - bbcc.maxY, item.z);
      if (sharedCorniceMat) {
        cc.traverse(child => { if (child.isMesh) child.material = sharedCorniceMat; });
      } else {
        cc.traverse(child => { if (child.isMesh && child.material) child.material.name = 'mat_cornice'; });
      }
      setupShadows(cc);
      parent.add(cc);
      counts.cornice_corner++;
    }
  }

  if (desc.features.downpipe) {
    const wallH = wallTopY - baseY;
    for (const item of outline.items) {
      if (item.type !== 'pillar') continue;
      if (item.turn < 0) continue;
      const d = cloneModule(modules, 'downpipe');
      if (!d) break;
      const bb = detectNativeBbox(d);
      dumpDecorBbox('downpipe', bb);
      d.scale.y = wallH / Math.max(0.1, bb.sizeY);
      d.position.set(item.x, baseY - bb.minY * d.scale.y, item.z);
      setupShadows(d);
      parent.add(d);
      counts.downpipe++;
    }
  }

  if (desc.features.chimney) {
    const c = cloneModule(modules, 'chimney');
    if (c) {
      const bb = detectNativeBbox(c);
      dumpDecorBbox('chimney', bb);
      const pos = (desc.features.chimney.position) || [0.5, 0.5];
      const obb = outline.bbox;
      const cx = obb.minX + pos[0] * (obb.maxX - obb.minX);
      const cz = obb.minZ + pos[1] * (obb.maxZ - obb.minZ);
      let maxRoofH = 0;
      for (const r of rects) {
        if (cx < r.minX - 0.001 || cx > r.maxX + 0.001) continue;
        if (cz < r.minZ - 0.001 || cz > r.maxZ + 0.001) continue;
        const dx = Math.min(cx - r.minX, r.maxX - cx) + eave;
        const dz = Math.min(cz - r.minZ, r.maxZ - cz) + eave;
        const halfShort = (r.maxX - r.minX < r.maxZ - r.minZ) ? (r.maxX - r.minX) / 2 + eave : (r.maxZ - r.minZ) / 2 + eave;
        const h = Math.min(Math.min(dx, dz), halfShort) * tanA;
        if (h > maxRoofH) maxRoofH = h;
      }
      const drop = (desc.features.chimney.drop !== undefined) ? desc.features.chimney.drop : 0.5;
      c.position.set(cx, wallTopY + maxRoofH - drop - bb.minY, cz);
      setupShadows(c);
      parent.add(c);
      counts.chimney++;
    }
  }

  log(`[decor] gutter=${counts.gutter}, cornice=${counts.cornice} (corners=${counts.cornice_corner || 0}), downpipe=${counts.downpipe}, chimney=${counts.chimney}`, 'dim');
}

// ══════════════════════════════════════════════
// DECOMPOSITION для hip/gable крыш
// ══════════════════════════════════════════════
function decomposeOrthoPolygonIntoRectangles(outline) {
  const corners = outline.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) return [];

  const N = corners.length;
  const verticalEdges = [];
  for (let i = 0; i < N; i++) {
    const a = corners[i], b = corners[(i + 1) % N];
    if (Math.abs(a.x - b.x) < SS_EPS) {
      verticalEdges.push({ x: a.x, zMin: Math.min(a.z, b.z), zMax: Math.max(a.z, b.z) });
    }
  }

  const zSet = new Set();
  corners.forEach(c => zSet.add(Math.round(c.z * 1000) / 1000));
  const zSorted = [...zSet].sort((a, b) => a - b);
  if (zSorted.length < 2) return [];

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

  const candidates = [];
  for (let s = 0; s < slabs.length; s++) {
    for (const intv of slabs[s].intervals) {
      let zMin = slabs[s].z0, zMax = slabs[s].z1;
      for (let s2 = s - 1; s2 >= 0; s2--) {
        const contains = slabs[s2].intervals.some(I => I.x0 <= intv.x0 + SS_EPS && I.x1 >= intv.x1 - SS_EPS);
        if (contains) zMin = slabs[s2].z0;
        else break;
      }
      for (let s2 = s + 1; s2 < slabs.length; s2++) {
        const contains = slabs[s2].intervals.some(I => I.x0 <= intv.x0 + SS_EPS && I.x1 >= intv.x1 - SS_EPS);
        if (contains) zMax = slabs[s2].z1;
        else break;
      }
      candidates.push({ minX: intv.x0, maxX: intv.x1, minZ: zMin, maxZ: zMax });
    }
  }

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
      if (isContained(ci, candidates[j]) && !isEqual(ci, candidates[j])) { contained = true; break; }
    }
    if (contained) continue;
    if (result.some(r => isEqual(r, ci))) continue;
    result.push(ci);
  }
  return result;
}

function inflateOrthoOutline(outline, eave) {
  if (eave <= 0) return outline;
  const items = outline.items;
  const newPillarPos = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'pillar') continue;
    const prevW = items[(i - 1 + items.length) % items.length];
    const nextW = items[(i + 1) % items.length];
    const bx = -prevW.dz + -nextW.dz;
    const bz = prevW.dx + nextW.dx;
    // ВСЕГДА anti-interior (наружу от тела дома):
    //   convex pillar — наружу от здания;
    //   concave pillar — в bay-зону (= тоже anti-interior относительно тела дома).
    // Раньше для concave использовался sign=+1 — это сдвигало внутрь тела (баг).
    newPillarPos[i] = { x: item.x - bx * eave, z: item.z - bz * eave };
  }
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
      const prevP = newPillarPos[(i - 1 + items.length) % items.length];
      const nextP = newPillarPos[(i + 1) % items.length];
      const dx = nextP.x - prevP.x, dz = nextP.z - prevP.z;
      const newRun = Math.hypot(dx, dz);
      newItems.push({ ...item, x: prevP.x, z: prevP.z, runLength: newRun });
    }
  }
  return { items: newItems, bbox: { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ } };
}

// ══════════════════════════════════════════════
// ROOF BUILDERS
// ══════════════════════════════════════════════
function buildHipRoof(parent, baseY, bbox, angleDeg, eave) {
  const x0 = bbox.minX - eave, x1 = bbox.maxX + eave;
  const z0 = bbox.minZ - eave, z1 = bbox.maxZ + eave;
  const L = x1 - x0, W = z1 - z0;
  const longAxisX = L >= W;
  const halfShort = (longAxisX ? W : L) / 2;
  const rise = halfShort * Math.tan((angleDeg || 22) * Math.PI / 180);
  const ridgeY = baseY + rise;
  const ridgeLen = Math.abs(L - W);

  let v4, v5;
  if (longAxisX) {
    const ridgeZ = (z0 + z1) / 2;
    const rx0 = x0 + (L - ridgeLen) / 2, rx1 = rx0 + ridgeLen;
    v4 = [rx0, ridgeY, ridgeZ]; v5 = [rx1, ridgeY, ridgeZ];
  } else {
    const ridgeX = (x0 + x1) / 2;
    const rz0 = z0 + (W - ridgeLen) / 2, rz1 = rz0 + ridgeLen;
    v4 = [ridgeX, ridgeY, rz0]; v5 = [ridgeX, ridgeY, rz1];
  }

  const verts = [
    [x0, baseY, z0], [x1, baseY, z0], [x1, baseY, z1], [x0, baseY, z1], v4, v5,
  ];
  let triangles;
  if (longAxisX) {
    triangles = [[0, 4, 5], [0, 5, 1], [2, 4, 3], [2, 5, 4], [0, 3, 4], [1, 5, 2]];
  } else {
    triangles = [[0, 3, 5], [0, 5, 4], [2, 1, 4], [2, 4, 5], [0, 4, 1], [3, 2, 5]];
  }

  const positions = [], indices = [];
  for (const v of verts) positions.push(...v);
  for (const t of triangles) indices.push(...t);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8b3a3a, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, flatShading: true,
  });
  mat.name = 'mat_roof';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof] hip: rise=${rise.toFixed(2)}m, ridgeLen=${ridgeLen.toFixed(2)}m, eave=${eave}`, 'dim');
}

function buildGableRoof(parent, baseY, bbox, angleDeg, eave) {
  const x0 = bbox.minX - eave, x1 = bbox.maxX + eave;
  const z0 = bbox.minZ - eave, z1 = bbox.maxZ + eave;
  const longAxisX = (bbox.maxX - bbox.minX) >= (bbox.maxZ - bbox.minZ);

  let v4, v5, rise;
  if (longAxisX) {
    const halfShort = (z1 - z0) / 2;
    rise = halfShort * Math.tan((angleDeg || 30) * Math.PI / 180);
    const ridgeY = baseY + rise, ridgeZ = (z0 + z1) / 2;
    v4 = [x0, ridgeY, ridgeZ]; v5 = [x1, ridgeY, ridgeZ];
  } else {
    const halfShort = (x1 - x0) / 2;
    rise = halfShort * Math.tan((angleDeg || 30) * Math.PI / 180);
    const ridgeY = baseY + rise, ridgeX = (x0 + x1) / 2;
    v4 = [ridgeX, ridgeY, z0]; v5 = [ridgeX, ridgeY, z1];
  }

  const verts = [
    [x0, baseY, z0], [x1, baseY, z0], [x1, baseY, z1], [x0, baseY, z1], v4, v5,
  ];
  let slopeTriangles, gableTriangles;
  if (longAxisX) {
    slopeTriangles = [[0, 5, 1], [0, 4, 5], [2, 4, 3], [2, 5, 4]];
    gableTriangles = [[3, 0, 4], [1, 2, 5]];
  } else {
    slopeTriangles = [[0, 5, 3], [0, 4, 5], [2, 4, 1], [2, 5, 4]];
    gableTriangles = [[0, 1, 4], [2, 3, 5]];
  }

  function makeMesh(triangles, color, matName) {
    const positions = [], indices = [];
    for (const v of verts) positions.push(...v);
    for (const t of triangles) indices.push(...t);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, flatShading: true,
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

function buildSlabPolygon(parent, points2D, baseY, slabH, matName, color) {
  if (points2D.length < 3) return;
  const triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
  if (!triangles.length) return;
  const positions = [], indices = [];
  const N = points2D.length;
  const yTop = baseY + slabH, yBot = baseY;
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
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: true,
  });
  mat.name = matName;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildInterFloorSlab(parent, outline, yOffset, extension, corniceColor) {
  const expanded = (extension > 0) ? inflateOrthoOutline(outline, extension) : outline;
  const corners = expanded.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) return;
  const points2D = corners.map(c => new THREE.Vector2(c.x, c.z));
  const SLAB_THICKNESS = 0.20;
  const color = (corniceColor !== undefined) ? corniceColor : 0xc8b89c;
  buildSlabPolygon(parent, points2D, yOffset - SLAB_THICKNESS, SLAB_THICKNESS, 'mat_cornice', color);
  log(`[slab] inter-floor cornice at Y=${yOffset.toFixed(2)}, extension=${extension.toFixed(2)}m`, 'dim');
}

function buildFlatRoofPoly(parent, baseY, outline, eave) {
  const corners = outline.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) { log('[roof] flat poly: <3 corners', 'warn'); return; }
  const points2D = corners.map(c => new THREE.Vector2(c.x, c.z));
  const triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
  const slabH = 0.10;
  const yTop = baseY + slabH, yBot = baseY;
  const positions = [], indices = [];
  const N = points2D.length;
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
  const mat = new THREE.MeshStandardMaterial({
    color: 0x707070, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, flatShading: true,
  });
  mat.name = 'mat_roof';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof] flat (polygon): ${N} corners, ${triangles.length} triangles`, 'dim');
}

// Ломаная мансардная крыша (Mansard roof) — два угла наклона:
// нижний (крутой ~60-70°) до излома, верхний (пологий ~25-35°) до конька.
// Фронтоны — пятиугольники (5 вершин с изломом). Все материалы — flat shading.
function buildBrokenMansardRoof(parent, baseY, bbox, eave, mansardSpec) {
  const x0 = bbox.minX - eave, x1 = bbox.maxX + eave;
  const z0 = bbox.minZ - eave, z1 = bbox.maxZ + eave;
  const L = x1 - x0, W = z1 - z0;
  const longAxisX = L >= W;

  const lowerAngle  = (mansardSpec.lower_angle  !== undefined) ? mansardSpec.lower_angle  : 70;
  const upperAngle  = (mansardSpec.upper_angle  !== undefined) ? mansardSpec.upper_angle  : 30;
  const lowerHeight = (mansardSpec.lower_height !== undefined) ? mansardSpec.lower_height : 2.0;
  const tanLower = Math.tan(lowerAngle * Math.PI / 180);
  const tanUpper = Math.tan(upperAngle * Math.PI / 180);

  if (tanLower < 0.01) { log('[roof] mansard: lower_angle too shallow', 'warn'); return; }

  const halfShort = (longAxisX ? W : L) / 2;
  const horizontalLower = lowerHeight / tanLower;
  if (horizontalLower >= halfShort - 0.05) {
    log(`[roof] mansard: lower_height ${lowerHeight}m too tall для half-width ${halfShort.toFixed(2)}m — fallback to gable`, 'warn');
    return buildGableRoof(parent, baseY, bbox, lowerAngle, eave);
  }
  const kinkY = baseY + lowerHeight;
  const ridgeY = kinkY + (halfShort - horizontalLower) * tanUpper;

  let verts, slopeTris, gableTris;
  if (longAxisX) {
    const kinkZNorth = z0 + horizontalLower;
    const kinkZSouth = z1 - horizontalLower;
    const ridgeZ = (z0 + z1) / 2;
    verts = [
      [x0, baseY, z0],          // 0: NW base
      [x1, baseY, z0],          // 1: NE base
      [x1, baseY, z1],          // 2: SE base
      [x0, baseY, z1],          // 3: SW base
      [x0, kinkY, kinkZNorth],  // 4: NW kink
      [x1, kinkY, kinkZNorth],  // 5: NE kink
      [x1, kinkY, kinkZSouth],  // 6: SE kink
      [x0, kinkY, kinkZSouth],  // 7: SW kink
      [x0, ridgeY, ridgeZ],     // 8: W ridge
      [x1, ridgeY, ridgeZ],     // 9: E ridge
    ];
    slopeTris = [
      [0, 1, 5], [0, 5, 4],     // N lower
      [3, 7, 6], [3, 6, 2],     // S lower
      [4, 5, 9], [4, 9, 8],     // N upper
      [7, 8, 9], [7, 9, 6],     // S upper
    ];
    gableTris = [
      [1, 2, 6], [1, 6, 9], [1, 9, 5],   // E pentagon
      [0, 4, 8], [0, 8, 7], [0, 7, 3],   // W pentagon
    ];
  } else {
    const kinkXWest = x0 + horizontalLower;
    const kinkXEast = x1 - horizontalLower;
    const ridgeX = (x0 + x1) / 2;
    verts = [
      [x0, baseY, z0],          // 0: NW
      [x1, baseY, z0],          // 1: NE
      [x1, baseY, z1],          // 2: SE
      [x0, baseY, z1],          // 3: SW
      [kinkXWest, kinkY, z0],   // 4: NW kink
      [kinkXEast, kinkY, z0],   // 5: NE kink
      [kinkXEast, kinkY, z1],   // 6: SE kink
      [kinkXWest, kinkY, z1],   // 7: SW kink
      [ridgeX, ridgeY, z0],     // 8: N ridge
      [ridgeX, ridgeY, z1],     // 9: S ridge
    ];
    slopeTris = [
      [0, 3, 7], [0, 7, 4],     // W lower
      [1, 5, 6], [1, 6, 2],     // E lower
      [4, 7, 9], [4, 9, 8],     // W upper
      [5, 8, 9], [5, 9, 6],     // E upper
    ];
    gableTris = [
      [0, 4, 8], [0, 8, 5], [0, 5, 1],   // N pentagon
      [3, 2, 6], [3, 6, 9], [3, 9, 7],   // S pentagon
    ];
  }

  function makeMesh(triangles, color, matName) {
    const positions = [], indices = [];
    for (const v of verts) positions.push(...v);
    for (const t of triangles) indices.push(...t);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, flatShading: true,
    });
    mat.name = matName;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }
  makeMesh(slopeTris, 0x8b3a3a, 'mat_roof');
  makeMesh(gableTris, 0xf5e6c8, 'mat_wall');
  log(`[roof] mansard broken: lower=${lowerAngle}°/${lowerHeight}m, upper=${upperAngle}°, ridge_h=${(ridgeY - baseY).toFixed(2)}m`, 'dim');
}

// Knee wall — низкая вертикальная стенка по периметру outline (для мансарды).
// Использует GLB-модули `wall_segment` и `pillar` (без окон/дверей).
function buildKneeWall(parent, modules, outline, baseY, kneeHeight, wt, ps) {
  if (kneeHeight <= 0.01) return;
  for (const item of outline.items) {
    if (item.type === 'pillar') {
      const p = cloneModule(modules, 'pillar');
      if (!p) continue;
      p.scale.set(ps, kneeHeight, ps);
      const pos = pillarPosition(item, ps);
      p.position.set(pos.x, baseY, pos.z);
      setupShadows(p);
      parent.add(p);
    } else if (item.type === 'wall') {
      const wallLength = item.wallLength;
      if (wallLength <= 0.01) continue;
      const seg = cloneModule(modules, 'wall_segment');
      if (!seg) continue;
      seg.scale.set(wallLength, kneeHeight, wt / 0.2);
      const startX = item.x + item.dx * item.startOffset;
      const startZ = item.z + item.dz * item.startOffset;
      const endX = startX + item.dx * wallLength;
      const endZ = startZ + item.dz * wallLength;
      seg.position.set(endX, baseY, endZ);
      seg.rotation.y = edgeRotation(item.dx, item.dz);
      setupShadows(seg);
      parent.add(seg);
    }
  }
  log(`[roof] knee wall: h=${kneeHeight.toFixed(2)}m`, 'dim');
}

// Soffit — горизонтальная подшивка свеса крыши (= потолок снаружи дома, видимый снизу свеса).
// Строится по периметру outline, расширенному на eave. Тонкий sheet чуть выше wallTopY,
// чтобы не пересекаться со cornice (top of cornice = wallTopY).
function buildRoofSoffit(parent, outline, wallTopY, eave) {
  if (eave <= 0.001) return;
  const expanded = inflateOrthoOutline(outline, eave);
  const corners = expanded.items.filter(i => i.type === 'pillar');
  if (corners.length < 3) return;
  const points2D = corners.map(c => new THREE.Vector2(c.x, c.z));
  const triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
  if (!triangles.length) return;
  // Sheet на уровне wallTopY + 1 мм. Только нижняя грань видна снизу свеса.
  // Используем обратное winding (вершины наоборот) — normal вниз.
  const yPlane = wallTopY + 0.001;
  const positions = [], indices = [];
  for (const p of points2D) positions.push(p.x, yPlane, p.y);
  for (const t of triangles) indices.push(t[0], t[2], t[1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf0e8d8, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, flatShading: true,
  });
  mat.name = 'mat_soffit';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  parent.add(mesh);
  log(`[roof] soffit: ${corners.length} corners, eave=${eave}m`, 'dim');
}

function buildRoof(parent, baseY, bbox, outline, roofType, angleDeg, eave, options) {
  options = options || {};
  if (roofType === 'flat')  return buildFlatRoofPoly(parent, baseY, outline, eave);

  if (roofType === 'hip') {
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log('[roof] decomposition failed, fallback на bbox-hip', 'warn');
      buildHipRoof(parent, baseY, bbox, angleDeg, eave);
      buildRoofSoffit(parent, outline, baseY, eave);
      return;
    }
    log(`[roof] hip: декомпозиция на ${rects.length} прямоугольник(ов)`, 'dim');
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      buildHipRoof(parent, baseY + i * 0.001, rectBbox, angleDeg, eave);
    }
    buildRoofSoffit(parent, outline, baseY, eave);
    return;
  }
  if (roofType === 'mansard') {
    const mansardSpec = options.mansardSpec || {};
    const kneeHeight = (mansardSpec.knee_height !== undefined) ? mansardSpec.knee_height : 0;
    if (kneeHeight > 0 && options.modules) {
      buildKneeWall(parent, options.modules, outline, baseY, kneeHeight, options.wt || 0.2, options.ps || 0.2);
    }
    const roofBaseY = baseY + kneeHeight;
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log('[roof] mansard: decomposition failed, fallback на bbox', 'warn');
      return buildBrokenMansardRoof(parent, roofBaseY, bbox, eave, mansardSpec);
    }
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    log(`[roof] mansard: ${rects.length} rect (1 mansard main + ${rects.length - 1} hip)`, 'dim');
    // Пристройки получают hip с углом, близким к нижнему скату мансарды (для визуальной целостности).
    const subAngle = (mansardSpec.lower_angle !== undefined) ? mansardSpec.lower_angle : angleDeg;
    for (let i = 1; i < rects.length; i++) {
      const r = rects[i];
      const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      buildHipRoof(parent, roofBaseY + (i - 1) * 0.001, rectBbox, subAngle, eave);
    }
    const main = rects[0];
    const mainBbox = { minX: main.minX, maxX: main.maxX, minZ: main.minZ, maxZ: main.maxZ };
    buildBrokenMansardRoof(parent, roofBaseY + (rects.length - 1) * 0.001, mainBbox, eave, mansardSpec);
    buildRoofSoffit(parent, outline, roofBaseY, eave);
    return;
  }
  if (roofType === 'gable' || roofType === 'gable_cross') {
    const isGableCross = (roofType === 'gable_cross');
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log(`[roof] ${roofType}: decomposition failed, fallback на bbox`, 'warn');
      return buildGableRoof(parent, baseY, bbox, angleDeg, eave);
    }
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    if (isGableCross) {
      log(`[roof] gable_cross: ${rects.length} rect, все gable`, 'dim');
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
        buildGableRoof(parent, baseY + i * 0.001, rectBbox, angleDeg, eave);
      }
    } else {
      log(`[roof] gable: ${rects.length} rect (1 gable main + ${rects.length - 1} hip)`, 'dim');
      for (let i = 1; i < rects.length; i++) {
        const r = rects[i];
        const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
        buildHipRoof(parent, baseY + (i - 1) * 0.001, rectBbox, angleDeg, eave);
      }
      const main = rects[0];
      const mainBbox = { minX: main.minX, maxX: main.maxX, minZ: main.minZ, maxZ: main.maxZ };
      buildGableRoof(parent, baseY + (rects.length - 1) * 0.001, mainBbox, angleDeg, eave);
    }
    buildRoofSoffit(parent, outline, baseY, eave);
    return;
  }
  buildHipRoof(parent, baseY, bbox, angleDeg, eave);
  buildRoofSoffit(parent, outline, baseY, eave);
}

// ══════════════════════════════════════════════
// ROOF WINDOWS: velux (накладной) + dormer (процедурный, с утоплением)
// ══════════════════════════════════════════════

// Возвращает «фрейм» ската: 4 вершины (eaveLeft, eaveRight, ridgeRight, ridgeLeft) +
// единичные оси (axisAlong вдоль карниза, axisUp вверх по скату, normal наружу).
// Для триangular-ската (hip end-slope) ridgeLeft === ridgeRight === вершина.
// Для mansard (ломаной крыши) frame описывает НИЖНИЙ крутой скат от eave до kink-линии
// (использует mansardSpec.lower_height и lower_angle).
// roofType: 'hip' | 'gable' | 'gable_cross' | 'mansard'. slope: 'north' | 'south' | 'east' | 'west'.
function getSlopeFrame(slope, rectBbox, longAxisX, angleDeg, baseY, eave, roofType, mansardSpec) {
  const x0 = rectBbox.minX - eave, x1 = rectBbox.maxX + eave;
  const z0 = rectBbox.minZ - eave, z1 = rectBbox.maxZ + eave;
  const L = x1 - x0, W = z1 - z0;
  const tanA = Math.tan(angleDeg * Math.PI / 180);

  let eaveLeft, eaveRight, ridgeLeft, ridgeRight, ridgeY;

  if (roofType === 'hip') {
    const halfShort = (longAxisX ? W : L) / 2;
    ridgeY = baseY + halfShort * tanA;
    const ridgeLen = Math.abs(L - W);
    if (longAxisX) {
      const rx0 = x0 + (L - ridgeLen) / 2, rx1 = rx0 + ridgeLen;
      const ridgeZ = (z0 + z1) / 2;
      switch (slope) {
        case 'north':
          eaveLeft=[x0,baseY,z0]; eaveRight=[x1,baseY,z0];
          ridgeLeft=[rx0,ridgeY,ridgeZ]; ridgeRight=[rx1,ridgeY,ridgeZ]; break;
        case 'south':
          eaveLeft=[x1,baseY,z1]; eaveRight=[x0,baseY,z1];
          ridgeLeft=[rx1,ridgeY,ridgeZ]; ridgeRight=[rx0,ridgeY,ridgeZ]; break;
        case 'east': // треугольный скат на восточном торце
          eaveLeft=[x1,baseY,z0]; eaveRight=[x1,baseY,z1];
          ridgeLeft=[rx1,ridgeY,ridgeZ]; ridgeRight=[rx1,ridgeY,ridgeZ]; break;
        case 'west':
          eaveLeft=[x0,baseY,z1]; eaveRight=[x0,baseY,z0];
          ridgeLeft=[rx0,ridgeY,ridgeZ]; ridgeRight=[rx0,ridgeY,ridgeZ]; break;
        default: return null;
      }
    } else {
      const rz0 = z0 + (W - ridgeLen) / 2, rz1 = rz0 + ridgeLen;
      const ridgeX = (x0 + x1) / 2;
      switch (slope) {
        case 'east':
          eaveLeft=[x1,baseY,z0]; eaveRight=[x1,baseY,z1];
          ridgeLeft=[ridgeX,ridgeY,rz0]; ridgeRight=[ridgeX,ridgeY,rz1]; break;
        case 'west':
          eaveLeft=[x0,baseY,z1]; eaveRight=[x0,baseY,z0];
          ridgeLeft=[ridgeX,ridgeY,rz1]; ridgeRight=[ridgeX,ridgeY,rz0]; break;
        case 'north':
          eaveLeft=[x0,baseY,z0]; eaveRight=[x1,baseY,z0];
          ridgeLeft=[ridgeX,ridgeY,rz0]; ridgeRight=[ridgeX,ridgeY,rz0]; break;
        case 'south':
          eaveLeft=[x1,baseY,z1]; eaveRight=[x0,baseY,z1];
          ridgeLeft=[ridgeX,ridgeY,rz1]; ridgeRight=[ridgeX,ridgeY,rz1]; break;
        default: return null;
      }
    }
  } else if (roofType === 'mansard') {
    // Mansard: frame описывает НИЖНИЙ крутой скат от eave до kink-линии.
    // ridgeLeft/ridgeRight здесь — концы kink-линии, не настоящий конёк.
    const mSpec = mansardSpec || {};
    const lowerAngle  = (mSpec.lower_angle  !== undefined) ? mSpec.lower_angle  : 70;
    const lowerHeight = (mSpec.lower_height !== undefined) ? mSpec.lower_height : 2.0;
    const tanLower = Math.tan(lowerAngle * Math.PI / 180);
    if (tanLower < 0.01) return null;
    const horizontalLower = lowerHeight / tanLower;
    const kinkY = baseY + lowerHeight;
    if (longAxisX) {
      const kinkZNorth = z0 + horizontalLower;
      const kinkZSouth = z1 - horizontalLower;
      switch (slope) {
        case 'north':
          eaveLeft=[x0,baseY,z0]; eaveRight=[x1,baseY,z0];
          ridgeLeft=[x0,kinkY,kinkZNorth]; ridgeRight=[x1,kinkY,kinkZNorth]; break;
        case 'south':
          eaveLeft=[x1,baseY,z1]; eaveRight=[x0,baseY,z1];
          ridgeLeft=[x1,kinkY,kinkZSouth]; ridgeRight=[x0,kinkY,kinkZSouth]; break;
        case 'east': case 'west':
          log(`[roof-win] mansard longAxisX: slope=${slope} — это фронтон, не скат`, 'warn');
          return null;
        default: return null;
      }
    } else {
      const kinkXWest = x0 + horizontalLower;
      const kinkXEast = x1 - horizontalLower;
      switch (slope) {
        case 'east':
          eaveLeft=[x1,baseY,z0]; eaveRight=[x1,baseY,z1];
          ridgeLeft=[kinkXEast,kinkY,z0]; ridgeRight=[kinkXEast,kinkY,z1]; break;
        case 'west':
          eaveLeft=[x0,baseY,z1]; eaveRight=[x0,baseY,z0];
          ridgeLeft=[kinkXWest,kinkY,z1]; ridgeRight=[kinkXWest,kinkY,z0]; break;
        case 'north': case 'south':
          log(`[roof-win] mansard longAxisZ: slope=${slope} — это фронтон, не скат`, 'warn');
          return null;
        default: return null;
      }
    }
  } else if (roofType === 'gable' || roofType === 'gable_cross') {
    const halfShort = (longAxisX ? W : L) / 2;
    ridgeY = baseY + halfShort * tanA;
    if (longAxisX) {
      const ridgeZ = (z0 + z1) / 2;
      switch (slope) {
        case 'north':
          eaveLeft=[x0,baseY,z0]; eaveRight=[x1,baseY,z0];
          ridgeLeft=[x0,ridgeY,ridgeZ]; ridgeRight=[x1,ridgeY,ridgeZ]; break;
        case 'south':
          eaveLeft=[x1,baseY,z1]; eaveRight=[x0,baseY,z1];
          ridgeLeft=[x1,ridgeY,ridgeZ]; ridgeRight=[x0,ridgeY,ridgeZ]; break;
        case 'east': case 'west':
          log(`[roof-win] ${roofType} longAxisX: slope=${slope} — это фронтон (стена), не скат`, 'warn');
          return null;
        default: return null;
      }
    } else {
      const ridgeX = (x0 + x1) / 2;
      switch (slope) {
        case 'east':
          eaveLeft=[x1,baseY,z0]; eaveRight=[x1,baseY,z1];
          ridgeLeft=[ridgeX,ridgeY,z0]; ridgeRight=[ridgeX,ridgeY,z1]; break;
        case 'west':
          eaveLeft=[x0,baseY,z1]; eaveRight=[x0,baseY,z0];
          ridgeLeft=[ridgeX,ridgeY,z1]; ridgeRight=[ridgeX,ridgeY,z0]; break;
        case 'north': case 'south':
          log(`[roof-win] ${roofType} longAxisZ: slope=${slope} — это фронтон, не скат`, 'warn');
          return null;
        default: return null;
      }
    }
  } else {
    log(`[roof-win] неподдерживаемый roof_type=${roofType}`, 'warn');
    return null;
  }

  const eL = new THREE.Vector3(...eaveLeft);
  const eR = new THREE.Vector3(...eaveRight);
  const rL = new THREE.Vector3(...ridgeLeft);
  const rR = new THREE.Vector3(...ridgeRight);
  const axisAlong = new THREE.Vector3().subVectors(eR, eL);
  const lengthAlong = axisAlong.length();
  axisAlong.normalize();
  const eaveCenter = new THREE.Vector3().addVectors(eL, eR).multiplyScalar(0.5);
  const ridgeCenter = new THREE.Vector3().addVectors(rL, rR).multiplyScalar(0.5);
  const axisUp = new THREE.Vector3().subVectors(ridgeCenter, eaveCenter);
  const lengthUp = axisUp.length();
  axisUp.normalize();
  // Outward normal = axisUp × axisAlong (для CCW-обхода скаt с верху наружного нормал)
  const normal = new THREE.Vector3().crossVectors(axisUp, axisAlong).normalize();

  return { eL, eR, rL, rR, axisAlong, axisUp, normal, lengthAlong, lengthUp };
}

// Точка центра окна на скате по нормированным координатам:
//   positionAlong ∈ [0, 1] — вдоль конька (0 — eave_left, 1 — eave_right)
//   positionUp    ∈ [0, 1] — вверх по скату (0 — eave, 1 — ridge)
// Для трапеции: ширина по карнизу > ширины по коньку (hip). Интерполируем углы между eave и ridge.
function slopePointAt(frame, positionAlong, positionUp) {
  const t = positionUp, p = positionAlong;
  const leftAtT  = new THREE.Vector3().lerpVectors(frame.eL, frame.rL, t);
  const rightAtT = new THREE.Vector3().lerpVectors(frame.eR, frame.rR, t);
  return new THREE.Vector3().lerpVectors(leftAtT, rightAtT, p);
}

// Размещает velux на скате: GLB ориентирован в плоскости ската.
// Используется ПРАВОСТОРОННИЙ базис: xAxis = yAxis × zAxis (где yAxis=axisUp, zAxis=outward normal).
// Дополнительно добавляется ПЛОСКАЯ glass-плита параллельно скату (приподнята над скатом),
// т.к. GLB-стекло устроено как горизонтальная плита в XZ-плоскости и после поворота уходит
// перпендикулярно скату — не видно сверху.
function placeVelux(parent, modules, modulesDef, frame, posAlong, posUp, w, h) {
  const def = modulesDef && modulesDef.window_velux;
  if (!def) { log('[roof-win] нет modules.window_velux в дескрипторе', 'warn'); return; }
  const vel = cloneModule(modules, 'window_velux');
  if (!vel) return;
  const dW = asValue(def.w, 0.78), dH = asValue(def.h, 0.98);
  transformParametricModule(vel, {
    w, h, dW, dH,
    frame_profile: def.frame_profile || 0.04,
    sill_overhang: 0,
  }, 'window_velux');
  const center = slopePointAt(frame, posAlong, posUp);
  const yAxis = frame.axisUp.clone();
  const zAxis = frame.normal.clone();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  vel.quaternion.setFromRotationMatrix(basis);
  const liftFrame = 0.06; // приподнимаем раму над скатом
  const shift = new THREE.Vector3()
    .addScaledVector(xAxis, -w / 2)
    .addScaledVector(yAxis, -h / 2)
    .addScaledVector(zAxis, liftFrame);
  vel.position.copy(center).add(shift);
  setupShadows(vel);
  parent.add(vel);

  // Плоская glass-плита параллельно скату, чуть выше рамы
  const fp = def.frame_profile || 0.04;
  const glassW = Math.max(0.05, w - 2 * fp);
  const glassH = Math.max(0.05, h - 2 * fp);
  const glassGeo = new THREE.PlaneGeometry(glassW, glassH);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x4a6878, opacity: 0.38, metalness: 0.82, roughness: 0.1,
    transparent: true, side: THREE.DoubleSide,
  });
  glassMat.name = 'mat_glass';
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.copy(center).addScaledVector(zAxis, liftFrame + 0.025);
  glassMesh.quaternion.setFromRotationMatrix(basis);
  parent.add(glassMesh);

  log(`[roof-win] ✓ velux at (along=${posAlong.toFixed(2)}, up=${posUp.toFixed(2)}) ${w}×${h}`, 'dim');
}

// Размещает dormer: процедурная коробка (стены + двускатная мини-крыша) с встроенным окном.
// Используется ПРАВОСТОРОННИЙ базис (right-handed): xAxis × yAxis = zAxis, det=+1 — это даёт
// валидную ротацию. Сечение xAxis = up × normalHoriz (направлен «вправо» при взгляде наружу со ската).
function placeDormer(parent, modules, modulesDef, frame, dormerSpec, baseY, materialsMap) {
  const w = dormerSpec.w, h = dormerSpec.h, d = dormerSpec.depth;
  if (!w || !h || !d) { log('[roof-win] dormer: нужны w, h, depth', 'err'); return; }
  const posAlong = dormerSpec.position_along || 0.5;
  const posUp    = dormerSpec.position_up    || 0.3;
  const basePt = slopePointAt(frame, posAlong, posUp);

  // Скат наклонный, dormer вертикальный: front bottom висит над скатом на (d/2)*tan(angle).
  // Опускаем basePt.y на эту величину — front bottom сядет на скат, back утопится в скат.
  const slopeTan = frame.axisUp.y / Math.sqrt(frame.axisUp.x ** 2 + frame.axisUp.z ** 2);
  basePt.y -= (d / 2) * slopeTan;

  // Right-handed basis: +Z = normalHoriz (outward), +Y = world up, +X = +Y × +Z
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(frame.normal.x, 0, frame.normal.z).normalize(); // = normalHoriz
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const dormerQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

  // local (lx, ly, lz) → world (с центром в basePt)
  const localToWorld = (lx, ly, lz) => new THREE.Vector3(
    basePt.x + xAxis.x * lx + zAxis.x * lz,
    basePt.y + ly,
    basePt.z + xAxis.z * lx + zAxis.z * lz,
  );

  const wallMat = pickPorchMatName(materialsMap, 'mat_wall', ['mat_wall']);
  const roofMat = pickPorchMatName(materialsMap, 'mat_roof', ['mat_roof']);

  // 1) Стены dormer'а — box (front/sides/back walls). Не CSG, внутрь не заглядываем.
  const wallsGeo = new THREE.BoxGeometry(w, h, d);
  const wallsMat3 = new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.85, metalness: 0 });
  wallsMat3.name = wallMat;
  const walls = new THREE.Mesh(wallsGeo, wallsMat3);
  walls.position.copy(localToWorld(0, h/2, 0));
  walls.quaternion.copy(dormerQuat);
  walls.castShadow = true; walls.receiveShadow = true;
  parent.add(walls);

  // 2) Мини-двускатная крыша. Конёк перпендикулярен главному коньку (вдоль +Z = глубина dormer'а).
  // Угол ската мини-крыши = углу главной крыши (slopeTan), чтобы выглядело гармонично.
  const dormerRoofRise = (w / 2) * slopeTan;
  const dormerRoofVerts = [
    localToWorld(-w/2, h, -d/2),                  // 0: back-left top of wall
    localToWorld(+w/2, h, -d/2),                  // 1: back-right top of wall
    localToWorld(+w/2, h, +d/2),                  // 2: front-right top of wall
    localToWorld(-w/2, h, +d/2),                  // 3: front-left top of wall
    localToWorld(0,    h + dormerRoofRise, -d/2), // 4: ridge-back
    localToWorld(0,    h + dormerRoofRise, +d/2), // 5: ridge-front
  ];
  const slopeIndices = [
    0, 5, 4,  0, 3, 5, // левый скат (x = -w/2 → ridge)
    1, 4, 5,  1, 5, 2, // правый скат (x = +w/2 → ridge)
  ];
  const gableIndices = [
    3, 2, 5, // передний фронтон (+Z = +d/2 = front)
    0, 4, 1, // задний фронтон (-Z)
  ];
  function buildSubMesh(vertsAll, indices, matName, color) {
    const positions = [];
    for (const v of vertsAll) positions.push(v.x, v.y, v.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: true,
    });
    mat.name = matName;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }
  buildSubMesh(dormerRoofVerts, slopeIndices, roofMat, 0x8b3a3a);
  buildSubMesh(dormerRoofVerts, gableIndices, wallMat, 0xf5e6c8);

  // 3) Встроенное окно во фронтальном фронтоне (на front face: lz = +d/2).
  // Раму ВЫДВИГАЕМ ВПЕРЁД (5 см) — фронт-фасад dormer'а сплошной, рама должна быть снаружи.
  // Дополнительно строим custom glass-плиту в плоскости фронта (GLB-стекло горизонтальное и
  // после поворота уходит вглубь стены — не видно).
  const winSpec = dormerSpec.window || { type: 'single', w: w * 0.6, h: h * 0.7 };
  const winType = winSpec.type || 'single';
  const winW = winSpec.w || w * 0.6;
  const winH = winSpec.h || h * 0.7;
  const winModel = 'window_' + winType;
  const winDef = modulesDef && modulesDef['window_' + winType];
  const frameOffset = 0.10; // рама полностью ПЕРЕД стеной dormer'а (frame depth = 0.10)
  if (winDef && modules[winModel]) {
    const win = cloneModule(modules, winModel);
    if (win) {
      const dW = asValue(winDef.w, winW), dH = asValue(winDef.h, winH);
      transformParametricModule(win, {
        w: winW, h: winH, dW, dH,
        frame_profile: winDef.frame_profile || 0.05,
        sill_overhang: winDef.sill_overhang || 0.03,
      }, winModel);
      // Скрываем GLB-glass (он горизонтальная плита, конфликтует с custom-стеклом)
      // и sill (подоконник) — для dormer-окна не нужен.
      win.traverse(c => {
        if (!c.isMesh) return;
        const n = canonName(c.name);
        if (n === 'glass' || n === 'sill') c.visible = false;
      });
      const winCorner = localToWorld(-winW / 2, h / 2 - winH / 2, d / 2 + frameOffset);
      win.position.copy(winCorner);
      win.quaternion.copy(dormerQuat);
      setupShadows(win);
      parent.add(win);
    }
  } else if (winDef) {
    log(`[roof-win] dormer: GLB модуль ${winModel} не загружен`, 'warn');
  }

  // Custom glass-плита в плоскости фронтального фасада dormer'а, ПЕРЕД стеной
  if (winDef) {
    const fp = winDef.frame_profile || 0.05;
    const glassW = Math.max(0.05, winW - 2 * fp);
    const glassH = Math.max(0.05, winH - 2 * fp);
    const glassGeo = new THREE.PlaneGeometry(glassW, glassH);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x4a6878, opacity: 0.38, metalness: 0.82, roughness: 0.1,
      transparent: true, side: THREE.DoubleSide,
    });
    glassMat.name = 'mat_glass';
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    // Чётко перед стеной (5 см), внутри рамы по глубине
    glassMesh.position.copy(localToWorld(0, h / 2, d / 2 + 0.05));
    glassMesh.quaternion.copy(dormerQuat);
    parent.add(glassMesh);
  }
  log(`[roof-win] ✓ dormer at (along=${posAlong.toFixed(2)}, up=${posUp.toFixed(2)}) ${w}×${h}×${d}`, 'dim');
}

// Главный билдер roof_windows
function buildRoofWindows(parent, modules, desc, outline, baseY, angleDeg, eave) {
  if (!desc.roof_windows || !desc.roof_windows.length) return;
  const roofType = desc.roof_type || 'hip';
  if (roofType === 'flat') {
    log('[roof-win] flat roof не поддерживает velux/dormer', 'warn');
    return;
  }
  // Декомпозиция полигона на прямоугольники (для hip/gable/gable_cross). Sort by area desc.
  const rects = decomposeOrthoPolygonIntoRectangles(outline);
  if (!rects.length) { log('[roof-win] decomposition failed', 'warn'); return; }
  rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));

  for (const spec of desc.roof_windows) {
    const rectIdx = (spec.rect_index !== undefined) ? spec.rect_index : 0;
    if (rectIdx < 0 || rectIdx >= rects.length) {
      log(`[roof-win] rect_index=${rectIdx} вне диапазона (0..${rects.length - 1})`, 'warn');
      continue;
    }
    const rect = rects[rectIdx];
    const rectBbox = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
    const longAxisX = (rectBbox.maxX - rectBbox.minX) >= (rectBbox.maxZ - rectBbox.minZ);
    const frame = getSlopeFrame(spec.slope, rectBbox, longAxisX, angleDeg, baseY, eave, roofType, desc.mansard);
    if (!frame) continue;

    const count = spec.count || 1;
    const spacing = spec.spacing || 1.5;
    const baseAlong = spec.position_along !== undefined ? spec.position_along : 0.5;
    const posUp     = spec.position_up    !== undefined ? spec.position_up    : 0.5;

    for (let i = 0; i < count; i++) {
      // Распределяем count окон вокруг baseAlong с шагом spacing (в м, конвертируем в normalized)
      const offsetM = (i - (count - 1) / 2) * spacing;
      const offsetNormalized = offsetM / frame.lengthAlong;
      const posAlong = baseAlong + offsetNormalized;
      if (posAlong < 0.05 || posAlong > 0.95) {
        log(`[roof-win] окно ${i} вне диапазона (along=${posAlong.toFixed(2)})`, 'warn');
        continue;
      }
      if (spec.module === 'window_velux') {
        placeVelux(parent, modules, desc.modules, frame, posAlong, posUp, spec.w, spec.h);
      } else if (spec.module === 'dormer') {
        placeDormer(parent, modules, desc.modules, frame,
          { ...spec, position_along: posAlong, position_up: posUp }, baseY, desc.materials_map);
      } else {
        log(`[roof-win] неизвестный module=${spec.module}`, 'warn');
      }
    }
  }
}

// ══════════════════════════════════════════════
// MAIN BUILDER — обновлён: принимает houseGroup как параметр
// params: {
//   area:       общая площадь (м²), используется как fallback для floorAreas[]
//   floorH:     общая высота этажа (см), fallback для floorHs[]
//   baseH:      высота фундамента (см)
//   floorAreas: [a0, a1, ...] — массив площадей по этажам, м² (опционально, override per-floor)
//   floorHs:    [h0, h1, ...] — массив высот этажей по этажам, см (опционально)
// }
// options: { outlineGroup, showOutline, controls, materialOverrides }
// ══════════════════════════════════════════════
function buildHouseFromDescriptor(houseGroup, desc, modules, params, options = {}) {
  log(`[builder] ── ${desc.name} ── area=${params.area}, floor_h=${params.floorH}cm, base_h=${params.baseH}cm`);

  // Очистка предыдущей сборки
  while (houseGroup.children.length) houseGroup.remove(houseGroup.children[0]);
  if (options.outlineGroup) {
    while (options.outlineGroup.children.length) options.outlineGroup.remove(options.outlineGroup.children[0]);
  }

  const wt = desc.constraints.wall_thickness || 0.2;
  const ps = desc.constraints.pillar_size || wt;
  const baseH = params.baseH / 100;

  let yOffset = baseH;
  let lastOutline = null;
  let firstOutline = null;
  let totalWallH = 0;
  let prevOutline = null;

  // Pre-clone cornice GLB чтобы вытащить цвет для inter-floor slab
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
    // Высота этажа: per-floor override → общий → дефолт
    const floorHCm = (params.floorHs && params.floorHs[fi] !== undefined)
                     ? params.floorHs[fi]
                     : params.floorH;
    const wallH = floorHCm / 100;
    totalWallH += wallH;

    // Площадь этажа: per-floor override → общий area × area_factor
    const areaFactor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
    const floorArea = (params.floorAreas && params.floorAreas[fi] !== undefined)
                      ? params.floorAreas[fi]
                      : params.area * areaFactor;
    const vars = evalVars(floor.vars, { area: floorArea });
    log(`[builder] floor ${fi} (h=${floorHCm}cm, area=${floorArea.toFixed(1)}m²): ${Object.entries(vars).map(([k,v])=>`${k}=${v.toFixed(2)}`).join(', ')}`, 'dim');

    const offsetSpec = floor.start_offset || { x: 0, z: 0 };
    const startX = evalExpr(offsetSpec.x !== undefined ? offsetSpec.x : 0, vars);
    const startZ = evalExpr(offsetSpec.z !== undefined ? offsetSpec.z : 0, vars);

    const outline = computeOutline(floor.perimeter, vars, ps, startX, startZ);

    if (fi === 0) {
      buildBaseFromOutline(houseGroup, modules, outline, baseH, wt, ps, FOUNDATION_OVERHANG);
    } else {
      const ifc = desc.features && desc.features.inter_floor_cornice;
      if (ifc) {
        const depth = (typeof ifc === 'object' && ifc.depth !== undefined) ? ifc.depth : 0.05;
        buildInterFloorSlab(houseGroup, prevOutline, yOffset, depth, sharedCorniceColor);
      }
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
    if (fi === 0) firstOutline = outline;
  }

  if (lastOutline) {
    const angleDef = desc.constraints.roof_angle;
    const angleDeg = (angleDef && angleDef.default !== undefined) ? angleDef.default : 22;
    const roofType = desc.roof_type || 'hip';
    // Для мансарды: roof+windows расположены выше на knee_height (knee wall между потолком и скатом)
    const mansardKnee = (roofType === 'mansard' && desc.mansard && desc.mansard.knee_height) || 0;
    const roofBaseY = yOffset + mansardKnee;
    buildRoof(houseGroup, yOffset, lastOutline.bbox, lastOutline, roofType, angleDeg, ROOF_EAVE, {
      mansardSpec: desc.mansard, modules, wt, ps,
    });
    // Декор (cornice) идёт по верху стен НЕПОСРЕДСТВЕННО под крышей. Для мансарды это
    // верх knee wall (= roofBaseY), для остальных roof_type — yOffset.
    buildDecorFromFeatures(houseGroup, modules, desc, lastOutline, baseH, roofBaseY, angleDeg, ROOF_EAVE, sharedCorniceMat);
    // Мансардные / слуховые окна на скатах — используют roofBaseY (с учётом knee)
    buildRoofWindows(houseGroup, modules, desc, lastOutline, roofBaseY, angleDeg, ROOF_EAVE);
  }

  // PAD ПОД ДОМОМ — строится по реальному bbox outline (а не по houseL/houseW в viewer3d-core,
  // которые могут не совпадать с формулами из дескриптора).
  if (firstOutline && firstOutline.bbox) {
    const padOffset = 0.30, padThick = 0.05;
    const bb = firstOutline.bbox;
    const padW = (bb.maxX - bb.minX) + 2 * padOffset;
    const padD = (bb.maxZ - bb.minZ) + 2 * padOffset;
    const padCx = (bb.minX + bb.maxX) / 2;
    const padCz = (bb.minZ + bb.maxZ) / 2;
    const padGeo = new THREE.BoxGeometry(padW, padThick, padD);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.0 });
    padMat.name = 'mat_house_pad';
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(padCx, padThick / 2, padCz);
    padMesh.receiveShadow = true;
    houseGroup.add(padMesh);
  }

  // Крыльцо привязывается к двери 1-го этажа
  if (firstOutline && desc.features && desc.features.porch) {
    buildPorch(houseGroup, desc, firstOutline, desc.modules, desc.materials_map, baseH);
  }

  // Контур-overlay (если показан)
  if (options.showOutline && options.outlineGroup && lastOutline) {
    drawOutlineOverlay(options.outlineGroup, lastOutline, baseH);
  }

  // Применяем сохранённые material overrides
  if (options.materialOverrides) {
    for (const [slot, color] of Object.entries(options.materialOverrides)) {
      applyMaterialOverride(houseGroup, slot, color);
    }
  }

  // Камера: фрейм по bbox (если controls передан)
  if (options.controls && lastOutline && lastOutline.bbox.maxX > lastOutline.bbox.minX) {
    const bb = lastOutline.bbox;
    const cx = (bb.minX + bb.maxX) / 2;
    const cz = (bb.minZ + bb.maxZ) / 2;
    options.controls.target.set(cx, baseH + totalWallH / 2, cz);
  }

  log(`[builder] ✓ done · ${houseGroup.children.length} объектов в сцене`, 'ok');
  return { lastOutline, totalWallH, baseH };
}

// ══════════════════════════════════════════════
// OUTLINE OVERLAY (для отладки)
// ══════════════════════════════════════════════
function drawOutlineOverlay(outlineGroup, outline, y) {
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
function applyMaterialOverride(parent, slot, color) {
  let count = 0;
  parent.traverse(child => {
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

// ══════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════
global.HouseBuilder = {
  setLogger,
  loadHouseType,
  buildHouseFromDescriptor,
  applyMaterialOverride,
  drawOutlineOverlay,
  decomposeOrthoPolygonIntoRectangles,
  // Constants (можно использовать снаружи)
  FOUNDATION_OVERHANG,
  ROOF_EAVE,
};

})(typeof window !== 'undefined' ? window : globalThis);
