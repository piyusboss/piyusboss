// worker.js

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HF_KEY   = Deno.env.get("HUGGING_FACE_API_KEY")!;
const HF_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";
const HF_URL   = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

async function callHuggingFaceAPI(text) {
  if (!text.trim()) {
    return { error: "Input message is empty." };
  }
  const payload = {
    inputs: text,
    parameters: { max_new_tokens: 300, temperature: 0.7, return_full_text: false },
    options: { wait_for_model: true, use_cache: false },
  };

  let resp;
  try {
    resp = await fetch(HF_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (NetworkError) {
    return { error: `Network error: ${NetworkError.message}` };
  }

  // If HF gives us anything but a 200, pull its raw body:
  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`HF ${resp.status} →`, txt);
    if (resp.status === 404) {
      return { error: "Hugging Face model not found (404)." };
    }
    return { error: `Hugging Face API error (${resp.status}): ${txt}` };
  }

  // Now try to parse JSON
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    const raw = await resp.text();
    console.error("Failed JSON parse →", raw);
    return { error: "Invalid JSON from Hugging Face." };
  }

  if (Array.isArray(data) && data[0]?.generated_text) {
    return { response: data[0].generated_text.trim() };
  }

  console.error("Unexpected HF response format:", data);
  return { error: "Unexpected format from HF API." };
}

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname === '/generate') {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Must be application/json" }), {
        status: 415, headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Bad JSON in request" }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    const msg = body.message;
    if (typeof msg !== 'string' || !msg.trim()) {
      return new Response(JSON.stringify({ error: "No message provided" }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    const ai = await callHuggingFaceAPI(msg);
    const status = ai.error ? 500 : 200;
    return new Response(JSON.stringify(ai), {
      status, headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  // anything else → not found
  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
  });
});
