// Deno-compatible worker.js for HuggingFace inference

// Set your HuggingFace model URL (public model, no token needed for free use)
const HF_MODEL_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST method is allowed", { status: 405 });
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response("Missing or invalid 'message' field", { status: 400 });
    }

    const prompt = `### Instruction:\n${message}\n\n### Response:`;

    const hfResponse = await fetch(HF_MODEL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: prompt,
        options: { wait_for_model: true }
      })
    });

    const result = await hfResponse.json();

    if (Array.isArray(result) && result[0]?.generated_text) {
      const reply = result[0].generated_text.replace(/^.*### Response:/s, "").trim();
      return new Response(reply, { status: 200 });
    } else if (result?.error) {
      return new Response("HuggingFace API error: " + result.error, { status: 503 });
    } else {
      return new Response("Unexpected response from HuggingFace", { status: 500 });
    }
  } catch (err) {
    return new Response("Server Error: " + err.message, { status: 500 });
  }
});
