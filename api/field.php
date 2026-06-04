<?php
require_once __DIR__ . '/helpers.php';

$data       = getJsonPayload();
$action     = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'assigned'));
$user       = requireRole('field');
$db         = getDb();
$officerId  = (int)($user['officer_id'] ?? 0);
$officerUid = (int)($user['user_id'] ?? 0);

if ($action === 'assigned') {
    $stmt = $db->prepare(
        'SELECT a.assignment_id, c.complaint_id, c.tracking_id AS id, a.response_deadline AS deadline,
                a.has_checked_in AS checked_in, a.assignment_status,
                c.dispatch_id AS dispatch_id,
                doff.user_id AS dispatch_user_id,
                du.full_name AS dispatch_name,
                c.category AS cat, c.asset_town AS brgy, c.priority, c.status,
                c.submitted_at AS date, c.description AS `desc`,
                c.latitude AS lat, c.longitude AS lng, c.is_anonymous AS anon,
                u.full_name AS reporter
         FROM assignments a
         JOIN complaints c ON c.complaint_id = a.complaint_id
         LEFT JOIN users u ON u.user_id = c.user_id
         LEFT JOIN dispatch_officers doff ON doff.dispatch_id = c.dispatch_id
         LEFT JOIN users du ON du.user_id = doff.user_id
         WHERE a.field_officer_id = :oid AND a.assignment_status IN ("pending","in_progress")
         ORDER BY a.assigned_at DESC'
    );
    $stmt->execute([':oid' => $officerId]);
    successResponse(['assignments' => $stmt->fetchAll()]);
}

if ($action === 'updateStatus') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    $newStatus = trim((string)($data['status'] ?? ''));
    $allowedStatuses = ['submitted', 'verified', 'assigned', 'en_route', 'in_progress', 'resolved', 'validated', 'closed'];

    if ($assignmentId <= 0 || $newStatus === '') {
        errorResponse('Assignment ID and status are required.');
    }
    if (!in_array($newStatus, $allowedStatuses, true)) {
        errorResponse('Invalid status selected.');
    }

    $stmt = $db->prepare(
        'SELECT a.assignment_id, a.complaint_id
         FROM assignments a
         WHERE a.assignment_id = :aid AND a.field_officer_id = :oid'
    );
    $stmt->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    $row = $stmt->fetch();
    if (!$row) {
        errorResponse('Assignment not found.');
    }

    $assignmentStatus = 'pending';
    if ($newStatus === 'en_route' || $newStatus === 'in_progress') {
        $assignmentStatus = 'in_progress';
    } elseif ($newStatus === 'resolved' || $newStatus === 'validated' || $newStatus === 'closed') {
        $assignmentStatus = 'completed';
    }

     $db->prepare('UPDATE complaints SET status = :status WHERE complaint_id = :cid')
         ->execute([':status' => $newStatus, ':cid' => $row['complaint_id']]);

    if ($assignmentStatus === 'completed') {
          $db->prepare('UPDATE assignments SET assignment_status = :status, completed_at = NOW() WHERE assignment_id = :aid')
              ->execute([':status' => $assignmentStatus, ':aid' => $assignmentId]);
          $db->prepare("UPDATE field_officers SET is_available = 1 WHERE officer_id = :oid")->execute([':oid' => $officerId]);
    } else {
        $db->prepare('UPDATE assignments SET assignment_status = :status WHERE assignment_id = :aid')
           ->execute([':status' => $assignmentStatus, ':aid' => $assignmentId]);
        if ($assignmentStatus === 'in_progress') {
            $db->prepare("UPDATE field_officers SET is_available = 0 WHERE officer_id = :oid")->execute([':oid' => $officerId]);
        }
    }

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([
           ':cid' => $row['complaint_id'],
           ':uid' => $officerUid,
           ':status' => $newStatus,
           ':notes' => 'Field officer updated complaint status from Field module.',
       ]);

    successResponse(['message' => 'Status updated successfully.']);
}

