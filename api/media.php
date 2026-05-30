<?php
require_once __DIR__ . '/helpers.php';

$action = trim((string)($_REQUEST['action'] ?? 'upload_evidence'));
$user   = requireLogin();

if ($action === 'upload_evidence') {
    if (!isset($_FILES['file'])) {
        errorResponse('No file received. Ensure the request is multipart/form-data.');
    }

    $uploadError = (int)($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($uploadError !== UPLOAD_ERR_OK) {
        $uploadErrorMessages = [
            UPLOAD_ERR_INI_SIZE   => 'File exceeds server upload size limit.',
            UPLOAD_ERR_FORM_SIZE  => 'File exceeds form size limit.',
            UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded.',
            UPLOAD_ERR_NO_FILE    => 'No file was uploaded.',
            UPLOAD_ERR_NO_TMP_DIR => 'Missing server temporary folder.',
            UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk.',
            UPLOAD_ERR_EXTENSION  => 'Upload blocked by server extension.',
        ];
        errorResponse($uploadErrorMessages[$uploadError] ?? 'Upload error code ' . $uploadError);
    }

    $file = $_FILES['file'];
    $maxSize = 50 * 1024 * 1024; // 50MB
    $allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp', 'video/3gpp2',
    ];
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'm4v', 'webm', '3gp', '3gpp'];

    if ($file['size'] > $maxSize) {
        errorResponse('File size must not exceed 50MB.');
    }

    $ext = strtolower((string)pathinfo($file['name'], PATHINFO_EXTENSION));
    $mimeAllowed = in_array((string)$file['type'], $allowedTypes, true);
    $extAllowed = in_array($ext, $allowedExts, true);
    if (!$mimeAllowed && !$extAllowed) {
        errorResponse('Only JPG, PNG, GIF, WebP, MP4, MOV, M4V, WEBM, and 3GP files are allowed.');
    }

    // Resolve uploads directory — prefer DOCUMENT_ROOT for shared-hosting compatibility
    $docRoot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($docRoot !== '' && is_dir($docRoot)) {
        $uploadDir = $docRoot . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR;
    } else {
        $uploadDir = __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR;
    }

    if (!is_dir($uploadDir)) {
        @mkdir($uploadDir, 0755, true);
    }

    if (!is_dir($uploadDir) || !is_writable($uploadDir)) {
        errorResponse('Upload directory is not accessible. Please contact support.');
    }

    $filename = 'upload_' . uniqid() . '.' . $ext;
    $filepath = $uploadDir . $filename;

    if (!move_uploaded_file($file['tmp_name'], $filepath)) {
        errorResponse('Failed to save uploaded file. Check server permissions.');
    }

    successResponse([
        'success'  => true,
        'filename' => $filename,
        'url'      => '/uploads/' . $filename,
        'message'  => 'File uploaded successfully.',
    ]);
}

errorResponse('Unknown action.');
?>
