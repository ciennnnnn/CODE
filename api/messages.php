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

/* Normalize role variants so conversation keys are consistent */
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

/* Both sides always pass user_id directly — no extension-PK resolution needed */
$senderRole = normalizeRole($user['role']);
$senderId   = (int)($user['user_id'] ?? $user['id'] ?? 0);

$receiverRole   = normalizeRole(trim((string)($data['receiver_role'] ?? $_REQUEST['receiver_role'] ?? '')));
$receiverId     = (int)trim((string)($data['receiver_id'] ?? $_REQUEST['receiver_id'] ?? 0));

$currentKey = '';
if ($receiverRole !== '' && $receiverId > 0 && $senderId > 0) {
    $currentKey = buildConversationKey($senderRole, $senderId, $receiverRole, $receiverId);
}

if ($action === 'send') {
    $message = trim((string)($data['message'] ?? ''));
    if ($message === '' || $receiverRole === '' || $receiverId === 0) {
        errorResponse('Message text, receiver role, and receiver ID are required.');
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
        'SELECT message_id AS id, sender_role AS senderRole, sender_id AS senderId,
                receiver_role AS receiverRole, receiver_id AS receiverId,
                message_text AS message, sent_at AS sentAt
         FROM chat_messages WHERE conversation_key = :key AND message_id > :last ORDER BY message_id ASC'
    );
    $stmt->execute([':key' => $currentKey, ':last' => $lastId]);
    successResponse(['messages' => $stmt->fetchAll()]);
}

if ($action === 'thread') {
    if ($currentKey === '') errorResponse('A conversation key is required.');
    $stmt = $db->prepare(
        'SELECT message_id AS id, sender_role AS senderRole, sender_id AS senderId,
                receiver_role AS receiverRole, receiver_id AS receiverId,
                message_text AS message, sent_at AS sentAt
         FROM chat_messages WHERE conversation_key = :key ORDER BY message_id ASC'
    );
    $stmt->execute([':key' => $currentKey]);
    successResponse(['messages' => $stmt->fetchAll()]);
}

errorResponse('Unknown action.');
