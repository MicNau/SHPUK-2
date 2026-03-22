// ══════════════════════════════════════════════
// CANVAS.JS — pan/zoom движок, snap-canvas, крыльцо
// Зависимости: state.js (S, CV, GRID, HANDLE_R, porchDrag, porchDragStart)
// ══════════════════════════════════════════════

const CV = {};
const GRID = 16;

// ── Pan/zoom состояние ───────────────────────
function mkCvState() {
  return {
    scale: 1, ox: 0, oy: 0,
    minScale: 0.5, maxScale: 4,
    dragging: false, lastX: 0, lastY: 0,
    pinching: false, lastDist: 0,
  };
}

function applyTransform(ctx, cx, W, H) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(cx.ox, cx.oy);
  ctx.scale(cx.scale, cx.scale);
}

// ── Общий pan/zoom обработчик ────────────────
function attachPanZoom(el, cvName, onRedraw) {
  const cx = CV[cvName];

  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      cx.pinching = true; cx.dragging = false;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1 && !cx.pinching) {
      cx.dragging = true;
      cx.lastX = e.touches[0].clientX;
      cx.lastY = e.touches[0].clientY;
    }
  }, {passive: true});

  el.addEventListener('touchmove', e => {
    if (cx.pinching && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const mx = (mid.x - r.left) * dpr, my = (mid.y - r.top) * dpr;
      const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * ratio));
      cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
      cx.oy = my - (my - cx.oy) * (ns / cx.scale);
      cx.scale = ns;
      onRedraw();
    } else if (cx.dragging && e.touches.length === 1 && !cx.pinching) {
      const dpr = window.devicePixelRatio || 1;
      cx.ox += (e.touches[0].clientX - cx.lastX) * dpr;
      cx.oy += (e.touches[0].clientY - cx.lastY) * dpr;
      cx.lastX = e.touches[0].clientX;
      cx.lastY = e.touches[0].clientY;
      onRedraw();
    }
    e.preventDefault();
  }, {passive: false});

  el.addEventListener('touchend', e => {
    if (e.touches.length < 2) cx.pinching = false;
    if (e.touches.length === 0) cx.dragging = false;
  }, {passive: true});

  el.addEventListener('wheel', e => {
    e.preventDefault();
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    const f = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * f));
    cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
    cx.oy = my - (my - cx.oy) * (ns / cx.scale);
    cx.scale = ns;
    onRedraw();
  }, {passive: false});
}

// ══════════════════════════════════════════════
// SNAP-CANVAS (терраса, pool, pier, fence, paths)
// ══════════════════════════════════════════════
function initSnapCanvas(name) {
  const wrap = document.getElementById('cw-' + name);
  const cv   = document.getElementById('cv-' + name);
  const dpr  = window.devicePixelRatio || 1;
  const sz   = wrap.offsetWidth;
  cv.width   = sz * dpr;
  cv.height  = sz * dpr;
  cv.style.width  = sz + 'px';
  cv.style.height = sz + 'px';
  CV[name] = mkCvState();

  drawSnapCanvas(name);

  // Заменяем canvas чтобы сбросить все старые слушатели
  const newCv = cv.cloneNode(true);
  wrap.replaceChild(newCv, cv);

  attachPanZoom(wrap, name, () => drawSnapCanvas(name));

  // Клик — добавить точку со snap к сетке
  wrap.addEventListener('click', e => {
    if (CV[name].pinching) return;
    const cvEl = document.getElementById('cv-' + name); if (!cvEl) return;
    const r  = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const sx = (e.clientX - r.left) * dpr;
    const sy = (e.clientY - r.top)  * dpr;
    const cx = CV[name];
    const wx = (sx - cx.ox) / cx.scale;
    const wy = (sy - cx.oy) / cx.scale;
    const W  = cvEl.width;
    const gridStep = W / GRID;
    S.pts[name].push({
      x: Math.round(wx / gridStep) * gridStep / W,
      y: Math.round(wy / gridStep) * gridStep / W,
    });
    drawSnapCanvas(name);
  });
}

