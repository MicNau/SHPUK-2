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

    // Прилипание к стенам дома для террас (порог 0.75 м)
    if (['terrace','pool_terrace','pier'].includes(name) && S.houseType !== 'Участок без дома') {
      const hr = getHouseRectNorm();
      const thr = 0.75 / GRID; // 0.75m порог в нормализованных координатах
      // Прилипание по X к левой/правой стене
      if (Math.abs(snX - hr.nx) < thr)              snX = hr.nx;
      else if (Math.abs(snX - (hr.nx+hr.nw)) < thr) snX = hr.nx + hr.nw;
      // Прилипание по Y к верхней/нижней стене
      if (Math.abs(snY - hr.ny) < thr)              snY = hr.ny;
      else if (Math.abs(snY - (hr.ny+hr.nh)) < thr) snY = hr.ny + hr.nh;
    }

    S.pts[name].push({ x:snX, y:snY });
    drawSnapCanvas(name);
  });
}

// Вычислить прямоугольник дома на canvas в нормализованных координатах 0..1
// На основе реальных параметров площади. Canvas = GRID×GRID м сетка.
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

// Рисование ранее заданных объектов как фон на canvas-шагах
// excludeName — текущая секция (не рисуем её повторно, она рисуется как основной слой)
function drawPreviousLayers(ctx, W, H, cx, excludeName) {
  const sc = cx.scale || 1;

  // 1. Дом
  if (S.houseType !== 'Участок без дома') {
    const hr = getHouseRectNorm();
    const hx=hr.nx*W, hy=hr.ny*H, hw=hr.nw*W, hh=hr.nh*H;
    ctx.strokeStyle='#555'; ctx.lineWidth=2.5/sc; ctx.setLineDash([]);
    ctx.strokeRect(hx,hy,hw,hh);
    ctx.fillStyle='rgba(0,0,0,.06)'; ctx.fillRect(hx,hy,hw,hh);
    // Штриховка
    ctx.save();
    ctx.beginPath(); ctx.rect(hx,hy,hw,hh); ctx.clip();
    ctx.strokeStyle='rgba(0,0,0,.08)'; ctx.lineWidth=1/sc;
    for (let d = -Math.max(hw,hh); d < Math.max(hw,hh)*2; d += 8/sc) {
      ctx.beginPath(); ctx.moveTo(hx+d, hy); ctx.lineTo(hx+d-hh, hy+hh); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle='#666'; ctx.font=`bold ${13/sc}px Roboto`; ctx.textAlign='center';
    ctx.fillText('ДОМ', hx+hw/2, hy+hh/2+5/sc);
    ctx.fillStyle='#888'; ctx.font=`${10/sc}px Roboto`;
    ctx.fillText(hr.houseL.toFixed(1)+'м', hx+hw/2, hy-6/sc);
    ctx.save(); ctx.translate(hx-6/sc, hy+hh/2);
    ctx.rotate(-Math.PI/2); ctx.textAlign='center';
    ctx.fillText(hr.houseW.toFixed(1)+'м', 0, 0); ctx.restore();
  }

  // Цвета для фоновых слоёв
  const layerStyles = {
    terrace:      { fill:'rgba(0,150,80,.12)',  stroke:'rgba(0,150,80,.5)',  label:'Терраса' },
    pool_terrace: { fill:'rgba(0,80,200,.10)',  stroke:'rgba(0,80,200,.5)',  label:'Терр. бассейна' },
    pier:         { fill:'rgba(26,122,204,.10)',stroke:'rgba(26,122,204,.5)',label:'Причал' },
    fence:        { fill:'none',                stroke:'rgba(0,0,0,.3)',     label:'Забор' },
  };

  // 2. Полигоны: terrace, pool_terrace, pier, fence
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

  // 4. Крыльцо (только если уже настроено — т.е. текущий шаг идёт ПОСЛЕ крыльца в порядке)
  // Новый порядок: terrace → porch → paths → fence → pool_terrace → pier
  const configOrder = ['terrace','porch','paths','fence','pool_terrace','pier'];
  const porchOrdIdx = configOrder.indexOf('porch');
  const curOrdIdx = configOrder.indexOf(excludeName);
  const porchDone = (curOrdIdx >= 0 && porchOrdIdx >= 0 && curOrdIdx > porchOrdIdx);
  if (excludeName !== 'porch' && S.sections.includes('porch') && porchDone) {
    const p = S.porch;
    const px=p.x*W, py=p.y*H, pw=p.w*W, ph=p.h*H;
    ctx.fillStyle='rgba(0,100,220,.10)'; ctx.fillRect(px,py,pw,ph);
    ctx.strokeStyle='rgba(0,100,220,.4)'; ctx.lineWidth=2/sc;
    ctx.setLineDash([4/sc,2/sc]); ctx.strokeRect(px,py,pw,ph); ctx.setLineDash([]);
    ctx.fillStyle='rgba(0,100,220,.5)'; ctx.font=`${10/sc}px Roboto`; ctx.textAlign='center';
    ctx.fillText('Крыльцо', px+pw/2, py+ph/2+4/sc);
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
// КРЫЛЬЦО: drag+resize С ПОКАЗОМ ТЕРРАСЫ В ФОНЕ
// ══════════════════════════════════════════════
const HANDLE_R=18;
let porchDrag=null, porchDragStart=null;

function initPorchCanvas() {
  const wrap=document.getElementById('cw-porch');
  const cv=document.getElementById('cv-porch');
  const dpr=window.devicePixelRatio||1, sz=wrap.offsetWidth;
  cv.width=sz*dpr; cv.height=sz*dpr;
  cv.style.width=sz+'px'; cv.style.height=sz+'px';
  CV['porch']=mkCvState();
  const newCv=cv.cloneNode(false);
  newCv.width=sz*dpr; newCv.height=sz*dpr;
  newCv.style.width=sz+'px'; newCv.style.height=sz+'px';
  wrap.replaceChild(newCv, cv);

  // Рисуем уже после того как новый canvas в DOM
  drawPorchCanvas();

  attachPorchEvents(wrap);
}

// Единый обработчик событий крыльца — чтобы не было конфликта pan vs drag
function attachPorchEvents(wrap) {
  const cx = CV['porch'];
  let touchId = null;     // id пальца, тащящего крыльцо
  let pinchActive = false;

  const getWorld = (clientX, clientY) => {
    const cvEl = document.getElementById('cv-porch');
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
    return {
      x: ((clientX - r.left)*dpr - cx.ox) / cx.scale,
      y: ((clientY - r.top )*dpr - cx.oy) / cx.scale,
      W: cvEl.width,
    };
  };

  // ── TOUCH ──────────────────────────────────────────────────────────
  wrap.addEventListener('touchstart', e=>{
    e.preventDefault();
    if (e.touches.length === 2) {
      // Два пальца → только zoom, drag сбрасываем
      pinchActive = true; porchDrag = null; touchId = null;
      cx.lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      const {x,y,W} = getWorld(t.clientX, t.clientY);
      const hit = hitPorchHandle(x,y,W);
      if (hit) {
        porchDrag = hit;
        porchDragStart = {mx:x, my:y, ...S.porch};
        touchId = t.identifier;
      }
      // Если не в крыльцо — ничего (pan специально отключён,
      // чтобы первое касание всегда захватывало крыльцо)
    }
  },{passive:false});

  wrap.addEventListener('touchmove', e=>{
    e.preventDefault();
    if (pinchActive && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / cx.lastDist; cx.lastDist = dist;
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX)/2,
        y: (e.touches[0].clientY + e.touches[1].clientY)/2,
      };
      const r=wrap.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
      const mx=(mid.x-r.left)*dpr, my=(mid.y-r.top)*dpr;
      const ns=Math.min(cx.maxScale, Math.max(cx.minScale, cx.scale*ratio));
      cx.ox=mx-(mx-cx.ox)*(ns/cx.scale); cx.oy=my-(my-cx.oy)*(ns/cx.scale); cx.scale=ns;
      drawPorchCanvas(); return;
    }
    if (porchDrag && touchId !== null) {
      const t = [...e.touches].find(t=>t.identifier===touchId); if (!t) return;
      const {x,y,W} = getWorld(t.clientX, t.clientY);
      applyPorchDrag(x,y,W);
    }
  },{passive:false});

  wrap.addEventListener('touchend', e=>{
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) { porchDrag=null; porchDragStart=null; touchId=null; }
  },{passive:true});

  // ── МЫШЬ ───────────────────────────────────────────────────────────
  wrap.addEventListener('mousedown', e=>{
    const {x,y,W} = getWorld(e.clientX, e.clientY);
    const hit = hitPorchHandle(x,y,W);
    if (hit) {
      porchDrag=hit; porchDragStart={mx:x,my:y,...S.porch};
      wrap.style.cursor = hit==='move'?'move':'nwse-resize';
    }
  });
  document.addEventListener('mousemove', e=>{
    if (!porchDrag) return;
    const {x,y,W} = getWorld(e.clientX, e.clientY); applyPorchDrag(x,y,W);
  });
  document.addEventListener('mouseup', ()=>{ porchDrag=null; porchDragStart=null; wrap.style.cursor='default'; });

  // Колесо → zoom
  wrap.addEventListener('wheel', e=>{
    e.preventDefault();
    const r=wrap.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    const mx=(e.clientX-r.left)*dpr, my=(e.clientY-r.top)*dpr;
    const f=e.deltaY<0?1.15:0.87;
    const ns=Math.min(cx.maxScale,Math.max(cx.minScale,cx.scale*f));
    cx.ox=mx-(mx-cx.ox)*(ns/cx.scale); cx.oy=my-(my-cx.oy)*(ns/cx.scale); cx.scale=ns;
    drawPorchCanvas();
  },{passive:false});
}

