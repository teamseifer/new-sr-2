<?php
/**
 * =============================================================================
 * CRON DE COMPROVANTES x GATEWAY (zip 85) — detecta vendas "desviadas"
 * =============================================================================
 * O lead pagou, nao caiu como aprovado e enviou o comprovante (fica em
 * .private/comprovantes/<data>_<id-da-transacao>.<ext>). Este script:
 *   1) Le cada comprovante, extrai o ID da transacao do nome do arquivo;
 *   2) Descobre o gateway (campo "platform" do order_<id>.json do cache; senao
 *      tenta Velani -> Genesys -> Kupfy com as MESMAS APIs/credenciais do
 *      cron_reconciliacao.php);
 *   3) Consulta o status REAL no gateway:
 *        PAGO                 -> move para .private/comprovantes/confirmados/
 *        PENDENTE/RECUSADO/   -> move para .private/desvio-<gateway>/ (velani|genesys|kupfy)
 *        EXPIRADO                e cria <arquivo>.json + linha em relatorio.csv
 *                                (id, status, nome, cpf, e-mail, valor, data) para
 *                                voce mandar ao gateway.
 *        INDETERMINADO (API fora / 4xx / nao achou) -> fica onde esta, tenta de novo
 *   4) Os que ja estao em desvio-* sao RE-CONFERIDOS a cada execucao: se o
 *      gateway marcar pago depois, o arquivo vai para confirmados/ (com nota).
 *
 * Nunca apaga nada: so move dentro de .private/. Idempotente (pode rodar a cada 30 min).
 *
 * USO (CLI):
 *   php cron_comprovantes.php            # roda
 *   php cron_comprovantes.php --dry      # so mostra o que faria
 *   php cron_comprovantes.php --max=500  # limite de consultas por execucao (padrao 300)
 *   php cron_comprovantes.php --min-age=0  # minutos minimos desde o upload (padrao 20:
 *                                          # da tempo do webhook chegar antes de julgar)
 * USO (web, exige o token de recuperacao = RECOVERY_SECRET da pasta mail.rec-cnh):
 *   https://SEU_SITE/cron_comprovantes.php?token=...&dry=1
 *
 * AGENDAMENTO (aaPanel > Cron > Shell Script), a cada 30 min:
 *   php /www/wwwroot/SEU_SITE/cron_comprovantes.php
 * =============================================================================
 */

error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
ini_set('display_errors', PHP_SAPI === 'cli' ? '1' : '0');
set_time_limit(280);

