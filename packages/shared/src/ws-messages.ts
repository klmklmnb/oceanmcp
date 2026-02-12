import type {
  ExecuteToolRequest,
  ToolResultResponse,
  FunctionSchema,
} from "./types";

// ─── Message Types ───────────────────────────────────────────────────────────

export enum WSMessageType {
  /** Server → Browser: execute a tool on the browser side */
  EXECUTE_TOOL = "EXECUTE_TOOL",
  /** Browser → Server: result of a tool execution */
  TOOL_RESULT = "TOOL_RESULT",
  /** Browser → Server: register available tool schemas */
  REGISTER_TOOLS = "REGISTER_TOOLS",
  /** Server → Browser: acknowledge tool registration */
  TOOLS_REGISTERED = "TOOLS_REGISTERED",
  /** Ping / Pong for keep-alive */
  PING = "PING",
  PONG = "PONG",
}

// ─── Typed Messages ──────────────────────────────────────────────────────────

export type WSMessage =
  | { type: WSMessageType.EXECUTE_TOOL; payload: ExecuteToolRequest }
  | { type: WSMessageType.TOOL_RESULT; payload: ToolResultResponse }
  | {
      type: WSMessageType.REGISTER_TOOLS;
      payload: { connectionId: string; tools: FunctionSchema[] };
    }
  | { type: WSMessageType.TOOLS_REGISTERED; payload: { connectionId: string } }
  | { type: WSMessageType.PING }
  | { type: WSMessageType.PONG };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function createWSMessage(msg: WSMessage): string {
  return JSON.stringify(msg);
}

export function parseWSMessage(data: string): WSMessage {
  return JSON.parse(data) as WSMessage;
}
