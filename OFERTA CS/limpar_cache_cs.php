<?php
/**
 * LIMPAR CACHE — CNH Social (CS)
 * ------------------------------------------------------------------
 * Move (NAO apaga) o conteudo de .private/cache/ para uma pasta de backup
 * .private/cache_backup_AAAAMMDD_HHMMSS/ e recria o cache vazio.
 * Serve para zerar qualquer dado antigo (UTMify, consultas de CPF, status de
 * PIX, logs) acumulado antes da troca de dominio. Reversivel: basta mover de volta.
 *
 * USO (CLI, recomendado):
 *   php limpar_cache_cs.php                 -> limpa tudo, MENOS order_* e tx_* dos
 *                                              ultimos 48h (PIX ainda pendentes,
 *                                              que o cron precisa p/ confirmar)
 *   php limpar_cache_cs.php --tudo          -> limpa tudo, inclusive os recentes
 *   php limpar_cache_cs.php --dry           -> so mostra o que faria
 *   php limpar_cache_cs.php --horas=24      -> muda a janela de preservacao
 *
 * USO (navegador, protegido pelo RECOVERY_SECRET do .env):
 *   https://SEU-DOMINIO/limpar_cache_cs.php?token=SEU_RECOVERY_SECRET[&tudo=1][&dry=1][&horas=48]
 *
 * NAO mexe em: .private/recovery.sqlite, .private/comprovantes/, .env, codigo.
 * Depois de usar, apague este arquivo do servidor (ou deixe: sem token ele nega).
 */

$isCli = (PHP_SAPI === 'cli');
$root  = __DIR__;
$priv  = $root . DIRECTORY_SEPARATOR . '.private';
$cache = $priv . DIRECTORY_SEPARATOR . 'cache';

// ---------- parametros ----------
$opt = array('tudo' => false, 'dry' => false, 'horas' => 48);
if ($isCli) {
    foreach (array_slice($argv, 1) as $a) {
        if ($a === '--tudo') $opt['tudo'] = true;
        elseif ($a === '--dry') $opt['dry'] = true;
        elseif (preg_match('/^--horas=(\d+)$/', $a, $m)) $opt['horas'] = (int)$m[1];
    }
} else {
    header('Content-Type: text/plain; charset=UTF-8');
    // token = RECOVERY_SECRET (mesmo esquema do utmify_audit). Le o .env sem expor nada.
    $secret = '';
    $envFiles = array($priv . '/.env');
    $home = getenv('HOME'); if ($home) { $envFiles[] = rtrim($home, '/') . '/mail.rec-cnh/.env'; $envFiles[] = rtrim($home, '/') . '/mail.rec/.env'; }
    foreach ($envFiles as $ef) {
        if (!is_readable($ef)) continue;
        foreach (file($ef, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (preg_match('/^\s*RECOVERY_SECRET\s*=\s*["\']?([^"\'#]+)/', $line, $m)) { $secret = trim($m[1]); break 2; }
        }
    }
    if ($secret === '' && getenv('RECOVERY_SECRET')) $secret = (string)getenv('RECOVERY_SECRET');
    $tok = isset($_GET['token']) ? (string)$_GET['token'] : '';
    if ($secret === '' || $tok === '' || !hash_equals($secret, $tok)) { http_response_code(403); echo "403 - token invalido (use ?token=RECOVERY_SECRET)\n"; exit; }
    $opt['tudo']  = !empty($_GET['tudo']);
    $opt['dry']   = !empty($_GET['dry']);
    if (isset($_GET['horas'])) $opt['horas'] = max(0, (int)$_GET['horas']);
}

if (!is_dir($cache)) { echo "Pasta de cache nao encontrada: $cache\n"; exit($isCli ? 1 : 0); }

$limite = time() - $opt['horas'] * 3600;
$backup = $priv . DIRECTORY_SEPARATOR . 'cache_backup_' . date('Ymd_His');
$stats  = array('movidos' => 0, 'preservados' => 0, 'erros' => 0, 'por_tipo' => array());
$preservados = array();

$items = scandir($cache);
if (!$opt['dry'] && !is_dir($backup) && !@mkdir($backup, 0700, true)) { echo "ERRO: nao consegui criar $backup\n"; exit($isCli ? 1 : 0); }

foreach ($items as $f) {
    if ($f === '.' || $f === '..') continue;
    $src = $cache . DIRECTORY_SEPARATOR . $f;
    $tipo = preg_match('/^([a-z]+)_/i', $f, $m) ? strtolower($m[1]) : (is_dir($src) ? 'pasta' : 'outro');
    if (!isset($stats['por_tipo'][$tipo])) $stats['por_tipo'][$tipo] = 0;

    // Preserva PIX recentes (pedidos/status) para o cron conseguir confirmar o pagamento
    if (!$opt['tudo'] && ($tipo === 'order' || $tipo === 'tx' || $tipo === 'alias') && @filemtime($src) >= $limite) {
        $stats['preservados']++; $preservados[] = $f; continue;
    }
    if ($opt['dry']) { $stats['movidos']++; $stats['por_tipo'][$tipo]++; continue; }
    if (@rename($src, $backup . DIRECTORY_SEPARATOR . $f)) { $stats['movidos']++; $stats['por_tipo'][$tipo]++; }
    else $stats['erros']++;
}

echo ($opt['dry'] ? "[SIMULACAO] " : "") . "Limpeza do cache CS\n";
echo "Cache:   $cache\n";
echo "Backup:  " . ($opt['dry'] ? '(nao criado)' : $backup) . "\n";
echo "Janela preservada: " . ($opt['tudo'] ? 'nenhuma (--tudo)' : $opt['horas'] . 'h para order_*/tx_*/alias_*') . "\n";
echo "Movidos: {$stats['movidos']}  Preservados: {$stats['preservados']}  Erros: {$stats['erros']}\n";
ksort($stats['por_tipo']);
foreach ($stats['por_tipo'] as $t => $n) echo "  - $t: $n\n";
if ($stats['preservados'] > 0 && $stats['preservados'] <= 30) echo "Preservados: " . implode(', ', $preservados) . "\n";
echo "\nPara desfazer: mova o conteudo da pasta de backup de volta para .private/cache/.\n";
echo "Para apagar o backup depois de alguns dias: rm -rf " . ($opt['dry'] ? '.private/cache_backup_*' : $backup) . "\n";
