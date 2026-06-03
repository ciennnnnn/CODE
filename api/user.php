<?php
require_once __DIR__ . '/init.php';

$data        = getJsonPayload();
$action      = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'profile'));
$user        = requireLogin();
$db          = getDb();

/* Ensure extended profile columns exist for all environments */
foreach ([
    'middle_name'             => "VARCHAR(100) DEFAULT NULL",
    'birthdate'               => "DATE DEFAULT NULL",
    'sex'                     => "VARCHAR(30) DEFAULT NULL",
    'street'                  => "VARCHAR(255) DEFAULT NULL",
    'city'                    => "VARCHAR(100) DEFAULT NULL",
    'province'                => "VARCHAR(100) DEFAULT NULL",
    'zip_code'                => "VARCHAR(10) DEFAULT NULL",
    'valid_id_url'            => "VARCHAR(512) DEFAULT NULL",
    'emergency_contact_name'  => "VARCHAR(200) DEFAULT NULL",
    'emergency_contact_phone' => "VARCHAR(30) DEFAULT NULL",
] as $_col => $_def) {
    try {
        $_chk = $db->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c');
        $_chk->execute([':t' => 'users', ':c' => $_col]);
        if ((int)$_chk->fetchColumn() === 0) {
            $db->exec("ALTER TABLE `users` ADD COLUMN `{$_col}` {$_def}");
        }
    } catch (PDOException $e) { /* non-fatal */ }
}
$currentRole = $user['role'] ?? '';
$currentId   = (int)($user['officer_id'] ?? $user['id'] ?? 0); // extension PK (dispatch_id / officer_id); falls back to user_id for regular
$currentUid  = (int)($user['user_id'] ?? $currentId);  // always users.user_id

if ($action === 'profile') {
    $profile = [
        'role'                => $currentRole,
        'id'                  => $currentId,    /* extension PK (dispatch_id / officer_id) */
        'user_id'             => $currentUid,   /* always users.user_id — used for chat sender matching */
        'name'                => $user['name'] ?? '',
        'email'               => $user['email'] ?? '',
        'profile_picture_url' => $user['profile_picture_url'] ?? '',
    ];

    if ($currentRole === 'regular') {
        $stmt = $db->prepare(
            'SELECT username, full_name AS name, email, phone_number, barangay AS home_barangay,
                    profile_picture_url, middle_name, birthdate, sex, street, city, province,
                    zip_code, valid_id_url, emergency_contact_name, emergency_contact_phone
             FROM users WHERE user_id = :uid'
        );
        $stmt->execute([':uid' => $currentUid]);
        $row = $stmt->fetch();
        if ($row) {
            $profile['username']                = $row['username'];
            $profile['name']                    = $row['name'];
            $profile['email']                   = $row['email'];
            $profile['phone']                   = $row['phone_number'];
            $profile['home_barangay']           = $row['home_barangay'];
            $profile['profile_picture_url']     = $row['profile_picture_url'];
            $profile['middle_name']             = $row['middle_name'] ?? '';
            $profile['birthdate']               = $row['birthdate'] ?? '';
            $profile['sex']                     = $row['sex'] ?? '';
            $profile['street']                  = $row['street'] ?? '';
            $profile['city']                    = $row['city'] ?? 'Quezon City';
            $profile['province']                = $row['province'] ?? 'Metro Manila';
            $profile['zip_code']                = $row['zip_code'] ?? '';
            $profile['valid_id_url']            = $row['valid_id_url'] ?? '';
            $profile['emergency_contact_name']  = $row['emergency_contact_name'] ?? '';
            $profile['emergency_contact_phone'] = $row['emergency_contact_phone'] ?? '';
        }

    } elseif ($currentRole === 'dispatch') {
        $stmt = $db->prepare(
            'SELECT u.username, u.full_name AS name, u.email, u.profile_picture_url,
                    d.badge_number, d.assigned_barangay AS home_barangay
             FROM users u
             LEFT JOIN dispatch_officers d ON d.user_id = u.user_id
             WHERE u.user_id = :uid'
        );
        $stmt->execute([':uid' => $currentUid]);
        $row = $stmt->fetch();
        if ($row) {
            $profile['username']      = $row['username'] ?? '';
            $profile['name']          = $row['name'] ?? '';
            $profile['email']         = $row['email'] ?? '';
            $profile['badge_number']  = $row['badge_number'] ?? '';
            $profile['home_barangay'] = $row['home_barangay'] ?? '';
            $profile['profile_picture_url'] = $row['profile_picture_url'] ?? '';
        }

    } elseif ($currentRole === 'field') {
        $stmt = $db->prepare(
            'SELECT u.username, u.full_name AS name, u.email, u.phone_number AS phone,
                u.profile_picture_url,
                f.assigned_barangay AS home_barangay,
                f.badge_number, f.officer_id
             FROM users u
             LEFT JOIN field_officers f ON f.user_id = u.user_id
             WHERE u.user_id = :uid'
        );
        $stmt->execute([':uid' => $currentUid]);
        $row = $stmt->fetch();
        if ($row) {
            $profile['username']      = $row['username'] ?? '';
            $profile['name']          = $row['name'] ?? '';
            $profile['email']         = $row['email'] ?? '';
            $profile['phone']         = $row['phone'] ?? '';
            $profile['home_barangay'] = $row['home_barangay'] ?? '';
            $profile['badge_number']  = $row['badge_number'] ?? '';
            $profile['officer_id']    = $row['officer_id'] ?? $currentId;
            $profile['profile_picture_url'] = $row['profile_picture_url'] ?? '';
        }
    }

    successResponse(['user' => $profile]);
}

