/* Guarda de saída do PIX do front (rota /pix-payment do app).
 * Quando o QR Code / copia-e-cola já foi gerado e o lead tenta VOLTAR,
 * ele é levado para /back-redirect.html (aviso de pagamento + gerar PIX de novo).
 * Fechar a aba não pode ser impedido pelo navegador: só exibimos o aviso padrão (beforeunload).
 * Desarma sozinho quando o pagamento é confirmado ("Pagamento Confirmado!" na tela) ou ao sair da rota. */
(function () {
  var BACK_URL = '/back-redirect.html';
  var armed = false, confirmed = false;

  function onPixRoute() { return location.pathname.replace(/\/+$/, '') === '/pix-payment'; }
  function pixVisible() {
    var b = document.body ? document.body.innerText || '' : '';
    if (b.indexOf('Pagamento Confirmado') !== -1) { confirmed = true; return false; }
    return b.indexOf('Copiar Código PIX') !== -1 || b.indexOf('Copiado!') !== -1;
  }
  function active() { return armed && !confirmed && onPixRoute(); }

  function arm() {
    if (armed) return;
    armed = true;
    try {
      history.pushState({ cnhGuard: 1 }, '', location.href);
      history.pushState({ cnhGuard: 2 }, '', location.href);
    } catch (e) {}
  }

  window.addEventListener('popstate', function () {
    if (!active()) return;
    if (pixVisible()) {
      location.replace(BACK_URL + location.search);
    } else {
      try { history.pushState({ cnhGuard: 3 }, '', location.href); } catch (e) {}
    }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (!active() || !pixVisible()) return;
    ev.preventDefault();
    ev.returnValue = 'Seu PIX ainda não foi pago. Deseja realmente sair?';
    return ev.returnValue;
  });

  setInterval(function () {
    if (onPixRoute()) {
      if (!armed && pixVisible()) arm();
      else if (armed) pixVisible(); // atualiza flag "confirmed"
    } else if (armed && !onPixRoute()) {
      armed = false; confirmed = false; // saiu da rota pelo próprio app (ex.: sucesso -> upsell)
    }
  }, 500);
})();
