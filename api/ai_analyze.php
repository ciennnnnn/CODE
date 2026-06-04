<?php
require_once __DIR__ . '/init.php';

$data   = getJsonPayload();
$action = trim((string)($_REQUEST['action'] ?? $data['action'] ?? 'history'));
$user   = requireLogin();
$db     = getDb();

function ensureAiTable(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            conversation_key VARCHAR(128) NOT NULL,
            user_id          INT UNSIGNED NOT NULL,
            msg_role         VARCHAR(10)  NOT NULL,
            msg_text         MEDIUMTEXT   NOT NULL,
            created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_session (conversation_key, user_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function normalizeRoleAi(string $role): string
{
    $map = ['field_officer' => 'field', 'dispatch_officer' => 'dispatch', 'citizen' => 'regular'];
    return $map[$role] ?? $role;
}

function buildConvKeyAi(string $rA, int $iA, string $rB, int $iB): string
{
    if ($rA < $rB || ($rA === $rB && $iA <= $iB)) {
        return "{$rA}:{$iA}|{$rB}:{$iB}";
    }
    return "{$rB}:{$iB}|{$rA}:{$iA}";
}

function callGemini(string $key, array $contents, string $sysPrompt): string
{
    $url  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' . urlencode($key);
    $body = json_encode([
        'system_instruction' => ['parts' => [['text' => $sysPrompt]]],
        'contents'           => $contents,
        'generationConfig'   => ['maxOutputTokens' => 1024, 'temperature' => 0.7],
    ]);
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/json\r\n",
        'content'       => $body,
        'timeout'       => 30,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        throw new RuntimeException('Could not reach Gemini API. Check your internet connection.');
    }
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException('Invalid response from Gemini API.');
    }
    if (isset($json['error'])) {
        throw new RuntimeException($json['error']['message'] ?? 'Gemini API error.');
    }
    $text = $json['candidates'][0]['content']['parts'][0]['text'] ?? '';
    if ($text === '') {
        throw new RuntimeException('Empty response from Gemini. Please try again.');
    }
    return $text;
}

try { ensureAiTable($db); } catch (Throwable $e) {}

$myRole = normalizeRoleAi($user['role'] ?? '');
$myId   = (int)($user['user_id'] ?? $user['id'] ?? 0);

$receiverRole = normalizeRoleAi(trim((string)($data['receiver_role'] ?? $_REQUEST['receiver_role'] ?? '')));
$receiverId   = (int)($data['receiver_id'] ?? $_REQUEST['receiver_id'] ?? 0);

$convKey = ($receiverRole !== '' && $receiverId > 0 && $myId > 0)
    ? buildConvKeyAi($myRole, $myId, $receiverRole, $receiverId)
    : '';

/* ── history ───────────────────────────────────────────────── */
if ($action === 'history') {
    if ($convKey === '') errorResponse('receiver_role and receiver_id are required.');
    $st = $db->prepare(
        'SELECT msg_role AS role, msg_text AS text, created_at AS createdAt
         FROM ai_chat_sessions
         WHERE conversation_key = :k AND user_id = :u
         ORDER BY id ASC'
    );
    $st->execute([':k' => $convKey, ':u' => $myId]);
    successResponse(['history' => $st->fetchAll()]);
}

/* ── analyze ───────────────────────────────────────────────── */
if ($action === 'analyze') {
    $apiKey = defined('GEMINI_API_KEY') ? GEMINI_API_KEY : '';
    if ($apiKey === '') {
        errorResponse('AI is not configured. Add your Gemini API key to api/db.php as GEMINI_API_KEY.');
    }
    if ($convKey === '') errorResponse('receiver_role and receiver_id are required.');

    $userMsg = trim((string)($data['message'] ?? ''));
    if ($userMsg === '') errorResponse('message is required.');

    /* Fetch last 50 chat messages for context */
    $ctxSt = $db->prepare(
        'SELECT cm.sender_role, cm.message_text, cm.sent_at,
                COALESCE(u.full_name, u.username, cm.sender_role) AS sender_name
         FROM chat_messages cm
         LEFT JOIN users u ON u.user_id = cm.sender_id
         WHERE cm.conversation_key = :k
         ORDER BY cm.message_id DESC LIMIT 50'
    );
    $ctxSt->execute([':k' => $convKey]);
    $chatMsgs = array_reverse($ctxSt->fetchAll());

    $transcript = '';
    foreach ($chatMsgs as $m) {
        $name = (string)($m['sender_name'] ?? $m['sender_role'] ?? 'Unknown');
        $role = ucfirst((string)($m['sender_role'] ?? ''));
        $text = (string)($m['message_text'] ?? '');
        $time = (string)($m['sent_at'] ?? '');
        $transcript .= "[{$time}] {$name} ({$role}): {$text}\n";
    }

    $sysPrompt = "You are TRAPICO AI Assistant helping traffic incident management officers.\n"
        . "You assist Field Officers and Dispatch Command Center with:\n"
        . "- Summarizing and analyzing communications\n"
        . "- Identifying key incident details, priorities, and action items\n"
        . "- Suggesting appropriate responses and protocols\n"
        . "Be concise, professional, and focused on traffic incident management.\n";

    if ($transcript !== '') {
        $sysPrompt .= "\nCurrent chat transcript (last 50 messages):\n---\n{$transcript}---\n";
    } else {
        $sysPrompt .= "\nNo chat messages found for this conversation yet.\n";
    }

    /* Load prior AI conversation for this user + conversation */
    $histSt = $db->prepare(
        'SELECT msg_role AS role, msg_text AS text
         FROM ai_chat_sessions
         WHERE conversation_key = :k AND user_id = :u
         ORDER BY id ASC'
    );
    $histSt->execute([':k' => $convKey, ':u' => $myId]);
    $prevHist = $histSt->fetchAll();

    $contents = [];
    foreach ($prevHist as $h) {
        $contents[] = ['role' => $h['role'], 'parts' => [['text' => $h['text']]]];
    }
    $contents[] = ['role' => 'user', 'parts' => [['text' => $userMsg]]];

    try {
        $aiResp = callGemini($apiKey, $contents, $sysPrompt);
    } catch (Throwable $e) {
        errorResponse('AI error: ' . $e->getMessage());
    }

    $ins = $db->prepare(
        'INSERT INTO ai_chat_sessions (conversation_key, user_id, msg_role, msg_text)
         VALUES (:k, :u, :r, :t)'
    );
    $ins->execute([':k' => $convKey, ':u' => $myId, ':r' => 'user',  ':t' => $userMsg]);
    $ins->execute([':k' => $convKey, ':u' => $myId, ':r' => 'model', ':t' => $aiResp]);

    successResponse(['response' => $aiResp]);
}

/* ── clear ─────────────────────────────────────────────────── */
if ($action === 'clear') {
    if ($convKey === '') errorResponse('receiver_role and receiver_id are required.');
    $st = $db->prepare('DELETE FROM ai_chat_sessions WHERE conversation_key = :k AND user_id = :u');
    $st->execute([':k' => $convKey, ':u' => $myId]);
    successResponse(['cleared' => true]);
}

errorResponse('Unknown action.');
