<?php
require_once __DIR__ . '/helpers.php';

$data   = getJsonPayload();
$action = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'dashboard'));
$user   = requireRole('dispatch');
$db     = getDb();
$dispatchId  = (int)($user['officer_id'] ?? 0);
$dispatchUid = (int)($user['user_id'] ?? 0);

/* ── Auto-release: mark pending assignments as failed when response_deadline passes ── */
try {
    $db->exec(
        "UPDATE assignments SET assignment_status = 'failed'
         WHERE assignment_status = 'pending'
           AND response_deadline < NOW()"
    );
    $db->exec(
        "UPDATE field_officers SET is_available = 1
         WHERE is_available = 0
           AND officer_id NOT IN (
               SELECT DISTINCT field_officer_id FROM assignments
               WHERE assignment_status IN ('pending','in_progress')
           )"
    );
} catch (PDOException $e) { /* non-fatal */ }

if ($action === 'dashboard') {
    $counts = [];
    $counts['pending']      = (int)$db->query("SELECT COUNT(*) FROM complaints WHERE status = 'submitted'")->fetchColumn();
    $counts['dup_count']    = (int)$db->query("SELECT COUNT(DISTINCT primary_complaint_id) FROM duplicate_complaint_detection")->fetchColumn();
    $counts['active_cases'] = (int)$db->query("SELECT COUNT(*) FROM complaints WHERE status IN ('assigned','in_progress')")->fetchColumn();
    $counts['closed_cases'] = (int)$db->query("SELECT COUNT(*) FROM complaints WHERE status = 'closed'")->fetchColumn();
    successResponse(['counts' => $counts]);
}

if ($action === 'analytics') {
    $monthStart = date('Y-m-01 00:00:00');
    $q = function(string $sql) use ($db, $monthStart) {
        $st = $db->prepare($sql);
        $st->execute([':m' => $monthStart]);
        return (int)$st->fetchColumn();
    };
    $total    = $q("SELECT COUNT(*) FROM complaints WHERE submitted_at >= :m");
    $resolved = $q("SELECT COUNT(*) FROM complaints WHERE status IN ('resolved','closed') AND submitted_at >= :m");
    $rejected = $q("SELECT COUNT(*) FROM complaints WHERE status = 'rejected' AND submitted_at >= :m");
    $rate     = $total > 0 ? round($resolved / $total * 100) : 0;

    $avgSt = $db->prepare("SELECT AVG(TIMESTAMPDIFF(MINUTE, submitted_at, updated_at)) / 60 FROM complaints WHERE status IN ('resolved','closed') AND submitted_at >= :m");
    $avgSt->execute([':m' => $monthStart]);
    $avgHours = round((float)$avgSt->fetchColumn(), 1);

    $catSt = $db->prepare("SELECT category, COUNT(*) AS cnt FROM complaints WHERE submitted_at >= :m GROUP BY category ORDER BY cnt DESC");
    $catSt->execute([':m' => $monthStart]);
    $categories = $catSt->fetchAll(PDO::FETCH_ASSOC);

    $weeklyTrend = [];
    for ($w = 3; $w >= 0; $w--) {
        $wStart = date('Y-m-d H:i:s', strtotime("-{$w} weeks monday this week"));
        $wEnd   = date('Y-m-d H:i:s', strtotime("-{$w} weeks sunday this week 23:59:59"));
        $wSt = $db->prepare("SELECT COUNT(*) FROM complaints WHERE submitted_at BETWEEN :ws AND :we");
        $wSt->execute([':ws' => $wStart, ':we' => $wEnd]);
        $weeklyTrend[] = (int)$wSt->fetchColumn();
    }

    successResponse([
        'total'        => $total,
        'resolved'     => $resolved,
        'rejected'     => $rejected,
        'rate'         => $rate,
        'avg_hours'    => $avgHours ?: 0,
        'categories'   => $categories,
        'weekly_trend' => $weeklyTrend,
    ]);
}

