const handler = async (request) => {
  if (request.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  try {
    const { message } = await request.json();

    const payload = {
      inputs: message,
      parameters: {
        max_new_tokens: 100,
        return_full_text: false
      },
      options: { wait_for_model: true }
    };

    const response = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-large", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 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"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (Array.isArray(data) && data[0]?.generated_text) {
      return new Response(data[0].generated_text, { status: 200 });
    } else if (data?.generated_text) {
      return new Response(data.generated_text, { status: 200 });
    } else {
      return new Response("AI Error: " + JSON.stringify(data), { status: 500 });
    }
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
};

Deno.serve(handler);
