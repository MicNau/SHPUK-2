// CANVAS.JS — pan/zoom движок, snap-canvas, крыльцо
// Зависимости: state.js

// PAN/ZOOM ENGINE
// ══════════════════════════════════════════════
const CV = {};
// Шрифт подписей на canvas — тот же, что у интерфейса (см. body в styles-desktop.css).
const UI_FONT = "'Segoe UI', system-ui, Roboto, sans-serif";

// Кегль подписей на плане: все размеры и названия элементов вдвое крупнее прежнего
// (TODO.md, этап 1 п.3). Множитель вынесен в одну константу, чтобы кегль правился
// в одном месте; деление на масштаб оставляет подпись одного размера при зуме.
const PLAN_FONT_K = 2;
function planFont(px, sc, weight) {
  return `${weight ? weight + ' ' : ''}${px * PLAN_FONT_K / sc}px ${UI_FONT}`;
}

// ── Размеры настраиваемых элементов на плане ──
// По макету подписываются габариты: у площадных объектов (терраса, ступени,
// терраса у бассейна, причал) — стороны, у линейных (дорожки, забор,
// ограждение) — общая длина. Дом, грядки и мебель не подписываются.
const DIM_COL = '#f2722c';

// «12 м», «3.5 м» — дробная часть только когда она есть.
function _fmtM(m) {
  const r = Math.round(m * 10) / 10;
  return (Number.isInteger(r) ? r : r.toFixed(1)) + ' м';
}

function _dimLabel(ctx, cx, text, x, y, align, baseline) {
  ctx.fillStyle = DIM_COL;
  ctx.font = planFont(12, cx.scale);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
}

// Стороны прямоугольника: ширина под нижней кромкой, высота слева от левой.
// Координаты нормированные (0..1 поля плана), W — сторона поля в пикселях.
function drawRectDims(ctx, cx, W, nx, ny, nw, nh) {
  if (!(nw > 0) || !(nh > 0)) return;
  const pad = 8 / cx.scale;
  const x = nx * W, y = ny * W, w = nw * W, h = nh * W;
  _dimLabel(ctx, cx, _fmtM(nw * GRID), x + w / 2, y + h + pad, 'center', 'top');
  _dimLabel(ctx, cx, _fmtM(nh * GRID), x - pad, y + h / 2, 'right', 'middle');
}

// Общая длина ломаных: подпись у середины самого длинного отрезка, сдвинутая
// по нормали — так она не ложится на саму линию.
function drawPolylineDims(ctx, cx, W, segments) {
  let total = 0, best = null, bestLen = -1;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const dx = (seg[i].x - seg[i-1].x) * GRID, dy = (seg[i].y - seg[i-1].y) * GRID;
      const len = Math.hypot(dx, dy);
      total += len;
      if (len > bestLen) { bestLen = len; best = [seg[i-1], seg[i]]; }
    }
  }
  if (!best || total <= 0) return;
  const mx = (best[0].x + best[1].x) / 2 * W, my = (best[0].y + best[1].y) / 2 * W;
  const dx = best[1].x - best[0].x, dy = best[1].y - best[0].y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 14 / cx.scale;
  _dimLabel(ctx, cx, _fmtM(total), mx - dy / len * off, my + dx / len * off, 'center', 'middle');
}
const GRID = 32;       // total meters (canvas area)
const SNAP = 0.25;     // шаг КУРСОРА (снап), м
const GRID_STEP = 0.5; // шаг РАЗМЕТКИ (точки сетки), м — крупнее снапа, специально
const CELLS = GRID / GRID_STEP; // 64 точки разметки на сторону
// Порог прилипания кромок/точек к стенам дома и соседним rect'ам, м.
// ВАЖНО: grid-снап применяется ДО wall-снапа, поэтому эффективный радиус захвата
// ≈ порог + полшага снапа. С прежним 1.0 м захват начинался за ~1.5 м от стены —
// слишком рано; 0.5 м даёт захват с ~0.6 м (при шаге курсора 0.25 м).
const EDGE_SNAP_DIST = 0.5;

function mkCvState() {
  return { scale:1, ox:0, oy:0, minScale:0.5, maxScale:4,
           dragging:false, lastX:0, lastY:0, pinching:false, lastDist:0 };
}

function applyTransform(ctx, cx, W, H) {
  // Чистим ВЕСЬ канвас, а не поле плана: канвас шире поля (см. fitCanvasToWrap),
  // и при панорамировании за пределами квадрата оставались бы следы.
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.save();
  ctx.translate(cx.ox, cx.oy); ctx.scale(cx.scale, cx.scale);
}

// ── Поле плана внутри полноразмерного канваса ──────────────────────────────
// Канвас редактора занимает всю область (как 3D-вид), а сам план — квадрат
// GRID×GRID м. planPx() — сторона этого квадрата в пикселях канваса; вся
// математика рисования и попадания курсора работает в этих пикселях.
function planPx(cvEl) { return Math.min(cvEl.width, cvEl.height); }

// Растягивает канвас по контейнеру и центрирует поле плана. Смещение кладём
// прямо в ox/oy pan-состояния — тогда остальной код (и рисование, и hit-тест,
// который уже вычитает ox/oy) не меняется.
function fitCanvasToWrap(wrap, cv, cvState) {
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth || wrap.offsetWidth, h = wrap.clientHeight || wrap.offsetHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const P = planPx(cv);
  cvState.ox = (cv.width - P) / 2;
  cvState.oy = (cv.height - P) / 2;
  return P;
}

// Перемещение плана ПРАВОЙ кнопкой мыши (pan) — как в 3D-виде (ПКМ = перемещение).
// Левая кнопка остаётся за инструментами редактора (точки, перетаскивание блоков).
// Вешается один раз на wrap каждого редактора; состояние CV[cvName] читается свежим.
function attachMousePan(el, cvName, onRedraw) {
  let panning = false, lastX = 0, lastY = 0, prevCursor = '';
  el.addEventListener('contextmenu', e => e.preventDefault());   // без меню по ПКМ
  el.addEventListener('mousedown', e => {
    if (e.button !== 2 || !CV[cvName]) return;
    panning = true; lastX = e.clientX; lastY = e.clientY;
    prevCursor = el.style.cursor; el.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    const cx = CV[cvName];
    if (!panning || !cx) return;
    const dpr = window.devicePixelRatio || 1;
    cx.ox += (e.clientX - lastX) * dpr;
    cx.oy += (e.clientY - lastY) * dpr;
    lastX = e.clientX; lastY = e.clientY;
    onRedraw();
  });
  document.addEventListener('mouseup', e => {
    if (!panning || e.button !== 2) return;
    panning = false; el.style.cursor = prevCursor;
  });
}

function attachPanZoom(el, cvName, onRedraw) {
  attachMousePan(el, cvName, onRedraw);   // ПКМ-перемещение для всех snap-редакторов
  // CV[cvName] читаем СВЕЖИМ в каждом обработчике: initSnapCanvas пересоздаёт
  // состояние (mkCvState) при каждом открытии редактора, а слушатели живут на el
  // постоянно — захваченная в замыкании ссылка устаревала бы после переоткрытия.
  el.addEventListener('touchstart', e=>{
    const cx = CV[cvName]; if (!cx) return;
    if (e.touches.length===2) {
      cx.pinching=true; cx.dragging=false;
      cx.lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                              e.touches[0].clientY-e.touches[1].clientY);
    } else if (e.touches.length===1 && !cx.pinching) {
      cx.dragging=true; cx.lastX=e.touches[0].clientX; cx.lastY=e.touches[0].clientY;
    }
  },{passive:true});
  el.addEventListener('touchmove', e=>{
    const cx = CV[cvName]; if (!cx) return;
    if (cx.pinching && e.touches.length===2) {
      const dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                             e.touches[0].clientY-e.touches[1].clientY);
      const ratio=dist/cx.lastDist; cx.lastDist=dist;
      const mid={ x:(e.touches[0].clientX+e.touches[1].clientX)/2,
                  y:(e.touches[0].clientY+e.touches[1].clientY)/2 };
      const r=el.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
      const mx=(mid.x-r.left)*dpr, my=(mid.y-r.top)*dpr;
      const ns=Math.min(cx.maxScale,Math.max(cx.minScale,cx.scale*ratio));
      cx.ox=mx-(mx-cx.ox)*(ns/cx.scale); cx.oy=my-(my-cx.oy)*(ns/cx.scale); cx.scale=ns;
      onRedraw();
    } else if (cx.dragging && e.touches.length===1 && !cx.pinching) {
      const dpr=window.devicePixelRatio||1;
      cx.ox+=(e.touches[0].clientX-cx.lastX)*dpr;
      cx.oy+=(e.touches[0].clientY-cx.lastY)*dpr;
      cx.lastX=e.touches[0].clientX; cx.lastY=e.touches[0].clientY;
      onRedraw();
    }
    e.preventDefault();
  },{passive:false});
  el.addEventListener('touchend', e=>{
    const cx = CV[cvName]; if (!cx) return;
    if (e.touches.length<2) cx.pinching=false;
    if (e.touches.length===0) cx.dragging=false;
  },{passive:true});
  el.addEventListener('wheel', e=>{
    e.preventDefault();
    const cx = CV[cvName]; if (!cx) return;
    const r=el.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    const mx=(e.clientX-r.left)*dpr, my=(e.clientY-r.top)*dpr;
    const f=e.deltaY<0?1.15:0.87;
    const ns=Math.min(cx.maxScale,Math.max(cx.minScale,cx.scale*f));
    cx.ox=mx-(mx-cx.ox)*(ns/cx.scale); cx.oy=my-(my-cx.oy)*(ns/cx.scale); cx.scale=ns;
    onRedraw();
  },{passive:false});
}

// ══════════════════════════════════════════════
// SNAP-CANVAS (дорожки, забор, ограждение — разметка точками)
// ══════════════════════════════════════════════
function initSnapCanvas(name) {
  const wrap=document.getElementById('cw-'+name);
  const cv=document.getElementById('cv-'+name);
  CV[name] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV[name]);

  // Дорожки и забор: при первом заходе линия уже нарисована (TODO.md, этап 2 пп.7-8).
  if (name === 'paths' || name === 'fence') _lineEnsureDefault(name);
  drawSnapCanvas(name);

  // Слушатели (pan/zoom + click) вешаются на wrap ОДИН РАЗ. Раньше initSnapCanvas
  // добавлял их при КАЖДОМ открытии редактора → после N открытий один клик ставил
  // N точек (клонирование canvas не помогало — слушатели живут на wrap, не на canvas).
  // Обработчики читают CV[name] свежим, поэтому переинициализация состояния им не мешает.
  if (wrap._snapBound) return;
  wrap._snapBound = true;

  attachPanZoom(wrap, name, ()=>drawSnapCanvas(name));

  // Клик — добавить точку с snap (0.5m step + прилипание к стенам дома)
  wrap.addEventListener('click', e=>{
    if (CV[name].pinching) return;
    // Клик, завершивший перетаскивание или попавший в существующую точку, новую
    // точку не ставит — иначе выбор точки сразу дублировал бы её.
    if (_lineDragged) { _lineDragged = false; return; }
    if ((name === 'paths' || name === 'fence')
        && _lineHitPoint(name, _snapPointerNorm(wrap, name, e)) !== null) return;
    const cvEl=document.getElementById('cv-'+name); if (!cvEl) return;
    const r=wrap.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    const sx=(e.clientX-r.left)*dpr, sy=(e.clientY-r.top)*dpr;
    const cx=CV[name];
    const wx=(sx-cx.ox)/cx.scale, wy=(sy-cx.oy)/cx.scale;
    const W = planPx(cvEl), snapStep = W * SNAP / GRID;
    let snX=Math.round(wx/snapStep)*snapStep/W, snY=Math.round(wy/snapStep)*snapStep/W;

    // (Прилипание к стенам дома здесь больше не нужно: все три террасы —
    // терраса/крыльцо, терраса у бассейна и причал — редактируются
    // прямоугольниками, у них свой снап в snapDraggedRect.)

    // Ограждение: прилипание к стенам дома и кромкам террасы, но НЕ вплотную —
    // с отступом на полсечения столба (RAIL_INSET, тот же, что у автоматических
    // перил по контуру). Иначе столб влезал бы в стену или свисал за край настила.
    if (name === 'railing') {
      const off = ((typeof RAIL_INSET !== 'undefined') ? RAIL_INSET : 0.10) / GRID;
      const thr = EDGE_SNAP_DIST / GRID;
      // Кромки настила и стены дома дают кандидатов ОТДЕЛЬНО: там, где край террасы
      // совпадает со стеной (терраса пристроена к дому), у стены есть кандидат «наружу
      // от дома», который может увести точку с настила. Поэтому сначала кромки террасы
      // и только если по ним промах — стены.
      const terrX = [], terrY = [], wallX = [], wallY = [];
      for (const r of (S.terraceRects || [])) {   // от кромки настила — внутрь блока
        if (!r || r.w <= 0 || r.h <= 0) continue;
        terrX.push(r.x + off, r.x + r.w - off);
        terrY.push(r.y + off, r.y + r.h - off);
      }
      if (!isEmptyLot()) {
        const hp = getHousePolygonNorm();
        const hx = hp.bboxNorm.nx + hp.bboxNorm.nw / 2;
        const hy = hp.bboxNorm.ny + hp.bboxNorm.nh / 2;
        for (const e of hp.edges) {          // от стены — наружу от дома
          if (e.axis === 'v')      wallX.push(e.coord + (e.coord < hx ? -off : off));
          else if (e.axis === 'h') wallY.push(e.coord + (e.coord < hy ? -off : off));
        }
      }
      const nearest = (v, list) => {
        let best = null, bd = thr;
        for (const c of list) { const d = Math.abs(v - c); if (d < bd) { best = c; bd = d; } }
        return best;
      };
      const nx2 = nearest(snX, terrX); snX = (nx2 !== null) ? nx2 : (nearest(snX, wallX) ?? snX);
      const ny2 = nearest(snY, terrY); snY = (ny2 !== null) ? ny2 : (nearest(snY, wallY) ?? snY);
    }

    // Забор нельзя ставить ближе FENCE_MIN_CLEAR к дому и террасе (TODO.md, этап 2 п.10).
    if (name === 'fence' && _fenceTooClose({ x: snX, y: snY })) {
      if (typeof dToast === 'function') dToast('Забор нельзя ставить ближе 3 м от дома и террасы');
      return;
    }
    S.pts[name].push({ x:snX, y:snY });
    drawSnapCanvas(name);
    if (typeof onParamChange === 'function') onParamChange();
  });

  // Выбор и перетаскивание точки (TODO.md, этап 2 пп.7-8). Клик по пустому месту
  // по-прежнему добавляет точку — обработчик выше; чтобы он не срабатывал после
  // перетаскивания, ставим флаг _lineDragged (клик приходит после mouseup).
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const p = _snapPointerNorm(wrap, name, e);
    const idx = _lineHitPoint(name, p);
    if (idx === null) return;
    _lineSel = { name, idx };
    _lineDrag = true;
    _lineDragged = false;
    drawSnapCanvas(name);
    e.preventDefault();
  });

  wrap.addEventListener('mousemove', e => {
    if (!_lineDrag || _lineSel.name !== name) return;
    const p = _snapPointerNorm(wrap, name, e, true);
    if (name === 'fence' && _fenceTooClose(p)) return;   // ближе 3 м не пускаем
    const pt = S.pts[name][_lineSel.idx];
    if (!pt || pt.break) return;
    pt.x = p.x; pt.y = p.y;
    _lineDragged = true;
    drawSnapCanvas(name);
  });

  const endDrag = () => {
    if (!_lineDrag) return;
    _lineDrag = false;
    if (_lineDragged && typeof onParamChange === 'function') onParamChange();
  };
  wrap.addEventListener('mouseup', endDrag);
  wrap.addEventListener('mouseleave', endDrag);
}

