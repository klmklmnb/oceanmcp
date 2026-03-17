import type { ServerWebSocket } from "bun";
import {
  WSMessageType,
  parseWSMessage,
  createWSMessage,
  type FunctionSchema,
  type SkillSchema,
  type ToolResultResponse,
} from "oceanmcp-shared";
import { handleChatRequest } from "./routes/chat";
import { handleGenerateTitleRequest } from "./routes/generate-title";
import { connectionManager } from "./ws/connection-manager";
import { initSkills, getSkillsContext } from "./ai/prompts";
import { loadSkillsFromZip } from "./ai/skills";
import { logger } from "./logger";

const PORT = Number(process.env.PORT) || 4001;

// ── Initialize the skills system before starting the server ──────────────────
// Skills are discovered from configured directories (e.g. packages/api-server/skills/).
// This must complete before the server starts accepting chat requests, so the
// system prompt includes the skills catalog and the loadSkill tool is available.
await initSkills();

const server = Bun.serve<{ connectionId: string }>({
  port: PORT,
  idleTimeout: 255,

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

    // ── Generate title API ───────────────────────────────────────────
    if (url.pathname === "/api/generate-title" && req.method === "POST") {
      const response = await handleGenerateTitleRequest(req);
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
          type: WSMessageType.CAPABILITIES_REGISTERED,
          payload: { connectionId },
        }),
      );
      logger.info(`[WS] Client connected: ${connectionId}`);
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

          case WSMessageType.REGISTER_CAPABILITIES:
            connectionManager.registerTools(
              ws.data.connectionId,
              (
                msg.payload as {
                  tools: FunctionSchema[];
                  skills: SkillSchema[];
                }
              ).tools,
            );
            connectionManager.registerSkills(
              ws.data.connectionId,
              (
                msg.payload as {
                  tools: FunctionSchema[];
                  skills: SkillSchema[];
                }
              ).skills,
            );
            logger.info(
              `[WS] Capabilities registered for ${ws.data.connectionId}: ` +
                `${(msg.payload as { tools: FunctionSchema[] }).tools.length} tool(s), ` +
                `${(msg.payload as { skills: SkillSchema[] }).skills.length} skill(s)`,
            );
            break;

          case WSMessageType.PING:
            ws.send(createWSMessage({ type: WSMessageType.PONG }));
            break;

          case WSMessageType.REGISTER_SKILL_ZIP: {
            const { requestId, url } = msg.payload as {
              requestId: string;
              url: string;
            };
            logger.info(
              `[WS] Zip skill registration requested: ${url} (${requestId})`,
            );

            // Async: download, extract, discover, and register — then respond
            const { sandbox } = getSkillsContext();
            loadSkillsFromZip(sandbox, url)
              .then(({ skills: newSkills, extractDir }) => {
                // Store per-connection, keyed by URL (replaces previous registration for same URL)
                connectionManager.registerZipSkills(
                  ws.data.connectionId,
                  url,
                  newSkills,
                  extractDir,
                );

                const skillMeta = newSkills.map((s) => ({
                  name: s.name,
                  description: s.description,
                  path: s.path,
                }));

                ws.send(
                  createWSMessage({
                    type: WSMessageType.SKILL_ZIP_REGISTERED,
                    payload: { requestId, skills: skillMeta },
                  }),
                );
                logger.info(
                  `[WS] Zip skill(s) registered for ${ws.data.connectionId}: ${newSkills.map((s) => s.name).join(", ") || "(none)"}`,
                );
              })
              .catch((err) => {
                const error =
                  err instanceof Error ? err.message : String(err);
                ws.send(
                  createWSMessage({
                    type: WSMessageType.SKILL_ZIP_ERROR,
                    payload: { requestId, error },
                  }),
                );
                logger.error(
                  `[WS] Zip skill registration failed: ${error}`,
                );
              });
            break;
          }
        }
      } catch (err) {
        logger.error("[WS] Failed to parse message:", err);
      }
    },

    close(ws: ServerWebSocket<{ connectionId: string }>) {
      connectionManager.removeConnection(ws.data.connectionId);
      logger.info(`[WS] Client disconnected: ${ws.data.connectionId}`);
    },
  },
});

logger.info(
  `OceanMCP API Server running on http://localhost:${server.port}`,
);
