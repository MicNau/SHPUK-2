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
        ctx.strokeStyle='rgba(51,102,0,.3)'; ctx.lineWidth=pathHalfW*2; ctx.lineCap='round'; ctx.lineJoin='round';
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
        ctx.strokeStyle='rgba(51,102,0,.25)'; ctx.lineWidth=pathW; ctx.lineCap='round'; ctx.lineJoin='round';
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

  // Снап стартовых координат к сетке
  const s = S.steps;
  s.x = snapNorm(s.x); s.y = snapNorm(s.y);
  s.w = snapNorm(s.w); s.h = snapNorm(s.h);

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
  const R = HANDLE_R;
  for (const [k, cx, cy] of [['nw',x,y], ['ne',x+w,y], ['sw',x,y+h], ['se',x+w,y+h]]) {
    if (Math.hypot(wx - cx, wy - cy) < R) return k;
  }
  if (wx >= x && wx <= x+w && wy >= y && wy <= y+h) return 'move';
  return null;
}

function applyStepsDrag(wx, wy, W) {
  const ds = stepsDragStart;
  const dx = (wx - ds.mx) / W, dy = (wy - ds.my) / W;
  const mn = SNAP / GRID;
  const s = S.steps;

  if (stepsDrag === 'move') {
    let nx = Math.max(0, Math.min(1 - ds.w, ds.x + dx));
    let ny = Math.max(0, Math.min(1 - ds.h, ds.y + dy));
    nx = snapNorm(nx); ny = snapNorm(ny);
    const sn = snapToHouseWalls(nx, ny);
    s.x = sn.x; s.y = sn.y; s.w = ds.w; s.h = ds.h;
  } else if (stepsDrag === 'se') {
    let bx = snapNorm(ds.x + Math.max(mn, ds.w + dx));
    let by = snapNorm(ds.y + Math.max(mn, ds.h + dy));
    const sn = snapToHouseWalls(bx, by);
    s.x = ds.x; s.y = ds.y;
    s.w = snapNorm(Math.max(mn, sn.x - ds.x));
    s.h = snapNorm(Math.max(mn, sn.y - ds.y));
  } else if (stepsDrag === 'sw') {
    let ax = snapNorm(Math.min(ds.x + ds.w - mn, ds.x + dx));
    let by = snapNorm(ds.y + Math.max(mn, ds.h + dy));
    const sn = snapToHouseWalls(ax, by);
    s.x = sn.x; s.y = ds.y;
    s.w = snapNorm(Math.max(mn, ds.x + ds.w - s.x));
    s.h = snapNorm(Math.max(mn, sn.y - ds.y));
  } else if (stepsDrag === 'ne') {
    let bx = snapNorm(ds.x + Math.max(mn, ds.w + dx));
    let ay = snapNorm(Math.min(ds.y + ds.h - mn, ds.y + dy));
    const sn = snapToHouseWalls(bx, ay);
    s.x = ds.x; s.y = sn.y;
    s.w = snapNorm(Math.max(mn, sn.x - ds.x));
    s.h = snapNorm(Math.max(mn, ds.y + ds.h - s.y));
  } else if (stepsDrag === 'nw') {
    let ax = snapNorm(Math.min(ds.x + ds.w - mn, ds.x + dx));
    let ay = snapNorm(Math.min(ds.y + ds.h - mn, ds.y + dy));
    const sn = snapToHouseWalls(ax, ay);
    s.x = sn.x; s.y = sn.y;
    s.w = snapNorm(Math.max(mn, ds.x + ds.w - s.x));
    s.h = snapNorm(Math.max(mn, ds.y + ds.h - s.y));
  }
  drawStepsCanvas();
}

function attachStepsEvents(wrap) {
  const cx = CV['steps'];
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cvEl = document.getElementById('cv-steps');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    return {
      x: ((clientX - r.left)*dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top )*dpr - cx.oy) / cx.scale,
      W: cvEl.width,
    };
  };

  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
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
    stepsDrag = null; stepsDragStart = null; wrap.style.cursor = 'default';
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
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

// Snap координаты (X и Y по отдельности, порог 1 м) к рёбрам:
//   • стен дома (через getHousePolygonNorm);
//   • всех S.terraceRects, КРОМЕ активного (чтобы редактируемый rect не снапался
//     на свои собственные кромки). Это даёт прилипание ступеней к боковым кромкам
//     террасы и стыковку соседних террасных rect'ов друг к другу.
function snapToHouseWalls(snX, snY) {
  const thr = 1.0 / GRID;
  const xCoords = new Set(), yCoords = new Set();

  // 1) Рёбра дома (если есть)
  if (S.houseType !== 'Участок без дома') {
    const hp = getHousePolygonNorm();
    for (const e of hp.edges) {
      if (e.axis === 'v') xCoords.add(e.coord);
      else if (e.axis === 'h') yCoords.add(e.coord);
    }
  }

  // 2) Рёбра террасных rect'ов (кроме активного — иначе rect снапается на самого
  //    себя при resize). Применимо при редактировании и террасы (skip active rect),
  //    и ступеней (там activeTerraceRect не редактируется → добавляем все rects).
  const rects = S.terraceRects || [];
  for (let i = 0; i < rects.length; i++) {
    if (i === S.activeTerraceRect) continue;
    const r = rects[i];
    xCoords.add(r.x);
    xCoords.add(r.x + r.w);
    yCoords.add(r.y);
    yCoords.add(r.y + r.h);
  }

  if (xCoords.size === 0 && yCoords.size === 0) return { x: snX, y: snY };

  let bestX = snX, bestXD = thr;
  for (const xc of xCoords) {
    const d = Math.abs(snX - xc);
    if (d < bestXD) { bestX = xc; bestXD = d; }
  }
  let bestY = snY, bestYD = thr;
  for (const yc of yCoords) {
    const d = Math.abs(snY - yc);
    if (d < bestYD) { bestY = yc; bestYD = d; }
  }
  return { x: bestX, y: bestY };
}

