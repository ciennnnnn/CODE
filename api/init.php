<?php
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
error_reporting(0);

require_once __DIR__ . '/db.php';

if (session_status() === PHP_SESSION_NONE) {
    /* Use a writable sessions directory inside the project so Hostinger shared
       hosting can persist sessions reliably between requests. */
    $sessionDir = dirname(__DIR__) . '/sessions';
    if (!is_dir($sessionDir)) {
        @mkdir($sessionDir, 0700, true);
    }
    if (is_writable($sessionDir)) {
        session_save_path($sessionDir);
    }
    ini_set('session.cookie_secure', '0');
    ini_set('session.cookie_samesite', 'Lax');
    ini_set('session.cookie_httponly', '1');
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
$_origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($_origin !== '') {
    header('Access-Control-Allow-Origin: ' . $_origin);
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-TRAPICO-ROLE');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function getJsonPayload(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (is_array($data)) {
        return $data;
    }
    return $_POST;
}

function jsonResponse(array $payload, int $status = 200): void
{
    /* Clear any accidental pre-output: PHP notices, session leftovers,
       or content injected by Hostinger's server before we write JSON. */
    while (ob_get_level() > 0) { ob_end_clean(); }
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function successResponse(array $data = []): void
{
    jsonResponse(array_merge(['success' => true], $data));
}

function errorResponse(string $message, int $status = 400): void
{
    jsonResponse(['success' => false, 'error' => $message], $status);
}

function getCurrentUser(): ?array
{
    $requestedRole = getRequestedRoleContext();

    if ($requestedRole !== '' && isset($_SESSION['trapico_user_by_role'][$requestedRole])) {
        return $_SESSION['trapico_user_by_role'][$requestedRole];
    }

    return $_SESSION['trapico_user'] ?? null;
}

function getRequestedRoleContext(): string
{
    $headerRole = trim(strtolower((string)($_SERVER['HTTP_X_TRAPICO_ROLE'] ?? '')));
    $allowed = ['regular', 'dispatch', 'field'];
    if (in_array($headerRole, $allowed, true)) {
        return $headerRole;
    }

    $referrer = trim(strtolower((string)($_SERVER['HTTP_REFERER'] ?? '')));
    if ($referrer !== '') {
        if (strpos($referrer, '/citizen/') !== false || strpos($referrer, 'civilian.html') !== false || strpos($referrer, 'citizen-login') !== false || strpos($referrer, 'citizen-signup') !== false) {
            return 'regular';
        }
        if (strpos($referrer, '/dispatch/') !== false || strpos($referrer, 'dispatch.html') !== false || strpos($referrer, 'dispatch-login') !== false || strpos($referrer, 'dispatch-signup') !== false) {
            return 'dispatch';
        }
        if (strpos($referrer, '/field/') !== false || strpos($referrer, 'field.html') !== false || strpos($referrer, 'field-login') !== false || strpos($referrer, 'field-signup') !== false) {
            return 'field';
        }
    }

    return '';
}

function requireLogin(): array
{
    $user = getCurrentUser();
    if ($user === null) {
        errorResponse('Unauthorized. Please log in.', 401);
    }
    return $user;
}

function requireRole(string $role): array
{
    $user = requireLogin();
    if (!isset($user['role']) || $user['role'] !== $role) {
        errorResponse('Forbidden. Your role cannot access this endpoint.', 403);
    }
    return $user;
}
