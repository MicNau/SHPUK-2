// ══════════════════════════════════════════════
// VIEWER3D-MOBILE.JS
// Антураж для мобильных устройств:
//   • Billboard-спрайты кустов (assets/bush_a.png, bush_b.png)
//   • Billboard-спрайты деревьев (assets/tree_a.png, tree_b.png)
//   • Плоские пятна травы (assets/grass_patch.png) — без InstancedMesh
// Зависимости: viewer3d-core.js
// ══════════════════════════════════════════════

const IS_MOBILE = true;

// Нет анимации на мобиле
function _onAnimFrame(t) { /* no-op */ }

// Точка входа
function _buildEntourage(scene) {
  _buildMobileVegetation(scene);
}

// ══════════════════════════════════════════════
// ВСЯ РАСТИТЕЛЬНОСТЬ ЧЕРЕЗ СПРАЙТЫ
// ══════════════════════════════════════════════
function _buildMobileVegetation(scene) {
  const loader = new THREE.TextureLoader();
  let texBushA=null, texBushB=null, texTreeA=null, texTreeB=null;
  let loaded = 0;

  const onLoaded = () => {
    loaded++;
    if (loaded < 4) return;
    _placeBushes(scene, texBushA, texBushB);
    _placeTrees(scene, texTreeA, texTreeB);
    // _placeGrassPatches — выключено
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
  const matA = new THREE.SpriteMaterial({ map: texA, fog: true, transparent: true, alphaTest: 0.15, depthWrite: false });
  const matB = new THREE.SpriteMaterial({ map: texB, fog: true, transparent: true, alphaTest: 0.15, depthWrite: false });
  for (const [x,,z] of spots) {
    const sprite = new THREE.Sprite(Math.random()>.5 ? matA : matB);
    const s = 1.2 + Math.random() * 0.9;
    sprite.scale.set(s * 1.1, s * 1.3, 1);
    sprite.position.set(x, s * 0.62, z);
    scene.add(sprite);
  }
}

function _placeTrees(scene, texA, texB) {
  const spots = [
    [-8,0,-6],[-10,0,4],[-8,0,14],
    [28,0,-4],[30,0,8],[28,0,18],
    [10,0,-8],[16,0,-8],[8,0,20],[18,0,20],
  ];
  const matA = new THREE.SpriteMaterial({ map: texA, fog: true, transparent: true, alphaTest: 0.15, depthWrite: false });
  const matB = new THREE.SpriteMaterial({ map: texB, fog: true, transparent: true, alphaTest: 0.15, depthWrite: false });
  for (const [x,,z] of spots) {
    const sprite = new THREE.Sprite(Math.random()>.5 ? matA : matB);
    const s = 2.8 + Math.random() * 2.0;
    sprite.scale.set(s * 0.85, s, 1);
    sprite.position.set(x, s * 0.5, z);
    scene.add(sprite);
  }
}

function _placeGrassPatches(scene, tex) {
  const COUNT = 120, AREA = 36;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.18,
    side: THREE.DoubleSide, depthWrite: false,
  });
  for (let i = 0; i < COUNT; i++) {
    let x, z;
    do { x=(Math.random()-.5)*AREA*2; z=(Math.random()-.5)*AREA*2; }
    while (Math.abs(x-8)<10 && Math.abs(z-6)<8);
    const s = .6 + Math.random() * .9;
    const geo = new THREE.PlaneGeometry(s * 1.1, s * 1.4);
    // Крест из двух плоскостей
    const m1 = new THREE.Mesh(geo, mat); m1.position.set(x, s*.7, z); m1.rotation.y = Math.random()*Math.PI*2; scene.add(m1);
    const m2 = new THREE.Mesh(geo, mat); m2.position.set(x, s*.7, z); m2.rotation.y = m1.rotation.y + Math.PI/2; scene.add(m2);
  }
}

// ── Процедурные fallback-текстуры ─────────────
function _fallbackBush(lightBase, satBase) {
  const sz=128, c=document.createElement('canvas'); c.width=c.height=sz;
  const ctx=c.getContext('2d');
  const clusters=[[sz*.5,sz*.52,sz*.34],[sz*.33,sz*.60,sz*.27],[sz*.67,sz*.58,sz*.27],[sz*.5,sz*.38,sz*.24]];
  for(const[cx,cy,r]of clusters){
    const hue=95+Math.random()*28|0,sat=satBase*100|0,lt=lightBase*100|0;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,`hsla(${hue},${sat}%,${lt+14}%,0.95)`);g.addColorStop(.6,`hsla(${hue},${sat}%,${lt}%,0.85)`);g.addColorStop(1,'hsla(100,38%,8%,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#3d2a10cc';ctx.fillRect(sz*.46,sz*.74,sz*.08,sz*.24);
  return new THREE.CanvasTexture(c);
}

function _fallbackTree(lightBase, satBase) {
  const sz=128, c=document.createElement('canvas'); c.width=c.height=sz;
  const ctx=c.getContext('2d');
  const stg=ctx.createLinearGradient(sz*.47,sz*.68,sz*.53,sz*.98);
  stg.addColorStop(0,'#4a3010cc');stg.addColorStop(1,'#2a1a08aa');
  ctx.fillStyle=stg;ctx.fillRect(sz*.47,sz*.68,sz*.06,sz*.30);
  for(const[cy,w,h,lt]of[[sz*.55,sz*.62,sz*.52,lightBase],[sz*.35,sz*.46,sz*.42,lightBase+.06]]){
    const hue=100+Math.random()*20|0,sat=satBase*100|0;
    const g=ctx.createRadialGradient(sz*.5,cy*.9,0,sz*.5,cy,w*.5);
    g.addColorStop(0,`hsla(${hue},${sat}%,${lt*100+10}%,0.92)`);g.addColorStop(.7,`hsla(${hue},${sat}%,${lt*100}%,0.80)`);g.addColorStop(1,'hsla(110,40%,5%,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(sz*.5,cy-h*.5);ctx.lineTo(sz*.5+w*.5,cy+h*.5);ctx.lineTo(sz*.5-w*.5,cy+h*.5);ctx.closePath();ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function _fallbackGrass() {
  const sz=64, c=document.createElement('canvas'); c.width=c.height=sz;
  const ctx=c.getContext('2d');
  for(let i=0;i<14;i++){
    const x=sz*.1+Math.random()*sz*.8,h=sz*.45+Math.random()*sz*.4;
    const hue=95+Math.random()*25|0,lt=22+Math.random()*18|0;
    const g=ctx.createLinearGradient(x,sz,x,sz-h);
    g.addColorStop(0,`hsla(${hue},52%,${lt}%,0.9)`);g.addColorStop(1,`hsla(${hue+8},58%,${lt+16}%,0.0)`);
    ctx.strokeStyle=g;ctx.lineWidth=1.5+Math.random()*1.5;
    ctx.beginPath();ctx.moveTo(x,sz);ctx.quadraticCurveTo(x+(Math.random()-.5)*12,sz-h*.5,x+(Math.random()-.5)*8,sz-h);ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
