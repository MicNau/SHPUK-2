// CANVAS.JS — pan/zoom движок, snap-canvas, крыльцо
// Зависимости: state.js

// PAN/ZOOM ENGINE
// ══════════════════════════════════════════════
const CV = {};
const GRID = 32;       // total meters (canvas area)
const SNAP = 0.5;      // snap step (meters)
const CELLS = GRID / SNAP; // 64 grid cells

function mkCvState() {
  return { scale:1, ox:0, oy:0, minScale:0.5, maxScale:4,
           dragging:false, lastX:0, lastY:0, pinching:false, lastDist:0 };
}

function applyTransform(ctx, cx, W, H) {
  ctx.clearRect(0,0,W,H); ctx.save();
  ctx.translate(cx.ox, cx.oy); ctx.scale(cx.scale, cx.scale);
}

function attachPanZoom(el, cvName, onRedraw) {
  const cx = CV[cvName];
  el.addEventListener('touchstart', e=>{
    if (e.touches.length===2) {
      cx.pinching=true; cx.dragging=false;
      cx.lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                              e.touches[0].clientY-e.touches[1].clientY);
    } else if (e.touches.length===1 && !cx.pinching) {
      cx.dragging=true; cx.lastX=e.touches[0].clientX; cx.lastY=e.touches[0].clientY;
    }
  },{passive:true});
  el.addEventListener('touchmove', e=>{
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
    if (e.touches.length<2) cx.pinching=false;
    if (e.touches.length===0) cx.dragging=false;
  },{passive:true});
  el.addEventListener('wheel', e=>{
    e.preventDefault();
    const r=el.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    const mx=(e.clientX-r.left)*dpr, my=(e.clientY-r.top)*dpr;
    const f=e.deltaY<0?1.15:0.87;
    const ns=Math.min(cx.maxScale,Math.max(cx.minScale,cx.scale*f));
    cx.ox=mx-(mx-cx.ox)*(ns/cx.scale); cx.oy=my-(my-cx.oy)*(ns/cx.scale); cx.scale=ns;
    onRedraw();
  },{passive:false});
}