if ($action === 'queue') {
    $stmt = $db->query(
        "SELECT c.tracking_id AS id, c.category AS cat, c.asset_town AS brgy,
                c.priority, c.status, c.submitted_at AS date,
                c.is_anonymous AS anon, c.description,
                c.latitude AS lat, c.longitude AS lng,
                COALESCE(u.username, 'Citizen') AS user,
                CASE WHEN EXISTS (
                    SELECT 1 FROM duplicate_complaint_detection d
                    WHERE d.primary_complaint_id = c.complaint_id
                       OR d.duplicate_complaint_id = c.complaint_id
                ) THEN 1 ELSE 0 END AS duplicate
         FROM complaints c
         LEFT JOIN users u ON u.user_id = c.user_id
         WHERE c.status IN ('submitted','verified','resolved','closed')
         ORDER BY c.submitted_at DESC"
    );
    successResponse(['complaints' => $stmt->fetchAll()]);
}

if ($action === 'updatePriority') {
    $trackingId = trim((string)($data['id'] ?? ''));
    $priority   = strtolower(trim((string)($data['priority'] ?? '')));
    $allowed    = ['low', 'medium', 'high', 'urgent'];

    if ($trackingId === '' || $priority === '') {
        errorResponse('Complaint ID and priority are required.');
    }
    if (!in_array($priority, $allowed, true)) {
        errorResponse('Invalid priority level. Allowed: low, medium, high, urgent.');
    }

    $cStmt = $db->prepare('SELECT complaint_id, status FROM complaints WHERE tracking_id = :id LIMIT 1');
    $cStmt->execute([':id' => $trackingId]);
    $complaint = $cStmt->fetch();
    if (!$complaint) {
        errorResponse('Complaint not found.');
    }

    $complaintId = (int)$complaint['complaint_id'];
    $statusValue = (string)$complaint['status'];

     $db->prepare('UPDATE complaints SET priority = :priority, dispatch_id = :did WHERE complaint_id = :cid')
         ->execute([':priority' => $priority, ':did' => $dispatchId, ':cid' => $complaintId]);

    $db->prepare(
        'INSERT INTO status_history (complaint_id, changed_by, status, notes)
         VALUES (:cid, :uid, :status, :notes)'
    )->execute([
        ':cid' => $complaintId,
        ':uid' => $dispatchUid,
        ':status' => $statusValue,
        ':notes' => 'Priority level updated to ' . strtoupper($priority) . ' by dispatch.',
    ]);

    successResponse([
        'message' => 'Priority updated successfully.',
        'id' => $trackingId,
        'priority' => $priority,
    ]);
}

if ($action === 'officers') {
    $fieldStmt = $db->query(
        "SELECT fo.officer_id AS id, fo.user_id, fo.badge_number AS code, u.full_name AS name,
                fo.assigned_barangay AS brgy,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM assignments a
                        WHERE a.field_officer_id = fo.officer_id
                          AND a.assignment_status IN ('pending','in_progress')
                    ) THEN 'busy'
                    WHEN fo.is_available = 1 THEN 'available'
                    ELSE 'offline'
                END AS status,
                fo.current_latitude AS lat, fo.current_longitude AS lng,
                fo.gps_last_updated,
                (SELECT COUNT(*) FROM assignments a2
                 WHERE a2.field_officer_id = fo.officer_id
                   AND a2.assignment_status = 'completed') AS cases_closed,
                COALESCE((SELECT AVG(r.score) FROM ratings r
                          WHERE r.field_officer_id = fo.officer_id), 0.00) AS rating,
                (SELECT COUNT(*) FROM assignments a2
                 WHERE a2.field_officer_id = fo.officer_id
                   AND a2.assignment_status IN ('pending','in_progress')) AS active_count,
                'field_officer' AS officer_role
         FROM field_officers fo
         JOIN users u ON u.user_id = fo.user_id
         WHERE u.is_active = 1
         ORDER BY fo.officer_id ASC"
    );
    $fieldOfficers = $fieldStmt->fetchAll();

    $dispStmt = $db->query(
        "SELECT do.dispatch_id AS id, do.user_id, do.badge_number AS code, u.full_name AS name,
                do.assigned_barangay AS brgy,
                CASE WHEN do.is_on_duty = 1 THEN 'on_duty' ELSE 'offline' END AS status,
                'dispatch_officer' AS officer_role
         FROM dispatch_officers do
         JOIN users u ON u.user_id = do.user_id
         WHERE u.is_active = 1
         ORDER BY do.dispatch_id ASC"
    );
    $dispatchOfficers = $dispStmt->fetchAll();

    successResponse([
        'officers'         => $fieldOfficers,
        'field_officers'   => $fieldOfficers,
        'dispatch_officers'=> $dispatchOfficers,
        'all_officers'     => array_merge($fieldOfficers, $dispatchOfficers),
    ]);
}

