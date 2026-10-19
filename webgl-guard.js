// ══════════════════════════════════════════════
// WebGL: проверка, сбои видеокарты и рекомендации (правка 2026-10-19)
// ══════════════════════════════════════════════
// У заказчика 3D-окно периодически оставалось пустым без единого слова. Причины
// на стороне браузера и видеокарты, но молчать о них нельзя:
//   • WebGL не создаётся: видеокарта в чёрном списке, ускорение выключено или
//     браузер сам отключил его после нескольких падений процесса GPU. Новые
//     Chromium (и Яндекс.Браузер) больше не переходят на программный WebGL —
//     конструктор THREE.WebGLRenderer бросал исключение, и окно было пустым;
//   • контекст отняли во время работы (сброс драйвера, нехватка видеопамяти) —
//     канвас гас до перезагрузки страницы.
// Здесь только диагностика и сообщения; восстановление сцены — в
// viewer3d-core.js (init3dCanvas, _glOnLost/_glAfterRestore/_glRecreate).
// Файл подключается ДО viewer3d-core.js.

const GL_GUARD = {
  probe: null,        // последний результат glProbe()
  low: false,         // упрощённый режим: без сглаживания, pixelRatio 1, тени попроще
  losses: 0,          // сколько раз за сессию отняли контекст
  lastError: null,    // текст исключения при создании рендерера
  closed: {},         // плашки, закрытые пользователем (kind → true)
};

// Программная отрисовка (без видеокарты): SwiftShader, llvmpipe, «Basic Render
// Driver» Windows. С ней 3D идёт, но медленно, и тяжёлые настройки душат его.
const GL_SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

// Пробует создать контекст на отдельном канвасе и сразу его освобождает.
// failIfMajorPerformanceCaveat: браузер откажет, если рисовать он будет без
// видеокарты, — так программный режим видно и без имени видеокарты.
function glProbe() {
  const out = { ok: false, webgl2: false, renderer: '', vendor: '', software: false, maxTex: 0, error: null };
  const tryCtx = (name, attrs) => {
    try { return document.createElement('canvas').getContext(name, attrs) || null; }
    catch (e) { out.error = e && e.message || String(e); return null; }
  };
  const strict = { failIfMajorPerformanceCaveat: true };
  let gl = tryCtx('webgl2', strict) || tryCtx('webgl', strict);
  if (!gl) {
    gl = tryCtx('webgl2') || tryCtx('webgl') || tryCtx('experimental-webgl');
    if (gl) out.software = true;
  }
  if (!gl) { GL_GUARD.probe = out; return out; }
  out.ok = true;
  out.webgl2 = (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext;
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    out.vendor   = String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR) || '');
    out.maxTex   = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
  } catch (_) { /* сведения необязательны */ }
  if (GL_SOFTWARE_RE.test(out.renderer)) out.software = true;
  // Контекст пробы держит место в лимите браузера (около 16 на страницу) —
  // отдаём его сразу, не дожидаясь сборщика мусора.
  try { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (_) {}
  GL_GUARD.probe = out;
  return out;
}