if ($action === 'updateProfilePicture') {
    $profilePictureUrl = trim((string)($data['profilePictureUrl'] ?? ''));
    if ($profilePictureUrl === '') {
        errorResponse('Profile picture URL is required.');
    }

    $stmt = $db->prepare('UPDATE users SET profile_picture_url = :url WHERE user_id = :uid');
    $stmt->execute([':url' => $profilePictureUrl, ':uid' => $currentUid]);

    $_SESSION['trapico_user']['profile_picture_url'] = $profilePictureUrl;
    if (isset($_SESSION['trapico_user_by_role'][$currentRole])) {
        $_SESSION['trapico_user_by_role'][$currentRole]['profile_picture_url'] = $profilePictureUrl;
    }

    successResponse(['message' => 'Profile picture updated successfully.', 'profile_picture_url' => $profilePictureUrl]);
}

if ($action === 'updateProfile') {
    $name  = trim((string)($data['name'] ?? ''));
    $email = trim((string)($data['email'] ?? ''));
    $phone = trim((string)($data['phone'] ?? ''));
    $brgy  = trim((string)($data['brgy'] ?? ''));

    if ($name === '' || $email === '') {
        errorResponse('Name and email are required.');
    }

    if ($currentRole === 'regular') {
        if ($phone === '' || $brgy === '') {
            errorResponse('Phone and barangay are required for civilian profile updates.');
        }
        $middleName    = trim((string)($data['middle_name'] ?? ''));
        $birthdate     = trim((string)($data['birthdate'] ?? ''));
        $sex           = trim((string)($data['sex'] ?? ''));
        $street        = trim((string)($data['street'] ?? ''));
        $province      = trim((string)($data['province'] ?? ''));
        $zipCode       = trim((string)($data['zip_code'] ?? ''));
        $emergencyName  = trim((string)($data['emergency_name'] ?? ''));
        $emergencyPhone = trim((string)($data['emergency_phone'] ?? ''));
        $validIdUrl     = trim((string)($data['valid_id_url'] ?? ''));
        $stmt = $db->prepare(
            'UPDATE users SET full_name = :name, email = :email, phone_number = :phone, barangay = :brgy,
             middle_name = :midname, birthdate = :bdate, sex = :sex, street = :street,
             province = :province, zip_code = :zip,
             emergency_contact_name = :ename, emergency_contact_phone = :ephone
             ' . ($validIdUrl !== '' ? ', valid_id_url = :valid_id' : '') . '
             WHERE user_id = :uid'
        );
        $params = [
            ':name'    => $name,    ':email'   => $email,   ':phone'    => $phone,    ':brgy'  => $brgy,
            ':midname' => $middleName, ':bdate' => ($birthdate !== '' ? $birthdate : null),
            ':sex'     => $sex,     ':street'  => $street,  ':province' => $province, ':zip'   => $zipCode,
            ':ename'   => $emergencyName, ':ephone' => $emergencyPhone, ':uid' => $currentUid,
        ];
        if ($validIdUrl !== '') $params[':valid_id'] = $validIdUrl;
        $stmt->execute($params);

    } elseif ($currentRole === 'dispatch') {
        $stmt = $db->prepare('UPDATE users SET full_name = :name, email = :email WHERE user_id = :uid');
        $stmt->execute([':name' => $name, ':email' => $email, ':uid' => $currentUid]);

    } elseif ($currentRole === 'field') {
        if ($phone === '') {
            errorResponse('Phone is required for field officer profile updates.');
        }
        $stmt = $db->prepare('UPDATE users SET full_name = :name, email = :email, phone_number = :phone WHERE user_id = :uid');
        $stmt->execute([':name' => $name, ':email' => $email, ':phone' => $phone, ':uid' => $currentUid]);
        if ($brgy !== '') {
            $db->prepare('UPDATE field_officers SET assigned_barangay = :brgy WHERE officer_id = :id')
               ->execute([':brgy' => $brgy, ':id' => $currentId]);
        }

    } else {
        errorResponse('Profile updates are not supported for this role.', 403);
    }

    $_SESSION['trapico_user']['name']  = $name;
    $_SESSION['trapico_user']['email'] = $email;
    if (isset($_SESSION['trapico_user_by_role'][$currentRole])) {
        $_SESSION['trapico_user_by_role'][$currentRole]['name']  = $name;
        $_SESSION['trapico_user_by_role'][$currentRole]['email'] = $email;
    }
    successResponse(['message' => 'Profile updated successfully.', 'user' => $_SESSION['trapico_user']]);
}

