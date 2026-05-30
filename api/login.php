<?php
require_once __DIR__ . '/init.php';

$data = getJsonPayload();
$username = trim((string)($data['username'] ?? ''));
$password = trim((string)($data['password'] ?? ''));
$role     = trim((string)($data['role'] ?? ''));

if ($username === '' || $password === '' || $role === '') {
    errorResponse('Username, password, and role are required.');
}

$db   = getDb();
$user = null;
$redirect = 'index.html';

try {
    if ($role === 'regular') {
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email, u.phone_number, u.barangay AS home_barangay
             FROM users u
             WHERE (u.username = :u1 OR u.email = :u2) AND u.role = :role AND u.is_active = 1'
        );
        $stmt->execute([':u1' => $username, ':u2' => $username, ':role' => 'citizen']);
        $user = $stmt->fetch();
        $redirect = 'CITIZEN/civilian.html';
    } elseif ($role === 'dispatch') {
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email
             FROM users u
             WHERE (u.username = :u1 OR u.email = :u2) AND u.role = :role AND u.is_active = 1'
        );
        $stmt->execute([':u1' => $username, ':u2' => $username, ':role' => 'dispatch_officer']);
        $user = $stmt->fetch();
        $redirect = 'DISPATCH/dispatch.html?v=20260507';
    } elseif ($role === 'field') {
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email
             FROM users u
             WHERE (u.username = :u1 OR u.email = :u2) AND u.role = :role AND u.is_active = 1'
        );
        $stmt->execute([':u1' => $username, ':u2' => $username, ':role' => 'field_officer']);
        $user = $stmt->fetch();
        $redirect = 'FIELD/field.html';
    } else {
        errorResponse('Invalid role selected.');
    }
} catch (PDOException $e) {
    errorResponse('Database error: ' . $e->getMessage());
}

if (!$user) {
    errorResponse('Invalid credentials.');
}

if (!verifyPassword($password, $user['password_hash'] ?? '')) {
    errorResponse('Invalid credentials.');
}

/* Update last login */
try {
    $db->prepare('UPDATE users SET updated_at = NOW() WHERE user_id = :uid')
       ->execute([':uid' => $user['user_id']]);
} catch (PDOException $e) { /* non-fatal */ }

/* Look up extension table PK so dispatch/field queries use the correct FK */
$officerId = null;
try {
    if ($role === 'dispatch') {
        $extStmt = $db->prepare('SELECT dispatch_id FROM dispatch_officers WHERE user_id = :uid LIMIT 1');
        $extStmt->execute([':uid' => $user['user_id']]);
        $officerId = $extStmt->fetchColumn() ?: null;
    } elseif ($role === 'field') {
        $extStmt = $db->prepare('SELECT officer_id FROM field_officers WHERE user_id = :uid LIMIT 1');
        $extStmt->execute([':uid' => $user['user_id']]);
        $officerId = $extStmt->fetchColumn() ?: null;
    }
} catch (PDOException $e) { /* non-fatal */ }

$_SESSION['trapico_user'] = [
    'id'           => $user['id'],
    'user_id'      => $user['user_id'],
    'officer_id'   => $officerId,
    'role'         => $role,
    'username'     => $user['username'] ?? $username,
    'name'         => trim($user['name'] ?? ''),
    'email'        => $user['email'] ?? '',
    'home_barangay'=> $user['home_barangay'] ?? '',
];

if (!isset($_SESSION['trapico_user_by_role']) || !is_array($_SESSION['trapico_user_by_role'])) {
    $_SESSION['trapico_user_by_role'] = [];
}
$_SESSION['trapico_user_by_role'][$role] = $_SESSION['trapico_user'];

successResponse(['redirect' => $redirect, 'user' => $_SESSION['trapico_user']]);
