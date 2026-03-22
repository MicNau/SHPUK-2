// ══════════════════════════════════════════════
// VIEWER3D-MOBILE.JS
// Антураж для мобильных устройств:
//   • Billboard-спрайты кустов (2 draw calls)
//   • Billboard-спрайты деревьев (2 draw calls)
//   • Нет InstancedMesh травы — экономим GPU
// Зависимости: viewer3d-core.js
// ══════════════════════════════════════════════

const IS_MOBILE = true;

// Нет анимации травы на мобиле
function _onAnimFrame(t) { /* no-op */ }

// ── Точка входа антуража ──────────────────────
function _buildEntourage(scene) {
  _buildMobileBushes(scene);
  _buildMobileTrees(scene);
  _buildMobileGrassPatches(scene);
}

// ══════════════════════════════════════════════
// BILLBOARD КУСТЫ
// ══════════════════════════════════════════════
function _buildMobileBushes(scene) {
  // Генерируем две canvas-текстуры куста (разные оттенки)
  const texA = _makeBushTex(0.26, 0.52);
  const texB = _makeBushTex(0.32, 0.46);

  const matA = new THREE.SpriteMaterial({map: texA, fog: true});
  const matB = new THREE.SpriteMaterial({map: texB, fog: true});

  const spots = [
    [-4,0,-3],[16,0,-3],[20,0,8],[-4,0,8],
    [6,0,-4.5],[12,0,-4.5],[2,0,14],[14,0,14],
    [22,0,5],[-6,0,11],[25,0,10],[-3,0,3],
  ];

  for (const [x,,z] of spots) {
    const mat    = Math.random()>.5 ? matA : matB;
    const sprite = new THREE.Sprite(mat);
    const s      = 1.2+Math.random()*.9;
    sprite.scale.set(s*1.15, s*1.3, 1);
    sprite.position.set(x, s*.62, z);
    scene.add(sprite);
  }
}

// ══════════════════════════════════════════════
// BILLBOARD ДЕРЕВЬЯ
// ══════════════════════════════════════════════
function _buildMobileTrees(scene) {
  const texA = _makeTreeTex(0.28, 0.50);
  const texB = _makeTreeTex(0.24, 0.56);

  const matA = new THREE.SpriteMaterial({map: texA, fog: true});
  const matB = new THREE.SpriteMaterial({map: texB, fog: true});

  const spots = [
    [-8,0,-6],[-10,0,4],[-8,0,14],
    [28,0,-4],[30,0,8],[28,0,18],
    [10,0,-8],[16,0,-8],[8,0,20],[18,0,20],
  ];

  for (const [x,,z] of spots) {
    const mat    = Math.random()>.5 ? matA : matB;
    const sprite = new THREE.Sprite(mat);
    const s      = 2.5+Math.random()*1.8;
    sprite.scale.set(s*.85, s, 1);
    sprite.position.set(x, s*.5, z);
    scene.add(sprite);
  }
}

// ══════════════════════════════════════════════
// ПЛОСКИЕ ПЯТНА ТРАВЫ (простые quad-меши)
// Заменяют InstancedMesh на мобиле
// ══════════════════════════════════════════════
function _buildMobileGrassPatches(scene) {
  const textures = [_makeGrassPatchTex(0), _makeGrassPatchTex(1)];
  const mats = textures.map(t =>
    new THREE.MeshBasicMaterial({
      map: t, transparent:true, alphaTest:0.18,
      side: THREE.DoubleSide, depthWrite:false,
    })
  );

  const COUNT = 200;
  const AREA  = 38;

  for (let i=0;i<COUNT;i++) {
    let x, z;
    do {
      x = (Math.random()-.5)*AREA*2;
      z = (Math.random()-.5)*AREA*2;
    } while (Math.abs(x-8)<10 && Math.abs(z-6)<8);

    const s   = .6+Math.random()*.9;
    const geo = new THREE.PlaneGeometry(s*1.1, s*1.4);
    const mat = mats[Math.random()*2|0];
    const m   = new THREE.Mesh(geo, mat);
    m.position.set(x, s*.7, z);
    m.rotation.y = Math.random()*Math.PI*2;
    scene.add(m);

    // Крест из двух плоскостей
    const m2 = new THREE.Mesh(geo, mat);
    m2.position.set(x, s*.7, z);
    m2.rotation.y = m.rotation.y + Math.PI/2;
    scene.add(m2);
  }
}