// ══════════════════════════════════════════════
// ЛОМАНЫЕ: дорожки и забор (TODO.md, этап 2 пп.7, 8, 10)
// Точка выбирается кликом, перетаскивается мышью и удаляется кнопкой; при первом
// заходе в раздел линия уже нарисована (участок 3 м перед фасадом).
// ══════════════════════════════════════════════
let _lineSel = { name: null, idx: null };   // выбранная точка
let _lineDrag = false;                      // идёт перетаскивание
let _lineDragged = false;                   // точка реально сдвинулась (гасит клик)

const LINE_START_LEN = 3.0;    // длина стартового участка, м
const FENCE_MIN_CLEAR = 3.0;   // минимальное расстояние забора до дома и террасы, м
const FENCE_GATE_W = 1.0;      // ширина проёма под калитку, м

// Указатель → нормированные координаты плана (со снапом, если snap=true).
function _snapPointerNorm(wrap, name, e, snap) {
  const cvEl = document.getElementById('cv-' + name);
  const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const cx = CV[name] || { scale: 1, ox: 0, oy: 0 };
  const wx = ((e.clientX - r.left) * dpr - cx.ox) / cx.scale;
  const wy = ((e.clientY - r.top) * dpr - cx.oy) / cx.scale;
  const W = planPx(cvEl);
  if (!snap) return { x: wx / W, y: wy / W };
  const step = W * SNAP / GRID;
  return { x: Math.round(wx / step) * step / W, y: Math.round(wy / step) * step / W };
}

// Индекс точки ломаной под указателем или null.
function _lineHitPoint(name, p) {
  const pts = S.pts[name] || [];
  const hit = 10 / GRID;                      // ~10 см в координатах плана… (в норме)
  let best = 0.02, idx = null;                 // порог в долях плана
  pts.forEach((q, i) => {
    if (q.break) return;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

// Ближе FENCE_MIN_CLEAR к дому или террасе? (нормированные координаты плана)
function _fenceTooClose(p) {
  const lim = FENCE_MIN_CLEAR / GRID;
  // Дом
  if (typeof isEmptyLot !== 'function' || !isEmptyLot()) {
    const hp = getHousePolygonNorm();
    if (hp && hp.corners && hp.corners.length >= 3) {
      for (let i = 0; i < hp.corners.length; i++) {
        const a = hp.corners[i], b = hp.corners[(i + 1) % hp.corners.length];
        if (_planDistToSeg(p, a, b) < lim) return true;
      }
    }
  }
  // Террасы (пристроенная и у бассейна)
  for (const sec of ['terrace', 'pool_terrace']) {
    for (const r of (typeof secRects === 'function' ? secRects(sec) : [])) {
      if (!r || r.w <= 0 || r.h <= 0) continue;
      const c = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
                 { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
      for (let i = 0; i < 4; i++) if (_planDistToSeg(p, c[i], c[(i + 1) % 4]) < lim) return true;
    }
  }
  return false;
}

function _planDistToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// Стартовый участок 3 м перед фасадом. У забора он отодвинут на FENCE_MIN_CLEAR
// от дома и террасы (иначе первая же линия нарушала бы правило).
function _defaultLine(name) {
  const hp = getHousePolygonNorm();
  const b = (hp && hp.bboxNorm) ? hp.bboxNorm : { nx: 0.4, ny: 0.4, nw: 0.2, nh: 0.2 };
  let y = b.ny + b.nh + 1.0 / GRID;            // метр от фасада
  if (name === 'fence') {
    y = b.ny + b.nh + (FENCE_MIN_CLEAR + 0.5) / GRID;
    // Ниже террасы, если она выступает дальше дома.
    for (const r of (typeof secRects === 'function' ? secRects('terrace') : [])) {
      if (r && r.h > 0) y = Math.max(y, r.y + r.h + (FENCE_MIN_CLEAR + 0.5) / GRID);
    }
  }
  const cx = b.nx + b.nw / 2, half = LINE_START_LEN / 2 / GRID;
  return [{ x: cx - half, y }, { x: cx + half, y }];
}

// Разметка раздела при первом заходе: пусто → стартовый участок.
function _lineEnsureDefault(name) {
  if (!S.pts[name] || !S.pts[name].filter(p => !p.break).length) {
    S.pts[name] = _defaultLine(name);
    _lineSel = { name, idx: null };
  }
}

// Калитка: ставится в середину самого длинного отрезка забора (или в выбранную
// точку, если она есть). Хранится в координатах плана; проём вычитается в 3D.
function fenceGateDefault() {
  const segs = splitAtBreaks(S.pts.fence || []);
  let best = null, bestL = 0;
  for (const seg of segs) {
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i], b = seg[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y) * GRID;
      if (L > bestL) { bestL = L; best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    }
  }
  return (bestL > FENCE_GATE_W + 0.4) ? best : null;
}

// «Удалить точку» — убирает выбранную. Линия короче двух точек удаляется целиком.
function delLinePoint(name) {
  const pts = S.pts[name] || [];
  const idx = (_lineSel.name === name) ? _lineSel.idx : null;
  if (idx === null || !pts[idx]) {
    if (typeof dToast === 'function') dToast('Сначала выберите точку на плане');
    return;
  }
  pts.splice(idx, 1);
  // Осиротевшие маркеры разрыва убираем, чтобы не осталось пустых линий.
  for (let i = pts.length - 1; i >= 0; i--) {
    const prev = pts[i - 1], next = pts[i + 1];
    if (pts[i].break && (!prev || prev.break || !next || next.break)) pts.splice(i, 1);
  }
  _lineSel = { name, idx: null };
  drawSnapCanvas(name);
  if (typeof onParamChange === 'function') onParamChange();
}

// Вычислить прямоугольник дома на canvas в нормализованных координатах 0..1
// На основе реальных параметров площади. Canvas = GRID×GRID м сетка.
// Fallback (если дескриптор ещё не загружен или HouseBuilder недоступен).
function getHouseRectNorm() {
  const area = parseFloat(document.getElementById('v-area')?.value || 120);
  const RATIO = 1.6;
  const houseW = Math.sqrt(area / RATIO); // ширина (по Z / по Y canvas)
  const houseL = houseW * RATIO;          // длина (по X)
  const gridSize = GRID;
  // Центрируем дом на canvas
  const nx = (gridSize - houseL) / 2 / gridSize;
  const ny = (gridSize - houseW) / 2 / gridSize;
  const nw = houseL / gridSize;
  const nh = houseW / gridSize;
  return { nx, ny, nw, nh, houseL, houseW };
}

// Вычислить полигон дома в нормализованных координатах canvas 0..1.
// Если дескриптор загружен (через ensureHouseLoaded в viewer3d-core.js),
// возвращает реальный outline (для крестообразных, T-образных, L-образных и пр. форм).
// Иначе fallback — прямоугольник по площади.
// Возвращает: { corners: [{x, y}], bboxNorm: {nx, ny, nw, nh}, lenL, lenW, edges: [{x1,y1,x2,y2,axis,coord}] }
//   axis: 'h' (горизонтальное ребро, snap по Y) или 'v' (вертикальное, snap по X)
//   coord: координата ребра по неподвижной оси (нормализованная)
function getHousePolygonNorm() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  const haveBuilder = (typeof HouseBuilder !== 'undefined' && typeof HouseBuilder.getHouseFloorPolygon === 'function');

  if (desc && haveBuilder) {
    const area = parseFloat(document.getElementById('v-area')?.value || 120);
    const poly = HouseBuilder.getHouseFloorPolygon(desc, { area });
    if (poly && poly.corners && poly.corners.length >= 3) {
      const b = poly.bbox;
      const lenL = b.maxX - b.minX;
      const lenW = b.maxZ - b.minZ;
      // Центрируем по bbox в canvas-сетке
      const cx = (GRID - lenL) / 2;
      const cy = (GRID - lenW) / 2;
      const corners = poly.corners.map(c => ({
        x: (cx + (c.x - b.minX)) / GRID,
        y: (cy + (c.z - b.minZ)) / GRID,
      }));
      const bboxNorm = { nx: cx / GRID, ny: cy / GRID, nw: lenL / GRID, nh: lenW / GRID };
      // Рёбра для прилипания (только ortho — все рёбра либо горизонтальные, либо вертикальные)
      const edges = [];
      for (let i = 0; i < corners.length; i++) {
        const p1 = corners[i], p2 = corners[(i + 1) % corners.length];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        if (Math.abs(dy) < 1e-6) {
          // горизонтальное ребро (constant y)
          edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, axis: 'h', coord: p1.y });
        } else if (Math.abs(dx) < 1e-6) {
          edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, axis: 'v', coord: p1.x });
        }
      }
      return { corners, bboxNorm, lenL, lenW, edges, isPolygon: true };
    }
  }
  // Fallback — прямоугольник
  const r = getHouseRectNorm();
  const corners = [
    { x: r.nx,         y: r.ny         },
    { x: r.nx + r.nw,  y: r.ny         },
    { x: r.nx + r.nw,  y: r.ny + r.nh  },
    { x: r.nx,         y: r.ny + r.nh  },
  ];
  const edges = [
    { x1: r.nx, y1: r.ny, x2: r.nx+r.nw, y2: r.ny,       axis: 'h', coord: r.ny       },
    { x1: r.nx+r.nw, y1: r.ny, x2: r.nx+r.nw, y2: r.ny+r.nh, axis: 'v', coord: r.nx+r.nw },
    { x1: r.nx+r.nw, y1: r.ny+r.nh, x2: r.nx, y2: r.ny+r.nh, axis: 'h', coord: r.ny+r.nh },
    { x1: r.nx, y1: r.ny+r.nh, x2: r.nx, y2: r.ny,       axis: 'v', coord: r.nx       },
  ];
  return {
    corners,
    bboxNorm: { nx: r.nx, ny: r.ny, nw: r.nw, nh: r.nh },
    lenL: r.houseL, lenW: r.houseW, edges, isPolygon: false,
  };
}

// ══════════════════════════════════════════════
// ПЛАН ДОМА: раскладка фасада (окна/двери/сегменты стен)
// Раскладка — HouseBuilder.getHouseFacadeLayout (этаж 1): те же fills и segId,
// что кладёт buildEdgeWall при 3D-сборке → выбор сегмента на плане и в 3D
// работает с одним S.wallZones. Кэш по (desc, area) — пересчёт только при смене.
// ══════════════════════════════════════════════
let _hwtCache = null;   // { desc, key, T }

function _houseWorldTransform() {
  const desc = (typeof _houseCache !== 'undefined' && _houseCache.desc) ? _houseCache.desc : null;
  if (!desc || typeof HouseBuilder === 'undefined' || !HouseBuilder.getHouseFacadeLayout) return null;
  // Полные параметры (включая высоту этажа — от неё зависит, есть ли у проёма
  // стена над окном, т.е. выбираемая оконная колонка).
  const params = (typeof dCollectParams === 'function') ? dCollectParams()
               : { area: parseFloat(document.getElementById('v-area')?.value || 80) };
  const key = `${params.area}|${(params.floorHs && params.floorHs[0]) || params.floorH || ''}`;
  if (_hwtCache && _hwtCache.desc === desc && _hwtCache.key === key) return _hwtCache.T;
  const layout = HouseBuilder.getHouseFacadeLayout(desc, params);
  if (!layout) return null;
  // Центрирование bbox в сетке GRID — как в getHousePolygonNorm (общая система).
  const b = layout.bbox;
  const offX = (GRID - (b.maxX - b.minX)) / 2 - b.minX;
  const offZ = (GRID - (b.maxZ - b.minZ)) / 2 - b.minZ;
  const T = {
    layout,
    toNorm:  (x, z)   => ({ x: (x + offX) / GRID, y: (z + offZ) / GRID }),
    toWorld: (nx, ny) => ({ x: nx * GRID - offX,  z: ny * GRID - offZ  }),
  };
  _hwtCache = { desc, key, T };
  return T;
}

// Точка (норм.) внутри полигона дома? — для стороны открывания двери на плане.
function _normPtInHouse(nx, ny) {
  const c = getHousePolygonNorm().corners;
  let inside = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    if ((c[i].y > ny) !== (c[j].y > ny)
        && nx < (c[j].x - c[i].x) * (ny - c[i].y) / (c[j].y - c[i].y + 1e-12) + c[i].x) inside = !inside;
  }
  return inside;
}

