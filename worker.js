// ✅ WORKER.JS (Fixed for Stable JSON & Env Keys)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

// 🌐 Env keys – Deno Deploy settings में इन्हें define करना होगा
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY") || "";
const ALLOWED_KEYS = (Deno.env.get("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") || "").split(",").filter(k => k);

// 🔄 Model mapping
const MODEL_MAP = {
  "Nexari G1": "tiiuae/falcon-7b"
};
const IMAGE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0";

// CORS headers
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// 🛠 Build prompt string
function buildFullPrompt(message, context, instruction = "") {
  let prompt = `[INST] You are Nexari, an intelligent and helpful assistant.\n`;
  if (instruction) prompt += `Instruction: ${instruction}\n`;
  const history = context?.current_conversation || [];
  if (history.length) {
    prompt += `Conversation:\n`;
    for (const msg of history) {
      prompt += `${msg.sender === 'user' ? 'User' : 'Nexari'}: ${msg.text}\n`;
    }
  }
  prompt += `User: ${message} [/INST]\nNexari:`;
  return prompt;
}

// 🔄 Safe fetch with retry
async function callHuggingFace(model, prompt) {
  let lastError;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 1500 } })
        }
      );
      const data = await res.json().catch(_ => ({ error: `Invalid JSON from HF (status ${res.status})` }));
      if (!res.ok || data.error) {
        lastError = data.error || `HF error: ${res.status}`;
        throw new Error(lastError);
      }
      return { response: data[0]?.generated_text?.trim() || "" };
    } catch (err) {
      lastError = err.message;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { error: `HuggingFace call failed: ${lastError}` };
}

async function callHuggingFaceImage(prompt) {
  const res = await fetch(
    `https://api-inference.huggingface.co/models/${IMAGE_MODEL_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    const err = JSON.parse(text).error || `Image API error: ${res.status}`;
    return { error: err };
  }
  const buffer = await toArrayBuffer(res.body);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return { image_url: `data:${res.headers.get("content-type")};base64,${base64}` };
}

const routes = {
  "/generate": async (data) => {
    const modelId = MODEL_MAP[data.model] || MODEL_MAP["Nexari G1"];
    const prompt = buildFullPrompt(data.message, data.context);
    return await callHuggingFace(modelId, prompt);
  },
  "/generate-image": async (data) => {
    return await callHuggingFaceImage(data.message);
  }
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Auth check
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!ALLOWED_KEYS.includes(auth)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  const path = new URL(req.url).pathname;
  const handler = routes[path];
  if (!handler) {
    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
      status: 404,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  const result = await handler(payload);
  return new Response(JSON.stringify(result), {
    status: result.error ? 500 : 200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
});
