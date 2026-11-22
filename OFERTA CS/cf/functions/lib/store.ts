/**
 * Persistência em KV (binding CNH_TX) — substitui o cache em arquivos e o
 * SQLite do PHP nesta Fase 1.
 *
 *  tx:<transactionId>   registro da transacao (valor, nome, pix, identificador)
 *  ext:<identifier>     identificador CNH-XXXX -> transactionId
 *  st:<id>              status final gravado pelo webhook / polling (fastpath)
 */

import type { Env } from './env';

export interface TxRecord {
  txid: string;
  identifier: string;
  amount: number;
  name: string;
  pixCode: string;
  pixQr: string;
  status: string;
  productType: string;
  productName: string;
  createdAt: string;
}

const STATUS_TTL = 60 * 60 * 24 * 7; // 7 dias (KV expirationTtl)

async function putJson(env: Env, key: string, value: unknown, ttl?: number): Promise<void> {
  try {
    await env.CNH_TX.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
  } catch {
    // KV indisponivel nunca derruba o fluxo de pagamento.
  }
}

async function getJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.CNH_TX.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveTx(env: Env, rec: TxRecord): Promise<void> {
  await putJson(env, `tx:${rec.txid}`, rec, 60 * 60 * 24 * 30);
  if (rec.identifier) await putJson(env, `ext:${rec.identifier}`, rec.txid, 60 * 60 * 24 * 30);
}

export async function getTx(env: Env, txid: string): Promise<TxRecord | null> {
  if (!txid) return null;
  return getJson<TxRecord>(env, `tx:${txid}`);
}

export async function getTxByIdentifier(env: Env, identifier: string): Promise<TxRecord | null> {
  if (!identifier) return null;
  const txid = await getJson<string>(env, `ext:${identifier}`);
  if (!txid) return null;
  return getTx(env, txid);
}

export interface StatusCache {
  status: string;
  payedAt: string | null;
  txid: string;
  ts: string;
}

/** Grava o status final para TODOS os ids conhecidos (mesmo efeito do PHP). */
export async function saveStatusCache(
  env: Env,
  ids: Array<string | undefined | null>,
  status: string,
  payedAt: string | null,
  txid: string
): Promise<void> {
  const seen = new Set<string>();
  for (const id of ids) {
    const k = (id || '').trim();
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    await putJson(env, `st:${k}`, { status, payedAt, txid, ts: new Date().toISOString() }, STATUS_TTL);
  }
}

export async function readStatusCache(env: Env, id: string): Promise<StatusCache | null> {
  if (!id) return null;
  return getJson<StatusCache>(env, `st:${id}`);
}

/** Tracking de sessão (Fase 1 grava; Fase 2 alimenta a UTMify). */
export async function saveTrk(env: Env, sid: string, params: Record<string, unknown>): Promise<void> {
  if (!sid) return;
  await putJson(env, `trk:${sid}`, { ...params, _ts: Date.now() }, 60 * 60 * 24 * 7);
}

export async function readTrk(env: Env, sid: string): Promise<Record<string, unknown> | null> {
  if (!sid) return null;
  return getJson<Record<string, unknown>>(env, `trk:${sid}`);
}
