/* ===== Configuração do funil SERASA LIMPA NOME =====
   Edite aqui os IDs de pixel. Valores dos produtos são os da oferta original. */
window.SR_CONFIG = {
  META_PIXEL_ID: '1601503185054241',
  UTMIFY_PIXEL_ID: '679fb0f4bbdfc9f47bf2c735',
  ACORDO_CODE: 'X1KAL-10S--',
  CONTRACT: 'ACC.3289898302-2026',
  ACORDO_PRICE: 66.38,
  ACORDO_PRICE_OSC: 0.5,
  ACORDO_DOWNSELL_PRICE: 34.90,
  ACORDO_AMOUNT_KEY: 'sr_acordo_amount'
};
(function (C) {
  var BASE = Number(C.ACORDO_PRICE) || 66.38;
  var OSC = Number(C.ACORDO_PRICE_OSC);
  if (!OSC || OSC < 0) OSC = 0.5;
  var KEY = C.ACORDO_AMOUNT_KEY || 'sr_acordo_amount';
  var cents = Math.round(OSC * 100);

  function readStored() {
    try {
      var s = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
      if (s) {
        var v = parseFloat(s);
        if (!isNaN(v) && v > 0) return Math.round(v * 100) / 100;
      }
    } catch (e) {}
    return null;
  }

  function store(amount) {
    try {
      sessionStorage.setItem(KEY, String(amount));
      localStorage.setItem(KEY, String(amount));
    } catch (e) {}
  }

  C.getAcordoAmount = function (forceNew) {
    if (!forceNew) {
      var cached = readStored();
      if (cached != null) return cached;
    }
    var osc = (Math.floor(Math.random() * (cents * 2 + 1)) - cents) / 100;
    var amount = Math.round((BASE + osc) * 100) / 100;
    store(amount);
    return amount;
  };

  C.fmtAcordoPrice = function (n) {
    var v = n != null ? Number(n) : C.getAcordoAmount(false);
    if (isNaN(v)) v = BASE;
    return 'R$ ' + v.toFixed(2).replace('.', ',');
  };
})(window.SR_CONFIG);
(function(){
  var C = window.SR_CONFIG;
  /* Meta Pixel — so injeta se a pagina ainda nao tiver o snippet na <head>. */
  if (C.META_PIXEL_ID && typeof window.fbq !== 'function') {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', C.META_PIXEL_ID); fbq('track', 'PageView');
  }
  /* UTMify pixel.js — so injeta se a pagina ainda nao tiver carregado. */
  if (C.UTMIFY_PIXEL_ID && C.UTMIFY_PIXEL_ID !== 'COLOQUE_SEU_PIXEL_ID') {
    if (!window.pixelId) window.pixelId = C.UTMIFY_PIXEL_ID;
    if (!document.querySelector('script[src*="cdn.utmify.com.br/scripts/pixel/pixel.js"]')) {
      var a = document.createElement('script'); a.async = true; a.defer = true; a.src = 'https://cdn.utmify.com.br/scripts/pixel/pixel.js'; document.head.appendChild(a);
    }
  }
  // utms/latest.js agora e carregado pelo script oficial da UTMify na <head> de cada pagina (zip 80).
})();
