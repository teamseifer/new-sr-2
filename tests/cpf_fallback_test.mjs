import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultarCpf } from '../functions/_lib.js';

const CPF = '52998224725';
const ZAP_URL = 'https://api.zapgroup.shop/consultar-filtrada/cpf';
const ZAP_TOKEN = 'test-zap-token';

function cfg(extra = {}) {
  return {
    cpfApiUrl: 'https://api.apicpf.dev/consulta',
    cpfApiKey: 'key-primary',
    cpfApiFallbackKey: 'key-fallback',
    cpfApi3Url: ZAP_URL,
    cpfApi3Token: ZAP_TOKEN,
    ...extra,
  };
}

function jsonRes(body) {
  return {
    json: async () => body,
  };
}

async function withFetch(handler, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      key: options.headers?.['X-API-KEY'] || options.headers?.['x-api-key'] || '',
    });
    return handler(calls[calls.length - 1]);
  };
  try {
    const res = await fn(calls);
    return { res, body: await res.json(), calls };
  } finally {
    globalThis.fetch = orig;
  }
}

test('usa ZapGroup como fallback 2 quando as duas chaves apicpf.dev nao devolvem nome', async () => {
  const { body, calls } = await withFetch((call) => {
    if (String(call.url).includes('zapgroup.shop')) {
      return jsonRes({
        cpf: CPF,
        nome: 'NOME TESTE',
        mae: 'MAE TESTE',
        sexo: 'M',
        nascimento: '11/10/1991',
      });
    }
    return jsonRes({ error: 'Pessoa nao encontrada' });
  }, (calls) => consultarCpf(cfg(), CPF));

  assert.equal(body.ok, true);
  assert.equal(body.nome, 'NOME TESTE');
  assert.equal(body._source, 'zapgroup');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].key, 'key-primary');
  assert.equal(calls[1].key, 'key-fallback');
  assert.match(calls[2].url, /zapgroup\.shop\/consultar-filtrada\/cpf/);
  assert.match(calls[2].url, /token=test-zap-token/);
  assert.match(calls[2].url, new RegExp(`cpf=${CPF}`));
  assert.equal(calls[2].key, '');
});

test('nao chama ZapGroup se a chave primaria devolve nome', async () => {
  const { body, calls } = await withFetch(() => jsonRes({
    nome: 'ANA SILVA',
    nascimento: '01/01/1990',
    sexo: 'F',
  }), () => consultarCpf(cfg(), CPF));

  assert.equal(body.ok, true);
  assert.equal(body._source, 'apicpf');
  assert.equal(calls.length, 1);
  assert.equal(calls.some((c) => String(c.url).includes('zapgroup')), false);
});

test('nao chama ZapGroup se o fallback 1 devolve nome', async () => {
  const { body, calls } = await withFetch((call) => {
    if (call.key === 'key-fallback') return jsonRes({ nome: 'JOAO SANTOS' });
    return jsonRes({});
  }, () => consultarCpf(cfg(), CPF));

  assert.equal(body.ok, true);
  assert.equal(body._source, 'apicpf_fallback');
  assert.equal(calls.length, 2);
  assert.equal(calls.some((c) => String(c.url).includes('zapgroup')), false);
});
