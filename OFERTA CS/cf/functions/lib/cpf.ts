/**
 * Consulta de CPF — alinhado ao funil NEW SR 2:
 * 1) apicpf (CPF_API_TOKEN)
 * 2) apicpf 2a chave (CPF_API2_TOKEN)
 * 3) zapgroup (CPF_API3_TOKEN, modo query)
 * Se nenhuma devolver nome, o front segue com preenchimento manual.
 */

import type { Env } from './env';

const CPF_API_URL_DEFAULT = 'https://api.apicpf.dev/consulta';
const CPF_API_TOKEN_DEFAULT = '';
const CPF_API2_TOKEN_DEFAULT = '';
const CPF_API3_URL_DEFAULT = 'https://api.zapgroup.shop/consultar-filtrada/cpf';

const NAME_KEYS = ['nome', 'name', 'nome_completo', 'full_name', 'nomecompleto', 'nome_pessoa', 'razao_social'];
const BIRTH_KEYS = [
  'nasc', 'nascimento', 'data_nascimento', 'datanascimento', 'data_nasc', 'dt_nasc',
  'birthdate', 'birth_date', 'dt_nascimento', 'birth', 'nasc_formatado',
];
const SEX_KEYS = ['sexo', 'genero', 'gender', 'sexo_descricao'];

export interface CpfLookup {
  success: boolean;
  nome: string;
  cpf: string;
  nascimento: string;
  genero: string;
  error?: string;
}

interface FetchHit {
  http: number;
  err: string;
  json: unknown;
  nome: string;
  nasc: string;
  sexo: string;
}

function pick(node: unknown, keys: string[], depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 4) return '';
  const record = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    if (v !== null && typeof v !== 'object' && keys.indexOf(k.toLowerCase()) !== -1) {
      const s = String(v).trim();
      if (s !== '') return s;
    }
  }
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object') {
      const found = pick(v, keys, depth + 1);
      if (found !== '') return found;
    }
  }
  return '';
}

export function cpfDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export function cpfIsValid(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let d = 0;
    for (let c = 0; c < t; c++) d += Number(cpf[c]) * (t + 1 - c);
    d = ((10 * d) % 11) % 10;
    if (Number(cpf[t]) !== d) return false;
  }
  return true;
}

function normalizeDate(s: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s.trim());
  if (br) return br[0];
  return s.trim();
}

function empty(cpf: string, error: string): CpfLookup {
  return { success: false, nome: '', cpf, nascimento: '', genero: '', error };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchFromApi(url: string, token: string, mode: string, cpf: string): Promise<FetchHit> {
  const base = url.replace(/\/+$/, '');
  const m = mode.toLowerCase();
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  };
  let full = base;
  if (m === 'query') {
    const join = base.indexOf('?') === -1 ? '?' : '&';
    full = `${base}${join}token=${encodeURIComponent(token)}&cpf=${cpf}`;
  } else if (m === 'bearer') {
    full = `${base}/${cpf}`;
    headers.authorization = `Bearer ${token}`;
  } else if (m === 'xapikey') {
    const join = base.indexOf('?') === -1 ? '?' : '&';
    full = `${base}${join}cpf=${cpf}`;
    headers['x-api-key'] = token;
  } else {
    full = `${base}/${encodeURIComponent(token)}/${cpf}`;
  }

  let http = 0;
  let err = '';
  let body = '';
  try {
    const res = await fetch(full, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20000),
    });
    http = res.status;
    body = await res.text();
  } catch (e) {
    err = e instanceof Error ? e.message : 'falha de rede';
  }

  let parsed: unknown = null;
  if (body !== '') {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  return {
    http,
    err,
    json: parsed,
    nome: pick(parsed, NAME_KEYS),
    nasc: pick(parsed, BIRTH_KEYS),
    sexo: pick(parsed, SEX_KEYS),
  };
}

function failed(hit: FetchHit): boolean {
  return hit.err !== '' || !hit.json || typeof hit.json !== 'object' || hit.http === 401 || hit.http === 404 || hit.http >= 500 || hit.nome === '';
}

export async function consultarCpf(env: Env, cpfIn: string): Promise<CpfLookup> {
  const cpf = cpfDigits(cpfIn);
  if (!cpfIsValid(cpf)) return empty(cpf, 'CPF invalido');

  const url = ((env.CPF_API_URL || '').trim() || CPF_API_URL_DEFAULT);
  const token = ((env.CPF_API_TOKEN || '').trim() || CPF_API_TOKEN_DEFAULT);
  const mode = (env.CPF_API_MODE || 'xapikey').trim();
  const url2 = ((env.CPF_API2_URL || '').trim() || url);
  const token2 = ((env.CPF_API2_TOKEN || '').trim() || CPF_API2_TOKEN_DEFAULT);
  const mode2 = (env.CPF_API2_MODE || mode).trim();
  const url3 = ((env.CPF_API3_URL || '').trim() || CPF_API3_URL_DEFAULT);
  const token3 = (env.CPF_API3_TOKEN || env.CPF_API3_KEY || '').trim();
  const mode3 = (env.CPF_API3_MODE || 'query').trim();
  const ttl = Math.max(60, Number(env.CPF_CACHE_TTL || '86400') || 86400);

  const hasApicpf = url !== '' && token !== '';
  const hasZap = url3 !== '' && token3 !== '';
  if (!hasApicpf && !hasZap) {
    return empty(cpf, 'API de CPF nao configurada (defina CPF_API3_TOKEN no Cloudflare)');
  }

  const cacheKey = `cpf:${await sha256Hex(cpf)}`;
  try {
    const cached = await env.CNH_TX.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && (cached as CpfLookup).success && (cached as CpfLookup).nome) {
      return cached as CpfLookup;
    }
  } catch {
    // cache indisponivel nao interrompe a consulta
  }

  let hit: FetchHit = { http: 0, err: '', json: null, nome: '', nasc: '', sexo: '' };
  let source = '';

  if (hasZap) {
    const third = await fetchFromApi(url3, token3, mode3, cpf);
    if (!failed(third)) {
      hit = third;
      source = 'zapgroup';
    } else {
      hit = third;
    }
  }
  if (failed(hit) && hasApicpf) {
    const first = await fetchFromApi(url, token, mode, cpf);
    if (!failed(first)) {
      hit = first;
      source = 'apicpf';
    } else if (url2 !== '' && token2 !== '' && token2 !== token) {
      const second = await fetchFromApi(url2, token2, mode2, cpf);
      if (!failed(second)) {
        hit = second;
        source = 'apicpf_fallback';
      } else {
        hit = first;
      }
    } else {
      hit = first;
    }
  }

  if (hit.nome === '') {
    return empty(cpf, 'CPF nao encontrado');
  }

  const out: CpfLookup & { ok?: boolean; _source?: string } = {
    success: true,
    ok: true,
    nome: hit.nome,
    cpf,
    nascimento: normalizeDate(hit.nasc),
    genero: hit.sexo,
    _source: source,
  };
  try {
    await env.CNH_TX.put(cacheKey, JSON.stringify(out), { expirationTtl: ttl });
  } catch {
    // segue sem cache
  }
  return out;
}