// ══════════════════════════════════════════════
// SNAP-CANVAS (терраса, pool, pier, fence, paths-точки)
// ══════════════════════════════════════════════
function initSnapCanvas(name) {
  const wrap=document.getElementById('cw-'+name);
  const cv=document.getElementById('cv-'+name);
  const dpr=window.devicePixelRatio||1, sz=wrap.offsetWidth;
  cv.width=sz*dpr; cv.height=sz*dpr;
  cv.style.width=sz+'px'; cv.style.height=sz+'px';
  CV[name]=mkCvState();

  // Клонируем и заменяем — сбрасываем все старые слушатели
  const newCv=cv.cloneNode(false);
  newCv.width=sz*dpr; newCv.height=sz*dpr;
  newCv.style.width=sz+'px'; newCv.style.height=sz+'px';
  wrap.replaceChild(newCv, cv);

  // Рисуем уже после того как новый canvas в DOM
  drawSnapCanvas(name);

  attachPanZoom(wrap, name, ()=>drawSnapCanvas(name));

  // Клик — добавить точку с snap (0.5m step + прилипание к стенам дома)
  wrap.addEventListener('click', e=>{
    if (CV[name].pinching) return;
    const cvEl=document.getElementById('cv-'+name); if (!cvEl) return;
    const r=wrap.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    const sx=(e.clientX-r.left)*dpr, sy=(e.clientY-r.top)*dpr;
    const cx=CV[name];
    const wx=(sx-cx.ox)/cx.scale, wy=(sy-cx.oy)/cx.scale;
    const W=cvEl.width, snapStep=W/CELLS;
    let snX=Math.round(wx/snapStep)*snapStep/W, snY=Math.round(wy/snapStep)*snapStep/W;

    // Прилипание к стенам дома для террас (порог 1 м).
    // Работает по ВСЕМ ortho-рёбрам полигона дома (не только bbox), чтобы
    // L/T/+/П-формы тоже снапались к своим внутренним углам.
    if (['terrace','pool_terrace','pier'].includes(name) && S.houseType !== 'Участок без дома') {
      const hp = getHousePolygonNorm();
      const thr = 1.0 / GRID; // 1m порог в нормализованных координатах
      // Собираем уникальные snap-координаты (X для вертикальных рёбер, Y для горизонтальных)
      const xCoords = new Set(), yCoords = new Set();
      for (const e of hp.edges) {
        if (e.axis === 'v') xCoords.add(e.coord);
        else if (e.axis === 'h') yCoords.add(e.coord);
      }
      let bestX = null, bestXD = thr;
      for (const xc of xCoords) {
        const d = Math.abs(snX - xc);
        if (d < bestXD) { bestX = xc; bestXD = d; }
      }
      if (bestX !== null) snX = bestX;
      let bestY = null, bestYD = thr;
      for (const yc of yCoords) {
        const d = Math.abs(snY - yc);
        if (d < bestYD) { bestY = yc; bestYD = d; }
      }
      if (bestY !== null) snY = bestY;
    }

    S.pts[name].push({ x:snX, y:snY });
    drawSnapCanvas(name);
  });
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

// Рисование ранее заданных объектов как фон на canvas-шагах
// excludeName — текущая секция (не рисуем её повторно, она рисуется как основной слой)
function drawPreviousLayers(ctx, W, H, cx, excludeName) {
  const sc = cx.scale || 1;

  // 1. Дом — полигон по реальному outline дескриптора (или fallback-прямоугольник)
  if (S.houseType !== 'Участок без дома') {
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
    // Подпись и габариты по bbox
    ctx.fillStyle='#666'; ctx.font=`bold ${13/sc}px Roboto`; ctx.textAlign='center';
    ctx.fillText('ДОМ', bx+bw/2, by+bh/2+5/sc);
    ctx.fillStyle='#888'; ctx.font=`${10/sc}px Roboto`;
    ctx.fillText(hp.lenL.toFixed(1)+'м', bx+bw/2, by-6/sc);
    ctx.save(); ctx.translate(bx-6/sc, by+bh/2);
    ctx.rotate(-Math.PI/2); ctx.textAlign='center';
    ctx.fillText(hp.lenW.toFixed(1)+'м', 0, 0); ctx.restore();
  }

  // Цвета для фоновых слоёв
  const layerStyles = {
    pool_terrace: { fill:'rgba(0,80,200,.10)',  stroke:'rgba(0,80,200,.5)',  label:'Терр. бассейна' },
    pier:         { fill:'rgba(26,122,204,.10)',stroke:'rgba(26,122,204,.5)',label:'Причал' },
    fence:        { fill:'none',                stroke:'rgba(0,0,0,.3)',     label:'Забор' },
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
    ctx.font = `${10/sc}px Roboto`; ctx.textAlign = 'center';
    ctx.fillText('Ступени', rx+rw/2, ry+rh/2+4/sc);
  }

  // Терраса/Крыльцо — массив rect'ов (фон, если редактируем другую секцию)
  if (excludeName !== 'terrace' && S.terraceRects && S.terraceRects.length) {
    ctx.fillStyle = 'rgba(0,150,80,.12)';
    ctx.strokeStyle = 'rgba(0,150,80,.5)';
    ctx.lineWidth = 2/sc; ctx.setLineDash([6/sc, 3/sc]);
    for (const r of S.terraceRects) {
      const rx = r.x * W, ry = r.y * H, rw = r.w * W, rh = r.h * H;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.setLineDash([]);
    // Подпись по центру bbox
    let bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
    for (const r of S.terraceRects) {
      if (r.x < bx0) bx0 = r.x; if (r.y < by0) by0 = r.y;
      if (r.x+r.w > bx1) bx1 = r.x+r.w; if (r.y+r.h > by1) by1 = r.y+r.h;
    }
    ctx.fillStyle = 'rgba(0,150,80,.6)';
    ctx.font = `${10/sc}px Roboto`; ctx.textAlign = 'center';
    ctx.fillText('Терраса', (bx0+bx1)/2*W, (by0+by1)/2*H);
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
    ctx.font = `${10/sc}px Roboto`; ctx.textAlign = 'center';
    ctx.fillText('Грядки', (b0.x + b0.w/2)*W, (b0.y + b0.h/2)*H + 4/sc);
  }

  // 2. Полигоны: pool_terrace, pier, fence
  for (const [secId, style] of Object.entries(layerStyles)) {
    if (secId === excludeName) continue;
    const tp = S.pts[secId];
    if (!tp || tp.length < 2) continue;
    const realPts = tp.filter(p=>!p.break);
    if (realPts.length < 2) continue;

    if (secId === 'fence') {
      // Забор: несколько линий (разделены break)
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
    ctx.fillStyle=style.stroke; ctx.font=`${10/sc}px Roboto`; ctx.textAlign='center';
    ctx.fillText(style.label, centX, centY);
  }

  // 3. Дорожки — рисуем как полосу указанной ширины (несколько линий)
  if (excludeName !== 'paths') {
    const pp = S.pts.paths;
    if (pp && pp.length >= 2) {
      const pathWidthCm = parseFloat(document.getElementById('v-paths-width')?.value || 120);
      const pathHalfW = (pathWidthCm / 100) / GRID * W / 2;
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
        ctx.fillStyle='rgba(51,102,0,.6)'; ctx.font=`${10/sc}px Roboto`; ctx.textAlign='center';
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
  const ctx=cvEl.getContext('2d'), W=cvEl.width, H=cvEl.height;
  const cx=CV[name]||{scale:1,ox:0,oy:0};
  const pts=S.pts[name]||[];
  applyTransform(ctx,cx,W,H);

  ctx.fillStyle='#d9d9d9'; ctx.fillRect(0,0,W,H);

  // Сетка (0.5 м шаг)
  const step=W/CELLS;
  for(let r=0;r<=CELLS;r++) for(let c=0;c<=CELLS;c++) {
    const isMajor = (r*SNAP)%1===0 && (c*SNAP)%1===0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c*step,r*step,(isMajor?2:1.2)/cx.scale,0,Math.PI*2); ctx.fill();
  }

  // Метки метров (каждые 5м)
  ctx.fillStyle='#999'; ctx.font=`${9/cx.scale}px Roboto`; ctx.textAlign='center';
  for(let m=5;m<=GRID;m+=5) { const px=m/GRID*W; ctx.fillText(m+'м', px, H-3/cx.scale); }

  // Ранее заданные объекты
  drawPreviousLayers(ctx, W, H, cx, name);

  // Подсказка
  const realPts = pts.filter(p=>!p.break);
  if (!realPts.length) {
    ctx.fillStyle='#aaa'; ctx.font=`${13/cx.scale}px Roboto`; ctx.textAlign='center';
    const hint={terrace:'Нажмите чтобы поставить угол',pool_terrace:'Нажмите чтобы поставить угол',
                 pier:'Нажмите чтобы поставить угол',fence:'Нажмите чтобы поставить точку',
                 paths:'Нажмите точки вдоль дорожки'};
    ctx.fillText(hint[name]||'Нажмите чтобы поставить точку', W/2, H*0.92);
  }

  // Контур текущей секции
  if (realPts.length > 0) {
    const color = {terrace:'#000',pool_terrace:'#0050CC',pier:'#1a7acc',paths:'#336600',fence:'#000'}[name]||'#000';
    const segments = (name==='paths'||name==='fence') ? splitAtBreaks(pts) : [realPts];

    if (name === 'paths') {
      const pathWidthCm = parseFloat(document.getElementById('v-paths-width')?.value || 120);
      const pathW = (pathWidthCm / 100) / GRID * W;
      for (const seg of segments) {
        if (seg.length < 1) continue;
        // Полоса
        ctx.strokeStyle='rgba(51,102,0,.25)'; ctx.lineWidth=pathW; ctx.lineCap='butt'; ctx.lineJoin='miter';
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
    } else if (name === 'fence') {
      for (const seg of segments) {
        if (seg.length < 1) continue;
        ctx.beginPath(); ctx.moveTo(seg[0].x*W,seg[0].y*H);
        for(let i=1;i<seg.length;i++) ctx.lineTo(seg[i].x*W,seg[i].y*H);
        ctx.strokeStyle=color; ctx.lineWidth=2.5/cx.scale; ctx.stroke();
      }
    } else {
      // Полигоны (terrace, pool_terrace, pier)
      ctx.beginPath(); ctx.moveTo(realPts[0].x*W,realPts[0].y*H);
      for(let i=1;i<realPts.length;i++) ctx.lineTo(realPts[i].x*W,realPts[i].y*H);
      if(realPts.length>2) { ctx.closePath(); ctx.fillStyle='rgba(0,0,0,.08)'; ctx.fill(); }
      ctx.strokeStyle=color; ctx.lineWidth=2.5/cx.scale; ctx.stroke();
    }

    // Точки (все реальные точки с номерами)
    let ptNum = 0;
    pts.forEach(p=>{
      if (p.break) return;
      ptNum++;
      ctx.beginPath(); ctx.arc(p.x*W,p.y*H,8/cx.scale,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
      ctx.strokeStyle=color; ctx.lineWidth=2.5/cx.scale; ctx.stroke();
      ctx.fillStyle=color; ctx.font=`bold ${10/cx.scale}px Roboto`; ctx.textAlign='center';
      ctx.fillText(ptNum,p.x*W,p.y*H+4/cx.scale);
    });
  }

  ctx.restore();
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
// СТУПЕНИ: один rect drag+resize
// Положение и размер — от пользователя; в 3D глубина пересчитывается
// автоматически из числа подступенков (см. buildSteps3d в viewer3d-core.js).
// ══════════════════════════════════════════════
let stepsDrag = null;
let stepsDragStart = null;

function initStepsCanvas() {
  const wrap = document.getElementById('cw-steps');
  const cv   = document.getElementById('cv-steps');
  const dpr = window.devicePixelRatio || 1, sz = wrap.offsetWidth;
  cv.width = sz * dpr; cv.height = sz * dpr;
  cv.style.width = sz + 'px'; cv.style.height = sz + 'px';
  CV['steps'] = mkCvState();

  // НЕ переснапиваем ступени на сетку при открытии — иначе rect, прижатый к стене
  // дома/кромке террасы (обычно не на сетке 0.5 м), отрывается («съезжает»).

  const newCv = cv.cloneNode(false);
  newCv.width = sz * dpr; newCv.height = sz * dpr;
  newCv.style.width = sz + 'px'; newCv.style.height = sz + 'px';
  wrap.replaceChild(newCv, cv);

  drawStepsCanvas();
  attachStepsEvents(wrap);
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
  // excludeTerraceIdx = -1 — ступени снапаются ко ВСЕМ террасным rect'ам + стенам дома.
  const res = snapDraggedRect(stepsDrag, ds, dx, dy, -1);
  s.x = res.x; s.y = res.y; s.w = res.w; s.h = res.h;
  drawStepsCanvas();
}

function attachStepsEvents(wrap) {
  // Слушатели вешаются один раз (см. attachTerraceEvents) — guard + чтение CV['steps'] свежим.
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
      W: cvEl.width,
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

  wrap.addEventListener('mousedown', e => {
    if (!stepsActive()) return;
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
    stepsDrag = null; stepsDragStart = null; wrap.style.cursor = 'default';
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
  const ctx = cvEl.getContext('2d'), W = cvEl.width, H = cvEl.height;
  const cx = CV['steps'] || { scale:1, ox:0, oy:0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, W, H);
  // Сетка
  const step = W/CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r*SNAP)%1===0 && (c*SNAP)%1===0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c*step, r*step, (isMajor?2:1.2)/cx.scale, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle='#999'; ctx.font=`${9/cx.scale}px Roboto`; ctx.textAlign='center';
  for (let m=5; m<=GRID; m+=5) { const px = m/GRID*W; ctx.fillText(m+'м', px, H-3/cx.scale); }

  drawPreviousLayers(ctx, W, H, cx, 'steps');

  // Ступени (текущая секция)
  const { x, y, w, h } = getStepsRectPx(W);
  ctx.fillStyle = 'rgba(220,140,0,.22)';
  ctx.fillRect(x, y, w, h);
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
  ctx.fillStyle = '#cc6600'; ctx.font = `bold ${11/cx.scale}px Roboto`; ctx.textAlign = 'center';
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
// ТЕРРАСА/КРЫЛЬЦО: multi-rect drag+resize
// Каждый прямоугольник — {x,y,w,h} в нормализованных координатах 0..1.
// Активный (S.activeTerraceRect — индекс) показывает handles и drag'абелен.
// Клик по неактивному → активирует его. Клик по пустому месту → снимает выделение.
// ══════════════════════════════════════════════
const HANDLE_R = 18;
let trDrag = null;       // 'move' | 'nw' | 'ne' | 'sw' | 'se'
let trDragStart = null;  // { mx, my, x, y, w, h }
let trDragIdx = -1;      // индекс rect'а, который тащим

// Snap нормализованной координаты к сетке 0.5 м.
function snapNorm(v) { return Math.round(v * GRID / SNAP) * SNAP / GRID; }

// Собирает координаты вертикальных (xs) и горизонтальных (ys) рёбер,
// к которым прилипают кромки rect'ов:
//   • рёбра дома (getHousePolygonNorm);
//   • рёбра всех S.terraceRects, КРОМЕ excludeTerraceIdx (редактируемый террасный
//     rect не должен снапаться на собственные кромки; при редактировании ступеней
//     excludeTerraceIdx = -1 → все террасные rect'ы учитываются).
function _snapTargets(excludeTerraceIdx) {
  const xs = [], ys = [];
  if (S.houseType !== 'Участок без дома') {
    const hp = getHousePolygonNorm();
    for (const e of hp.edges) {
      if (e.axis === 'v') xs.push(e.coord);
      else if (e.axis === 'h') ys.push(e.coord);
    }
  }
  const rects = S.terraceRects || [];
  for (let i = 0; i < rects.length; i++) {
    if (i === excludeTerraceIdx) continue;
    const r = rects[i];
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

// Ближайшая snap-цель к координате coord в пределах порога thr; иначе null.
function _nearestTarget(coord, targets) {
  const thr = 1.0 / GRID;  // 1 м
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
//   excludeTerraceIdx: индекс террасного rect, который НЕ участвует как цель снапа.
// Принцип: к стене/террасе липнет ТОЛЬКО движущаяся кромка; противоположная остаётся
// на сетке. Поэтому wall-snap НЕ перетирается финальным snapNorm, и дальние углы
// не уносит с сетки (исправление «снапается целиком»).
function snapDraggedRect(kind, ds, dx, dy, excludeTerraceIdx) {
  const mn = SNAP / GRID;
  const { xs, ys } = _snapTargets(excludeTerraceIdx);

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

function initTerraceCanvas() {
  const wrap = document.getElementById('cw-terrace');
  const cv   = document.getElementById('cv-terrace');
  const dpr = window.devicePixelRatio || 1, sz = wrap.offsetWidth;
  cv.width = sz * dpr; cv.height = sz * dpr;
  cv.style.width = sz + 'px'; cv.style.height = sz + 'px';
  CV['terrace'] = mkCvState();

  // Если rects пуст — создаём дефолтный rect рядом с домом.
  if (!S.terraceRects || S.terraceRects.length === 0) {
    S.terraceRects = [_defaultTerraceRect()];
    S.activeTerraceRect = 0;
  } else if (S.activeTerraceRect === null || S.activeTerraceRect >= S.terraceRects.length) {
    S.activeTerraceRect = 0;
  }
  // НЕ переснапиваем существующие rects на сетку при открытии: они уже корректно
  // расставлены при создании/перетаскивании (на сетке ИЛИ вплотную к стене дома,
  // которая обычно не на сетке 0.5 м). Грид-снап здесь отрывал террасу от стены
  // («съезжала» при повторном редактировании).

  const newCv = cv.cloneNode(false);
  newCv.width = sz * dpr; newCv.height = sz * dpr;
  newCv.style.width = sz + 'px'; newCv.style.height = sz + 'px';
  wrap.replaceChild(newCv, cv);

  drawTerraceCanvas();
  attachTerraceEvents(wrap);
}

function _defaultTerraceRect() {
  // По умолчанию ставим небольшой прямоугольник 4×2 м у нижнего края дома.
  const hp = (typeof getHousePolygonNorm === 'function') ? getHousePolygonNorm() : null;
  if (hp && hp.bboxNorm) {
    const b = hp.bboxNorm;
    return {
      x: snapNorm(b.nx + b.nw / 2 - 2 / GRID),
      y: snapNorm(b.ny + b.nh),
      w: snapNorm(4 / GRID),
      h: snapNorm(2 / GRID),
    };
  }
  return { x: snapNorm(0.4), y: snapNorm(0.5), w: snapNorm(4/GRID), h: snapNorm(2/GRID) };
}

// Добавляет новый rect рядом с активным (или в центре, если нет активного).
function addTerraceRect() {
  if (!S.terraceRects) S.terraceRects = [];
  const mn = SNAP / GRID;
  const w0 = snapNorm(3 / GRID), h0 = snapNorm(2 / GRID);
  let nx, ny;
  if (S.activeTerraceRect !== null && S.terraceRects[S.activeTerraceRect]) {
    const a = S.terraceRects[S.activeTerraceRect];
    nx = snapNorm(a.x + a.w + mn);  // справа от активного
    ny = a.y;
    if (nx + w0 > 1) { nx = snapNorm(Math.max(0, a.x - w0 - mn)); }
  } else {
    nx = snapNorm(0.4); ny = snapNorm(0.5);
  }
  S.terraceRects.push({ x: nx, y: ny, w: w0, h: h0 });
  S.activeTerraceRect = S.terraceRects.length - 1;
  drawTerraceCanvas();
}

function delActiveTerraceRect() {
  if (!S.terraceRects || S.activeTerraceRect === null) return;
  S.terraceRects.splice(S.activeTerraceRect, 1);
  if (S.terraceRects.length === 0) {
    S.activeTerraceRect = null;
  } else {
    S.activeTerraceRect = Math.min(S.activeTerraceRect, S.terraceRects.length - 1);
  }
  drawTerraceCanvas();
}

// Определяет, по какому элементу попал клик: индекс rect и тип взаимодействия.
//   Возвращает {idx, kind: 'nw'|'ne'|'sw'|'se'|'move'} или null.
//   Сначала проверяем handles активного rect (приоритет — он сверху).
function hitTerrace(wx, wy, W) {
  const rects = S.terraceRects || [];
  // Hitbox handle = визуальный радиус кружка В МИРОВЫХ координатах. Кружок рисуется
  // как HANDLE_R / scale (см. drawTerraceCanvas), поэтому и зона попадания должна
  // делиться на scale — иначе при зуме-аут клик по видимому кружку промахивается
  // мимо угла (срывается захват / вместо resize получается move).
  const sc = (CV['terrace'] && CV['terrace'].scale) || 1;
  const R = HANDLE_R / sc;
  // 1. Handles активного rect (приоритет).
  if (S.activeTerraceRect !== null && rects[S.activeTerraceRect]) {
    const r = rects[S.activeTerraceRect];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    for (const [k, cx, cy] of [['nw',rx,ry], ['ne',rx+rw,ry], ['sw',rx,ry+rh], ['se',rx+rw,ry+rh]]) {
      if (Math.hypot(wx - cx, wy - cy) < R) {
        return { idx: S.activeTerraceRect, kind: k };
      }
    }
  }
  // 2. Тело любого rect (от верхнего к нижнему — берём активный первым).
  const order = [];
  if (S.activeTerraceRect !== null) order.push(S.activeTerraceRect);
  for (let i = 0; i < rects.length; i++) if (i !== S.activeTerraceRect) order.push(i);
  for (const i of order) {
    const r = rects[i];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    if (wx >= rx && wx <= rx + rw && wy >= ry && wy <= ry + rh) {
      return { idx: i, kind: 'move' };
    }
  }
  return null;
}

function applyTerraceDrag(wx, wy, W) {
  if (trDragIdx < 0 || !S.terraceRects[trDragIdx]) return;
  const ds = trDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  const r = S.terraceRects[trDragIdx];
  // excludeTerraceIdx = trDragIdx — редактируемый rect не снапается на свои кромки.
  const res = snapDraggedRect(trDrag, ds, dx, dy, trDragIdx);
  r.x = res.x; r.y = res.y; r.w = res.w; r.h = res.h;
  drawTerraceCanvas();
}

function attachTerraceEvents(wrap) {
  // Слушатели вешаются на wrap/document ОДИН РАЗ. Раньше attach вызывался при каждом
  // открытии редактора → дубли слушателей и захват устаревшего cx из замыкания
  // (срыв захвата / двойная обработка). Теперь guard + чтение CV['terrace'] свежим.
  if (wrap._terraceBound) return;
  wrap._terraceBound = true;
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cx = CV['terrace'] || { ox: 0, oy: 0, scale: 1 };
    const cvEl = document.getElementById('cv-terrace');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    return {
      x: ((clientX - r.left)*dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top )*dpr - cx.oy) / cx.scale,
      W: cvEl.width,
    };
  };

  const startDrag = (worldX, worldY, W) => {
    const hit = hitTerrace(worldX, worldY, W);
    if (!hit) {
      // Клик в пустое место — снимаем активность.
      S.activeTerraceRect = null;
      drawTerraceCanvas();
      return false;
    }
    // Если клик по неактивному rect — сначала активируем его (без drag).
    if (hit.idx !== S.activeTerraceRect && hit.kind === 'move') {
      S.activeTerraceRect = hit.idx;
      drawTerraceCanvas();
      // Drag разрешаем сразу — пользователь может тащить активный rect.
    }
    const r = S.terraceRects[hit.idx];
    trDrag = hit.kind;
    trDragIdx = hit.idx;
    trDragStart = { mx: worldX, my: worldY, x: r.x, y: r.y, w: r.w, h: r.h };
    return true;
  };

  // ── TOUCH ──
  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    const cx = CV['terrace']; if (!cx) return;
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
    const cx = CV['terrace']; if (!cx) return;
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
      drawTerraceCanvas(); return;
    }
    if (trDrag && touchId !== null) {
      const t = [...e.touches].find(t => t.identifier === touchId); if (!t) return;
      const {x, y, W} = getWorld(t.clientX, t.clientY);
      applyTerraceDrag(x, y, W);
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) { trDrag = null; trDragStart = null; trDragIdx = -1; touchId = null; }
  }, { passive: true });

  // ── МЫШЬ ──
  wrap.addEventListener('mousedown', e => {
    // Реагируем только когда открыт редактор террасы (слушатель на wrap живёт всегда).
    if (!CV['terrace'] || !document.getElementById('d-canvas-terrace')?.classList.contains('active')) return;
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    if (startDrag(x, y, W)) {
      wrap.style.cursor = (trDrag === 'move') ? 'move' : 'nwse-resize';
    }
  });
  document.addEventListener('mousemove', e => {
    if (!trDrag) return;
    const {x, y, W} = getWorld(e.clientX, e.clientY);
    applyTerraceDrag(x, y, W);
  });
  document.addEventListener('mouseup', () => {
    if (!trDrag) return;
    trDrag = null; trDragStart = null; trDragIdx = -1;
    wrap.style.cursor = 'default';
  });

  // Колесо → zoom
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const cx = CV['terrace']; if (!cx) return;
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    const mx = (e.clientX - r.left)*dpr, my = (e.clientY - r.top)*dpr;
    const f = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale * f));
    cx.ox = mx - (mx - cx.ox)*(ns/cx.scale);
    cx.oy = my - (my - cx.oy)*(ns/cx.scale);
    cx.scale = ns;
    drawTerraceCanvas();
  }, { passive: false });
}

function drawTerraceCanvas() {
  const cvEl = document.getElementById('cv-terrace'); if (!cvEl) return;
  const ctx = cvEl.getContext('2d'), W = cvEl.width, H = cvEl.height;
  const cx = CV['terrace'] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, W, H);

  // Сетка
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * SNAP) % 1 === 0 && (c * SNAP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath();
    ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // Метки метров
  ctx.fillStyle = '#999'; ctx.font = `${9 / cx.scale}px Roboto`; ctx.textAlign = 'center';
  for (let m = 5; m <= GRID; m += 5) {
    const px = m / GRID * W;
    ctx.fillText(m + 'м', px, H - 3 / cx.scale);
  }

  drawPreviousLayers(ctx, W, H, cx, 'terrace');

  // Rects
  const rects = S.terraceRects || [];
  const COL = '#0064DC';        // активный
  const COL_INACTIVE = '#5a8c5a'; // неактивный (зеленоватый под цвет террасы)
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const isActive = (i === S.activeTerraceRect);
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    ctx.fillStyle = isActive ? 'rgba(0,100,220,.18)' : 'rgba(0,150,80,.12)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = isActive ? COL : COL_INACTIVE;
    ctx.lineWidth = (isActive ? 2.5 : 1.8) / cx.scale;
    if (!isActive) ctx.setLineDash([6/cx.scale, 3/cx.scale]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
  }
  // Подпись общая
  if (rects.length) {
    let bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
    for (const r of rects) {
      if (r.x < bx0) bx0 = r.x; if (r.y < by0) by0 = r.y;
      if (r.x + r.w > bx1) bx1 = r.x + r.w;
      if (r.y + r.h > by1) by1 = r.y + r.h;
    }
    ctx.fillStyle = COL_INACTIVE;
    ctx.font = `bold ${11 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    ctx.fillText('Терраса/Крыльцо', (bx0+bx1)/2*W, (by0+by1)/2*H);
  }

  // Handles только у активного rect
  if (S.activeTerraceRect !== null && rects[S.activeTerraceRect]) {
    const r = rects[S.activeTerraceRect];
    const rx = r.x * W, ry = r.y * W, rw = r.w * W, rh = r.h * W;
    for (const [hpx, hpy] of [[rx,ry], [rx+rw,ry], [rx,ry+rh], [rx+rw,ry+rh]]) {
      ctx.beginPath();
      ctx.arc(hpx, hpy, HANDLE_R / cx.scale, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = COL; ctx.lineWidth = 2 / cx.scale; ctx.stroke();
    }
  }

  // Подсказка если пусто
  if (!rects.length) {
    ctx.fillStyle = '#aaa';
    ctx.font = `${13 / cx.scale}px Roboto`;
    ctx.textAlign = 'center';
    ctx.fillText('Нажмите «＋ Прямоугольник» чтобы добавить террасу', W/2, H * 0.92);
  }

  ctx.restore();
}

// ══════════════════════════════════════════════
// ГРЯДКИ: размещение rect'ов фиксированного размера 3×1 м
// Размер не меняется (resize запрещён) — только перемещение (drag тела) и
// поворот на 90° (кнопка). Ориентация ортогональная: длинная сторона (3 м)
// вдоль X (w>h) или вдоль Y (w<h). Высота борта — глобальная (S.bedH).
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
  const dpr = window.devicePixelRatio || 1, sz = wrap.offsetWidth;
  cv.width = sz * dpr; cv.height = sz * dpr;
  cv.style.width = sz + 'px'; cv.style.height = sz + 'px';
  CV['beds'] = mkCvState();

  if (!S.beds || S.beds.length === 0) {
    S.beds = [_defaultBed()];
    S.activeBed = 0;
  } else if (S.activeBed === null || S.activeBed >= S.beds.length) {
    S.activeBed = 0;
  }
  // НЕ переснапиваем грядки на сетку при открытии — сохраняем позицию, к которой
  // их прижали (сетка или стена/кромка), иначе «съезжают» при повторном открытии.

  // Синхронизируем кнопки высоты с текущим S.bedH.
  if (typeof dSetBedHeight === 'function') dSetBedHeight(Math.round((S.bedH || 0.20) * 1000));

  const newCv = cv.cloneNode(false);
  newCv.width = sz * dpr; newCv.height = sz * dpr;
  newCv.style.width = sz + 'px'; newCv.style.height = sz + 'px';
  wrap.replaceChild(newCv, cv);

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

function applyBedDrag(wx, wy, W) {
  if (bedDragIdx < 0 || !S.beds[bedDragIdx]) return;
  const ds = bedDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
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
      W: cvEl.width,
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
    return true;
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
  wrap.addEventListener('mousedown', e => {
    if (!bedsActive()) return;
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    if (startDrag(x, y, W)) wrap.style.cursor = 'move';
  });
  document.addEventListener('mousemove', e => {
    if (!bedDrag) return;
    const { x, y, W } = getWorld(e.clientX, e.clientY);
    applyBedDrag(x, y, W);
  });
  document.addEventListener('mouseup', () => {
    if (!bedDrag) return;
    bedDrag = null; bedDragStart = null; bedDragIdx = -1; wrap.style.cursor = 'default';
  });

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
  const ctx = cvEl.getContext('2d'), W = cvEl.width, H = cvEl.height;
  const cx = CV['beds'] || { scale: 1, ox: 0, oy: 0 };
  applyTransform(ctx, cx, W, H);

  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, W, H);
  // Сетка
  const step = W / CELLS;
  for (let r = 0; r <= CELLS; r++) for (let c = 0; c <= CELLS; c++) {
    const isMajor = (r * SNAP) % 1 === 0 && (c * SNAP) % 1 === 0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c * step, r * step, (isMajor ? 2 : 1.2) / cx.scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#999'; ctx.font = `${9 / cx.scale}px Roboto`; ctx.textAlign = 'center';
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
    ctx.fillStyle = COL; ctx.font = `bold ${10 / cx.scale}px Roboto`; ctx.textAlign = 'center';
    ctx.fillText(`${BED_LEN}×${BED_WID} м`, rx + rw / 2, ry + rh / 2 + 4 / cx.scale);
  }

  if (!beds.length) {
    ctx.fillStyle = '#aaa'; ctx.font = `${13 / cx.scale}px Roboto`; ctx.textAlign = 'center';
    ctx.fillText('Нажмите «＋ Грядка» чтобы добавить', W / 2, H * 0.92);
  }

  ctx.restore();
}

// ══════════════════════════════════════════════
