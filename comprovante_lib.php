<?php
/**
 * Upload de comprovantes PIX para Supabase Storage + tabela comprovantes.
 * Usado por api_proxy.php?action=upload_comprovante. Sem credenciais no front.
 */

if (!defined('COMPROVANTE_MAX_BYTES')) {
    define('COMPROVANTE_MAX_BYTES', 5 * 1024 * 1024);
}

if (!function_exists('comprovante_allowed_mimes')) {
    function comprovante_allowed_mimes() {
        return array(
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png'  => 'image/png',
            'webp' => 'image/webp',
            'pdf'  => 'application/pdf',
        );
    }
}

if (!function_exists('comprovante_sanitize_txid')) {
    function comprovante_sanitize_txid($txid) {
        $txid = trim((string)$txid);
        if ($txid === '' || strlen($txid) > 128) {
            return false;
        }
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $txid)) {
            return false;
        }
        return $txid;
    }
}

if (!function_exists('comprovante_build_filename')) {
    function comprovante_build_filename($txid, $ext, $timestamp = null) {
        if ($timestamp === null) {
            $timestamp = time();
        }
        return $txid . '_' . $timestamp . '.' . $ext;
    }
}

if (!function_exists('comprovante_storage_path')) {
    function comprovante_storage_path($bucket, $filename) {
        return (string)$bucket . '/' . (string)$filename;
    }
}

if (!function_exists('comprovante_validate_file')) {
    function comprovante_validate_file($file, $requireUploaded = true) {
        if (!is_array($file) || empty($file['tmp_name'])) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo obrigatorio.');
        }

        $err = isset($file['error']) ? (int)$file['error'] : UPLOAD_ERR_NO_FILE;
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo excede 5MB.');
        }
        if ($err !== UPLOAD_ERR_OK) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo obrigatorio.');
        }

        $tmp = (string)$file['tmp_name'];
        if (!is_file($tmp) || !is_readable($tmp)) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo obrigatorio.');
        }
        if ($requireUploaded && function_exists('is_uploaded_file') && !is_uploaded_file($tmp)) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo obrigatorio.');
        }

        $size = isset($file['size']) ? (int)$file['size'] : 0;
        if ($size <= 0) {
            $size = (int)filesize($tmp);
        }
        if ($size > COMPROVANTE_MAX_BYTES) {
            return array('ok' => false, 'http' => 400, 'error' => 'Arquivo excede 5MB.');
        }

        $origName = isset($file['name']) ? (string)$file['name'] : '';
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        $allowed = comprovante_allowed_mimes();
        if ($ext === '' || !isset($allowed[$ext])) {
            return array('ok' => false, 'http' => 400, 'error' => 'Tipo de arquivo nao permitido.');
        }

        $mime = '';
        if (class_exists('finfo')) {
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $detected = $finfo->file($tmp);
            if (is_string($detected)) {
                $mime = strtolower($detected);
            }
        }
        if ($mime === '' && function_exists('mime_content_type')) {
            $detected = @mime_content_type($tmp);
            if (is_string($detected)) {
                $mime = strtolower($detected);
            }
        }
        if ($mime === '' || $mime !== $allowed[$ext]) {
            return array('ok' => false, 'http' => 400, 'error' => 'Tipo de arquivo nao permitido.');
        }

        return array(
            'ok'   => true,
            'ext'  => $ext,
            'mime' => $mime,
            'size' => $size,
            'tmp'  => $tmp,
        );
    }
}

if (!function_exists('comprovante_env')) {
    function comprovante_env($key, $default = '') {
        if (function_exists('env_get')) {
            $v = env_get($key, null);
            if (is_string($v) && trim($v) !== '') {
                return trim($v);
            }
        }
        if (function_exists('getenv')) {
            $v = @getenv($key);
            if (is_string($v) && trim($v) !== '') {
                return trim($v);
            }
        }
        if (isset($_ENV[$key]) && is_string($_ENV[$key]) && trim($_ENV[$key]) !== '') {
            return trim($_ENV[$key]);
        }
        $constName = $key . '_DEFAULT';
        if (defined($constName)) {
            $v = constant($constName);
            if (is_string($v) && trim($v) !== '') {
                return trim($v);
            }
        }
        return $default;
    }
}

if (!function_exists('comprovante_load_config')) {
    function comprovante_load_config() {
        $bucket = comprovante_env('SUPABASE_BUCKET', '');
        if ($bucket === '') {
            $bucket = 'comprovantes-sr';
        }
        $table = comprovante_env('SUPABASE_TABLE', '');
        if ($table === '') {
            $table = 'comprovantes_sr';
        }
        return array(
            'url'              => rtrim(comprovante_env('SUPABASE_URL', ''), '/'),
            'key'              => comprovante_env('SUPABASE_SERVICE_KEY', ''),
            'bucket'           => $bucket,
            'table'            => $table,
            'require_uploaded' => true,
        );
    }
}

