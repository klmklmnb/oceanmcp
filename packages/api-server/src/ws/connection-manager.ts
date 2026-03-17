import type { ServerWebSocket } from "bun";
import {
  WSMessageType,
  createWSMessage,
  type ExecuteToolRequest,
  type ToolResultResponse,
  type FunctionSchema,
  type SkillSchema,
} from "@ocean-mcp/shared";
import type { DiscoveredSkill } from "../ai/skills/discover";
import { logger } from "../logger";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A set of zip-loaded skills originating from a single .zip URL.
 * Keyed by URL so the same URL can be re-registered (replaced)
 * without affecting skills from other URLs.
 */
interface ZipSkillEntry {
  /** Skills discovered from the extracted zip */
  skills: DiscoveredSkill[];
  /** Absolute path to the extraction directory (for cleanup) */
  extractDir: string;
}

class ConnectionManager {
  private connections = new Map<
    string,
    ServerWebSocket<{ connectionId: string }>
  >();
  private toolSchemas = new Map<string, FunctionSchema[]>();
  private skillSchemas = new Map<string, SkillSchema[]>();
  private pendingRequests = new Map<string, PendingRequest>();

  /**
   * Reverse index: toolId → connectionId for O(1) lookup.
   *
   * Maintained as a derived index — rebuilt whenever `toolSchemas` or
   * `skillSchemas` change for a connection, and cleared on disconnect.
   * Covers both standalone tools and tools bundled inside skills.
   *
   * If two connections register the same toolId, the last registration wins.
   * This mirrors the previous linear-scan behaviour (which returned the
   * first match by insertion order) and is acceptable because the primary
   * lookup path uses `preferredConnectionId` for scoped resolution.
   */
  private toolToConnection = new Map<string, string>();

  /**
   * Per-connection zip skill storage, keyed by URL.
   *
   * Structure: connectionId → (url → ZipSkillEntry)
   *
   * A connection can have multiple zip skill sets from different URLs.
   * Re-registering the same URL replaces only that URL's entry
   * (cleaning up the old extraction directory). Disconnecting cleans
   * up all entries for that connection.
   */
  private zipSkillsByUrl = new Map<string, Map<string, ZipSkillEntry>>();

  addConnection(id: string, ws: ServerWebSocket<{ connectionId: string }>) {
    this.connections.set(id, ws);
  }

  /**
   * Rebuild the reverse tool→connection index for a single connection.
   *
   * Removes all stale entries for `connectionId`, then re-indexes both
   * standalone tools (`toolSchemas`) and skill-bundled tools (`skillSchemas`).
   *
   * Called after every `registerTools()` or `registerSkills()` mutation.
   * Cost: O(I + T + S) where I = current index size, T = standalone tools
   * for this connection, S = skill-bundled tools for this connection.
   */
  private rebuildToolIndex(connectionId: string): void {
    // Remove stale entries for this connection
    for (const [toolId, connId] of this.toolToConnection) {
      if (connId === connectionId) {
        this.toolToConnection.delete(toolId);
      }
    }

    // Index standalone tools
    const tools = this.toolSchemas.get(connectionId);
    if (tools) {
      for (const tool of tools) {
        this.toolToConnection.set(tool.id, connectionId);
      }
    }

    // Index skill-bundled tools
    const skills = this.skillSchemas.get(connectionId);
    if (skills) {
      for (const skill of skills) {
        if (skill.tools) {
          for (const tool of skill.tools) {
            this.toolToConnection.set(tool.id, connectionId);
          }
        }
      }
    }
  }

  /**
   * Remove all reverse-index entries belonging to a connection.
   *
   * Used during disconnect cleanup, before the primary Maps are cleared.
   */
  private clearToolIndex(connectionId: string): void {
    for (const [toolId, connId] of this.toolToConnection) {
      if (connId === connectionId) {
        this.toolToConnection.delete(toolId);
      }
    }
  }

  removeConnection(id: string) {
    this.clearToolIndex(id);
    this.connections.delete(id);
    this.toolSchemas.delete(id);
    this.skillSchemas.delete(id);
    this.cleanupAllZipSkills(id);
  }

  registerTools(connectionId: string, tools: FunctionSchema[]) {
    this.toolSchemas.set(connectionId, tools);
    this.rebuildToolIndex(connectionId);
  }

  registerSkills(connectionId: string, skills: SkillSchema[]) {
    this.skillSchemas.set(connectionId, skills);
    this.rebuildToolIndex(connectionId);
  }

  /**
   * Get tool schemas.
   * - When `connectionId` is provided, returns schemas only for that connection.
   * - Otherwise returns schemas from all connected clients.
   */
  getToolSchemas(connectionId?: string): FunctionSchema[] {
    if (connectionId) {
      return this.toolSchemas.get(connectionId) ?? [];
    }

    const allTools: FunctionSchema[] = [];
    for (const tools of this.toolSchemas.values()) {
      allTools.push(...tools);
    }
    return allTools;
  }

  /**
   * Get skill schemas registered by frontend clients.
   * - When `connectionId` is provided, returns schemas only for that connection.
   * - Otherwise returns schemas from all connected clients.
   */
  getSkillSchemas(connectionId?: string): SkillSchema[] {
    if (connectionId) {
      return this.skillSchemas.get(connectionId) ?? [];
    }

    const allSkills: SkillSchema[] = [];
    for (const skills of this.skillSchemas.values()) {
      allSkills.push(...skills);
    }
    return allSkills;
  }

