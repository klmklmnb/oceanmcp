import type {
  ExecuteToolRequest,
  ToolResultResponse,
  FunctionSchema,
} from "./types";
import type { SkillMetadata, SkillSchema } from "./skills";

// ─── Message Types ───────────────────────────────────────────────────────────

export enum WSMessageType {
  /** Server → Browser: execute a tool on the browser side */
  EXECUTE_TOOL = "EXECUTE_TOOL",
  /** Browser → Server: result of a tool execution */
  TOOL_RESULT = "TOOL_RESULT",
  /** Browser → Server: register available tools and skills */
  REGISTER_CAPABILITIES = "REGISTER_CAPABILITIES",
  /** Server → Browser: acknowledge capabilities registration */
  CAPABILITIES_REGISTERED = "CAPABILITIES_REGISTERED",
  /** Browser → Server: register skill(s) from a remote .zip URL */
  REGISTER_SKILL_ZIP = "REGISTER_SKILL_ZIP",
  /** Server → Browser: acknowledge successful zip skill registration */
  SKILL_ZIP_REGISTERED = "SKILL_ZIP_REGISTERED",
  /** Server → Browser: report zip skill registration failure */
  SKILL_ZIP_ERROR = "SKILL_ZIP_ERROR",
  /** Ping / Pong for keep-alive */
  PING = "PING",
  PONG = "PONG",
}

// ─── Typed Messages ──────────────────────────────────────────────────────────

export type WSMessage =
  | { type: WSMessageType.EXECUTE_TOOL; payload: ExecuteToolRequest }
  | { type: WSMessageType.TOOL_RESULT; payload: ToolResultResponse }
  | {
      type: WSMessageType.REGISTER_CAPABILITIES;
      payload: {
        connectionId: string;
        tools: FunctionSchema[];
        skills: SkillSchema[];
      };
    }
  | {
      type: WSMessageType.CAPABILITIES_REGISTERED;
      payload: { connectionId: string };
    }
  | {
      type: WSMessageType.REGISTER_SKILL_ZIP;
      payload: {
        /** Client-generated request ID for correlating the response */
        requestId: string;
        /** CDN URL pointing to a .zip file containing skill directories */
        url: string;
      };
    }
  | {
      type: WSMessageType.SKILL_ZIP_REGISTERED;
      payload: {
        /** Echoed request ID from the REGISTER_SKILL_ZIP message */
        requestId: string;
        /** Metadata of all skills discovered from the zip */
        skills: SkillMetadata[];
      };
    }
  | {
      type: WSMessageType.SKILL_ZIP_ERROR;
      payload: {
        /** Echoed request ID from the REGISTER_SKILL_ZIP message */
        requestId: string;
        /** Human-readable error message */
        error: string;
      };
    }
  | { type: WSMessageType.PING }
  | { type: WSMessageType.PONG };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function createWSMessage(msg: WSMessage): string {
  return JSON.stringify(msg);
}

export function parseWSMessage(data: string): WSMessage {
  return JSON.parse(data) as WSMessage;
}
