/**
 * GET /api/check-payment?id=...  e  GET /api/check-payment/{id}
 * Contrato do front (cnh_compat.php → check-payment):
 *   {success, status: paid|pending|expired|cancelled, bank_tx_id, paid_at}
 */

import type { Env } from '../lib/env';
import { checkStatus, toCheckPaymentResponse } from '../lib/check';
import { corsHeaders, json, preflight, str } from '../lib/http';

async function handle(request: Request, env: Env, idFromPath: string): Promise<Response> {
  const url = new URL(request.url);
  const id = (idFromPath || url.searchParams.get('id') || '').trim();
  if (id === '') {
    return json({ success: false, status: 'pending', error: 'id obrigatorio' }, 400, corsHeaders());
  }
  const clientIdentifier = (url.searchParams.get('clientIdentifier') || '').trim();
  const res = await checkStatus(env, id, clientIdentifier);
  return json(toCheckPaymentResponse(res, id), 200, corsHeaders());
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return handle(ctx.request, ctx.env, '');
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return handle(ctx.request, ctx.env, '');
};