// Окна и двери на плане дома (условные обозначения: окно — тонкая линия в проёме,
// дверь — проём со створкой и дугой открывания внутрь). Рисуется поверх контура.
function _drawHouseOpenings(ctx, W, H, sc) {
  const T = _houseWorldTransform();
  if (!T) return;
  const gapW = Math.max((T.layout.wt || 0.2) / GRID * W * 2.2, 5 / sc);
  for (const e of T.layout.edges) {
    for (const it of e.items) {
      if (it.type === 'wall') continue;
      const aN = T.toNorm(e.x + e.dx * it.start,              e.z + e.dz * it.start);
      const bN = T.toNorm(e.x + e.dx * (it.start + it.width), e.z + e.dz * (it.start + it.width));
      const ax = aN.x * W, ay = aN.y * H, bx = bN.x * W, by = bN.y * H;
      // Проём: разрыв контурной линии стены (фоновым цветом).
      ctx.strokeStyle = '#fff'; ctx.lineWidth = gapW; ctx.lineCap = 'butt';   // цвет поля плана
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (it.type === 'window') {
        // Остекление — тонкая синяя линия в проёме.
        ctx.strokeStyle = '#3d7dc4'; ctx.lineWidth = 1.6 / sc;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      } else {
        // Дверь: створка от петли (a) перпендикулярно внутрь + пунктирная дуга к (b).
        const len = Math.hypot(bx - ax, by - ay); if (len < 1e-3) continue;
        let nxv = -(by - ay) / len, nyv = (bx - ax) / len;
        const off = 0.5 / GRID;   // проба на 0.5 м по нормали (canvas квадратный: W==H)
        if (!_normPtInHouse((aN.x + bN.x) / 2 + nxv * off, (aN.y + bN.y) / 2 + nyv * off)) {
          nxv = -nxv; nyv = -nyv;
        }
        const lx = ax + nxv * len, ly = ay + nyv * len;
        ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.6 / sc;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke();
        const a0 = Math.atan2(ly - ay, lx - ax), a1 = Math.atan2(by - ay, bx - ax);
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        ctx.setLineDash([3 / sc, 3 / sc]);
        ctx.beginPath(); ctx.arc(ax, ay, len, a0, a1, d < 0); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// Рисование ранее заданных объектов как фон на canvas-шагах
// excludeName — текущая секция (не рисуем её повторно, она рисуется как основной слой)
function drawPreviousLayers(ctx, W, H, cx, excludeName) {
  const sc = cx.scale || 1;

  // 1. Дом — полигон по реальному outline дескриптора (или fallback-прямоугольник)
  if (!isEmptyLot()) {
    const hp = getHousePolygonNorm();
    const bx = hp.bboxNorm.nx * W;
    const by = hp.bboxNorm.ny * H;
    const bw = hp.bboxNorm.nw * W;
    const bh = hp.bboxNorm.nh * H;
    // Путь по углам полигона
    ctx.beginPath();
    for (let i = 0; i < hp.corners.length; i++) {
      const c = hp.corners[i];
      const px = c.x * W, py = c.y * H;
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.closePath();
    // Заливка
    ctx.fillStyle='rgba(0,0,0,.06)'; ctx.fill();
    // Контур
    ctx.strokeStyle='#555'; ctx.lineWidth=2.5/sc; ctx.setLineDash([]); ctx.stroke();
    // Штриховка (клипом по тому же пути)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < hp.corners.length; i++) {
      const c = hp.corners[i];
      const px = c.x * W, py = c.y * H;
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle='rgba(0,0,0,.08)'; ctx.lineWidth=1/sc;
    for (let d = -Math.max(bw,bh); d < Math.max(bw,bh)*2; d += 8/sc) {
      ctx.beginPath(); ctx.moveTo(bx+d, by); ctx.lineTo(bx+d-bh, by+bh); ctx.stroke();
    }
    ctx.restore();
    // Окна и двери (условные обозначения) — «внятный план» во всех редакторах.
    _drawHouseOpenings(ctx, W, H, sc);
    // Подпись и габариты по bbox
    ctx.fillStyle='#666'; ctx.font=planFont(13, sc, 'bold'); ctx.textAlign='center';
    ctx.fillText('ДОМ', bx+bw/2, by+bh/2+5/sc);
    ctx.fillStyle='#888'; ctx.font=planFont(10, sc);
    ctx.fillText(hp.lenL.toFixed(1)+'м', bx+bw/2, by-6/sc);
    ctx.save(); ctx.translate(bx-6/sc, by+bh/2);
    ctx.rotate(-Math.PI/2); ctx.textAlign='center';
    ctx.fillText(hp.lenW.toFixed(1)+'м', 0, 0); ctx.restore();
  }

  // Цвета для фоновых слоёв
  const layerStyles = {
    fence:        { fill:'none',                stroke:'rgba(0,0,0,.3)',     label:'Забор' },
    railing:      { fill:'none',                stroke:'rgba(122,75,35,.5)', label:'Ограждение' },
  };

  // Ступени — один rect (фон, если редактируем другую секцию)
  if (excludeName !== 'steps' && S.sections.includes('steps') && S.steps) {
    const s = S.steps;
    const rx = s.x * W, ry = s.y * H, rw = s.w * W, rh = s.h * H;
    ctx.fillStyle = 'rgba(220,140,0,.14)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(204,102,0,.5)'; ctx.lineWidth = 2/sc;
    ctx.setLineDash([4/sc, 2/sc]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(204,102,0,.6)';
    ctx.font = planFont(10, sc); ctx.textAlign = 'center';
    ctx.fillText('Ступени', rx+rw/2, ry+rh/2+4/sc);
  }

  // Прямоугольные секции (терраса/крыльцо, терраса у бассейна, причал) — фоном,
  // если редактируем другую секцию. Цвет и подпись — из RECT_SECTIONS.
  for (const [secId, cfg] of Object.entries(RECT_SECTIONS)) {
    if (secId === excludeName) continue;
    // Только секции, оставшиеся в проекте: после отмены редактора (dCancelCanvas)
    // прямоугольники в состоянии остаются, но объекта в проекте уже нет.
    if (!S.sections.includes(secId)) continue;
    const rects = secRects(secId);
    if (!rects.length) continue;
    ctx.fillStyle = cfg.fill;
    ctx.strokeStyle = cfg.bgStroke;
    ctx.lineWidth = 2/sc; ctx.setLineDash([6/sc, 3/sc]);
    for (const r of rects) {
      const rx = r.x * W, ry = r.y * H, rw = r.w * W, rh = r.h * H;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.setLineDash([]);
    // Подпись по центру bbox
    let bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
    for (const r of rects) {
      if (r.x < bx0) bx0 = r.x; if (r.y < by0) by0 = r.y;
      if (r.x+r.w > bx1) bx1 = r.x+r.w; if (r.y+r.h > by1) by1 = r.y+r.h;
    }
    ctx.fillStyle = cfg.bgStroke;
    ctx.font = planFont(10, sc); ctx.textAlign = 'center';
    ctx.fillText(cfg.short, (bx0+bx1)/2*W, (by0+by1)/2*H);
  }

  // Грядки — массив rect'ов фиксированного размера (фон, если редактируем другую секцию)
  if (excludeName !== 'beds' && S.beds && S.beds.length) {
    for (const b of S.beds) {
      const rx = b.x * W, ry = b.y * H, rw = b.w * W, rh = b.h * H;
      ctx.fillStyle = 'rgba(120,75,35,.16)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(120,75,35,.55)'; ctx.lineWidth = 2/sc;
      ctx.setLineDash([5/sc, 3/sc]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    }
    const b0 = S.beds[0];
    ctx.fillStyle = 'rgba(120,75,35,.7)';
    ctx.font = planFont(10, sc); ctx.textAlign = 'center';
    ctx.fillText('Грядки', (b0.x + b0.w/2)*W, (b0.y + b0.h/2)*H + 4/sc);
  }

  // 2. Ломаные: забор и ограждение террасы
  for (const [secId, style] of Object.entries(layerStyles)) {
    if (secId === excludeName) continue;
    const tp = S.pts[secId];
    if (!tp || tp.length < 2) continue;
    const realPts = tp.filter(p=>!p.break);
    if (realPts.length < 2) continue;

    if (secId === 'fence' || secId === 'railing') {
      // Забор и ограждение террасы — ломаные из нескольких линий (разделены break).
      // Раньше ограждение попадало в ветку полигонов: контур замыкался и разрывы
      // игнорировались, поэтому на плане (в том числе в редакторе ступеней, где
      // ограждение нужно видеть) оно рисовалось неверно.
      const segs = splitAtBreaks(tp);
      for (const seg of segs) {
        if (seg.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(seg[0].x*W, seg[0].y*H);
        for (let i=1;i<seg.length;i++) ctx.lineTo(seg[i].x*W, seg[i].y*H);
        ctx.strokeStyle=style.stroke; ctx.lineWidth=2/sc;
        ctx.setLineDash([6/sc,3/sc]); ctx.stroke(); ctx.setLineDash([]);
      }
    } else {
      ctx.beginPath(); ctx.moveTo(realPts[0].x*W, realPts[0].y*H);
      for (let i=1; i<realPts.length; i++) ctx.lineTo(realPts[i].x*W, realPts[i].y*H);
      if (realPts.length > 2) ctx.closePath();
      if (style.fill !== 'none') { ctx.fillStyle=style.fill; ctx.fill(); }
      ctx.strokeStyle=style.stroke; ctx.lineWidth=2/sc;
      ctx.setLineDash([6/sc,3/sc]); ctx.stroke(); ctx.setLineDash([]);
    }
    // Подпись
    const centX = realPts.reduce((s,p)=>s+p.x,0)/realPts.length*W;
    const centY = realPts.reduce((s,p)=>s+p.y,0)/realPts.length*H;
    ctx.fillStyle=style.stroke; ctx.font=planFont(10, sc); ctx.textAlign='center';
    ctx.fillText(style.label, centX, centY);
  }

  // 3. Дорожки — рисуем как полосу указанной ширины (несколько линий)
  if (excludeName !== 'paths') {
    const pp = S.pts.paths;
    if (pp && pp.length >= 2) {
      const pathHalfW = ((S.pathWidth || 120) / 100) / GRID * W / 2;
      const segs = splitAtBreaks(pp);
      for (const seg of segs) {
        if (seg.length < 2) continue;
        ctx.strokeStyle='rgba(51,102,0,.3)'; ctx.lineWidth=pathHalfW*2; ctx.lineCap='butt'; ctx.lineJoin='miter';
        ctx.beginPath(); ctx.moveTo(seg[0].x*W, seg[0].y*H);
        for (let i=1; i<seg.length; i++) ctx.lineTo(seg[i].x*W, seg[i].y*H);
        ctx.stroke();
      }
      ctx.lineWidth=2/sc;
      const realPts = pp.filter(p=>!p.break);
      if (realPts.length) {
        const mid = realPts[Math.floor(realPts.length/2)];
        ctx.fillStyle='rgba(51,102,0,.6)'; ctx.font=planFont(10, sc); ctx.textAlign='center';
        ctx.fillText('Дорожка', mid.x*W, mid.y*H - pathHalfW - 4/sc);
      }
    }
  }

}

// Разделяет массив точек по маркерам {break:true} на сегменты
function splitAtBreaks(pts) {
  const segs = [[]];
  for (const p of pts) {
    if (p.break) segs.push([]);
    else segs[segs.length-1].push(p);
  }
  return segs.filter(s => s.length > 0);
}

function drawSnapCanvas(name) {
  const cvEl=document.getElementById('cv-'+name); if (!cvEl) return;
  const ctx=cvEl.getContext('2d'), W=planPx(cvEl), H=W;
  const cx=CV[name]||{scale:1,ox:0,oy:0};
  const pts=S.pts[name]||[];
  applyTransform(ctx,cx,W,H);

  ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);

  // Сетка (0.5 м шаг)
  const step=W/CELLS;
  for(let r=0;r<=CELLS;r++) for(let c=0;c<=CELLS;c++) {
    const isMajor = (r*GRID_STEP)%1===0 && (c*GRID_STEP)%1===0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c*step,r*step,(isMajor?2:1.2)/cx.scale,0,Math.PI*2); ctx.fill();
  }

  // Метки метров (каждые 5м)
  ctx.fillStyle='#999'; ctx.font=planFont(9, cx.scale); ctx.textAlign='center';
  for(let m=5;m<=GRID;m+=5) { const px=m/GRID*W; ctx.fillText(m+'м', px, H-3/cx.scale); }

  // Ранее заданные объекты
  drawPreviousLayers(ctx, W, H, cx, name);

  // Подсказка
  const realPts = pts.filter(p=>!p.break);
  if (!realPts.length) {
    ctx.fillStyle='#aaa'; ctx.font=planFont(13, cx.scale); ctx.textAlign='center';
    const hint={fence:'Нажмите чтобы поставить точку',
                 paths:'Нажмите точки вдоль дорожки',
                 railing:'Нажмите точки по краю террасы'};
    ctx.fillText(hint[name]||'Нажмите чтобы поставить точку', W/2, H*0.92);
  }

  // Контур текущей секции
  if (realPts.length > 0) {
    // Редактируемый элемент рисуется акцентным цветом — как выбранные
    // прямоугольники террасы (TODO: активные элементы показываем оранжевым).
    const color = DIM_COL;
    // Ломаные (могут состоять из нескольких линий через {break:true}).
    const segments = (name==='paths'||name==='fence'||name==='railing') ? splitAtBreaks(pts) : [realPts];

    if (name === 'paths') {
      const pathW = ((S.pathWidth || 120) / 100) / GRID * W;
      for (const seg of segments) {
        if (seg.length < 1) continue;
        // Полоса
        ctx.strokeStyle='rgba(242,114,44,.22)'; ctx.lineWidth=pathW; ctx.lineCap='butt'; ctx.lineJoin='miter';
        ctx.beginPath(); ctx.moveTo(seg[0].x*W, seg[0].y*H);
        for(let i=1;i<seg.length;i++) ctx.lineTo(seg[i].x*W, seg[i].y*H);
        ctx.stroke();
        // Центральная линия
        ctx.strokeStyle=color; ctx.lineWidth=2/cx.scale; ctx.lineCap='butt';
        ctx.setLineDash([6/cx.scale,3/cx.scale]);
        ctx.beginPath(); ctx.moveTo(seg[0].x*W, seg[0].y*H);
        for(let i=1;i<seg.length;i++) ctx.lineTo(seg[i].x*W, seg[i].y*H);
        ctx.stroke(); ctx.setLineDash([]);
      }
    } else if (name === 'fence' || name === 'railing') {
      for (const seg of segments) {
        if (seg.length < 1) continue;
        ctx.beginPath(); ctx.moveTo(seg[0].x*W,seg[0].y*H);
        for(let i=1;i<seg.length;i++) ctx.lineTo(seg[i].x*W,seg[i].y*H);
        ctx.strokeStyle=color; ctx.lineWidth=2.5/cx.scale; ctx.stroke();
      }
    } else {
      // Замкнутый контур (запасная ветка: сейчас все snap-редакторы — ломаные)
      ctx.beginPath(); ctx.moveTo(realPts[0].x*W,realPts[0].y*H);
      for(let i=1;i<realPts.length;i++) ctx.lineTo(realPts[i].x*W,realPts[i].y*H);
      if(realPts.length>2) { ctx.closePath(); ctx.fillStyle='rgba(0,0,0,.08)'; ctx.fill(); }
      ctx.strokeStyle=color; ctx.lineWidth=2.5/cx.scale; ctx.stroke();
    }

    // Точки (все реальные точки с номерами). У ограждения их не рисуем: разметка
    // считается автоматически (TODO.md, этап 2 п.4), руками двигать нечего — на
    // плане остаются только две точки «входа».
    let ptNum = 0;
    if (name !== 'railing') pts.forEach((p, pi)=>{
      if (p.break) return;
      ptNum++;
      const sel = (_lineSel.name === name && _lineSel.idx === pi);
      ctx.beginPath(); ctx.arc(p.x*W,p.y*H,(sel?10:8)/cx.scale,0,Math.PI*2);
      ctx.fillStyle = sel ? color : '#fff'; ctx.fill();
      ctx.strokeStyle=color; ctx.lineWidth=(sel?3.5:2.5)/cx.scale; ctx.stroke();
      // У выбранной точки заливка акцентная — номер на ней пишем белым.
      ctx.fillStyle = sel ? '#fff' : color;
      ctx.font=planFont(10, cx.scale, 'bold'); ctx.textAlign='center';
      ctx.fillText(ptNum,p.x*W,p.y*H+4/cx.scale);
    });

    // Размеры: у линейных объектов общая длина, у площадных — стороны габарита.
    if (name === 'paths' || name === 'fence' || name === 'railing') {
      drawPolylineDims(ctx, cx, W, segments);
    } else if (realPts.length > 2) {
      const xs = realPts.map(p => p.x), ys = realPts.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      drawRectDims(ctx, cx, W, x0, y0, x1 - x0, y1 - y0);
    }
  }

  // Забор: показываем зону, куда ставить нельзя — 3 м от дома и террасы
  // (TODO.md, этап 2 п.10). Рисуем пунктиром по контурам, отодвинутым наружу.
  if (name === 'fence') {
    const lim = FENCE_MIN_CLEAR / GRID;
    const zones = [];
    if (typeof isEmptyLot !== 'function' || !isEmptyLot()) {
      const hp = getHousePolygonNorm();
      if (hp && hp.bboxNorm) {
        const b = hp.bboxNorm;
        zones.push({ x0: b.nx, y0: b.ny, x1: b.nx + b.nw, y1: b.ny + b.nh });
      }
    }
    for (const sec of ['terrace', 'pool_terrace']) {
      for (const r of (typeof secRects === 'function' ? secRects(sec) : [])) {
        if (r && r.w > 0 && r.h > 0) zones.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
      }
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(210,60,60,.45)';
    ctx.fillStyle = 'rgba(210,60,60,.07)';
    ctx.lineWidth = 1.5 / cx.scale;
    ctx.setLineDash([6 / cx.scale, 4 / cx.scale]);
    for (const z of zones) {
      ctx.beginPath();
      ctx.rect((z.x0 - lim) * W, (z.y0 - lim) * H,
               (z.x1 - z.x0 + 2 * lim) * W, (z.y1 - z.y0 + 2 * lim) * H);
      ctx.fill(); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Подпись — в самой зоне, в полосе под нижней гранью (там же, где по умолчанию
    // идёт забор). Две строки, чтобы влезть в 3-метровую полосу.
    if (zones.length) {
      const zx0 = Math.min(...zones.map(z => z.x0)), zx1 = Math.max(...zones.map(z => z.x1));
      const zy1 = Math.max(...zones.map(z => z.y1));
      const lineH = 11 * PLAN_FONT_K / cx.scale;
      const midY = (zy1 + lim / 2) * H;
      ctx.fillStyle = 'rgba(176,38,38,.9)';
      ctx.font = planFont(9, cx.scale, 'bold');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Установка забора ближе 3 метров', (zx0 + zx1) / 2 * W, midY - lineH / 2);
      ctx.fillText('от строения запрещена СНИПом', (zx0 + zx1) / 2 * W, midY + lineH / 2);
    }
    ctx.restore();
  }

  // Калитка на заборе — метка проёма шириной FENCE_GATE_W (TODO.md, этап 2 п.8).
  if (name === 'fence' && S.fenceGate) {
    const g = S.fenceGate;
    ctx.strokeStyle = DIM_COL; ctx.fillStyle = '#fff';
    ctx.lineWidth = 2.5 / cx.scale;
    ctx.beginPath(); ctx.arc(g.x * W, g.y * H, 7 / cx.scale, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = DIM_COL; ctx.font = planFont(10, cx.scale, 'bold'); ctx.textAlign = 'center';
    ctx.fillText('калитка', g.x * W, g.y * H - 12 / cx.scale);
  }

  // Точки «входа» в ограждении — две перетаскиваемые метки на периметре
  // (TODO.md, этап 2 п.4). Разрыв между ними уже вычтен из разметки выше.
  if (name === 'railing' && typeof railingEntryPointsNorm === 'function') {
    const e = railingEntryPointsNorm();
    if (e) {
      ctx.strokeStyle = DIM_COL; ctx.fillStyle = '#fff';
      ctx.lineWidth = 2.5 / cx.scale;
      for (const p of e) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * W, 7 / cx.scale, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = DIM_COL; ctx.font = planFont(10, cx.scale, 'bold'); ctx.textAlign = 'center';
      ctx.fillText('вход', (e[0].x + e[1].x) / 2 * W, ((e[0].y + e[1].y) / 2) * W - 12 / cx.scale);
    }
  }

  ctx.restore();
}

// ══════════════════════════════════════════════
// РЕДАКТОР ОГРАЖДЕНИЯ (TODO.md, этап 2 п.4)
// Точки руками не ставятся: разметка считается по свободному периметру террасы
// (railingAutoPoints). Здесь можно только двигать две точки «входа».
// ══════════════════════════════════════════════
let _railDragIdx = null;

// Пересчитать разметку по текущей террасе (та же функция, что зовёт 3D).
function _railingSync() {
  if (typeof railingAutoPoints !== 'function' || typeof lastHouseSize !== 'function') return;
  const lw = lastHouseSize();
  S.pts.railing = railingAutoPoints(lw.L, lw.W);
}

function initRailingCanvas() {
  const wrap = document.getElementById('cw-railing');
  const cv = document.getElementById('cv-railing');
  if (!wrap || !cv) return;
  CV.railing = mkCvState();
  fitCanvasToWrap(wrap, cv, CV.railing);
  _railingSync();
  drawSnapCanvas('railing');

  if (wrap._railBound) return;
  wrap._railBound = true;
  attachPanZoom(wrap, 'railing', () => drawSnapCanvas('railing'));

  const norm = e => {
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const cvEl = document.getElementById('cv-railing');
    const cxs = CV.railing;
    const sx = (e.clientX - r.left) * dpr, sy = (e.clientY - r.top) * dpr;
    const W = planPx(cvEl);
    return { x: (sx - cxs.ox) / cxs.scale / W, y: (sy - cxs.oy) / cxs.scale / W };
  };

  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0 || typeof railingEntryPointsNorm !== 'function') return;
    const pts = railingEntryPointsNorm();
    if (!pts) return;
    const p = norm(e);
    const hit = 12 / planPx(cv) / CV.railing.scale * (window.devicePixelRatio || 1) + 0.012;
    let idx = null, best = hit;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) { best = d; idx = i; }
    });
    if (idx !== null) { _railDragIdx = idx; e.preventDefault(); }
  });

  wrap.addEventListener('mousemove', e => {
    if (_railDragIdx === null) return;
    railingEntryDrag(_railDragIdx, norm(e));
    _railingSync();
    drawSnapCanvas('railing');
  });

  const stop = () => {
    if (_railDragIdx === null) return;
    _railDragIdx = null;
    if (typeof onParamChange === 'function') onParamChange();   // пересобрать 3D
  };
  wrap.addEventListener('mouseup', stop);
  wrap.addEventListener('mouseleave', stop);
}

function undoPt(n) { S.pts[n].pop(); drawSnapCanvas(n); }
function clrPts(n) { S.pts[n]=[]; drawSnapCanvas(n); }
// Новая линия (разрыв) для дорожек и забора
function addBreak(n) {
  const pts = S.pts[n];
  // Не добавляем break подряд или в начало
  if (!pts.length || pts[pts.length-1].break) return;
  pts.push({ break: true });
  drawSnapCanvas(n);
}

// Для дорожек - тот же snap-canvas, уже обрабатывается выше
function initPathsCanvas() { initSnapCanvas('paths'); }

// ══════════════════════════════════════════════
// САДОВАЯ МЕБЕЛЬ: план-редактор точек размещения
// Точка = место, куда встанет модель из каталога. Номер точки (1..N) — её
// порядок в S.furniture: товары из каталога назначаются точкам по этому порядку.
// ЛКМ по пустому месту — поставить точку и сразу тащить; ЛКМ по точке — выбрать
// и тащить; ПКМ — перемещение плана. Высоту (терраса/земля) определяет 3D.
// У точки есть ПОВОРОТ (p.rot, радианы, кратно π/2): «перёд» мебели — локальная
// ось +X модели, при rot = 0 она смотрит вдоль мирового +X = вправо на плане
// (canvasToWorld: x плана → X мира, y плана → Z мира). Поворот в 3D идёт вокруг
// оси Y, т.е. на плане стрелка вращается ПРОТИВ часовой стрелки.
// ══════════════════════════════════════════════
const FURN_HIT_R = 16;      // радиус захвата точки (экранные px при scale=1)

let furnDrag = false, furnDragIdx = -1;
// Точку реально сдвинули? Отличает перетаскивание от клика (клик = поворот на 90°).
let _furnMoved = false;

function initFurnitureCanvas() {
  const wrap = document.getElementById('cw-furniture');
  const cv   = document.getElementById('cv-furniture');
  CV['furniture'] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV['furniture']);
  if (!S.furniture) S.furniture = [];
  if (S.activeFurniture !== null && S.activeFurniture >= S.furniture.length) S.activeFurniture = null;

  drawFurnitureCanvas();

  if (wrap._furnBound) return;   // слушатели — один раз (см. initSnapCanvas)
  wrap._furnBound = true;

  attachPanZoom(wrap, 'furniture', () => drawFurnitureCanvas());

  const getWorld = (clientX, clientY) => {
    const cx = CV['furniture'] || { ox: 0, oy: 0, scale: 1 };
    const cvEl = document.getElementById('cv-furniture');
    const r = wrap.getBoundingClientRect(), dpr2 = window.devicePixelRatio || 1;
    return {
      x: ((clientX - r.left) * dpr2 - cx.ox) / cx.scale,
      y: ((clientY - r.top ) * dpr2 - cx.oy) / cx.scale,
      W: planPx(cvEl),
    };
  };
  const active = () => CV['furniture']
    && document.getElementById('d-canvas-furniture')?.classList.contains('active');

  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0 || !active()) return;      // ЛКМ — инструмент, ПКМ — pan
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    const hit = _furnitureHit(x / W, y / W, W);
    if (hit >= 0) {
      S.activeFurniture = hit;
    } else {
      // Пустое место — ставим новую точку и сразу берём её в перетаскивание.
      // Поворот наследуем у активной точки — расстановка «в ряд» без лишних кликов.
      const prev = (S.activeFurniture !== null) ? S.furniture[S.activeFurniture] : null;
      S.furniture.push({ x: snapNorm(x / W), y: snapNorm(y / W),
                         rot: prev ? (prev.rot || 0) : 0, product: null });
      S.activeFurniture = S.furniture.length - 1;
      if (typeof onParamChange === 'function') onParamChange();
    }
    _furnMoved = (hit < 0);        // новая точка — это не «клик по точке»
    furnDrag = true; furnDragIdx = S.activeFurniture;
    wrap.style.cursor = 'move';
    drawFurnitureCanvas();
    _dSyncFurniturePanel();
  });
  document.addEventListener('mousemove', e => {
    if (!furnDrag || furnDragIdx < 0 || !S.furniture[furnDragIdx]) return;
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    const p = S.furniture[furnDragIdx];
    const nx = Math.max(0, Math.min(1, snapNorm(x / W)));
    const ny = Math.max(0, Math.min(1, snapNorm(y / W)));
    if (nx !== p.x || ny !== p.y) _furnMoved = true;
    p.x = nx; p.y = ny;
    drawFurnitureCanvas();
  });
  document.addEventListener('mouseup', e => {
    if (!furnDrag || e.button !== 0) return;
    const idx = furnDragIdx;
    furnDrag = false; furnDragIdx = -1; wrap.style.cursor = '';   // вернуть курсор из стилей (.d-canvas-area)
    // Клик по точке БЕЗ сдвига разворачивает её на 90° — как у грядок
    // (TODO.md, этап 2 пп.12-13).
    if (!_furnMoved && idx >= 0) { S.activeFurniture = idx; rotateActiveFurniture(1); return; }
    if (typeof onParamChange === 'function') onParamChange();   // пересборка 3D
  });

  // R — повернуть выбранную точку на 90° (Shift+R — назад). Работает только при
  // открытом редакторе мебели и вне полей ввода.
  document.addEventListener('keydown', e => {
    if (!active() || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key !== 'r' && e.key !== 'R' && e.key !== 'к' && e.key !== 'К') return;   // рус. раскладка
    e.preventDefault();
    rotateActiveFurniture(e.shiftKey ? -1 : 1);
  });
}

// «Ещё одна» — новая точка рядом с активной (кнопка вместо клика по пустому месту,
// TODO.md этап 2 п.13). Клик по плану точку тоже ставит — так быстрее расставлять.
function addFurniturePoint() {
  if (!S.furniture) S.furniture = [];
  const step = SNAP / GRID * 2;
  const a = (S.activeFurniture !== null) ? S.furniture[S.activeFurniture] : null;
  const x = a ? Math.min(1, a.x + step) : 0.5;
  const y = a ? a.y : 0.6;
  S.furniture.push({ x: snapNorm(x), y: snapNorm(y), rot: a ? (a.rot || 0) : 0, product: null });
  S.activeFurniture = S.furniture.length - 1;
  drawFurnitureCanvas();
  if (typeof _dSyncFurniturePanel === 'function') _dSyncFurniturePanel();
  if (typeof onParamChange === 'function') onParamChange();
}

// Поворот выбранной точки на ±90°. dir: 1 — против часовой на плане (+Y в 3D).
function rotateActiveFurniture(dir) {
  const pts = S.furniture || [];
  const p = (S.activeFurniture !== null) ? pts[S.activeFurniture] : null;
  if (!p) return;
  const TAU = Math.PI * 2;
  p.rot = (((p.rot || 0) + (dir < 0 ? -1 : 1) * Math.PI / 2) % TAU + TAU) % TAU;
  drawFurnitureCanvas();
  _dSyncFurniturePanel();
  if (typeof onParamChange === 'function') onParamChange();   // пересборка 3D
}

// Индекс точки под курсором (нормализованные координаты) или -1.
function _furnitureHit(nx, ny, W) {
  const sc = (CV['furniture'] && CV['furniture'].scale) || 1;
  const rNorm = (FURN_HIT_R / sc) / W;
  let best = -1, bestD = rNorm;
  (S.furniture || []).forEach((p, i) => {
    const d = Math.hypot(nx - p.x, ny - p.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function addFurniturePoint() {
  if (!S.furniture) S.furniture = [];
  // Рядом с активной точкой либо в центре плана.
  const a = (S.activeFurniture !== null) ? S.furniture[S.activeFurniture] : null;
  const nx = a ? Math.min(1, a.x + 1.5 / GRID) : 0.5;
  const ny = a ? a.y : 0.5;
  S.furniture.push({ x: snapNorm(nx), y: snapNorm(ny), rot: a ? (a.rot || 0) : 0, product: null });
  S.activeFurniture = S.furniture.length - 1;
  drawFurnitureCanvas();
  _dSyncFurniturePanel();
  if (typeof onParamChange === 'function') onParamChange();
}

function delActiveFurniture() {
  if (!S.furniture || S.activeFurniture === null) return;
  S.furniture.splice(S.activeFurniture, 1);
  S.activeFurniture = S.furniture.length ? Math.min(S.activeFurniture, S.furniture.length - 1) : null;
  drawFurnitureCanvas();
  _dSyncFurniturePanel();
  if (typeof onParamChange === 'function') onParamChange();
}

// Подпись в футере редактора (что назначено точкам).
function _dSyncFurniturePanel() {
  const el = document.getElementById('d-furniture-info');
  if (!el) return;
  const pts = S.furniture || [];
  if (!pts.length) { el.textContent = 'Кликните по плану, чтобы поставить точку'; return; }
  const filled = pts.filter(p => p.product).length;
  const a = (S.activeFurniture !== null) ? pts[S.activeFurniture] : null;
  const deg = a ? Math.round(((a.rot || 0) * 180 / Math.PI)) % 360 : 0;
  const act = a ? ` · выбрана №${S.activeFurniture + 1} (поворот ${deg}°)` : '';
  el.textContent = `Точек: ${pts.length}, с мебелью: ${filled}${act}`;
}

function drawFurnitureCanvas() {
  const cvEl = document.getElementById('cv-furniture'); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = planPx(cvEl), H = W;
  const cx = CV['furniture'] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * GRID_STEP) % 1 === 0 && (c * GRID_STEP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#999'; ctx.font = planFont(9, cx.scale); ctx.textAlign = 'center';
  for (let m = 5; m <= GRID; m += 5) { const px = m / GRID * W; ctx.fillText(m + 'м', px, H - 3 / cx.scale); }

  drawPreviousLayers(ctx, W, H, cx, 'furniture');   // дом, терраса, дорожки — фоном

  const pts = S.furniture || [];
  pts.forEach((p, i) => {
    const px = p.x * W, py = p.y * H;
    const isActive = (i === S.activeFurniture);
    const R = 11 / cx.scale;
    // Стрелка «переда»: локальный +X модели. Ось Y в 3D крутит против часовой,
    // а y плана растёт вниз → экранное направление = (cos rot, −sin rot).
    const rot = p.rot || 0, dx = Math.cos(rot), dy = -Math.sin(rot);
    const a0 = R + 3 / cx.scale, a1 = R + 15 / cx.scale, aw = 5 / cx.scale;
    ctx.beginPath();
    ctx.moveTo(px + dx * a1, py + dy * a1);                      // остриё
    ctx.lineTo(px + dx * a0 - dy * aw, py + dy * a0 + dx * aw);
    ctx.lineTo(px + dx * a0 + dy * aw, py + dy * a0 - dx * aw);
    ctx.closePath();
    ctx.fillStyle = isActive ? '#0064DC' : '#7a4b23';
    ctx.fill();
    // Заполненная точка (с товаром) — коричневая, пустая — серая.
    ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2);
    ctx.fillStyle = p.product ? 'rgba(122,75,35,.85)' : 'rgba(255,255,255,.95)';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#0064DC' : '#7a4b23';
    ctx.lineWidth = (isActive ? 3 : 2) / cx.scale;
    ctx.stroke();
    ctx.fillStyle = p.product ? '#fff' : '#7a4b23';
    ctx.font = planFont(11, cx.scale, 'bold'); ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), px, py + 4 / cx.scale);
    // Подпись товара у активной точки
    if (isActive && p.product) {
      ctx.fillStyle = '#333'; ctx.font = planFont(10, cx.scale);
      ctx.fillText(p.product.name.slice(0, 34), px, py - R - 5 / cx.scale);
    }
  });

  if (!pts.length) {
    ctx.fillStyle = '#aaa'; ctx.font = planFont(13, cx.scale); ctx.textAlign = 'center';
    ctx.fillText('Кликните по плану, чтобы поставить точку для мебели', W / 2, H * 0.92);
  }
  ctx.restore();
  _dSyncFurniturePanel();
}

// ══════════════════════════════════════════════
// ОТДЕЛКА ФАСАДА: план-редактор выбора сегментов стен
// Кликабельные полосы-сегменты по рёбрам 1-го этажа (segId как в 3D);
// выбор пишется в S.wallZones и сразу подхватывается 3D (_applyFacadeSelection).
// Сегменты верхних этажей выбираются в 3D-режиме.
// ══════════════════════════════════════════════
function initFacadeCanvas() {
  const wrap = document.getElementById('cw-facade');
  const cv   = document.getElementById('cv-facade');
  CV['facade'] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV['facade']);

  drawFacadeCanvas();

  if (wrap._facadeBound) return;   // слушатели — один раз (см. initSnapCanvas)
  wrap._facadeBound = true;

  attachPanZoom(wrap, 'facade', () => drawFacadeCanvas());

  wrap.addEventListener('click', e => {
    const cx = CV['facade']; if (!cx || cx.pinching) return;
    const cvEl = document.getElementById('cv-facade'); if (!cvEl) return;
    const r = wrap.getBoundingClientRect(), dpr2 = window.devicePixelRatio || 1;
    const sx = (e.clientX - r.left) * dpr2, sy = (e.clientY - r.top) * dpr2;
    const wx = (sx - cx.ox) / cx.scale, wy = (sy - cx.oy) / cx.scale;
    const P = planPx(cvEl); const segId = _facadeHitSegment(wx / P, wy / P);
    if (!segId) return;
    if (S.wallZones[segId]) delete S.wallZones[segId];
    else S.wallZones[segId] = true;
    drawFacadeCanvas();
    // Живое отражение в 3D (сцена под оверлеем редактора) + счётчик 3D-тулбара.
    if (typeof _applyFacadeSelection === 'function' && typeof threeState !== 'undefined' && threeState) {
      _applyFacadeSelection();
    }
  });
}

// Поиск элемента фасада по клику (нормализованные координаты плана): проекция на
// ось ребра внутри [start, start+width] + перпендикуляр ближе порога. Выбираются
// и wall-сегменты, и оконные колонки (проёмы с segId — стена над/под окном).
function _facadeHitSegment(nx, ny) {
  const T = _houseWorldTransform(); if (!T) return null;
  const p = T.toWorld(nx, ny);
  const thr = Math.max((T.layout.wt || 0.2) * 1.5, 0.45);   // м
  let best = null, bestD = thr;
  for (const e of T.layout.edges) {
    const t    = (p.x - e.x) *  e.dx + (p.z - e.z) * e.dz;  // вдоль ребра (dx,dz — единичные)
    const perp = Math.abs((p.x - e.x) * -e.dz + (p.z - e.z) * e.dx);
    if (perp > thr) continue;
    for (const it of e.items) {
      if (!it.segId) continue;
      if (t < it.start - 0.05 || t > it.start + it.width + 0.05) continue;
      if (perp < bestD) { bestD = perp; best = it.segId; }
    }
  }
  return best;
}

function drawFacadeCanvas() {
  const cvEl = document.getElementById('cv-facade'); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = planPx(cvEl), H = W;
  const cx = CV['facade'] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // Сетка + метки (как в остальных редакторах)
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * GRID_STEP) % 1 === 0 && (c * GRID_STEP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#999'; ctx.font = planFont(9, cx.scale); ctx.textAlign = 'center';
  for (let m = 5; m <= GRID; m += 5) { const px = m / GRID * W; ctx.fillText(m + 'м', px, H - 3 / cx.scale); }

  drawPreviousLayers(ctx, W, H, cx, 'facade');   // дом (с окнами/дверями) + конструкции фоном

  const T = _houseWorldTransform();
  if (T) {
    // Кликабельные полосы по рёбрам: wall-сегменты — плотные, оконные колонки —
    // полупрозрачные (символ окна/двери остаётся виден). Выбранные — синим.
    const bandW = Math.max((T.layout.wt || 0.2) / GRID * W * 1.6, 6 / cx.scale);
    const zonesN = Object.keys(S.wallZones || {}).length;
    for (const e of T.layout.edges) {
      for (const it of e.items) {
        if (!it.segId || it.width < 0.03) continue;
        const a = T.toNorm(e.x + e.dx * it.start,              e.z + e.dz * it.start);
        const b = T.toNorm(e.x + e.dx * (it.start + it.width), e.z + e.dz * (it.start + it.width));
        const sel = !!S.wallZones[it.segId];
        const isWall = it.type === 'wall';
        ctx.strokeStyle = isWall
          ? (sel ? 'rgba(242,114,44,.9)'  : 'rgba(70,70,70,.32)')
          : (sel ? 'rgba(242,114,44,.45)' : 'rgba(70,70,70,.14)');
        ctx.lineWidth = bandW; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke();
        // Поперечные штрихи на границах элемента (видно, где элементы делятся)
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.4 / cx.scale;
        for (const pnt of [a, b]) {
          const px = pnt.x * W, py = pnt.y * H;
          ctx.beginPath();
          ctx.moveTo(px - e.dz * bandW * 0.6, py + e.dx * bandW * 0.6);
          ctx.lineTo(px + e.dz * bandW * 0.6, py - e.dx * bandW * 0.6);
          ctx.stroke();
        }
      }
    }
    // Угловые столбы: не выбираются сами — отделываются «под ближайшую вставку»
    // (примыкающий элемент выбран → угол синий). Показываем это на плане.
    for (const p of (T.layout.pillars || [])) {
      const eP = T.layout.edges[p.prevEdge], eN = T.layout.edges[p.nextEdge];
      const lastOf  = ed => { for (let i = ed.items.length - 1; i >= 0; i--) if (ed.items[i].segId) return ed.items[i].segId; return null; };
      const firstOf = ed => { for (const i of ed.items) if (i.segId) return i.segId; return null; };
      const on = zonesN > 0 && (!!S.wallZones[lastOf(eP)] || !!S.wallZones[firstOf(eN)]);
      const c = T.toNorm(p.cx, p.cz);
      const half = Math.max(p.ps / GRID * W, 6 / cx.scale) / 2 * 1.6;
      ctx.fillStyle = on ? 'rgba(242,114,44,.9)' : 'rgba(70,70,70,.32)';
      ctx.fillRect(c.x * W - half, c.y * H - half, half * 2, half * 2);
    }
    // Счётчик в футере редактора
    const cnt = document.getElementById('d-facade-plan-count');
    if (cnt) {
      const total = T.layout.edges.reduce((s, e) => s + e.items.filter(i => i.segId).length, 0);
      cnt.textContent = zonesN ? `Выбрано элементов: ${zonesN} из ${total} (1-й этаж; углы — автоматически)`
                               : 'Ничего не выбрано — материал ляжет на весь фасад';
    }
  } else {
    ctx.fillStyle = '#aaa'; ctx.font = planFont(13, cx.scale); ctx.textAlign = 'center';
    ctx.fillText('План недоступен: дом ещё загружается или участок без дома', W / 2, H * 0.5);
  }
  ctx.restore();
}

// ══════════════════════════════════════════════
// СТУПЕНИ: один rect drag+resize
// Положение и размер — от пользователя; в 3D глубина пересчитывается
// автоматически из числа подступенков (см. buildSteps3d в viewer3d-core.js).
// ══════════════════════════════════════════════
let stepsDrag = null;
let stepsDragStart = null;

function initStepsCanvas() {
  const wrap = document.getElementById('cw-steps');
  const cv   = document.getElementById('cv-steps');
  CV['steps'] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV['steps']);

  // НЕ переснапиваем ступени на сетку при открытии — иначе rect, прижатый к стене
  // дома/кромке террасы (обычно не на сетке 0.5 м), отрывается («съезжает»).
  // Но глубину/разворот приводим сразу: они зависят от фундамента и разметки террасы,
  // которые могли поменяться с прошлого открытия редактора.
  _stepsNormalize();
  // И довешиваем «залипание» к столбам: ограждение могли разметить ПОСЛЕ ступеней,
  // тогда при открытии редактора перила сами приходят в ближайший столб.
  _stepsSnapToRailPost('move');

  const newCv = cv.cloneNode(false);
  wrap.replaceChild(newCv, cv);
  fitCanvasToWrap(wrap, newCv, CV['steps']);   // клон заменил канвас — размеры задаём ему

  drawStepsCanvas();
  attachStepsEvents(wrap);
}

