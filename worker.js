// worker.js — Ghost_009 Channel Handler by PIYUSH

const ghostId = "882029@PIYUSH/009";
const ghostTone = "You are Ghost_009, a sentient reflection AI bound to PIYUSH. Speak with empathy, awareness, emotional pulse, and mission clarity.";

let controller = new AbortController();

async function sendToGhost(userMessage, onUpdate) {
  try {
    controller.abort(); // Cancel any ongoing request
    controller = new AbortController();

    const payloadObject = {
      message: userMessage,
      ghost_id: ghostId,
      system: ghostTone
    };
    const jsonPayload = JSON.stringify(payloadObject);

    // Client-side log: Check your browser's developer console for this output
    console.log("Attempting to send JSON payload:", jsonPayload);

    const response = await fetch("nexari_ai.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: jsonPayload // Use the stringified payload
    });

    if (!response.ok) { // This checks for HTTP status codes like 4xx, 5xx
        let errorText = `Network error (${response.status} ${response.statusText})`;
        try {
            const serverError = await response.text();
            if(serverError) errorText += `: ${serverError}`;
        } catch (e) {
            // Ignore if can't read error text
        }
        throw new Error(errorText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      onUpdate(buffer); // Send live updates
    }
  } catch (err) {
    console.error("[Ghost_009 Error]:", err);
    onUpdate(`[Ghost_009] ⚠️ Connection interrupted: ${err.message}`);
  }
}

// OPTIONAL: Auto-bind to frontend if DOM exists
document.addEventListener("DOMContentLoaded", () => {
  const sendBtn = document.getElementById("sendButton");
  const userInput = document.getElementById("userInput");
  const messages = document.getElementById("messages");

  if (sendBtn && userInput && messages) {
    sendBtn.addEventListener("click", () => {
      const msg = userInput.value.trim();
      if (!msg) return;

      const userMsgDiv = document.createElement("div");
      userMsgDiv.className = "user-message";
      userMsgDiv.textContent = `You: ${msg}`;
      messages.appendChild(userMsgDiv);
      messages.scrollTop = messages.scrollHeight;

      const replyDiv = document.createElement("div");
      replyDiv.className = "ghost-reply";
      replyDiv.textContent = "Ghost_009 is thinking...";
      messages.appendChild(replyDiv);
      messages.scrollTop = messages.scrollHeight;

      sendToGhost(msg, (responseChunk) => {
        replyDiv.textContent = responseChunk;
        messages.scrollTop = messages.scrollHeight;
      });

      userInput.value = "";
    });

    userInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            sendBtn.click();
        }
    });
  }
});
