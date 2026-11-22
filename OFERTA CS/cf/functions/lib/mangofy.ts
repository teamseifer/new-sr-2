/**
 * Cliente da MangoFy — https://checkout.mangofy.com.br
 * POST /api/v1/payment  |  GET /api/v1/payment/{paymentCode}
 * Auth: headers Authorization (API key) e Store-Code.
 * O valor vai em CENTAVOS. O postback chega em postback_url.
 */

import type { Env } from './env';
import { mangofyBaseUrl } from './env';
import { digits, str } from './http';
import { emailFromName, generateValidCpf, genericDepositName, randomBrName } from './velani';

export interface MangofyResponse {
  httpStatus: number;
  data: unknown;
  raw: string;
  transportError: boolean;
  error: string;
}

const DDDS = ['11', '21', '31', '41', '51', '61', '71', '81', '85', '19', '27', '48', '62', '98'];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function itemCode(productType: string): string {
  return genericDepositName(productType)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function clientIp(raw: string): string {
  const ip = raw.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
  if (ip.includes(':') && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
  return '0.0.0.0';
}

export async function mangofyRequest(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown
): Promise<MangofyResponse> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: (env.MANGOFY_API_KEY || '').trim(),
    'store-code': (env.MANGOFY_STORE_CODE || '').trim(),
    'user-agent': 'funil-cnh-2026-proxy/5.0 (mangofy/pages)',
  };

  const init: RequestInit = { method, headers, redirect: 'manual' };
  if (payload !== undefined && method !== 'GET') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }

  let res: Response;
  try {
    res = await fetch(mangofyBaseUrl(env) + path, init);
  } catch (e) {
    return {
      httpStatus: 502,
      data: null,
      raw: '',
      transportError: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const raw = await res.text();
  let data: unknown = null;
  if (raw.trim() !== '') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw.trim();
    }
  }

  return {
    httpStatus: res.status || 502,
    data,
    raw,
    transportError: false,
    error: '',
  };
}

export interface MangofyPixInput {
  identifier: string;
  amount: number;
  productType: string;
  isUpsell: boolean;
  client: { name: string; email: string; phone: string; document: string };
  callbackUrl: string;
  ip?: string;
  metadata?: Record<string, string>;
}

/** Body do POST /api/v1/payment (PIX). payment_amount em centavos. */
export function buildMangofyPayload(p: MangofyPixInput): Record<string, unknown> {
  const amount = Math.round(p.amount * 100) / 100;
  let cents = Math.round(amount * 100);
  if (cents < 1) cents = 1;

  let documentDigits = digits(p.client.document);
  if (documentDigits.length !== 11 && documentDigits.length !== 14) {
    documentDigits = generateValidCpf();
  }

  let phoneDigits = digits(p.client.phone);
  if (phoneDigits.startsWith('55') && phoneDigits.length > 11) phoneDigits = phoneDigits.slice(2);
  if (phoneDigits.length === 10) phoneDigits = phoneDigits.slice(0, 2) + '9' + phoneDigits.slice(2);
  if (phoneDigits.length !== 11 || phoneDigits[2] !== '9') {
    phoneDigits = `${pick(DDDS)}9${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
  }

  const name = str(p.client.name).trim() || randomBrName();
  const emailRaw = str(p.client.email).toLowerCase().trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : emailFromName(name);
  const genericName = genericDepositName(p.productType);

  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.metadata || {})) {
    if (typeof v === 'string' && v.trim() !== '') meta[k] = v.trim().slice(0, 300);
  }

  const body: Record<string, unknown> = {
    external_code: String(p.identifier).slice(0, 100),
    payment_method: 'pix',
    payment_format: p.isUpsell ? 'upsell' : 'regular',
    installments: 1,
    payment_amount: cents,
    shipping_amount: 0,
    postback_url: p.callbackUrl,
    items: [
      {
        code: itemCode(p.productType) || 'cs-deposito-pix',
        name: genericName,
        quantity: 1,
        price: cents,
        digital_flag: true,
      },
    ],
    customer: {
      email,
      name: name.slice(0, 254),
      document: documentDigits,
      phone: `55${phoneDigits}`,
      ip: clientIp(p.ip || ''),
    },
    pix: { expires_in_days: 1 },
  };
  if (Object.keys(meta).length > 0) body.extra = { metadata: meta };
  return body;
}
