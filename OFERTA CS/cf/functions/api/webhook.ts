/**
 * POST /api/webhook — postback da MangoFy (postback_url vai em CADA transacao,
 * com ?token= quando WEBHOOK_SECRET esta definido).
 *
 * Autenticacao (mesmas 4 camadas do verify_webhook_authenticity do PHP):
 *   1) token na query string (?token=)
 *   2) HMAC-SHA256 do objeto "data" no corpo (formato Velani: {signature, data})
 *   3) segredo em texto em header (x-webhook-token / bearer ...)
 *   4) HMAC-SHA256 do corpo bruto (x-signature / x-hub-signature-256)
 *
 * Efeito: grava o status final na KV -> /api/check-payment responde na hora
 * (fastpath), sem polling contra o gateway.
 */

import type { Env } from '../lib/env';
import { webhookSecretCandidates } from '../lib/env';
import { isFailedStatus, isPaidStatus, json, str, timingSafeEqual } from '../lib/http';
import { getTx, saveStatusCache, saveTx } from '../lib/store';
import { syncUtmifyStatus } from '../lib/utmify';
import { extractPayedAt, extractTransactionObject, pickVal } from '../lib/velani';

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verify(request: Request, rawBody: string, env: Env): Promise<boolean> {
  const secrets = webhookSecretCandidates(env);
  if (secrets.length === 0) {
    // Mesmo comportamento do PHP: sem segredo configurado a verificacao fica
    // desativada (avise no dashboard — mas nunca bloqueia o pagamento).
    console.warn('[webhook] AVISO: WEBHOOK_SECRET vazio — verificacao de origem DESATIVADA');
    return true;
  }

  const url = new URL(request.url);

  // 1) token via query string
  const qTok = url.searchParams.get('token');
  if (qTok) {
    for (const s of secrets) if (timingSafeEqual(s, qTok)) return true;
  }

  // 2) HMAC do objeto "data" (formato Velani {signature, data})
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    if (typeof p.signature === 'string' && p.data && typeof p.data === 'object') {
      const provided = p.signature.trim().toLowerCase();
      const candidates: string[] = [];
      try {
        candidates.push(JSON.stringify(p.data));
      } catch {
        /* ignora */
      }
      // trecho "data" exatamente como veio no corpo bruto (fallback do PHP)
      const m = rawBody.match(/"data"\s*:\s*(\{.*?\})\s*,\s*"signature"/s);
      if (m && m[1]) candidates.push(m[1]);
      for (const s of secrets) {
        for (const cand of candidates) {
          if (!cand) continue;
          const expected = await hmacSha256Hex(cand, s);
          if (timingSafeEqual(expected, provided)) return true;
        }
      }
    }
  }

  // 3) segredo em texto via header
  const plainKeys = ['x-webhook-token', 'x-webhook-secret', 'x-api-token', 'x-token'];
  for (const k of plainKeys) {
    const v = (request.headers.get(k) || '').trim();
    if (!v) continue;
    for (const s of secrets) if (timingSafeEqual(s, v)) return true;
  }
  const auth = (request.headers.get('authorization') || '').trim();
  if (auth) {
    const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : auth;
    if (bearer) {
      for (const s of secrets) if (timingSafeEqual(s, bearer)) return true;
    }
  }

  // 4) HMAC do corpo bruto
  const sigKeys = ['x-signature', 'x-webhook-signature', 'x-hub-signature-256', 'signature'];
  for (const k of sigKeys) {
    let provided = (request.headers.get(k) || '').trim();
    if (!provided) continue;
    const eq = provided.indexOf('=');
    if (eq >= 0 && /sha256/i.test(provided)) provided = provided.slice(eq + 1);
    if (!provided) continue;
    for (const s of secrets) {
      const expected = await hmacSha256Hex(rawBody, s);
      if (timingSafeEqual(expected, provided.toLowerCase())) return true;
    }
  }

  // 5) token dentro do corpo (formato Kupfy/legado)
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    const bodyTok = str(p.token) || str(p.webhookToken);
    if (bodyTok) {
      for (const s of secrets) if (timingSafeEqual(s, bodyTok)) return true;
    }
  }

  return false;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const rawBody = await request.text();

  if (!(await verify(request, rawBody, env))) {
    console.log(`[webhook] REJEITADO: assinatura/segredo invalido. IP=${request.headers.get('cf-connecting-ip') || '?'}`);
    return json({ ok: false, error: 'Webhook nao autorizado.' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json({ ok: true, received: true });
  }
  if (!payload || typeof payload !== 'object') return json({ ok: true, received: true });

  const p = payload as Record<string, unknown>;

  // Eventos de SAQUE nao sao vendas do funil.
  if (str(p.type).toUpperCase() === 'WITHDRAWAL') return json({ ok: true, received: true, skipped: 'withdrawal' });
  if (typeof p.event === 'string' && p.event.trim().toLowerCase().startsWith('withdrawal')) {
    return json({ ok: true, received: true, skipped: 'withdrawal' });
  }

  const tx = extractTransactionObject(payload) || p;

  let txid = '';
  for (const k of [
    'payment_code', 'id', 'saleId', 'transaction_uid', 'uid', 'transaction_id', 'transactionId',
    'external_code', 'external_id', 'externalId', 'identifier', 'orderId',
  ]) {
    const fromTx = pickVal(tx, [k]);
    const fromP = pickVal(p, [k]);
    const v = fromTx !== null ? str(fromTx) : fromP !== null ? str(fromP) : '';
    if (v !== '') {
      txid = v;
      break;
    }
  }
  if (txid === '') return json({ ok: true, received: true, skipped: 'no_txid' });

  const statusRaw = pickVal(tx, ['payment_status', 'status']) ?? pickVal(p, ['payment_status', 'status']);
  const status = statusRaw !== null ? str(statusRaw).toUpperCase() : '';
  let payedAt = extractPayedAt(tx);
  if (payedAt === null) payedAt = extractPayedAt(p);

  const isPaid = isPaidStatus(status) || payedAt !== null;
  const failed = isFailedStatus(status);

  if (isPaid || failed) {
    const ids: Array<string | undefined | null> = [txid];
    for (const k of ['external_code', 'externalId', 'external_id', 'identifier', 'orderId']) {
      const a = pickVal(tx, [k]);
      const b = pickVal(p, [k]);
      ids.push(a !== null ? str(a) : null);
      ids.push(b !== null ? str(b) : null);
    }
    const paidTs = payedAt && payedAt.trim() !== '' ? payedAt : isPaid ? new Date().toISOString() : null;
    const finalStatus = isPaid ? 'PAID' : status;
    await saveStatusCache(env, ids, finalStatus, paidTs, txid);
    ctx.waitUntil(syncUtmifyStatus(env, ids, finalStatus, paidTs));

    // Atualiza o registro local (nome/valor/pix) quando existe.
    const rec = await getTx(env, txid);
    if (rec) await saveTx(env, { ...rec, status: finalStatus });
  }

  console.log(`[webhook] recebido txid=${txid} status=${status || '?'} bytes=${rawBody.length}`);
  return json({ ok: true, received: true });
};
