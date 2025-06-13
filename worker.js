// ✅ WORKER.JS (Fixed Authorization & Routing)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// 1️⃣ अपने Deno Deploy dashboard में सेट किए ENV VAR नामों से मिलाकर रखिए:
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY")!;
const ALLOWED_KEYS = (Deno.env.get("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") || "")
  .split(",")
  .map(k => k.trim())
  .filter(Boolean);

// 2️⃣ मॉडल मैप
const MODEL_MAP = {
  "Nexari G1": "tiiuae/falcon-7b"
};
const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";

// 3️⃣ CORS सेटिंग
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// 4️⃣ प्रॉम्प्ट बिल्डर
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

// 5️⃣ Retry helper
async function retryFetch(requestFn, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await requestFn();
    } catch {
      if (i === retries - 1) throw;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// 6️⃣ HF Text API call
async function callHuggingFaceTextAPI(modelId, prompt) {
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
    if (!res.ok) return { error: data.error || `Text API error: ${res.status}` };
    return { response: data[0]?.generated_text?.trim() || "" };
  });
}

// 7️⃣ HF Image API call (unchanged)
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
      let err;
      try { err = JSON.parse(errText).error; }
      catch { err = `Image API error: ${res.status}`; }
      return { error: err };
    }

    const imageBuffer = await toArrayBuffer(res.body);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    return {
      image_url: `data:${res.headers.get("content-type")};base64,${base64}`
    };
  });
}

// 8️⃣ Route handlers
const routes = {
  "/generate": async (data) => {
    const modelId = MODEL_MAP[data.model] || MODEL_MAP["Nexari G1"];
    const prompt = buildFullPrompt(data.message, data.context, data.instruction);
    return await callHuggingFaceTextAPI(modelId, prompt);
  },
  "/generate-image": async (data) => await callHuggingFaceImageAPI(data.message)
};

// 9️⃣ Server
serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Auth
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!ALLOWED_KEYS.includes(token)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  // Only POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  // Body parsing & routing
  let body;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: `Invalid JSON: ${err.message}` }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  const path = new URL(req.url).pathname;
  const handler = routes[path];
  if (!handler) {
    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  try {
    const result = await handler(body);
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
