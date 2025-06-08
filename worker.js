// worker.js (Deno AI worker with full context support)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- CONFIGURATION ---
// ! IMPORTANT: Use environment variables for API keys in production!
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY") || "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";
const HUGGING_FACE_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1";
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

/**
 * Builds a conversational prompt from a history array.
 * @param {Array<object>} history Array of message objects [{sender: 'user'/'ai', text: '...'}]
 * @returns {string} A formatted string for the Mixtral model.
 */
function buildPromptFromHistory(history) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return "";
  }

  let prompt = "";
  for (const message of history) {
    if (message.sender === 'user') {
      prompt += `### User: ${message.text}\n\n`;
    } else if (message.sender === 'ai') {
      prompt += `### Assistant: ${message.text}\n\n`;
    }
  }
  // The last message is from the user, so we end with the prompt for the assistant to reply.
  prompt += `### Assistant:`;
  return prompt;
}

/**
 * Calls the Hugging Face Inference API.
 * @param {string} userMessage The latest user message.
 * @param {Array<object>|null} history The full conversation history.
 * @returns {Promise<object>} An object with either a 'response' or 'error' key.
 */
async function callHuggingFaceAPI(userMessage, history) {
  const sanitizedMessage = String(userMessage || "").trim();
  if (!sanitizedMessage) {
    return { error: "Input message is empty." };
  }

  // --- LOGIC CHANGE: Use history to build the prompt ---
  // If history is provided and valid, use it. Otherwise, fall back to a simple prompt.
  const prompt = (history && history.length > 1) 
    ? buildPromptFromHistory(history)
    : `### User: ${sanitizedMessage}\n\n### Assistant:`;
  // --- END LOGIC CHANGE ---

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
        return { error: responseData.error || `HF API Error: ${apiResponse.status} ${apiResponse.statusText}` };
      }
      if (Array.isArray(responseData) && responseData[0]?.generated_text) {
        return { response: responseData[0].generated_text.trim() };
      }
      return { error: "Unexpected response format from HF API." };
    } catch (jsonErr) {
      return { error: `Non-JSON response from HF: ${rawText.substring(0, 200)}...` };
    }
  } catch (err) {
    return { error: `Request to HF API failed: ${err.message}` };
  }
}

// --- HTTP SERVER LOGIC ---
serve(async (req) => {
  const url = new URL(req.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // Restrict in production
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
        return new Response(JSON.stringify({ error: "Missing or invalid 'message' in request body." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // --- LOGIC CHANGE: Pass history to the API call ---
      const history = body.history && Array.isArray(body.history) ? body.history : null;
      const result = await callHuggingFaceAPI(body.message, history);
      // --- END LOGIC CHANGE ---

      return new Response(JSON.stringify(result), {
        status: result.error ? 502 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Invalid JSON body: ${err.message}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "Not Found. Use POST /generate." }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

console.log("Deno AI worker with context support started.");