if ($action === 'verifyAssign') {
    $trackingId = trim((string)($data['id'] ?? ''));
    $officerId  = intval($data['officer_id'] ?? 0);
    if ($trackingId === '' || $officerId <= 0) {
        errorResponse('Complaint ID and assigned officer are required.');
    }

    $cStmt = $db->prepare('SELECT complaint_id, status FROM complaints WHERE tracking_id = :id');
    $cStmt->execute([':id' => $trackingId]);
    $complaint = $cStmt->fetch();
    if (!$complaint) {
        errorResponse('Complaint not found.');
    }
    if (!in_array($complaint['status'], ['submitted', 'verified'], true)) {
        errorResponse('Only submitted or verified complaints may be assigned.');
    }
    $complaintId = (int)$complaint['complaint_id'];

     // Block if officer already has an active assignment
    $activeCheck = $db->prepare(
        'SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status IN ("pending","in_progress")'
    );
     $activeCheck->execute([':oid' => $officerId]);
     if ((int)$activeCheck->fetchColumn() > 0) {
          errorResponse('This officer is currently assigned to another complaint. Please select a different officer.');
     }

     $db->prepare('UPDATE complaints SET status = :status, dispatch_id = :did WHERE complaint_id = :cid')
         ->execute([':status' => 'assigned', ':did' => $dispatchId, ':cid' => $complaintId]);

     // Optionally update users table if you want to track status
     // $db->prepare('UPDATE users SET status = "busy" WHERE user_id = :oid')->execute([':oid' => $officerId]);

    $deadline = date('Y-m-d H:i:s', strtotime('+30 minutes'));
    $db->prepare(
        'INSERT INTO assignments (complaint_id, field_officer_id, dispatch_id, assigned_at, response_deadline, assignment_status)
         VALUES (:cid, :officer_id, :did, NOW(), :deadline, :status)'
    )->execute([':cid' => $complaintId, ':officer_id' => $officerId, ':did' => $dispatchId, ':deadline' => $deadline, ':status' => 'pending']);

    $db->prepare(
        'INSERT INTO status_history (complaint_id, changed_by, status, notes)
         VALUES (:cid, :uid, :status, :notes)'
    )->execute([':cid' => $complaintId, ':uid' => $dispatchUid, ':status' => 'assigned', ':notes' => 'Verified and assigned to officer ID ' . $officerId]);

    successResponse(['message' => 'Complaint verified and assigned successfully.']);
}

if ($action === 'reject') {
    $trackingId = trim((string)($data['id'] ?? ''));
    $reason     = trim((string)($data['reason'] ?? ''));
    if ($trackingId === '' || $reason === '') {
        errorResponse('Complaint ID and rejection reason are required.');
    }

    $cStmt = $db->prepare('SELECT complaint_id FROM complaints WHERE tracking_id = :id');
    $cStmt->execute([':id' => $trackingId]);
    $complaintId = (int)$cStmt->fetchColumn();
    if (!$complaintId) {
        errorResponse('Complaint not found.');
    }

    try {
          $db->prepare('UPDATE complaints SET status = :status, rejection_reason = :reason, rejected_by = :did, dispatch_id = :did WHERE complaint_id = :cid')
              ->execute([':status' => 'rejected', ':reason' => $reason, ':did' => $dispatchId, ':cid' => $complaintId]);
    } catch (PDOException $e) {
        // Fallback for older schemas that do not yet include rejection metadata columns.
          $db->prepare('UPDATE complaints SET status = :status, dispatch_id = :did WHERE complaint_id = :cid')
              ->execute([':status' => 'rejected', ':did' => $dispatchId, ':cid' => $complaintId]);
    }

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $complaintId, ':uid' => $dispatchUid, ':status' => 'rejected', ':notes' => $reason]);

    successResponse(['message' => 'Complaint rejected with reason.']);
}

