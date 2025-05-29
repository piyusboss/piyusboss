// worker.js (Deno)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"; // Using a recent stable version

// --- HUGGING FACE CONFIGURATIONS ---
// !!! IMPORTANT !!!
// It's STRONGLY RECOMMENDED to use environment variables for your API key in production.
// To set an environment variable before running: export HUGGING_FACE_API_KEY="your_actual_key_here"
const HUGGING_FACE_API_KEY = Deno.env.get("HUGGING_FACE_API_KEY") || "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"; // Fallback to the key you provided
const HUGGING_FACE_MODEL = 'meta-llama/Meta-Llama-3-8B-Instruct'; // Or your preferred model
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;

if (HUGGING_FACE_API_KEY === "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" && !Deno.env.get("HUGGING_FACE_API_KEY")) {
    console.warn(
        "*******************************************************************************************\n" +
        "WARNING: Using a hardcoded fallback Hugging Face API key.\n" +
        "For security and best practices, please set the HUGGING_FACE_API_KEY environment variable.\n" +
        "Example: export HUGGING_FACE_API_KEY='your_real_hf_api_key'\n" +
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
            max_new_tokens: 300,       // Max length of the generated response
            temperature: 0.7,          // Creativity of the response (0.1-1.0)
            return_full_text: false,   // Avoid getting the input prompt back
            // top_p: 0.9,             // Nucleus sampling: consider if needed
            // repetition_penalty: 1.1, // Penalize repetition: consider if needed
        },
        options: {
            wait_for_model: true,      // If the model is loading, wait for it
            use_cache: false           // Disable cache if you want fresh responses always
        },
    };

    console.log(`Calling Hugging Face API for model ${HUGGING_FACE_MODEL} with input: "${sanitizedMessage.substring(0,50)}..."`);

    try {
        const apiResponse = await fetch(HUGGING_FACE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const responseData = await apiResponse.json();

        if (!apiResponse.ok) {
            console.error(`Hugging Face API Error (Status: ${apiResponse.status}):`, responseData);
            let errorMessage = `AI Model API error (${apiResponse.status})`;
            if (responseData && responseData.error) {
                errorMessage = `AI Model Error: ${responseData.error}`;
                if (responseData.estimated_time) {
                     errorMessage += ` The model might be loading, please try again in ~${Math.round(responseData.estimated_time)} seconds.`;
                }
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

const PORT = 8000;
console.log(`Deno AI worker starting on http://localhost:${PORT} ...`);
console.log(`Will listen for POST requests on /generate`);

serve(async (req) => {
    const requestUrl = new URL(req.url);
    const pathname = requestUrl.pathname;

    // --- CORS Headers ---
    // IMPORTANT: For production, restrict Access-Control-Allow-Origin to your PHP server's domain.
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Allows all origins
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Ensure PHP sends Content-Type
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        console.log(`Received OPTIONS request for ${pathname}`);
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- Request Routing ---
    if (req.method === 'POST' && pathname === '/generate') {
        console.log(`Received POST request on /generate`);
        try {
            if (!req.headers.get("content-type") || !req.headers.get("content-type").includes("application/json")) {
                console.warn("Request does not have Content-Type: application/json");
                 return new Response(JSON.stringify({ error: 'Invalid request. Content-Type must be application/json.' }), {
                    status: 415, // Unsupported Media Type
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            const requestBody = await req.json();
            if (!requestBody || typeof requestBody.message !== 'string') {
                console.warn("Invalid request body. Missing 'message' string.", requestBody);
                return new Response(JSON.stringify({ error: 'Invalid request body. A "message" field (string) is required.' }), {
                    status: 400, // Bad Request
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            const userMessage = requestBody.message;
            const aiResult = await callHuggingFaceAPI(userMessage);

            if (aiResult.error) {
                 return new Response(JSON.stringify({ error: aiResult.error }), {
                    status: 500, // Internal Server Error (or a more specific one if possible)
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
            if (e instanceof SyntaxError) { // Likely JSON parsing error
                errorMessage = 'Bad request: Could not parse JSON body.';
                 return new Response(JSON.stringify({ error: errorMessage }), {
                    status: 400, // Bad Request
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ error: errorMessage + ` ${e.message}` }), {
                status: 500, // Internal Server Error
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }

    // Fallback for other paths
    console.log(`Received ${req.method} request for ${pathname} - Not Found.`);
    return new Response(JSON.stringify({ error: 'Not Found. Please use POST /generate endpoint.' }), {
        status: 404, // Not Found
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}, { port: PORT });
