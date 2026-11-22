/**
 * POST /api/log-access — o SPA manda a URL de entrada; gravamos os parâmetros
 * de rastreio na KV por sessão (papel do cnh_log('access') + cnh_trk_save).
 * Fase 2: espelha para Workers Analytics Engine / R2 (log histórico).
 */

import type { Env } from '../lib/env';
import { corsHeaders, json, preflight, readJson, str } from '../lib/http';
import { readTrk, saveTrk } from '../lib/store';

const TRACK_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'fbclid', 'gclid', 'src', 'sck', 'cck', 'cname', 'adset', 'adname', 'placement',
  'site', 'xgo', 'pvid', 'fbc', 'fbp',
];

function fromUrl(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const s = str(raw);
  if (!s) return out;
  try {
    const u = new URL(s);
    u.searchParams.forEach((v, k) => {
      if (v && (TRACK_KEYS.includes(k) || k.startsWith('utm_'))) out[k] = v.slice(0, 300);
    });
  } catch {
    /* URL invalida: ignora */
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

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;

  const b = await readJson(ctx.request);
  const cookies = parseCookies(ctx.request.headers.get('cookie'));

  const params: Record<string, string> = fromUrl(b.url);
  if (b.fbclid && !params.fbclid) params.fbclid = str(b.fbclid).slice(0, 300);
  if (b.utmSource && !params.utm_source) params.utm_source = str(b.utmSource).slice(0, 300);
  if (b.fbp && !params.fbp) params.fbp = str(b.fbp).slice(0, 300);
  if (b.fbc && !params.fbc) params.fbc = str(b.fbc).slice(0, 300);

  const sid = cookies.cnh_sid || str(b.trk_id) || str(b.sid) || '';
  if (sid && Object.keys(params).length > 0) {
    const existing = (await readTrk(ctx.env, sid)) || {};
    await saveTrk(ctx.env, sid, { ...existing, ...params });
  }

  return json({ success: true }, 200, corsHeaders());
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return json({ success: true }, 200, corsHeaders());
};
