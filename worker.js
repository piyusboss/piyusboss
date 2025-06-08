// worker.js (Improved Deno AI worker for Mixtral)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- CONFIGURATION ---
// IMPORTANT: Store API keys securely, preferably using environment variables in production.
const HUGGING_FACE_API_KEY = "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"; // आपका Hugging Face API की
const HUGGING_FACE_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1"; // उपयोग किया जाने वाला मॉडल
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`; // API एंडपॉइंट

/**
 * Calls the Hugging Face Inference API to get a response from the AI model.
 * @param {string} userMessage The message from the user.
 * @returns {Promise<object>} An object with either 'response' (AI's reply) or 'error' key.
 */
async function callHuggingFaceAPI(userMessage) {
  // 1. Sanitize user input: Trim whitespace. Empty messages are rejected.
  const sanitizedMessage = String(userMessage || "").trim();
  if (!sanitizedMessage) {
    return { error: "Input message is empty. कृपया कुछ टेक्स्ट दर्ज करें।" };
  }

  // 2. Prepare the prompt for Mixtral:
  // Mixtral-Instruct models often perform better with a specific prompt structure.
  // This format clearly delineates user input and signals where the assistant's response should begin.
  const prompt = `### User: ${sanitizedMessage}\n\n### Assistant:`;

  // 3. Define the payload for the Hugging Face API:
  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 512,     // AI द्वारा उत्पन्न किए जाने वाले अधिकतम नए टोकन (शब्दों/उपशब्दों की अनुमानित संख्या)।
      temperature: 0.7,        // रैंडमनेस का स्तर। उच्च मान अधिक रचनात्मक लेकिन कम सुसंगत प्रतिक्रियाएँ उत्पन्न करते हैं। 0.7 एक अच्छा संतुलन है।
      top_p: 0.9,              // न्यूक्लियस सैंपलिंग। यह संभाव्यता द्रव्यमान के शीर्ष p% से टोकन का चयन करता है।
      do_sample: true,         // यदि सही है, तो तापमान और top_p का उपयोग करके सैंपलिंग की जाती है। अन्यथा, ग्रीडी डीकोडिंग का उपयोग किया जाता है।
      return_full_text: false, // यदि गलत है, तो केवल उत्पन्न टेक्स्ट लौटाता है (प्रॉम्प्ट को छोड़कर)।
    },
    options: {
      wait_for_model: true,    // यदि मॉडल लोड हो रहा है, तो अनुरोध को कतार में रखें और प्रतीक्षा करें।
      use_cache: false,        // API साइड पर कैशिंग को अक्षम करता है ताकि हर बार नई प्रतिक्रिया मिले (डिबगिंग/विशिष्ट उपयोगों के लिए उपयोगी)।
    },
  };

  try {
    // 4. Make the API request to Hugging Face:
    const apiResponse = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`, // API की ऑथेंटिकेशन के लिए।
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload), // पेलोड को JSON स्ट्रिंग में बदलें।
    });

    // 5. Get the raw response text:
    const rawText = await apiResponse.text();

    // 6. Attempt to parse the response as JSON:
    // Hugging Face API आमतौर पर JSON में प्रतिक्रिया देती है, लेकिन त्रुटियां या गैर-मानक प्रतिक्रियाएं सादा पाठ हो सकती हैं।
    try {
      const responseData = JSON.parse(rawText);

      // 7. Handle API errors if the response was not OK (e.g., 4xx, 5xx status codes):
      if (!apiResponse.ok) {
        // Hugging Face API द्वारा प्रदान की गई त्रुटि का उपयोग करें, या एक सामान्य त्रुटि प्रदान करें।
        return {
          error: responseData.error || `Error from HF API: ${apiResponse.status} - ${apiResponse.statusText || rawText}`,
        };
      }

      // 8. Extract the generated text if the response is successful and in the expected format:
      // API प्रतिक्रिया एक ऐरे हो सकती है जिसमें उत्पन्न टेक्स्ट वाला ऑब्जेक्ट होता है।
      if (Array.isArray(responseData) && responseData[0]?.generated_text) {
        return { response: responseData[0].generated_text.trim() };
      }

      // 9. Handle unexpected successful response format:
      return { error: "Unexpected response format from Hugging Face API. प्रतिक्रिया प्रारूप अपेक्षित नहीं था।" };
    } catch (jsonErr) {
      // 10. Handle cases where the response was not valid JSON:
      // यह तब हो सकता है जब API गेटवे या मध्यस्थ कोई HTML त्रुटि पृष्ठ या सादा पाठ त्रुटि लौटाता है।
      return { error: `Non-JSON response from Hugging Face: ${rawText.substring(0, 200)}... (Hugging Face से गैर-JSON प्रतिक्रिया)` };
    }
  } catch (err) {
    // 11. Handle network errors or other issues with the fetch request itself:
    return { error: `Request to Hugging Face API failed: ${err.message}. (Hugging Face API के लिए अनुरोध विफल)` };
  }
}

// --- HTTP SERVER LOGIC ---
// This function handles incoming HTTP requests to the Deno worker.
serve(async (req) => {
  const url = new URL(req.url);

  // CORS Headers: Allow cross-origin requests.
  // For production, restrict Access-Control-Allow-Origin to your specific frontend domain.
  // Example: "Access-Control-Allow-Origin": "https://your-frontend.com"
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // सभी डोमेन को अनुमति देता है (विकास के लिए ठीक है, उत्पादन के लिए प्रतिबंधित करें)।
    "Access-Control-Allow-Methods": "POST, OPTIONS", // अनुमत HTTP विधियाँ।
    "Access-Control-Allow-Headers": "Content-Type, Authorization", // अनुमत हेडर।
  };

  // Handle OPTIONS requests (preflight requests for CORS)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders }); // 204 No Content
  }

  // Handle POST requests to the /generate endpoint
  if (req.method === "POST" && url.pathname === "/generate") {
    try {
      // 1. Parse the incoming JSON body from the request:
      const body = await req.json();

      // 2. Validate that the 'message' field exists and is a string:
      if (!body.message || typeof body.message !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'message' in request body. 'message' फ़ील्ड गायब या अमान्य है।" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } } // 400 Bad Request
        );
      }

      // 3. Call the Hugging Face API with the user's message:
      const result = await callHuggingFaceAPI(body.message);

      // 4. Send the response (either AI's reply or an error) back to the client:
      return new Response(JSON.stringify(result), {
        status: result.error ? 502 : 200, // 502 Bad Gateway if error, 200 OK if success
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      // Handle errors during request body parsing (e.g., invalid JSON):
      return new Response(
        JSON.stringify({ error: `Invalid JSON body. ${err.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Handle any other requests with a 404 Not Found error:
  return new Response(
    JSON.stringify({ error: "Not Found. Use POST /generate. निर्दिष्ट पथ नहीं मिला।" }),
    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

console.log("Deno AI worker started and listening for requests on http://localhost:8000 (typically, Deno Deploy manages the port)");