function getPorchRect(W) {
  const p=S.porch; return {x:p.x*W,y:p.y*W,w:p.w*W,h:p.h*W};
}
function hitPorchHandle(wx,wy,W) {
  const {x,y,w,h}=getPorchRect(W), R=HANDLE_R*2;
  for(const [id,cx,cy] of [['nw',x,y],['ne',x+w,y],['sw',x,y+h],['se',x+w,y+h]])
    if(Math.abs(wx-cx)<R && Math.abs(wy-cy)<R) return id;
  if(wx>=x&&wx<=x+w&&wy>=y&&wy<=y+h) return 'move';
  return null;
}
// Snap нормализованной координаты к сетке 0.5 м
function snapNorm(v) { return Math.round(v * GRID / SNAP) * SNAP / GRID; }

function applyPorchDrag(wx,wy,W) {
  const ds=porchDragStart, dx=(wx-ds.mx)/W, dy=(wy-ds.my)/W, mn=SNAP/GRID, p=S.porch;
  if(porchDrag==='move'){
    p.x=snapNorm(Math.max(0,Math.min(1-ds.w,ds.x+dx)));
    p.y=snapNorm(Math.max(0,Math.min(1-ds.h,ds.y+dy)));
  }
  else if(porchDrag==='se'){ p.w=snapNorm(Math.max(mn,ds.w+dx)); p.h=snapNorm(Math.max(mn,ds.h+dy)); }
  else if(porchDrag==='sw'){ const nw=snapNorm(Math.max(mn,ds.w-dx)); p.x=ds.x+ds.w-nw; p.w=nw; p.h=snapNorm(Math.max(mn,ds.h+dy)); }
  else if(porchDrag==='ne'){ p.w=snapNorm(Math.max(mn,ds.w+dx)); const nh=snapNorm(Math.max(mn,ds.h-dy)); p.y=ds.y+ds.h-nh; p.h=nh; }
  else if(porchDrag==='nw'){ const nw2=snapNorm(Math.max(mn,ds.w-dx)); p.x=ds.x+ds.w-nw2; p.w=nw2; const nh2=snapNorm(Math.max(mn,ds.h-dy)); p.y=ds.y+ds.h-nh2; p.h=nh2; }
  drawPorchCanvas();
}

