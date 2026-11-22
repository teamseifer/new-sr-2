# Estrutura do funil (OFERTA CS)

| Pasta / arquivo | Uso |
|-----------------|-----|
| `index.html` + `js/index-*.js` | SPA React (login, score, rotas) |
| `api_proxy.php` + `dev-router.php` + `serve-local.sh` | API CPF/PIX e servidor local |
| `conectando/` | Tela gov.br → Serasa |
| `atendimento/` | Chat Serasa (áudios, vídeo, imagens) |
| `pagamento/` · `pix/` | Checkout PIX |
| `audio/` · `img/` · `video/` | Mídia do atendimento |
| `images/` | Logos e artes do React (gov, Desenrola, Serasa) |
| `videos/` | `desenrola-video.mp4` (saiba-mais) |
| `css/` · `js/api-bridge.js` · `js/track*.js` | Estáticos globais |
| `cf/` | Deploy Cloudflare Pages Functions |
| `.private/` | `.env` local (não commitar) |

| `upsell/` | Pós-PIX Serasa (registro, adm, …) + HTML CNH legado no bundle |

**Upsells Serasa:** mantidos em `upsell/` (também na raiz do repo para backup). Após pagamento, `pix/` redireciona para `/upsell/registro/`.