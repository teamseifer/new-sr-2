/**
 * POST /api/notify-approved — o front avisa "venda aprovada".
 * FASE 1: aceita e registra no log do Worker (console). A Fase 3 religa o
 * push (Pushcut/Webhooky) via NOTIFY_WEBHOOK_URL (secret).
 */

import type { Env } from '../lib/env';
import { corsHeaders, json, preflight, readJson, str } from '../lib/http';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const b = await readJson(ctx.request);
  console.log(
    `[approved] nome=${str(b.nome)} valor=${str(b.valor)} detran=${str(b.detran)} cpf=${str(b.cpf).slice(0, 3)}***`
  );
  return json({ success: true }, 200, corsHeaders());
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  return json({ success: true }, 200, corsHeaders());
};
