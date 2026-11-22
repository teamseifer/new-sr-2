/** GET /api/check-payment/{id} — variante de caminho da mesma rota. */

import type { Env } from '../../lib/env';
import { checkStatus, toCheckPaymentResponse } from '../../lib/check';
import { corsHeaders, json, preflight, str } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const id = str(ctx.params.id).trim();
  if (id === '') {
    return json({ success: false, status: 'pending', error: 'id obrigatorio' }, 400, corsHeaders());
  }
  const res = await checkStatus(ctx.env, id, '');
  return json(toCheckPaymentResponse(res, id), 200, corsHeaders());
};