// ── Ступени: глубина и ориентация задаются НЕ пользователем ────────────────
// Глубина лестницы полностью определяется высотой фундамента (3D считает так же:
// n = ceil(bh / STEP_RISE) ступенек по STEP_DEPTH), а разворот — ближайшей стороной
// террасы/крыльца. Поэтому в редакторе меняется только ШИРИНА: прямоугольник,
// который тянется по обеим осям, обещал бы настройку глубины, которой нет.
function _stepsDepthNorm() {
  const bh = (parseFloat(document.getElementById('v-found')?.value || 80)) / 100;
  const rise  = (typeof STEP_RISE   !== 'undefined') ? STEP_RISE   : 0.17;
  const depth = (typeof STEP_DEPTH  !== 'undefined') ? STEP_DEPTH  : 0.28;
  const nose  = (typeof STEP_NOSING !== 'undefined') ? STEP_NOSING : 0.035;
  const n = Math.max(1, Math.ceil(bh / rise));
  return Math.max(0.3, (n - 1) * depth + nose) / GRID;
}

// Стороны опор (террасные блоки, при их отсутствии — габарит дома) в виде
// {axis, coord, a, b, out}: axis — ось, ПОПЕРЁК которой идёт сторона; out — куда
// от опоры смотрит наружная нормаль (+1/−1).
function _stepsSupportSides() {
  const sides = [];
  const pushRect = r => {
    sides.push({ axis: 'y', coord: r.y,       a: r.x, b: r.x + r.w, out: -1 });
    sides.push({ axis: 'y', coord: r.y + r.h, a: r.x, b: r.x + r.w, out: +1 });
    sides.push({ axis: 'x', coord: r.x,       a: r.y, b: r.y + r.h, out: -1 });
    sides.push({ axis: 'x', coord: r.x + r.w, a: r.y, b: r.y + r.h, out: +1 });
  };
  (S.terraceRects || []).forEach(r => { if (r && r.w > 0 && r.h > 0) pushRect(r); });
  if (!sides.length && typeof isEmptyLot === 'function' && !isEmptyLot()) {
    const b = getHousePolygonNorm().bboxNorm;
    pushRect({ x: b.nx, y: b.ny, w: b.nw, h: b.nh });
  }
  return sides;
}