function drawPorchCanvas() {
  const cvEl=document.getElementById('cv-porch'); if (!cvEl) return;
  const ctx=cvEl.getContext('2d'), W=cvEl.width, H=cvEl.height;
  const cx=CV['porch']||{scale:1,ox:0,oy:0};
  applyTransform(ctx,cx,W,H);

  ctx.fillStyle='#d9d9d9'; ctx.fillRect(0,0,W,H);

  // Сетка (0.5 м шаг)
  const step=W/CELLS;
  for(let r=0;r<=CELLS;r++) for(let c=0;c<=CELLS;c++) {
    const isMajor = (r*SNAP)%1===0 && (c*SNAP)%1===0;
    ctx.fillStyle = isMajor ? '#bbb' : '#ccc';
    ctx.beginPath(); ctx.arc(c*step,r*step,(isMajor?2:1.2)/cx.scale,0,Math.PI*2); ctx.fill();
  }
  // Метки метров
  ctx.fillStyle='#999'; ctx.font=`${9/cx.scale}px Roboto`; ctx.textAlign='center';
  for(let m=5;m<=GRID;m+=5) { const px=m/GRID*W; ctx.fillText(m+'м', px, H-3/cx.scale); }

  // Ранее заданные объекты
  drawPreviousLayers(ctx, W, H, cx, 'porch');

  // Крыльцо
  const {x,y,w,h}=getPorchRect(W);
  ctx.fillStyle='rgba(0,100,220,.18)'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle='#0064DC'; ctx.lineWidth=2.5/cx.scale; ctx.strokeRect(x,y,w,h);
  ctx.fillStyle='#0064DC'; ctx.font=`bold ${11/cx.scale}px Roboto`; ctx.textAlign='center';
  ctx.fillText('Крыльцо',x+w/2,y+h/2+4/cx.scale);

  // Ручки
  [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([hpx,hpy])=>{
    ctx.beginPath(); ctx.arc(hpx,hpy,HANDLE_R/cx.scale,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.fill();
    ctx.strokeStyle='#0064DC'; ctx.lineWidth=2/cx.scale; ctx.stroke();
  });
  ctx.restore();
}

// ══════════════════════════════════════════════
