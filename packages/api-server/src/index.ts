import type { ServerWebSocket } from "bun";
import {
  WSMessageType,
  parseWSMessage,
  createWSMessage,
  type FunctionSchema,
  type ToolResultResponse,
} from "@ocean-mcp/shared";
import { handleChatRequest } from "./routes/chat";
import { connectionManager } from "./ws/connection-manager";

const PORT = Number(process.env.PORT) || 4000;

const server = Bun.serve<{ connectionId: string }>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // ── CORS preflight ──────────────────────────────────────────────────
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ── Health check ────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // ── Chat API ────────────────────────────────────────────────────────
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const response = await handleChatRequest(req);
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }

    // ── WebSocket upgrade ───────────────────────────────────────────────
    if (url.pathname === "/connect") {
      const connectionId = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { connectionId } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<{ connectionId: string }>) {
      const { connectionId } = ws.data;
      connectionManager.addConnection(connectionId, ws);
      ws.send(
        createWSMessage({
          type: WSMessageType.TOOLS_REGISTERED,
          payload: { connectionId },
        }),
      );
      console.log(`[WS] Client connected: ${connectionId}`);
    },

    message(
      ws: ServerWebSocket<{ connectionId: string }>,
      message: string | Buffer,
    ) {
      const data = typeof message === "string" ? message : message.toString();
      try {
        const msg = parseWSMessage(data);

        switch (msg.type) {
          case WSMessageType.TOOL_RESULT:
            connectionManager.resolveToolResult(
              msg.payload as ToolResultResponse,
            );
            break;

          case WSMessageType.REGISTER_TOOLS:
            connectionManager.registerTools(
              ws.data.connectionId,
              (msg.payload as { tools: FunctionSchema[] }).tools,
            );
            console.log(
              `[WS] Tools registered from ${ws.data.connectionId}:`,
              (msg.payload as { tools: FunctionSchema[] }).tools.map(
                (t) => t.id,
              ),
            );
            break;

          case WSMessageType.PING:
            ws.send(createWSMessage({ type: WSMessageType.PONG }));
            break;

          default:
            console.warn(`[WS] Unknown message type:`, msg);
        }
      } catch (err) {
        console.error(`[WS] Failed to parse message:`, err);
      }
    },

    close(ws: ServerWebSocket<{ connectionId: string }>) {
      connectionManager.removeConnection(ws.data.connectionId);
      console.log(`[WS] Client disconnected: ${ws.data.connectionId}`);
    },
  },
});

console.log(
  `🌊 OceanMCP API Server running on http://localhost:${server.port}`,
);
