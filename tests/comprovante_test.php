<?php
/**
 * Testes do upload de comprovante (Supabase).
 * Executar: php tests/comprovante_test.php
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');

$lib = dirname(__DIR__) . '/comprovante_lib.php';
if (!is_readable($lib)) {
    fwrite(STDERR, "FAIL: comprovante_lib.php nao encontrado\n");
    exit(1);
}
require_once $lib;

$failed = 0;
$passed = 0;

function assert_true($cond, $name) {
    global $failed, $passed;
    if ($cond) {
        $passed++;
        echo "PASS  $name\n";
        return;
    }
    $failed++;
    echo "FAIL  $name\n";
}

function assert_eq($actual, $expected, $name) {
    assert_true($actual === $expected, $name . ' (got ' . var_export($actual, true) . ')');
}

function make_png_file() {
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', true);
    $path = tempnam(sys_get_temp_dir(), 'cmp_');
    file_put_contents($path, $png);
    return $path;
}

function make_files_entry($path, $name, $error = UPLOAD_ERR_OK) {
    return array(
        'name'     => $name,
        'type'     => 'application/octet-stream',
        'tmp_name' => $path,
        'error'    => $error,
        'size'     => is_file($path) ? filesize($path) : 0,
    );
}

$cfg = array(
    'url'              => 'https://example.supabase.co',
    'key'              => 'service-role-test-key',
    'bucket'           => 'comprovantes',
    'require_uploaded' => false,
);

// --- txid ---
assert_eq(comprovante_sanitize_txid('tx_vpaek0g4o2'), 'tx_vpaek0g4o2', 'txid valido e preservado');
assert_eq(comprovante_sanitize_txid('abc-123_Z'), 'abc-123_Z', 'txid com hifen e underscore');
assert_eq(comprovante_sanitize_txid(''), false, 'txid vazio e rejeitado');
assert_eq(comprovante_sanitize_txid('../etc/passwd'), false, 'txid com path traversal e rejeitado');
assert_eq(comprovante_sanitize_txid('id com espaco'), false, 'txid com espaco e rejeitado');
assert_eq(comprovante_sanitize_txid('id;rm -rf'), false, 'txid com pontuacao e rejeitado');

// --- arquivo ---
$pngPath = make_png_file();
$okFile = comprovante_validate_file(make_files_entry($pngPath, 'ok.png'), false);
assert_eq($okFile['ok'], true, 'png pequeno e aceito');
assert_eq($okFile['ext'], 'png', 'extensao png detectada');
assert_eq($okFile['mime'], 'image/png', 'mime png detectado');

$badExt = comprovante_validate_file(make_files_entry($pngPath, 'virus.exe'), false);
assert_eq($badExt['ok'], false, 'extensao exe e rejeitada');

$missing = comprovante_validate_file(array(), false);
assert_eq($missing['ok'], false, 'arquivo ausente e rejeitado');

$bigPath = tempnam(sys_get_temp_dir(), 'cmpb_');
$fh = fopen($bigPath, 'wb');
ftruncate($fh, (5 * 1024 * 1024) + 1);
fclose($fh);
$big = comprovante_validate_file(make_files_entry($bigPath, 'big.png'), false);
assert_eq($big['ok'], false, 'arquivo maior que 5MB e rejeitado');
assert_true(isset($big['http']) && $big['http'] === 400, 'arquivo grande retorna http 400');

// --- nomes e URLs ---
assert_eq(
    comprovante_build_filename('tx_abc', 'png', 1700000000),
    'tx_abc_1700000000.png',
    'filename unico {txid}_{timestamp}.{ext}'
);
assert_eq(
    comprovante_storage_path('comprovantes-sr', 'tx_abc_1.png'),
    'comprovantes-sr/tx_abc_1.png',
    'caminho interno do Storage (bucket privado, sem URL publica)'
);
assert_eq(comprovante_ticket('acordo', false), 'front', 'acordo vira ticket front');
assert_eq(comprovante_ticket('acordo', true), 'front_ds', 'downsell do acordo vira front_ds');
assert_eq(comprovante_ticket('registro', false), 'up1', 'registro vira up1');
assert_eq(comprovante_ticket('registro', true), 'up1_ds', 'downsell do registro vira up1_ds');
assert_eq(comprovante_ticket('encerramento', false), 'up16', 'encerramento vira up16');
assert_eq(comprovante_ticket('up3', false), 'up3', 'ticket ja no formato Velani e preservado');
assert_eq(comprovante_ticket('downsell', false), 'front_ds', 'slug downsell vira front_ds');
$fixedNow = new DateTimeImmutable('2026-11-06 13:45:07', new DateTimeZone('America/Sao_Paulo'));
$path = comprovante_object_path('tx_abc', 'png', 'front', $fixedNow);
assert_true(
    (bool)preg_match('#^2026/11/06/front/tx_abc/134507-[0-9a-f]{8}\.png$#', $path),
    'path Velani YYYY/MM/DD/{ticket}/{txid}/{hhmmss}-{rand}.ext (got ' . $path . ')'
);
assert_eq(
    comprovante_object_url('https://example.supabase.co', 'comprovantes-sr', '2026/11/06/front/tx_abc/134507-deadbeef.png'),
    'https://example.supabase.co/storage/v1/object/comprovantes-sr/2026/11/06/front/tx_abc/134507-deadbeef.png',
    'URL de upload preserva pastas por data e ticket'
);

// --- handle: txid invalido ---
$res = comprovante_handle_upload(array('id' => '../x'), array('file' => make_files_entry($pngPath, 'ok.png')), $cfg);
assert_eq($res['status'], 400, 'handle rejeita txid invalido com 400');
assert_eq($res['body']['ok'], false, 'handle txid invalido ok=false');

// --- handle: arquivo grande ---
$res = comprovante_handle_upload(array('id' => 'tx_ok'), array('file' => make_files_entry($bigPath, 'big.png')), $cfg);
assert_eq($res['status'], 400, 'handle rejeita arquivo >5MB com 400');

// --- handle: supabase 4xx vira erro generico ---
$httpFail = function ($method, $url, $headers, $body) {
    return array('status' => 403, 'body' => 'secret-from-supabase');
};
$res = comprovante_handle_upload(
    array('id' => 'tx_ok'),
    array('file' => make_files_entry($pngPath, 'ok.png')),
    $cfg,
    $httpFail
);
assert_eq($res['status'], 502, 'handle mapeia HTTP 4xx do Storage para 502');
assert_eq($res['body']['ok'], false, 'handle erro supabase ok=false');
$encoded = json_encode($res['body']);
assert_true(strpos($encoded, 'secret-from-supabase') === false, 'erro do cliente nao vaza corpo do Storage');
assert_true(strpos($encoded, 'service-role-test-key') === false, 'erro do cliente nao vaza service key');

// --- handle: sucesso upload + insert ---
$calls = array();
$httpOk = function ($method, $url, $headers, $body) use (&$calls) {
    $calls[] = array('method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body);
    return array('status' => 200, 'body' => '{"id":"ok"}');
};
$res = comprovante_handle_upload(
    array('id' => 'tx_ok', 'productType' => 'acordo'),
    array('file' => make_files_entry($pngPath, 'ok.png')),
    $cfg,
    $httpOk
);
assert_eq($res['status'], 200, 'handle sucesso retorna 200');
assert_eq($res['body']['ok'], true, 'handle sucesso ok=true');
assert_true(!isset($res['body']['url']), 'handle sucesso nao devolve URL publica');
assert_eq(count($calls), 2, 'handle faz upload e insert');
assert_true(strpos($calls[0]['url'], '/storage/v1/object/comprovantes/') !== false, 'primeira chamada e upload no Storage');
assert_true(strpos($calls[0]['url'], '/front/tx_ok/') !== false, 'upload entra na pasta do ticket front');
assert_true((bool)preg_match('#/[0-9]{4}/[0-9]{2}/[0-9]{2}/front/tx_ok/#', $calls[0]['url']), 'upload usa pastas YYYY/MM/DD/ticket/txid');
assert_true(strpos($calls[1]['url'], '/rest/v1/comprovantes') !== false, 'segunda chamada e insert no PostgREST');
$insertBody = isset($calls[1]['body']) ? $calls[1]['body'] : '';
assert_true(strpos($insertBody, 'front/tx_ok/') !== false, 'tabela guarda path aninhado com ticket');
assert_true(in_array('Authorization: Bearer service-role-test-key', $calls[0]['headers'], true), 'upload usa Bearer service_role');
assert_true(in_array('apikey: service-role-test-key', $calls[1]['headers'], true), 'insert envia header apikey');
assert_true(in_array('Prefer: return=minimal', $calls[1]['headers'], true), 'insert nao exige SELECT (return=minimal)');

@unlink($pngPath);
@unlink($bigPath);

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