// ══════════════════════════════════════════════
// CANVAS-ТЕКСТУРЫ ДЛЯ СПРАЙТОВ
// ══════════════════════════════════════════════

// Куст: несколько перекрывающихся окружностей
function _makeBushTex(lightBase, satBase) {
  const sz  = 128;
  const c   = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');

  const clusters = [
    [sz*.50, sz*.52, sz*.34],
    [sz*.33, sz*.60, sz*.27],
    [sz*.67, sz*.58, sz*.27],
    [sz*.50, sz*.38, sz*.24],
    [sz*.42, sz*.68, sz*.18],
  ];
  for (const [cx,cy,r] of clusters) {
    const hue = 95+Math.random()*28|0;
    const sat = satBase*100|0;
    const lt  = lightBase*100|0;
    const g   = ctx.createRadialGradient(cx,cy,0, cx,cy,r);
    g.addColorStop(0,   `hsla(${hue},${sat}%,${lt+14}%,0.95)`);
    g.addColorStop(0.6, `hsla(${hue},${sat}%,${lt}%,0.85)`);
    g.addColorStop(1,   'hsla(100,38%,8%,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  }
  // Стволик
  ctx.fillStyle = '#3d2a10cc';
  ctx.fillRect(sz*.46, sz*.74, sz*.08, sz*.24);

  return new THREE.CanvasTexture(c);
}

// Дерево: конусообразная крона + ствол
function _makeTreeTex(lightBase, satBase) {
  const sz  = 128;
  const c   = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');

  // Ствол
  const stx = sz*.47, sty = sz*.68, stw = sz*.06, sth = sz*.30;
  const stg = ctx.createLinearGradient(stx,sty, stx+stw,sty+sth);
  stg.addColorStop(0, '#4a3010cc');
  stg.addColorStop(1, '#2a1a08aa');
  ctx.fillStyle = stg;
  ctx.fillRect(stx, sty, stw, sth);

  // Крона — два треугольных градиентных конуса
  const layers = [
    { cy:sz*.55, w:sz*.62, h:sz*.52, lt:lightBase },
    { cy:sz*.35, w:sz*.46, h:sz*.42, lt:lightBase+.06 },
  ];
  for (const {cy,w,h,lt} of layers) {
    const hue = 100+Math.random()*20|0;
    const sat = satBase*100|0;
    const g   = ctx.createRadialGradient(sz*.5,cy*.9,0, sz*.5,cy,w*.5);
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

// Пучок травы для billboard-пятен
function _makeGrassPatchTex(variant) {
  const sz  = 64;
  const c   = document.createElement('canvas');
  c.width = c.height = sz;
  const ctx = c.getContext('2d');

  const blades = 12+variant*4;
  for (let i=0;i<blades;i++) {
    const x  = sz*.1+Math.random()*sz*.8;
    const h  = sz*.45+Math.random()*sz*.4;
    const hue = 95+Math.random()*25|0;
    const lt  = 22+Math.random()*18|0;
    const g   = ctx.createLinearGradient(x, sz, x, sz-h);
    g.addColorStop(0, `hsla(${hue},52%,${lt}%,0.9)`);
    g.addColorStop(1, `hsla(${hue+8},58%,${lt+16}%,0.0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5+Math.random()*1.5;
    ctx.beginPath();
    ctx.moveTo(x, sz);
    // Кривизна стебля
    ctx.quadraticCurveTo(
      x+(Math.random()-.5)*12, sz-h*.5,
      x+(Math.random()-.5)*8,  sz-h
    );
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