// (helper удалён — wall-snap делается per-corner внутри applyTerraceDrag,
// чтобы не «дотягивать» противоположный неподвижный угол к ближайшей стене)

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
  // Прилипаем к сетке все существующие rects.
  for (const r of S.terraceRects) {
    r.x = snapNorm(r.x); r.y = snapNorm(r.y);
    r.w = snapNorm(r.w); r.h = snapNorm(r.h);
  }

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
  // Hitbox handles = радиус самого визуального круга (раньше было *2 — съедало
  // клики по соседним rect'ам и блокировало переключение активного).
  const R = HANDLE_R;
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
  const mn = SNAP / GRID;
  const r = S.terraceRects[trDragIdx];

  // Считаем «сырое» новое положение rect от стартовых значений ds (не от текущего r —
  // иначе ошибка накапливается между событиями). Wall-snap применяется ТОЛЬКО к тому
  // углу, который пользователь двигает, остальные углы остаются на месте.
  if (trDrag === 'move') {
    // Двигается весь rect — опорный угол top-left, размеры не меняются.
    let nx = Math.max(0, Math.min(1 - ds.w, ds.x + dx));
    let ny = Math.max(0, Math.min(1 - ds.h, ds.y + dy));
    nx = snapNorm(nx); ny = snapNorm(ny);
    const sn = snapToHouseWalls(nx, ny);
    r.x = sn.x; r.y = sn.y;
    r.w = ds.w; r.h = ds.h;
  } else if (trDrag === 'se') {
    // Двигается правый-нижний угол; левый-верхний (ds.x, ds.y) фиксирован.
    let bx = snapNorm(ds.x + Math.max(mn, ds.w + dx));
    let by = snapNorm(ds.y + Math.max(mn, ds.h + dy));
    const sn = snapToHouseWalls(bx, by);
    r.x = ds.x; r.y = ds.y;
    r.w = snapNorm(Math.max(mn, sn.x - ds.x));
    r.h = snapNorm(Math.max(mn, sn.y - ds.y));
  } else if (trDrag === 'sw') {
    // Двигается левый-нижний угол; правый-верхний (ds.x+ds.w, ds.y) фиксирован.
    let ax = snapNorm(Math.min(ds.x + ds.w - mn, ds.x + dx));
    let by = snapNorm(ds.y + Math.max(mn, ds.h + dy));
    const sn = snapToHouseWalls(ax, by);
    r.x = sn.x;
    r.y = ds.y;
    r.w = snapNorm(Math.max(mn, ds.x + ds.w - r.x));
    r.h = snapNorm(Math.max(mn, sn.y - ds.y));
  } else if (trDrag === 'ne') {
    // Двигается правый-верхний угол; левый-нижний (ds.x, ds.y+ds.h) фиксирован.
    let bx = snapNorm(ds.x + Math.max(mn, ds.w + dx));
    let ay = snapNorm(Math.min(ds.y + ds.h - mn, ds.y + dy));
    const sn = snapToHouseWalls(bx, ay);
    r.x = ds.x;
    r.y = sn.y;
    r.w = snapNorm(Math.max(mn, sn.x - ds.x));
    r.h = snapNorm(Math.max(mn, ds.y + ds.h - r.y));
  } else if (trDrag === 'nw') {
    // Двигается левый-верхний угол; правый-нижний (ds.x+ds.w, ds.y+ds.h) фиксирован.
    let ax = snapNorm(Math.min(ds.x + ds.w - mn, ds.x + dx));
    let ay = snapNorm(Math.min(ds.y + ds.h - mn, ds.y + dy));
    const sn = snapToHouseWalls(ax, ay);
    r.x = sn.x; r.y = sn.y;
    r.w = snapNorm(Math.max(mn, ds.x + ds.w - r.x));
    r.h = snapNorm(Math.max(mn, ds.y + ds.h - r.y));
  }
  drawTerraceCanvas();
}

function attachTerraceEvents(wrap) {
  const cx = CV['terrace'];
  let touchId = null;
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
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
    trDrag = null; trDragStart = null; trDragIdx = -1;
    wrap.style.cursor = 'default';
  });

  // Колесо → zoom
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
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
