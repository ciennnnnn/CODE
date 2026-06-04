<?php
require_once __DIR__ . '/init.php';

$data = getJsonPayload();
if (!is_array($data)) {
    errorResponse('Invalid or missing JSON payload.');
}

$role     = trim((string)($data['role'] ?? ''));
$emailIn  = trim((string)($data['email'] ?? ''));
$phone    = trim((string)($data['phone'] ?? $data['phone_number'] ?? ''));
$password = (string)($data['password'] ?? '');

/* Citizen-specific fields */
$first     = trim((string)($data['first_name'] ?? ''));
$last      = trim((string)($data['last_name'] ?? ''));
$middle    = trim((string)($data['middle_name'] ?? ''));
$birthdate = trim((string)($data['birthdate'] ?? ''));
$sex       = trim((string)($data['sex'] ?? ''));
$age       = (int)($data['age'] ?? 0);
$street    = trim((string)($data['street'] ?? ''));
$barangay  = trim((string)($data['barangay'] ?? ''));
$city      = trim((string)($data['city'] ?? 'Quezon City'));
$province  = trim((string)($data['province'] ?? 'Metro Manila'));
$zipCode   = trim((string)($data['zip_code'] ?? ''));
$validIdUrl= trim((string)($data['valid_id_url'] ?? ''));

/* Officer-specific */
$username  = trim((string)($data['username'] ?? ''));
$badgeId   = trim((string)($data['badge_id'] ?? ''));

if ($role === '') {
    errorResponse('Role is required.');
}
if (!in_array($role, ['regular', 'dispatch', 'field'], true)) {
    errorResponse('Invalid role selected.');
}
if ($emailIn === '' || !filter_var($emailIn, FILTER_VALIDATE_EMAIL)) {
    errorResponse('A valid email address is required.');
}
if ($password === '') {
    errorResponse('Password is required.');
}
if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/[0-9]/', $password)) {
    errorResponse('Password must be at least 8 characters and include one uppercase letter and one number.');
}

$db = getDb();

/* ── Ensure extra columns exist (works on MySQL 5.7+ and 8.0+) ─ */
function addColumnIfMissing(PDO $db, string $table, string $col, string $colDef): void
{
    try {
        $check = $db->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c");
        $check->execute([':t' => $table, ':c' => $col]);
        if ((int)$check->fetchColumn() === 0) {
            $db->exec("ALTER TABLE `{$table}` ADD COLUMN `{$col}` {$colDef}");
        }
    } catch (PDOException) { /* ignore */ }
}

addColumnIfMissing($db, 'users', 'middle_name',  'VARCHAR(100) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'birthdate',    'DATE DEFAULT NULL');
addColumnIfMissing($db, 'users', 'sex',          'VARCHAR(30) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'street',       'VARCHAR(255) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'city',         'VARCHAR(100) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'province',     'VARCHAR(100) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'zip_code',     'VARCHAR(10) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'valid_id_url', 'VARCHAR(512) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'failed_login_attempts',    'INT DEFAULT 0');
addColumnIfMissing($db, 'users', 'locked_until',            'DATETIME DEFAULT NULL');
addColumnIfMissing($db, 'users', 'emergency_contact_name',  'VARCHAR(200) DEFAULT NULL');
addColumnIfMissing($db, 'users', 'emergency_contact_phone', 'VARCHAR(30) DEFAULT NULL');

function fullName(string $first, string $last, string $middle, string $fallback): string
{
    $parts = array_filter([$first, $middle, $last]);
    $name  = trim(implode(' ', $parts));
    return $name !== '' ? $name : $fallback;
}

function sendSignupEmail(string $email, string $name): bool
{
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) return false;
    $subject = 'TRAPICO — Account Created Successfully';
    $body    = "Hello {$name},\n\n"
             . "Your TRAPICO account has been created. You can now sign in using your email address:\n"
             . "  Email: {$email}\n\n"
             . "Please keep your login credentials secure.\n\n"
             . "If you did not create this account, contact support immediately.\n\n"
             . "— TRAPICO System\n"
             . "  Traffic Complaint Information System\n"
             . "  Quezon City, Metro Manila";
    $headers = "From: no-reply@trapico.online\r\nReply-To: no-reply@trapico.online\r\nContent-Type: text/plain; charset=UTF-8\r\nX-Mailer: PHP/" . phpversion();
    return @mail($email, $subject, $body, $headers);
}

$emailNoticeSent = false;