if ($action === 'checkin') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    $simulate     = isset($data['simulate']) && boolval($data['simulate']);
    if ($assignmentId <= 0) {
        errorResponse('Assignment ID is required.');
    }

    $stmt = $db->prepare(
        'SELECT a.complaint_id, c.tracking_id AS tracking_number,
                c.latitude AS lat, c.longitude AS lng
         FROM assignments a
         JOIN complaints c ON c.complaint_id = a.complaint_id
         WHERE a.assignment_id = :aid AND a.field_officer_id = :oid'
    );
    $stmt->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    $row = $stmt->fetch();
    if (!$row) {
        errorResponse('Assignment not found.');
    }

    if (!$simulate) {
        if (!isset($data['lat']) || !isset($data['lng'])) {
            errorResponse('GPS coordinates are required for check-in.');
        }
        $distance = getDistanceMeters((float)$row['lat'], (float)$row['lng'], floatval($data['lat']), floatval($data['lng']));
        if ($distance > 150) {
            errorResponse('You are not within the 150m geofence. Move closer to the incident site and try again.');
        }
    }

    $chkLat = $simulate ? null : floatval($data['lat']);
    $chkLng = $simulate ? null : floatval($data['lng']);

    $db->prepare(
        'UPDATE assignments SET has_checked_in = 1, arrived_at = NOW(), assignment_status = :status,
         checkin_latitude = :lat, checkin_longitude = :lng WHERE assignment_id = :aid'
    )->execute([':status' => 'in_progress', ':lat' => $chkLat, ':lng' => $chkLng, ':aid' => $assignmentId]);

    if (!$simulate && $chkLat !== null) {
        $db->prepare(
            "UPDATE field_officers SET current_latitude = :lat, current_longitude = :lng, gps_last_updated = NOW(), is_available = 0 WHERE officer_id = :oid"
        )->execute([':lat' => $chkLat, ':lng' => $chkLng, ':oid' => $officerId]);
    } else {
        $db->prepare("UPDATE field_officers SET is_available = 0 WHERE officer_id = :oid")
           ->execute([':oid' => $officerId]);
    }

     $db->prepare("UPDATE complaints SET status = 'in_progress' WHERE complaint_id = :cid")
         ->execute([':cid' => $row['complaint_id']]);

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $row['complaint_id'], ':uid' => $officerUid, ':status' => 'in_progress', ':notes' => 'Field officer checked in within the geofence.']);

    successResponse(['message' => 'Check-in confirmed. Status updated to In Progress.']);
}

if ($action === 'submitResolution') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    $method       = trim((string)($data['method'] ?? ''));
    $desc         = trim((string)($data['description'] ?? ''));
    $equipment    = trim((string)($data['equipment'] ?? ''));
    $followup     = trim((string)($data['followup'] ?? ''));
    $beforePhoto  = trim((string)($data['before_photo_url'] ?? ''));
    $afterPhoto   = trim((string)($data['after_photo_url'] ?? ''));

    if ($assignmentId <= 0 || $method === '' || $desc === '') {
        errorResponse('Assignment ID, resolution method, and description are required.');
    }

    $stmt = $db->prepare(
        'SELECT a.complaint_id, c.tracking_id AS tracking_number
         FROM assignments a
         JOIN complaints c ON c.complaint_id = a.complaint_id
         WHERE a.assignment_id = :aid AND a.field_officer_id = :oid'
    );
    $stmt->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    $row = $stmt->fetch();
    if (!$row) {
        errorResponse('Active assignment not found.');
    }
    $complaintId = (int)$row['complaint_id'];

    $resolutionBody = "Method: {$method}\n\nDescription: {$desc}";
    if ($equipment !== '') {
        $resolutionBody .= "\n\nEquipment Used: {$equipment}";
    }
    if ($followup !== '') {
        $resolutionBody .= "\n\nFollow-Up Recommendations: {$followup}";
    }

    $db->prepare(
        'INSERT INTO resolution_reports (complaint_id, assignment_id, officer_id, resolution_description,
         before_photo_url, after_photo_url, submitted_at, dispatch_approval_status)
         VALUES (:cid, :aid, :oid, :desc, :before, :after, NOW(), :status)'
    )->execute([
        ':cid'    => $complaintId,
        ':aid'    => $assignmentId,
        ':oid'    => $officerId,
        ':desc'   => $resolutionBody,
        ':before' => $beforePhoto,
        ':after'  => $afterPhoto,
        ':status' => 'pending',
    ]);

     $db->prepare("UPDATE complaints SET status = 'resolved' WHERE complaint_id = :cid")
         ->execute([':cid' => $complaintId]);

     $db->prepare("UPDATE assignments SET assignment_status = 'completed' WHERE assignment_id = :aid")
         ->execute([':aid' => $assignmentId]);

     $db->prepare("UPDATE field_officers SET is_available = 1 WHERE officer_id = :oid")->execute([':oid' => $officerId]);

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $complaintId, ':uid' => $officerUid, ':status' => 'resolved', ':notes' => 'Field officer submitted resolution report.']);

    successResponse(['message' => 'Resolution submitted successfully.']);
}

