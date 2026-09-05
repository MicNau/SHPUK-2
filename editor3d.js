// ══════════════════════════════════════════════════════════════════════════
// editor3d.js — редактирование благоустройства ПРЯМО В 3D-СЦЕНЕ
//
// Версия 3D-UI: 2D-план убран, разметка и выбор объектов происходят в сцене.
// Модуль отвечает за:
//   • перевод курсора в координаты плана (луч в сцену → мир → worldToCanvas);
//   • выбор объекта активного раздела кликом и снятие выбора кликом по пустому;
//   • перетаскивание: террасу за углы и за тело, лестницу за середину и за
//     боковые маркеры, грядку и мебель за тело плюс ручка поворота на 90°,
//     точки ломаных и маркеры входа в ограждение;
//   • рисование дорожек и забора ОТРЕЗКАМИ: клик — начало, второй клик — конец;
//     клик по существующей точке склеивает отрезки в одну ломаную;
//   • подсветку выбранного объекта, маркеры и ручки;
//   • сетку 1 м на земле (снап при этом прежний, SNAP = 0.25 м);
//   • оверлей с размерами и площадями, пока раздел открыт.
//
// Вся геометрия считается в НОРМИРОВАННЫХ координатах плана (0..1 на сетке
// GRID×GRID м) — тех же, в которых работали canvas-редакторы. Поэтому снап,
// прилипание к дому и к столбам ограждения, нормализация лестницы и повороты
// переиспользуются из canvas.js как есть, а не пишутся заново.
//
// Разделение кнопок мыши (решение по ТЗ, вариант «а»):
//   ЛКМ по объекту своего раздела — выбор и перетаскивание,
//   ЛКМ по пустому месту       — орбита камеры (OrbitControls),
//   ПКМ — панорама, колесо — зум (как было).
// Клик по объекту ЧУЖОГО раздела игнорируется: активный раздел меняют только
// кнопки левой панели.
//
// Зависимости: Three.js r128, state.js (S, RECT_SECTIONS, secRects…),
// canvas.js (GRID, SNAP — геометрические константы плана),
// viewer3d-builders.js (worldToCanvas / canvasToWorld / lastHouseSize),
// viewer3d-core.js (threeState).
// ══════════════════════════════════════════════════════════════════════════

const E3D_GRID_STEP  = 1.0;    // шаг ВИДИМОЙ сетки на земле, м (снап мельче — SNAP)
const E3D_PICK_R     = 0.45;   // радиус попадания по точке линии / мебели, м
const E3D_HANDLE_HIT = 0.40;   // радиус попадания по ручке, м
const E3D_HANDLE_R   = 0.20;   // радиус кружка ручки, м
const E3D_ROT_OUT    = 0.55;   // вынос ручки поворота за габарит объекта, м
const E3D_GLUE_R     = 0.45;   // клик ближе этого к существующей точке — склейка, м
const E3D_LIFT       = 0.03;   // подъём подсветки над поверхностью, м
const E3D_MOVE_TOL   = 4;      // px: дальше этого — это протяжка, а не клик

// Разделы по типу разметки. От типа зависит и хит-тест, и вид подсветки.
const E3D_KIND = {
  terrace:      'rect',
  pool_terrace: 'rect',
  steps:        'steps',
  beds:         'beds',
  furniture:    'point',
  paths:        'line',
  fence:        'line',
  railing:      'railing',   // строится по террасе — таскаются только маркеры входа
};

const E3D = {
  sec:   null,   // активный раздел («terrace», «paths», …) или null
  group: null,   // THREE.Group: сетка, подсветка, маркеры, ручки
  grid:  null,   // THREE.GridHelper — живёт внутри group
  press: null,   // {x, y, hit, np} — состояние между pointerdown и pointerup
  drag:  null,   // {kind, idx, handle, start, from} — идущее перетаскивание
  draw:  null,   // {name, start} — начатый, но не законченный отрезок линии
  bound: false,  // слушатели уже навешаны на канвас рендерера
};

// Выбранная точка ломаной хранится в _lineSel (canvas.js) — на неё завязаны
// delLinePoint и удаление калитки, поэтому второго источника не заводим.

// ── Мир ⇄ план ───────────────────────────────────────────────────────────
// Обе стороны берут габариты дома из последней сборки сцены — теми же
// значениями считает и 3D, значит план и сцена не разъезжаются.

function _e3dToNorm(x, z) {
  const sz = (typeof lastHouseSize === 'function') ? lastHouseSize() : { L: 0, W: 0 };
  return worldToCanvas([{ x, z }], sz.L, sz.W)[0];
}

function _e3dToWorld(p) {
  const sz = (typeof lastHouseSize === 'function') ? lastHouseSize() : { L: 0, W: 0 };
  return canvasToWorld([p], sz.L, sz.W)[0];
}

