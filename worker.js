// worker.js (Deno)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- HUGGING FACE CONFIGURATIONS ---
// !!! IMPORTANT !!!
// 1. For production, set HUGGING_FACE_API_KEY as an environment variable in your Deno Deploy project settings.
//    Deno Deploy: Project -> Settings -> Environment Variables
// 2. The model 'meta-llama/Meta-Llama-3-8B-Instruct' is GATED. You MUST request access on Hugging Face
//    and ensure your API key has permissions. If not, use a public model like 'gpt2' for testing.
const HUGGING_FACE_API_KEY_ENV = Deno.env.get("HUGGING_FACE_API_KEY");
const FALLBACK_HUGGING_FACE_API_KEY = "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";
 // Replace if you have a different fallback, but ENV VAR is preferred
const HUGGING_FACE_API_KEY = HUGGING_FACE_API_KEY_ENV || FALLBACK_HUGGING_FACE_API_KEY;

// !!! ACTION REQUIRED: VERIFY MODEL ACCESS OR CHANGE MODEL !!!
// Using 'meta-llama/Meta-Llama-3-8B-Instruct' requires you to accept terms on Hugging Face.
// If you see 404 errors, this is the most likely cause.
// For testing, try a public model: const HUGGING_FACE_MODEL = 'gpt2';
const HUGGING_FACE_MODEL = 'meta-llama/meta-llama-3-8b-instruct';
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

if (!HUGGING_FACE_API_KEY_ENV) {
    console.warn(
        "*******************************************************************************************\n" +
        "WARNING: HUGGING_FACE_API_KEY environment variable is NOT SET.\n" +
        `Using a hardcoded fallback Hugging Face API key (starting with: ${FALLBACK_HUGGING_FACE_API_KEY.substring(0,10)}...). \n` +
        "This is INSECURE and NOT recommended for production. \n" +
        "Please set the HUGGING_FACE_API_KEY environment variable in your Deno Deploy project settings.\n" +
        "*******************************************************************************************"
    );
} else {
     console.log("Using HUGGING_FACE_API_KEY from environment variable.");
}


/**
 * Calls the Hugging Face Inference API.
 * @param {string} userMessage The message from the user.
 * @returns {Promise<object>} An object with either 'response' or 'error' key.
 */