if ($action === 'updateGps') {
    $lat    = isset($data['lat']) ? floatval($data['lat']) : null;
    $lng    = isset($data['lng']) ? floatval($data['lng']) : null;
    $status = trim((string)($data['status'] ?? ''));

    if ($lat === null || $lng === null) {
        errorResponse('GPS coordinates (lat, lng) are required.');
    }

    $validStatuses = ['available', 'busy', 'offline'];
    $params = [':lat' => $lat, ':lng' => $lng, ':oid' => $officerId];

    if ($status !== '' && in_array($status, $validStatuses, true)) {
        $isAvail = ($status === 'available') ? 1 : 0;
        $db->prepare(
            'UPDATE field_officers SET current_latitude = :lat, current_longitude = :lng, gps_last_updated = NOW(), is_available = :avail WHERE officer_id = :oid'
        )->execute(array_merge($params, [':avail' => $isAvail]));
    } else {
        $db->prepare(
            'UPDATE field_officers SET current_latitude = :lat, current_longitude = :lng, gps_last_updated = NOW() WHERE officer_id = :oid'
        )->execute($params);
    }

    successResponse(['message' => 'GPS position updated.']);
}

if ($action === 'history') {
    $stmt = $db->prepare(
        'SELECT c.tracking_id AS id, c.category AS cat, c.asset_town AS brgy,
                c.priority, c.status, c.submitted_at AS date,
                r.score AS rating
         FROM complaints c
         JOIN assignments a ON a.complaint_id = c.complaint_id
         LEFT JOIN ratings r ON r.complaint_id = c.complaint_id AND r.field_officer_id = a.field_officer_id
         WHERE a.field_officer_id = :oid AND c.status IN ("resolved","closed","cancelled")
         ORDER BY c.submitted_at DESC'
    );
    $stmt->execute([':oid' => $officerId]);
    successResponse(['history' => $stmt->fetchAll()]);
}