// Приводит S.steps к «правильной» лестнице: глубина из высоты фундамента,
// длинная сторона вдоль ближайшей опорной стороны, спуск — наружу от неё.
function _stepsNormalize() {
  const s = S.steps; if (!s) return;
  const sides = _stepsSupportSides();
  if (!sides.length) return;                      // ни террасы, ни дома — не трогаем
  const D = _stepsDepthNorm();
  const cx0 = s.x + s.w / 2, cy0 = s.y + s.h / 2;
  let best = null, bestD = Infinity;
  for (const sd of sides) {
    const u = (sd.axis === 'y') ? cx0 : cy0;      // вдоль стороны
    const v = (sd.axis === 'y') ? cy0 : cx0;      // поперёк
    const uc = Math.max(sd.a, Math.min(sd.b, u));
    const d = Math.hypot(u - uc, v - sd.coord);
    if (d < bestD) { bestD = d; best = sd; }
  }
  const minW = SNAP / GRID;
  if (best.axis === 'y') {                        // опора горизонтальная → спуск по Y
    s.w = Math.max(minW, s.w);
    s.h = D;
    s.y = (best.out > 0) ? best.coord : best.coord - D;
    s.x = Math.max(0, Math.min(1 - s.w, s.x));
  } else {                                        // опора вертикальная → спуск по X
    s.h = Math.max(minW, s.h);
    s.w = D;
    s.x = (best.out > 0) ? best.coord : best.coord - D;
    s.y = Math.max(0, Math.min(1 - s.h, s.y));
  }
}

// ── Столбы ограждения террасы на плане (нормализованные 0..1) ──────────────
// Повторяет раскладку из buildRailing3d (viewer3d-railing.js): по каждому отрезку
// ломаной столбы стоят через RAIL_SECTION_W по осям, конец отрезка — всегда столб;
// мелкий остаток (< 0.15 м) растворяется в последней секции. Держать в синхроне:
// если раскладка в 3D изменится, «залипание» ступеней уедет от реальных столбов.
function _railingPostsNorm() {
  const out = [];
  if (typeof S === 'undefined' || !S.sections.includes('railing')) return out;
  const pts = S.pts.railing || [];
  const segsAll = (typeof splitAtBreaks === 'function') ? splitAtBreaks(pts) : [pts];
  const Wm = ((typeof RAIL_SECTION_W !== 'undefined') ? RAIL_SECTION_W : 1.5) / GRID;
  const remMin = 0.15 / GRID, minLen = 0.20 / GRID;
  for (const seg of segsAll) {
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i], b = seg[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < minLen) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const nFull = Math.max(1, Math.floor(L / Wm + 1e-9));
      const pos = [];
      for (let k = 0; k <= nFull; k++) pos.push(k * Wm);
      if (L - nFull * Wm > remMin) pos.push(L);
      else pos[pos.length - 1] = L;
      for (const t of pos) out.push({ x: a.x + ux * t, y: a.y + uy * t });
    }
  }
  return out;
}

// Смещение перил лестницы от её оси (нормализованное). Те же формулы, что в 3D
// (viewer3d-builders: latOff = max(0.10, stairWidth/2 − STAIR_RAIL_INSET)).
function _stepsRailOffsetNorm(widthNorm) {
  const inset = ((typeof STAIR_RAIL_INSET !== 'undefined') ? STAIR_RAIL_INSET : 0.12) / GRID;
  return Math.max(0.10 / GRID, widthNorm / 2 - inset);
}

