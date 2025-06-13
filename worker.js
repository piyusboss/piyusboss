// ✅ WORKER.JS (Corrected for case-sensitivity)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// Key 1: Hugging Face se baat karne ke liye. Yeh 'hf_...' se shuru honi chahiye.
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY");

// Key 2: Hamare PHP server se baat karne ke liye. Yeh hamari banayi hui internal key hai.
const NEXARI_PHP_KEY = Deno.env.get("NEXARI_PHP_KEY");

// Script ke shuru mein hi check karein ki keys set hain ya nahi.
if (!HUGGING_FACE_API_KEY || !NEXARI_PHP_KEY) {
  console.error("FATAL ERROR: Environment variables HUGGING_FACE_API_KEY and NEXARI_PHP_KEY must be set.");
  // Deno.exit(1); // Production deployment ke liye is line ko uncomment karein
}

const MODEL_MAP = {
  "Nexari G1": "tiiuae/falcon-7b"
};
const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

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

// ================== FIX START ==================
// YEH HAI SAHI DEFINITION (chhota 'r')
async function retryFetch(requestFn, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      // Yahan await lagana zaroori hai
      return await requestFn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
  // Is line ki zaroorat nahi hai agar loop hamesha return ya throw karega
  // lekin ise fallback ke liye rakha ja sakta hai.
  return Promise.reject("Fetch failed after all retries.");
}

async function callHuggingFaceTextAPI(modelId, prompt) {
  // YEH HAI SAHI CALL (chhota 'r')
  return retryFetch(async () => {
    const res = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 1500 } })
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || `Hugging Face Text API error: ${res.status}`);
    }
    return { data: data[0]?.generated_text?.replace(/\[\/INST\]/g, '').trim() || "" };
  });
}

async function callHuggingFaceImageAPI(prompt) {
  // YEH HAI SAHI CALL (chhota 'r')
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
// =================== FIX END ===================

const routes = {
  "/generate": async (data) => {
    const modelId = MODEL_MAP[data.model] || MODEL_MAP["Nexari G1"];
    const prompt = buildFullPrompt(data.message, data.context, data.instruction);
    return await callHuggingFaceTextAPI(modelId, prompt);
  },
  "/generate-image": async (data) => await callHuggingFaceImageAPI(data.message)
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const authKey = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (authKey !== NEXARI_PHP_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid key from PHP server." }), {
      status: 401,
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
    console.error("Handler Error:", err); // Server-side error logging ko behtar banayein
    return new Response(JSON.stringify({ error: err.message || "An internal server error occurred." }), {
      status: err instanceof SyntaxError ? 400 : 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
