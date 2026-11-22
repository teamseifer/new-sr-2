const TRACK_KEYS = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbc', 'fbp'];
const PAID = ['AUTHORIZED', 'PAID', 'PAGO', 'APPROVED', 'COMPLETED', 'CONFIRMED', 'SUCCESS', 'PAYED'];
const DEPOSITO = {
  acordo: 'Deposito PIX',
  registro: 'Deposito PIX 1',
  adm: 'Deposito PIX 2',
  iof: 'Deposito PIX 3',
  multa_ir: 'Deposito PIX 4',
  issqn: 'Deposito PIX 5',
  verificacao: 'Deposito PIX 6',
  liberacao: 'Deposito PIX 7',
  chave_pix: 'Deposito PIX 8',
  ted: 'Deposito PIX 9',
  certidao: 'Deposito PIX 10',
  cadastro: 'Deposito PIX 11',
  seguro: 'Deposito PIX 12',
  prioridade: 'Deposito PIX 13',
  imposto_ress: 'Deposito PIX 14',
  biometria: 'Deposito PIX 15',
  encerramento: 'Deposito PIX 16',
};

export function cleanText(v, max = 160) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

export function digitsOnly(v, max = 20) {
  return (String(v ?? '').replace(/\D+/g, '') || '').slice(0, max);
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

export function utmifyNow(value) {
  if (value == null || value === '') {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function pickTracking(input) {
  const src = Object.assign(
    {},
    input && typeof input.tracking === 'object' ? input.tracking : {},
    input && typeof input.trackProps === 'object' ? input.trackProps : {},
    input && typeof input.trackingParameters === 'object' ? input.trackingParameters : {},
    input && typeof input.metadata === 'object' ? input.metadata : {},
  );
  const out = {};
  for (const k of TRACK_KEYS) {
    const v = cleanText(src[k], 180);
    if (v) out[k] = v;
  }
  return out;
}

export function extraMetadata(tx) {
  if (!tx || typeof tx !== 'object') return {};
  const extra = tx.extra && typeof tx.extra === 'object' ? tx.extra : {};
  const candidates = [extra.metadata, tx.metadata, extra];
  for (const cand of candidates) {
    if (cand && typeof cand === 'object' && !Array.isArray(cand)) return cand;
  }
  return {};
}

function productTypeFromTx(tx, meta) {
  const fromMeta = cleanText(meta.productType, 40).toLowerCase();
  if (fromMeta && DEPOSITO[fromMeta]) return fromMeta;
  const items = Array.isArray(tx && tx.items) ? tx.items : [];
  const code = String((items[0] && (items[0].code || items[0].id)) || '')
    .replace(/^SR-/i, '')
    .toLowerCase()
    .trim();
  return DEPOSITO[code] ? code : 'acordo';
}

function amountCentsFromTx(tx) {
  const raw = Number(pick(tx, ['payment_amount', 'amount', 'value']));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (Math.abs(raw - Math.round(raw)) > 0.001) return Math.round(raw * 100);
  return Math.round(raw);
}

export function isPaidTx(tx) {
  if (!tx || typeof tx !== 'object') return false;
  const statusRaw = String(pick(tx, ['payment_status', 'status', 'paymentStatus']) || '').toUpperCase();
  const payedAt = pick(tx, ['approved_at', 'approvedAt', 'paid_at', 'paidAt', 'payedAt']);
  return PAID.includes(statusRaw) || !!payedAt;
}

export function payedAtFromTx(tx) {
  return pick(tx, ['approved_at', 'approvedAt', 'paid_at', 'paidAt', 'payedAt']);
}

export function orderFromTx(tx, fallback = {}) {
  const meta = extraMetadata(tx);
  const tracking = pickTracking({ tracking: meta, trackProps: fallback.tracking || {} });
  const customerSrc = (tx && tx.customer && typeof tx.customer === 'object')
    ? tx.customer
    : (fallback.customer || {});
  const productType = productTypeFromTx(tx, meta);
  const title = cleanText(meta.title, 80)
    || DEPOSITO[productType]
    || cleanText(fallback.title, 80)
    || 'Deposito PIX';
  const amountCents = amountCentsFromTx(tx) || Number(fallback.amountCents) || 0;
  const orderId = String(
    pick(tx, ['payment_code', 'paymentCode', 'id']) || fallback.orderId || ''
  ).slice(0, 120);
  const createdAt = cleanText(meta.createdAt, 32)
    || cleanText(fallback.createdAt, 32)
    || utmifyNow(pick(tx, ['created_at', 'createdAt']));
  const payedAt = payedAtFromTx(tx);
  return {
    orderId,
    productType,
    title,
    amountCents,
    createdAt,
    approvedDate: payedAt ? utmifyNow(payedAt) : null,
    tracking,
    customer: {
      name: cleanText(customerSrc.name, 120),
      email: cleanText(customerSrc.email, 180),
      phone: digitsOnly(customerSrc.phone, 15),
      document: digitsOnly(customerSrc.document, 14),
      ip: cleanText(customerSrc.ip, 80) || '127.0.0.1',
    },
  };
}

export function webhookTx(body) {
  if (!body || typeof body !== 'object') return {};
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    if (body.data.payment && typeof body.data.payment === 'object') return body.data.payment;
    return body.data;
  }
  if (body.payment && typeof body.payment === 'object') return body.payment;
  return body;
}

export function webhookIds(tx, body) {
  const ids = [];
  const sources = [tx, body, body && body.data];
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const k of ['payment_code', 'paymentCode', 'id', 'transactionId', 'transaction_id', 'external_code', 'externalCode', 'external_id', 'externalId', 'identifier', 'orderId']) {
      const v = cleanText(src[k], 120);
      if (v && !ids.includes(v)) ids.push(v);
    }
  }
  return ids;
}

