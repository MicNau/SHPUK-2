// ══════════════════════════════════════════════
// VIEWER3D-DESKTOP.JS
// Антураж для десктопа:
//   • Cross-billboard кусты (2 плоскости, assets/bush_a.png, bush_b.png)
//   • Cross-billboard деревья (3 плоскости, assets/tree_a.png, tree_b.png)
// Зависимости: viewer3d-core.js
// ══════════════════════════════════════════════

const IS_MOBILE = false;

// Хук анимационного цикла
function _onAnimFrame(t) { /* no-op */ }

// Точка входа — вызывается из init3dCanvas
function _buildEntourage(scene) {
  _buildVegetation(scene);
}

// ══════════════════════════════════════════════
// CROSS-BILLBOARD РАСТИТЕЛЬНОСТЬ
// ══════════════════════════════════════════════

function _makeCrossMat(tex) {
  return new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.15,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    color: new THREE.Color(0.75, 0.75, 0.75),
  });
}

function _buildVegetation(scene) {
  const loader = new THREE.TextureLoader();
  let texBushA = null, texBushB = null, texTreeA = null, texTreeB = null;
  let loaded = 0;

  const onLoaded = () => {
    if (++loaded < 4) return;
    _placeBushes(scene, texBushA, texBushB);
    _placeTrees(scene, texTreeA, texTreeB);
  };

  const loadOrFallback = (filename, fallbackFn, onReady) => {
    loader.load(ASSETS + filename,
      (tex) => { onReady(tex); onLoaded(); },
      undefined,
      () => { onReady(fallbackFn()); onLoaded(); },
    );
  };

  loadOrFallback('bush_a.png', () => _fallbackBush(0.28, 0.50), (t) => { texBushA = t; });
  loadOrFallback('bush_b.png', () => _fallbackBush(0.32, 0.44), (t) => { texBushB = t; });
  loadOrFallback('tree_a.png', () => _fallbackTree(0.26, 0.52), (t) => { texTreeA = t; });
  loadOrFallback('tree_b.png', () => _fallbackTree(0.22, 0.58), (t) => { texTreeB = t; });
}

function _placeBushes(scene, texA, texB) {
  const spots = [
    [-4,0,-3],[16,0,-3],[20,0,8],[-4,0,8],
    [6,0,-4.5],[12,0,-4.5],[2,0,14],[14,0,14],
    [22,0,5],[-6,0,11],[25,0,10],[-3,0,3],
  ];
  const matA = _makeCrossMat(texA), matB = _makeCrossMat(texB);

  for (const [x,,z] of spots) {
    const mat = Math.random() > 0.5 ? matA : matB;
    const s = 1.2 + Math.random() * 0.9;
    const w = s * 1.1, h = s * 1.3;
    const geo = new THREE.PlaneGeometry(w, h);
    const grp = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = (Math.PI / 2) * i;
      m.position.y = h * 0.45;
      grp.add(m);
    }
    grp.position.set(x, 0, z);
    grp.rotation.y = Math.random() * Math.PI;
    scene.add(grp);
  }
}

function _placeTrees(scene, texA, texB) {
  const spots = [
    [-8,0,-6],[-10,0,4],[-8,0,14],
    [28,0,-4],[30,0,8],[28,0,18],
    [10,0,-8],[16,0,-8],[8,0,20],[18,0,20],
  ];
  const matA = _makeCrossMat(texA), matB = _makeCrossMat(texB);

  for (const [x,,z] of spots) {
    const mat = Math.random() > 0.5 ? matA : matB;
    const s = 2.8 + Math.random() * 2.0;
    const w = s * 0.85, h = s;
    const geo = new THREE.PlaneGeometry(w, h);
    const grp = new THREE.Group();
    // Desktop: 3 плоскости для объёма
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = (Math.PI / 3) * i;
      m.position.y = h * 0.45;
      grp.add(m);
    }
    grp.position.set(x, 0, z);
    grp.rotation.y = Math.random() * Math.PI;
    scene.add(grp);
  }
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
  // Ствол
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
  // Крона — несколько слоёв эллипсов
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
  // Световые блики
  for (let i = 0; i < 10; i++) {
    const hx = sz * 0.25 + Math.random() * sz * 0.5;
    const hy = sz * 0.15 + Math.random() * sz * 0.5;
    const hr = 3 + Math.random() * 12;
    ctx.fillStyle = `hsla(${90 + Math.random() * 30 | 0},${satBase * 100 + 10 | 0}%,${lightBase * 100 + 20 | 0}%,0.25)`;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