// ---------------------------------------------------------------------------
// BOOTSTRAP: .env + recovery_lib (mesmos caminhos do api_proxy / cron_recuperacao)
// ---------------------------------------------------------------------------
$__envLoader = __DIR__ . '/.private/env_loader.php';
if (@is_readable($__envLoader)) {
    require_once $__envLoader;
    if (function_exists('load_dotenv')) {
        // Mesmo modelo ESCOPADO do api_proxy.php: cada pasta fornece so o seu grupo
        // de chaves, evitando que o cron de uma oferta leia credenciais de outra.
        $__slug   = 'cnh';
        $__parent = dirname(__DIR__);
        $__kGate = array('DISRUPTY_PUBLIC_KEY','DISRUPTY_PRIVATE_KEY','DISRUPTY_BASE_URL','WEBHOOK_SECRET','DISRUPTY_WEBHOOK_TOKEN','GENESYS_WEBHOOK_SECRET','GATEWAY_PROVIDER');
        $__kKupfy = array('KUPFY_PUBLIC_KEY','KUPFY_SECRET_KEY','KUPFY_PRIVATE_KEY','KUPFY_BASE_URL','KUPFY_POLL_INTERVAL','KUPFY_WEBHOOK_TOKEN','GATEWAY_PROVIDER');
        $__kGenesys = array('GENESYS_ACCOUNT_HASH','GENESYS_API_TOKEN','GENESYS_API_SECRET','GENESYS_BASE_URL','GENESYS_WEBHOOK_SECRET','WEBHOOK_SECRET','GATEWAY_PROVIDER');
        $__kVelani = array('VELANI_SECRET_KEY','VELANI_API_KEY','VELANI_PUBLIC_KEY','VELANI_BASE_URL','VELANI_WEBHOOK_SECRET','WEBHOOK_SECRET','GATEWAY_PROVIDER');
        $__kUtm  = array('UTMIFY_API_TOKEN','UTMIFY_API_URL');
        $__kMail = array('SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','SMTP_FROM_EMAIL','SMTP_FROM_NAME','RECOVERY_BASE_URL','RECOVERY_SECRET','RECOVERY_DISCOUNT_PRICE','NOTIFY_WEBHOOK_URL','NOTIFY_PROVIDER','OFFER_NAME','OFFER_PRODUCT_LABEL','DELIVERABLE_URL','DELIVERABLE_BACKFILL_DAYS');
        $__pick = function($cands, $keys) {
            foreach ($cands as $p) { if ($p !== '' && @is_readable($p)) { load_dotenv($p, $keys); return; } }
        };
        $__explicit = (function_exists('getenv') && @getenv('FUNIL_ENV_FILE') !== false) ? @getenv('FUNIL_ENV_FILE') : '';
        if ($__explicit !== '' && @is_readable($__explicit)) { load_dotenv($__explicit); }
        $__pick(array($__parent.'/secrets-disrupty-cs/.env', $__parent.'/secrets-disrupty-'.$__slug.'/.env', $__parent.'/secrets-disrupty/.env'), $__kGate);
        $__pick(array($__parent.'/secrets-kupfy-'.$__slug.'/.env', $__parent.'/secrets-kupfy/.env'), $__kKupfy);
        $__pick(array($__parent.'/secrets-genesys-cs/.env', $__parent.'/secrets-genesys-'.$__slug.'/.env', $__parent.'/secrets-genesys/.env'), $__kGenesys);
        $__pick(array($__parent.'/secrets-velani-cs/.env', $__parent.'/secrets-velani-'.$__slug.'/.env', $__parent.'/secrets-velani/.env'), $__kVelani);
        $__pick(array($__parent.'/utmify-'.$__slug.'/.env'), $__kUtm);
        $__pick(array($__parent.'/mail.rec-'.$__slug.'/.env'), $__kMail);
        // Fallback consolidado (preenche apenas o que faltar):
        foreach (array($__parent.'/secrets-funil-cnh/.env', $__parent.'/.funil-secrets/.env', __DIR__.'/.private/.env') as $__fb) {
            if ($__fb !== '' && @is_readable($__fb)) { load_dotenv($__fb); }
        }
    }
}
require_once __DIR__ . '/.private/recovery_lib.php';

if (PHP_SAPI !== 'cli') {
    $tok = isset($_GET['token']) ? (string)$_GET['token'] : '';
    if ($tok === '' || !hash_equals(recovery_secret(), $tok)) { http_response_code(403); echo 'Acesso negado.'; exit; }
    header('Content-Type: text/plain; charset=utf-8');
}

$DRY = (PHP_SAPI === 'cli') ? in_array('--dry', $argv ?: array(), true) : (isset($_GET['dry']) && $_GET['dry'] !== '0' && $_GET['dry'] !== '');

