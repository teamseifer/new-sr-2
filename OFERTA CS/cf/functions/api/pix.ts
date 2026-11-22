/**
 * POST /api/pix — cria o PIX na MangoFy e devolve o formato EXATO que o front
 * espera (mesmo contrato de cnh_compat.php → action=create_pix):
 *
 *   {success, transaction_id, deposit_id, identifier, pix_code, qr_code,
 *    qr_code_base64, qr_code_image, amount, status, expiration, pix:{...}}
 */

import type { Env } from '../lib/env';
import {
  corsHeaders,
  digits,
  json,
  mapFrontStatus,
  preflight,
  readJson,
  sha1Hex,
  sleep,
  str,
} from '../lib/http';
import { readTrk, saveTx } from '../lib/store';
import { buildUtmifyOrder, sendUtmifyPending } from '../lib/utmify';
import { buildMangofyPayload, mangofyRequest } from '../lib/mangofy';
import { MANGOFY_PIX_PATH } from '../lib/env';
import {
  errorMessage,
  extractPixCode,
  extractPixQr,
  extractTransactionObject,
  pickVal,
  productFromAmount,
} from '../lib/velani';

/** Valor base do checkout. Cada PIX sai entre 50 centavos abaixo e 50 acima. */
const PIX_BASE = 65.7;
const PIX_BAND_CENTS = 50;

function varyBasePixAmount(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  if (Math.abs(rounded - PIX_BASE) > 0.001) return rounded;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  let cents = (buf[0] % (PIX_BAND_CENTS * 2 + 1)) - PIX_BAND_CENTS;
  if (cents === 0) cents = (buf[0] & 1) === 0 ? 1 : -1;
  return Math.round(PIX_BASE * 100 + cents) / 100;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function fromUrlParams(url: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!url) return out;
  try {
    const q = url.split('?')[1];
    if (!q) return out;
    for (const [k, v] of new URLSearchParams(q)) if (v) out[k] = v;
  } catch {
    /* ignora */
  }
  return out;
}

const TRACK_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'fbclid', 'gclid', 'ttclid', 'src', 'sck', 'xcod',
  'cck', 'cname', 'domain', 'placement', 'adset', 'adname', 'site', 'xgo', 'pvid',
  'fbc', 'fbp',
];

function normalizeTrack(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  const o = input as Record<string, unknown>;
  for (const k of TRACK_KEYS) {
    const direct = o[k];
    const alt = o[k.replace(/^utm_/, '')];
    const v = typeof direct === 'string' ? direct : typeof alt === 'string' ? alt : '';
    if (v && v !== 'null') out[k] = v.slice(0, 300);
  }
  return out;
}

