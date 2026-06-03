<?php
require_once __DIR__ . '/init.php';

$data     = getJsonPayload();
$username = trim((string)($data['username'] ?? ''));
$password = trim((string)($data['password'] ?? ''));
$role     = trim((string)($data['role'] ?? ''));

if ($username === '' || $password === '' || $role === '') {
    errorResponse('Username, password, and role are required.');
}

$db   = getDb();
$user = null;
$redirect = 'index.html';

/* Ensure rate-limiting columns exist (MySQL 5.7+ compatible) */
try {
    foreach (['failed_login_attempts' => 'INT DEFAULT 0', 'locked_until' => 'DATETIME DEFAULT NULL'] as $col => $def) {
        $chk = $db->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c');
        $chk->execute([':t' => 'users', ':c' => $col]);
        if ((int)$chk->fetchColumn() === 0) {
            $db->exec("ALTER TABLE `users` ADD COLUMN `{$col}` {$def}");
        }
    }
} catch (PDOException $e) { /* non-fatal */ }

try {
    if ($role === 'regular') {
        /* Citizens log in with EMAIL only */
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email, u.phone_number, u.barangay AS home_barangay,
                    u.failed_login_attempts, u.locked_until
             FROM users u
             WHERE u.email = :email AND u.role = :role AND u.is_active = 1'
        );
        $stmt->execute([':email' => $username, ':role' => 'citizen']);
        $user = $stmt->fetch();
        $redirect = 'CITIZEN/civilian.html';
    } elseif ($role === 'dispatch') {
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email,
                    u.failed_login_attempts, u.locked_until
             FROM users u
             WHERE (u.username = :u1 OR u.email = :u2) AND u.role = :role AND u.is_active = 1'
        );
        $stmt->execute([':u1' => $username, ':u2' => $username, ':role' => 'dispatch_officer']);
        $user = $stmt->fetch();
        $redirect = 'DISPATCH/dispatch.html?v=20260507';
    } elseif ($role === 'field') {
        $stmt = $db->prepare(
            'SELECT u.user_id AS id, u.user_id, u.username, u.password_hash,
                    u.full_name AS name, u.email,
                    u.failed_login_attempts, u.locked_until
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
    errorResponse('Invalid credentials. Please check your email and password.');
}

/* ── RATE LIMITING: check lockout ─────────────────────────── */
$lockedUntil  = $user['locked_until'] ?? null;
$failedAttempts = (int)($user['failed_login_attempts'] ?? 0);

if ($lockedUntil !== null) {
    $lockTime = strtotime($lockedUntil);
    $now      = time();
    if ($lockTime > $now) {
        $remaining = ceil(($lockTime - $now) / 60);
        errorResponse("Account temporarily locked. Too many failed attempts. Please wait {$remaining} minute(s) before trying again.");
    } else {
        /* Lock expired — reset counter */
        try {
            $db->prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE user_id = :uid')
               ->execute([':uid' => $user['user_id']]);
        } catch (PDOException $e) { /* non-fatal */ }
        $failedAttempts = 0;
    }
}

/* ── VERIFY PASSWORD ───────────────────────────────────────── */
if (!verifyPassword($password, $user['password_hash'] ?? '')) {
    /* Increment failed attempts */
    $newAttempts = $failedAttempts + 1;
    try {
        if ($newAttempts >= 3) {
            /* Lock for 3 minutes */
            $lockUntil = date('Y-m-d H:i:s', time() + 180);
            $db->prepare('UPDATE users SET failed_login_attempts = :attempts, locked_until = :lock WHERE user_id = :uid')
               ->execute([':attempts' => $newAttempts, ':lock' => $lockUntil, ':uid' => $user['user_id']]);
            errorResponse('Account locked for 3 minutes due to too many failed login attempts. Please try again later.');
        } else {
            $remaining = 3 - $newAttempts;
            $db->prepare('UPDATE users SET failed_login_attempts = :attempts WHERE user_id = :uid')
               ->execute([':attempts' => $newAttempts, ':uid' => $user['user_id']]);
            errorResponse("Invalid credentials. {$remaining} attempt(s) remaining before account is temporarily locked.");
        }
    } catch (PDOException $e) {
        errorResponse('Invalid credentials.');
    }
}

/* ── SUCCESS: reset failed attempts ───────────────────────── */
try {
    $db->prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE user_id = :uid')
       ->execute([':uid' => $user['user_id']]);
} catch (PDOException $e) { /* non-fatal */ }

/* ── LOOK UP EXTENSION TABLE PK ───────────────────────────── */
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