function cp_env($key, $default = '') {
    $v = function_exists('env_get') ? env_get($key) : (function_exists('getenv') ? @getenv($key) : false);
    if ($v === false || $v === null || (is_string($v) && trim($v) === '')) return $default;
    return is_string($v) ? trim($v) : $v;
}
$MAX_PER_RUN = (int)cp_env('COMPROVANTES_MAX_PER_RUN', '300');
$MIN_AGE_MIN = (int)cp_env('COMPROVANTES_MIN_AGE_MIN', '20');
if (PHP_SAPI === 'cli' && isset($argv) && is_array($argv)) {
    foreach ($argv as $__a) {
        if (strpos($__a, '--max=') === 0) $MAX_PER_RUN = max(1, (int)substr($__a, 6));
        if (strpos($__a, '--min-age=') === 0) $MIN_AGE_MIN = max(0, (int)substr($__a, 10));
    }
} else {
    if (isset($_GET['max'])) $MAX_PER_RUN = max(1, (int)$_GET['max']);
    if (isset($_GET['min_age'])) $MIN_AGE_MIN = max(0, (int)$_GET['min_age']);
}

$PRIV = __DIR__ . '/.private';
$DIR_COMP = $PRIV . '/comprovantes';
$DIR_OK   = $DIR_COMP . '/confirmados';
$CACHE    = $PRIV . '/cache';
$GATEWAYS = array('velani', 'genesys', 'kupfy', 'disrupty');

function clog($msg) {
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $msg;
    echo $line . "\n";
    @file_put_contents(__DIR__ . '/.private/comprovantes.log', $line . "\n", FILE_APPEND);
}

