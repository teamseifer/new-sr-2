/**
 * GET/POST /api/trk — grava os parâmetros de rastreio NO SERVIDOR por sessão
 * (mesmo papel do cnh_trk_save do PHP: o webview do Instagram/Facebook muitas
 * vezes perde cookie/localStorage antes do PIX).
 *
 * Fase 1: grava na KV e devolve {success, sid, trk}. A Fase 2 passa a alimentar
 * a UTMify a partir daqui.
 */

import type { Env } from '../lib/env';
import { corsHeaders, json, preflight, readJson, str } from '../lib/http';
import { readTrk, saveTrk } from '../lib/store';

const TRACK_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'fbclid', 'gclid', 'ttclid', 'src', 'sck', 'xcod',
  'cck', 'cname', 'domain', 'placement', 'adset', 'adname', 'site', 'xgo', 'pvid',
  'fbc', 'fbp',
];

function normalize(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  const o = input as Record<string, unknown>;
  for (const k of TRACK_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v !== '' && v !== 'null') out[k] = v.slice(0, 300);
  }
  return out;
}

function merge(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...a };
  for (const [k, v] of Object.entries(b)) if (v && !out[k]) out[k] = v;
  return out;
}

function fromUrl(url: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const s = str(url);
  if (!s) return out;
  try {
    const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : '';
    if (!q) return out;
    for (const [k, v] of new URLSearchParams(q)) if (v && TRACK_KEYS.includes(k)) out[k] = v.slice(0, 300);
  } catch {
    /* ignora */
  }
  return out;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function newSid(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handle(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const b = await readJson(request);
  const url = new URL(request.url);

  let params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (v && TRACK_KEYS.includes(k)) params[k] = v.slice(0, 300);
  }
  if (b.params) params = merge(params, normalize(b.params));
  if (b.trackPlus) params = merge(params, normalize(b.trackPlus));
  if (b.url) params = merge(params, fromUrl(b.url));
  const qUrl = url.searchParams.get('url');
  if (qUrl) params = merge(params, fromUrl(qUrl));

  const sid = cookies.cnh_sid || str(b.trk_id) || newSid();

  if (Object.keys(params).length > 0) {
    const existing = (await readTrk(env, sid)) || {};
    await saveTrk(env, sid, merge(normalize(existing), params));
  }

  const known = (await readTrk(env, sid)) || {};
  const trk = merge(params, normalize(known));

  const setCookie: Record<string, string> =
    cookies.cnh_sid === sid ? {} : { 'set-cookie': `cnh_sid=${sid}; Path=/; Max-Age=604800; SameSite=Lax` };
  const outHeaders: Record<string, string> = { ...corsHeaders(), ...setCookie };

  return json(
    { success: true, sid, trk, origem: Object.keys(params).length ? 'body' : 'cache' },
    200,
    outHeaders
  );
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return handle(ctx.request, ctx.env);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return handle(ctx.request, ctx.env);
};