// ── Луч в сцену ──────────────────────────────────────────────────────────
// Берём ПЕРВОЕ пересечение с геометрией сцены (настил, ступени, земля…) и
// переводим точку попадания в координаты плана. Так клик по приподнятой
// террасе попадает именно в её прямоугольник, а не в землю под ней.

const _e3dRay = new THREE.Raycaster();
const _e3dNdc = new THREE.Vector2();
const _e3dGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function _e3dPickTargets() {
  if (!threeState) return [];
  const skip = new Set([threeState.skyMesh, E3D.group].filter(Boolean));
  return threeState.scene.children.filter(o => o.visible && !skip.has(o));
}

// Экранные координаты события → {norm:{x,y}, world:{x,y,z}} или null.
function _e3dPointAt(ev) {
  if (!threeState || !threeState.renderer) return null;
  const el = threeState.renderer.domElement;
  const r = el.getBoundingClientRect();
  _e3dNdc.x =  ((ev.clientX - r.left) / r.width)  * 2 - 1;
  _e3dNdc.y = -((ev.clientY - r.top)  / r.height) * 2 + 1;
  _e3dRay.setFromCamera(_e3dNdc, threeState.camera);

  let world = null;
  const hits = _e3dRay.intersectObjects(_e3dPickTargets(), true);
  if (hits.length) world = hits[0].point;
  else {
    // Мимо всей геометрии — считаем пересечение с плоскостью земли.
    const p = new THREE.Vector3();
    if (!_e3dRay.ray.intersectPlane(_e3dGroundPlane, p)) return null;
    world = p;
  }
  return { world, norm: _e3dToNorm(world.x, world.z) };
}

// Высота поверхности под точкой плана (для подсветки): луч сверху вниз.
function _e3dSurfaceY(np) {
  const w = _e3dToWorld(np);
  _e3dRay.set(new THREE.Vector3(w.x, 60, w.z), new THREE.Vector3(0, -1, 0));
  const hits = _e3dRay.intersectObjects(_e3dPickTargets(), true);
  return hits.length ? hits[0].point.y : 0;
}

// ── Хит-тесты в координатах плана (0..1) ─────────────────────────────────

function _e3dInRect(np, r) {
  return np.x >= r.x && np.x <= r.x + r.w && np.y >= r.y && np.y <= r.y + r.h;
}

// Прямоугольники: сначала активный (он сверху), потом остальные.
function _e3dHitRects(list, act, np) {
  if (act !== null && act !== undefined && list[act] && _e3dInRect(np, list[act])) return act;
  for (let i = 0; i < list.length; i++) if (_e3dInRect(np, list[i])) return i;
  return null;
}

