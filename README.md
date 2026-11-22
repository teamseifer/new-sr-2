# NEW SR 2 — Desenrola Brasil + Serasa Limpa Nome

O funil ativo está em **`OFERTA CS/`** (React + atendimento + pagamento PIX).

## Desenvolvimento local

```bash
cd "OFERTA CS"
./serve-local.sh
# http://127.0.0.1:8840/login
```

## Fluxo

`login` → quizzes → `verify-availability` (score) → `conectando/` → `atendimento/` → `pagamento/` / `pix/`

## Cloudflare

Configuração em `OFERTA CS/cf/` (Pages Functions, secrets `CPF_API3_TOKEN`, MangoFy, etc.).

## Upsells Serasa

`upsell/` na raiz e em `OFERTA CS/upsell/` (mesma cadeia: registro → adm → …). Não remover.

## Raiz do repositório

Utilitários (`api_proxy.php`, `functions/`, `js/`+`css/` usados pelos upsells, crons, `tests/`, `.private/`).