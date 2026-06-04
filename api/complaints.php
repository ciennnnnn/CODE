<?php
require_once __DIR__ . '/helpers.php';

$data   = getJsonPayload();
$action = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'list'));
$user   = requireLogin();
$db     = getDb();

function getBarangayCoordinates(string $barangay): array
{
    $lookup = [
        'Commonwealth' => ['lat' => 14.6760, 'lng' => 121.0437],
        'Batasan Hills' => ['lat' => 14.6915, 'lng' => 121.0507],
        'Central'       => ['lat' => 14.6390, 'lng' => 121.0100],
        'Sto. Cristo'   => ['lat' => 14.6280, 'lng' => 120.9872],
    ];
    return $lookup[$barangay] ?? ['lat' => 14.6760, 'lng' => 121.0437];
}

if ($action === 'list') {
    if ($user['role'] === 'regular') {
        $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);
        $stmt = $db->prepare(
            'SELECT tracking_id AS id, category AS cat, asset_town AS brgy, priority,
                    status, submitted_at AS date, is_anonymous AS anon,
                    description, address, latitude AS lat, longitude AS lng
             FROM complaints
             WHERE user_id = :uid
             ORDER BY submitted_at DESC'
        );
        $stmt->execute([':uid' => $userId]);
        successResponse(['complaints' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }
    errorResponse('Only regular users may query their own complaints.', 403);
}

if ($action === 'timeline') {
    $id = trim((string)($_REQUEST['id'] ?? $data['id'] ?? ''));
    if ($id === '') {
        errorResponse('Complaint ID is required.');
    }
    $stmt = $db->prepare(
        'SELECT sh.status, sh.notes AS remarks, sh.changed_at AS time
         FROM status_history sh
         JOIN complaints c ON c.complaint_id = sh.complaint_id
         WHERE c.tracking_id = :id
         ORDER BY sh.changed_at ASC'
    );
    $stmt->execute([':id' => $id]);
    successResponse(['timeline' => $stmt->fetchAll()]);
}

if ($action === 'submit') {
    // Move all variable declarations outside try-catch so they are always defined
    $category    = trim((string)($data['category'] ?? ''));
    $barangay    = trim((string)($data['barangay'] ?? ''));
    $address     = trim((string)($data['address'] ?? ''));
    $date        = trim((string)($data['date'] ?? ''));
    $time        = trim((string)($data['time'] ?? ''));
    $description = trim((string)($data['description'] ?? ''));
    $priority    = trim((string)($data['priority'] ?? 'medium'));
    $anonymous   = isset($data['anonymous']) ? boolval($data['anonymous']) : false;
    $media       = $data['media'] ?? null;
    $pinnedLat = isset($data['lat']) && is_numeric($data['lat']) ? (float)$data['lat'] : null;
    $pinnedLng = isset($data['lng']) && is_numeric($data['lng']) ? (float)$data['lng'] : null;
    $fallback  = getBarangayCoordinates($barangay);

    try {
        if ($user['role'] !== 'regular') {
            errorResponse('Only regular users can submit complaints.', 403);
        }

        if ($category === '') {
            errorResponse('Category is required.');
        }
        if ($barangay === '') {
            errorResponse('Barangay is required.');
        }
        if ($address === '') {
            errorResponse('Address is required.');
        }
        if ($date === '') {
            errorResponse('Date is required.');
        }
        if ($time === '') {
            errorResponse('Time is required.');
        }

        /* Date validation — client sends local time; utc_offset (minutes east of UTC)
           converts it to actual UTC before comparing with the server clock.
           Example: Philippines (UTC+8) sends 14:00 local + utc_offset=480 → 06:00 UTC. */
        $utcOffset         = (int)($data['utc_offset'] ?? 0);
        $nowTimestamp      = time();
        $rawTs             = ($date !== '') ? strtotime($date . ' ' . ($time ?: '00:00')) : false;
        $incidentTimestamp = ($rawTs !== false) ? ($rawTs - $utcOffset * 60) : false;
        if ($incidentTimestamp === false || $incidentTimestamp > $nowTimestamp + 300) {
            errorResponse('The incident date and time cannot be in the future.');
        }
        $sevenDaysAgo = $nowTimestamp - (7 * 24 * 3600);
        if ($incidentTimestamp < $sevenDaysAgo) {
            errorResponse('Incidents can only be reported within 7 days of occurrence. Please contact the Barangay office for older incidents.');
        }
        if (strlen($description) < 50) {
            errorResponse('Description must be at least 50 characters.');
        }
        if (!is_array($media) || count($media) === 0) {
            errorResponse('At least one evidence file is required before submitting a complaint.');
        }
        if (count($media) > 3) {
            errorResponse('You can upload up to 3 evidence files only.');
        }

        $coords     = ['lat' => $pinnedLat ?? $fallback['lat'], 'lng' => $pinnedLng ?? $fallback['lng']];
        $trackingId = buildTrackingNumber($db);
        $dateField  = date('Y-m-d H:i:s', strtotime($date . ' ' . $time));

        $firstMedia = $media[0] ?? null;
        $capturedAt = trim((string)($firstMedia['captured_at'] ?? ''));
        if ($capturedAt !== '') {
            $capturedTs = strtotime($capturedAt);
            if ($capturedTs !== false) {
                $dateField = date('Y-m-d H:i:s', $capturedTs);
            }
        }
        $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);

        $dupCheckStmt = $db->prepare(
            'SELECT complaint_id FROM complaints
             WHERE user_id = :uid
               AND category = :cat
               AND description = :desc
               AND status NOT IN ("cancelled", "rejected")
               AND submitted_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
        );
        $dupCheckStmt->execute([':uid' => $userId, ':cat' => $category, ':desc' => $description]);
        if ($dupCheckStmt->fetch()) {
            errorResponse('You have already filed a complaint with this exact category and description within the past 7 days.');
        }

        $stmt = $db->prepare(
            'INSERT INTO complaints (user_id, tracking_id, category, asset_town, address, priority, status,
             description, is_anonymous, latitude, longitude, incident_datetime)
             VALUES (:uid, :tracking, :cat, :brgy, :address, :priority, :status, :desc, :anon, :lat, :lng, :datetime)'
        );
        $stmt->execute([
            ':uid'      => $userId,
            ':tracking' => $trackingId,
            ':cat'      => $category,
            ':brgy'     => $barangay,
            ':address'  => $address,
            ':priority' => $priority,
            ':status'   => 'submitted',
            ':desc'     => $description,
            ':anon'     => $anonymous ? 1 : 0,
            ':lat'      => $coords['lat'],
            ':lng'      => $coords['lng'],
            ':datetime' => $dateField,
        ]);
        $newComplaintId = (int)$db->lastInsertId();

        $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
           ->execute([':cid' => $newComplaintId, ':uid' => $userId, ':status' => 'submitted', ':notes' => 'Complaint submitted by user.']);

        if (!empty($media)) {
            $mediaStmt = $db->prepare(
                'INSERT INTO media (complaint_id, file_url, file_type, uploaded_by_role)
                 VALUES (:cid, :url, :type, :role)'
            );
            foreach ($media as $mediaRow) {
                $fileUrl = $mediaRow['url'] ?? $mediaRow['filename'] ?? '';
                if ($fileUrl !== '') {
                    $fileType = strpos((string)($mediaRow['type'] ?? ''), 'video') !== false ? 'video' : 'photo';
                    $mediaStmt->execute([':cid' => $newComplaintId, ':url' => $fileUrl, ':type' => $fileType, ':role' => 'citizen']);
                }
            }
        }

        $duplicates = [];
        $dupStmt = $db->prepare(
            'SELECT complaint_id, tracking_id, latitude AS lat, longitude AS lng, submitted_at
             FROM complaints
             WHERE submitted_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
               AND complaint_id != :cid
               AND status NOT IN ("cancelled")'
        );
        $dupStmt->execute([':cid' => $newComplaintId]);
        while ($row = $dupStmt->fetch()) {
            $distance = getDistanceMeters((float)$coords['lat'], (float)$coords['lng'], (float)$row['lat'], (float)$row['lng']);
            if ($distance <= 100) {
                $duplicates[] = ['tracking_number' => $row['tracking_id'], 'distance_m' => round($distance, 2), 'submitted_at' => $row['submitted_at']];
                $db->prepare(
                    'INSERT IGNORE INTO duplicate_complaint_detection (primary_complaint_id, duplicate_complaint_id, distance_meters, time_difference_hours)
                     VALUES (:primary, :dup, :dist, :hrs)'
                )->execute([':primary' => $newComplaintId, ':dup' => $row['complaint_id'], ':dist' => $distance, ':hrs' => 0]);
            }
        }

        successResponse(['tracking_number' => $trackingId, 'duplicates' => $duplicates]);
    } catch (Throwable $e) {
        error_log('[complaints.php] Submit error: ' . $e->getMessage());
        errorResponse('A server error occurred while submitting your complaint. Please try again later.');
    }
}
if ($action === 'cancel') {
    if ($user['role'] !== 'regular') {
        errorResponse('Only regular users can cancel complaints.', 403);
    }

    $id     = trim((string)($data['id'] ?? ''));
    $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);
    if ($id === '') {
        errorResponse('Complaint ID is required.');
    }

    $stmt = $db->prepare(
        'SELECT complaint_id, status,
                TIMESTAMPDIFF(MINUTE, submitted_at, NOW()) AS minutes_ago
         FROM complaints WHERE tracking_id = :id AND user_id = :uid'
    );
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        errorResponse('Complaint not found.');
    }
    $cancelableStatuses = ['submitted', 'pending', 'unknown'];
    if (!in_array(strtolower((string)($row['status'] ?? '')), $cancelableStatuses, true)) {
        errorResponse('Only submitted complaints may be cancelled.');
    }
    if ((int)$row['minutes_ago'] > 30) {
        errorResponse('The 30-minute cancellation window has passed. Please contact the Barangay office for further assistance.');
    }

    // Capture snapshot before marking deleted
    $snapStmt = $db->prepare('SELECT * FROM complaints WHERE complaint_id = :cid');
    $snapStmt->execute([':cid' => $row['complaint_id']]);
    $snapshot = $snapStmt->fetch() ?: [];

    $db->prepare(
        "UPDATE complaints SET status = 'cancelled', is_soft_deleted = 1, deleted_at = NOW()
         WHERE complaint_id = :cid"
    )->execute([':cid' => $row['complaint_id']]);

    sendToTrash(
        $db, 'complaint',
        (string)$row['complaint_id'], $id, $snapshot,
        $userId, 'citizen',
        'Citizen cancelled within 30-minute window'
    );

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $row['complaint_id'], ':uid' => $userId, ':status' => 'cancelled', ':notes' => 'User cancelled the complaint before verification.']);

    successResponse(['message' => 'Complaint cancelled successfully.']);
}

