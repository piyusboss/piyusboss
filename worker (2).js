const handler = async (request) => {
  if (request.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  try {
    const { message } = await request.json();

    const payload = {
      inputs: `### Instruction:\n${message}\n\n### Response:`,
      options: { wait_for_model: true }
    };

    const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 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"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data[0]?.generated_text) {
      const reply = data[0].generated_text.replace(/^.*### Response:/s, "").trim();
      return new Response(reply, { status: 200 });
    }

    return new Response("AI Error: " + JSON.stringify(data), { status: 500 });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
};

Deno.serve(handler);
