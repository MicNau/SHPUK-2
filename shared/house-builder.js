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
    flat:        ['roof_flat_edge'],
  };
  (roofMods[desc.roof_type] || []).forEach(m => ids.add(m));
  if (desc.features) {
    if (desc.features.chimney)  ids.add('chimney');
    if (desc.features.gutters)  ids.add('gutter');
    if (desc.features.cornice)  ids.add('cornice');
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
  return ids;
}

async function loadHouseType(typeId) {
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
      if (sharedCorniceMat) {
        c.traverse(child => { if (child.isMesh) child.material = sharedCorniceMat; });
      } else {
        c.traverse(child => { if (child.isMesh && child.material) child.material.name = 'mat_cornice'; });
      }
      setupShadows(c);
      parent.add(c);
      counts.cornice++;
    }
    // TODO: convex-углы cornice — нужен mod_cornice_corner.glb с трапециевидным сечением.
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

  log(`[decor] gutter=${counts.gutter}, cornice=${counts.cornice}, downpipe=${counts.downpipe}, chimney=${counts.chimney}`, 'dim');
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
    const sign = item.turn < 0 ? +1 : -1;
    newPillarPos[i] = { x: item.x + sign * bx * eave, z: item.z + sign * bz * eave };
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
    color: 0x8b3a3a, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
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

  if (roofType === 'hip') {
    const rects = decomposeOrthoPolygonIntoRectangles(outline);
    if (rects.length === 0) {
      log('[roof] decomposition failed, fallback на bbox-hip', 'warn');
      return buildHipRoof(parent, baseY, bbox, angleDeg, eave);
    }
    log(`[roof] hip: декомпозиция на ${rects.length} прямоугольник(ов)`, 'dim');
    rects.sort((a, b) => ((b.maxX - b.minX) * (b.maxZ - b.minZ)) - ((a.maxX - a.minX) * (a.maxZ - a.minZ)));
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const rectBbox = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      buildHipRoof(parent, baseY + i * 0.001, rectBbox, angleDeg, eave);
    }
    return;
  }
  if (roofType === 'gable' || roofType === 'gable_cross') {
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
  return buildHipRoof(parent, baseY, bbox, angleDeg, eave);
}

// ══════════════════════════════════════════════
// MAIN BUILDER — обновлён: принимает houseGroup как параметр
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
    const wallH = params.floorH / 100;
    totalWallH += wallH;

    const areaFactor = (floor.area_factor !== undefined) ? floor.area_factor : 1.0;
    const floorArea = params.area * areaFactor;
    const vars = evalVars(floor.vars, { area: floorArea });
    log(`[builder] floor ${fi} (area_factor=${areaFactor}, area=${floorArea.toFixed(1)}): ${Object.entries(vars).map(([k,v])=>`${k}=${v.toFixed(2)}`).join(', ')}`, 'dim');

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
  }

  if (lastOutline) {
    const angleDef = desc.constraints.roof_angle;
    const angleDeg = (angleDef && angleDef.default !== undefined) ? angleDef.default : 22;
    buildRoof(houseGroup, yOffset, lastOutline.bbox, lastOutline, desc.roof_type || 'hip', angleDeg, ROOF_EAVE);
    buildDecorFromFeatures(houseGroup, modules, desc, lastOutline, baseH, yOffset, angleDeg, ROOF_EAVE, sharedCorniceMat);
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