// ---------------------------------------------------------------------------
// HTTP + consultas de status — mesmas rotas/headers do cron_reconciliacao.php
// ---------------------------------------------------------------------------
function cp_http_json($url, $headers) {
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => array_merge(array('Content-Type: application/json'), $headers),
        CURLOPT_SSL_VERIFYPEER => true,
    ));
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) return array(0, null);
    return array($code, json_decode($resp, true));
}
function cp_map_status($raw) {
    $up = strtoupper((string)$raw);
    if (in_array($up, array('COMPLETED','PAID','PAGO','PAYED','APPROVED','SUCCESS','CONFIRMED','AUTHORIZED'), true)) return 'paid';
    if (in_array($up, array('FAILED','REJECTED','CANCELLED','CANCELED','CANCELADO','EXPIRED','EXPIRADO'), true)) return 'refused';
    if (in_array($up, array('REFUNDED','REEMBOLSADO','ESTORNADO'), true)) return 'refunded';
    if (in_array($up, array('CHARGED_BACK','CHARGEDBACK','CHARGEBACK'), true)) return 'chargedback';
    return 'waiting_payment';
}
function cp_unwrap($d) {
    $tx = $d;
    if (isset($d['data']) && is_array($d['data'])) $tx = $d['data'];
    elseif (isset($d['transaction']) && is_array($d['transaction'])) $tx = $d['transaction'];
    return $tx;
}
function cp_result($tx, $code) {
    $statusRaw = isset($tx['status']) ? (string)$tx['status'] : '';
    if ($statusRaw === '') return null;
    $paidAt = null;
    foreach (array('paidAt','paid_at','payedAt','date_approved') as $k) { if (!empty($tx[$k])) { $paidAt = (string)$tx[$k]; break; } }
    $st = cp_map_status($statusRaw);
    if ($st === 'waiting_payment' && $paidAt !== null) $st = 'paid';
    $amount = null;
    foreach (array('amount','value','totalAmount','total') as $k) { if (isset($tx[$k]) && is_numeric($tx[$k])) { $amount = (float)$tx[$k]; break; } }
    return array('status' => $st, 'raw' => $statusRaw, 'paidAt' => $paidAt, 'amount_gateway' => $amount, 'http' => $code);
}
// VELANI — GET {base}/v1/transactions/{id}, header x-api-key (Secret Key)
function cp_velani_key() {
    foreach (array(cp_env('VELANI_SECRET_KEY'), cp_env('VELANI_API_KEY')) as $k) {
        $k = trim((string)$k, " \t\"'");
        if ($k !== '' && strpos($k, 'COLOQUE_') !== 0) return $k;
    }
    return null;
}
function cp_check_velani($txid) {
    $key = cp_velani_key(); if ($key === null) return array('skip' => true);
    $base = rtrim(cp_env('VELANI_BASE_URL', 'https://api.velanipagamentos.com.br/api/v1/api-gateway'), '/');
    list($code, $d) = cp_http_json($base . '/v1/transactions/' . rawurlencode($txid), array('x-api-key: ' . $key, 'Accept: application/json'));
    if ($code === 404) return array('notfound' => true, 'http' => 404);
    if ($code === 0 || $code >= 400 || !is_array($d)) return null;
    if (isset($d['success']) && $d['success'] === false) return array('notfound' => true, 'http' => $code);
    return cp_result(cp_unwrap($d), $code);
}
// GENESYS — GET {base}/v1/transactions/{id}, headers api-secret + account-hash
function cp_genesys_keys() {
    $hash = cp_env('GENESYS_ACCOUNT_HASH'); $tok = cp_env('GENESYS_API_TOKEN'); if ($tok === '') $tok = cp_env('GENESYS_API_SECRET');
    if ($hash === '' || $tok === '' || strpos($hash, 'COLOQUE_') === 0 || strpos($tok, 'COLOQUE_') === 0) return null;
    return array($hash, $tok);
}
function cp_check_genesys($txid) {
    $keys = cp_genesys_keys(); if ($keys === null) return array('skip' => true);
    list($hash, $tok) = $keys;
    $base = rtrim(cp_env('GENESYS_BASE_URL', 'https://api.genesys.finance'), '/');
    list($code, $d) = cp_http_json($base . '/v1/transactions/' . rawurlencode($txid), array('api-secret: ' . $tok, 'Authorization: Bearer ' . $tok, 'account-hash: ' . $hash, 'Accept: application/json'));
    if ($code === 404) return array('notfound' => true, 'http' => 404);
    if ($code === 0 || $code >= 400 || !is_array($d)) return null;
    return cp_result(cp_unwrap($d), $code);
}
// KUPFY — GET {base}/gateway/transactions?id=, headers x-public-key / x-secret-key
function cp_kupfy_keys() {
    $pub = cp_env('KUPFY_PUBLIC_KEY'); $sec = cp_env('KUPFY_SECRET_KEY'); if ($sec === '') $sec = cp_env('KUPFY_PRIVATE_KEY');
    if ($pub === '' || $sec === '' || strpos($pub, 'COLOQUE_') === 0 || strpos($sec, 'COLOQUE_') === 0) return null;
    return array($pub, $sec);
}
function cp_check_kupfy($txid) {
    $keys = cp_kupfy_keys(); if ($keys === null) return array('skip' => true);
    list($pub, $sec) = $keys;
    $base = rtrim(cp_env('KUPFY_BASE_URL', 'https://app.kupfy.com/api/v1'), '/');
    list($code, $d) = cp_http_json($base . '/gateway/transactions?id=' . rawurlencode($txid), array('x-public-key: ' . $pub, 'x-secret-key: ' . $sec));
    if ($code === 404) return array('notfound' => true, 'http' => 404);
    if ($code === 0 || $code >= 400 || !is_array($d) || isset($d['error'])) return null;
    return cp_result(cp_unwrap($d), $code);
}

// DISRUPTY — GET {base}/api/sales/{id}, headers x-api-public-key / x-api-private-key (mesmo do cron_reconciliacao)
function cp_disrupty_keys() {
    $pub = cp_env('DISRUPTY_PUBLIC_KEY'); $priv = cp_env('DISRUPTY_PRIVATE_KEY');
    if ($pub === '' || $priv === '' || strpos($pub, 'COLOQUE_') === 0 || strpos($priv, 'COLOQUE_') === 0) return null;
    return array($pub, $priv);
}
function cp_check_disrupty($txid) {
    $keys = cp_disrupty_keys(); if ($keys === null) return array('skip' => true);
    list($pub, $priv) = $keys;
    $base = rtrim(cp_env('DISRUPTY_BASE_URL', 'https://api-sellers.disruptybr.app'), '/');
    list($code, $d) = cp_http_json($base . '/api/sales/' . rawurlencode($txid), array('x-api-public-key: ' . $pub, 'x-api-private-key: ' . $priv, 'Accept: application/json'));
    if ($code === 404) return array('notfound' => true, 'http' => 404);
    if ($code === 0 || $code >= 400 || !is_array($d)) return null;
    $tx = $d; if (isset($d['sale']) && is_array($d['sale'])) $tx = $d['sale']; else $tx = cp_unwrap($d);
    return cp_result($tx, $code);
}

