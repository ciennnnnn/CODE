<?php
declare(strict_types=1);

// Update these values for your Hostinger or local MySQL database.
// Auto-switch DB config: production uses Hostinger MySQL.
$httpHost = (string)($_SERVER['HTTP_HOST'] ?? '');
$serverName = (string)($_SERVER['SERVER_NAME'] ?? '');
$hostOnly = strtolower((string)preg_replace('/:\\d+$/', '', $httpHost));
// Treat only private LAN IPs as local
$isLocalHost = (bool)preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/', $hostOnly)
    || (bool)preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/', strtolower($serverName));

    
// Hostinger production database configuration
define('DB_HOST', 'localhost'); // Hostinger uses 'localhost' for MySQL
define('DB_NAME', 'u972731829_trapico');
define('DB_USER', 'u972731829_trapico');
define('DB_PASS', 'Trapico123'); // <-- Enter your actual Hostinger DB password here
define('DB_PORT', '3306');

define('UPLOAD_PATH', __DIR__ . '/../uploads');
define('UPLOAD_URL', '/uploads');

function getDb(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}

function hashPassword(string $password): string
{
    return password_hash($password, PASSWORD_DEFAULT);
}

function verifyPassword(string $password, string $storedHash): bool
{
    if (!is_string($storedHash) || $storedHash === '') {
        return false;
    }

    $info = password_get_info($storedHash);
    if (!empty($info['algo'])) {
        return password_verify($password, $storedHash);
    }

    return hash_equals($storedHash, $password);
}


function ensureUploadPath(): void
{
    if (!is_dir(UPLOAD_PATH)) {
        mkdir(UPLOAD_PATH, 0755, true);
    }
}

function buildUploadPath(string $filename): string
{
    ensureUploadPath();
    $clean = preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);
    return UPLOAD_PATH . '/' . uniqid('', true) . '-' . $clean;
}
