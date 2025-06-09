// worker.js (Deno AI worker with BUILT-IN AUTHENTICATION, context, and image generation)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// --- CONFIGURATION ---

// 1. Hugging Face Key: AI models ke liye
const HUGGING_FACE_API_KEY = Deno.env.get("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");

// 2. Allowed System Keys: Aapke system ko access karne ke liye keys (comma-separated)
// Example: "key1,key2,key3"
const NEXARI_ALLOWED_KEYS_STR = Deno.env.get("NEXARI_ALLOWED_KEYS");
const ALLOWED_KEYS = NEXARI_ALLOWED_KEYS_STR ? NEXARI_ALLOWED_KEYS_STR.split(',') : ["your_secret_key_here"]; // Fallback key

if (!HUGGING_FACE_API_KEY || !NEXARI_ALLOWED_KEYS_STR) {
    console.error("FATAL: HUGGING_FACE_API_KEY and NEXARI_ALLOWED_KEYS environment variables must be set!");
    console.log("Example command: NEXARI_ALLOWED_KEYS=\"key1,key2\" HUGGING_FACE_API_KEY=\"hf_...\" deno run --allow-net --allow-env worker.js");
    Deno.exit(1);
}

const MODEL_MAP = {
    "Nexari G1": "mistralai/Mixtral-8x7B-Instruct-v0.1",
};

const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ... (buildFullPrompt, callHuggingFaceTextAPI, callHuggingFaceImageAPI functions same rahenge) ...
function buildFullPrompt(userMessage, context) {
    const history = context?.current_conversation || [];
    const memory = context?.long_term_memory_summary || "";
    let prompt = "[INST] You are Nexari, a helpful and intelligent AI assistant. \n";
    if (memory) {
        prompt += `Here is a summary of your past conversations with this user. Use this information to provide context-aware responses:\n${memory}\n\n`;
    }
    prompt += "Current conversation:\n";
    if (Array.isArray(history)) {
        for (const message of history) {
            prompt += `${message.sender === 'user' ? 'User' : 'Nexari'}: ${message.text}\n`;
        }
    }
    prompt += `User: ${userMessage.trim()} [/INST]\nNexari:`;
    return prompt;
}
async function callHuggingFaceTextAPI(modelId, prompt) { /* ...No changes here... */ 
    const apiUrl = `https://api-inference.huggingface.co/models/${modelId}`;
    const payload = { inputs: prompt, parameters: { max_new_tokens: 1500, return_full_text: false } };
    try {
        const res = await fetch(apiUrl, { method: "POST", headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) return { error: data.error || `HF API Error: ${res.status}` };
        return { response: data[0]?.generated_text.trim() };
    } catch (err) { return { error: `Request to HF API failed: ${err.message}` }; }
}
async function callHuggingFaceImageAPI(prompt) { /* ...No changes here... */
    const apiUrl = `https://api-inference.huggingface.co/models/${IMAGE_MODEL_ID}`;
    try {
        const res = await fetch(apiUrl, { method: "POST", headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ inputs: prompt }) });
        if (!res.ok) { const errTxt = await res.text(); return { error: JSON.parse(errTxt).error || `HF API Error: ${res.status}` }; }
        const imageBuffer = await toArrayBuffer(res.body);
        const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
        return { image_url: `data:${res.headers.get("content-type") || "image/jpeg"};base64,${imageBase64}` };
    } catch (err) { return { error: `Request to HF Image API failed: ${err.message}` }; }
}


// --- HTTP SERVER LOGIC (Updated with Authentication) ---
serve(async (req) => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- AUTHENTICATION LOGIC ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized: Missing or invalid Authorization header." }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    }

    const token = authHeader.substring(7); // "Bearer " ko hatakar token nikalein
    if (!ALLOWED_KEYS.includes(token)) {
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid API Key." }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    }
    // --- END OF AUTHENTICATION LOGIC ---

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed." }), { status: 405 });
    }

    try {
        const body = await req.json();
        const { message, model: modelKey, context } = body;
        let result;

        if (url.pathname === "/generate") {
            const modelId = MODEL_MAP[modelKey] || MODEL_MAP["Nexari G1"];
            const fullPrompt = buildFullPrompt(message, context);
            result = await callHuggingFaceTextAPI(modelId, fullPrompt);
        } else if (url.pathname === "/generate-image") {
            result = await callHuggingFaceImageAPI(message);
        } else {
            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
        }

        return new Response(JSON.stringify(result), {
            status: result.error ? 500 : 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: `Invalid JSON body: ${err.message}` }), { status: 400 });
    }
});

console.log(`Deno AI worker with built-in auth started on http://localhost:8000`);
console.log(`Allowed System Keys loaded: ${ALLOWED_KEYS.length}`);