/** Gateway do pedido pelo cache (platform do order_<id>.json) ou pela chave rapida. */
function cp_gateway_hint($txid, $order) {
    if (is_array($order) && !empty($order['platform'])) {
        $p = strtolower((string)$order['platform']);
        foreach (array('velani','genesys','kupfy','disrupty') as $g) if (strpos($p, $g) !== false) return $g;
    }
    $p = dirname(__DIR__);
    foreach (array($p.'/gateway-cnh.txt', $p.'/gateway.txt', __DIR__.'/.private/gateway.txt') as $f) {
        if (!@is_readable($f)) continue;
        foreach (preg_split('/\r\n|\r|\n/', (string)@file_get_contents($f)) as $ln) {
            $ln = strtolower(trim(trim($ln), " \t\"'"));
            if ($ln === '' || $ln[0] === '#') continue;
            if (in_array($ln, array('velani','genesys','kupfy','disrupty'), true)) return $ln;
            break;
        }
        break;
    }
    return '';
}

/** Consulta o gateway provavel primeiro e cai para os outros. Retorna array(gateway, resultado|null). */
function cp_check($txid, $hint) {
    global $GATEWAYS;
    $order = array_values(array_unique(array_merge($hint !== '' ? array($hint) : array(), $GATEWAYS)));
    $indeterminado = false;
    foreach ($order as $g) {
        $r = call_user_func('cp_check_' . $g, $txid);
        if ($r === null) { $indeterminado = true; continue; }          // API fora / erro
        if (!empty($r['skip']) || !empty($r['notfound'])) continue;     // sem credencial / nao e deste gateway
        return array($g, $r);
    }
    return array($hint, $indeterminado ? null : array('status' => 'nao_encontrada', 'raw' => 'NOT_FOUND', 'paidAt' => null, 'amount_gateway' => null, 'http' => 404));
}

function cp_read_order($txid) {
    global $CACHE;
    $f = $CACHE . '/order_' . $txid . '.json';
    if (!@is_readable($f)) return null;
    $o = json_decode((string)@file_get_contents($f), true);
    return is_array($o) ? $o : null;
}
function cp_parse_name($fn) {
    // <YYYYmmdd-HHiiss>_<txid>.<ext>
    if (!preg_match('/^(\d{8}-\d{6})_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$/', $fn, $m)) return null;
    $ts = DateTime::createFromFormat('Ymd-His', $m[1]);
    return array('upload_ts' => $ts ? $ts->getTimestamp() : @filemtime($fn), 'tx' => $m[2], 'ext' => strtolower($m[3]));
}
/** Move o arquivo; retorna o nome final (basename) ou false. Em --dry nao move. */
function cp_move($src, $dstDir, $dry) {
    if ($dry) return basename($src);
    if (!is_dir($dstDir) && !@mkdir($dstDir, 0700, true)) return false;
    $dst = $dstDir . '/' . basename($src);
    if (file_exists($dst)) $dst = $dstDir . '/' . pathinfo($src, PATHINFO_FILENAME) . '_' . time() . '.' . pathinfo($src, PATHINFO_EXTENSION);
    return @rename($src, $dst) ? basename($dst) : false;
}
function cp_csv_line($dir, $row, $dry) {
    if ($dry) return;
    $f = $dir . '/relatorio.csv';
    $new = !file_exists($f);
    $h = @fopen($f, 'a'); if (!$h) return;
    if ($new) fputcsv($h, array('data_upload','id_transacao','gateway','status_gateway','status_raw','nome','cpf','email','telefone','valor','arquivo','verificado_em'), ';');
    fputcsv($h, $row, ';');
    fclose($h);
}

