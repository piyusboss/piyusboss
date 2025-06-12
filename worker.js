// ✅ WORKER.JS (Final Enhanced Version)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { toArrayBuffer } from "https://deno.land/std@0.224.0/streams/to_array_buffer.ts";

const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY");
const ALLOWED_KEYS = (Deno.env.get("NEXARI_ALLOWED_KEYS") || "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").split(",");

const MODEL_MAP = {
  "Nexari G1": "meta-llama/Meta-Llama-3-8B-Instruct"
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

async function retryFetch(requestFn, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await requestFn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

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
      const err = await res.text();
      return { error: JSON.parse(err).error || `Image API error: ${res.status}` };
    }

    const imageBuffer = await toArrayBuffer(res.body);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    return {
      image_url: `data:${res.headers.get("content-type")};base64,${base64}`
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth || !ALLOWED_KEYS.includes(auth)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json();
    const routeHandler = routes[new URL(req.url).pathname];
    if (!routeHandler) {
      return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
    const result = await routeHandler(body);
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Invalid JSON: ${err.message}` }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
