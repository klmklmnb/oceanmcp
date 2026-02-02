// Re-export shared types
export type {
  FunctionDefinition,
  FlowPlan,
  FlowNode,
  ReadOperation,
  ServerEvent,
  ClientEvent,
} from "@hacker-agent/shared";

// SDK-specific types
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type SDKConfig = {
  serverUrl?: string;
  wsUrl?: string;
  autoConnect?: boolean;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
