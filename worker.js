// worker.js (Improved Deno AI worker for Mixtral)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HUGGING_FACE_API_KEY = "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";
const HUGGING_FACE_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1";
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

/**
 * Calls the Hugging Face Inference API.
 * @param {string} userMessage The message from the user.
 * @returns {Promise<object>} An object with either 'response' or 'error' key.
 */
async function callHuggingFaceAPI(userMessage) {
  const sanitizedMessage = String(userMessage || "").trim();
  if (!sanitizedMessage) {
    return { error: "Input message is empty." };
  }

  // Use prompt format suited for Mixtral
  const prompt = `### User: ${sanitizedMessage}\n\n### Assistant:`;

  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 512,
      temperature: 0.7,
      top_p: 0.9,
      do_sample: true,
      return_full_text: false,
    },
    options: {
      wait_for_model: true,
      use_cache: false,
    },
  };

  try {
    const apiResponse = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await apiResponse.text();

    try {
      const responseData = JSON.parse(rawText);

      if (!apiResponse.ok) {
        return {
          error: responseData.error || `Error from HF API: ${apiResponse.status}`,
        };
      }

      if (Array.isArray(responseData) && responseData[0]?.generated_text) {
        return { response: responseData[0].generated_text.trim() };
      }

      return { error: "Unexpected response format from Hugging Face API." };
    } catch (jsonErr) {
      return { error: `Non-JSON response from Hugging Face: ${rawText}` };
    }
  } catch (err) {
    return { error: `Request failed: ${err.message}` };
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
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'message'." }),
          { status: 400, headers: corsHeaders }
        );
      }

      const result = await callHuggingFaceAPI(body.message);
      return new Response(JSON.stringify(result), {
        status: result.error ? 502 : 200,
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Invalid JSON body. ${err.message}` }),
        { status: 400, headers: corsHeaders }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Not Found. Use POST /generate." }),
    { status: 404, headers: corsHeaders }
  );
});
