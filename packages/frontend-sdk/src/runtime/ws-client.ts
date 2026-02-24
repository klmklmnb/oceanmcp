import {
  WSMessageType,
  createWSMessage,
  parseWSMessage,
  type ExecuteToolRequest,
} from "@ocean-mcp/shared";
import { functionRegistry, skillRegistry } from "../registry";
import { executeFunction } from "./executor";

/**
 * WebSocket client — connects to the api-server's /connect endpoint.
 * Listens for EXECUTE_TOOL requests, runs them via the executor,
 * and sends back TOOL_RESULT responses.
 */
class WSClient {
  private ws: WebSocket | null = null;
  private connectionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private serverUrl: string;
  private maxReconnectDelay = 30_000;
  private reconnectDelay = 1_000;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  connect(): void {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/connect";
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[OceanMCP] WebSocket connected");
        this.reconnectDelay = 1_000; // Reset on successful connection
        this.startPing();
        // Register all current tool schemas and skill schemas with the server
        this.registerCapabilities();
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = parseWSMessage(event.data);

          switch (msg.type) {
            case WSMessageType.CAPABILITIES_REGISTERED:
              this.connectionId = msg.payload.connectionId;
              break;

            case WSMessageType.EXECUTE_TOOL:
              await this.handleExecuteTool(msg.payload);
              break;

            case WSMessageType.PONG:
              break;
          }
        } catch (err) {
          console.error("[OceanMCP] Failed to handle message:", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[OceanMCP] WebSocket disconnected, will reconnect...");
        this.ws = null;
        this.connectionId = null;
        this.stopPing();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error("[OceanMCP] WebSocket error:", err);
      };
    } catch (err) {
      console.error("[OceanMCP] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.connectionId = null;
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send current tool schemas and skill schemas to the server */
  registerCapabilities(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const tools = functionRegistry.getAllSchemas();
    const skills = skillRegistry.getAllSchemas();

    this.ws.send(
      createWSMessage({
        type: WSMessageType.REGISTER_CAPABILITIES,
        payload: {
          connectionId: this.connectionId || "",
          tools,
          skills,
        },
      }),
    );
  }

  private async handleExecuteTool(request: ExecuteToolRequest): Promise<void> {
    try {
      const result = await executeFunction(
        request.functionId,
        request.arguments,
      );
      this.ws?.send(
        createWSMessage({
          type: WSMessageType.TOOL_RESULT,
          payload: {
            requestId: request.requestId,
            functionId: request.functionId,
            result,
          },
        }),
      );
    } catch (error) {
      this.ws?.send(
        createWSMessage({
          type: WSMessageType.TOOL_RESULT,
          payload: {
            requestId: request.requestId,
            functionId: request.functionId,
            error: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      this.connect();
    }, this.reconnectDelay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(createWSMessage({ type: WSMessageType.PING }));
      }
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentConnectionId(): string | null {
    return this.connectionId;
  }
}

const serverUrl =
  (typeof window !== "undefined" && (window as any).__OCEAN_MCP_SERVER_URL__) ||
  "http://localhost:4000";

const WS_CLIENT_GLOBAL_KEY = "__OCEAN_MCP_WS_CLIENT__";

type OceanWindow = Window &
  typeof globalThis & {
    [WS_CLIENT_GLOBAL_KEY]?: WSClient;
  };

const globalScope =
  (typeof window !== "undefined" ? (window as OceanWindow) : (globalThis as any));

export const wsClient: WSClient =
  globalScope[WS_CLIENT_GLOBAL_KEY] ??
  (globalScope[WS_CLIENT_GLOBAL_KEY] = new WSClient(serverUrl));
