// worker.js – Free Version using GPT2 (No Auth Needed)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
      max_new_tokens: 100, // Max tokens for the generated response
      temperature: 0.7,    // Controls randomness. Lower is more deterministic.
      return_full_text: false, // Only return the generated part
    },
    options: {
      wait_for_model: true, // Wait if the model is not immediately available (can sometimes timeout)
      use_cache: false,     // Disable cache to ensure fresh results, can be true for performance
    },
  };

  console.log(`Sending payload to Hugging Face API (${HUGGING_FACE_API_URL}):`, JSON.stringify(payload));

  try {
    const res = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // If you had a Hugging Face token for a private model or higher rate limits:
        // "Authorization": "Bearer YOUR_HF_READ_TOKEN" 
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    // Log the beginning of the raw response to avoid excessively long log entries
    console.log(`Hugging Face API Response Status: ${res.status} ${res.statusText}`);
    console.log(`Hugging Face API Raw Response Body (first 500 chars): ${rawText.substring(0, 500)}${rawText.length > 500 ? '...' : ''}`);

    if (!res.ok) {
      let errorMessage = `HF API error: ${res.status} ${res.statusText}`;
      try {
        // Try to parse error from Hugging Face (they often send JSON errors)
        const parsedError = JSON.parse(rawText);
        if (parsedError && parsedError.error) {
          // e.g. { "error": "Model is currently loading", "estimated_time": 20.0 }
          errorMessage = `HF API error: ${parsedError.error} (Status: ${res.status})`;
          if(parsedError.estimated_time) {
            errorMessage += ` Estimated time: ${parsedError.estimated_time}s.`;
          }
        } else if (parsedError) {
          // Other JSON error structure
          errorMessage = `HF API error: ${JSON.stringify(parsedError)} (Status: ${res.status})`;
        }
      } catch (e) {
        // If rawText was not JSON, use the rawText as part of the error.
        errorMessage = `HF API error: ${res.status} ${res.statusText}. Response (first 200 chars): ${rawText.substring(0, 200)}${rawText.length > 200 ? '...' : ''}`;
      }
      console.error("callHuggingFaceAPI Error (response not ok):", errorMessage);
      return { error: errorMessage };
    }

    try {
      const parsed = JSON.parse(rawText);
      // Successful response structure for text generation is typically: [{ "generated_text": "..." }]
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.generated_text === 'string') {
        console.log("Hugging Face API Success, generated_text:", parsed[0].generated_text);
        return { response: parsed[0].generated_text.trim() };
      } else if (parsed.error) { 
         // Some models might return an error even with 200 OK if input is bad for the model
         console.error("callHuggingFaceAPI Error: HF returned 200 OK but with an error in JSON payload:", parsed.error);
         return { error: `HF API reported error: ${parsed.error}` };
      } else {
        console.error("callHuggingFaceAPI Error: Unexpected JSON structure from HF. Raw:", rawText);
        return { error: "Unexpected response structure from AI service." };
      }
    } catch (e) {
      console.error("callHuggingFaceAPI Error: Failed to parse JSON response from HF:", e.message, "Raw Text (first 200 chars):", rawText.substring(0,200));
      return { error: `Non-JSON response from AI service. Raw (first 200 chars): ${rawText.substring(0,200)}${rawText.length > 200 ? '...' : ''}` };
    }
  } catch (err) {
    // This catches network errors, DNS issues, etc. for the fetch call itself.
    console.error("callHuggingFaceAPI Fetch/Network Error:", err.message, err.stack);
    return { error: `Network error while contacting AI service: ${err.message}` };
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  // Standard CORS headers - IMPORTANT: Restrict Access-Control-Allow-Origin in production
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // For development. In production, set to your frontend's specific origin.
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", // Authorization often included for robust CORS
  };

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    console.log(`OPTIONS request received for: ${url.pathname}. Responding with 204.`);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log(`Request received: ${req.method} ${url.pathname}`);

  // Only allow POST requests to /generate
  if (req.method === "POST" && url.pathname === "/generate") {
    let body;
    try {
      // Ensure Content-Type is application/json, otherwise req.json() might fail or hang
      if (!req.headers.get("content-type")?.includes("application/json")) {
          console.error("Invalid request: Content-Type must be application/json.");
          return new Response(JSON.stringify({ error: "Invalid request: Content-Type must be application/json." }), {
            status: 415, // Unsupported Media Type
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
      }
      body = await req.json();
      console.log("Request body parsed successfully:", body);

      if (!body.message || typeof body.message !== "string") {
        console.error("Invalid request: Missing or invalid 'message' (string) in POST body.");
        return new Response(JSON.stringify({ error: "Missing or invalid 'message' (string) in POST body." }), {
          status: 400, // Bad Request
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      console.error("Invalid request: Failed to parse JSON body.", err.message);
      return new Response(JSON.stringify({ error: `Bad request: Could not parse JSON body. ${err.message}` }), {
        status: 400, // Bad Request
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing message: "${body.message}"`);
    const result = await callHuggingFaceAPI(body.message);

    // 502 Bad Gateway if our worker failed to get a proper response from the upstream AI service (Hugging Face)
    const responseStatus = result.error ? 502 : 200;
    console.log(`Responding to PHP with status ${responseStatus}, result:`, result);

    return new Response(JSON.stringify(result), {
      status: responseStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" }, // Ensure response is JSON
    });
  }

  // Fallback for other paths or methods
  console.log(`Not Found: ${req.method} ${url.pathname}. Responding with 404.`);
  return new Response(JSON.stringify({ error: "Not Found. Please use POST /generate." }), {
    status: 404, // Not Found
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

console.log("Deno worker started. Listening for requests on http://localhost:8000 (if run locally with deno run --allow-net --allow-env worker.js)");
// On Deno Deploy, it will listen on the appropriate port.
