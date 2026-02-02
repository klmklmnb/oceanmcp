import dotenv from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
dotenv.config({ path: resolve(import.meta.dir, "../../../.env") });
import type { WebSocketData } from "./types";
import {
  handleWebSocketOpen,
  handleWebSocketMessage,
  handleWebSocketClose,
} from "./websocket";
import {
  handleChatRequest,
  handleCorsPreflightRequest,
  addCorsHeaders,
} from "./router";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

const server = Bun.serve<WebSocketData>({
  port: PORT,
  
  fetch(req, server) {
    const url = new URL(req.url);
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return handleCorsPreflightRequest();
    }
    
    // WebSocket upgrade for /connect
    if (url.pathname === "/connect") {
      const sessionId = url.searchParams.get("sessionId") || generateSessionId();
      
      const success = server.upgrade(req, {
        data: { sessionId },
      });
      
      if (success) {
        return undefined;
      }
      
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    
    // HTTP routes
    if (url.pathname === "/chat" && req.method === "POST") {
      return handleChatRequest(req).then(addCorsHeaders);
    }
    
    // Health check
    if (url.pathname === "/health") {
      return addCorsHeaders(
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    
    return addCorsHeaders(
      new Response("Not Found", { status: 404 })
    );
  },
  
  websocket: {
    open(ws) {
      handleWebSocketOpen(ws);
    },
    message(ws, message) {
      handleWebSocketMessage(ws, message);
    },
    close(ws) {
      handleWebSocketClose(ws);
    },
  },
});

console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
console.log(`   WebSocket: ws://localhost:${PORT}/connect`);
console.log(`   HTTP: POST http://localhost:${PORT}/chat`);

export { server };
export * from "./websocket";
export * from "./sessionStore";
