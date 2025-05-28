// deno-lint-ignore-file no-explicit-any
const handler = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  try {
    const body: any = await request.json();
    const message: string = body.message || "";

    const payload = {
      inputs: `### Instruction:\n${message}\n\n### Response:`,
      options: { wait_for_model: true }
    };

    const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data[0]?.generated_text) {
      const reply = data[0].generated_text.replace(/^.*### Response:/s, "").trim();
      return new Response(reply, { status: 200 });
    } else {
      return new Response("AI model didn't respond properly: " + JSON.stringify(data), { status: 500 });
    }

  } catch (err) {
    return new Response("Server Error: " + err.toString(), { status: 500 });
  }
};

Deno.serve(handler);
