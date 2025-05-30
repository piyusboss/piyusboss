// worker.js – Free Version using GPT2 (with API key)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HUGGING_FACE_API_KEY = "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"; // ✅ Free-tier HF token
const HUGGING_FACE_MODEL = "gpt2"; // ✅ 100% free and public model
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

async function callHuggingFaceAPI(userMessage) {
  const sanitizedMessage = String(userMessage || "").trim();
  if (!sanitizedMessage) {
    console.error("callHuggingFaceAPI Error: Input message is empty.");
    return { error: "Input message is empty." };
  }

  const payload = {
    inputs: sanitizedMessage,
    parameters: {
      max_new_tokens: 100,
      temperature: 0.7,
      return_full_text: false,
    },
    options: {
      wait_for_model: true,
      use_cache: false,
    },
  };

  try {
    const res = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    console.log(`Hugging Face API Response Status: ${res.status}`);

    if (!res.ok) {
      let errorMessage = `HF API error: ${res.status} ${res.statusText}`;
      try {
        const parsedError = JSON.parse(rawText);
        if (parsedError?.error) {
          errorMessage = `HF API error: ${parsedError.error} (Status: ${res.status})`;
          if (parsedError.estimated_time) {
            errorMessage += ` Estimated time: ${parsedError.estimated_time}s.`;
          }
        }
      } catch (e) {
        errorMessage += ` Response: ${rawText.substring(0, 200)}`;
      }
      return { error: errorMessage };
    }

    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed) && parsed[0]?.generated_text) {
        return { response: parsed[0].generated_text.trim() };
      } else if (parsed.error) {
        return { error: `HF API reported error: ${parsed.error}` };
      } else {
        return { error: "Unexpected response structure from AI service." };
      }
    } catch (e) {
      return { error: `Non-JSON response from AI service. Raw: ${rawText.substring(0, 200)}` };
    }
  } catch (err) {
    return { error: `Network error while contacting AI service: ${err.message}` };
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
    let body;
    try {
      if (!req.headers.get("content-type")?.includes("application/json")) {
        return new Response(JSON.stringify({ error: "Invalid request: Content-Type must be application/json." }), {
          status: 415,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = await req.json();
      if (!body.message || typeof body.message !== "string") {
        return new Response(JSON.stringify({ error: "Missing or invalid 'message' (string) in POST body." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: `Bad request: Could not parse JSON body. ${err.message}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await callHuggingFaceAPI(body.message);
    return new Response(JSON.stringify(result), {
      status: result.error ? 502 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Not Found. Please use POST /generate." }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
