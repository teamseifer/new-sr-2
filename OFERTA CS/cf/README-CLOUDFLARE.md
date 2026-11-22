# Cloudflare Pages — API + gateway MangoFy

Este diretório (`cf/`) é a migração do `api_proxy.php` para **Cloudflare Pages Functions**.
Nada aqui contém segredo: as chaves são cadastradas **por você**, no painel ou via `wrangler`.

## 0) Pré-requisitos

```bash
cd "OFERTA CS/cf"
npm install
npx wrangler login          # autoriza a sua conta Cloudflare
```

## 1) Criar a KV (status das transações)

```bash
npm run kv:create
```

O comando imprime um **id** — cole em `wrangler.toml`, em
`[[kv_namespaces]] → id = "COLOQUE_AQUI_O_ID_DA_KV"`.

## 2) Cadastrar os SECRETS (só você faz — nunca passe para ninguém)

```bash
npx wrangler pages secret put MANGOFY_API_KEY           # API key da MangoFy (cria e consulta PIX)
npx wrangler pages secret put MANGOFY_STORE_CODE        # Store Code da loja
npx wrangler pages secret put WEBHOOK_SECRET            # openssl rand -hex 32 (token da URL)
```

Ou pelo painel: **Workers & Pages → cnh-social-api → Settings → Variables and Secrets**.

> A API key e o Store Code da MangoFy ficam só nos secrets `MANGOFY_API_KEY` e `MANGOFY_STORE_CODE`. O token da UTMify fica em `UTMIFY_API_TOKEN`: o funil envia o pix gerado como `waiting_payment` e o pix pago como `paid`.

## 3) Testar localmente

```bash
cp .dev.vars.example .dev.vars   # cole seus valores REAIS no .dev.vars (ignorado pelo git)
npm run dev
# em outro terminal:
curl "http://localhost:8788/api/ping"
curl -X POST "http://localhost:8788/api/pix" -H 'content-type: application/json' \
  -d '{"amount":65.70,"customer_name":"Teste","customer_cpf":"12345678909","customer_phone":"11999999999","customer_email":"t@t.com"}'
curl "http://localhost:8788/api/check-payment?id=<transactionId>"
```

## 4) Deploy

```bash
npm run deploy
```

Deploy resultante (ex.: `https://cnh-social-api.pages.dev`):

| Rota | Método | O que faz |
|---|---|---|
| `/api/ping` | GET | health check (confirma se a secret carregou) |
| `/api/pix` | POST | cria PIX na Velani → formato do front |
| `/api/check-payment?id=` | GET | status (com fastpath do webhook) |
| `/api/transaction/{id}` | GET | detalhe da transação |
| `/api/webhook` | POST | postback da Velani (token/HMAC) |
| `/api/trk` | POST/GET | tracking de sessão (UTM) |
| `/api/log-access` | POST | log de acesso + tracking |
| `/api/consulta-cpf/...` | GET | **Fase 2** |
| `/api/track_sale` | POST | **Fase 2** (Meta CAPI + Utmify) |
| demais `/api/*` | — | **Fase 2/3** (404 com mensagem clara) |

## 5) Front atual já compatível

`js/api-bridge.js` (v2) e `js/track-plus.js` foram atualizados para:
1. detectarem sozinhos se o host é **Cloudflare Functions** (`/api/...`) ou **nginx/PHP**
   (`/api_proxy.php?cnh_api=...`) — um probe rápido em `/api/ping`;
2. reenviar qualquer chamada que caia em 404 no outro formato.

Ou seja: os mesmos arquivos funcionam no host antigo **e** no Cloudflare, sem trocar nada à mão.

## 6) Webhook da Velani

O `postbackUrl` é enviado **em cada transação** (`/api/webhook?token=...`), então não há
configuração manual no painel da Velani. Se você também cadastrou uma URL global no painel,
aponte para `https://SEU-DOMINIO/api/webhook?token=SEU_WEBHOOK_SECRET`.

## 7) O que NÃO está nesta fase

- Consulta de CPF, Meta CAPI, Utmify (**Fase 2**)
- E-mails de recuperação (SMTP → API HTTP da Brevo), comprovantes em R2, crons (**Fase 3**)
- Migração do `recovery.sqlite` (7.801 transações) para D1 + site estático (**Fase 4**)

## Segurança (já vale agora)

- `.env`/secrets só no painel/`wrangler secret` — **nunca** no repositório.
- Revogue os dois tokens que estavam hardcoded no `api_proxy.php`
  (token `sk-live_...` da API de CPF e o access token da Meta) — ver auditoria.
- No host antigo, bloqueie no nginx: `location ^~ /.private/ { return 404; }` e
  `location ~* \.(log|sqlite|tar\.gz)$ { return 404; }` (o `.htaccess` é ignorado lá).