// Точка ломаной, а если мимо точек — ближайший сегмент (для вставки в PR2).
function _e3dHitLine(name, np) {
  const pts = S.pts[name] || [];
  const r = E3D_PICK_R / GRID;
  let best = r, idx = null;
  pts.forEach((q, i) => {
    if (q.break) return;
    const d = Math.hypot(q.x - np.x, q.y - np.y);
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

function _e3dHitPoints(list, np) {
  const r = E3D_PICK_R / GRID;
  let best = r, idx = null;
  (list || []).forEach((q, i) => {
    const d = Math.hypot(q.x - np.x, q.y - np.y);
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

// Ручки выбранного объекта: углы прямоугольника, боковины лестницы, поворот.
// Возвращают массив [{ handle, np }] в координатах плана.
function _e3dRectHandles(r) {
  return [
    { handle: 'nw', np: { x: r.x,       y: r.y       } },
    { handle: 'ne', np: { x: r.x + r.w, y: r.y       } },
    { handle: 'sw', np: { x: r.x,       y: r.y + r.h } },
    { handle: 'se', np: { x: r.x + r.w, y: r.y + r.h } },
  ];
}

// У лестницы ширину меняют ТОЛЬКО боковые маркеры: глубину считает
// _stepsNormalize по высоте подъёма, тянуть её незачем. Боковые — те две
// стороны, что поперёк спуска.
function _e3dStepsHandles(s) {
  const alongX = s.w >= s.h;                       // спуск по Y → ширина по X
  return alongX
    ? [{ handle: 'nw', np: { x: s.x,       y: s.y + s.h / 2 } },
       { handle: 'ne', np: { x: s.x + s.w, y: s.y + s.h / 2 } }]
    : [{ handle: 'nw', np: { x: s.x + s.w / 2, y: s.y       } },
       { handle: 'sw', np: { x: s.x + s.w / 2, y: s.y + s.h } }];
}

// Ручка поворота грядки — сбоку от неё; мебели — по направлению «переда».
function _e3dBedRotHandle(b) {
  return { handle: 'rot', np: { x: b.x + b.w + E3D_ROT_OUT / GRID, y: b.y + b.h / 2 } };
}

function _e3dFurnRotHandle(p) {
  const a = p.rot || 0;
  return { handle: 'rot', np: { x: p.x + Math.cos(a) * E3D_ROT_OUT / GRID,
                                y: p.y + Math.sin(a) * E3D_ROT_OUT / GRID } };
}

function _e3dHitHandles(list, np) {
  const r = E3D_HANDLE_HIT / GRID;
  let best = r, hit = null;
  for (const h of list) {
    const d = Math.hypot(h.np.x - np.x, h.np.y - np.y);
    if (d < best) { best = d; hit = h.handle; }
  }
  return hit;
}

// Маркеры входа в ограждение: пара точек на петле, каждую можно таскать.
function _e3dHitEntry(np) {
  if (typeof railingEntryPointsNorm !== 'function') return null;
  const r = E3D_HANDLE_HIT / GRID;
  let best = r, hit = null;
  for (const e of railingEntryPointsNorm()) {
    for (const [k, q] of [[0, e.a], [1, e.b]]) {
      const d = Math.hypot(q.x - np.x, q.y - np.y);
      if (d < best) { best = d; hit = { kind: 'entry', idx: e.li, handle: k }; }
    }
  }
  return hit;
}

// Что под курсором в АКТИВНОМ разделе? → {kind, idx, handle} или null.
// Ручки выбранного объекта имеют приоритет над телом — иначе за угол не
// ухватиться, клик всегда попадал бы в прямоугольник.
function e3dHitTest(np) {
  const sec = E3D.sec;
  if (!sec || !np) return null;
  const kind = E3D_KIND[sec];

  if (kind === 'rect' || kind === 'steps' || kind === 'beds') {
    const list = kind === 'rect' ? secRects(sec)
               : kind === 'steps' ? (S.stepsList || [])
               : (S.beds || []);
    const act = kind === 'rect' ? secActiveIdx(sec)
              : kind === 'steps' ? S.activeSteps : S.activeBed;
    const cur = (act !== null && act !== undefined) ? list[act] : null;
    if (cur) {
      const handles = kind === 'rect'  ? _e3dRectHandles(cur)
                    : kind === 'steps' ? _e3dStepsHandles(cur)
                    : [_e3dBedRotHandle(cur)];
      const h = _e3dHitHandles(handles, np);
      if (h) return { kind, idx: act, handle: h };
    }
    const i = _e3dHitRects(list, act, np);
    return i === null ? null : { kind, idx: i, handle: 'move' };
  }

  if (kind === 'point') {
    const list = S.furniture || [];
    const act = S.activeFurniture;
    if (act !== null && list[act]) {
      const h = _e3dHitHandles([_e3dFurnRotHandle(list[act])], np);
      if (h) return { kind, idx: act, handle: h };
    }
    const i = _e3dHitPoints(list, np);
    return i === null ? null : { kind, idx: i, handle: 'move' };
  }

  if (kind === 'railing') return _e3dHitEntry(np);

  if (kind === 'line') {
    if (sec === 'fence' && typeof _gateHit === 'function' && _gateHit(np)) {
      return { kind, idx: 'gate', handle: 'move' };
    }
    const i = _e3dHitLine(sec, np);
    return i === null ? null : { kind, idx: i, handle: 'move' };
  }
  return null;
}

// ── Выбор ────────────────────────────────────────────────────────────────

function e3dSelect(hit) {
  const sec = E3D.sec;
  if (!sec) return;
  const idx = hit ? hit.idx : null;
  const kind = E3D_KIND[sec];
  if (kind === 'rect')       setSecActiveIdx(sec, idx);
  else if (kind === 'steps') { if (idx !== null) S.activeSteps = idx; }
  else if (kind === 'beds')  S.activeBed = idx;
  else if (kind === 'point') S.activeFurniture = idx;
  else if (kind === 'line')  _lineSel = { name: sec, idx };
  e3dSync();
  if (typeof _dSyncSectionActions === 'function') _dSyncSectionActions();
}

// Индекс выбранного объекта активного раздела (null — ничего не выбрано).
function e3dSelectedIdx() {
  const sec = E3D.sec;
  if (!sec) return null;
  const kind = E3D_KIND[sec];
  if (kind === 'rect')  return secActiveIdx(sec);
  if (kind === 'steps') return S.activeSteps;
  if (kind === 'beds')  return S.activeBed;
  if (kind === 'point') return S.activeFurniture;
  if (kind === 'line')  return (_lineSel.name === sec) ? _lineSel.idx : null;
  if (kind === 'railing') return null;   // отдельных объектов нет — только вход
  return null;
}

// ── Подсветка, маркеры и сетка ───────────────────────────────────────────

function _e3dEnsureGroup() {
  if (!threeState) return null;
  if (!E3D.group || E3D.group.parent !== threeState.scene) {
    E3D.group = new THREE.Group();
    E3D.group.name = 'editor3d';
    E3D.group.renderOrder = 999;
    threeState.scene.add(E3D.group);
    E3D.grid = null;
  }
  return E3D.group;
}

function _e3dClearGroup() {
  const g = _e3dEnsureGroup();
  if (!g) return null;
  for (let i = g.children.length - 1; i >= 0; i--) {
    const o = g.children[i];
    g.remove(o);
    if (o === E3D.grid) continue;               // сетку переиспользуем
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
  return g;
}

function _e3dLineMat(color, width) {
  return new THREE.LineBasicMaterial({
    color, linewidth: width || 1, depthTest: false, transparent: true, opacity: 0.95,
  });
}

// Замкнутый контур по точкам плана, положенный на поверхность.
function _e3dOutline(pts, color, closed) {
  const v = pts.map(p => {
    const w = _e3dToWorld(p);
    return new THREE.Vector3(w.x, _e3dSurfaceY(p) + E3D_LIFT, w.z);
  });
  if (closed && v.length) v.push(v[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(v);
  const line = new THREE.Line(geo, _e3dLineMat(color, 2));
  line.renderOrder = 999;
  return line;
}

// Маркер точки: кружок на поверхности.
function _e3dMarker(np, color, radius) {
  const w = _e3dToWorld(np);
  const y = _e3dSurfaceY(np) + E3D_LIFT;
  const geo = new THREE.CircleGeometry(radius || 0.18, 20);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(w.x, y, w.z);
  mesh.renderOrder = 1000;
  return mesh;
}

function _e3dRectPts(r) {
  return [
    { x: r.x,       y: r.y       },
    { x: r.x + r.w, y: r.y       },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x,       y: r.y + r.h },
  ];
}

const E3D_COL_SEL  = 0xff7a1a;   // выбранный объект — оранжевый, как акцент интерфейса
const E3D_COL_IDLE = 0x2f6f3f;   // прочие объекты раздела — приглушённый зелёный

// Сетка 1 м: видна, пока открыт раздел с разметкой на земле.
function _e3dSyncGrid(show) {
  const g = _e3dEnsureGroup();
  if (!g) return;
  if (!show) { if (E3D.grid) E3D.grid.visible = false; return; }
  if (!E3D.grid) {
    const div = Math.round(GRID / E3D_GRID_STEP);
    E3D.grid = new THREE.GridHelper(GRID, div, 0x8a8a8a, 0xb9b9b9);
    E3D.grid.material.transparent = true;
    E3D.grid.material.opacity = 0.35;
    E3D.grid.material.depthWrite = false;
  }
  const c = _e3dToWorld({ x: 0.5, y: 0.5 });
  E3D.grid.position.set(c.x, 0.012, c.z);
  E3D.grid.visible = true;
  if (E3D.grid.parent !== g) g.add(E3D.grid);
}

const E3D_COL_HANDLE = 0xffffff;   // ручки — белые кружки с оранжевым контуром

// Ручка: белый кружок в обводке, чтобы читался и на настиле, и на траве.
function _e3dHandle(np) {
  const g = new THREE.Group();
  g.add(_e3dMarker(np, E3D_COL_SEL, E3D_HANDLE_R));
  g.add(_e3dMarker(np, E3D_COL_HANDLE, E3D_HANDLE_R * 0.62));
  return g;
}

// Полная перерисовка слоя редактора: подсветка + маркеры + ручки + сетка + оверлей.
function e3dSync() {
  if (!threeState || typeof worldToCanvas !== 'function') return;
  const g = _e3dClearGroup();
  if (!g) return;
  const sec = E3D.sec;
  _e3dSyncGrid(!!sec);
  if (!sec) { _e3dSyncOverlay(); return; }

  const kind = E3D_KIND[sec];
  const sel = e3dSelectedIdx();

  if (kind === 'rect' || kind === 'steps' || kind === 'beds') {
    const list = kind === 'rect' ? secRects(sec)
               : kind === 'steps' ? (S.stepsList || [])
               : (S.beds || []);
    list.forEach((r, i) => {
      if (!r || !(r.w > 0) || !(r.h > 0)) return;
      g.add(_e3dOutline(_e3dRectPts(r), i === sel ? E3D_COL_SEL : E3D_COL_IDLE, true));
    });
    const cur = (sel !== null && sel !== undefined) ? list[sel] : null;
    if (cur && cur.w > 0 && cur.h > 0) {
      const handles = kind === 'rect'  ? _e3dRectHandles(cur)
                    : kind === 'steps' ? _e3dStepsHandles(cur)
                    : [_e3dBedRotHandle(cur)];
      for (const h of handles) g.add(_e3dHandle(h.np));
    }
  } else if (kind === 'point') {
    (S.furniture || []).forEach((p, i) => {
      g.add(_e3dMarker(p, i === sel ? E3D_COL_SEL : E3D_COL_IDLE, 0.22));
    });
    if (sel !== null && (S.furniture || [])[sel]) {
      const h = _e3dFurnRotHandle(S.furniture[sel]);
      g.add(_e3dOutline([S.furniture[sel], h.np], E3D_COL_SEL, false));
      g.add(_e3dHandle(h.np));
    }
  } else if (kind === 'railing') {
    // Ограждение считается по периметру террасы — рисуем только маркеры входа.
    if (typeof railingEntryPointsNorm === 'function') {
      for (const e of railingEntryPointsNorm()) {
        g.add(_e3dOutline([e.a, e.b], E3D_COL_SEL, false));
        g.add(_e3dHandle(e.a));
        g.add(_e3dHandle(e.b));
      }
    }
  } else if (kind === 'line') {
    const pts = S.pts[sec] || [];
    // Ломаная рвётся на сегменты по служебным точкам-разрывам.
    const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts];
    for (const seg of segs) if (seg.length >= 2) g.add(_e3dOutline(seg, E3D_COL_IDLE, false));
    pts.forEach((p, i) => {
      if (p.break) return;
      g.add(_e3dMarker(p, i === sel ? E3D_COL_SEL : E3D_COL_IDLE, 0.16));
    });
    if (sec === 'fence' && S.fenceGate) {
      g.add(_e3dMarker(S.fenceGate, sel === 'gate' ? E3D_COL_SEL : E3D_COL_IDLE, 0.20));
    }
    // Начатый отрезок: точка старта и «резинка» до курсора.
    if (E3D.draw && E3D.draw.name === sec) {
      g.add(_e3dHandle(E3D.draw.start));
      if (E3D.draw.cursor) g.add(_e3dOutline([E3D.draw.start, E3D.draw.cursor], E3D_COL_SEL, false));
    }
  }
  _e3dSyncOverlay();
}

// ── Оверлей размеров и площадей ──────────────────────────────────────────
// HTML-плашки над канвасом: 3D-текст здесь неудобен (поворачивается вместе со
// сценой и мельчает вдали). Позиции пересчитываются каждый кадр — иначе
// подписи отстают от вращения камеры.

function _e3dOverlayEl() { return document.getElementById('d-3d-overlay'); }

let _e3dLabels = [];   // [{ np, text, cls }] — что показывать в этом кадре

function _fmtM3d(m) {
  return (Math.round(m * 100) / 100).toFixed(m < 10 ? 2 : 1).replace(/\.?0+$/, '') + ' м';
}

function _e3dSyncOverlay() {
  const host = _e3dOverlayEl();
  if (!host) return;
  _e3dLabels = [];
  const sec = E3D.sec;
  if (sec) {
    const kind = E3D_KIND[sec];
    if (kind === 'rect' || kind === 'steps' || kind === 'beds') {
      const list = kind === 'rect' ? secRects(sec)
                 : kind === 'steps' ? (S.stepsList || [])
                 : (S.beds || []);
      list.forEach(r => {
        if (!r || !(r.w > 0) || !(r.h > 0)) return;
        const wm = r.w * GRID, hm = r.h * GRID;
        const txt = kind === 'rect'
          ? `${_fmtM3d(wm)} × ${_fmtM3d(hm)}  ·  ${(wm * hm).toFixed(1)} м²`
          : `${_fmtM3d(wm)} × ${_fmtM3d(hm)}`;
        _e3dLabels.push({ np: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, text: txt });
      });
    } else if (kind === 'line') {
      const pts = S.pts[sec] || [];
      const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts];
      for (const seg of segs) {
        for (let i = 1; i < seg.length; i++) {
          const a = seg[i - 1], b = seg[i];
          const len = Math.hypot(b.x - a.x, b.y - a.y) * GRID;
          if (len < 0.3) continue;
          _e3dLabels.push({ np: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, text: _fmtM3d(len) });
        }
      }
    }
  }
  // Плашек столько же, сколько подписей — переиспользуем узлы, чтобы не дёргать DOM.
  while (host.children.length > _e3dLabels.length) host.removeChild(host.lastChild);
  while (host.children.length < _e3dLabels.length) {
    const d = document.createElement('div');
    d.className = 'd-3d-dim';
    host.appendChild(d);
  }
  _e3dLabels.forEach((l, i) => { host.children[i].textContent = l.text; });
  _e3dPlaceLabels();
}

// Проекция подписей в экранные координаты — вызывается и из кадра анимации.
const _e3dProj = new THREE.Vector3();

function _e3dPlaceLabels() {
  const host = _e3dOverlayEl();
  if (!host || !threeState || !_e3dLabels.length) return;
  const el = threeState.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  _e3dLabels.forEach((l, i) => {
    const node = host.children[i];
    if (!node) return;
    const w = _e3dToWorld(l.np);
    _e3dProj.set(w.x, (l.y3 !== undefined ? l.y3 : 0.05), w.z).project(threeState.camera);
    if (_e3dProj.z > 1) { node.style.display = 'none'; return; }
    node.style.display = '';
    node.style.left = ((_e3dProj.x * 0.5 + 0.5) * W) + 'px';
    node.style.top  = ((-_e3dProj.y * 0.5 + 0.5) * H) + 'px';
  });
}

// ── Перетаскивание ───────────────────────────────────────────────────────
// Снап, прилипание к дому и к столбам, нормализация лестницы — из canvas.js:
// там та же система координат, и правила согласованы с 3D-сборкой.

function _e3dDragStart(hit, np) {
  const sec = E3D.sec;
  const kind = hit.kind;
  if (kind === 'rect' || kind === 'steps' || kind === 'beds') {
    const list = kind === 'rect' ? secRects(sec)
               : kind === 'steps' ? (S.stepsList || []) : (S.beds || []);
    const r = list[hit.idx];
    if (!r) return null;
    return { ...hit, from: { ...np }, start: { x: r.x, y: r.y, w: r.w, h: r.h } };
  }
  if (kind === 'point') {
    const p = (S.furniture || [])[hit.idx];
    return p ? { ...hit, from: { ...np }, start: { x: p.x, y: p.y } } : null;
  }
  if (kind === 'entry') return { ...hit, from: { ...np } };
  if (kind === 'line') return { ...hit, from: { ...np } };
  return null;
}

function _e3dDragMove(np) {
  const d = E3D.drag, sec = E3D.sec;
  if (!d) return;
  const dx = np.x - d.from.x, dy = np.y - d.from.y;

  if (d.kind === 'rect') {
    const r = secRects(sec)[d.idx];
    if (!r) return;
    const res = snapDraggedRect(d.handle, d.start, dx, dy, d.idx, sec);
    r.x = res.x; r.y = res.y; r.w = res.w; r.h = res.h;
  } else if (d.kind === 'steps') {
    const st = (S.stepsList || [])[d.idx];
    if (!st) return;
    // excludeIdx = -1 — лестница снапается ко ВСЕМ террасам и стенам дома.
    const res = snapDraggedRect(d.handle, d.start, dx, dy, -1);
    st.x = res.x; st.y = res.y; st.w = res.w; st.h = res.h;
    _stepsNormalize();                       // глубину и разворот задаёт не пользователь
    _stepsSnapToRailPost(d.handle);          // «залипание» к столбу ограждения
  } else if (d.kind === 'beds') {
    const b = (S.beds || [])[d.idx];
    if (!b || d.handle !== 'move') return;
    const c = _clampBedPos(snapNorm(d.start.x + dx), snapNorm(d.start.y + dy), b.w, b.h);
    b.x = c.x; b.y = c.y;
  } else if (d.kind === 'point') {
    const p = (S.furniture || [])[d.idx];
    if (!p || d.handle !== 'move') return;
    p.x = Math.max(0, Math.min(1, snapNorm(d.start.x + dx)));
    p.y = Math.max(0, Math.min(1, snapNorm(d.start.y + dy)));
  } else if (d.kind === 'entry') {
    if (typeof railingEntryDrag === 'function') railingEntryDrag(d.idx, d.handle, np);
  } else if (d.kind === 'line') {
    if (d.idx === 'gate') {
      const q = _fenceProjectToLine(np);    // калитка не сходит с линии забора
      if (q) S.fenceGate = q;
      return;
    }
    const pts = S.pts[sec] || [];
    const pt = pts[d.idx];
    if (!pt) return;
    let q = { x: snapNorm(np.x), y: snapNorm(np.y) };
    // Конец, подведённый к началу своей же линии, прилипает — контур замыкается.
    const snapTo = (typeof _lineCloseTarget === 'function') ? _lineCloseTarget(sec, d.idx, q) : null;
    if (snapTo) q = { x: snapTo.x, y: snapTo.y };
    else if (sec === 'fence' && typeof _fenceTooClose === 'function' && _fenceTooClose(q)) return;
    pt.x = q.x; pt.y = q.y;
  }
  e3dSync();
  if (typeof onParamChange === 'function') onParamChange();   // сборка 3D дебаунсится
}

// ── Рисование дорожек и забора отрезками ─────────────────────────────────
// Клик — начало отрезка, второй клик — конец. Следующий отрезок начинается
// новым кликом. Клик по существующей точке склеивает: координаты берутся её,
// а если это КОНЕЦ ломаной, отрезок дописывается к ней, а не заводит новую.

function _e3dLineSegs(name) {
  return (typeof splitAtBreaks === 'function') ? splitAtBreaks(S.pts[name] || []) : [];
}

// Записать список ломаных обратно плоским массивом с маркерами разрыва.
function _e3dLineWrite(name, segs) {
  const out = [];
  for (const seg of segs.filter(s => s.length)) {
    if (out.length) out.push({ break: true });
    for (const p of seg) out.push(p);
  }
  S.pts[name] = out;
}

// Ближайшая существующая точка в пределах радиуса склейки → {si, pi, pt}.
function _e3dGluePoint(name, np) {
  const segs = _e3dLineSegs(name);
  const r = E3D_GLUE_R / GRID;
  let best = r, hit = null;
  segs.forEach((seg, si) => seg.forEach((p, pi) => {
    const d = Math.hypot(p.x - np.x, p.y - np.y);
    if (d < best) { best = d; hit = { si, pi, pt: p }; }
  }));
  return hit;
}

// Точка клика для рисования: склеенная координата, иначе снап на сетку.
function _e3dDrawPoint(name, np) {
  const g = _e3dGluePoint(name, np);
  if (g) return { x: g.pt.x, y: g.pt.y, glue: g };
  return { x: snapNorm(np.x), y: snapNorm(np.y), glue: null };
}

// Закончить отрезок: приклеить к существующей ломаной, если конец совпал с её
// концом, иначе завести новую. Так три отрезка, нарисованные подряд от точки к
// точке, дают ОДНУ ломаную — забор и дорожка строятся по ней без задвоенных
// столбов на стыках.
function _e3dLineCommit(name, a, b) {
  const segs = _e3dLineSegs(name);
  const endOf = (p) => {
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      if (seg.length < 1) continue;
      if (seg[0].x === p.x && seg[0].y === p.y) return { si, at: 'head' };
      if (seg[seg.length - 1].x === p.x && seg[seg.length - 1].y === p.y) return { si, at: 'tail' };
    }
    return null;
  };
  const ea = endOf(a), eb = endOf(b);
  const A = { x: a.x, y: a.y }, B = { x: b.x, y: b.y };

  if (ea && eb && ea.si === eb.si) {          // замкнули ту же ломаную
    const seg = segs[ea.si];
    if (ea.at === 'tail') seg.push(B); else seg.unshift(B);
  } else if (ea && eb) {                      // соединили две разные ломаные
    const s1 = ea.at === 'tail' ? segs[ea.si] : segs[ea.si].slice().reverse();
    const s2 = eb.at === 'head' ? segs[eb.si] : segs[eb.si].slice().reverse();
    const merged = s1.concat(s2.slice(1).length ? s2.slice(1) : []);
    const keep = segs.filter((_, i) => i !== ea.si && i !== eb.si);
    keep.push(merged);
    _e3dLineWrite(name, keep);
    return;
  } else if (ea) {                            // продолжили существующую с её конца
    if (ea.at === 'tail') segs[ea.si].push(B); else segs[ea.si].unshift(B);
  } else if (eb) {                            // пришли в конец существующей
    if (eb.at === 'head') segs[eb.si].unshift(A); else segs[eb.si].push(A);
  } else {
    segs.push([A, B]);                        // отдельный новый отрезок
  }
  _e3dLineWrite(name, segs);
}

// Клик по земле в разделе линии: начать или закончить отрезок.
function _e3dDrawClick(np) {
  const name = E3D.sec;
  const p = _e3dDrawPoint(name, np);
  if (name === 'fence' && typeof _fenceTooClose === 'function' && _fenceTooClose(p)) {
    if (typeof dToast === 'function') dToast('Ближе 3 м к дому и террасе забор не ставится');
    return;
  }
  if (!E3D.draw || E3D.draw.name !== name) { E3D.draw = { name, start: p, cursor: null }; e3dSync(); return; }
  const a = E3D.draw.start;
  E3D.draw = null;
  if (Math.hypot(p.x - a.x, p.y - a.y) < SNAP / GRID) { e3dSync(); return; }   // клик в ту же точку
  _e3dLineCommit(name, a, p);
  _lineSel = { name, idx: null };
  e3dSync();
  if (typeof onParamChange === 'function') onParamChange();
  if (typeof _dSyncSectionActions === 'function') _dSyncSectionActions();
}

// ── События ──────────────────────────────────────────────────────────────

function _e3dOnDown(ev) {
  if (ev.button !== 0 || !E3D.sec || !threeState) return;
  const p = _e3dPointAt(ev);
  const hit = p ? e3dHitTest(p.norm) : null;
  E3D.press = { x: ev.clientX, y: ev.clientY, hit, np: p ? p.norm : null, moved: false };
  // Попали в свой объект — орбиту на время жеста выключаем: ЛКМ тянет объект.
  // Промах — орбита работает как обычно.
  if (hit) {
    threeState.controls.enabled = false;
    E3D.drag = (hit.handle === 'rot') ? null : _e3dDragStart(hit, p.norm);
  }
}

function _e3dOnMove(ev) {
  if (E3D.press) {
    if (Math.abs(ev.clientX - E3D.press.x) > E3D_MOVE_TOL
     || Math.abs(ev.clientY - E3D.press.y) > E3D_MOVE_TOL) E3D.press.moved = true;
    if (E3D.press.moved && E3D.drag) {
      const p = _e3dPointAt(ev);
      if (p) _e3dDragMove(p.norm);
    }
    return;
  }
  // «Резинка» начатого отрезка тянется за курсором.
  if (E3D.draw && E3D.draw.name === E3D.sec) {
    const p = _e3dPointAt(ev);
    if (p) { E3D.draw.cursor = { x: snapNorm(p.norm.x), y: snapNorm(p.norm.y) }; e3dSync(); }
  }
}

function _e3dOnUp(ev) {
  if (!E3D.press) return;
  const pr = E3D.press;
  E3D.press = null;
  const drag = E3D.drag;
  E3D.drag = null;
  if (threeState) threeState.controls.enabled = true;

  if (pr.moved) {
    // Перетаскивание закончено — досчитываем сцену набело.
    if (drag && typeof onParamChange === 'function') onParamChange();
    return;                                   // без объекта это было вращение камеры
  }

  if (pr.hit) {
    if (pr.hit.handle === 'rot') { _e3dRotate(pr.hit); return; }
    e3dSelect(pr.hit);
    // В линиях клик по точке ещё и начинает отрезок от неё — так соседний
    // отрезок приклеивается к существующей ломаной (ТЗ: «клик по существующей
    // точке — склейка»).
    if (E3D_KIND[E3D.sec] === 'line' && pr.hit.idx !== 'gate' && pr.np) _e3dDrawClick(pr.np);
    return;
  }
  // Клик по пустому месту: в линиях — рисуем, в остальных разделах — снимаем выбор.
  if (E3D_KIND[E3D.sec] === 'line' && pr.np) _e3dDrawClick(pr.np);
  else e3dSelect(null);
}

// Ручка поворота: шаг 90° (ТЗ). У грядки это обмен сторон, у мебели — угол rot.
function _e3dRotate(hit) {
  if (hit.kind === 'beds' && typeof rotateActiveBed === 'function') rotateActiveBed();
  else if (hit.kind === 'point' && typeof rotateActiveFurniture === 'function') rotateActiveFurniture(1);
  e3dSync();
  if (typeof onParamChange === 'function') onParamChange();
}

// Курсор-указатель над своим объектом — видно, что по нему можно кликнуть.
function _e3dOnHover(ev) {
  if (!E3D.sec || !threeState || E3D.press) return;
  const p = _e3dPointAt(ev);
  const hit = p ? e3dHitTest(p.norm) : null;
  threeState.renderer.domElement.style.cursor =
    hit ? (hit.handle === 'move' ? 'move' : 'pointer')
        : (E3D_KIND[E3D.sec] === 'line' ? 'crosshair' : '');
}

// Навешивается один раз на канвас рендерера (канвас переезжает между шагами
// целиком, вместе со слушателями).
function e3dAttach() {
  if (!threeState || !threeState.renderer || E3D.bound) return;
  const el = threeState.renderer.domElement;
  el.addEventListener('pointerdown', _e3dOnDown);
  window.addEventListener('pointermove', _e3dOnMove);
  window.addEventListener('pointerup', _e3dOnUp);
  el.addEventListener('pointermove', _e3dOnHover);
  window.addEventListener('keydown', _e3dOnKey);
  E3D.bound = true;
}

// Delete / Backspace — удалить выбранный объект (то же, что кнопка в панели).
// Esc — бросить начатый отрезок.
function _e3dOnKey(ev) {
  if (!E3D.sec || dStep !== 3) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (ev.key === 'Escape') {
    if (!E3D.draw) return;
    E3D.draw = null; ev.preventDefault(); e3dSync();
    return;
  }
  if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
  if (e3dSelectedIdx() === null) return;
  ev.preventDefault();
  if (typeof dDeleteSelected === 'function') dDeleteSelected();
}

// Смена активного раздела: сбрасываем начатый отрезок, перерисовываем слой.
function e3dSetSection(secId) {
  E3D.sec = (secId && E3D_KIND[secId]) ? secId : null;
  E3D.press = null;
  E3D.drag = null;
  E3D.draw = null;
  if (threeState) {
    threeState.controls.enabled = true;
    threeState.renderer.domElement.style.cursor = '';
  }
  e3dSync();
}

// Кадровый хук: подписи следуют за камерой. Вызывается из animate (см. _onAnimFrame).
function e3dOnFrame() { _e3dPlaceLabels(); }
