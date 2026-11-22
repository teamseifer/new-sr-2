/**
 * GET /api/transaction/{id} — contrato do front (cnh_compat.php):
 *   {success, transaction:{transactionId, depositId, status, amount, nome, pix_code}}
 * Valor/nome/pix vêm do registro local (KV); status vem do gateway ou do
 * fastpath do webhook.
 */

import type { Env } from '../../lib/env';
import { checkStatus } from '../../lib/check';
import { corsHeaders, json, mapFrontStatus, preflight, str } from '../../lib/http';
import { getTx } from '../../lib/store';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;

  const id = str(ctx.params.id).trim();
  const [rec, statusRes] = await Promise.all([
    getTx(ctx.env, id),
    checkStatus(ctx.env, id, ''),
  ]);

  return json(
    {
      success: true,
      transaction: {
        transactionId: id,
        depositId: id,
        status: mapFrontStatus(statusRes.status),
        amount: rec ? rec.amount : 65.7,
        nome: rec ? rec.name : '',
        pix_code: rec ? rec.pixCode : '',
      },
    },
    200,
    corsHeaders()
  );
};
