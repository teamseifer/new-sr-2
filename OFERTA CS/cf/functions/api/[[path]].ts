/**
 * Catch-all de /api/* — mesma resposta do PHP para rota inexistente:
 *   {"success":false,"error":"Rota /api/x nao existe"} (404)
 *
 * Rotas especificas (pix, check-payment, transaction, webhook, trk, ...)
 * tem prioridade sobre este arquivo.
 */

import type { Env } from '../lib/env';
import { corsHeaders, json, preflight, str } from '../lib/http';

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const path = '/' + str(ctx.params.path).replace(/^\/+/, '');
  const where =
    ctx.request.method === 'GET'
      ? `${path}${new URL(ctx.request.url).search}`
      : `${path} (POST)`;
  return json(
    {
      success: false,
      error: `Rota ${where} nao existe nesta etapa (Fase 2/3 da migracao Cloudflare).`,
      rota: path,
      fase: 1,
    },
    404,
    corsHeaders()
  );
};
