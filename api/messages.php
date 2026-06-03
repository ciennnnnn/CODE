<?php
require_once __DIR__ . '/init.php';

$data = getJsonPayload();
$action = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'thread'));
$user = requireLogin();
$db = getDb();

function ensureChatMessagesTable(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS chat_messages (
            message_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            conversation_key VARCHAR(128) NOT NULL,
            sender_role VARCHAR(32) NOT NULL,
            sender_id INT UNSIGNED NOT NULL,
            receiver_role VARCHAR(32) NOT NULL,
            receiver_id INT UNSIGNED NOT NULL,
            message_text TEXT NOT NULL,
            sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_conversation (conversation_key, message_id),
            INDEX idx_sender (sender_role, sender_id),
            INDEX idx_receiver (receiver_role, receiver_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function normalizeRole(string $role): string
{
    $map = ['field_officer' => 'field', 'dispatch_officer' => 'dispatch', 'citizen' => 'regular'];
    return $map[$role] ?? $role;
}

function buildConversationKey(string $roleA, int $idA, string $roleB, int $idB): string
{
    if ($roleA < $roleB || ($roleA === $roleB && $idA <= $idB)) {
        return sprintf('%s:%d|%s:%d', $roleA, $idA, $roleB, $idB);
    }
    return sprintf('%s:%d|%s:%d', $roleB, $idB, $roleA, $idA);
}

ensureChatMessagesTable($db);

$senderRole = normalizeRole($user['role']);
$senderId   = (int)($user['user_id'] ?? $user['id'] ?? 0);

$receiverRole = normalizeRole(trim((string)($data['receiver_role'] ?? $_REQUEST['receiver_role'] ?? '')));
$receiverId   = (int)($data['receiver_id'] ?? $_REQUEST['receiver_id'] ?? 0);

$currentKey = '';
if ($receiverRole !== '' && $receiverId > 0 && $senderId > 0) {
    $currentKey = buildConversationKey($senderRole, $senderId, $receiverRole, $receiverId);
}

/* Shared SELECT with sender name joined from users table */
$selectSql =
    'SELECT cm.message_id AS id,
            cm.sender_role AS senderRole,
            cm.sender_id AS senderId,
            cm.receiver_role AS receiverRole,
            cm.receiver_id AS receiverId,
            cm.message_text AS message,
            cm.sent_at AS sentAt,
            COALESCE(u.full_name, u.username, cm.sender_role) AS senderName
     FROM chat_messages cm
     LEFT JOIN users u ON u.user_id = cm.sender_id';

if ($action === 'send') {
    $message = trim((string)($data['message'] ?? ''));
    if ($message === '' || $receiverRole === '' || $receiverId === 0) {
        errorResponse('Message text, receiver role, and receiver ID are required.');
    }
    if ($currentKey === '') {
        errorResponse('Unable to build conversation key. Sender or receiver ID missing.');
    }
    $stmt = $db->prepare(
        'INSERT INTO chat_messages (conversation_key, sender_role, sender_id, receiver_role, receiver_id, message_text)
         VALUES (:key, :sr, :sid, :rr, :rid, :msg)'
    );
    $stmt->execute([
        ':key' => $currentKey,
        ':sr'  => $senderRole,
        ':sid' => $senderId,
        ':rr'  => $receiverRole,
        ':rid' => $receiverId,
        ':msg' => $message,
    ]);
    successResponse(['message' => 'Message sent successfully.', 'conversation_key' => $currentKey]);
}

if ($action === 'poll') {
    if ($currentKey === '') errorResponse('A conversation key is required.');
    $lastId = (int)($data['last_id'] ?? $_REQUEST['last_id'] ?? 0);
    $stmt = $db->prepare(
        $selectSql . ' WHERE cm.conversation_key = :key AND cm.message_id > :last ORDER BY cm.message_id ASC'
    );
    $stmt->execute([':key' => $currentKey, ':last' => $lastId]);
    successResponse(['messages' => $stmt->fetchAll()]);
}

if ($action === 'thread') {
    if ($currentKey === '') errorResponse('A conversation key is required.');
    $stmt = $db->prepare(
        $selectSql . ' WHERE cm.conversation_key = :key ORDER BY cm.message_id ASC'
    );
    $stmt->execute([':key' => $currentKey]);
    $messages = $stmt->fetchAll();

    /* Fallback: if empty, try both sender/receiver orderings to catch old messages */
    if (empty($messages) && $senderId > 0 && $receiverId > 0) {
        $altKey = buildConversationKey($receiverRole, $receiverId, $senderRole, $senderId);
        if ($altKey !== $currentKey) {
            $stmt2 = $db->prepare(
                $selectSql . ' WHERE cm.conversation_key = :key ORDER BY cm.message_id ASC'
            );
            $stmt2->execute([':key' => $altKey]);
            $messages = $stmt2->fetchAll();
        }
    }

    successResponse(['messages' => $messages]);
}

errorResponse('Unknown action.');
