<?php
/**
 * Router para `php -S 127.0.0.1:8840 dev-router.php` (ou `./serve-local.sh`) na pasta OFERTA CS.
 * Serve arquivos estaticos e encaminha /api/* para api_proxy.php (consulta CPF, PIX, etc.).
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === false) {
    $path = '/';
}

if (preg_match('#^/api/(.*)$#', $path, $m)) {
    $_GET['cnh_api'] = $m[1];
    require __DIR__ . '/api_proxy.php';
    return true;
}

$dirIndex = null;
if ($path !== '/') {
    $trimmed = rtrim($path, '/');
    $candidate = __DIR__ . $trimmed . '/index.html';
    if (is_file($candidate)) {
        $dirIndex = $candidate;
    }
}
if ($dirIndex !== null) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($dirIndex);
    return true;
}

$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false;
}

if ($path === '/' || !is_file($file)) {
    $spa = __DIR__ . '/index.html';
    if (is_file($spa)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($spa);
        return true;
    }
}

return false;