try {
    if ($role === 'regular') {
        /* Validate required citizen fields */
        if ($first === '') errorResponse('First name is required.');
        if ($last === '')  errorResponse('Surname is required.');
        if ($phone === '') errorResponse('Contact number is required.');
        if ($birthdate === '') errorResponse('Birthdate is required.');
        if ($barangay === '') errorResponse('Barangay is required.');
        if ($street === '') errorResponse('Street / house number is required.');
        if ($zipCode === '') errorResponse('ZIP code is required.');

        /* Phone format validation */
        $cleanPhone = preg_replace('/[^0-9+]/', '', $phone);
        if (strlen($cleanPhone) < 10) {
            errorResponse('Please enter a valid Philippine contact number.');
        }

        /* Email uniqueness — citizen rows with an empty barangay are stale partial
           registrations from an older form version; delete and allow re-registration. */
        $emailCheck = $db->prepare(
            'SELECT user_id, role, barangay FROM users WHERE email = :e LIMIT 1'
        );
        $emailCheck->execute([':e' => $emailIn]);
        $existingUser = $emailCheck->fetch(PDO::FETCH_ASSOC);
        if ($existingUser) {
            $exRole     = (string)($existingUser['role'] ?? '');
            $exBarangay = trim((string)($existingUser['barangay'] ?? ''));
            /* Block if: barangay is set (complete account) OR the email belongs to a non-citizen */
            if ($exBarangay !== '' || $exRole !== 'citizen') {
                errorResponse('This email address is already registered. Please sign in or use a different email.');
            }
            /* Remove the stale incomplete citizen record so registration can proceed */
            $db->prepare('DELETE FROM users WHERE user_id = :uid')
               ->execute([':uid' => (int)$existingUser['user_id']]);
        }

        /* Phone uniqueness */
        $phoneCheck = $db->prepare('SELECT 1 FROM users WHERE phone_number = :p AND role = :r LIMIT 1');
        $phoneCheck->execute([':p' => $phone, ':r' => 'citizen']);
        if ($phoneCheck->fetchColumn()) {
            errorResponse('This contact number is already registered with another account.');
        }

        /* Barangay validation — must be one of the 4 covered barangays */
        $allowedBrgys = ['Commonwealth', 'Batasan Hills', 'Central', 'Sto. Cristo'];
        if (!in_array($barangay, $allowedBrgys, true)) {
            errorResponse('The selected barangay is not covered by TRAPICO. Covered barangays: ' . implode(', ', $allowedBrgys));
        }

        /* Age validation */
        if ($birthdate !== '') {
            $birth = new DateTime($birthdate);
            $today = new DateTime();
            $ageCalc = (int)$today->diff($birth)->y;
            if ($ageCalc < 13) {
                errorResponse('You must be at least 13 years old to create a TRAPICO account.');
            }
            $age = $ageCalc;
        }

        /* Auto-generate a unique username from email */
        $baseUsername = strtolower(preg_replace('/[^a-zA-Z0-9_]/', '', explode('@', $emailIn)[0]));
        if ($baseUsername === '') $baseUsername = 'citizen' . time();
        $finalUsername = $baseUsername;
        $suffix = 1;
        while (true) {
            $uCheck = $db->prepare('SELECT 1 FROM users WHERE username = :u LIMIT 1');
            $uCheck->execute([':u' => $finalUsername]);
            if (!$uCheck->fetchColumn()) break;
            $finalUsername = $baseUsername . $suffix++;
        }

        $name   = fullName($first, $last, $middle, $finalUsername);
        $stmtCols = 'username, email, password_hash, full_name, phone_number, barangay, role,
                      middle_name, birthdate, sex, street, city, province, zip_code, valid_id_url';
        $stmt = $db->prepare(
            "INSERT INTO users ({$stmtCols})
             VALUES (:username, :email, :hash, :name, :phone, :barangay, 'citizen',
                     :midname, :birthdate, :sex, :street, :city, :province, :zip, :valid_id)"
        );
        $stmt->execute([
            ':username'  => $finalUsername,
            ':email'     => $emailIn,
            ':hash'      => hashPassword($password),
            ':name'      => $name,
            ':phone'     => $phone,
            ':barangay'  => $barangay,
            ':midname'   => $middle,
            ':birthdate' => $birthdate,
            ':sex'       => $sex,
            ':street'    => $street,
            ':city'      => $city,
            ':province'  => $province,
            ':zip'       => $zipCode,
            ':valid_id'  => $validIdUrl,
        ]);

        $emailNoticeSent = sendSignupEmail($emailIn, $name);

    } elseif ($role === 'dispatch') {
        if ($username === '') errorResponse('Username is required.');
        if ($phone === '')    errorResponse('Phone number is required.');

        /* Email uniqueness */
        $emailCheck = $db->prepare('SELECT 1 FROM users WHERE email = :e LIMIT 1');
        $emailCheck->execute([':e' => $emailIn]);
        if ($emailCheck->fetchColumn()) {
            errorResponse('This email address is already registered.');
        }
        $usernameCheck = $db->prepare("SELECT 1 FROM users WHERE username = :u AND role = 'dispatch_officer' LIMIT 1");
        $usernameCheck->execute([':u' => $username]);
        if ($usernameCheck->fetchColumn()) {
            errorResponse('Username is already registered.');
        }

        $barangay   = trim((string)($data['home_barangay'] ?? $barangay));
        $department = trim((string)($data['department'] ?? 'Traffic Management Division'));
        $stmt = $db->prepare(
            'INSERT INTO users (username, email, password_hash, full_name, phone_number, barangay, role)
             VALUES (:username, :email, :hash, :name, :phone, :barangay, :role_val)'
        );
        $stmt->execute([
            ':username' => $username,
            ':email'    => $emailIn,
            ':hash'     => hashPassword($password),
            ':name'     => fullName($first, $last, '', $username),
            ':phone'    => $phone,
            ':barangay' => $barangay,
            ':role_val' => 'dispatch_officer',
        ]);
        $newUserId = (int)$db->lastInsertId();
        $badge = $badgeId !== '' ? $badgeId : ('DISP-' . date('Y') . '-' . str_pad((string)$newUserId, 4, '0', STR_PAD_LEFT));
        $badgeCheck = $db->prepare('SELECT 1 FROM dispatch_officers WHERE badge_number = :badge LIMIT 1');
        $badgeCheck->execute([':badge' => $badge]);
        if ($badgeCheck->fetchColumn()) {
            $badge = 'DISP-' . date('Y') . '-' . str_pad((string)($newUserId + time()), 4, '0', STR_PAD_LEFT);
        }
        $db->prepare('INSERT INTO dispatch_officers (user_id, badge_number, assigned_barangay, department) VALUES (:uid, :badge, :brgy, :dept)')
           ->execute([':uid' => $newUserId, ':badge' => $badge, ':brgy' => $barangay, ':dept' => $department]);

    } else { /* field */
        if ($username === '') errorResponse('Username is required.');
        if ($phone === '')    errorResponse('Phone number is required.');

        /* Email uniqueness */
        $emailCheck = $db->prepare('SELECT 1 FROM users WHERE email = :e LIMIT 1');
        $emailCheck->execute([':e' => $emailIn]);
        if ($emailCheck->fetchColumn()) {
            errorResponse('This email address is already registered.');
        }

        $barangay    = trim((string)($data['home_barangay'] ?? $barangay));
        $badgeNumber = $badgeId !== '' ? $badgeId : $username;
        $badgeCheck  = $db->prepare('SELECT 1 FROM field_officers WHERE badge_number = :badge LIMIT 1');
        $badgeCheck->execute([':badge' => $badgeNumber]);
        if ($badgeCheck->fetchColumn()) {
            errorResponse('Badge ID is already registered.');
        }
        $stmt = $db->prepare(
            'INSERT INTO users (username, email, password_hash, full_name, phone_number, barangay, role)
             VALUES (:username, :email, :hash, :name, :phone, :barangay, :role_val)'
        );
        $stmt->execute([
            ':username' => $username,
            ':email'    => $emailIn,
            ':hash'     => hashPassword($password),
            ':name'     => fullName($first, $last, '', $username),
            ':phone'    => $phone,
            ':barangay' => $barangay,
            ':role_val' => 'field_officer',
        ]);
        $newUserId = (int)$db->lastInsertId();
        $db->prepare('INSERT INTO field_officers (user_id, badge_number, assigned_barangay, is_available) VALUES (:uid, :badge, :brgy, :avail)')
           ->execute([':uid' => $newUserId, ':badge' => $badgeNumber, ':brgy' => $barangay, ':avail' => 0]);
    }
} catch (PDOException $e) {
    $msg = $e->getMessage();
    if (strpos($msg, 'Duplicate entry') !== false && strpos($msg, 'email') !== false) {
        errorResponse('This email address is already registered. Please use a different email.');
    }
    if (strpos($msg, 'Duplicate entry') !== false && strpos($msg, 'phone') !== false) {
        errorResponse('This contact number is already registered. Please use a different number.');
    }
    errorResponse("Registration failed: {$msg}", 500);
}

successResponse([
    'message'           => 'Account created successfully. A confirmation has been sent to your email.',
    'email_notice_sent' => $emailNoticeSent,
]);