if ($action === 'performance') {
    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid');
    $stmt->execute([':oid' => $officerId]);
    $totalAssignments = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status = "completed"');
    $stmt->execute([':oid' => $officerId]);
    $resolved = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status = "failed"');
    $stmt->execute([':oid' => $officerId]);
    $failed = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status = "reassigned"');
    $stmt->execute([':oid' => $officerId]);
    $reassigned = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status IN ("pending","in_progress")');
    $stmt->execute([':oid' => $officerId]);
    $active = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND arrived_at IS NOT NULL');
    $stmt->execute([':oid' => $officerId]);
    $arrivedCount = (int)$stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND arrived_at IS NOT NULL AND arrived_at <= response_deadline');
    $stmt->execute([':oid' => $officerId]);
    $onTimeArrivals = (int)$stmt->fetchColumn();

    $stmt = $db->prepare(
        'SELECT AVG(TIMESTAMPDIFF(MINUTE, assigned_at, arrived_at)) AS avg_minutes,
                MIN(TIMESTAMPDIFF(MINUTE, assigned_at, arrived_at)) AS fastest_minutes,
                MAX(TIMESTAMPDIFF(MINUTE, assigned_at, arrived_at)) AS slowest_minutes
         FROM assignments
         WHERE field_officer_id = :oid AND arrived_at IS NOT NULL'
    );
    $stmt->execute([':oid' => $officerId]);
    $arrivalMetrics = $stmt->fetch() ?: [];

    $stmt = $db->prepare('SELECT AVG(score) FROM ratings WHERE field_officer_id = :oid');
    $stmt->execute([':oid' => $officerId]);
    $avgRating = $stmt->fetchColumn();

        $stmt = $db->prepare(
                'SELECT COUNT(*)
                 FROM assignments
                 WHERE field_officer_id = :oid
                     AND assignment_status = "completed"
                     AND completed_at >= DATE_FORMAT(NOW(), "%Y-%m-01")'
        );
    $stmt->execute([':oid' => $officerId]);
    $resolvedThisMonth = (int)$stmt->fetchColumn();

    $stmt = $db->prepare(
        'SELECT c.tracking_id AS id, c.category AS cat, r.score AS score,
                COALESCE(r.comments, "") AS comments, r.submitted_at AS submitted_at
         FROM ratings r
         JOIN complaints c ON c.complaint_id = r.complaint_id
         WHERE r.field_officer_id = :oid
         ORDER BY r.submitted_at DESC
         LIMIT 8'
    );
    $stmt->execute([':oid' => $officerId]);
    $recentratings = $stmt->fetchAll();

    // Optionally fetch metrics from users table if you store them there
    // $stmt = $db->prepare('SELECT avg_response_time, average_user_rating FROM users WHERE user_id = :oid');
    // $stmt->execute([':oid' => $officerId]);
    // $metrics = $stmt->fetch();

    $onTimeRate = $arrivedCount > 0 ? round(($onTimeArrivals / $arrivedCount) * 100, 2) : 0;
    $closureRate = $totalAssignments > 0 ? round(($resolved / $totalAssignments) * 100, 2) : 0;
    $avgResponseMins = isset($arrivalMetrics['avg_minutes']) && $arrivalMetrics['avg_minutes'] !== null
        ? round((float)$arrivalMetrics['avg_minutes'], 2)
        : 0;
    $fastestMins = isset($arrivalMetrics['fastest_minutes']) && $arrivalMetrics['fastest_minutes'] !== null
        ? (int)$arrivalMetrics['fastest_minutes']
        : 0;
    $slowestMins = isset($arrivalMetrics['slowest_minutes']) && $arrivalMetrics['slowest_minutes'] !== null
        ? (int)$arrivalMetrics['slowest_minutes']
        : 0;
    $satisfaction = $avgRating !== null && $avgRating !== false ? round((float)$avgRating, 2) : 0.0;
    $failureRate = $totalAssignments > 0 ? round((($failed + $reassigned) / $totalAssignments) * 100, 2) : 0;
    $efficiencyScore = round(max(0, min(100,
        ($closureRate * 0.45) +
        ($onTimeRate * 0.30) +
        (($satisfaction * 20) * 0.20) +
        ((100 - $failureRate) * 0.05)
    )), 2);

    successResponse(['performance' => [
        'total_assignments' => $totalAssignments,
        'resolved'      => $resolved,
        'failed'        => $failed,
        'reassigned'    => $reassigned,
        'resolved_this_month' => $resolvedThisMonth,
        'active'        => $active,
        'on_time_rate'  => $onTimeRate,
        'closure_rate'  => $closureRate,
        'failure_rate'  => $failureRate,
        'efficiency_score' => $efficiencyScore,
        'avg_response_mins' => $avgResponseMins,
        'fastest_mins'  => $fastestMins,
        'slowest_mins'  => $slowestMins,
        'satisfaction'  => $satisfaction,
        'recent_ratings' => $recentratings,
    ]]);
}

