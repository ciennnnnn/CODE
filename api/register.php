<?php
require_once __DIR__ . '/init.php';


// Debug: log incoming request method and content type
file_put_contents(__DIR__ . '/register_debug.log', date('c') . "\nMETHOD: " . $_SERVER['REQUEST_METHOD'] . "\nCONTENT_TYPE: " . ($_SERVER['CONTENT_TYPE'] ?? '') . "\nRAW: " . file_get_contents('php://input') . "\n\n", FILE_APPEND);

$data = getJsonPayload();
if (!is_array($data)) {
    errorResponse('Invalid or missing JSON payload.');
}
$role     = trim((string)($data['role'] ?? ''));
$username = trim((string)($data['username'] ?? ''));
$emailIn  = trim((string)($data['email'] ?? ''));
$first    = trim((string)($data['first_name'] ?? ''));
$last     = trim((string)($data['last_name'] ?? ''));
$badgeId  = trim((string)($data['badge_id'] ?? ''));
$phone    = trim((string)($data['phone'] ?? $data['phone_number'] ?? ''));
$barangay = trim((string)($data['home_barangay'] ?? ''));
$password = (string)($data['password'] ?? '');

if ($role === '' || $username === '' || $phone === '' || $password === '') {
    errorResponse('Missing required fields. (role, username, phone, password)');
}
if ($role !== 'regular' && $barangay === '') {
    errorResponse('Missing required field: home_barangay');
}

if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password)) {
    errorResponse('Password must be at least 8 characters and include one uppercase letter.');
}

if (!in_array($role, ['regular', 'dispatch', 'field'], true)) {
    errorResponse('Invalid role selected.');
}

function normalizeEmail(string $username, string $role): string
{
    $base = strtolower(preg_replace('/[^a-zA-Z0-9._-]/', '', $username));
    if ($base === '') {
        $base = 'user' . time();
    }
    return $base . '+' . $role . '@trapico.online';
}

