import {
  WSMessageType,
  createWSMessage,
  parseWSMessage,
  type ExecuteToolRequest,
  type SkillMetadata,
} from "@ocean-mcp/shared";
import { functionRegistry, skillRegistry } from "../registry";
import { executeFunction } from "./executor";
import { API_URL } from "../config";
import { addSdkBreadcrumb, captureException } from "./sentry";

// ─── Pending Zip Request ─────────────────────────────────────────────────────

type PendingZipRequest = {
  resolve: (skills: SkillMetadata[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

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
  private pendingZipRequests = new Map<string, PendingZipRequest>();
  private pendingConnection: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  private serverUrl: string;
  private maxReconnectDelay = 30_000;
  private reconnectDelay = 1_000;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  private addConnectionBreadcrumb(
    message: string,
    data?: Record<string, unknown>,
  ): void {
    addSdkBreadcrumb(message, {
      connectionId: this.connectionId ?? undefined,
      readyState: this.ws?.readyState ?? undefined,
      ...data,
    });
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
      this.addConnectionBreadcrumb("ws.connect_attempt", {
        hasExistingConnectionId: Boolean(this.connectionId),
      });

      this.ws.onopen = () => {
        console.log("[OceanMCP] WebSocket connected");
        this.reconnectDelay = 1_000; // Reset on successful connection
        this.startPing();
        this.addConnectionBreadcrumb("ws.connected");
        // Resolve any callers waiting for the connection
        this.flushPendingConnection(true);
        // Register all current tool schemas and skill schemas with the server
        this.registerCapabilities();
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = parseWSMessage(event.data);

          switch (msg.type) {
            case WSMessageType.CAPABILITIES_REGISTERED:
              this.connectionId = msg.payload.connectionId;
              this.addConnectionBreadcrumb("ws.capabilities_registered", {
                connectionId: msg.payload.connectionId,
              });
              break;

            case WSMessageType.EXECUTE_TOOL:
              await this.handleExecuteTool(msg.payload);
              break;

            case WSMessageType.SKILL_ZIP_REGISTERED:
              this.resolveZipRequest(msg.payload.requestId, msg.payload.skills);
              break;

            case WSMessageType.SKILL_ZIP_ERROR:
              this.rejectZipRequest(msg.payload.requestId, msg.payload.error);
              break;

            case WSMessageType.PONG:
              break;
          }
        } catch (err) {
          console.error("[OceanMCP] Failed to handle message:", err);
          captureException(err, {
            tags: {
              stage: "ws_message",
            },
            extras: {
              hasPayload: event.data != null,
              payloadType: typeof event.data,
              connectionId: this.connectionId,
              readyState: this.ws?.readyState ?? null,
            },
          });
        }
      };

      this.ws.onclose = () => {
        console.log("[OceanMCP] WebSocket disconnected, will reconnect...");
        this.addConnectionBreadcrumb("ws.disconnected");
        this.ws = null;
        this.connectionId = null;
        this.stopPing();
        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        console.error("[OceanMCP] WebSocket error:", event);
        captureException(new Error("[OceanMCP] WebSocket error"), {
          tags: {
            stage: "ws_error",
          },
          extras: {
            connectionId: this.connectionId,
            readyState: this.ws?.readyState ?? null,
            eventType: event.type,
          },
        });
      };
    } catch (err) {
      console.error("[OceanMCP] Failed to create WebSocket:", err);
      captureException(err, {
        tags: {
          stage: "ws_connect",
        },
        extras: {
          connectionId: this.connectionId,
        },
      });
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
    this.flushPendingConnection(false);
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Wait for the WebSocket connection to be open.
   * Resolves immediately if already connected.
   */
  waitForConnection(timeoutMs = 30_000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from pending list on timeout
        this.pendingConnection = this.pendingConnection.filter(
          (p) => p.resolve !== resolve,
        );
        captureException(
          new Error(
            `[OceanMCP] WebSocket connection timed out after ${timeoutMs}ms`,
          ),
          {
            tags: {
              stage: "ws_wait_for_connection",
            },
            extras: {
              timeoutMs,
              pendingCount: this.pendingConnection.length,
              connectionId: this.connectionId,
            },
          },
        );
        reject(
          new Error(
            `[OceanMCP] WebSocket connection timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pendingConnection.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      // Ensure a connection attempt is in progress
      this.connect();
    });
  }

  /** Flush all pending connection waiters */
  private flushPendingConnection(success: boolean): void {
    const waiters = this.pendingConnection;
    this.pendingConnection = [];
    for (const w of waiters) {
      if (success) {
        w.resolve();
      } else {
        w.reject(new Error("[OceanMCP] WebSocket connection failed"));
      }
    }
  }

  /** Send current tool schemas and skill schemas to the server */
  registerCapabilities(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const tools = functionRegistry.getAllSchemas();
    const skills = skillRegistry.getAllSchemas();
    this.addConnectionBreadcrumb("ws.register_capabilities", {
      toolCount: tools.length,
      skillCount: skills.length,
    });

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

  /**
   * Register skill(s) from a remote .zip file hosted on a CDN.
   *
   * Sends the URL to the server, which downloads, extracts, and discovers
   * skills from the zip. Returns the metadata of all registered skills.
   *
   * The zip can contain:
   *   - A root-level SKILL.md → single skill (subdirs ignored)
   *   - Subdirectories with SKILL.md files → multiple skills
   *
   * @param url - CDN URL pointing to the .zip file
   * @param timeoutMs - How long to wait for the server response (default: 60s)
   * @returns Array of skill metadata for all skills discovered from the zip
   * @throws If the download, extraction, or discovery fails
   *
   * @example
   * ```ts
   * const skills = await wsClient.registerSkillFromZip(
   *   'https://cdn.example.com/skills/my-skill-pack.zip',
   * );
   * console.log('Registered:', skills.map(s => s.name));
   * ```
   */
  async registerSkillFromZip(
    url: string,
    timeoutMs = 60_000,
  ): Promise<SkillMetadata[]> {
    // Wait for WebSocket to be connected before sending the request
    await this.waitForConnection(timeoutMs);

    const requestId = crypto.randomUUID();

    return new Promise<SkillMetadata[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingZipRequests.delete(requestId);
        captureException(
          new Error(
            `[OceanMCP] Zip skill registration timed out after ${timeoutMs}ms`,
          ),
          {
            tags: {
              stage: "register_skill_zip",
            },
            extras: {
              requestId,
              timeoutMs,
              connectionId: this.connectionId,
            },
          },
        );
        reject(
          new Error(
            `[OceanMCP] Zip skill registration timed out after ${timeoutMs}ms: ${url}`,
          ),
        );
      }, timeoutMs);

      this.pendingZipRequests.set(requestId, { resolve, reject, timer });

      this.ws!.send(
        createWSMessage({
          type: WSMessageType.REGISTER_SKILL_ZIP,
          payload: { requestId, url },
        }),
      );
    });
  }

  /** Resolve a pending zip skill registration request */
  private resolveZipRequest(requestId: string, skills: SkillMetadata[]): void {
    const pending = this.pendingZipRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingZipRequests.delete(requestId);
    pending.resolve(skills);
  }

  /** Reject a pending zip skill registration request */
  private rejectZipRequest(requestId: string, error: string): void {
    const pending = this.pendingZipRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingZipRequests.delete(requestId);
    captureException(new Error(error), {
      tags: {
        stage: "register_skill_zip",
      },
      extras: {
        requestId,
        connectionId: this.connectionId,
      },
    });
    pending.reject(new Error(error));
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
      captureException(error, {
        tags: {
          stage: "execute_tool",
          functionId: request.functionId,
        },
        extras: {
          requestId: request.requestId,
          connectionId: this.connectionId,
        },
      });
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
    this.addConnectionBreadcrumb("ws.schedule_reconnect", {
      reconnectDelay: this.reconnectDelay,
      maxReconnectDelay: this.maxReconnectDelay,
    });
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

const serverUrl = API_URL;

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
