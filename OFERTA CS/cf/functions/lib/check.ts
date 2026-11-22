/**
 * Consulta de status (GET /api/v1/payment/{paymentCode}) — port de
 * call_velani_check_status() + check_status_cache_fastpath() do api_proxy.php.
 *
 * Fastpath: se o webhook ja gravou o status final na KV, responde na hora sem
 * bater no gateway (mesmo comportamento do cache em arquivo do PHP).
 */

import type { Env } from './env';
import { MANGOFY_PIX_PATH } from './env';
import { mangofyRequest } from './mangofy';
import {
  isFailedStatus,
  isPaidStatus,
  mapFrontStatus,
  str,
} from './http';
import { readStatusCache, saveStatusCache } from './store';
import { syncUtmifyStatus } from './utmify';
import {
  extractPayedAt,
  extractTransactionObject,
  pickVal,
} from './velani';

export interface CheckResult {
  ok: boolean;
  id: string;
  status: string; // interno: PAID / PENDING / FAILED / ...
  payedAt: string | null;
  source: string;
}

export async function checkStatus(
  env: Env,
  transactionId: string,
  clientIdentifier = ''
): Promise<CheckResult> {
  const cacheTxId = transactionId !== '' ? transactionId : clientIdentifier;

  // FASTPATH — status final vindo do webhook.
  const cached = await readStatusCache(env, cacheTxId);
  if (cached && (isPaidStatus(cached.status) || isFailedStatus(cached.status))) {
    await syncUtmifyStatus(env, [cached.txid, cacheTxId, transactionId, clientIdentifier], cached.status, cached.payedAt);
    return {
      ok: true,
      id: cached.txid || cacheTxId,
      status: cached.status,
      payedAt: cached.payedAt,
      source: 'cache_webhook',
    };
  }

  if (transactionId === '') {
    return { ok: true, id: cacheTxId, status: 'PENDING', payedAt: null, source: 'no_txid' };
  }

  const result = await mangofyRequest(
    env,
    'GET',
    `${MANGOFY_PIX_PATH}/${encodeURIComponent(transactionId)}`
  );

  if (result.transportError) {
    return { ok: true, id: cacheTxId, status: 'PENDING', payedAt: null, source: 'mangofy_transport_error' };
  }
  if (result.httpStatus >= 400 || !result.data || typeof result.data !== 'object') {
    return {
      ok: true,
      id: cacheTxId,
      status: 'PENDING',
      payedAt: null,
      source: `mangofy_http_${result.httpStatus}`,
    };
  }

  const decoded = result.data;
  const tx = extractTransactionObject(decoded) || (decoded as Record<string, unknown>);

  const statusRaw = pickVal(tx, ['payment_status', 'status']);
  const status = statusRaw !== null ? str(statusRaw).toUpperCase() : 'PENDING';

  let payedAt = extractPayedAt(tx);
  if (payedAt === null) payedAt = extractPayedAt(decoded);
  if (payedAt === null) {
    const pa = pickVal(tx, ['paidAt', 'paid_at']);
    if (typeof pa === 'string' && pa.trim() !== '') payedAt = pa;
  }

  const respIdRaw = pickVal(tx, ['payment_code', 'id', 'transactionId', 'transaction_id']);
  const respId = respIdRaw !== null ? str(respIdRaw) : cacheTxId;

  const isPaid = isPaidStatus(status) || (payedAt !== null && payedAt.trim() !== '');
  const failed = isFailedStatus(status);

  if (isPaid || failed) {
    const ids: Array<string | undefined | null> = [respId, cacheTxId, transactionId, clientIdentifier];
    const ext = pickVal(tx, ['external_code', 'externalId', 'external_id', 'identifier']);
    if (ext !== null) ids.push(str(ext));
    const paidTs = payedAt && payedAt.trim() !== '' ? payedAt : isPaid ? new Date().toISOString() : null;
    const finalStatus = isPaid ? 'PAID' : status;
    await saveStatusCache(env, ids, finalStatus, paidTs, respId);
    await syncUtmifyStatus(env, ids, finalStatus, paidTs);
    return { ok: true, id: respId, status: finalStatus, payedAt: paidTs, source: 'mangofy_get' };
  }

  return { ok: true, id: respId, status, payedAt, source: 'mangofy_get' };
}

/** Formato final que o front espera em /api/check-payment. */
export function toCheckPaymentResponse(res: CheckResult, fallbackId: string) {
  return {
    success: true,
    status: mapFrontStatus(res.status),
    bank_tx_id: res.id && res.id !== '' ? res.id : fallbackId,
    paid_at: res.payedAt ?? null,
  };
}