if ($action === 'rate') {
    if ($user['role'] !== 'regular') {
        errorResponse('Only regular users may rate completed cases.', 403);
    }

    $id      = trim((string)($data['id'] ?? ''));
    $rating  = intval($data['rating'] ?? 0);
    $comment = trim((string)($data['comment'] ?? ''));
    $userId  = (int)($user['user_id'] ?? $user['id'] ?? 0);

    if ($id === '' || $rating < 1 || $rating > 5) {
        errorResponse('A valid complaint ID and rating (1-5) are required.');
    }

    $stmt = $db->prepare('SELECT complaint_id, status FROM complaints WHERE tracking_id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        errorResponse('Complaint not found.');
    }
    if (!in_array($row['status'], ['closed', 'resolved'], true)) {
        errorResponse('Only closed or resolved cases may be rated.');
    }
    $complaintId = (int)$row['complaint_id'];

    $existStmt = $db->prepare('SELECT 1 FROM ratings WHERE complaint_id = :cid AND user_id = :uid');
    $existStmt->execute([':cid' => $complaintId, ':uid' => $userId]);
    if ($existStmt->fetchColumn()) {
        errorResponse('You have already rated this complaint.');
    }

    $offStmt = $db->prepare('SELECT field_officer_id FROM assignments WHERE complaint_id = :cid ORDER BY assigned_at DESC LIMIT 1');
    $offStmt->execute([':cid' => $complaintId]);
    $officerId = $offStmt->fetchColumn() ?: null;

    $db->prepare('INSERT INTO ratings (complaint_id, user_id, field_officer_id, score, comments) VALUES (:cid, :uid, :oid, :score, :comments)')
       ->execute([':cid' => $complaintId, ':uid' => $userId, ':oid' => $officerId, ':score' => $rating, ':comments' => $comment]);

    if ($officerId) {
        $db->prepare(
            'UPDATE field_officers SET average_user_rating = (SELECT AVG(score) FROM ratings WHERE field_officer_id = :oid) WHERE officer_id = :oid'
        )->execute([':oid' => $officerId]);
    }

    successResponse(['message' => 'Thank you for your rating.']);
}

errorResponse('Unknown action.');