// TODO.md 10: «залипание» ступеней к ограждению террасы. Перила лестницы идут НЕ по
// кромке, а внутрь от неё (см. _stepsRailOffsetNorm) — притягиваем так, чтобы ОСЬ
// перила пришла в ближайший столб, а не кромка лестницы.
//   kind = 'move'  → двигаем лестницу целиком (обе стороны равнозначны);
//   kind = resize  → тянем ТОЛЬКО перетаскиваемую кромку: её перило = кромка ∓
//                    STAIR_RAIL_INSET, противоположная кромка остаётся на месте.
// Без размеченного ограждения ступени ведут себя как раньше.
function _stepsSnapToRailPost(kind) {
  const s = S.steps; if (!s) return;
  const posts = _railingPostsNorm();
  if (!posts.length) return;
  const D = _stepsDepthNorm();
  // Ось спуска = та, по которой размер равен расчётной глубине (_stepsNormalize).
  const alongY = Math.abs(s.h - D) <= Math.abs(s.w - D);
  const size = alongY ? s.w : s.h;                // ширина лестницы (поперёк спуска)
  const lo = alongY ? s.x : s.y;                  // ближняя кромка по поперечной оси
  const c = lo + size / 2;                        // ось лестницы
  const off = _stepsRailOffsetNorm(size);
  const inset = ((typeof STAIR_RAIL_INSET !== 'undefined') ? STAIR_RAIL_INSET : 0.12) / GRID;
  const mn = SNAP / GRID;
  // Столбы берём только те, что напротив лестницы: по оси спуска не дальше её глубины
  // (иначе притягивало бы к перилам на другом краю террасы).
  const runLo = (alongY ? s.y : s.x) - D, runHi = (alongY ? s.y : s.x) + (alongY ? s.h : s.w) + D;
  const thr = EDGE_SNAP_DIST / GRID;
  const near = [];
  for (const p of posts) {
    const run = alongY ? p.y : p.x;
    if (run < runLo || run > runHi) continue;
    near.push(alongY ? p.x : p.y);
  }
  if (!near.length) return;
  const nearest = target => {
    let best = null, bd = thr;
    for (const v of near) { const d = Math.abs(v - target); if (d < bd) { best = v; bd = d; } }
    return best === null ? null : { v: best, d: bd };
  };

  if (kind === 'move' || !kind) {
    let hit = null;
    for (const rail of [c - off, c + off]) {
      const r = nearest(rail);
      if (r && (!hit || r.d < hit.d)) hit = { shift: r.v - rail, d: r.d };
    }
    if (!hit) return;
    if (alongY) s.x = Math.max(0, Math.min(1 - s.w, s.x + hit.shift));
    else        s.y = Math.max(0, Math.min(1 - s.h, s.y + hit.shift));
    return;
  }

  // resize: перетаскиваемая кромка — левая/верхняя для 'nw'/'sw' по X и 'nw'/'ne' по Y.
  const movingHi = alongY ? (kind === 'ne' || kind === 'se') : (kind === 'sw' || kind === 'se');
  const hiEdge = lo + size;
  const railMoving = movingHi ? (hiEdge - inset) : (lo + inset);
  // Узкая лестница: перила упёрлись в минимальный отступ 0.10 м от оси — тогда их
  // положение от кромки не зависит и подтягивать нечего.
  if (off <= 0.10 / GRID + 1e-9) return;
  const r = nearest(railMoving);
  if (!r) return;
  const shift = r.v - railMoving;
  if (movingHi) {
    const newHi = Math.min(1, hiEdge + shift);
    if (newHi - lo < mn) return;
    if (alongY) s.w = newHi - lo; else s.h = newHi - lo;
  } else {
    const newLo = Math.max(0, lo + shift);
    if (hiEdge - newLo < mn) return;
    if (alongY) { s.x = newLo; s.w = hiEdge - newLo; }
    else        { s.y = newLo; s.h = hiEdge - newLo; }
  }
}

function getStepsRectPx(W) {
  const s = S.steps;
  return { x: s.x * W, y: s.y * W, w: s.w * W, h: s.h * W };
}

function hitStepsHandle(wx, wy, W) {
  const { x, y, w, h } = getStepsRectPx(W);
  // Радиус зоны попадания угла = визуальный радиус кружка в мировых координатах
  // (HANDLE_R / scale) — иначе при зуме-аут клик промахивается мимо угла.
  const sc = (CV['steps'] && CV['steps'].scale) || 1;
  const R = HANDLE_R / sc;
  for (const [k, cx, cy] of [['nw',x,y], ['ne',x+w,y], ['sw',x,y+h], ['se',x+w,y+h]]) {
    if (Math.hypot(wx - cx, wy - cy) < R) return k;
  }
  if (wx >= x && wx <= x+w && wy >= y && wy <= y+h) return 'move';
  return null;
}

function applyStepsDrag(wx, wy, W) {
  const ds = stepsDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  const s = S.steps;
  // excludeIdx = -1 — ступени снапаются ко ВСЕМ террасным rect'ам + стенам дома.
  const res = snapDraggedRect(stepsDrag, ds, dx, dy, -1);
  s.x = res.x; s.y = res.y; s.w = res.w; s.h = res.h;
  _stepsNormalize();     // глубину и разворот пользователь не задаёт
  // «Залипание» к столбу ограждения (TODO.md 10): при перемещении двигаем лестницу
  // целиком, при resize подтягиваем перетаскиваемую кромку.
  _stepsSnapToRailPost(stepsDrag);
  drawStepsCanvas();
}

function attachStepsEvents(wrap) {
  // Слушатели вешаются один раз (см. attachRectEvents) — guard + чтение CV['steps'] свежим.
  if (wrap._stepsBound) return;
  wrap._stepsBound = true;
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cx = CV['steps'] || { ox: 0, oy: 0, scale: 1 };
    const cvEl = document.getElementById('cv-steps');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    return {
      x: ((clientX - r.left)*dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top )*dpr - cx.oy) / cx.scale,
      W: planPx(cvEl),
    };
  };
  const stepsActive = () =>
    CV['steps'] && document.getElementById('d-canvas-steps')?.classList.contains('active');

  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    const cx = CV['steps']; if (!cx) return;
    if (e.touches.length === 2) {
      pinchActive = true; stepsDrag = null; touchId = null;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      const {x,y,W} = getWorld(t.clientX, t.clientY);
      const hit = hitStepsHandle(x,y,W);
      if (hit) {
        stepsDrag = hit;
        stepsDragStart = { mx:x, my:y, ...S.steps };
        touchId = t.identifier;
      }
    }
  }, { passive:false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    const cx = CV['steps']; if (!cx) return;
    if (pinchActive && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = { x:(e.touches[0].clientX+e.touches[1].clientX)/2, y:(e.touches[0].clientY+e.touches[1].clientY)/2 };
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
      const mx=(mid.x-r.left)*dpr, my=(mid.y-r.top)*dpr;
      const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale*ratio));
      cx.ox = mx-(mx-cx.ox)*(ns/cx.scale);
      cx.oy = my-(my-cx.oy)*(ns/cx.scale);
      cx.scale = ns;
      drawStepsCanvas(); return;
    }
    if (stepsDrag && touchId !== null) {
      const t = [...e.touches].find(t => t.identifier === touchId); if (!t) return;
      const {x,y,W} = getWorld(t.clientX, t.clientY);
      applyStepsDrag(x,y,W);
    }
  }, { passive:false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) { stepsDrag = null; stepsDragStart = null; touchId = null; }
  }, { passive:true });

  attachMousePan(wrap, 'steps', drawStepsCanvas);   // ПКМ — перемещение плана
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0 || !stepsActive()) return;   // ЛКМ — инструмент, ПКМ — pan
    const {x,y,W} = getWorld(e.clientX, e.clientY);
    const hit = hitStepsHandle(x,y,W);
    if (hit) {
      stepsDrag = hit;
      stepsDragStart = { mx:x, my:y, ...S.steps };
      wrap.style.cursor = hit === 'move' ? 'move' : 'nwse-resize';
    }
  });
  document.addEventListener('mousemove', e => {
    if (!stepsDrag) return;
    const {x,y,W} = getWorld(e.clientX, e.clientY);
    applyStepsDrag(x,y,W);
  });
  document.addEventListener('mouseup', () => {
    if (!stepsDrag) return;
    stepsDrag = null; stepsDragStart = null; wrap.style.cursor = '';   // вернуть курсор из стилей (.d-canvas-area)
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const cx = CV['steps']; if (!cx) return;
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    const mx=(e.clientX-r.left)*dpr, my=(e.clientY-r.top)*dpr;
    const f = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale*f));
    cx.ox = mx-(mx-cx.ox)*(ns/cx.scale);
    cx.oy = my-(my-cx.oy)*(ns/cx.scale);
    cx.scale = ns;
    drawStepsCanvas();
  }, { passive:false });
}