function uniqueEmail(PDO $db, string $email): string
{
    $candidate = $email;
    $suffix    = 1;
    while (true) {
        $stmt = $db->prepare('SELECT 1 FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $candidate]);
        if (!$stmt->fetchColumn()) {
            return $candidate;
        }
        $parts     = explode('@', $email, 2);
        $candidate = $parts[0] . '.' . $suffix . '@' . ($parts[1] ?? 'trapico.online');
        $suffix++;
    }
}

function fullName(string $first, string $last, string $fallback): string
{
    $name = trim($first . ' ' . $last);
    return $name !== '' ? $name : $fallback;
}

function sendSignupEmailNotice(string $email, string $name): bool
{
    if ($email === '') {
        return false;
    }

    $subject = 'TRAPICO Account Created Successfully';
    $body = "Hello {$name},\n\n"
        . "Your TRAPICO account has been created successfully.\n"
        . "You can now sign in and submit/track your complaints.\n\n"
        . "If you did not create this account, please contact support immediately.\n\n"
        . "- TRAPICO System";

    $headers = "From: no-reply@trapico.online\r\n"
        . "Reply-To: no-reply@trapico.online\r\n"
        . "X-Mailer: PHP/" . phpversion();

    return @mail($email, $subject, $body, $headers);
}

$db = getDb();
$emailNoticeSent = false;

try {
    if ($role === 'regular') {
        if ($emailIn === '') {
            errorResponse('Email address is required.');
        }
        if (!filter_var($emailIn, FILTER_VALIDATE_EMAIL)) {
            errorResponse('Please provide a valid email address.');
        }

        $exists = $db->prepare("SELECT 1 FROM users WHERE username = :u AND role = 'citizen' LIMIT 1");
        $exists->execute([':u' => $username]);
        if ($exists->fetchColumn()) {
            errorResponse('Username is already registered.');
        }

        $email  = uniqueEmail($db, $emailIn);
        $name   = fullName($first, $last, $username);
        $stmt   = $db->prepare(
            'INSERT INTO users (username, email, password_hash, full_name, phone_number, barangay, role)
             VALUES (:username, :email, :hash, :name, :phone, :barangay, :role_val)'
        );
        $stmt->execute([
            ':username'  => $username,
            ':email'     => $email,
            ':hash'      => hashPassword($password),
            ':name'      => $name,
            ':phone'     => $phone,
            ':barangay'  => $barangay,
            ':role_val'  => 'citizen',
        ]);

        $emailNoticeSent = sendSignupEmailNotice($email, $name);

    } elseif ($role === 'dispatch') {
        if ($emailIn === '') {
            errorResponse('Email address is required.');
        }
        if (!filter_var($emailIn, FILTER_VALIDATE_EMAIL)) {
            errorResponse('Please provide a valid email address.');
        }
        $exists = $db->prepare("SELECT 1 FROM users WHERE username = :u AND role = 'dispatch_officer' LIMIT 1");
        $exists->execute([':u' => $username]);
        if ($exists->fetchColumn()) {
            errorResponse('Account is already registered.');
        }
        $email = uniqueEmail($db, $emailIn);
        $stmt  = $db->prepare(
            'INSERT INTO users (username, email, password_hash, full_name, phone_number, barangay, role)
             VALUES (:username, :email, :hash, :name, :phone, :barangay, :role_val)'
        );
        $stmt->execute([
            ':username' => $username,
            ':email'    => $email,
            ':hash'     => hashPassword($password),
            ':name'     => fullName($first, $last, $username),
            ':phone'    => $phone,
            ':barangay' => $barangay,
            ':role_val' => 'dispatch_officer',
        ]);
        $newUserId = (int)$db->lastInsertId();
        $badge = $badgeId !== '' ? $badgeId : ('DISP-' . date('Y') . '-' . str_pad((string)$newUserId, 4, '0', STR_PAD_LEFT));
        $badgeCheck = $db->prepare('SELECT 1 FROM dispatch_officers WHERE badge_number = :badge LIMIT 1');
        $badgeCheck->execute([':badge' => $badge]);
        if ($badgeCheck->fetchColumn()) {
            $badge = 'DISP-' . date('Y') . '-' . str_pad((string)$newUserId, 4, '0', STR_PAD_LEFT);
        }
        $db->prepare(
            'INSERT INTO dispatch_officers (user_id, badge_number, assigned_barangay) VALUES (:uid, :badge, :brgy)'
        )->execute([':uid' => $newUserId, ':badge' => $badge, ':brgy' => $barangay]);
    } else {
        if ($emailIn === '') {
            errorResponse('Email address is required.');
        }
        if (!filter_var($emailIn, FILTER_VALIDATE_EMAIL)) {
            errorResponse('Please provide a valid email address.');
        }
        $badgeNumber = $badgeId !== '' ? $badgeId : $username;
        $exists = $db->prepare('SELECT 1 FROM field_officers WHERE badge_number = :badge LIMIT 1');
        $exists->execute([':badge' => $badgeNumber]);
        if ($exists->fetchColumn()) {
            errorResponse('Badge ID is already registered.');
        }
        $email = uniqueEmail($db, $emailIn);
        $stmt  = $db->prepare(
            'INSERT INTO users (username, email, password_hash, full_name, phone_number, barangay, role)
             VALUES (:username, :email, :hash, :name, :phone, :barangay, :role_val)'
        );
        $stmt->execute([
            ':username' => $username,
            ':email'    => $email,
            ':hash'     => hashPassword($password),
            ':name'     => fullName($first, $last, $username),
            ':phone'    => $phone,
            ':barangay' => $barangay,
            ':role_val' => 'field_officer',
        ]);
        $newUserId = (int)$db->lastInsertId();
        $db->prepare(
            'INSERT INTO field_officers (user_id, badge_number, assigned_barangay, is_available) VALUES (:uid, :badge, :brgy, :avail)'
        )->execute([':uid' => $newUserId, ':badge' => $badgeNumber, ':brgy' => $barangay, ':avail' => 'offline']);
    }
} catch (PDOException $e) {
    errorResponse('Database error: ' . $e->getMessage(), 500);
}

successResponse([
    'message' => 'Account created successfully.',
    'email_notice_sent' => $emailNoticeSent,
]);
