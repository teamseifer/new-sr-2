/**
 * Ambiente do Pages Function — tipagem das variáveis/secrets.
 *
 * MANGOFY_API_KEY, MANGOFY_STORE_CODE e WEBHOOK_SECRET sao SECRETS
 * (wrangler pages secret put / painel Cloudflare). NUNCA aparecem em codigo.
 */

export interface Env {
  // Secrets
  MANGOFY_API_KEY?: string;
  MANGOFY_STORE_CODE?: string;
  WEBHOOK_SECRET?: string;
  CPF_API_TOKEN?: string;
  CPF_API2_TOKEN?: string;
  CPF_API3_TOKEN?: string;
  CPF_API3_KEY?: string;
  UTMIFY_API_TOKEN?: string;
  SUPABASE_UPLOAD_TOKEN?: string;

  // Vars comuns (wrangler.toml) — URLs e modos, nunca os tokens
  MANGOFY_BASE_URL?: string;
  UTMIFY_API_URL?: string;
  SUPABASE_URL?: string;
  CPF_API_URL?: string;
  CPF_API_MODE?: string;
  CPF_API2_URL?: string;
  CPF_API2_MODE?: string;
  CPF_API3_URL?: string;
  CPF_API3_MODE?: string;
  CPF_CACHE_TTL?: string;

  // Bindings
  CNH_TX: KVNamespace;
}

export const MANGOFY_BASE_URL_DEFAULT = 'https://checkout.mangofy.com.br';
export const MANGOFY_PIX_PATH = '/api/v1/payment';

export function mangofyBaseUrl(env: Env): string {
  const raw = (env.MANGOFY_BASE_URL || '').trim() || MANGOFY_BASE_URL_DEFAULT;
  return raw.replace(/\/+$/, '');
}

/** Todos os segredos aceitos na autenticacao de webhook (mesma ordem do PHP). */
export function webhookSecretCandidates(env: Env): string[] {
  const out: string[] = [];
  for (const v of [env.WEBHOOK_SECRET]) {
    const s = (v || '').trim();
    if (s !== '' && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}
