import { cfg, json, consultarCpf } from '../_lib.js';

export async function onRequestGet(context) {
  const path = String(context.params.path || '').replace(/^\/+/, '');
  if (path === 'ping') {
    const c = cfg(context.env);
    return json({
      ok: true,
      message: 'api_proxy OK.',
      php_version: 'pages-functions',
      curl_enabled: true,
      mangofy: !!(c.mangofyKey && c.mangofyStore),
      utmify: !!c.utmifyToken,
      cpf: !!(c.cpfApiKey || c.cpfApi3Token),
    });
  }
  const m = path.match(/^consulta-cpf\/(\d{11})$/);
  if (m) {
    return consultarCpf(cfg(context.env), m[1]);
  }
  return json({ ok: false, error: 'Rota nao encontrada', path }, 404);
}