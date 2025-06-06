// silent_filter.ts
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const KEYWORDS = ["error", "warning", "alert", "critical", "unauthorized"];

function maskMessage(message: string): string {
  let masked = message;
  for (const word of KEYWORDS) {
    const regex = new RegExp(word, "gi");
    masked = masked.replace(regex, "[REDACTED]");
  }
  return masked;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/message" && req.method === "POST") {
    try {
      const body = await req.json();
      const originalMessage = body.message || "";

      // Mask sensitive keywords
      const filteredMessage = maskMessage(originalMessage);

      // You can add logging or alert suppression logic here

      return new Response(
        JSON.stringify({
          original: originalMessage,
          filtered: filteredMessage,
          status: "filtered",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("Not Found", { status: 404 });
}

console.log("SilentFilter_v1 running on http://localhost:8000");
serve(handler, { port: 8000 });