function drawSnapCanvas(name) {
  const cvEl = document.getElementById('cv-' + name); if (!cvEl) return;
  const ctx  = cvEl.getContext('2d');
  const W    = cvEl.width, H = cvEl.height;
  const cx   = CV[name] || {scale: 1, ox: 0, oy: 0};
  const pts  = S.pts[name] || [];

  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(0, 0, W, H);

  // Сетка
  const gridStep = W / GRID;
  ctx.fillStyle = name === 'fence' ? '#999' : '#bbb';
  for (let r = 0; r <= GRID; r++) {
    for (let c = 0; c <= GRID; c++) {
      ctx.beginPath();
      ctx.arc(c * gridStep, r * gridStep, 3 / cx.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (name === 'fence') {
    ctx.fillStyle = '#888';
    ctx.font = `${11 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    for (let i = 1; i <= GRID; i++)
      ctx.fillText(i + 'м', i * gridStep, H - 4 / cx.scale);
  }

  // Фон террасы на шаге крыльца (name === 'porch' здесь не бывает,
  // но оставлено на случай расширения)
  if (name === 'porch' && S.pts.terrace && S.pts.terrace.length > 2) {
    _drawTerraceGhost(ctx, W, H, cx);
  }

  // Контур дома / участка
  if (!['fence', 'paths'].includes(name)) {
    const hx = 0.15 * W, hy = 0.15 * H, hw = 0.7 * W, hh = 0.7 * H;
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2.5 / cx.scale;
    ctx.setLineDash([]);
    ctx.strokeRect(hx, hy, hw, hh);
    ctx.fillStyle = 'rgba(0,0,0,.04)';
    ctx.fillRect(hx, hy, hw, hh);
    ctx.fillStyle = '#999';
    ctx.font = `${14 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    const labels = {
      terrace: 'Дом', pool_terrace: 'Бассейн / Дом',
      pier: 'Участок у воды', fence: 'Участок',
    };
    ctx.fillText(labels[name] || 'Дом', W / 2, H / 2);
  }

  // Подсказка если нет точек
  if (!pts.length) {
    ctx.fillStyle = '#aaa';
    ctx.font = `${13 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    const hints = {
      terrace: 'Нажмите чтобы поставить угол',
      pool_terrace: 'Нажмите чтобы поставить угол',
      pier: 'Нажмите чтобы поставить угол',
      fence: 'Нажмите чтобы поставить угол',
      paths: 'Нажмите точки вдоль дорожки',
    };
    ctx.fillText(hints[name] || 'Нажмите чтобы поставить точку', W / 2, H * 0.85);
    ctx.restore();
    return;
  }

  // Контур фигуры
  const color = {
    terrace: '#000', pool_terrace: '#0050CC',
    pier: '#1a7acc', paths: '#336600', fence: '#000',
  }[name] || '#000';

  ctx.beginPath();
  ctx.moveTo(pts[0].x * W, pts[0].y * H);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
  if (name !== 'paths' && pts.length > 2) {
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 / cx.scale;
  ctx.stroke();

  // Точки с номерами
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 8 / cx.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5 / cx.scale; ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${10 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    ctx.fillText(i + 1, p.x * W, p.y * H + 4 / cx.scale);
  });

  ctx.restore();
}

function undoPt(n) { S.pts[n].pop(); drawSnapCanvas(n); }
function clrPts(n) { S.pts[n] = []; drawSnapCanvas(n); }

// Дорожки используют тот же snap-canvas
function initPathsCanvas() { initSnapCanvas('paths'); }

// ── Внутренняя утилита: призрак террасы ──────
function _drawTerraceGhost(ctx, W, H, cx) {
  const tp = S.pts.terrace;
  ctx.beginPath();
  ctx.moveTo(tp[0].x * W, tp[0].y * H);
  for (let i = 1; i < tp.length; i++) ctx.lineTo(tp[i].x * W, tp[i].y * H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,150,80,.12)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,150,80,.5)';
  ctx.lineWidth = 2 / cx.scale;
  ctx.setLineDash([6 / cx.scale, 3 / cx.scale]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,150,80,.6)';
  ctx.font = `${11 / cx.scale}px Roboto`;
  ctx.textAlign = 'center';
  const tx = tp.reduce((s, p) => s + p.x, 0) / tp.length * W;
  const ty = tp.reduce((s, p) => s + p.y, 0) / tp.length * H;
  ctx.fillText('Терраса', tx, ty);
}

// ══════════════════════════════════════════════
// КРЫЛЬЦО: drag + resize
// ══════════════════════════════════════════════
const HANDLE_R = 18;
let porchDrag = null, porchDragStart = null;

function initPorchCanvas() {
  const wrap = document.getElementById('cw-porch');
  const cv   = document.getElementById('cv-porch');
  const dpr  = window.devicePixelRatio || 1;
  const sz   = wrap.offsetWidth;
  cv.width   = sz * dpr;
  cv.height  = sz * dpr;
  cv.style.width  = sz + 'px';
  cv.style.height = sz + 'px';
  CV['porch'] = mkCvState();
  drawPorchCanvas();

  const newCv = cv.cloneNode(true);
  wrap.replaceChild(newCv, cv);
  attachPorchEvents(wrap);
}

function attachPorchEvents(wrap) {
  const cx = CV['porch'];
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cvEl = document.getElementById('cv-porch');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    return {
      x: ((clientX - r.left) * dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top)  * dpr - cx.oy) / cx.scale,
      W: cvEl.width,
    };
  };

  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      pinchActive = true; porchDrag = null; touchId = null;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      const {x, y, W} = getWorld(t.clientX, t.clientY);
      const hit = hitPorchHandle(x, y, W);
      if (hit) {
        porchDrag = hit;
        porchDragStart = {mx: x, my: y, ...S.porch};
        touchId = t.identifier;
      }
    }
  }, {passive: false});

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    if (pinchActive && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const mx = (mid.x - r.left) * dpr, my = (mid.y - r.top) * dpr;
      const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * ratio));
      cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
      cx.oy = my - (my - cx.oy) * (ns / cx.scale);
      cx.scale = ns;
      drawPorchCanvas();
      return;
    }
    if (porchDrag && touchId !== null) {
      const t = [...e.touches].find(t => t.identifier === touchId); if (!t) return;
      const {x, y, W} = getWorld(t.clientX, t.clientY);
      applyPorchDrag(x, y, W);
    }
  }, {passive: false});

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) { porchDrag = null; porchDragStart = null; touchId = null; }
  }, {passive: true});

  wrap.addEventListener('mousedown', e => {
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    const hit = hitPorchHandle(x, y, W);
    if (hit) {
      porchDrag = hit;
      porchDragStart = {mx: x, my: y, ...S.porch};
      wrap.style.cursor = hit === 'move' ? 'move' : 'nwse-resize';
    }
  });

  document.addEventListener('mousemove', e => {
    if (!porchDrag) return;
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    applyPorchDrag(x, y, W);
  });

  document.addEventListener('mouseup', () => {
    porchDrag = null; porchDragStart = null;
    wrap.style.cursor = 'default';
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    const f  = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * f));
    cx.ox = mx - (mx - cx.ox) * (ns / cx.scale);
    cx.oy = my - (my - cx.oy) * (ns / cx.scale);
    cx.scale = ns;
    drawPorchCanvas();
  }, {passive: false});
}

function getPorchRect(W) {
  const p = S.porch;
  return {x: p.x * W, y: p.y * W, w: p.w * W, h: p.h * W};
}

function hitPorchHandle(wx, wy, W) {
  const {x, y, w, h} = getPorchRect(W), R = HANDLE_R * 2;
  for (const [id, hx, hy] of [['nw',x,y],['ne',x+w,y],['sw',x,y+h],['se',x+w,y+h]])
    if (Math.abs(wx - hx) < R && Math.abs(wy - hy) < R) return id;
  if (wx >= x && wx <= x + w && wy >= y && wy <= y + h) return 'move';
  return null;
}

function applyPorchDrag(wx, wy, W) {
  const ds = porchDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  const mn = 0.05, p = S.porch;
  if (porchDrag === 'move') {
    p.x = Math.max(0, Math.min(1 - ds.w, ds.x + dx));
    p.y = Math.max(0, Math.min(1 - ds.h, ds.y + dy));
  } else if (porchDrag === 'se') { p.w = Math.max(mn, ds.w + dx); p.h = Math.max(mn, ds.h + dy); }
  else if (porchDrag === 'sw') { const nw = Math.max(mn, ds.w - dx); p.x = ds.x + ds.w - nw; p.w = nw; p.h = Math.max(mn, ds.h + dy); }
  else if (porchDrag === 'ne') { p.w = Math.max(mn, ds.w + dx); const nh = Math.max(mn, ds.h - dy); p.y = ds.y + ds.h - nh; p.h = nh; }
  else if (porchDrag === 'nw') {
    const nw2 = Math.max(mn, ds.w - dx); p.x = ds.x + ds.w - nw2; p.w = nw2;
    const nh2 = Math.max(mn, ds.h - dy); p.y = ds.y + ds.h - nh2; p.h = nh2;
  }
  drawPorchCanvas();
}

function drawPorchCanvas() {
  const cvEl = document.getElementById('cv-porch'); if (!cvEl) return;
  const ctx  = cvEl.getContext('2d');
  const W    = cvEl.width, H = cvEl.height;
  const cx   = CV['porch'] || {scale: 1, ox: 0, oy: 0};

  applyTransform(ctx, cx, W, H);
  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, W, H);

  // Сетка
  const gridStep = W / GRID;
  ctx.fillStyle = '#bbb';
  for (let r = 0; r <= GRID; r++)
    for (let c = 0; c <= GRID; c++) {
      ctx.beginPath(); ctx.arc(c * gridStep, r * gridStep, 3 / cx.scale, 0, Math.PI * 2); ctx.fill();
    }

  // Дом
  const hx = 0.15 * W, hy = 0.15 * W, hw = 0.7 * W, hh = 0.7 * W;
  ctx.strokeStyle = '#666'; ctx.lineWidth = 3 / cx.scale; ctx.setLineDash([]);
  ctx.strokeRect(hx, hy, hw, hh);
  ctx.fillStyle = 'rgba(0,0,0,.04)'; ctx.fillRect(hx, hy, hw, hh);
  ctx.fillStyle = '#888'; ctx.font = `${13 / cx.scale}px Roboto`; ctx.textAlign = 'center';
  ctx.fillText('Дом', W / 2, H / 2);

  // Терраса-призрак
  if (S.pts.terrace && S.pts.terrace.length > 2) {
    _drawTerraceGhost(ctx, W, H, cx);
  }

  // Крыльцо
  const {x, y, w, h} = getPorchRect(W);
  ctx.fillStyle = 'rgba(0,100,220,.18)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#0064DC'; ctx.lineWidth = 2.5 / cx.scale; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#0064DC';
  ctx.font = `bold ${11 / cx.scale}px Roboto`; ctx.textAlign = 'center';
  ctx.fillText('Крыльцо', x + w / 2, y + h / 2 + 4 / cx.scale);

  // Ручки
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hpx, hpy]) => {
    ctx.beginPath(); ctx.arc(hpx, hpy, HANDLE_R / cx.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#0064DC'; ctx.lineWidth = 2 / cx.scale; ctx.stroke();
  });

  ctx.restore();
}
