import {
  cfg, json, createPix, checkStatus, consultarCpf, trackSale, uploadComprovante, handleWebhook,
} from './_lib.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').trim();
  const c = cfg(env);

  try {
    if (action === 'ping') {
      return json({
        ok: true,
        message: 'api_proxy OK.',
        php_version: 'pages-functions',
        curl_enabled: true,
        mangofy: !!(c.mangofyKey && c.mangofyStore),
        utmify: !!c.utmifyToken,
      });
    }
    if (action === 'create_pix') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Metodo nao permitido. Use POST.' }, 405);
      let body = {};
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'JSON invalido.' }, 400); }
      return await createPix(c, body, request, context);
    }
    if (action === 'check_status') {
      const id = url.searchParams.get('id') || url.searchParams.get('clientIdentifier') || '';
      return await checkStatus(c, String(id).trim(), context);
    }
    if (action === 'consultar_cpf') {
      return await consultarCpf(c, url.searchParams.get('cpf') || '');
    }
    const cnh = String(url.searchParams.get('cnh_api') || '').replace(/^\/+/, '');
    const mCpf = cnh.match(/^consulta-cpf\/(\d{11})$/);
    if (mCpf) {
      return await consultarCpf(c, mCpf[1]);
    }
    if (cnh === 'ping') {
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
    if (action === 'upload_comprovante') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Metodo nao permitido. Use POST.' }, 405);
      return await uploadComprovante(c, request);
    }
    if (action === 'track_sale') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Metodo nao permitido. Use POST.' }, 405);
      let body = {};
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'JSON invalido.' }, 400); }
      return await trackSale(c, body, request);
    }
    if (action === 'trk') {
      return json({ ok: true, sid: crypto.randomUUID() });
    }
    if (action === 'webhook') {
      return await handleWebhook(c, request, context);
    }
    return json({ ok: false, error: 'Acao desconhecida.' }, 400);
  } catch (e) {
    return json({ ok: false, error: 'Erro interno no proxy.' }, 500);
  }
}
