<?php
require_once __DIR__ . '/init.php';

/* ── Ensure trapico_trash exists (runs once on first call) ─── */
function ensureTrashTable(PDO $db): void
{
    static $done = false;
    if ($done) return;
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS trapico_trash (
                trash_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                entity_type         ENUM('complaint','user','media','chat_message','rating',
                                         'resolution_report','assignment') NOT NULL,
                entity_id           VARCHAR(64)  NOT NULL,
                entity_label        VARCHAR(255) DEFAULT NULL,
                record_snapshot     LONGTEXT     NOT NULL,
                deleted_by_user_id  INT          DEFAULT NULL,
                deleted_by_role     VARCHAR(50)  DEFAULT NULL,
                deletion_reason     TEXT         DEFAULT NULL,
                deleted_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                purge_after         DATETIME     DEFAULT NULL,
                is_restored         TINYINT(1)   NOT NULL DEFAULT 0,
                restored_at         DATETIME     DEFAULT NULL,
                restored_by_user_id INT          DEFAULT NULL,
                PRIMARY KEY (trash_id),
                KEY idx_entity     (entity_type, entity_id),
                KEY idx_deleted_at (entity_type, deleted_at),
                KEY idx_restored   (is_restored, entity_type),
                KEY idx_purge      (purge_after)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) { /* already exists */ }
    $done = true;
}

/**
 * Move a record into the trash (soft-delete).
 *
 * @param PDO    $db           Database connection
 * @param string $entityType   One of: complaint, user, media, chat_message, rating,
 *                             resolution_report, assignment
 * @param string $entityId     Primary key value of the record being deleted
 * @param string $entityLabel  Human-readable name (e.g. tracking_id for complaints)
 * @param array  $snapshot     Full row data as associative array (will be JSON-encoded)
 * @param int    $deletedByUid user_id of who triggered the deletion (0 = system)
 * @param string $deletedByRole role string (citizen, dispatch, field, system)
 * @param string $reason       Optional reason text
 * @param int    $keepDays     How many days to keep before auto-purge (0 = forever)
 */
function sendToTrash(
    PDO    $db,
    string $entityType,
    string $entityId,
    string $entityLabel,
    array  $snapshot,
    int    $deletedByUid  = 0,
    string $deletedByRole = '',
    string $reason        = '',
    int    $keepDays      = 90
): void {
    ensureTrashTable($db);
    $purgeAfter = $keepDays > 0
        ? date('Y-m-d H:i:s', strtotime("+{$keepDays} days"))
        : null;

    $db->prepare(
        'INSERT INTO trapico_trash
         (entity_type, entity_id, entity_label, record_snapshot,
          deleted_by_user_id, deleted_by_role, deletion_reason, purge_after)
         VALUES (:et, :eid, :el, :snap, :uid, :role, :reason, :purge)'
    )->execute([
        ':et'     => $entityType,
        ':eid'    => $entityId,
        ':el'     => $entityLabel,
        ':snap'   => json_encode($snapshot, JSON_UNESCAPED_UNICODE),
        ':uid'    => $deletedByUid ?: null,
        ':role'   => $deletedByRole ?: null,
        ':reason' => $reason ?: null,
        ':purge'  => $purgeAfter,
    ]);
}

function buildTrackingNumber(PDO $db): string
{
    $prefix = 'TRAPICO-' . date('Y-m-');
    $stmt   = $db->prepare('SELECT tracking_id FROM complaints WHERE tracking_id LIKE :prefix ORDER BY tracking_id DESC LIMIT 1');
    $stmt->execute([':prefix' => $prefix . '%']);
    $last = $stmt->fetchColumn();

    if (!$last) {
        return $prefix . '000001';
    }

    $parts = explode('-', $last);
    $seq   = intval(array_pop($parts));
    return $prefix . str_pad((string)($seq + 1), 6, '0', STR_PAD_LEFT);
}

function getDistanceMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $earthRadius = 6371000;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) * sin($dLat / 2)
       + cos(deg2rad($lat1)) * cos(deg2rad($lat2))
       * sin($dLng / 2) * sin($dLng / 2);
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $earthRadius * $c;
}
