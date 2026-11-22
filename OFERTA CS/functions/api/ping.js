import { cfg, json } from '../_lib.js';

export async function onRequestGet(context) {
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