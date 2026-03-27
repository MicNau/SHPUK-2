// ══════════════════════════════════════════════
// VIEWER3D-DESKTOP.JS
// Антураж для десктопа:
//   • 3D-модели кустов/деревьев (GLB) с fallback на cross-billboard спрайты
//   • Цепочка: GLB → PNG cross-billboard → процедурный canvas
//   • Деревья: 3 плоскости (больше объёма) при спрайтовом fallback
// Зависимости: viewer3d-core.js, GLTFLoader (CDN)
// ══════════════════════════════════════════════

const IS_MOBILE = false;

function _onAnimFrame(t) { /* no-op */ }

function _buildEntourage(scene) {
  _buildVegetation(scene);
}

// ══════════════════════════════════════════════
// РАСТИТЕЛЬНОСТЬ: GLB → PNG → PROCEDURAL
// ══════════════════════════════════════════════

const _VEG_BUSH_SPOTS = [
  [-4,0,-3],[16,0,-3],[20,0,8],[-4,0,8],
  [6,0,-4.5],[12,0,-4.5],[2,0,14],[14,0,14],
  [22,0,5],[-6,0,11],[25,0,10],[-3,0,3],
];

const _VEG_TREE_SPOTS = [
  [-8,0,-6],[-10,0,4],[-8,0,14],
  [28,0,-4],[30,0,8],[28,0,18],
  [10,0,-8],[16,0,-8],[8,0,20],[18,0,20],
];

const _CROSS_PLANES_BUSH = 2;
const _CROSS_PLANES_TREE = 3; // Desktop: больше плоскостей для объёма

function _buildVegetation(scene) {
  const gltf = new THREE.GLTFLoader();
  const tex  = new THREE.TextureLoader();

  _loadVegModels(gltf, tex, scene, {
    glbFiles:  ['bush_a.glb', 'bush_b.glb'],
    pngFiles:  ['bush_a.png', 'bush_b.png'],
    fallbacks: [() => _fallbackBush(0.28, 0.50), () => _fallbackBush(0.32, 0.44)],
    spots:     _VEG_BUSH_SPOTS,
    type:      'bush',
  });

  _loadVegModels(gltf, tex, scene, {
    glbFiles:  ['tree_a.glb', 'tree_b.glb'],
    pngFiles:  ['tree_a.png', 'tree_b.png'],
    fallbacks: [() => _fallbackTree(0.26, 0.52), () => _fallbackTree(0.22, 0.58)],
    spots:     _VEG_TREE_SPOTS,
    type:      'tree',
  });
}

// ── Универсальный загрузчик с fallback-цепочкой ──

function _loadVegModels(gltfLoader, texLoader, scene, cfg) {
  const models = [null, null];
  let ready = 0;

  const onBothReady = () => {
    if (++ready < 2) return;
    _placeVeg(scene, models, cfg);
  };

  cfg.glbFiles.forEach((glb, i) => {
    gltfLoader.load(ASSETS + glb,
      (gltf) => {
        models[i] = { mode: 'glb', data: gltf.scene };
        onBothReady();
      },
      undefined,
      () => {
        texLoader.load(ASSETS + cfg.pngFiles[i],
          (t) => {
            models[i] = { mode: 'png', data: t };
            onBothReady();
          },
          undefined,
          () => {
            models[i] = { mode: 'png', data: cfg.fallbacks[i]() };
            onBothReady();
          },
        );
      },
    );
  });
}

// ── Размещение по точкам ──

function _placeVeg(scene, models, cfg) {
  const isBush = cfg.type === 'bush';
  const crossPlanes = isBush ? _CROSS_PLANES_BUSH : _CROSS_PLANES_TREE;
  const margin = isBush ? 0.8 : 1.5;

  for (const [x,,z] of cfg.spots) {
    // Пропускаем точки, пересекающиеся с конструкциями
    if (_isOccupied(x, z, margin)) continue;

    const mdl = models[Math.random() > 0.5 ? 0 : 1];
    const s = isBush
      ? 1.2 + Math.random() * 0.9
      : 2.8 + Math.random() * 2.0;

    if (mdl.mode === 'glb') {
      _placeGlb(scene, mdl.data, x, z, s, isBush);
    } else {
      _placeCross(scene, mdl.data, x, z, s, isBush, crossPlanes);
    }
  }
}

// ── Проверка пересечения с занятыми зонами ──
function _isOccupied(x, z, margin) {
  if (!threeState || !threeState.occupiedZones) return false;
  for (const zone of threeState.occupiedZones) {
    if (zone.type === 'rect') {
      if (x >= zone.minX - margin && x <= zone.maxX + margin &&
          z >= zone.minZ - margin && z <= zone.maxZ + margin) return true;
    } else if (zone.type === 'poly') {
      const xs = zone.points.map(p=>p.x), zs = zone.points.map(p=>p.z);
      if (x >= Math.min(...xs)-margin && x <= Math.max(...xs)+margin &&
          z >= Math.min(...zs)-margin && z <= Math.max(...zs)+margin) return true;
    } else if (zone.type === 'path') {
      for (let i=0;i<zone.points.length-1;i++) {
        if (_distToSeg(x,z,zone.points[i],zone.points[i+1]) < zone.width/2 + margin) return true;
      }
    }
  }
  return false;
}