/* ── Auto-create field_drafts table ── */
try {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS field_drafts (
            draft_id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            assignment_id  INT UNSIGNED NOT NULL,
            officer_id     INT UNSIGNED NOT NULL,
            method         VARCHAR(255) DEFAULT "",
            equipment      TEXT,
            description    TEXT,
            followup       TEXT,
            before_url     TEXT,
            after_url      TEXT,
            saved_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_asgn_officer (assignment_id, officer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
} catch (Throwable $e) { /* table already exists or DDL lock — safe */ }

if ($action === 'saveDraft') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    if ($assignmentId <= 0) errorResponse('Assignment ID required.');

    $stmt = $db->prepare(
        'SELECT assignment_id FROM assignments WHERE assignment_id = :aid AND field_officer_id = :oid'
    );
    $stmt->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    if (!$stmt->fetch()) errorResponse('Assignment not found.');

    $db->prepare(
        'INSERT INTO field_drafts (assignment_id, officer_id, method, equipment, description, followup, before_url, after_url)
         VALUES (:aid, :oid, :m, :eq, :desc, :fu, :bu, :au)
         ON DUPLICATE KEY UPDATE method=:m2, equipment=:eq2, description=:desc2,
         followup=:fu2, before_url=:bu2, after_url=:au2, saved_at=NOW()'
    )->execute([
        ':aid'  => $assignmentId, ':oid'  => $officerId,
        ':m'    => trim((string)($data['method']           ?? '')),
        ':eq'   => trim((string)($data['equipment']        ?? '')),
        ':desc' => trim((string)($data['description']      ?? '')),
        ':fu'   => trim((string)($data['followup']         ?? '')),
        ':bu'   => trim((string)($data['before_photo_url'] ?? '')),
        ':au'   => trim((string)($data['after_photo_url']  ?? '')),
        ':m2'   => trim((string)($data['method']           ?? '')),
        ':eq2'  => trim((string)($data['equipment']        ?? '')),
        ':desc2'=> trim((string)($data['description']      ?? '')),
        ':fu2'  => trim((string)($data['followup']         ?? '')),
        ':bu2'  => trim((string)($data['before_photo_url'] ?? '')),
        ':au2'  => trim((string)($data['after_photo_url']  ?? '')),
    ]);
    successResponse(['message' => 'Draft saved.']);
}

if ($action === 'getDrafts') {
    $stmt = $db->prepare(
        'SELECT fd.assignment_id, fd.method, fd.equipment, fd.description, fd.followup,
                fd.before_url, fd.after_url, fd.saved_at,
                c.tracking_id AS tracking_id, c.category AS cat
         FROM field_drafts fd
         JOIN assignments a ON a.assignment_id = fd.assignment_id
         JOIN complaints  c ON c.complaint_id  = a.complaint_id
         WHERE fd.officer_id = :oid
         ORDER BY fd.saved_at DESC'
    );
    $stmt->execute([':oid' => $officerId]);
    successResponse(['drafts' => $stmt->fetchAll()]);
}

if ($action === 'deleteDraft') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    if ($assignmentId <= 0) errorResponse('Assignment ID required.');
    $db->prepare('DELETE FROM field_drafts WHERE assignment_id = :aid AND officer_id = :oid')
       ->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    successResponse(['message' => 'Draft deleted.']);
}

if ($action === 'notifications') {
    $lastId = intval($_REQUEST['last_id'] ?? $data['last_id'] ?? 0);
    $stmt = $db->prepare(
        'SELECT a.assignment_id, c.tracking_id AS id, c.category AS cat,
                c.asset_town AS brgy, c.priority, a.assigned_at AS date
         FROM assignments a
         JOIN complaints c ON c.complaint_id = a.complaint_id
         WHERE a.field_officer_id = :oid
           AND a.assignment_id > :last
           AND a.assignment_status IN ("pending","in_progress")
         ORDER BY a.assignment_id ASC'
    );
    $stmt->execute([':oid' => $officerId, ':last' => $lastId]);
    $rows = $stmt->fetchAll();
    $maxId = $rows ? (int)max(array_column($rows, 'assignment_id')) : $lastId;
    successResponse(['notifications' => $rows, 'latest_id' => $maxId]);
}

if ($action === 'contacts') {
    $stmt = $db->prepare(
        'SELECT d.dispatch_id, d.user_id, u.full_name AS name, u.email,
                d.assigned_barangay AS brgy, d.badge_number
         FROM dispatch_officers d
         JOIN users u ON u.user_id = d.user_id
         WHERE u.is_active = 1
         ORDER BY u.full_name ASC'
    );
    $stmt->execute();
    successResponse(['contacts' => $stmt->fetchAll()]);
}