// Где включается аппаратное ускорение — в браузере пользователя.
function _glAccelHint() {
  const ua = navigator.userAgent || '';
  if (/YaBrowser/.test(ua)) return 'Настройки → Системные → Производительность → «Использовать аппаратное ускорение, если возможно»';
  if (/Edg\//.test(ua))     return 'Настройки → Система и производительность → «Использовать графическое ускорение, если оно доступно»';
  if (/OPR\//.test(ua))     return 'Настройки → Браузер → Система → «Использовать аппаратное ускорение, если доступно»';
  if (/Firefox\//.test(ua)) return 'Настройки → Основные → Производительность → «По возможности использовать аппаратное ускорение»';
  if (/Chrome\//.test(ua))  return 'Настройки → Система → «Использовать графическое ускорение (при наличии)»';
  return 'в настройках браузера, раздел «Система» или «Производительность»';
}

function _glBrowserName() {
  const ua = navigator.userAgent || '';
  const m = ua.match(/YaBrowser\/[\d.]+|Edg\/[\d.]+|OPR\/[\d.]+|Firefox\/[\d.]+|Chrome\/[\d.]+|Version\/[\d.]+ Safari/);
  return m ? m[0].replace('YaBrowser', 'Яндекс.Браузер').replace('Edg', 'Edge').replace('OPR', 'Opera') : 'неизвестный браузер';
}

// Строка сведений внизу сообщения: со скриншотом окна поддержка сразу видит
// браузер и видеокарту, не расспрашивая пользователя.
function _glInfoLine() {
  const p = GL_GUARD.probe || {};
  const gpu = p.renderer || (p.ok ? 'не сообщается' : 'недоступна');
  const parts = [_glBrowserName(), 'видеокарта: ' + gpu,
                 'WebGL: ' + (p.ok ? (p.webgl2 ? '2' : '1') + (p.software ? ', программный' : '') : 'нет')];
  if (GL_GUARD.losses) parts.push('сбоев: ' + GL_GUARD.losses);
  if (GL_GUARD.lastError) parts.push(GL_GUARD.lastError);
  return parts.join(' · ');
}

const _glEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Тексты сообщений. kind:
//   none       — WebGL недоступен совсем (блокирующее окно);
//   restarting — контекст отняли, ждём, пока браузер вернёт (блокирующее, без кнопок);
//   lost       — не вернул и пересоздать не вышло (блокирующее, кнопка «Перезапустить 3D»);
//   unstable   — сбои были, 3D восстановлен в упрощённом режиме (плашка);
//   software   — рисуем без видеокарты, режим упрощён (плашка).
function _glMessage(kind) {
  const accel = `Включите аппаратное ускорение: ${_glEsc(_glAccelHint())}.`;
  const restart = 'Полностью перезапустите браузер: после нескольких сбоев видеокарты он отключает её до перезапуска.';
  const driver = 'Обновите драйвер видеокарты.';
  const other = 'Откройте конфигуратор в другом браузере — Chrome, Edge или Firefox.';
  const tabs = 'Закройте другие вкладки с 3D, видео или играми — им тоже нужна видеопамять.';
  switch (kind) {
    case 'none': return { title: '3D-просмотр недоступен',
      lead: 'Браузер не дал странице доступ к видеокарте (WebGL), поэтому дом не отображается.',
      tips: [accel, restart, driver, other] };
    case 'restarting': return { title: '3D-вид перезапускается…',
      lead: 'Видеокарта перестала отвечать. Проект не теряется — ждём, пока браузер вернёт доступ к ней.',
      tips: [] };
    case 'lost': return { title: '3D-вид остановлен',
      lead: 'Видеокарта перестала отвечать, и браузер не вернул доступ к ней. Проект не потерян.',
      tips: [tabs, restart, driver, other], button: 'Перезапустить 3D' };
    case 'unstable': return { title: '3D восстановлен в упрощённом режиме',
      lead: 'Видеокарта уже сбрасывалась в этой сессии.',
      tips: [tabs, driver] };
    case 'software': return { title: 'Упрощённый 3D-режим',
      lead: 'Браузер рисует 3D без видеокарты — вид упрощён и может работать медленно.',
      tips: [accel, restart] };
  }
  return null;
}

// Блокирующее окно поверх 3D-слота. Одно на страницу: переезжает вместе с
// видом (glGuardFollow) и при смене вида меняет только текст.
function glNoticeShow(slot, kind, onButton) {
  const msg = _glMessage(kind);
  if (!slot || !msg) return;
  let el = document.getElementById('gl-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gl-notice';
    el.className = 'gl-notice';
  }
  if (el.parentNode !== slot) slot.appendChild(el);
  el.dataset.kind = kind;
  el.innerHTML = `<div class="gl-card">
      <div class="gl-title">${_glEsc(msg.title)}</div>
      <div class="gl-lead">${_glEsc(msg.lead)}</div>
      ${msg.tips.length ? `<div class="gl-sub">Что можно сделать:</div><ol class="gl-tips">${msg.tips.map(t => `<li>${t}</li>`).join('')}</ol>` : '<div class="gl-spin"></div>'}
      ${msg.button ? `<button type="button" class="gl-btn">${_glEsc(msg.button)}</button>` : ''}
      <div class="gl-info">${_glEsc(_glInfoLine())}</div>
    </div>`;
  const btn = el.querySelector('.gl-btn');
  if (btn && onButton) btn.onclick = onButton;
}

function glNoticeHide() {
  const el = document.getElementById('gl-notice');
  if (el) el.remove();
}

// Неблокирующая плашка внизу 3D-вида; закрытая крестиком больше не появляется.
function glBannerShow(slot, kind) {
  const msg = _glMessage(kind);
  if (!slot || !msg || GL_GUARD.closed[kind]) return;
  let el = document.getElementById('gl-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gl-banner';
    el.className = 'gl-banner';
  }
  if (el.parentNode !== slot) slot.appendChild(el);
  el.dataset.kind = kind;
  el.innerHTML = `<button type="button" class="gl-close" aria-label="Закрыть">×</button>
    <div class="gl-title">${_glEsc(msg.title)}</div>
    <div class="gl-lead">${_glEsc(msg.lead)} ${msg.tips.join(' ')}</div>
    <div class="gl-info">${_glEsc(_glInfoLine())}</div>`;
  el.querySelector('.gl-close').onclick = () => { GL_GUARD.closed[kind] = true; el.remove(); };
}

// Вид переехал в другой слот (moveThreeTo) — сообщения едут с ним.
function glGuardFollow(slot) {
  if (!slot) return;
  for (const id of ['gl-notice', 'gl-banner']) {
    const el = document.getElementById(id);
    if (el && el.parentNode !== slot) slot.appendChild(el);
  }
}
