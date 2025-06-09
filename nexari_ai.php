<?php

// Combined Nexari AI System - Pass-through API (v2.4)

// --- CONFIGURATION ---
define('LOG_FILE', __DIR__ . '/nexari_logs.jsonl');
define('MEMORY_FILE', __DIR__ . '/memory_data.json');
define('DEFAULT_MODEL_CONFIG', 'Nexari G1');
// --- API Key validation yahan se hata diya gaya hai ---

// --- HEADERS ---
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ======================
// INTENT ROUTER & MEMORY (Yeh logic same rahega)
// ======================
function detect_intent(string $message): string {
    $msg = strtolower($message);
    if (preg_match('/\b(image|picture|photo|draw|generate|create an image of|make a picture of)\b/i', $msg)) return 'image';
    return 'chat';
}

function save_memory(string $ip, string $user_message, string $bot_response, int $max_entries = 50): void {
    $all_memory = file_exists(MEMORY_FILE) ? (json_decode(file_get_contents(MEMORY_FILE), true) ?: []) : [];
    if (!isset($all_memory[$ip])) {
        $all_memory[$ip] = [];
    }
    $all_memory[$ip][] = ['user' => $user_message, 'bot' => $bot_response, 'time' => date('c')];
    $all_memory[$ip] = array_slice($all_memory[$ip], -$max_entries);
    file_put_contents(MEMORY_FILE, json_encode($all_memory, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function summarize_memory(string $ip, int $count = 5): string {
    $mem = file_exists(MEMORY_FILE) ? (json_decode(file_get_contents(MEMORY_FILE), true) ?: []) : [];
    if (empty($mem[$ip])) return "";
    $recent = array_slice($mem[$ip], -$count);
    $parts = array_map(fn($e) => "User said: \"{$e['user']}\" and AI replied: \"{$e['bot']}\"", $recent);
    return "Here is a summary of some previous interactions with this user:\n" . implode("\n", $parts);
}

// ======================
// WORKER CLIENT COMPONENT (Updated)
// ======================
function call_worker(string $message, string $model, array $context, string $endpoint, string $auth_header): array {
    $url = "http://localhost:8000/$endpoint"; // Deno worker ka URL
    $payload = json_encode(['message' => $message, 'model' => $model, 'context' => $context]);
    if ($payload === false) return ['error' => 'Failed to encode JSON payload.'];

    $ch = curl_init($url);
    
    // Request ke saath bheje jaane wale headers
    $curl_headers = [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($payload)
    ];
    // Client se aaye Authorization header ko aage pass karein
    if (!empty($auth_header)) {
        $curl_headers[] = $auth_header;
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => $curl_headers, // Updated headers
        CURLOPT_TIMEOUT => 120,
        CURLOPT_FAILONERROR => false
    ]);

    $response_body = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_errno = curl_errno($ch);
    curl_close($ch);

    if ($curl_errno) {
        return ['error' => "Network error connecting to the AI worker service."];
    }
    
    $data = json_decode($response_body, true);

    // Agar worker ne authentication error (401) bheja hai to use handle karein
    if ($http_code == 401) {
        return ['error' => $data['error'] ?? 'Unauthorized: Invalid API Key provided to worker.'];
    }
    if ($http_code >= 400 || $data === null) {
        return ['error' => $data['error'] ?? 'Invalid response from AI worker.'];
    }
    
    return $data;
}

// ======================
// MAIN APPLICATION LOGIC (Simplified)
// ======================
ini_set('display_errors', 0); // Production mein errors display na karein
error_reporting(E_ALL);

function send_json_error(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

// --- POST Request Handling ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Client se aane wale Authorization header ko capture karein
    $auth_header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    // --- API key validation yahan se hata di gayi hai ---

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    $input_json = file_get_contents('php://input');
    $input = json_decode($input_json, true);

    if (json_last_error() !== JSON_ERROR_NONE || !isset($input['message']) || trim($input['message']) === '') {
        send_json_error(400, "'message' parameter missing or invalid JSON.");
    }

    $user_message = trim($input['message']);
    $history = $input['history'] ?? [];
    $model = $input['model'] ?? DEFAULT_MODEL_CONFIG;
    
    $intent = detect_intent($user_message);
    $memory_summary = summarize_memory($ip, 5);

    $full_context = [
        'long_term_memory_summary' => $memory_summary,
        'current_conversation' => $history,
        'intent' => $intent
    ];
    $endpoint = ($intent === 'image') ? 'generate-image' : 'generate';

    // Auth header ko call_worker function mein pass karein
    $ai_response = call_worker($user_message, $model, $full_context, $endpoint, $auth_header);

    if (isset($ai_response['error'])) {
        // Worker se 500 ya 401 jaisa error aa sakta hai
        $errorCode = ($ai_response['error'] === 'Unauthorized') ? 401 : 500;
        send_json_error($errorCode, $ai_response['error']);
    } else {
        $response_for_memory = isset($ai_response['response']) 
            ? $ai_response['response'] 
            : "[AI generated an image for the prompt: '{$user_message}']";
        
        save_memory($ip, $user_message, $response_for_memory);
        
        echo json_encode($ai_response);
    }
    exit;
}

send_json_error(405, 'Invalid request method.');
?>
