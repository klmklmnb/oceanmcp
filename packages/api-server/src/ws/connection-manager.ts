import type { ServerWebSocket } from "bun";
import {
  WSMessageType,
  createWSMessage,
  type ExecuteToolRequest,
  type ToolResultResponse,
  type FunctionSchema,
  type SkillSchema,
} from "@ocean-mcp/shared";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

class ConnectionManager {
  private connections = new Map<
    string,
    ServerWebSocket<{ connectionId: string }>
  >();
  private toolSchemas = new Map<string, FunctionSchema[]>();
  private skillSchemas = new Map<string, SkillSchema[]>();
  private pendingRequests = new Map<string, PendingRequest>();

  addConnection(id: string, ws: ServerWebSocket<{ connectionId: string }>) {
    this.connections.set(id, ws);
  }

  removeConnection(id: string) {
    this.connections.delete(id);
    this.toolSchemas.delete(id);
    this.skillSchemas.delete(id);
  }

  registerTools(connectionId: string, tools: FunctionSchema[]) {
    this.toolSchemas.set(connectionId, tools);
  }

  registerSkills(connectionId: string, skills: SkillSchema[]) {
    this.skillSchemas.set(connectionId, skills);
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

  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /** Find which connection has a tool with the given function ID */
  private findConnectionForTool(functionId: string): string | undefined {
    for (const [connId, tools] of this.toolSchemas.entries()) {
      if (tools.some((t) => t.id === functionId)) {
        return connId;
      }
    }
    // Also check tools bundled inside frontend-registered skills
    for (const [connId, skills] of this.skillSchemas.entries()) {
      for (const skill of skills) {
        if (skill.tools?.some((t) => t.id === functionId)) {
          return connId;
        }
      }
    }
    return undefined;
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