if ($action === 'changePassword') {
    $currentPassword = trim((string)($data['currentPassword'] ?? ''));
    $newPassword     = trim((string)($data['newPassword'] ?? ''));

    if ($currentPassword === '' || $newPassword === '') {
        errorResponse('Current and new passwords are required.');
    }
    if (strlen($newPassword) < 8) {
        errorResponse('New password must be at least 8 characters.');
    }

    $stmt = $db->prepare('SELECT password_hash FROM users WHERE user_id = :uid');
    $stmt->execute([':uid' => $currentUid]);
    $stored = $stmt->fetchColumn();

    if (!verifyPassword($currentPassword, $stored)) {
        errorResponse('Current password is incorrect.');
    }

    $hash = hashPassword($newPassword);
    $db->prepare('UPDATE users SET password_hash = :hash WHERE user_id = :uid')
       ->execute([':hash' => $hash, ':uid' => $currentUid]);

    successResponse(['message' => 'Password changed successfully.']);
}

if ($action === 'updateEmergencyContact') {
    if ($currentRole !== 'regular') {
        errorResponse('Only regular users can update emergency contact.', 403);
    }
    $ename  = trim((string)($data['emergency_name'] ?? ''));
    $ephone = trim((string)($data['emergency_phone'] ?? ''));
    $db->prepare('UPDATE users SET emergency_contact_name = :ename, emergency_contact_phone = :ephone WHERE user_id = :uid')
       ->execute([':ename' => $ename, ':ephone' => $ephone, ':uid' => $currentUid]);
    successResponse(['message' => 'Emergency contact updated.']);
}

errorResponse('Unknown action.');
