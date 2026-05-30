<?php
if (!isset($_GET['q'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing query']);
    exit;
}
$q = urlencode($_GET['q']);
$url = "https://nominatim.openstreetmap.org/search?format=jsonv2&q=$q";
$opts = [
    "http" => [
        "header" => "User-Agent: TRAPICO/1.0\r\n"
    ]
];
$context = stream_context_create($opts);
$response = file_get_contents($url, false, $context);
header('Content-Type: application/json');
echo $response;
