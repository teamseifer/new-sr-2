import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickTracking,
  extraMetadata,
  orderFromTx,
  webhookTx,
  webhookIds,
  isPaidTx,
  buildUtmifyPayload,
} from '../functions/_utmify.js';

test('pickTracking junta trackProps e tracking', () => {
  const t = pickTracking({
    trackProps: { utm_source: 'facebook', utm_campaign: 'sr' },
    tracking: { src: 'fb', utm_medium: 'cpc' },
  });
  assert.equal(t.utm_source, 'facebook');
  assert.equal(t.utm_campaign, 'sr');
  assert.equal(t.src, 'fb');
  assert.equal(t.utm_medium, 'cpc');
});

test('extraMetadata le extra.metadata da Mangofy', () => {
  const meta = extraMetadata({
    extra: { metadata: { utm_source: 'fb', productType: 'issqn' } },
  });
  assert.equal(meta.utm_source, 'fb');
  assert.equal(meta.productType, 'issqn');
});

test('orderFromTx no pago reusa UTMs, cliente e createdAt do extra', () => {
  const order = orderFromTx({
    payment_code: 'PAY123',
    payment_status: 'paid',
    payment_amount: 1850,
    approved_at: '2026-11-08 15:00:00',
    customer: { name: 'Ana', email: 'ana@x.com', phone: '11988887777', document: '52998224725', ip: '1.1.1.1' },
    items: [{ code: 'SR-ISSQN', name: 'Deposito PIX 5' }],
    extra: {
      metadata: {
        utm_source: 'facebook',
        utm_campaign: 'up5',
        productType: 'issqn',
        createdAt: '2026-11-08 14:50:00',
        title: 'Deposito PIX 5',
      },
    },
  });
  assert.equal(order.orderId, 'PAY123');
  assert.equal(order.productType, 'issqn');
  assert.equal(order.amountCents, 1850);
  assert.equal(order.createdAt, '2026-11-08 14:50:00');
  assert.equal(order.tracking.utm_source, 'facebook');
  assert.equal(order.customer.name, 'Ana');
  assert.equal(order.customer.document, '52998224725');
});

test('webhookTx unwrap data e webhookIds junta payment_code e external_code', () => {
  const body = {
    data: {
      payment_code: 'PAY999',
      external_code: 'SR_abc',
      payment_status: 'paid',
    },
  };
  const tx = webhookTx(body);
  assert.equal(tx.payment_code, 'PAY999');
  const ids = webhookIds(tx, body);
  assert.ok(ids.includes('PAY999'));
  assert.ok(ids.includes('SR_abc'));
});

test('isPaidTx aceita AUTHORIZED e data de liquidacao', () => {
  assert.equal(isPaidTx({ payment_status: 'AUTHORIZED' }), true);
  assert.equal(isPaidTx({ status: 'pending' }), false);
  assert.equal(isPaidTx({ payment_status: 'waiting', paid_at: '2026-11-08 12:00:00' }), true);
});

test('buildUtmifyPayload waiting_payment nao manda approvedDate', () => {
  const payload = buildUtmifyPayload({
    orderId: 'PAY1',
    productType: 'acordo',
    title: 'Deposito PIX',
    amountCents: 6638,
    createdAt: '2026-11-08 10:00:00',
    tracking: { utm_source: 'fb' },
    customer: { name: 'Ana', email: 'a@x.com', phone: '11999999999', document: '52998224725', ip: '1.1.1.1' },
  }, 'waiting_payment', 'Mangofy');
  assert.equal(payload.status, 'waiting_payment');
  assert.equal(payload.approvedDate, null);
  assert.equal(payload.trackingParameters.utm_source, 'fb');
  assert.equal(payload.products[0].priceInCents, 6638);
  assert.equal(payload.paymentMethod, 'pix');
});

test('buildUtmifyPayload paid mantem orderId e UTMs', () => {
  const payload = buildUtmifyPayload({
    orderId: 'PAY1',
    productType: 'issqn',
    title: 'Deposito PIX 5',
    amountCents: 1762,
    createdAt: '2026-11-08 10:00:00',
    approvedDate: '2026-11-08 10:05:00',
    tracking: { utm_source: 'fb', utm_campaign: 'up5' },
    customer: { name: 'Ana', email: 'a@x.com', phone: '11999999999', document: '52998224725', ip: '1.1.1.1' },
  }, 'paid', 'Mangofy');
  assert.equal(payload.status, 'paid');
  assert.equal(payload.orderId, 'PAY1');
  assert.equal(payload.approvedDate, '2026-11-08 10:05:00');
  assert.equal(payload.trackingParameters.utm_campaign, 'up5');
  assert.equal(payload.products[0].id, 'SR-ISSQN');
});