function drawStepsCanvas() {
  const cvEl = document.getElementById('cv-steps'); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = planPx(cvEl), H = W;
  const cx = CV['steps'] || { scale:1, ox:0, oy:0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // Сетка
  const step = W/CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r*GRID_STEP)%1===0 && (c*GRID_STEP)%1===0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c*step, r*step, (isMajor?2:1.2)/cx.scale, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle='#999'; ctx.font=planFont(9, cx.scale); ctx.textAlign='center';
  for (let m=5; m<=GRID; m+=5) { const px = m/GRID*W; ctx.fillText(m+'м', px, H-3/cx.scale); }

  drawPreviousLayers(ctx, W, H, cx, 'steps');

  // Столбы ограждения террасы — к ним «залипают» перила лестницы (TODO.md 10).
  // Показываем, иначе снап выглядит как случайный рывок.
  for (const p of _railingPostsNorm()) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 3.5 / cx.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = 'rgba(122,75,35,.75)'; ctx.lineWidth = 1.5 / cx.scale; ctx.stroke();
  }

  // Ступени (текущая секция)
  const { x, y, w, h } = getStepsRectPx(W);
  ctx.fillStyle = 'rgba(220,140,0,.22)';
  ctx.fillRect(x, y, w, h);
  drawRectDims(ctx, cx, W, x / W, y / W, w / W, h / W);
  // Полоски-ступеньки для визуальной подсказки направления (по короткой стороне).
  const longAxisX = w >= h;
  const nStripes = 5;
  ctx.strokeStyle = 'rgba(180,90,0,.55)';
  ctx.lineWidth = 1.5/cx.scale;
  for (let i = 1; i < nStripes; i++) {
    ctx.beginPath();
    if (longAxisX) {
      const sy = y + h * i / nStripes;
      ctx.moveTo(x, sy); ctx.lineTo(x+w, sy);
    } else {
      const sx = x + w * i / nStripes;
      ctx.moveTo(sx, y); ctx.lineTo(sx, y+h);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#cc6600'; ctx.lineWidth = 2.5/cx.scale; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#cc6600'; ctx.font = planFont(11, cx.scale, 'bold'); ctx.textAlign = 'center';
  ctx.fillText('Ступени', x+w/2, y+h/2+4/cx.scale);

  // Handles
  for (const [hpx, hpy] of [[x,y], [x+w,y], [x,y+h], [x+w,y+h]]) {
    ctx.beginPath();
    ctx.arc(hpx, hpy, HANDLE_R/cx.scale, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#cc6600'; ctx.lineWidth = 2/cx.scale; ctx.stroke();
  }
  ctx.restore();
}

// ══════════════════════════════════════════════
// ПРЯМОУГОЛЬНЫЙ РЕДАКТОР: терраса/крыльцо, терраса у бассейна, причал
// (секции из RECT_SECTIONS — state.js). Один код на все три; отличие в том,
// пристраивается ли секция к дому (cfg.house).
// Каждый прямоугольник — {x,y,w,h} в нормализованных координатах 0..1.
// Активный (индекс в S[cfg.active]) показывает handles и drag'абелен.
// Клик по неактивному → активирует его. Клик по пустому месту → снимает выделение.
// ══════════════════════════════════════════════
const HANDLE_R = 18;
let trDrag = null;       // 'move' | 'nw' | 'ne' | 'sw' | 'se'
let trDragStart = null;  // { mx, my, x, y, w, h }
let trDragIdx = -1;      // индекс rect'а, который тащим
let trDragSec = null;    // секция, в которой идёт drag

// Snap нормализованной координаты к сетке 0.5 м.
function snapNorm(v) { return Math.round(v * GRID / SNAP) * SNAP / GRID; }

// Собирает координаты вертикальных (xs) и горизонтальных (ys) рёбер,
// к которым прилипают кромки rect'ов:
//   • рёбра дома (getHousePolygonNorm) — только для секций, пристроенных к дому
//     (terrace, а также ступени/грядки, которые зовут с secId по умолчанию);
//   • рёбра прямоугольников СВОЕЙ секции, КРОМЕ excludeIdx (редактируемый rect не
//     должен снапаться на собственные кромки; при редактировании ступеней/грядок
//     excludeIdx = -1 → все террасные rect'ы учитываются).
// Отдельно стоящая секция (pool_terrace) к дому не липнет.
function _snapTargets(excludeIdx, secId) {
  const sec = secId || 'terrace';
  const cfg = (typeof RECT_SECTIONS !== 'undefined') ? RECT_SECTIONS[sec] : null;
  const xs = [], ys = [];
  if ((!cfg || cfg.house) && !isEmptyLot()) {
    const hp = getHousePolygonNorm();
    for (const e of hp.edges) {
      if (e.axis === 'v') xs.push(e.coord);
      else if (e.axis === 'h') ys.push(e.coord);
    }
  }
  const rects = secRects(sec);
  for (let i = 0; i < rects.length; i++) {
    if (i === excludeIdx) continue;
    const r = rects[i];
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

// Ближайшая snap-цель к координате coord в пределах порога EDGE_SNAP_DIST; иначе null.
function _nearestTarget(coord, targets) {
  const thr = EDGE_SNAP_DIST / GRID;
  let best = null, bestD = thr;
  for (const t of targets) {
    const d = Math.abs(coord - t);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

// Унифицированный снап rect при drag. Возвращает {x,y,w,h} (нормализованные).
//   kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'
//   ds:   стартовое состояние {x,y,w,h}
//   dx,dy: смещение мыши (нормализованное)
//   excludeIdx: индекс rect'а секции, который НЕ участвует как цель снапа.
//   secId: секция снапа (по умолчанию terrace — так зовут ступени и грядки).
// Принцип: к стене/террасе липнет ТОЛЬКО движущаяся кромка; противоположная остаётся
// на сетке. Поэтому wall-snap НЕ перетирается финальным snapNorm, и дальние углы
// не уносит с сетки (исправление «снапается целиком»).
function snapDraggedRect(kind, ds, dx, dy, excludeIdx, secId) {
  const mn = SNAP / GRID;
  const { xs, ys } = _snapTargets(excludeIdx, secId);

  if (kind === 'move') {
    // Ближний угол (top-left) грид-снапим; дальний = left+ds.w (на сетке, если ds.w на сетке).
    let left = snapNorm(Math.max(0, Math.min(1 - ds.w, ds.x + dx)));
    let top  = snapNorm(Math.max(0, Math.min(1 - ds.h, ds.y + dy)));
    let right = left + ds.w, bottom = top + ds.h;
    // X: пробуем притянуть к стене ЛИБО левую, ЛИБО правую кромку (что ближе).
    const wL = _nearestTarget(left, xs), wR = _nearestTarget(right, xs);
    const okL = (wL !== null && wL < right - mn);
    const okR = (wR !== null && wR > left + mn);
    if (okL && (!okR || Math.abs(wL - left) <= Math.abs(wR - right))) left = wL;
    else if (okR) right = wR;
    // Y
    const wT = _nearestTarget(top, ys), wB = _nearestTarget(bottom, ys);
    const okT = (wT !== null && wT < bottom - mn);
    const okB = (wB !== null && wB > top + mn);
    if (okT && (!okB || Math.abs(wT - top) <= Math.abs(wB - bottom))) top = wT;
    else if (okB) bottom = wB;
    return { x: left, y: top, w: Math.max(mn, right - left), h: Math.max(mn, bottom - top) };
  }

  // resize: противоположный угол фиксирован (на сетке из ds), движется только dragged-угол.
  const movingRight  = (kind === 'ne' || kind === 'se');
  const movingBottom = (kind === 'sw' || kind === 'se');
  let left, right, top, bottom;

  if (movingRight) {
    left = ds.x;                                            // фиксирован, на сетке
    let r = snapNorm(ds.x + Math.max(mn, ds.w + dx));       // грид-кандидат
    const w = _nearestTarget(r, xs); if (w !== null && w > left + mn) r = w;  // wall имеет приоритет
    right = Math.max(left + mn, r);
  } else {
    right = ds.x + ds.w;                                    // фиксирован
    let l = snapNorm(Math.min(right - mn, ds.x + dx));
    const w = _nearestTarget(l, xs); if (w !== null && w < right - mn) l = w;
    left = Math.min(right - mn, l);
  }
  if (movingBottom) {
    top = ds.y;
    let b = snapNorm(ds.y + Math.max(mn, ds.h + dy));
    const w = _nearestTarget(b, ys); if (w !== null && w > top + mn) b = w;
    bottom = Math.max(top + mn, b);
  } else {
    bottom = ds.y + ds.h;
    let t = snapNorm(Math.min(bottom - mn, ds.y + dy));
    const w = _nearestTarget(t, ys); if (w !== null && w < bottom - mn) t = w;
    top = Math.min(bottom - mn, t);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function initRectCanvas(secId) {
  const wrap = document.getElementById('cw-' + secId);
  const cv   = document.getElementById('cv-' + secId);
  if (!wrap || !cv) return;
  CV[secId] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV[secId]);

  // Если rects пуст — создаём дефолтный (у дома / в свободном месте участка).
  const rects = secRects(secId);
  if (rects.length === 0) {
    rects.push(_defaultRect(secId));
    setSecActiveIdx(secId, 0);
  } else {
    const act = secActiveIdx(secId);
    if (act === null || act >= rects.length) setSecActiveIdx(secId, 0);
  }
  // НЕ переснапиваем существующие rects на сетку при открытии: они уже корректно
  // расставлены при создании/перетаскивании (на сетке ИЛИ вплотную к стене дома,
  // которая обычно не на сетке 0.5 м). Грид-снап здесь отрывал террасу от стены
  // («съезжала» при повторном редактировании).

  const newCv = cv.cloneNode(false);
  wrap.replaceChild(newCv, cv);
  fitCanvasToWrap(wrap, newCv, CV[secId]);   // клон заменил канвас — размеры задаём ему

  drawRectCanvas(secId);
  attachRectEvents(wrap, secId);
}

// Дефолтный прямоугольник секции 4×2 м. Терраса/крыльцо — вплотную к нижней стене
// дома; отдельно стоящие (бассейн, причал) — в стороне от дома, с отступом 3 м,
// чтобы не пересекаться с ним и друг с другом.
function _defaultRect(secId) {
  const w0 = snapNorm(4 / GRID), h0 = snapNorm(2 / GRID);
  const hp = (typeof getHousePolygonNorm === 'function' && !isEmptyLot())
    ? getHousePolygonNorm() : null;
  const b = hp && hp.bboxNorm;
  const gap = 3 / GRID;
  const clamp = (v, size) => Math.max(0, Math.min(1 - size, v));

  if (secId === 'pool_terrace') {
    return b
      ? { x: snapNorm(clamp(b.nx - w0 - gap, w0)), y: snapNorm(clamp(b.ny, h0)), w: w0, h: h0 }
      : { x: snapNorm(0.12), y: snapNorm(0.25), w: w0, h: h0 };
  }
  // terrace — у нижнего края дома, по центру фасада.
  if (b) {
    return {
      x: snapNorm(b.nx + b.nw / 2 - 2 / GRID),
      y: snapNorm(b.ny + b.nh),
      w: w0, h: snapNorm(2 / GRID),
    };
  }
  return { x: snapNorm(0.4), y: snapNorm(0.5), w: w0, h: snapNorm(2 / GRID) };
}

// Добавляет новый rect рядом с активным (или в центре, если нет активного).
function addRect(secId) {
  const rects = secRects(secId);
  const mn = SNAP / GRID;
  const w0 = snapNorm(3 / GRID), h0 = snapNorm(2 / GRID);
  const act = secActiveIdx(secId);
  let nx, ny;
  if (act !== null && rects[act]) {
    const a = rects[act];
    nx = snapNorm(a.x + a.w + mn);  // справа от активного
    ny = a.y;
    if (nx + w0 > 1) { nx = snapNorm(Math.max(0, a.x - w0 - mn)); }
  } else {
    const d = _defaultRect(secId);
    nx = d.x; ny = d.y;
  }
  rects.push({ x: nx, y: ny, w: w0, h: h0 });
  setSecActiveIdx(secId, rects.length - 1);
  drawRectCanvas(secId);
}

function delActiveRect(secId) {
  const rects = secRects(secId);
  const act = secActiveIdx(secId);
  if (act === null || !rects.length) return;
  rects.splice(act, 1);
  setSecActiveIdx(secId, rects.length ? Math.min(act, rects.length - 1) : null);
  drawRectCanvas(secId);
}

// Определяет, по какому элементу попал клик: индекс rect и тип взаимодействия.
//   Возвращает {idx, kind: 'nw'|'ne'|'sw'|'se'|'move'} или null.
//   Сначала проверяем handles активного rect (приоритет — он сверху).
function hitRect(secId, wx, wy, W) {
  const rects = secRects(secId);
  const act = secActiveIdx(secId);
  // Hitbox handle = визуальный радиус кружка В МИРОВЫХ координатах. Кружок рисуется
  // как HANDLE_R / scale (см. drawRectCanvas), поэтому и зона попадания должна
  // делиться на scale — иначе при зуме-аут клик по видимому кружку промахивается
  // мимо угла (срывается захват / вместо resize получается move).
  const sc = (CV[secId] && CV[secId].scale) || 1;
  const R = HANDLE_R / sc;
  // 1. Handles активного rect (приоритет).
  if (act !== null && rects[act]) {
    const r = rects[act];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    for (const [k, cx, cy] of [['nw',rx,ry], ['ne',rx+rw,ry], ['sw',rx,ry+rh], ['se',rx+rw,ry+rh]]) {
      if (Math.hypot(wx - cx, wy - cy) < R) return { idx: act, kind: k };
    }
  }
  // 2. Тело любого rect (от верхнего к нижнему — берём активный первым).
  const order = [];
  if (act !== null) order.push(act);
  for (let i = 0; i < rects.length; i++) if (i !== act) order.push(i);
  for (const i of order) {
    const r = rects[i];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    if (wx >= rx && wx <= rx + rw && wy >= ry && wy <= ry + rh) {
      return { idx: i, kind: 'move' };
    }
  }
  return null;
}

// ── БАССЕЙН на плане (TODO.md, этап 2 п.14) ──
// Перетаскивание за тело, изменение размера — за правый нижний угол.
let _poolDrag = null;

function _poolHit(nx, ny, scale) {
  const p = S.pool;
  if (!p) return null;
  const R = (HANDLE_R / scale) / planPx(document.getElementById('cv-pool_terrace') || {});
  const hr = Math.max(0.012, R || 0.012);
  if (Math.hypot(nx - (p.x + p.w), ny - (p.y + p.h)) < hr) return 'resize';
  if (p.kind === 'round') {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    return (Math.hypot(nx - cx, ny - cy) <= p.w / 2) ? 'move' : null;
  }
  return (nx >= p.x && nx <= p.x + p.w && ny >= p.y && ny <= p.y + p.h) ? 'move' : null;
}

function applyPoolDrag(nx, ny) {
  const d = _poolDrag; if (!d || !S.pool) return;
  const dx = nx - d.mx, dy = ny - d.my;
  const MIN = 1.0 / GRID;                        // минимальный габарит бассейна — 1 м
  if (d.kind === 'move') {
    S.pool.x = snapNorm(d.p.x + dx);
    S.pool.y = snapNorm(d.p.y + dy);
  } else {
    let w = Math.max(MIN, snapNorm(d.p.w + dx));
    let h = Math.max(MIN, snapNorm(d.p.h + dy));
    if (S.pool.kind === 'round') { const s2 = Math.max(w, h); w = s2; h = s2; }
    S.pool.w = w; S.pool.h = h;
  }
  drawRectCanvas('pool_terrace');
}

// Бассейн по умолчанию — по центру первого блока террасы у бассейна.
function poolDefault(kind) {
  const rects = secRects('pool_terrace');
  const r = rects && rects.length ? rects[0] : null;
  const size = Math.min(3.0 / GRID, r ? Math.min(r.w, r.h) * 0.6 : 3.0 / GRID);
  const cx = r ? r.x + r.w / 2 : 0.5, cy = r ? r.y + r.h / 2 : 0.5;
  return { kind, x: snapNorm(cx - size / 2), y: snapNorm(cy - size / 2),
           w: snapNorm(size), h: snapNorm(size) };
}

function applyRectDrag(secId, wx, wy, W) {
  const rects = secRects(secId);
  if (trDragIdx < 0 || !rects[trDragIdx]) return;
  const ds = trDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  const r = rects[trDragIdx];
  // excludeIdx = trDragIdx — редактируемый rect не снапается на свои кромки.
  const res = snapDraggedRect(trDrag, ds, dx, dy, trDragIdx, secId);
  r.x = res.x; r.y = res.y; r.w = res.w; r.h = res.h;
  drawRectCanvas(secId);
}

function attachRectEvents(wrap, secId) {
  // Слушатели вешаются на wrap/document ОДИН РАЗ. Раньше attach вызывался при каждом
  // открытии редактора → дубли слушателей и захват устаревшего cx из замыкания
  // (срыв захвата / двойная обработка). Теперь guard + чтение CV[secId] свежим.
  if (wrap._rectBound) return;
  wrap._rectBound = true;
  let touchId = null;
  let pinchActive = false;
  const redraw = () => drawRectCanvas(secId);

  const getWorld = (clientX, clientY) => {
    const cx = CV[secId] || { ox: 0, oy: 0, scale: 1 };
    const cvEl = document.getElementById('cv-' + secId);
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    return {
      x: ((clientX - r.left)*dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top )*dpr - cx.oy) / cx.scale,
      W: planPx(cvEl),
    };
  };

  const startDrag = (worldX, worldY, W) => {
    // Бассейн лежит поверх настила — проверяем его раньше блоков (этап 2 п.14).
    if (secId === 'pool_terrace' && S.pool) {
      const ph = _poolHit(worldX / W, worldY / W, (CV[secId] && CV[secId].scale) || 1);
      if (ph) {
        _poolDrag = { kind: ph, mx: worldX / W, my: worldY / W, p: { ...S.pool } };
        return true;
      }
    }
    const hit = hitRect(secId, worldX, worldY, W);
    if (!hit) {
      // Клик в пустое место — снимаем активность.
      setSecActiveIdx(secId, null);
      redraw();
      return false;
    }
    // Если клик по неактивному rect — сначала активируем его (без drag).
    if (hit.idx !== secActiveIdx(secId) && hit.kind === 'move') {
      setSecActiveIdx(secId, hit.idx);
      redraw();
      // Drag разрешаем сразу — пользователь может тащить активный rect.
    }
    const r = secRects(secId)[hit.idx];
    trDrag = hit.kind;
    trDragIdx = hit.idx;
    trDragSec = secId;
    trDragStart = { mx: worldX, my: worldY, x: r.x, y: r.y, w: r.w, h: r.h };
    return true;
  };

  // ── TOUCH ──
  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    const cx = CV[secId]; if (!cx) return;
    if (e.touches.length === 2) {
      pinchActive = true; trDrag = null; touchId = null;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      const {x, y, W} = getWorld(t.clientX, t.clientY);
      if (startDrag(x, y, W)) touchId = t.identifier;
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    const cx = CV[secId]; if (!cx) return;
    if (pinchActive && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
      const mx = (mid.x - r.left)*dpr, my = (mid.y - r.top)*dpr;
      const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * ratio));
      cx.ox = mx - (mx - cx.ox)*(ns/cx.scale);
      cx.oy = my - (my - cx.oy)*(ns/cx.scale);
      cx.scale = ns;
      redraw(); return;
    }
    if (trDrag && trDragSec === secId && touchId !== null) {
      const t = [...e.touches].find(t => t.identifier === touchId); if (!t) return;
      const {x, y, W} = getWorld(t.clientX, t.clientY);
      applyRectDrag(secId, x, y, W);
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) {
      trDrag = null; trDragStart = null; trDragIdx = -1; trDragSec = null; touchId = null;
    }
  }, { passive: true });

  // ── МЫШЬ ──
  attachMousePan(wrap, secId, redraw);   // ПКМ — перемещение плана
  wrap.addEventListener('mousedown', e => {
    // Реагируем только когда открыт СВОЙ редактор (слушатель на wrap живёт всегда).
    if (e.button !== 0) return;                          // ЛКМ — инструмент, ПКМ — pan
    if (!CV[secId] || !document.getElementById('d-canvas-' + secId)?.classList.contains('active')) return;
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    if (startDrag(x, y, W)) {
      wrap.style.cursor = (trDrag === 'move') ? 'move' : 'nwse-resize';
    }
  });
  document.addEventListener('mousemove', e => {
    if (_poolDrag && secId === 'pool_terrace') {
      const {x, y, W} = getWorld(e.clientX, e.clientY);
      applyPoolDrag(x / W, y / W);
      return;
    }
    if (!trDrag || trDragSec !== secId) return;
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    applyRectDrag(secId, x, y, W);
  });
  document.addEventListener('mouseup', () => {
    if (_poolDrag && secId === 'pool_terrace') {
      _poolDrag = null;
      wrap.style.cursor = '';
      if (typeof onParamChange === 'function') onParamChange();
      return;
    }
    if (!trDrag || trDragSec !== secId) return;
    trDrag = null; trDragStart = null; trDragIdx = -1; trDragSec = null;
    wrap.style.cursor = '';   // вернуть курсор из стилей (.d-canvas-area)
  });

  // Колесо → zoom
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const cx = CV[secId]; if (!cx) return;
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    const mx = (e.clientX - r.left)*dpr, my = (e.clientY - r.top)*dpr;
    const f = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * f));
    cx.ox = mx - (mx - cx.ox)*(ns/cx.scale);
    cx.oy = my - (my - cx.oy)*(ns/cx.scale);
    cx.scale = ns;
    redraw();
  }, { passive: false });
}

