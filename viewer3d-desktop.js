// ══════════════════════════════════════════════
// VIEWER3D-DESKTOP.JS
// Антураж для десктопа:
//   • InstancedMesh трава (14 000 стеблей) + шейдер ветра (onBeforeCompile)
//   • Объёмные кусты из сфер-листьев + цилиндр-стволик
// Зависимости: viewer3d-core.js
// ══════════════════════════════════════════════

const IS_MOBILE = false;

// Ссылки на объекты для анимации
let _grassMesh   = null;
let _grassTime   = { value: 0 };

// ── Хук анимационного цикла (вызывается из core) ──
function _onAnimFrame(t) {
  if (_grassTime) _grassTime.value = t;
}

// ── Точка входа антуража ──────────────────────
function _buildEntourage(scene) {
  _buildDesktopGrass(scene);
  _buildDesktopBushes(scene);
  _buildDesktopTrees(scene);
}

// ══════════════════════════════════════════════
// INSTANCED ТРАВА С ШЕЙДЕРОМ ПОКАЧИВАНИЯ
// ══════════════════════════════════════════════
function _buildDesktopGrass(scene) {
  const COUNT = 14000;
  const AREA  = 44;

  // Геометрия одного стебля: вытянутый трапециевидный quadvelt
  // 3 вертикальных сегмента для плавного изгиба при покачивании
  const SEG  = 3;
  const W    = 0.06;
  const H    = 0.48;
  const positions = [];
  const uvs       = [];
  const indices   = [];
  const segHeights = []; // нормализованная высота каждого ряда (для шейдера)

  for (let s = 0; s <= SEG; s++) {
    const v  = s / SEG;
    const hw = W / 2 * (1 - v * 0.72); // сужается к верхушке
    positions.push(-hw, v*H, 0,  hw, v*H, 0);
    uvs.push(0, v,  1, v);
  }
  for (let s = 0; s < SEG; s++) {
    const b = s * 2;
    indices.push(b,b+1,b+2, b+1,b+3,b+2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs),       2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Случайные трансформации для каждого экземпляра
  const dummy = new THREE.Object3D();
  const mat   = new THREE.MeshLambertMaterial({
    color:       0x4a8e22,
    side:        THREE.DoubleSide,
    transparent: true,
    alphaTest:   0.05,
  });

  // onBeforeCompile — вставляем шейдер ветра без полного ShaderMaterial
  const timeUniform = { value: 0 };
  _grassTime = timeUniform;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time      = timeUniform;
    shader.uniforms.windDir   = { value: new THREE.Vector2(1.0, 0.35) };
    shader.uniforms.windSpeed = { value: 1.8 };
    shader.uniforms.windAmp   = { value: 0.18 };

    // Добавляем атрибут высоты из UV.y в вершинный шейдер
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      uniform float time;
      uniform vec2  windDir;
      uniform float windSpeed;
      uniform float windAmp;
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float vFactor = uv.y * uv.y;                       // нарастает к верхушке
      float phase   = dot(transformed.xz, windDir) * 0.6;
      float wave    = sin(time * windSpeed + phase) * windAmp * vFactor;
      float gust    = sin(time * windSpeed * 0.31 + phase * 1.7) * windAmp * 0.4 * vFactor;
      transformed.x += (windDir.x * wave + gust);
      transformed.z += (windDir.y * wave * 0.6);
      `
    );
    // Градиент цвета: тёмный корень → светлая верхушка
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 grassBot = vec3(0.10, 0.30, 0.07);
      vec3 grassTop = vec3(0.38, 0.70, 0.16);
      diffuseColor.rgb = mix(grassBot, grassTop, vUv.y);
      `
    );
  };
  mat.needsUpdate = true;

  const iMesh = new THREE.InstancedMesh(geo, mat, COUNT);
  iMesh.castShadow    = false;
  iMesh.receiveShadow = true;
  iMesh.frustumCulled = false;

  for (let i = 0; i < COUNT; i++) {
    let x, z;
    do {
      x = (Math.random()-.5) * AREA * 2;
      z = (Math.random()-.5) * AREA * 2;
    } while (Math.abs(x-8) < 9 && Math.abs(z-6) < 7);  // маска под домом

    dummy.position.set(x, 0, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.6 + Math.random() * 0.75;
    dummy.scale.set(s, s * (0.8 + Math.random()*.4), s);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);
  }
  iMesh.instanceMatrix.needsUpdate = true;

  scene.add(iMesh);
  _grassMesh = iMesh;
}

