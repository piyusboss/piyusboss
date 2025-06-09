// worker.js (Deno AI worker with full context, image generation, and model selection)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// --- CONFIGURATION ---

// !!! IMPORTANT: Production mein environment variables ka istemal karein !!!
// Command to run: HUGGING_FACE_API_KEY="your_hf_key_here" deno run --allow-net --allow-env worker.js
const HUGGING_FACE_API_KEY = Deno.env.get("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");
if (!HUGGING_FACE_API_KEY) {
    console.error("HUGGING_FACE_API_KEY environment variable not set!");
    Deno.exit(1);
}

// Model mapping: PHP se bheje gaye naam ko আসল Hugging Face model ID se jodein
const MODEL_MAP = {
    "Nexari G1": "mistralai/Mixtral-8x7B-Instruct-v0.1",
    // Aap yahan aur bhi text models add kar sakte hain
};

const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";
const IMAGE_API_URL = `https://api-inference.huggingface.co/models/${IMAGE_MODEL_ID}`;
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*", // Production mein ise specific domain par restrict karein
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};


/**
 * PHP se bheje gaye context aur message se ek poora prompt banata hai.
 * @param {string} userMessage - User ka current message.
 * @param {object} context - PHP se bheja gaya context object.
 * @returns {string} - AI model ke liye taiyar kiya gaya prompt.
 */
function buildFullPrompt(userMessage, context) {
    const history = context?.current_conversation || [];
    const memory = context?.long_term_memory_summary || "";

    let prompt = "[INST] You are Nexari, a helpful and intelligent AI assistant. \n";

    // Agar memory summary hai to use shuru mein add karein
    if (memory) {
        prompt += `Here is a summary of your past conversations with this user. Use this information to provide context-aware responses:\n${memory}\n\n`;
    }
    
    prompt += "Current conversation:\n";

    // Conversation history ko format karein
    if (Array.isArray(history)) {
        for (const message of history) {
            if (message.sender === 'user') {
                prompt += `User: ${message.text}\n`;
            } else if (message.sender === 'ai') {
                prompt += `Nexari: ${message.text}\n`;
            }
        }
    }
    
    // Current user message ko ant mein jodein
    prompt += `User: ${userMessage.trim()} [/INST]\nNexari:`;

    return prompt;
}

/**
 * Text generation ke liye Hugging Face API ko call karta hai.
 * @param {string} modelId - Hugging Face model ID.
 * @param {string} prompt - AI ke liye banaya gaya prompt.
 * @returns {Promise<object>} - Response ya error object.
 */
async function callHuggingFaceTextAPI(modelId, prompt) {
    if (!prompt) {
        return { error: "Input prompt is empty." };
    }

    const apiUrl = `https://api-inference.huggingface.co/models/${modelId}`;
    const payload = {
        inputs: prompt,
        parameters: { max_new_tokens: 1500, temperature: 0.7, top_p: 0.95, do_sample: true, return_full_text: false },
        options: { wait_for_model: true, use_cache: false },
    };

    try {
        const apiResponse = await fetch(apiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const responseData = await apiResponse.json();
        if (!apiResponse.ok) {
            console.error("HF Text API Error:", responseData);
            return { error: responseData.error || `HF API Error: ${apiResponse.status}` };
        }
        return { response: responseData[0]?.generated_text.trim() };
    } catch (err) {
        console.error("Fetch to HF Text API failed:", err);
        return { error: `Request to HF API failed: ${err.message}` };
    }
}

/**
 * Image generation ke liye Hugging Face API ko call karta hai.
 * @param {string} prompt - Image banane ke liye prompt.
 * @returns {Promise<object>} - Base64 image URL ya error object.
 */
async function callHuggingFaceImageAPI(prompt) {
    if (!prompt) {
        return { error: "Input prompt for image is empty." };
    }

    try {
        const apiResponse = await fetch(IMAGE_API_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ inputs: prompt }),
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error("HF Image API Error:", errorText);
            try {
                const errorJson = JSON.parse(errorText);
                return { error: errorJson.error || `HF API Error: ${apiResponse.status}` };
            } catch (e) {
                return { error: `HF API Error: ${apiResponse.status} - ${errorText}` };
            }
        }
        
        // Image response binary hota hai, use Base64 mein convert karein
        const imageBuffer = await toArrayBuffer(apiResponse.body);
        const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
        const imageContentType = apiResponse.headers.get("content-type") || "image/jpeg";
        
        return { image_url: `data:${imageContentType};base64,${imageBase64}` };

    } catch (err) {
        console.error("Fetch to HF Image API failed:", err);
        return { error: `Request to HF Image API failed: ${err.message}` };
    }
}


// --- HTTP SERVER LOGIC ---
serve(async (req) => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Not Found. Use POST method." }), {
            status: 404,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    }

    try {
        const body = await req.json();
        const { message, model: modelKey, context } = body;

        if (!message || typeof message !== "string") {
            return new Response(JSON.stringify({ error: "Missing or invalid 'message' in request body." }), {
                status: 400,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
        }
        
        let result;
        
        // Endpoint ke aadhar par sahi function call karein
        if (url.pathname === "/generate") {
            const modelId = MODEL_MAP[modelKey] || MODEL_MAP["Nexari G1"]; // Fallback to default
            const fullPrompt = buildFullPrompt(message, context);
            result = await callHuggingFaceTextAPI(modelId, fullPrompt);

        } else if (url.pathname === "/generate-image") {
            result = await callHuggingFaceImageAPI(message);

        } else {
            return new Response(JSON.stringify({ error: "Not Found. Use /generate or /generate-image." }), {
                status: 404,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify(result), {
            status: result.error ? 500 : 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: `Invalid JSON body: ${err.message}` }), {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    }
});

console.log("Deno AI worker with Text & Image support started on http://localhost:8000");