if ($action === 'reassign') {
    $trackingId  = trim((string)($data['id'] ?? ''));
    $newOfficerId = intval($data['officer_id'] ?? 0);
    if ($trackingId === '' || $newOfficerId <= 0) {
        errorResponse('Complaint ID and reassigned officer are required.');
    }

    $cStmt = $db->prepare('SELECT complaint_id FROM complaints WHERE tracking_id = :id');
    $cStmt->execute([':id' => $trackingId]);
    $complaintId = (int)$cStmt->fetchColumn();
    if (!$complaintId) {
        errorResponse('Complaint not found.');
    }

    $stmt = $db->prepare(
        'SELECT assignment_id, field_officer_id FROM assignments
         WHERE complaint_id = :cid AND assignment_status IN ("pending","in_progress","failed")
         ORDER BY assigned_at DESC LIMIT 1'
    );
    $stmt->execute([':cid' => $complaintId]);
    $current = $stmt->fetch();
    if (!$current) {
        errorResponse('No assignment found for this complaint.');
    }

    $db->prepare(
        'UPDATE assignments SET assignment_status = :status, reassigned_to = :new_oid,
         reassignment_reason = :reason, reassignment_at = NOW()
         WHERE assignment_id = :aid'
    )->execute([':status' => 'reassigned', ':new_oid' => $newOfficerId, ':reason' => 'Dispatch reassigned case', ':aid' => $current['assignment_id']]);

    // Check if new officer is already assigned
    $newCheck = $db->prepare(
        'SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status IN ("pending","in_progress")'
    );
    $newCheck->execute([':oid' => $newOfficerId]);
    if ((int)$newCheck->fetchColumn() > 0) {
        errorResponse('The selected officer is currently assigned to another complaint.');
    }

    $deadline = date('Y-m-d H:i:s', strtotime('+30 minutes'));
    $db->prepare(
        'INSERT INTO assignments (complaint_id, field_officer_id, dispatch_id, assigned_at, response_deadline, assignment_status, reassignment_reason)
         VALUES (:cid, :officer_id, :did, NOW(), :deadline, :status, :reason)'
    )->execute([':cid' => $complaintId, ':officer_id' => $newOfficerId, ':did' => $dispatchId, ':deadline' => $deadline, ':status' => 'pending', ':reason' => 'Reassigned after failure to arrive']);

    // Free old officer if they have no remaining active assignments
    $oldOfficerId = (int)$current['field_officer_id'];
    $remainCheck = $db->prepare(
        'SELECT COUNT(*) FROM assignments WHERE field_officer_id = :oid AND assignment_status IN ("pending","in_progress")'
    );
    $remainCheck->execute([':oid' => $oldOfficerId]);
    if ((int)$remainCheck->fetchColumn() === 0) {
          /* Optionally update users table if you want to track status */
          // $db->prepare('UPDATE users SET status = "available" WHERE user_id = :oid')->execute([':oid' => $oldOfficerId]);
    }
    // Optionally update users table if you want to track status
    // $db->prepare('UPDATE users SET status = "busy" WHERE user_id = :oid')->execute([':oid' => $newOfficerId]);

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $complaintId, ':uid' => $dispatchUid, ':status' => 'assigned', ':notes' => 'Case reassigned to officer ID ' . $newOfficerId]);

    successResponse(['message' => 'Case reassigned successfully.']);
}

