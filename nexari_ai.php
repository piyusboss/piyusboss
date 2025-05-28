<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: text/plain");

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'ping') {
    echo "pong";
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $message = $_POST['message'] ?? '';

    if (empty($message)) {
        http_response_code(400);
        echo "No message received.";
        exit;
    }

    $payload = json_encode([
        "inputs" => "### Instruction:\n{$message}\n\n### Response:",
        "options" => [ "wait_for_model" => true ]
    ]);

    file_put_contents("debug_log.txt", "SENDING: " . $payload . "\n", FILE_APPEND);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json"
    ]);
    $result = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);

    file_put_contents("debug_log.txt", "RESPONSE: " . $result . "\n", FILE_APPEND);

    if ($error) {
        http_response_code(500);
        echo "cURL error: " . $error;
        exit;
    }

    $data = json_decode($result, true);
    if (isset($data[0]['generated_text'])) {
        echo trim(preg_replace('/^.*### Response:/s', '', $data[0]['generated_text']));
    } else {
        http_response_code(500);
        echo "TEMP fallback: " . json_encode($data);
    }
} else {
    http_response_code(405);
    echo "Invalid request method.";
}
?>