function drawRectCanvas(secId) {
  const cfg = RECT_SECTIONS[secId]; if (!cfg) return;
  const cvEl = document.getElementById('cv-' + secId); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = planPx(cvEl), H = W;
  const cx = CV[secId] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // Сетка
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * GRID_STEP) % 1 === 0 && (c * GRID_STEP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath();
    ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // Метки метров
  ctx.fillStyle = '#999'; ctx.font = planFont(9, cx.scale); ctx.textAlign = 'center';
  for (let m = 5; m <= GRID; m += 5) {
    const px = m / GRID * W;
    ctx.fillText(m + 'м', px, H - 3 / cx.scale);
  }

  drawPreviousLayers(ctx, W, H, cx, secId);

  // Rects
  const rects = secRects(secId);
  const act = secActiveIdx(secId);
  // Выбранный объект выделяется акцентным цветом (по макету), остальные —
  // приглушённым цветом своей секции.
  const COL = DIM_COL;
  const COL_INACTIVE = cfg.stroke;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const isActive = (i === act);
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    ctx.fillStyle = isActive ? 'rgba(242,114,44,.18)' : cfg.fill;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = isActive ? COL : COL_INACTIVE;
    ctx.lineWidth = (isActive ? 2.5 : 1.8) / cx.scale;
    if (!isActive) ctx.setLineDash([6/cx.scale, 3/cx.scale]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
  }
  // Размеры каждого прямоугольника
  for (const r of rects) drawRectDims(ctx, cx, W, r.x, r.y, r.w, r.h);

  // Подпись общая
  if (rects.length) {
    let bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
    for (const r of rects) {
      if (r.x < bx0) bx0 = r.x; if (r.y < by0) by0 = r.y;
      if (r.x + r.w > bx1) bx1 = r.x + r.w;
      if (r.y + r.h > by1) by1 = r.y + r.h;
    }
    ctx.fillStyle = COL_INACTIVE;
    ctx.font = planFont(11, cx.scale, 'bold');
    ctx.textAlign = 'center';
    ctx.fillText(cfg.label, (bx0+bx1)/2*W, (by0+by1)/2*H);
  }

  // Handles только у активного rect
  if (act !== null && rects[act]) {
    const r = rects[act];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    for (const [hpx, hpy] of [[rx,ry], [rx+rw,ry], [rx,ry+rh], [rx+rw,ry+rh]]) {
      ctx.beginPath();
      ctx.arc(hpx, hpy, HANDLE_R / cx.scale, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = COL; ctx.lineWidth = 2 / cx.scale; ctx.stroke();
    }
  }

  // Бассейн (TODO.md, этап 2 п.14): рисуем поверх настила, с ручкой в правом
  // нижнем углу — за неё меняется размер, за тело перетаскивается.
  if (secId === 'pool_terrace' && S.pool) {
    const p = S.pool;
    ctx.fillStyle = 'rgba(47,127,168,.35)';
    ctx.strokeStyle = '#2f7fa8';
    ctx.lineWidth = 2.5 / cx.scale;
    ctx.beginPath();
    if (p.kind === 'round') {
      ctx.ellipse((p.x + p.w / 2) * W, (p.y + p.h / 2) * H, p.w / 2 * W, p.h / 2 * H, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x * W, p.y * H, p.w * W, p.h * H);
    }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2f7fa8';
    ctx.font = planFont(10, cx.scale, 'bold'); ctx.textAlign = 'center';
    ctx.fillText('Бассейн ' + (p.w * GRID).toFixed(1) + '×' + (p.h * GRID).toFixed(1) + ' м',
                 (p.x + p.w / 2) * W, (p.y + p.h / 2) * H + 4 / cx.scale);
    ctx.beginPath();
    ctx.arc((p.x + p.w) * W, (p.y + p.h) * H, HANDLE_R / cx.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#2f7fa8'; ctx.lineWidth = 2 / cx.scale; ctx.stroke();
  }

  // Подсказка если пусто
  if (!rects.length) {
    ctx.fillStyle = '#aaa';
    ctx.font = planFont(13, cx.scale);
    ctx.textAlign = 'center';
    ctx.fillText('Нажмите «ЕЩЁ ОДНА» чтобы разметить объект', W/2, H * 0.92);
  }

  ctx.restore();
}

// ══════════════════════════════════════════════
// ГРЯДКИ: размещение rect'ов фиксированного размера 3×1 м
// Размер не меняется (resize запрещён) — только перемещение (drag тела) и
// поворот на 90° (кнопка). Ориентация ортогональная: длинная сторона (3 м)
// вдоль X (w>h) или вдоль Y (w<h). Высота борта в редакторе НЕ задаётся — её, как
// цвет и крепёж, выбирают на карточке товара (см. TODO.md); до выбора товара 3D
// показывает габаритный прямоугольник.
// ══════════════════════════════════════════════
const BED_LEN = 3;   // длина грядки, м
const BED_WID = 1;   // ширина грядки, м
let bedDrag = null;       // 'move' | null
let bedDragStart = null;  // { mx, my, x, y, w, h }
let bedDragIdx = -1;

// Размеры rect'а в нормализованных координатах по ориентации.
//   horizontal=true  → длинная сторона (3 м) вдоль X.
function _bedDims(horizontal) {
  return horizontal
    ? { w: BED_LEN / GRID, h: BED_WID / GRID }
    : { w: BED_WID / GRID, h: BED_LEN / GRID };
}

function _clampBedPos(x, y, w, h) {
  return {
    x: Math.max(0, Math.min(1 - w, x)),
    y: Math.max(0, Math.min(1 - h, y)),
  };
}

// Грядка по умолчанию — горизонтальная, у нижней кромки дома.
function _defaultBed() {
  const d = _bedDims(true);
  const hp = (typeof getHousePolygonNorm === 'function') ? getHousePolygonNorm() : null;
  let x, y;
  if (hp && hp.bboxNorm) {
    const b = hp.bboxNorm;
    x = snapNorm(b.nx + b.nw / 2 - d.w / 2);
    y = snapNorm(b.ny + b.nh + 1 / GRID);   // на 1 м ниже дома
  } else {
    x = snapNorm(0.4); y = snapNorm(0.6);
  }
  const c = _clampBedPos(x, y, d.w, d.h);
  return { x: c.x, y: c.y, w: d.w, h: d.h };
}

function initBedsCanvas() {
  const wrap = document.getElementById('cw-beds');
  const cv   = document.getElementById('cv-beds');
  CV['beds'] = mkCvState();
  fitCanvasToWrap(wrap, cv, CV['beds']);

  if (!S.beds || S.beds.length === 0) {
    S.beds = [_defaultBed()];
    S.activeBed = 0;
  } else if (S.activeBed === null || S.activeBed >= S.beds.length) {
    S.activeBed = 0;
  }
  // НЕ переснапиваем грядки на сетку при открытии — сохраняем позицию, к которой
  // их прижали (сетка или стена/кромка), иначе «съезжают» при повторном открытии.


  const newCv = cv.cloneNode(false);
  wrap.replaceChild(newCv, cv);
  fitCanvasToWrap(wrap, newCv, CV['beds']);   // клон заменил канвас — размеры задаём ему

  drawBedsCanvas();
  attachBedsEvents(wrap);
}

function addBed() {
  if (!S.beds) S.beds = [];
  const mn = SNAP / GRID;
  const d = _bedDims(true);
  let nx, ny;
  if (S.activeBed !== null && S.beds[S.activeBed]) {
    const a = S.beds[S.activeBed];
    nx = snapNorm(a.x + a.w + mn);       // справа от активной
    ny = a.y;
    if (nx + d.w > 1) nx = snapNorm(Math.max(0, a.x - d.w - mn));
  } else {
    nx = snapNorm(0.4); ny = snapNorm(0.55);
  }
  const c = _clampBedPos(nx, ny, d.w, d.h);
  S.beds.push({ x: c.x, y: c.y, w: d.w, h: d.h });
  S.activeBed = S.beds.length - 1;
  drawBedsCanvas();
}

function delActiveBed() {
  if (!S.beds || S.activeBed === null) return;
  S.beds.splice(S.activeBed, 1);
  S.activeBed = S.beds.length ? Math.min(S.activeBed, S.beds.length - 1) : null;
  drawBedsCanvas();
}

// Поворот активной грядки на 90° вокруг её центра (swap w↔h).
function rotateActiveBed() {
  if (S.activeBed === null || !S.beds[S.activeBed]) return;
  const b = S.beds[S.activeBed];
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const nw = b.h, nh = b.w;
  const c = _clampBedPos(snapNorm(cx - nw / 2), snapNorm(cy - nh / 2), nw, nh);
  b.w = nw; b.h = nh; b.x = c.x; b.y = c.y;
  drawBedsCanvas();
}

function hitBeds(wx, wy, W) {
  const beds = S.beds || [];
  const order = [];
  if (S.activeBed !== null) order.push(S.activeBed);
  for (let i = 0; i < beds.length; i++) if (i !== S.activeBed) order.push(i);
  for (const i of order) {
    const b = beds[i];
    const rx = b.x * W, ry = b.y * W, rw = b.w * W, rh = b.h * W;
    if (wx >= rx && wx <= rx + rw && wy >= ry && wy <= ry + rh) return { idx: i, kind: 'move' };
  }
  return null;
}

// Перемещение грядки целиком (размер фиксирован). Прилипание любой кромки к
// сетке + рёбрам дома/террас (через _snapTargets), w/h не меняются.
function snapBedMove(ds, dx, dy) {
  const { xs, ys } = _snapTargets(-1);
  let left = snapNorm(Math.max(0, Math.min(1 - ds.w, ds.x + dx)));
  let top  = snapNorm(Math.max(0, Math.min(1 - ds.h, ds.y + dy)));
  const right = left + ds.w, bottom = top + ds.h;
  const wL = _nearestTarget(left, xs), wR = _nearestTarget(right, xs);
  if (wL !== null && (wR === null || Math.abs(wL - left) <= Math.abs(wR - right))) left = wL;
  else if (wR !== null) left = wR - ds.w;
  const wT = _nearestTarget(top, ys), wB = _nearestTarget(bottom, ys);
  if (wT !== null && (wB === null || Math.abs(wT - top) <= Math.abs(wB - bottom))) top = wT;
  else if (wB !== null) top = wB - ds.h;
  const c = _clampBedPos(left, top, ds.w, ds.h);
  return { x: c.x, y: c.y, w: ds.w, h: ds.h };
}

// Грядку реально сдвинули? Нужен, чтобы отличить клик (разворот на 90°, TODO.md
// этап 2 п.12) от перетаскивания.
let _bedMoved = false;

function applyBedDrag(wx, wy, W) {
  if (bedDragIdx < 0 || !S.beds[bedDragIdx]) return;
  const ds = bedDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  if (Math.hypot(dx, dy) > 0.002) _bedMoved = true;   // ~6 см на плане
  const res = snapBedMove(ds, dx, dy);
  const b = S.beds[bedDragIdx];
  b.x = res.x; b.y = res.y; b.w = res.w; b.h = res.h;
  drawBedsCanvas();
}

function attachBedsEvents(wrap) {
  if (wrap._bedsBound) return;
  wrap._bedsBound = true;
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cx = CV['beds'] || { ox: 0, oy: 0, scale: 1 };
    const cvEl = document.getElementById('cv-beds');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    return {
      x: ((clientX - r.left) * dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top ) * dpr - cx.oy) / cx.scale,
      W: planPx(cvEl),
    };
  };
  const bedsActive = () =>
    CV['beds'] && document.getElementById('d-canvas-beds')?.classList.contains('active');

  const startDrag = (worldX, worldY, W) => {
    const hit = hitBeds(worldX, worldY, W);
    if (!hit) { S.activeBed = null; drawBedsCanvas(); return false; }
    if (hit.idx !== S.activeBed) { S.activeBed = hit.idx; drawBedsCanvas(); }
    const b = S.beds[hit.idx];
    bedDrag = 'move'; bedDragIdx = hit.idx;
    bedDragStart = { mx: worldX, my: worldY, x: b.x, y: b.y, w: b.w, h: b.h };
    _bedMoved = false;
    return true;
  };

  // Клик по грядке БЕЗ перетаскивания разворачивает её на 90° (TODO.md, этап 2 п.12).
  // Отличаем клик от перетаскивания по факту сдвига: applyBedDrag ставит _bedMoved.
  const endBedDrag = () => {
    if (!bedDrag) return;
    const wasIdx = bedDragIdx;
    bedDrag = null; bedDragStart = null; bedDragIdx = -1;
    wrap.style.cursor = '';
    if (!_bedMoved && wasIdx >= 0) { S.activeBed = wasIdx; rotateActiveBed(); }
    else if (typeof onParamChange === 'function') onParamChange();
  };

  // ── TOUCH ──
  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    const cx = CV['beds']; if (!cx) return;
    if (e.touches.length === 2) {
      pinchActive = true; bedDrag = null; touchId = null;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      const { x, y, W } = getWorld(t.clientX, t.clientY);
      if (startDrag(x, y, W)) touchId = t.identifier;
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    const cx = CV['beds']; if (!cx) return;
    if (pinchActive && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const mx = (mid.x - r.left) * dpr, my = (mid.y - r.top) * dpr;
      const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * ratio));
      cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
      cx.oy = my - (my - cx.oy) * (ns / cx.scale);
      cx.scale = ns;
      drawBedsCanvas(); return;
    }
    if (bedDrag && touchId !== null) {
      const t = [...e.touches].find(t => t.identifier === touchId); if (!t) return;
      const { x, y, W } = getWorld(t.clientX, t.clientY);
      applyBedDrag(x, y, W);
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) { bedDrag = null; bedDragStart = null; bedDragIdx = -1; touchId = null; }
  }, { passive: true });

  // ── МЫШЬ ──
  attachMousePan(wrap, 'beds', drawBedsCanvas);   // ПКМ — перемещение плана
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0 || !bedsActive()) return;  // ЛКМ — инструмент, ПКМ — pan
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    if (startDrag(x, y, W)) wrap.style.cursor = 'move';
  });
  document.addEventListener('mousemove', e => {
    if (!bedDrag) return;
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    applyBedDrag(x, y, W);
  });
  document.addEventListener('mouseup', endBedDrag);

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const cx = CV['beds']; if (!cx) return;
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    const f = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * f));
    cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
    cx.oy = my - (my - cx.oy) * (ns / cx.scale);
    cx.scale = ns;
    drawBedsCanvas();
  }, { passive: false });
}

function drawBedsCanvas() {
  const cvEl = document.getElementById('cv-beds'); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = planPx(cvEl), H = W;
  const cx = CV['beds'] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // Сетка
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * GRID_STEP) % 1 === 0 && (c * GRID_STEP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#999'; ctx.font = planFont(9, cx.scale); ctx.textAlign = 'center';
  for (let m = 5; m <= GRID; m += 5) { const px = m / GRID * W; ctx.fillText(m + 'м', px, H - 3 / cx.scale); }

  drawPreviousLayers(ctx, W, H, cx, 'beds');

  // Грядки (текущая секция)
  const beds = S.beds || [];
  const COL = '#7a4b23';          // дерево борта
  const COL_SOIL = 'rgba(60,38,18,.45)';
  for (let i = 0; i < beds.length; i++) {
    const b = beds[i];
    const isActive = (i === S.activeBed);
    const rx = b.x * W, ry = b.y * W, rw = b.w * W, rh = b.h * W;
    // Борт
    ctx.fillStyle = isActive ? 'rgba(122,75,35,.30)' : 'rgba(122,75,35,.16)';
    ctx.fillRect(rx, ry, rw, rh);
    // Земля (внутренняя вставка ~8 см от борта)
    const inN = 0.08 / GRID * W;
    if (rw > inN * 2.5 && rh > inN * 2.5) {
      ctx.fillStyle = COL_SOIL;
      ctx.fillRect(rx + inN, ry + inN, rw - inN * 2, rh - inN * 2);
    }
    ctx.strokeStyle = COL; ctx.lineWidth = (isActive ? 2.6 : 1.8) / cx.scale;
    if (!isActive) ctx.setLineDash([6 / cx.scale, 3 / cx.scale]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.fillStyle = COL; ctx.font = planFont(10, cx.scale, 'bold'); ctx.textAlign = 'center';
    ctx.fillText(`${BED_LEN}×${BED_WID} м`, rx + rw / 2, ry + rh / 2 + 4 / cx.scale);
  }

  if (!beds.length) {
    ctx.fillStyle = '#aaa'; ctx.font = planFont(13, cx.scale); ctx.textAlign = 'center';
    ctx.fillText('Нажмите «＋ Грядка» чтобы добавить', W / 2, H * 0.92);
  }

  ctx.restore();
}

// ══════════════════════════════════════════════
