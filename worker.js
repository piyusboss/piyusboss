// worker.js (Deno)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"; // Ensure you are using a recent stable version

// --- HUGGING FACE CONFIGURATIONS ---
// !!! IMPORTANT !!!
// For production, set HUGGING_FACE_API_KEY as an environment variable in your Deno Deploy project settings.
// Deno Deploy: Project -> Settings -> Environment Variables
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY") || "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"; // Fallback for local testing or if env var is not set
const HUGGING_FACE_MODEL = 'meta-llama/Meta-Llama-3-8B-Instruct'; // Or your preferred model
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

if (HUGGING_FACE_API_KEY === "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" && !Deno.env.get("HUGGING_FACE_API_KEY")) {
    console.warn(
        "*******************************************************************************************\n" +
        "WARNING: Using a hardcoded fallback Hugging Face API key.\n" +
        "This is INSECURE for production. Please set the HUGGING_FACE_API_KEY environment variable \n" +
        "in your Deno Deploy project settings.\n" +
        "*******************************************************************************************"
    );
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
            wait_for_model: true,
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

        // Try to parse JSON regardless of response.ok to get error details from API
        const responseData = await apiResponse.json().catch(e => {
            console.error("Failed to parse JSON from Hugging Face API response:", e);
            return { error_parsing_response: e.message, raw_text: "Could not get raw text if parse failed early" }; // Or try to get raw text if possible
        });


        if (!apiResponse.ok) {
            console.error(`Hugging Face API Error (Status: ${apiResponse.status}):`, responseData);
            let errorMessage = `AI Model API error (${apiResponse.status}).`;
            if (responseData && responseData.error) { // HuggingFace specific error format
                errorMessage = `AI Model Error: ${responseData.error}`;
                if (responseData.estimated_time) {
                     errorMessage += ` The model might be loading, please try again in ~${Math.round(responseData.estimated_time)} seconds.`;
                }
            } else if (responseData && responseData.error_parsing_response) {
                 errorMessage = `AI Model API returned non-JSON error (${apiResponse.status}). Check logs.`;
            }
            return { error: errorMessage };
        }

        if (responseData && Array.isArray(responseData) && responseData[0] && responseData[0].generated_text) {
            console.log("Hugging Face API call successful.");
            return { response: responseData[0].generated_text.trim() };
        } else {
            console.error("Invalid API response format from Hugging Face:", responseData);
            return { error: "Received an unexpected or malformed response from the AI model." };
        }
    } catch (error) {
        console.error("Network or other error calling Hugging Face API:", error);
        return { error: `Failed to connect to the AI Model API. ${error.message}` };
    }
}

// Deno Deploy will often provide the port via an environment variable (PORT)
// or assign one automatically. For local development, 8000 is fine.
const PORT = parseInt(Deno.env.get("PORT") || "8000");

console.log(`Deno AI worker starting... It will be available via your Deno Deploy URL.`);
console.log(`Local development: Attempting to listen on http://localhost:${PORT}/generate (if not on Deno Deploy)`);
console.log(`Listening for POST requests on the /generate path.`);

serve(async (req) => {
    const requestUrl = new URL(req.url); // Deno Deploy provides the full URL
    const pathname = requestUrl.pathname;

    // --- CORS Headers ---
    // IMPORTANT: For production, restrict Access-Control-Allow-Origin to your PHP server's domain.
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Allows all origins for testing
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        console.log(`Received OPTIONS request for ${pathname} from origin ${req.headers.get('Origin')}`);
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- Request Routing ---
    if (req.method === 'POST' && pathname === '/generate') {
        console.log(`Received POST request on /generate from origin ${req.headers.get('Origin')}`);
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
                 return new Response(JSON.stringify({ error: aiResult.error }), {
                    status: 500, // Internal Server Error (could be more specific if AI model returns codes)
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ response: aiResult.response }), {
                status: 200, // OK
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

    // Fallback for other paths
    console.log(`Received ${req.method} request for ${pathname} from origin ${req.headers.get('Origin')} - Path Not Found.`);
    return new Response(JSON.stringify({ error: 'Not Found. Please use the POST /generate endpoint.' }), {
        status: 404, // Not Found
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}, { port: PORT }); // Deno Deploy will manage the actual external port.