if ($action === 'activeCases') {
    $stmt = $db->query(
        "SELECT c.tracking_id AS id, c.category AS cat, c.asset_town AS brgy,
                c.priority, c.status, c.submitted_at AS date,
                c.description, c.latitude AS lat, c.longitude AS lng,
                COALESCE(u.full_name, 'Field Officer') AS officer_name,
                fo.badge_number AS officer_badge,
                a.response_deadline, a.assigned_at, a.assignment_status AS asgn_status
         FROM complaints c
         LEFT JOIN assignments a ON a.assignment_id = (
             SELECT a2.assignment_id FROM assignments a2
             WHERE a2.complaint_id = c.complaint_id
             ORDER BY a2.assigned_at DESC LIMIT 1
         )
         LEFT JOIN field_officers fo ON fo.officer_id = a.field_officer_id
         LEFT JOIN users u ON u.user_id = fo.user_id
         WHERE c.status IN ('assigned','in_progress')
         ORDER BY c.submitted_at DESC"
    );
    successResponse(['activeCases' => $stmt->fetchAll()]);
}

if ($action === 'complaintDetail') {
    $trackingId = trim((string)($_REQUEST['id'] ?? $data['id'] ?? ''));
    if ($trackingId === '') {
        errorResponse('Complaint ID is required.');
    }

    $cStmt = $db->prepare(
        "SELECT c.complaint_id, c.tracking_id AS id, c.category AS cat, c.asset_town AS brgy,
                c.priority, c.status, c.submitted_at AS date,
                c.is_anonymous AS anon, c.description,
                c.latitude AS lat, c.longitude AS lng,
            '' AS user
         FROM complaints c
         WHERE c.tracking_id = :id
         LIMIT 1"
    );
    $cStmt->execute([':id' => $trackingId]);
    $complaint = $cStmt->fetch();
    if (!$complaint) {
        errorResponse('Complaint not found.');
    }

    $media = [];

    try {
        $mStmt = $db->prepare(
            'SELECT media_id, file_url, file_type, evidence_stage, uploaded_at
             FROM media
             WHERE complaint_id = :cid
             ORDER BY uploaded_at ASC, media_id ASC'
        );
        $mStmt->execute([':cid' => (int)$complaint['complaint_id']]);
        $media = $mStmt->fetchAll();
    } catch (PDOException $e) {
        $media = [];
    }

    try {
        $rStmt = $db->prepare(
            'SELECT before_photo_url, after_photo_url, submitted_at
             FROM resolution_reports
             WHERE complaint_id = :cid
             ORDER BY submitted_at DESC
             LIMIT 1'
        );
        $rStmt->execute([':cid' => (int)$complaint['complaint_id']]);
        $report = $rStmt->fetch();

        if ($report) {
            $before = trim((string)($report['before_photo_url'] ?? ''));
            $after = trim((string)($report['after_photo_url'] ?? ''));
            $when = (string)($report['submitted_at'] ?? null);

            if ($before !== '') {
                $media[] = [
                    'media_id' => null,
                    'file_url' => $before,
                    'file_type' => 'photo',
                    'evidence_stage' => 'before_proof',
                    'uploaded_at' => $when,
                ];
            }

            if ($after !== '') {
                $media[] = [
                    'media_id' => null,
                    'file_url' => $after,
                    'file_type' => 'photo',
                    'evidence_stage' => 'after_proof',
                    'uploaded_at' => $when,
                ];
            }
        }
    } catch (PDOException $e) {
        // resolution_reports table may be absent in some setups
    }

    if (!empty($media)) {
        $seenByUrl = [];
        $dedupedMedia = [];
        foreach ($media as $row) {
            $urlKey = trim((string)($row['file_url'] ?? ''));
            if ($urlKey === '' || isset($seenByUrl[$urlKey])) {
                continue;
            }
            $seenByUrl[$urlKey] = true;
            $dedupedMedia[] = $row;
        }
        $media = $dedupedMedia;
    }

    successResponse([
        'complaint' => $complaint,
        'media' => $media,
        'media_count' => count($media),
    ]);
}

