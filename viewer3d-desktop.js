// ══════════════════════════════════════════════
// VIEWER3D-DESKTOP.JS
// Антураж для десктопа:
//   • Billboard-спрайты кустов (assets/bush_a.png, bush_b.png)
//   • Billboard-спрайты деревьев (assets/tree_a.png, tree_b.png)
// Зависимости: viewer3d-core.js
// ══════════════════════════════════════════════

const IS_MOBILE = false;

// Хук анимационного цикла (трава выключена — нет анимации)
function _onAnimFrame(t) { /* no-op */ }

// Точка входа — вызывается из init3dCanvas
function _buildEntourage(scene) {
  // _buildGrass — выключено по запросу
  _buildVegetationSprites(scene);
}

// ══════════════════════════════════════════════
// BILLBOARD СПРАЙТЫ (кусты + деревья)
// ══════════════════════════════════════════════
function _buildVegetationSprites(scene) {
  const loader = new THREE.TextureLoader();

  // ── Загружаем все 4 текстуры, создаём спрайты после загрузки ──
  let texBushA = null, texBushB = null, texTreeA = null, texTreeB = null;
  let loaded   = 0;

  const onLoaded = () => {
    loaded++;
    if (loaded < 4) return; // ждём все 4

    // Кусты
    const bushSpots = [
      [-4,0,-3],[16,0,-3],[20,0,8],[-4,0,8],
      [6,0,-4.5],[12,0,-4.5],[2,0,14],[14,0,14],
      [22,0,5],[-6,0,11],[25,0,10],[-3,0,3],
    ];
    for (const [x,,z] of bushSpots) {
      const tex    = Math.random() > .5 ? texBushA : texBushB;
      const mat    = new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true, alphaTest: 0.12, depthWrite: false, toneMapped: false, color: new THREE.Color(0.72, 0.72, 0.72) });
      const sprite = new THREE.Sprite(mat);
      const s      = 1.2 + Math.random() * 0.9;
      sprite.scale.set(s * 1.1, s * 1.3, 1);
      sprite.position.set(x, s * 0.62, z);
      scene.add(sprite);
    }

    // Деревья
    const treeSpots = [
      [-8,0,-6],[-10,0,4],[-8,0,14],
      [28,0,-4],[30,0,8],[28,0,18],
      [10,0,-8],[16,0,-8],[8,0,20],[18,0,20],
    ];
    for (const [x,,z] of treeSpots) {
      const tex    = Math.random() > .5 ? texTreeA : texTreeB;
      const mat    = new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true, alphaTest: 0.12, depthWrite: false, toneMapped: false, color: new THREE.Color(0.72, 0.72, 0.72) });
      const sprite = new THREE.Sprite(mat);
      const s      = 2.8 + Math.random() * 2.0;
      sprite.scale.set(s * 0.85, s, 1);
      sprite.position.set(x, s * 0.5, z);
      scene.add(sprite);
    }
  };

  // Загружаем с fallback: если файла нет — создаём процедурную текстуру
  const loadOrFallback = (filename, fallbackFn, onReady) => {
    loader.load(
      ASSETS + filename,
      (tex) => { onReady(tex); onLoaded(); },
      undefined,
      () => { onReady(fallbackFn()); onLoaded(); },
    );
  };

  loadOrFallback('bush_a.png', () => _makeFallbackBushTex(0.28, 0.50), (t) => { texBushA = t; });
  loadOrFallback('bush_b.png', () => _makeFallbackBushTex(0.32, 0.44), (t) => { texBushB = t; });
  loadOrFallback('tree_a.png', () => _makeFallbackTreeTex(0.26, 0.52), (t) => { texTreeA = t; });
  loadOrFallback('tree_b.png', () => _makeFallbackTreeTex(0.22, 0.58), (t) => { texTreeB = t; });
}

// ── Процедурные fallback-текстуры ─────────────

function _makeFallbackBushTex(lightBase, satBase) {
  const sz = 128, c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  const clusters = [
    [sz*.50, sz*.52, sz*.34], [sz*.33, sz*.60, sz*.27],
    [sz*.67, sz*.58, sz*.27], [sz*.50, sz*.38, sz*.24], [sz*.42, sz*.68, sz*.18],
  ];
  for (const [cx,cy,r] of clusters) {
    const hue = 95 + Math.random()*28|0, sat = satBase*100|0, lt = lightBase*100|0;
    const g = ctx.createRadialGradient(cx,cy,0, cx,cy,r);
    g.addColorStop(0,   `hsla(${hue},${sat}%,${lt+14}%,0.95)`);
    g.addColorStop(0.6, `hsla(${hue},${sat}%,${lt}%,0.85)`);
    g.addColorStop(1,   'hsla(100,38%,8%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  }
  ctx.fillStyle = '#3d2a10cc';
  ctx.fillRect(sz*.46, sz*.74, sz*.08, sz*.24);
  return new THREE.CanvasTexture(c);
}

function _makeFallbackTreeTex(lightBase, satBase) {
  const sz = 128, c = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');
  // Ствол
  const stg = ctx.createLinearGradient(sz*.47, sz*.68, sz*.53, sz*.98);
  stg.addColorStop(0, '#4a3010cc'); stg.addColorStop(1, '#2a1a08aa');
  ctx.fillStyle = stg;
  ctx.fillRect(sz*.47, sz*.68, sz*.06, sz*.30);
  // Крона — два конуса
  for (const [cy, w, h, lt] of [[sz*.55, sz*.62, sz*.52, lightBase],[sz*.35, sz*.46, sz*.42, lightBase+.06]]) {
    const hue = 100+Math.random()*20|0, sat = satBase*100|0;
    const g = ctx.createRadialGradient(sz*.5, cy*.9, 0, sz*.5, cy, w*.5);
    g.addColorStop(0,   `hsla(${hue},${sat}%,${lt*100+10}%,0.92)`);
    g.addColorStop(0.7, `hsla(${hue},${sat}%,${lt*100}%,0.80)`);
    g.addColorStop(1,   'hsla(110,40%,5%,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sz*.5, cy-h*.5);
    ctx.lineTo(sz*.5+w*.5, cy+h*.5);
    ctx.lineTo(sz*.5-w*.5, cy+h*.5);
    ctx.closePath(); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
