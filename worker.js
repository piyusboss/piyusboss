// ✅ WORKER.JS (Corrected and More Robust)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// ================== FIX START ==================
// SOLUTION: Hum dono keys ko environment variables se load karenge aur unka fallback hata denge.
// Isse yeh sunishchit hoga ki sahi keys istemal ho rahi hain.

// Key 1: Hugging Face se baat karne ke liye. Yeh 'hf_...' se shuru honi chahiye.
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY");

// Key 2: Hamare PHP server se baat karne ke liye. Yeh hamari banayi hui internal key hai.
const NEXARI_PHP_KEY = Deno.env.get("NEXARI_PHP_KEY");

// Script ke shuru mein hi check karein ki keys set hain ya nahi.
if (!HUGGING_FACE_API_KEY || !NEXARI_PHP_KEY) {
  console.error("FATAL ERROR: Environment variables HUGGING_FACE_API_KEY and NEXARI_PHP_KEY must be set.");
  // Production mein script ko exit kar dena chahiye agar keys na milen.
  // Deno.exit(1); // Uncomment this line for production deployment
}
// =================== FIX END ===================

const MODEL_MAP = {
  "Nexari G1": "tiiuae/falcon-7b"
};
const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// ... (buildFullPrompt, retryFetch, and other functions remain the same) ...

async function callHuggingFaceTextAPI(modelId, prompt) {
  return retryFetch(async () => {
    const res = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
      method: "POST",
      headers: {
        // Yahan hamesha Hugging Face ki key istemal hogi.
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 1500 } })
    });
    const data = await res.json();
    if (!res.ok) {
        // Agar yahan error aata hai, to woh ab PHP script ko saaf-saaf dikhega.
        throw new Error(data.error || `Hugging Face Text API error: ${res.status}`);
    }
    return { data: data[0]?.generated_text?.replace(/\[\/INST\]/g, '').trim() || "" };
  });
}

// ... (callHuggingFaceImageAPI remains the same, it correctly uses HUGGING_FACE_API_KEY) ...

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Yahan hum PHP se aane wali internal key ko check kar rahe hain.
  const authKey = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (authKey !== NEXARI_PHP_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid key from PHP server." }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  // ... (Rest of the server logic remains the same) ...
  // [Full remaining Worker.js code as provided in the previous turn, unchanged]
  function buildFullPrompt(message, context, instruction = "") {
    const memory = context?.long_term_memory_summary || "";
    const history = context?.current_conversation || [];
    let prompt = `[INST] You are Nexari, an intelligent and helpful assistant.\n`;
    if (instruction) prompt += `Instruction: ${instruction}\n`;
    if (memory) prompt += `User history summary:\n${memory}\n\n`;
    prompt += `Conversation:\n`;
    for (const msg of history) {
      prompt += `${msg.sender === 'user' ? 'User' : 'Nexari'}: ${msg.text}\n`;
    }
    prompt += `User: ${message} [/INST]\nNexari:`;
    return prompt;
  }
  
  async function retryFetch(requestFn, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        return await requestFn();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(res => setTimeout(res, delay));
      }
    }
    return Promise.reject("Fetch failed after all retries.");
  }

  async function callHuggingFaceImageAPI(prompt) {
    return retryFetch(async () => {
      const res = await fetch(`https://api-inference.huggingface.co/models/${IMAGE_MODEL_ID}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: prompt })
      });
  
      if (!res.ok) {
        const errText = await res.text();
        let errorMsg = `Image API error: ${res.status}`;
        try {
          errorMsg = JSON.parse(errText).error || errorMsg;
        } catch (e) { /* Ignore parsing error */ }
        throw new Error(errorMsg);
      }
  
      const imageBuffer = await toArrayBuffer(res.body);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
      return {
        data: `data:${res.headers.get("content-type")};base64,${base64}`
      };
    });
  }
  
  const routes = {
    "/generate": async (data) => {
      const modelId = MODEL_MAP[data.model] || MODEL_MAP["Nexari G1"];
      const prompt = buildFullPrompt(data.message, data.context, data.instruction);
      return await callHuggingFaceTextAPI(modelId, prompt);
    },
    "/generate-image": async (data) => await callHuggingFaceImageAPI(data.message)
  };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
  
  const url = new URL(req.url);
  const routeHandler = routes[url.pathname];

  if (!routeHandler) {
    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json();
    if (!body.message) {
       return new Response(JSON.stringify({ error: "Invalid JSON: 'message' field is missing." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const result = await routeHandler(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "An internal server error occurred." }), {
      status: err instanceof SyntaxError ? 400 : 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