// ══════════════════════════════════════════════
// ОБЪЁМНЫЕ КУСТЫ
// ══════════════════════════════════════════════
function _buildDesktopBushes(scene) {
  const group = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({
    color:0x3a2208, roughness:0.96, metalness:0,
  });
  // Три оттенка листвы — тёмный / средний / светлый
  const leafMats = [
    new THREE.MeshStandardMaterial({color:0x1e5010, roughness:0.88, metalness:0, envMapIntensity:0.3}),
    new THREE.MeshStandardMaterial({color:0x2e6e18, roughness:0.82, metalness:0, envMapIntensity:0.4}),
    new THREE.MeshStandardMaterial({color:0x44a024, roughness:0.76, metalness:0, envMapIntensity:0.5}),
  ];

  const spots = [
    [-4,0,-3],[16,0,-3],[20,0,8],[-4,0,8],
    [6,0,-4.5],[12,0,-4.5],[-3,0,3],[19,0,3],
    [2,0,14],[8,0,15],[14,0,14],[22,0,5],[-6,0,11],[25,0,10],
  ];

  for (const [bx,,bz] of spots) {
    const bush = new THREE.Group();

    // Стволики
    const stemCnt = 2 + Math.random()*3|0;
    for (let i=0;i<stemCnt;i++) {
      const h   = 0.4+Math.random()*.6;
      const geo = new THREE.CylinderGeometry(.022,.055,h,5);
      const m   = new THREE.Mesh(geo, stemMat);
      m.position.set((Math.random()-.5)*.4, h/2, (Math.random()-.5)*.4);
      m.rotation.z = (Math.random()-.5)*.45;
      m.castShadow = true;
      bush.add(m);
    }

    // Листвяные шары — несколько перекрывающихся
    const sphereCnt = 5+Math.random()*5|0;
    for (let i=0;i<sphereCnt;i++) {
      const r   = .20+Math.random()*.34;
      const geo = new THREE.SphereGeometry(r, 8, 6);
      const m   = new THREE.Mesh(geo, leafMats[Math.random()*3|0]);
      m.position.set(
        (Math.random()-.5)*.85,
        .25+Math.random()*.8,
        (Math.random()-.5)*.85,
      );
      m.castShadow    = true;
      m.receiveShadow = true;
      bush.add(m);
    }

    bush.position.set(bx, 0, bz);
    bush.rotation.y = Math.random()*Math.PI*2;
    const s = .7+Math.random()*.7;
    bush.scale.set(s,s,s);
    group.add(bush);
  }

  scene.add(group);
}

// ══════════════════════════════════════════════
// ПРОСТЫЕ ДЕРЕВЬЯ (цилиндр + конус)
// ══════════════════════════════════════════════
function _buildDesktopTrees(scene) {
  const trunkMat = new THREE.MeshStandardMaterial({color:0x4a3010, roughness:0.95, metalness:0});
  const crownMats = [
    new THREE.MeshStandardMaterial({color:0x1a5c0c, roughness:0.88, metalness:0}),
    new THREE.MeshStandardMaterial({color:0x226e12, roughness:0.84, metalness:0}),
    new THREE.MeshStandardMaterial({color:0x2a8418, roughness:0.80, metalness:0}),
  ];

  const spots = [
    [-8,0,-6],[-10,0,4],[-8,0,14],
    [28,0,-4],[30,0,8],[28,0,18],
    [10,0,-8],[16,0,-8],
    [8,0,20],[18,0,20],
  ];

  const group = new THREE.Group();
  for (const [tx,,tz] of spots) {
    const tree  = new THREE.Group();
    const h     = 3.5+Math.random()*2.5;
    const cr    = .12+Math.random()*.06;

    // Ствол
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(cr*.6, cr, h*.42, 7),
      trunkMat,
    );
    trunk.position.y = h*.21;
    trunk.castShadow = true;
    tree.add(trunk);

    // Крона — 2-3 конуса разного радиуса
    const layers = 2+Math.random()*2|0;
    for (let l=0;l<layers;l++) {
      const lh  = h*.45/(l+1);
      const lr  = (1.0-l*.22) * (1.4+Math.random()*.6);
      const geo = new THREE.ConeGeometry(lr, lh, 8);
      const m   = new THREE.Mesh(geo, crownMats[Math.random()*3|0]);
      m.position.y = h*.38 + l*(lh*.55);
      m.castShadow = m.receiveShadow = true;
      tree.add(m);
    }

    tree.position.set(tx, 0, tz);
    tree.rotation.y = Math.random()*Math.PI*2;
    const s = .85+Math.random()*.45;
    tree.scale.set(s,s,s);
    group.add(tree);
  }
  scene.add(group);
}
