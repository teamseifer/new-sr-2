/** GET /api/ping — health check rápido (equivale ao action=ping do PHP). */

import type { Env } from '../lib/env';
import { corsHeaders, json, preflight } from '../lib/http';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const hasKey = !!(ctx.env.MANGOFY_API_KEY || '').trim() && !!(ctx.env.MANGOFY_STORE_CODE || '').trim();
  return json(
    {
      ok: true,
      service: 'pages-functions',
      gateway: 'mangofy',
      mangofy_key_configurada: hasKey,
      cpf_api_configurada: !!(ctx.env.CPF_API_TOKEN || '').trim(),
      cpf_fallback_configurada: !!(ctx.env.CPF_API2_TOKEN || '').trim(),
      cpf_fallback2_configurada: !!(ctx.env.CPF_API3_TOKEN || ctx.env.CPF_API3_KEY || '').trim(),
      utmify_token_configurada: !!(ctx.env.UTMIFY_API_TOKEN || '').trim(),
      comprovantes_storage_configurada: !!(ctx.env.SUPABASE_UPLOAD_TOKEN || '').trim(),
      kv_ok: true,
      ts: new Date().toISOString(),
    },
    200,
    corsHeaders()
  );
};
