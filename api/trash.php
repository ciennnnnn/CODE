<?php
require_once __DIR__ . '/helpers.php';

$data   = getJsonPayload();
$action = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'list'));
$user   = requireRole('dispatch');   // Only dispatch officers manage the trash
$db     = getDb();
$actorUid = (int)($user['user_id'] ?? 0);

ensureTrashTable($db);

/* ── LIST — all non-restored trash items, grouped by entity_type ── */
if ($action === 'list') {
    $entityType = trim((string)($_REQUEST['entity_type'] ?? $data['entity_type'] ?? ''));
    $page       = max(1, (int)($_REQUEST['page'] ?? $data['page'] ?? 1));
    $perPage    = 50;
    $offset     = ($page - 1) * $perPage;

    $where  = ['t.is_restored = 0'];
    $params = [];

    if ($entityType !== '') {
        $where[]              = 't.entity_type = :et';
        $params[':et']        = $entityType;
    }

    $whereStr = implode(' AND ', $where);

    $countStmt = $db->prepare("SELECT COUNT(*) FROM trapico_trash t WHERE $whereStr");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $stmt = $db->prepare(
        "SELECT t.trash_id, t.entity_type, t.entity_id, t.entity_label,
                t.deleted_by_role, t.deletion_reason, t.deleted_at, t.purge_after,
                u.full_name AS deleted_by_name
         FROM trapico_trash t
         LEFT JOIN users u ON u.user_id = t.deleted_by_user_id
         WHERE $whereStr
         ORDER BY t.deleted_at DESC
         LIMIT :limit OFFSET :offset"
    );
    $stmt->bindValue(':limit',  $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset,  PDO::PARAM_INT);
    foreach ($params as $k => $v) { $stmt->bindValue($k, $v); }
    $stmt->execute();
    $items = $stmt->fetchAll();

    /* Counts per entity_type for the sidebar badges */
    $countPerType = $db->query(
        "SELECT entity_type, COUNT(*) AS cnt
         FROM trapico_trash
         WHERE is_restored = 0
         GROUP BY entity_type"
    )->fetchAll();

    successResponse([
        'items'          => $items,
        'total'          => $total,
        'page'           => $page,
        'per_page'       => $perPage,
        'counts_by_type' => $countPerType,
    ]);
}

/* ── DETAIL — get the full JSON snapshot of one trash item ── */
if ($action === 'detail') {
    $trashId = intval($_REQUEST['trash_id'] ?? $data['trash_id'] ?? 0);
    if (!$trashId) errorResponse('trash_id required.');

    $stmt = $db->prepare(
        'SELECT t.*, u.full_name AS deleted_by_name
         FROM trapico_trash t
         LEFT JOIN users u ON u.user_id = t.deleted_by_user_id
         WHERE t.trash_id = :id'
    );
    $stmt->execute([':id' => $trashId]);
    $item = $stmt->fetch();
    if (!$item) errorResponse('Trash item not found.', 404);

    $item['record_snapshot'] = json_decode($item['record_snapshot'], true);
    successResponse(['item' => $item]);
}

/* ── RESTORE — un-delete a soft-deleted record ── */
if ($action === 'restore') {
    $trashId = intval($data['trash_id'] ?? 0);
    if (!$trashId) errorResponse('trash_id required.');

    $stmt = $db->prepare('SELECT * FROM trapico_trash WHERE trash_id = :id AND is_restored = 0');
    $stmt->execute([':id' => $trashId]);
    $item = $stmt->fetch();
    if (!$item) errorResponse('Trash item not found or already restored.', 404);

    $snapshot = json_decode((string)($item['record_snapshot'] ?? '{}'), true) ?: [];

    /* Restore logic per entity type */
    $type = (string)$item['entity_type'];
    $eid  = (string)$item['entity_id'];

    if ($type === 'complaint') {
        /* Un-soft-delete the complaint row if it still exists */
        $exists = $db->prepare('SELECT complaint_id FROM complaints WHERE complaint_id = :id');
        $exists->execute([':id' => $eid]);
        if ($exists->fetch()) {
            $db->prepare(
                "UPDATE complaints
                 SET is_soft_deleted = 0, deleted_at = NULL,
                     status = :status
                 WHERE complaint_id = :id"
            )->execute([
                ':status' => $snapshot['status'] ?? 'submitted',
                ':id'     => $eid,
            ]);
        } else {
            /* Row was hard-deleted (shouldn't happen, but guard) */
            errorResponse('The original complaint record no longer exists and cannot be restored. The snapshot is preserved in the trash.');
        }

        $db->prepare(
            'INSERT INTO status_history (complaint_id, changed_by, status, notes)
             VALUES (:cid, :uid, :status, :notes)'
        )->execute([
            ':cid'    => $eid,
            ':uid'    => $actorUid,
            ':status' => $snapshot['status'] ?? 'submitted',
            ':notes'  => 'Record restored from trash by dispatch officer.',
        ]);
    }
    /* Future: add restore branches for user, media, etc. */

    /* Mark as restored in trash */
    $db->prepare(
        'UPDATE trapico_trash
         SET is_restored = 1, restored_at = NOW(), restored_by_user_id = :uid
         WHERE trash_id = :id'
    )->execute([':uid' => $actorUid, ':id' => $trashId]);

    successResponse(['message' => 'Record restored successfully.']);
}

/* ── PURGE — permanently delete one item from trash ── */
if ($action === 'purge') {
    $trashId = intval($data['trash_id'] ?? 0);
    if (!$trashId) errorResponse('trash_id required.');

    $stmt = $db->prepare('SELECT entity_type, entity_label FROM trapico_trash WHERE trash_id = :id');
    $stmt->execute([':id' => $trashId]);
    $item = $stmt->fetch();
    if (!$item) errorResponse('Trash item not found.', 404);

    /* Hard-delete the complaint row if it's a soft-deleted complaint */
    if ($item['entity_type'] === 'complaint') {
        /* The complaint still exists (soft-deleted) — permanently remove it */
        $cidStmt = $db->prepare('SELECT complaint_id FROM trapico_trash WHERE trash_id = :id');
        $cidStmt->execute([':id' => $trashId]);
    }

    $db->prepare('DELETE FROM trapico_trash WHERE trash_id = :id')->execute([':id' => $trashId]);

    successResponse(['message' => "Permanently deleted: {$item['entity_label']} ({$item['entity_type']})."]);
}

/* ── PURGE_EXPIRED — remove all items past their purge_after date ── */
if ($action === 'purge_expired') {
    $stmt = $db->prepare(
        "DELETE FROM trapico_trash
         WHERE purge_after IS NOT NULL AND purge_after < NOW() AND is_restored = 0"
    );
    $stmt->execute();
    successResponse(['purged' => $stmt->rowCount(), 'message' => "{$stmt->rowCount()} expired item(s) permanently removed."]);
}

errorResponse('Unknown action.');
