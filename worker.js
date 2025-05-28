// worker.js

const HUGGING_FACE_API_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1";
const HF_TOKEN = "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"; // नया टोकन यहाँ है

const handler = async (request) => {
  if (request.method !== "POST") {
    return new Response("केवल POST अनुरोधों की अनुमति है। (Only POST requests are allowed.)", { status: 405 });
  }

  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return new Response("अनुरोध में 'message' फ़ील्ड आवश्यक है और यह एक नॉन-एम्प्टी स्ट्रिंग होनी चाहिए। ('message' field is required in the request and it must be a non-empty string.)", { status: 400 });
    }

    const payload = {
      inputs: `### Instruction:\n${message}\n\n### Response:`,
      options: { wait_for_model: true } // मॉडल के लोड होने तक प्रतीक्षा करें
    };

    const response = await fetch(HUGGING_FACE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_TOKEN}` // टोकन का उपयोग
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok && data && data[0]?.generated_text) {
      // मॉडल द्वारा उत्पन्न टेक्स्ट से प्रॉम्प्ट के हिस्से को हटाना
      const reply = data[0].generated_text.replace(/^.*### Response:/s, "").trim();
      return new Response(reply, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    } else {
      // Hugging Face API से एरर या अप्रत्याशित प्रतिक्रिया
      console.error("AI API Error:", data);
      return new Response(`AI से प्रतिक्रिया प्राप्त करने में त्रुटि: ${JSON.stringify(data)} (Error receiving response from AI: ${JSON.stringify(data)})`, { status: response.status || 500 });
    }

  } catch (err) {
    console.error("Internal Server Error:", err);
    // JSON पार्सिंग एरर या नेटवर्क एरर के लिए
    if (err instanceof SyntaxError) {
      return new Response("अमान्य JSON प्रारूप। (Invalid JSON format.)", { status: 400 });
    }
    return new Response(`आंतरिक सर्वर त्रुटि: ${err.message} (Internal Server Error: ${err.message})`, { status: 500 });
  }
};

Deno.serve(handler);