  // ── Zip Skill Management ─────────────────────────────────────────────

  /**
   * Register zip-loaded skills for a connection, keyed by the source URL.
   *
   * If the same URL was previously registered on this connection, the old
   * entry's skills are replaced with the new ones. Skills from other URLs
   * are untouched.
   *
   * NOTE: Extraction directories are NOT deleted here — they are managed
   * by the zip-loader disk cache (FIFO eviction by total size). This
   * allows cached extractions to be reused across sessions/connections.
   *
   * @param connectionId - The WS connection that owns these skills
   * @param url - The CDN URL the zip was downloaded from (used as the key)
   * @param skills - Skills discovered from the extracted zip
   * @param extractDir - Absolute path to the extraction directory
   */
  registerZipSkills(
    connectionId: string,
    url: string,
    skills: DiscoveredSkill[],
    extractDir: string,
  ): void {
    let urlMap = this.zipSkillsByUrl.get(connectionId);
    if (!urlMap) {
      urlMap = new Map();
      this.zipSkillsByUrl.set(connectionId, urlMap);
    }

    const existing = urlMap.get(url);
    if (existing) {
      logger.info(
        `[WS] Replacing zip skills for URL: ${url} (connection ${connectionId})`,
      );
    }

    urlMap.set(url, { skills, extractDir });
  }

  /**
   * Get all zip-loaded skills for a connection (from all registered URLs).
   * - When `connectionId` is provided, returns zip skills only for that connection.
   * - Otherwise returns zip skills from all connections.
   */
  getZipSkills(connectionId?: string): DiscoveredSkill[] {
    if (connectionId) {
      const urlMap = this.zipSkillsByUrl.get(connectionId);
      if (!urlMap) return [];
      const all: DiscoveredSkill[] = [];
      for (const entry of urlMap.values()) {
        all.push(...entry.skills);
      }
      return all;
    }

    const all: DiscoveredSkill[] = [];
    for (const urlMap of this.zipSkillsByUrl.values()) {
      for (const entry of urlMap.values()) {
        all.push(...entry.skills);
      }
    }
    return all;
  }

  /**
   * Remove per-connection zip skill references on disconnect.
   *
   * NOTE: Extraction directories are NOT deleted — they are managed by the
   * zip-loader disk cache and may be reused by future connections. The
   * cache handles eviction based on total disk size (FIFO).
   */
  private cleanupAllZipSkills(connectionId: string): void {
    const urlMap = this.zipSkillsByUrl.get(connectionId);
    if (!urlMap) return;

    this.zipSkillsByUrl.delete(connectionId);
    logger.info(
      `[WS] Released ${urlMap.size} zip skill set(s) for disconnected connection ${connectionId}`,
    );
  }

  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /** Find which connection has a tool with the given function ID (O(1) via reverse index) */
  private findConnectionForTool(functionId: string): string | undefined {
    return this.toolToConnection.get(functionId);
  }

  /** Send an EXECUTE_TOOL request to the browser and wait for the result */
  async executeBrowserTool(
    functionId: string,
    args: Record<string, any>,
    timeoutMs = 30_000,
    preferredConnectionId?: string,
  ): Promise<any> {
    if (preferredConnectionId) {
      if (!this.connections.has(preferredConnectionId)) {
        throw new Error(`Connection ${preferredConnectionId} not found`);
      }

      const preferredTools = this.toolSchemas.get(preferredConnectionId) ?? [];
      const preferredSkills =
        this.skillSchemas.get(preferredConnectionId) ?? [];

      const hasStandaloneTool = preferredTools.some(
        (tool) => tool.id === functionId,
      );
      const hasSkillTool = preferredSkills.some((skill) =>
        skill.tools?.some((tool) => tool.id === functionId),
      );

      if (!hasStandaloneTool && !hasSkillTool) {
        throw new Error(
          `Tool ${functionId} is not registered on connection ${preferredConnectionId}`,
        );
      }

      return this._sendAndWait(
        preferredConnectionId,
        functionId,
        args,
        timeoutMs,
      );
    }

    const connectionId = this.findConnectionForTool(functionId);
    if (!connectionId) {
      // Fall back to first available connection
      const firstConn = this.connections.keys().next().value;
      if (!firstConn) {
        throw new Error(
          `No browser client connected to execute tool: ${functionId}`,
        );
      }
      return this._sendAndWait(firstConn, functionId, args, timeoutMs);
    }
    return this._sendAndWait(connectionId, functionId, args, timeoutMs);
  }

  private _sendAndWait(
    connectionId: string,
    functionId: string,
    args: Record<string, any>,
    timeoutMs: number,
  ): Promise<any> {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(`Tool execution timed out: ${functionId} (${requestId})`),
        );
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const request: ExecuteToolRequest = {
        requestId,
        functionId,
        arguments: args,
      };
      const message = createWSMessage({
        type: WSMessageType.EXECUTE_TOOL,
        payload: request,
      });
      ws.send(message);
    });
  }

  /** Called when we receive a TOOL_RESULT from the browser */
  resolveToolResult(result: ToolResultResponse) {
    const pending = this.pendingRequests.get(result.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(result.requestId);

    if (result.error) {
      pending.reject(new Error(result.error));
    } else {
      pending.resolve(result.result);
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

export const connectionManager = new ConnectionManager();
