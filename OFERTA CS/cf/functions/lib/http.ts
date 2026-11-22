/**
 * Helpers HTTP — mesmo formato de resposta do api_proxy.php (send_json) para
 * nao quebrar o front React compilado nem as pages estaticas de upsell.
 */

export type Json = Record<string, unknown> | unknown[];

export function json(body: Json, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

export function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

/** Preflight — mesmo comportamento de cnh_compat_prepare(). */
export function preflight(request: Request): Response | null {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return json({ success: true }, 200, corsHeaders());
  }
  return null;
}

/** Le JSON tolerando body vazio (rotas de log aceitam body vazio). */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw || raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

export function digits(v: unknown): string {
  return str(v).replace(/\D/g, '');
}

/** Mesma regra de cnh_map_status(): status interno -> status do front. */
export function mapFrontStatus(internal: unknown): 'paid' | 'expired' | 'cancelled' | 'pending' {
  const s = str(internal).toUpperCase().trim();
  if (['PAID', 'APPROVED', 'COMPLETED', 'CONFIRMED'].indexOf(s) !== -1) return 'paid';
  if (s === 'EXPIRED') return 'expired';
  if (
    [
      'CANCELLED', 'CANCELED', 'REFUSED', 'FAILED', 'REFUNDED', 'CHARGEBACK', 'CHARGE_BACK',
      'PARTIAL_REFUNDED', 'GATEWAY_ERROR', 'SYSTEM_ERROR', 'CANCELED_ANTIFRAUD', 'REFUNDED_ERROR',
    ].indexOf(s) !== -1
  ) {
    return 'cancelled';
  }
  return 'pending';
}

export function isPaidStatus(s: unknown): boolean {
  const u = str(s).toUpperCase();
  return (
    ['PAID', 'PAGO', 'COMPLETED', 'PAYED', 'APPROVED', 'SUCCESS', 'CONFIRMED', 'AUTHORIZED'].indexOf(
      u
    ) !== -1
  );
}

export function isFailedStatus(s: unknown): boolean {
  const u = str(s).toUpperCase();
  return (
    [
      'FAILED', 'REJECTED', 'REFUSED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'CHARGED_BACK',
      'CHARGEDBACK', 'CHARGE_BACK', 'CHARGE_BACK_REQUESTED', 'REFUNDED', 'REFUNDED_REQUESTED',
      'PARTIAL_REFUNDED', 'REFUNDED_ERROR', 'CANCELADO', 'REEMBOLSADO', 'ESTORNADO', 'CHARGEBACK',
      'EXPIRADO', 'CANCELED_ANTIFRAUD', 'GATEWAY_ERROR', 'SYSTEM_ERROR',
    ].indexOf(u) !== -1
  );
}

/** Espera (timers existem no Workers). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** sha1 hex (Web Crypto) — usado no identifier CNH-XXXXXXXX. */
export async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparacao em tempo constante (hash_equals do PHP). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) {
    // still walks the shorter buffer to avoid early-exit on length alone
    let diff = ab.length ^ bb.length;
    const n = Math.min(ab.length, bb.length);
    for (let i = 0; i < n; i++) diff |= ab[i] ^ bb[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
