// worker(2).js (Fallback with public free model)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HUGGING_FACE_API_KEY = "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"; // still used if required
const HUGGING_FACE_MODEL = "tiiuae/falcon-rw-1b"; // ✅ Free & public text generation model
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

async function callHuggingFaceAPI(userMessage) {
  const sanitizedMessage = String(userMessage || "").trim();
  if (!sanitizedMessage) return { error: "Input message is empty." };

  const prompt = `You are Nexari AI, a helpful assistant.\n\n### User: ${sanitizedMessage}\n\n### Assistant:`;

  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 300,
      temperature: 0.7,
      top_p: 0.9,
      do_sample: true,
      return_full_text: false,
    },
    options: {
      wait_for_model: true,
    },
  };

  try {
    const res = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    try {
      const parsed = JSON.parse(rawText);
      if (!res.ok) return { error: parsed.error || `HF API error: ${res.status}` };
      if (Array.isArray(parsed) && parsed[0]?.generated_text) {
        return { response: parsed[0].generated_text.trim() };
      }
      return { error: "Unexpected response structure." };
    } catch {
      return { error: `Non-JSON response: ${rawText}` };
    }
  } catch (err) {
    return { error: `Network error: ${err.message}` };
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "POST" && url.pathname === "/generate") {
    try {
      const body = await req.json();
      if (!body.message || typeof body.message !== "string") {
        return new Response(JSON.stringify({ error: "Missing or invalid 'message'." }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const result = await callHuggingFaceAPI(body.message);
      return new Response(JSON.stringify(result), {
        status: result.error ? 502 : 200,
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Bad request: ${err.message}` }), {
        status: 400,
        headers: corsHeaders,
      });
    }
  }

  return new Response(JSON.stringify({ error: "Not Found. Use POST /generate." }), {
    status: 404,
    headers: corsHeaders,
  });
});