function _distToSeg(px,pz,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,lenSq=dx*dx+dz*dz;
  if(lenSq<.001) return Math.sqrt((px-a.x)**2+(pz-a.z)**2);
  const t=Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/lenSq));
  return Math.sqrt((px-a.x-t*dx)**2+(pz-a.z-t*dz)**2);
}

function _placeGlb(scene, srcModel, x, z, scale, isBush) {
  const clone = srcModel.clone();

  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const targetH = isBush ? scale * 1.3 : scale;
  const k = targetH / maxDim;
  clone.scale.set(k, k, k);

  const box2 = new THREE.Box3().setFromObject(clone);
  clone.position.set(x - (box2.min.x + box2.max.x) / 2, -box2.min.y, z - (box2.min.z + box2.max.z) / 2);
  clone.rotation.y = Math.random() * Math.PI * 2;

  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  scene.add(clone);
}

function _placeCross(scene, tex, x, z, s, isBush, planes) {
  const mat = _makeCrossMat(tex);
  const w = isBush ? s * 1.1 : s * 0.85;
  const h = isBush ? s * 1.3 : s;
  const geo = new THREE.PlaneGeometry(w, h);
  const grp = new THREE.Group();

  for (let i = 0; i < planes; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (Math.PI / planes) * i;
    m.position.y = h * 0.45;
    grp.add(m);
  }

  grp.position.set(x, 0, z);
  grp.rotation.y = Math.random() * Math.PI;
  scene.add(grp);
}

function _makeCrossMat(tex) {
  return new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.15,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    color: new THREE.Color(0.75, 0.75, 0.75),
  });
}

// ── Процедурные fallback-текстуры ─────────────

function _fallbackBush(lightBase, satBase) {
  const sz = 256, c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  const clusters = [
    [sz*.50, sz*.50, sz*.38], [sz*.30, sz*.58, sz*.28],
    [sz*.70, sz*.55, sz*.28], [sz*.50, sz*.35, sz*.24],
    [sz*.40, sz*.65, sz*.20], [sz*.60, sz*.62, sz*.20],
  ];
  for (const [cx, cy, r] of clusters) {
    const hue = 90 + Math.random() * 30 | 0;
    const sat = satBase * 100 | 0;
    const lt  = lightBase * 100 | 0;
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    g.addColorStop(0, `hsla(${hue},${sat}%,${lt + 14}%,0.92)`);
    g.addColorStop(0.5, `hsla(${hue},${sat}%,${lt + 4}%,0.85)`);
    g.addColorStop(0.8, `hsla(${hue},${sat}%,${lt - 4}%,0.4)`);
    g.addColorStop(1, 'hsla(100,38%,8%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 12; i++) {
    const hx = sz * 0.2 + Math.random() * sz * 0.6;
    const hy = sz * 0.2 + Math.random() * sz * 0.6;
    const hr = 3 + Math.random() * 10;
    ctx.fillStyle = `hsla(${90 + Math.random() * 25 | 0},${satBase * 100 + 8 | 0}%,${lightBase * 100 + 18 | 0}%,0.25)`;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#3d2a10cc';
  ctx.fillRect(sz * 0.46, sz * 0.76, sz * 0.08, sz * 0.22);
  return new THREE.CanvasTexture(c);
}

function _fallbackTree(lightBase, satBase) {
  const sz = 256, c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(sz * 0.46, sz * 0.95);
  ctx.lineTo(sz * 0.54, sz * 0.95);
  ctx.lineTo(sz * 0.52, sz * 0.35);
  ctx.lineTo(sz * 0.48, sz * 0.35);
  ctx.closePath();
  const stg = ctx.createLinearGradient(sz * 0.47, sz * 0.4, sz * 0.53, sz);
  stg.addColorStop(0, '#4a3010dd');
  stg.addColorStop(0.5, '#3a2008cc');
  stg.addColorStop(1, '#2a1a08aa');
  ctx.fillStyle = stg;
  ctx.fill();
  const layers = [
    [sz * 0.50, sz * 0.48, sz * 0.36, sz * 0.32],
    [sz * 0.38, sz * 0.54, sz * 0.24, sz * 0.22],
    [sz * 0.62, sz * 0.50, sz * 0.26, sz * 0.24],
    [sz * 0.50, sz * 0.30, sz * 0.24, sz * 0.22],
    [sz * 0.44, sz * 0.40, sz * 0.18, sz * 0.18],
    [sz * 0.56, sz * 0.36, sz * 0.16, sz * 0.18],
  ];
  for (const [cx, cy, rx, ry] of layers) {
    const hue = 95 + Math.random() * 30 | 0;
    const sat = satBase * 100 | 0;
    const lt  = lightBase * 100 | 0;
    const g = ctx.createRadialGradient(cx, cy * 0.92, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, `hsla(${hue},${sat}%,${lt + 12}%,0.90)`);
    g.addColorStop(0.4, `hsla(${hue},${sat}%,${lt + 4}%,0.82)`);
    g.addColorStop(0.75, `hsla(${hue},${sat}%,${lt - 4}%,0.45)`);
    g.addColorStop(1, 'hsla(100,30%,8%,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    const hx = sz * 0.25 + Math.random() * sz * 0.5;
    const hy = sz * 0.15 + Math.random() * sz * 0.5;
    const hr = 3 + Math.random() * 12;
    ctx.fillStyle = `hsla(${90 + Math.random() * 30 | 0},${satBase * 100 + 10 | 0}%,${lightBase * 100 + 20 | 0}%,0.25)`;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