// ---------------------------------------------------------------------------
// EXECUCAO
// ---------------------------------------------------------------------------
clog('=== cron_comprovantes ' . ($DRY ? '(SIMULACAO, nada sera movido) ' : '') . 'max=' . $MAX_PER_RUN . ' min_age=' . $MIN_AGE_MIN . 'min ===');
if (!function_exists('curl_init')) { clog('ERRO: extensao curl ausente.'); exit(1); }
$temCred = (cp_velani_key() !== null ? 'velani ' : '') . (cp_genesys_keys() !== null ? 'genesys ' : '') . (cp_kupfy_keys() !== null ? 'kupfy ' : '') . (cp_disrupty_keys() !== null ? 'disrupty' : '');
clog('Credenciais carregadas: ' . ($temCred !== '' ? trim($temCred) : 'NENHUMA (verifique as pastas secrets-velani-cs / secrets-genesys-cs / secrets-disrupty-cs)'));
if (trim($temCred) === '') exit(1);

// Fila: pendentes em comprovantes/ + re-conferencia dos que ja estao em desvio-*
$fila = array();
foreach ((array)@glob($DIR_COMP . '/*.*') as $f) { if (is_file($f)) $fila[] = array('path' => $f, 'origem' => 'novo'); }
foreach ($GATEWAYS as $g) {
    foreach ((array)@glob($PRIV . '/desvio-' . $g . '/*.*') as $f) {
        if (is_file($f) && !preg_match('/\.(json|csv)$/i', $f)) $fila[] = array('path' => $f, 'origem' => 'desvio-' . $g);
    }
}
$tot = array('lidos' => 0, 'pulados' => 0, 'confirmados' => 0, 'desvio' => 0, 'indeterminados' => 0, 'ja_desvio' => 0, 'sem_id' => 0);
$consultas = 0;
foreach ($fila as $item) {
    if ($consultas >= $MAX_PER_RUN) { clog('Limite de consultas atingido; o restante fica para a proxima execucao.'); break; }
    $fn = basename($item['path']);
    $p = cp_parse_name($fn);
    $tot['lidos']++;
    if ($p === null || $p['tx'] === 'semtx') { $tot['sem_id']++; clog("SEM ID: $fn (nome fora do padrao ou enviado sem transacao) — deixado em " . $item['origem']); continue; }
    if ($item['origem'] === 'novo' && $MIN_AGE_MIN > 0 && (time() - (int)$p['upload_ts']) < $MIN_AGE_MIN * 60) { $tot['pulados']++; clog("AGUARDANDO: $fn (upload ha menos de {$MIN_AGE_MIN} min)"); continue; }

    $order = cp_read_order($p['tx']);
    $hint  = cp_gateway_hint($p['tx'], $order);
    $consultas++;
    list($gw, $r) = cp_check($p['tx'], $hint);
    if ($r === null) { $tot['indeterminados']++; clog("INDETERMINADO: $fn gateway=" . ($gw ?: '?') . " (API sem resposta) — tenta de novo na proxima"); continue; }
    $gwName = $gw !== '' ? $gw : 'desconhecido';
    $cust = is_array($order) && isset($order['customer']) && is_array($order['customer']) ? $order['customer'] : array();
    // Valor: do pedido em cache (centavos); senao o valor bruto devolvido pelo gateway (sem conversao).
    $valor = is_array($order) && isset($order['commission']['totalPriceInCents']) ? number_format(((int)$order['commission']['totalPriceInCents']) / 100, 2, ',', '') : ($r['amount_gateway'] !== null ? (string)$r['amount_gateway'] : '');
    $info = array(
        'id_transacao' => $p['tx'], 'gateway' => $gwName, 'status_gateway' => $r['status'], 'status_raw' => $r['raw'], 'paidAt' => $r['paidAt'],
        'nome' => isset($cust['name']) ? $cust['name'] : '', 'cpf' => isset($cust['document']) ? $cust['document'] : '', 'email' => isset($cust['email']) ? $cust['email'] : '', 'telefone' => isset($cust['phone']) ? $cust['phone'] : '',
        'valor' => $valor, 'produto' => (is_array($order) && isset($order['products'][0]['name'])) ? $order['products'][0]['name'] : '',
        'data_upload' => date('Y-m-d H:i:s', (int)$p['upload_ts']), 'arquivo' => $fn, 'verificado_em' => date('Y-m-d H:i:s'),
    );

    if ($r['status'] === 'paid') {
        if ($item['origem'] !== 'novo') $info['nota'] = 'Estava em ' . $item['origem'] . ' e o gateway marcou PAGO depois.';
        if (($nf = cp_move($item['path'], $DIR_OK, $DRY)) !== false) {
            $info['arquivo'] = $nf;
            if (!$DRY) { @file_put_contents($DIR_OK . '/' . $nf . '.json', json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); if ($item['origem'] !== 'novo') @unlink(dirname($item['path']) . '/' . $fn . '.json'); }
            $tot['confirmados']++; clog("PAGO: $fn gateway=$gwName (" . $r['raw'] . ") -> comprovantes/confirmados/" . ($item['origem'] !== 'novo' ? ' [saiu de ' . $item['origem'] . ']' : ''));
        } else clog("ERRO ao mover $fn");
        continue;
    }
    // Pendente / recusado / expirado / nao encontrado -> DESVIO
    $dst = $PRIV . '/desvio-' . $gwName;
    if ($item['origem'] === 'desvio-' . $gwName) {
        $tot['ja_desvio']++;
        if (!$DRY) { $j = dirname($item['path']) . '/' . $fn . '.json'; $old = @json_decode((string)@file_get_contents($j), true); if (is_array($old)) { $old['status_gateway'] = $r['status']; $old['status_raw'] = $r['raw']; $old['verificado_em'] = $info['verificado_em']; $old['reconferencias'] = (isset($old['reconferencias']) ? (int)$old['reconferencias'] : 0) + 1; @file_put_contents($j, json_encode($old, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); } }
        clog("AINDA PENDENTE: $fn gateway=$gwName (" . $r['raw'] . ") — continua em desvio-$gwName");
        continue;
    }
    if (($nf = cp_move($item['path'], $dst, $DRY)) !== false) {
        $info['arquivo'] = $nf;
        if (!$DRY) {
            @file_put_contents($dst . '/' . $nf . '.json', json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            if ($item['origem'] !== 'novo') @unlink(dirname($item['path']) . '/' . $fn . '.json');
            cp_csv_line($dst, array($info['data_upload'], $info['id_transacao'], $gwName, $r['status'], $r['raw'], $info['nome'], $info['cpf'], $info['email'], $info['telefone'], $valor, $nf, $info['verificado_em']), $DRY);
        }
        $tot['desvio']++; clog("DESVIO: $fn gateway=$gwName status=" . $r['status'] . " (" . $r['raw'] . ") nome=" . $info['nome'] . " valor=" . $valor . " -> desvio-$gwName/");
    } else clog("ERRO ao mover $fn para $dst");
}
clog('Resumo: lidos=' . $tot['lidos'] . ' | PAGOS->confirmados=' . $tot['confirmados'] . ' | NOVOS DESVIOS=' . $tot['desvio'] . ' | ja em desvio (ainda pendentes)=' . $tot['ja_desvio'] . ' | indeterminados=' . $tot['indeterminados'] . ' | aguardando idade minima=' . $tot['pulados'] . ' | sem id=' . $tot['sem_id'] . ' | consultas=' . $consultas);
