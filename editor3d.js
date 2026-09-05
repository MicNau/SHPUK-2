// ══════════════════════════════════════════════════════════════════════════
// editor3d.js — редактирование благоустройства ПРЯМО В 3D-СЦЕНЕ
//
// Версия 3D-UI: 2D-план убран, разметка и выбор объектов происходят в сцене.
// Модуль отвечает за «каркас» редактирования:
//   • перевод курсора в координаты плана (луч в сцену → мир → worldToCanvas);
//   • выбор объекта активного раздела кликом и снятие выбора кликом по пустому;
//   • подсветку выбранного объекта и маркеры точек;
//   • сетку 1 м на земле (снап при этом прежний, SNAP = 0.25 м);
//   • оверлей с размерами и площадями, пока раздел открыт.
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
  railing:      'line',
};

const E3D = {
  sec:   null,   // активный раздел («terrace», «paths», …) или null
  group: null,   // THREE.Group: сетка, подсветка, маркеры
  grid:  null,   // THREE.GridHelper — живёт внутри group
  press: null,   // {x, y, hit} — состояние между pointerdown и pointerup
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

// Что под курсором в АКТИВНОМ разделе? → {kind, idx} или null.
function e3dHitTest(np) {
  const sec = E3D.sec;
  if (!sec || !np) return null;
  const kind = E3D_KIND[sec];
  if (kind === 'rect') {
    const i = _e3dHitRects(secRects(sec), secActiveIdx(sec), np);
    return i === null ? null : { kind, idx: i };
  }
  if (kind === 'steps') {
    const i = _e3dHitRects(S.stepsList || [], S.activeSteps, np);
    return i === null ? null : { kind, idx: i };
  }
  if (kind === 'beds') {
    const i = _e3dHitRects(S.beds || [], S.activeBed, np);
    return i === null ? null : { kind, idx: i };
  }
  if (kind === 'point') {
    const i = _e3dHitPoints(S.furniture, np);
    return i === null ? null : { kind, idx: i };
  }
  if (kind === 'line') {
    const i = _e3dHitLine(sec, np);
    return i === null ? null : { kind, idx: i };
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

// Полная перерисовка слоя редактора: подсветка + маркеры + сетка + оверлей.
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
  } else if (kind === 'point') {
    (S.furniture || []).forEach((p, i) => {
      g.add(_e3dMarker(p, i === sel ? E3D_COL_SEL : E3D_COL_IDLE, 0.22));
    });
  } else if (kind === 'line') {
    const pts = S.pts[sec] || [];
    // Ломаная рвётся на сегменты по служебным точкам-разрывам.
    const segs = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts];
    for (const seg of segs) if (seg.length >= 2) g.add(_e3dOutline(seg, E3D_COL_IDLE, false));
    pts.forEach((p, i) => {
      if (p.break) return;
      g.add(_e3dMarker(p, i === sel ? E3D_COL_SEL : E3D_COL_IDLE, 0.16));
    });
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

// ── События ──────────────────────────────────────────────────────────────

function _e3dOnDown(ev) {
  if (ev.button !== 0 || !E3D.sec || !threeState) return;
  const p = _e3dPointAt(ev);
  const hit = p ? e3dHitTest(p.norm) : null;
  E3D.press = { x: ev.clientX, y: ev.clientY, hit, moved: false };
  // Попали в свой объект — орбиту на время жеста выключаем (в PR2 здесь начнётся
  // перетаскивание). Промах — орбита работает как обычно.
  if (hit) threeState.controls.enabled = false;
}

function _e3dOnMove(ev) {
  if (!E3D.press) return;
  if (Math.abs(ev.clientX - E3D.press.x) > E3D_MOVE_TOL
   || Math.abs(ev.clientY - E3D.press.y) > E3D_MOVE_TOL) E3D.press.moved = true;
}

function _e3dOnUp(ev) {
  if (!E3D.press) return;
  const pr = E3D.press;
  E3D.press = null;
  if (threeState) threeState.controls.enabled = true;
  if (pr.moved) return;                       // это было вращение/протяжка, не клик
  if (pr.hit) e3dSelect(pr.hit);              // выбрали объект
  else if (!pr.hitOutside) e3dSelect(null);   // клик по пустому — снять выбор
}

// Курсор-указатель над своим объектом — видно, что по нему можно кликнуть.
function _e3dOnHover(ev) {
  if (!E3D.sec || !threeState || E3D.press) return;
  const p = _e3dPointAt(ev);
  const hit = p ? e3dHitTest(p.norm) : null;
  threeState.renderer.domElement.style.cursor = hit ? 'pointer' : '';
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
function _e3dOnKey(ev) {
  if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
  if (!E3D.sec || dStep !== 3) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e3dSelectedIdx() === null) return;
  ev.preventDefault();
  if (typeof dDeleteSelected === 'function') dDeleteSelected();
}

// Смена активного раздела: сбрасываем выбор точки линии, перерисовываем слой.
function e3dSetSection(secId) {
  E3D.sec = (secId && E3D_KIND[secId]) ? secId : null;
  E3D.press = null;
  if (threeState) {
    threeState.controls.enabled = true;
    threeState.renderer.domElement.style.cursor = '';
  }
  e3dSync();
}

// Кадровый хук: подписи следуют за камерой. Вызывается из animate (см. _onAnimFrame).
function e3dOnFrame() { _e3dPlaceLabels(); }
