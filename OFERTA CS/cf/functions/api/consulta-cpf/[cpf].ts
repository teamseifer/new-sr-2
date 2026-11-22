/**
 * GET /api/consulta-cpf/:cpf
 * Sempre responde 200. Sem nome, o front segue com entrada manual.
 */

import { consultarCpf, cpfDigits } from '../../lib/cpf';
import type { Env } from '../../lib/env';
import { corsHeaders, json, preflight } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const pf = preflight(ctx.request);
  if (pf) return pf;
  const cpf = cpfDigits(String(ctx.params.cpf || ''));
  const result = await consultarCpf(ctx.env, cpf);
  return json({ ...result }, 200, corsHeaders());
};
