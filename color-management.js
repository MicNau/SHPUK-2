// ══════════════════════════════════════════════
// ЦВЕТА: sRGB на входе, линейные внутри (правка 2026-10-08)
//
// Рендер выводит картинку в sRGB (renderer.outputEncoding = sRGBEncoding), а
// освещение считается в линейном пространстве. Three r128 цвета не переводит:
// `color: 0x7e7e7e` или `color.set('#7e7e7e')` он принимал как ЛИНЕЙНЫЕ, и на
// выходе цвет выходил заметно светлее образца (серый #7e7e7e — #b8bec6 в кадре,
// тёмно-серый #1d2630 — #596f87). Текстуры при этом кодировались правильно, и
// экспозицию когда-то занизили, чтобы «не разбеливало» — так потемнели они.
//
// Здесь — то, что новые версии three делают сами (ColorManagement): цвет,
// заданный шестнадцатеричным числом или CSS-строкой, считается sRGB и
// переводится в линейный; getHex() отдаёт обратно sRGB, поэтому цвет, прочитанный
// и записанный заново (средний цвет текстуры, цвет карниза), не переводится
// дважды. setRGB, конструктор с тремя числами и цвета из GLB (glTF хранит их
// линейными) не трогаются.
//
// Подключать СРАЗУ после three.min.js, до любого кода, создающего цвета.
// ══════════════════════════════════════════════
(function () {
  if (typeof THREE === 'undefined' || !THREE.Color || THREE.Color.prototype._srgbPatched) return;
  const P = THREE.Color.prototype;
  const setHex = P.setHex, setStyle = P.setStyle, getHex = P.getHex;

  P.setHex = function (hex) {
    setHex.call(this, hex);
    return this.convertSRGBToLinear();
  };

  // Имена цветов ('white') setStyle разбирает через setHex — они уже переведены.
  // Остальные формы (#hex, rgb(), hsl()) он пишет в r, g, b напрямую.
  P.setStyle = function (style) {
    setStyle.call(this, style);
    if (/^\s*(#|rgb|hsl)/i.test(String(style))) this.convertSRGBToLinear();
    return this;
  };

  P.getHex = function () {
    return getHex.call(this.clone().convertLinearToSRGB());
  };

  P._srgbPatched = true;
})();