function fillMissing(target: Record<string, string>, extra: Record<string, string>): boolean {
  let filled = false;
  for (const [k, v] of Object.entries(extra)) {
    if (!target[k] && v) {
      target[k] = v;
      filled = true;
    }
  }
  return filled;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const { request } = ctx;
  const env = ctx.env;

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Metodo nao permitido' }, 405, corsHeaders());
  }

  const b = await readJson(request);
  const amountRaw = str(b.amount).replace(',', '.');
  const amount = parseFloat(amountRaw);
  if (!isFinite(amount) || amount <= 0) {
    return json({ success: false, error: 'Valor invalido' }, 400, corsHeaders());
  }

  const origin = str(b.origin); // 'br' (back redirect) | 'ds' (downsell) | ''
  const product = productFromAmount(amount, origin);
  const charged = varyBasePixAmount(amount);

  const name = str(b.customer_name).trim();
  const email = str(b.customer_email).trim();
  let phone = digits(b.customer_phone);
  const cpf = digits(b.customer_cpf);
  if (phone === '' || phone.length < 10) phone = '11999999999';
  if (cpf === '') {
    return json({ success: false, error: 'CPF do cliente obrigatorio' }, 400, corsHeaders());
  }

  // ---- tracking (UTMs) -----------------------------------------------------
  const cookies = parseCookies(request.headers.get('cookie'));
  let utm = (b.utm && typeof b.utm === 'object' ? (b.utm as Record<string, unknown>) : {}) as Record<string, string>;
  let hasUtm = Object.values(utm).some((v) => v !== null && v !== undefined && v !== '');
  if (!hasUtm) {
    const ref = request.headers.get('referer') || '';
    const refParams = fromUrlParams(ref);
    if (Object.keys(refParams).length) {
      utm = { ...refParams, ...utm } as Record<string, string>;
      hasUtm = true;
    }
  }

  const track: Record<string, string> = { isUpsell: product.isUpsell ? 'true' : '' };
  if (!product.isUpsell) delete track.isUpsell;
  else track.isUpsell = 'true';
  for (const k of ['source', 'medium', 'campaign', 'content', 'term', 'id'] as const) {
    const v = (utm[`utm_${k}`] as string) || (utm[k] as string) || '';
    if (v) track[`utm_${k}`] = String(v).slice(0, 300);
  }
  for (const k of ['src', 'sck'] as const) {
    if (utm[k]) track[k] = String(utm[k]).slice(0, 300);
  }

  // cookie cnh_trk (track-plus) + cookies Meta
  const trkCookie = cookies.cnh_trk ? normalizeTrack(safeJson(cookies.cnh_trk)) : {};
  fillMissing(track, trkCookie);
  if (utm.fbclid) track.fbclid = String(utm.fbclid).slice(0, 300);
  if (cookies._fbp) track.fbp = cookies._fbp;
  if (cookies._fbc) track.fbc = cookies._fbc;
  else if (track.fbclid) track.fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${track.fbclid}`;

  // Fase 1: sessao gravada pelo /api/trk (KV) completa o que faltou.
  const sid = cookies.cnh_sid || str(b.trk_id) || randomHex(16);
  try {
    const known = await readTrk(env, sid);
    if (known) {
      const norm = normalizeTrack(known);
      if (fillMissing(track, norm)) {
        if (norm.fbclid && !track.fbclid) track.fbclid = norm.fbclid;
        if (norm.fbp && !track.fbp) track.fbp = norm.fbp;
        if (norm.fbc && !track.fbc) track.fbc = norm.fbc;
      }
    }
  } catch {
    /* tracking nunca quebra o PIX */
  }

  // ---- identifier ----------------------------------------------------------
  const amountStr = charged.toFixed(2);
  const identifier =
    'CNH-' +
    (await sha1Hex(`${cpf}|${amountStr}|${Date.now()}|${Math.random()}`)).slice(0, 16).toUpperCase();

  // ---- postbackUrl (webhook por transacao, com token quando houver) -------
  const originUrl = new URL(request.url).origin;
  let callbackUrl = `${originUrl}/api/webhook`;
  const whSecret = (env.WEBHOOK_SECRET || '').trim();
  if (whSecret !== '') callbackUrl += `?token=${encodeURIComponent(whSecret)}`;

  const mangofyBody = buildMangofyPayload({
    identifier,
    amount: charged,
    productType: product.type,
    isUpsell: product.isUpsell,
    client: { name, email, phone, document: cpf },
    callbackUrl,
    ip: request.headers.get('cf-connecting-ip') || '',
    metadata: track,
  });

  let result = await mangofyRequest(env, 'POST', MANGOFY_PIX_PATH, mangofyBody);
  if (result.transportError || result.httpStatus >= 500) {
    await sleep(1500);
    const retry = await mangofyRequest(env, 'POST', MANGOFY_PIX_PATH, mangofyBody);
    if (!retry.transportError && retry.httpStatus < 500) result = retry;
  }

  if (result.transportError) {
    return json(
      { success: false, error: 'Falha de conexao com gateway' },
      502,
      corsHeaders()
    );
  }

  const failed =
    result.httpStatus >= 400 ||
    (result.data &&
      typeof result.data === 'object' &&
      (result.data as Record<string, unknown>).success === false);
  if (failed) {
    let code = result.httpStatus >= 400 ? result.httpStatus : 400;
    const d = result.data as Record<string, unknown> | null;
    if (d && d.error && typeof d.error === 'object') {
      const sc = (d.error as Record<string, unknown>).statusCode;
      if (typeof sc === 'number' && sc >= 400 && sc < 600) code = sc;
    }
    const msg = errorMessage(result.data, 'Erro ao gerar PIX');
    return json(
      { success: false, error: msg },
      code >= 400 && code < 600 ? code : 502,
      corsHeaders()
    );
  }

  if (!result.data || typeof result.data !== 'object') {
    return json({ success: false, error: 'Resposta invalida do gateway.' }, 502, corsHeaders());
  }

  const decoded = result.data;
  let tx = extractTransactionObject(decoded) || {};
  if (!Object.keys(tx).length && (decoded as Record<string, unknown>).data) {
    const inner = (decoded as Record<string, unknown>).data;
    if (inner && typeof inner === 'object') tx = inner as Record<string, unknown>;
  }

  const txIdRaw = pickVal(tx, ['payment_code', 'id', 'transactionId', 'transaction_id', 'uid']);
  const txId = txIdRaw !== null ? str(txIdRaw) : str(pickVal(decoded, ['payment_code', 'id', 'transactionId', 'transaction_id']));
  let status = pickVal(tx, ['payment_status', 'status']);
  if (status === null) status = pickVal(decoded, ['payment_status', 'status']);
  const statusStr = status !== null ? str(status) : 'PENDING';

  if (
    ['FAILED', 'REJECTED', 'REFUSED', 'ERROR', 'EXPIRED', 'CANCELED', 'CANCELLED', 'GATEWAY_ERROR', 'SYSTEM_ERROR'].indexOf(
      statusStr.toUpperCase()
    ) !== -1
  ) {
    const errDesc = pickVal(decoded, ['errorDescription', 'message', 'error']);
    return json(
      {
        success: false,
        error:
          typeof errDesc === 'string' && errDesc !== ''
            ? errDesc
            : 'O gateway recusou a criacao do PIX. Tente novamente.',
      },
      400,
      corsHeaders()
    );
  }

  let pixCode = extractPixCode(tx, decoded) || '';
  let pixQr = extractPixQr(tx, decoded) || '';

  // Defensivo: criacao sem copia-e-cola -> consulta a transacao (3x, 2s).
  if (pixCode === '' && txId) {
    for (let i = 0; i < 3 && pixCode === ''; i++) {
      await sleep(2000);
      const poll = await mangofyRequest(env, 'GET', `${MANGOFY_PIX_PATH}/${encodeURIComponent(txId)}`);
      if (poll.transportError || poll.httpStatus >= 400 || !poll.data) continue;
      const ptx = extractTransactionObject(poll.data) || {};
      pixCode = extractPixCode(ptx, poll.data) || '';
      pixQr = extractPixQr(ptx, poll.data) || '';
      const s = pickVal(ptx, ['status']);
      if (s !== null) status = s;
    }
    if (pixCode === '') {
      return json(
        {
          success: false,
          error:
            'O PIX esta sendo processado pelo gateway e ainda nao ficou pronto. Tente novamente em alguns segundos.',
          transaction_id: txId,
          status: mapFrontStatus(status),
        },
        504,
        corsHeaders()
      );
    }
  }

  // ---- registro local (KV) — alimenta /api/transaction e o fastpath --------
  if (txId) {
    const createdAt = new Date().toISOString();
    await saveTx(env, {
      txid: txId,
      identifier,
      amount: charged,
      name,
      pixCode,
      pixQr,
      status: statusStr,
      productType: product.type,
      productName: product.name,
      createdAt,
    });
    const aliases = [txId, identifier];
    for (const src of [tx, decoded as Record<string, unknown>]) {
      if (!src || typeof src !== 'object') continue;
      for (const k of [
        'payment_code', 'external_code', 'id', 'transaction_id', 'transactionId',
        'external_id', 'externalId', 'identifier', 'saleId', 'uid',
      ]) {
        const v = (src as Record<string, unknown>)[k];
        if (typeof v === 'string' || typeof v === 'number') aliases.push(String(v));
      }
    }
    const order = buildUtmifyOrder({
      orderId: txId,
      amount: charged,
      productType: product.type,
      name,
      email,
      phone,
      document: cpf,
      ip: request.headers.get('cf-connecting-ip') || '',
      track,
      gatewayData: decoded,
      createdAt,
    });
    ctx.waitUntil(sendUtmifyPending(env, order, aliases));
  }

  // ---- resposta no formato do front ---------------------------------------
  let b64 = pixQr;
  if (b64 && !/^data:/i.test(b64)) b64 = `data:image/png;base64,${b64}`;
  const pixImage = pixQr && /^https?:/i.test(pixQr) ? pixQr : '';

  const cookie =
    cookies.cnh_sid === sid ? '' : `cnh_sid=${sid}; Path=/; Max-Age=604800; SameSite=Lax`;

  return json(
    {
      success: true,
      transaction_id: txId,
      deposit_id: txId,
      identifier,
      pix_code: pixCode,
      qr_code: pixCode,
      qr_code_base64: b64,
      qr_code_image: pixImage,
      amount: charged,
      status: mapFrontStatus(status),
      expiration: new Date(Date.now() + 1800 * 1000).toISOString(),
      pix: { qr_code: pixCode, qr_code_base64: b64 },
    },
    200,
    cookie ? { ...corsHeaders(), 'set-cookie': cookie } : corsHeaders()
  );
};

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return {};
    }
  }
}

function randomHex(len: number): string {
  const buf = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, len);
}