if ($action === 'availableOfficers') {
    $stmt = $db->prepare(
        'SELECT fo.officer_id AS id, u.full_name AS name, fo.badge_number AS code,
                fo.assigned_barangay AS brgy,
                (SELECT COUNT(*) FROM assignments a2
                 WHERE a2.field_officer_id = fo.officer_id
                   AND a2.assignment_status IN ("pending","in_progress")) AS active_count,
                (SELECT COUNT(*) FROM assignments a3
                 WHERE a3.field_officer_id = fo.officer_id
                   AND a3.assignment_status = "completed") AS cases_closed
         FROM field_officers fo
         JOIN users u ON u.user_id = fo.user_id
         WHERE fo.is_available = 1 AND fo.officer_id != :oid AND u.is_active = 1
         ORDER BY u.full_name ASC'
    );
    $stmt->execute([':oid' => $officerId]);
    successResponse(['officers' => $stmt->fetchAll()]);
}

if ($action === 'reassign') {
    $assignmentId = intval($data['assignment_id'] ?? 0);
    $newOfficerId = intval($data['officer_id'] ?? 0);

    if ($assignmentId <= 0 || $newOfficerId <= 0) {
        errorResponse('Assignment ID and new officer are required.');
    }

    $stmt = $db->prepare(
        'SELECT a.assignment_id, a.complaint_id
         FROM assignments a
         WHERE a.assignment_id = :aid AND a.field_officer_id = :oid AND a.assignment_status IN ("pending","in_progress")'
    );
    $stmt->execute([':aid' => $assignmentId, ':oid' => $officerId]);
    $current = $stmt->fetch();
    if (!$current) {
        errorResponse('Assignment not found or cannot be reassigned.');
    }

    $stmt = $db->prepare('SELECT officer_id FROM field_officers WHERE officer_id = :oid AND is_available = 1');
    $stmt->execute([':oid' => $newOfficerId]);
    if (!$stmt->fetch()) {
        errorResponse('Selected officer is not available.');
    }

    $complaintId = (int)$current['complaint_id'];

    $stmt = $db->prepare('SELECT dispatch_id FROM complaints WHERE complaint_id = :cid');
    $stmt->execute([':cid' => $complaintId]);
    $complaint = $stmt->fetch();
    $dispatchId = (int)($complaint['dispatch_id'] ?? 0);

    $db->prepare(
        'UPDATE assignments SET assignment_status = :status, reassigned_to = :new_oid,
         reassignment_reason = :reason, reassignment_at = NOW()
         WHERE assignment_id = :aid'
    )->execute([':status' => 'reassigned', ':new_oid' => $newOfficerId, ':reason' => 'Field officer requested reassignment', ':aid' => $assignmentId]);

    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status IN ("pending","in_progress")'
    );
    $stmt->execute([':oid' => $officerId]);
    if ((int)$stmt->fetchColumn() === 0) {
        $db->prepare("UPDATE field_officers SET is_available = 1 WHERE officer_id = :oid")->execute([':oid' => $officerId]);
    }

    $deadline = date('Y-m-d H:i:s', strtotime('+30 minutes'));
    $db->prepare(
        'INSERT INTO assignments (complaint_id, field_officer_id, dispatch_id, assigned_at, response_deadline, assignment_status, reassignment_reason)
         VALUES (:cid, :officer_id, :did, NOW(), :deadline, :status, :reason)'
    )->execute([
        ':cid'       => $complaintId,
        ':officer_id' => $newOfficerId,
        ':did'       => $dispatchId,
        ':deadline'  => $deadline,
        ':status'    => 'pending',
        ':reason'    => 'Reassigned by field officer',
    ]);

    $db->prepare("UPDATE field_officers SET is_available = 0 WHERE officer_id = :oid")->execute([':oid' => $newOfficerId]);

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $complaintId, ':uid' => $officerUid, ':status' => 'assigned', ':notes' => 'Case reassigned to officer ID ' . $newOfficerId . ' by field officer.']);

    successResponse(['message' => 'Case reassigned successfully.']);
}

errorResponse('Unknown action.');
