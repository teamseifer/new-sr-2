/* api-bridge.js — Programa CNH do Brasil  (v2 — compat nginx + Cloudflare Pages)
 * O front (app React compilado + upsells) chama rotas relativas /api/...
 *
 * v1 (host antigo, nginx sem rewrite): reescrevia /api/* -> api_proxy.php?cnh_api=*
 * v2: detecta SOZINHO qual backend esta no ar e escolhe o formato:
 *   - Cloudflare Pages/Functions -> usa /api/... direto (sem PHP)
 *   - host nginx/PHP atual        -> reescreve para /api_proxy.php?cnh_api=...
 * A deteccao e um probe rapido em /api/ping (e /api_proxy.php?action=ping).
 * Se uma chamada cair em 404/405 sem JSON, ela e reenviada no outro formato.
 * Um 404 JSON (rota que a API ainda nao tem) NAO troca o backend.
 */
(function () {
  if (window.__cnhApiBridge) return;
  window.__cnhApiBridge = true;

  var LEGACY = '/api_proxy.php';
  var API_RE = /^(?:https?:\/\/[^\/]+)?(\/api\/[^?#]*)(\?[^#]*)?/;
  // Host atual e a Cloudflare. O PHP antigo so e usado se /api/* nao responder JSON.
  var useLegacy = !!(typeof window !== 'undefined' && window.__CNH_LOCAL_PHP__) || !(/\.pages\.dev$/i.test(String(typeof location !== 'undefined' && location.hostname ? location.hostname : '')));
  var decided = !!(typeof window !== 'undefined' && window.__CNH_LOCAL_PHP__);

  function parts(u) {
    var m = API_RE.exec(String(u || ''));
    if (!m) return null;
    return { path: m[1], qs: m[2] || '' };
  }
  function modernUrl(p) { return p.path + p.qs; }
  function legacyUrl(p) {
    var route = p.path.replace(/^\/api\//, '');
    return LEGACY + '?cnh_api=' + encodeURIComponent(route) + (p.qs ? '&' + p.qs.substring(1) : '');
  }
  function isJson(r) {
    try { return !!(r && r.ok && String((r.headers && r.headers.get('content-type')) || '').indexOf('json') >= 0); }
    catch (e) { return false; }
  }
  function hasJson(r) {
    try { return !!(r && String((r.headers && r.headers.get('content-type')) || '').indexOf('json') >= 0); }
    catch (e) { return false; }
  }

  var origFetch = window.fetch;

  function legacyProbe() {
    try {
      origFetch.call(window, '/api_proxy.php?action=ping', { method: 'GET', cache: 'no-store' })
        .then(function (r) { if (isJson(r)) { useLegacy = true; decided = true; window.__cnhApiMode = 'legacy-php'; } })
        .catch(function () {});
    } catch (e) {}
  }
  function cpfBodyHasNome(body) {
    try { return !!(body && typeof body === 'object' && String(body.nome || '').trim() !== ''); }
    catch (e) { return false; }
  }
  function probe() {
    if (typeof origFetch !== 'function') return;
    var onCustomHost = !(/\.pages\.dev$/i.test(String(location.hostname || '')));
    function cloudProbe() {
      try {
        origFetch.call(window, '/api/ping', { method: 'GET', cache: 'no-store' })
          .then(function (r) {
            if (isJson(r)) { useLegacy = false; decided = true; window.__cnhApiMode = 'cloudflare-pages'; return; }
            legacyProbe();
          })
          .catch(legacyProbe);
      } catch (e) { legacyProbe(); }
    }
    if (onCustomHost) {
      try {
        origFetch.call(window, '/api_proxy.php?action=ping', { method: 'GET', cache: 'no-store' })
          .then(function (r) {
            if (isJson(r)) { useLegacy = true; decided = true; window.__cnhApiMode = 'legacy-php'; return; }
            cloudProbe();
          })
          .catch(cloudProbe);
      } catch (e) { cloudProbe(); }
      return;
    }
    cloudProbe();
  }
  if (window.__CNH_LOCAL_PHP__) {
    useLegacy = true;
    decided = true;
    window.__cnhApiMode = 'legacy-php';
  } else {
    probe();
  }

  // ---- fetch: escolhe o formato e, em 404, tenta o outro --------------------
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = '';
      if (typeof input === 'string') url = input;
      else if (input && typeof input.url === 'string') url = input.url;

      if (typeof url === 'string' && (url.indexOf('/api_proxy.php') === 0 || url.indexOf('api_proxy.php?') !== -1)) {
        return origFetch.call(this, input, init);
      }
      var p = parts(url);
      if (!p) return origFetch.call(this, input, init);

      var primary = useLegacy ? legacyUrl(p) : modernUrl(p);
      var secondary = useLegacy ? modernUrl(p) : legacyUrl(p);
      var canRetry =
        typeof input === 'string' &&
        primary !== secondary &&
        (!init || !init.body || typeof init.body === 'string');

      var target = primary === url ? input : primary;
      var call = origFetch.call(this, target, init);
      if (!canRetry) return call;

      var self = this;
      return call.then(function (res) {
        if (p.path.indexOf('/api/consulta-cpf/') === 0 && hasJson(res) && !useLegacy) {
          return res.clone().json().then(function (body) {
            if (cpfBodyHasNome(body)) return res;
            try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
            useLegacy = true;
            decided = true;
            window.__cnhApiMode = 'legacy-php';
            return origFetch.call(self, legacyUrl(p), init);
          }).catch(function () { return res; });
        }
        var wrongHost = res && !hasJson(res) && (res.status === 404 || res.status === 405);
        if (!wrongHost) return res;
        try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
        useLegacy = secondary === legacyUrl(p);
        return origFetch.call(self, secondary, init);
      });
    };
  }

  // ---- XMLHttpRequest: usa o formato escolhido no momento da chamada --------
  if (window.XMLHttpRequest && XMLHttpRequest.prototype.open) {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        var p = parts(url);
        if (p) {
          this.__cnhApiLegacy = useLegacy;
          arguments[1] = useLegacy ? legacyUrl(p) : modernUrl(p);
        }
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }
})();