export function trackingMetadata(order, extra = {}) {
  const tracking = order.tracking || {};
  const meta = {
    order_id: extra.identifier || order.orderId || '',
    step: extra.step || 'checkout',
    productType: order.productType || 'acordo',
    title: order.title || '',
    createdAt: order.createdAt || utmifyNow(),
  };
  for (const k of TRACK_KEYS) {
    if (tracking[k]) meta[k] = String(tracking[k]).slice(0, 255);
  }
  return meta;
}

export function buildUtmifyPayload(order, status, platform) {
  const paid = status === 'paid';
  const total = Number(order.amountCents) || 0;
  const tracking = order.tracking || {};
  const customer = order.customer || {};
  return {
    orderId: String(order.orderId || '').slice(0, 120),
    platform: platform || 'Mangofy',
    paymentMethod: 'pix',
    status,
    createdAt: order.createdAt || utmifyNow(),
    approvedDate: paid ? (order.approvedDate || utmifyNow()) : null,
    refundedAt: null,
    customer: {
      name: cleanText(customer.name, 120),
      email: cleanText(customer.email, 180),
      phone: digitsOnly(customer.phone, 15),
      document: digitsOnly(customer.document, 14),
      country: 'BR',
      ip: cleanText(customer.ip, 80) || '127.0.0.1',
    },
    products: [{
      id: 'SR-' + String(order.productType || 'PIX').toUpperCase().slice(0, 40),
      name: cleanText(order.title, 80) || 'Deposito PIX',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: total,
    }],
    trackingParameters: {
      src: tracking.src || null,
      sck: tracking.sck || null,
      utm_source: tracking.utm_source || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_medium: tracking.utm_medium || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null,
      utm_id: tracking.utm_id || null,
      fbc: tracking.fbc || null,
      fbp: tracking.fbp || null,
    },
    commission: {
      totalPriceInCents: total,
      gatewayFeeInCents: 0,
      userCommissionInCents: total,
    },
    isTest: false,
  };
}

export { TRACK_KEYS, PAID as PAID_STATUSES, DEPOSITO };
