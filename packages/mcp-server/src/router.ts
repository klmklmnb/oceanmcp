import { sessionStore } from "./sessionStore";
import { sendChatStream } from "./websocket";

export type ChatRequestBody = {
  sessionId: string;
  message: string;
};

export async function handleChatRequest(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { sessionId, message } = body;

    if (!sessionId || !message) {
      return new Response(
        JSON.stringify({ error: "Missing sessionId or message" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: "Session not found. Please connect via WebSocket first." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const functions = sessionStore.getFunctions(sessionId);
    
    // Import agent and process the chat
    // For now, we'll use a placeholder that echoes the message
    // The real implementation will call the agent
    try {
      const { processChat } = await import("@hacker-agent/agent");
      await processChat(sessionId, message, functions);
    } catch {
      // Agent not available, send a placeholder response
      console.log("[Router] Agent not available, sending placeholder response");
      sendChatStream(
        sessionId,
        `Received your message: "${message}". Agent integration pending.`,
        true
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Router] Error handling chat request:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export function handleCorsPreflightRequest(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