async function callHuggingFaceAPI(userMessage) {
    const sanitizedMessage = String(userMessage || "").trim();
    if (!sanitizedMessage) {
        console.log("callHuggingFaceAPI: Input message is empty.");
        return { error: "Input message is empty. Please provide some text." };
    }

    const payload = {
        inputs: sanitizedMessage,
        parameters: {
            max_new_tokens: 300,
            temperature: 0.7,
            return_full_text: false,
        },
        options: {
            wait_for_model: true, // If model is loading, wait for it (can cause timeouts if loading is too long)
            use_cache: false
        },
    };

    console.log(`Calling Hugging Face API (${HUGGING_FACE_MODEL}) for input: "${sanitizedMessage.substring(0, 50)}..."`);

    try {
        const apiResponse = await fetch(HUGGING_FACE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        let responseData;
        let rawResponseText = ""; // To store raw text, especially for errors

        try {
            rawResponseText = await apiResponse.text(); // Read body as text first
            responseData = JSON.parse(rawResponseText); // Then try to parse as JSON
        } catch (e) {
            // JSON.parse failed. This is expected if Hugging Face returned HTML/text (e.g., for a 404)
            console.error(`Failed to parse JSON from Hugging Face API response (Status: ${apiResponse.status}). Raw text snippet: ${rawResponseText.substring(0, 200)}`, e.message);
            // We'll use rawResponseText in the error handling below if !apiResponse.ok
            responseData = null; // Indicate JSON parsing failure
        }

        if (!apiResponse.ok) {
            console.error(`Hugging Face API Error (Status: ${apiResponse.status}). Raw Response:`, rawResponseText);
            let errorMessage = `AI Model API request failed with status ${apiResponse.status}.`;

            if (responseData && responseData.error) { // If HuggingFace sent a structured JSON error
                errorMessage = `AI Model Error: ${responseData.error}`;
                if (responseData.estimated_time) {
                    errorMessage += ` The model might be loading, please try again in ~${Math.round(responseData.estimated_time)} seconds.`;
                }
            } else if (rawResponseText) { // If we have the raw text of the error page
                errorMessage = `AI Model API request failed with status ${apiResponse.status}. Response: ${rawResponseText.substring(0, 200)}... (Check Deno logs for full raw response)`;
                if (apiResponse.status === 404) {
                    errorMessage += ` This often means the model '${HUGGING_FACE_MODEL}' was not found or you don't have access. Ensure the model name is correct and you've accepted terms if it's a gated model.`;
                }
            } else { // Fallback if raw text also couldn't be read (unlikely)
                errorMessage = `AI Model API request failed with status ${apiResponse.status}. No further details could be extracted from the response.`;
            }
            return { error: errorMessage };
        }

        // If apiResponse.ok IS true, but responseData is null (JSON parsing failed on a 2xx response - very unusual)
        if (responseData === null) {
            console.error("Hugging Face API returned 2xx status but response was not valid JSON. Raw text:", rawResponseText);
            return { error: "Received an unexpected non-JSON response from the AI model despite a success status. Raw: " + rawResponseText.substring(0,200) };
        }
        
        // Standard successful response structure from Hugging Face for text generation
        if (Array.isArray(responseData) && responseData[0] && responseData[0].generated_text) {
            console.log("Hugging Face API call successful.");
            return { response: responseData[0].generated_text.trim() };
        } else if (responseData.error) { // Some models might return error in JSON even with 200 OK (less common)
            console.error("Hugging Face API returned 200 OK but with an error field in JSON:", responseData.error);
            return { error: `AI Model reported an error: ${responseData.error}` };
        } else {
            console.error("Invalid API response format from Hugging Face. Expected { generated_text: ... } within an array. Received:", responseData);
            return { error: "Received an unexpected or malformed response structure from the AI model." };
        }

    } catch (error) {
        console.error("Network or other error calling Hugging Face API:", error);
        return { error: `Failed to connect to the AI Model API. ${error.message}` };
    }
}

const PORT = parseInt(Deno.env.get("PORT") || "8000");

console.log(`Deno AI worker starting for model: ${HUGGING_FACE_MODEL}`);
console.log(`Attempting to listen on port ${PORT} (internally for Deno Deploy).`);
console.log(`Service will be available via your Deno Deploy URL at the /generate path.`);
console.log(`Ensure your PHP script (DENO_WORKER_URL) points to this Deno deployment's /generate endpoint.`);

serve(async (req) => {
    const requestUrl = new URL(req.url);
    const pathname = requestUrl.pathname;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // IMPORTANT: For production, restrict to your PHP server's domain
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', // 'Authorization' if you plan to add auth between PHP and Deno
    };

    if (req.method === 'OPTIONS') {
        console.log(`OPTIONS request received for ${pathname} from origin ${req.headers.get('Origin')}`);
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method === 'POST' && pathname === '/generate') {
        console.log(`POST request received on /generate from origin ${req.headers.get('Origin')}`);
        try {
            const contentType = req.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                console.warn("Request rejected: Content-Type must be application/json. Received:", contentType);
                return new Response(JSON.stringify({ error: 'Invalid request. Content-Type header must be application/json.' }), {
                    status: 415, // Unsupported Media Type
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            const requestBody = await req.json();
            if (!requestBody || typeof requestBody.message !== 'string' || requestBody.message.trim() === "") {
                console.warn("Invalid request body. Missing or empty 'message' string.", requestBody);
                return new Response(JSON.stringify({ error: 'Invalid request body. A non-empty "message" field (string) is required.' }), {
                    status: 400, // Bad Request
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            const userMessage = requestBody.message;
            const aiResult = await callHuggingFaceAPI(userMessage);

            if (aiResult.error) {
                // Error already logged in callHuggingFaceAPI
                return new Response(JSON.stringify({ error: aiResult.error }), { // Send HF error back to PHP
                    status: 502, // Bad Gateway (since this worker is a gateway to HF and HF failed)
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ response: aiResult.response }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        } catch (e) {
            console.error("Error processing /generate request in Deno worker:", e);
            let errorMessage = 'Internal server error in Deno worker.';
            let errorStatus = 500;
            if (e instanceof SyntaxError) { // JSON parsing error from req.json()
                errorMessage = 'Bad request: Could not parse JSON request body.';
                errorStatus = 400;
            }
            return new Response(JSON.stringify({ error: errorMessage + ` Details: ${e.message}` }), {
                status: errorStatus,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }

    console.log(`Received ${req.method} request for ${pathname} (from ${req.headers.get('Origin')}) - Path Not Found.`);
    return new Response(JSON.stringify({ error: 'Not Found. Please use the POST /generate endpoint.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}, { port: PORT });
