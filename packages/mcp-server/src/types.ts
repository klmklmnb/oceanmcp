import type { ServerWebSocket } from "bun";
import type { FunctionDefinition } from "@hacker-agent/shared";

export type SessionData = {
  sessionId: string;
  functions: FunctionDefinition[];
  pendingReads: Map<string, {
    resolve: (results: unknown[]) => void;
    reject: (error: Error) => void;
  }>;
};

export type WebSocketData = {
  sessionId: string;
};

export type BunWebSocket = ServerWebSocket<WebSocketData>;