if ($action === 'caseTimeline') {
    $trackingId = trim((string)($_REQUEST['id'] ?? $data['id'] ?? ''));
    if ($trackingId === '') {
        errorResponse('Complaint ID is required.');
    }

    $cStmt = $db->prepare('SELECT complaint_id, submitted_at, status FROM complaints WHERE tracking_id = :id');
    $cStmt->execute([':id' => $trackingId]);
    $complaint = $cStmt->fetch();
    if (!$complaint) {
        errorResponse('Complaint not found.');
    }

    $hStmt = $db->prepare(
        'SELECT status, notes, changed_at
         FROM status_history
         WHERE complaint_id = :cid
         ORDER BY changed_at ASC, history_id ASC'
    );
    $hStmt->execute([':cid' => (int)$complaint['complaint_id']]);
    $timeline = $hStmt->fetchAll();

    successResponse([
        'timeline' => $timeline,
        'current_status' => $complaint['status'],
        'submitted_at' => $complaint['submitted_at'],
    ]);
}

if ($action === 'closeCase') {
    $trackingId = trim((string)($data['id'] ?? ''));
    $feedback   = trim((string)($data['feedback'] ?? ''));
    if ($trackingId === '') {
        errorResponse('Complaint ID is required.');
    }

    $cStmt = $db->prepare('SELECT complaint_id, status FROM complaints WHERE tracking_id = :id');
    $cStmt->execute([':id' => $trackingId]);
    $complaint = $cStmt->fetch();
    if (!$complaint) {
        errorResponse('Complaint not found.');
    }
    if ($complaint['status'] !== 'resolved') {
        errorResponse('Only resolved complaints can be closed.');
    }
    $complaintId = (int)$complaint['complaint_id'];

    $db->prepare(
        'UPDATE resolution_reports SET dispatch_approval_status = :approval, dispatch_feedback = :feedback,
         dispatch_reviewed_by = :did, dispatch_review_timestamp = NOW()
         WHERE complaint_id = :cid'
    )->execute([':approval' => 'approved', ':feedback' => $feedback, ':did' => $dispatchId, ':cid' => $complaintId]);

     $db->prepare('UPDATE complaints SET status = :status, dispatch_id = :did WHERE complaint_id = :cid')
         ->execute([':status' => 'closed', ':did' => $dispatchId, ':cid' => $complaintId]);

    $offStmt = $db->prepare(
        'SELECT field_officer_id FROM assignments
         WHERE complaint_id = :cid AND assignment_status = "completed"
         ORDER BY assigned_at DESC LIMIT 1'
    );
    $offStmt->execute([':cid' => $complaintId]);
    $officerId = $offStmt->fetchColumn();
    if ($officerId) {
        // Optionally update users table if you want to track resolved count
        // $db->prepare('UPDATE users SET total_resolved = total_resolved + 1 WHERE user_id = :id')->execute([':id' => $officerId]);
    }

    $db->prepare('INSERT INTO status_history (complaint_id, changed_by, status, notes) VALUES (:cid, :uid, :status, :notes)')
       ->execute([':cid' => $complaintId, ':uid' => $dispatchUid, ':status' => 'closed', ':notes' => 'Dispatch officer validated and closed the case.']);

    successResponse(['message' => 'Case closed successfully.']);
}

if ($action === 'officerCases') {
    $officerId = intval($_REQUEST['officer_id'] ?? $data['officer_id'] ?? 0);
    if (!$officerId) {
        errorResponse('Officer ID required.');
    }
    /* One row per complaint — use the most recent assignment from this officer */
    $stmt = $db->prepare(
        "SELECT c.tracking_id AS id, c.category AS cat, c.asset_town AS brgy,
                c.priority, c.status, c.submitted_at AS date, c.description,
                a.assigned_at, a.response_deadline, a.assignment_status AS asgn_status
         FROM assignments a
         JOIN complaints c ON c.complaint_id = a.complaint_id
         WHERE a.field_officer_id = :oid
           AND a.assignment_id = (
               SELECT MAX(a2.assignment_id) FROM assignments a2
               WHERE a2.complaint_id = a.complaint_id
                 AND a2.field_officer_id = :oid2
           )
         ORDER BY a.assigned_at DESC"
    );
    $stmt->execute([':oid' => $officerId, ':oid2' => $officerId]);
    successResponse(['cases' => $stmt->fetchAll()]);
}

errorResponse('Unknown action.');