if (!function_exists('comprovante_http_request')) {
    function comprovante_http_request($method, $url, $headers, $body) {
        if (!function_exists('curl_init')) {
            return array('status' => 0, 'body' => '', 'transport_error' => true);
        }
        $ch = curl_init($url);
        if ($ch === false) {
            return array('status' => 0, 'body' => '', 'transport_error' => true);
        }
        $opts = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'funil-sr-comprovante/1.0',
        );
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        @curl_close($ch);
        if ($raw === false || $errno !== 0) {
            error_log('[comprovante] falha de transporte http_status=0');
            return array('status' => 0, 'body' => '', 'transport_error' => true);
        }
        return array('status' => $status, 'body' => $raw, 'transport_error' => false);
    }
}

if (!function_exists('comprovante_generic_fail')) {
    function comprovante_generic_fail($httpStatus, $upstreamStatus = 0) {
        if ($upstreamStatus > 0) {
            error_log('[comprovante] falha upstream http=' . (int)$upstreamStatus);
        }
        return array(
            'status' => $httpStatus,
            'body'   => array('ok' => false, 'error' => 'Falha ao enviar comprovante.'),
        );
    }
}

if (!function_exists('comprovante_handle_upload')) {
    function comprovante_handle_upload($post, $files, $cfg, $httpFn = null) {
        $txid = comprovante_sanitize_txid(isset($post['id']) ? $post['id'] : '');
        if ($txid === false) {
            return array('status' => 400, 'body' => array('ok' => false, 'error' => 'Parametro id invalido.'));
        }

        $requireUploaded = !isset($cfg['require_uploaded']) || $cfg['require_uploaded'];
        $file = (isset($files['file']) && is_array($files['file'])) ? $files['file'] : array();
        $validated = comprovante_validate_file($file, $requireUploaded);
        if (empty($validated['ok'])) {
            return array(
                'status' => isset($validated['http']) ? (int)$validated['http'] : 400,
                'body'   => array('ok' => false, 'error' => isset($validated['error']) ? $validated['error'] : 'Arquivo obrigatorio.'),
            );
        }

        $baseUrl = isset($cfg['url']) ? rtrim((string)$cfg['url'], '/') : '';
        $key = isset($cfg['key']) ? (string)$cfg['key'] : '';
        $bucket = isset($cfg['bucket']) ? (string)$cfg['bucket'] : 'comprovantes-sr';
        $table = isset($cfg['table']) ? (string)$cfg['table'] : 'comprovantes';
        $table = preg_replace('/[^a-z0-9_]/', '', strtolower($table));
        if ($table === '') {
            $table = 'comprovantes';
        }
        if ($baseUrl === '' || $key === '' || $bucket === '' || !preg_match('/^https:\/\//i', $baseUrl)) {
            error_log('[comprovante] supabase nao configurado');
            return comprovante_generic_fail(500);
        }

        $filename = comprovante_build_filename($txid, $validated['ext']);
        $binary = @file_get_contents($validated['tmp']);
        if ($binary === false || $binary === '') {
            return comprovante_generic_fail(500);
        }

        if (!is_callable($httpFn)) {
            $httpFn = 'comprovante_http_request';
        }

        $objectUrl = $baseUrl . '/storage/v1/object/' . rawurlencode($bucket) . '/' . rawurlencode($filename);
        $upload = $httpFn('POST', $objectUrl, array(
            'Authorization: Bearer ' . $key,
            'apikey: ' . $key,
            'Content-Type: ' . $validated['mime'],
        ), $binary);
        $uploadStatus = isset($upload['status']) ? (int)$upload['status'] : 0;
        if (!empty($upload['transport_error']) || $uploadStatus < 200 || $uploadStatus >= 300) {
            return comprovante_generic_fail(502, $uploadStatus);
        }

        $storedPath = comprovante_storage_path($bucket, $filename);
        $insertUrl = $baseUrl . '/rest/v1/' . $table;
        $payload = json_encode(array(
            'txid'     => $txid,
            'url'      => $storedPath,
            'filename' => $filename,
        ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $insert = $httpFn('POST', $insertUrl, array(
            'Authorization: Bearer ' . $key,
            'apikey: ' . $key,
            'Content-Type: application/json',
            'Prefer: return=minimal',
        ), $payload);
        $insertStatus = isset($insert['status']) ? (int)$insert['status'] : 0;
        if (!empty($insert['transport_error']) || $insertStatus < 200 || $insertStatus >= 300) {
            return comprovante_generic_fail(502, $insertStatus);
        }

        return array('status' => 200, 'body' => array('ok' => true));
    }
}
