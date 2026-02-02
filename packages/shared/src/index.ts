// Shared types for HackerAgent

export type FunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: "read" | "write"; // read = safe/immediate, write = requires approval
  code: string; // e.g. "return fetch('/api/v1/cluster/' + args.id)"
  parameters: {
    name: string;
    type: string;
    description?: string;
    required: boolean;
  }[];
};

export type FlowPlan = {
  planId: string;
  intent: string;
  nodes: FlowNode[];
};

export type FlowNode = {
  id: string;
  functionId: string;
  title: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "success" | "failed";
  result?: unknown;
  error?: string;
};

// A single read operation within EXECUTE_READ
export type ReadOperation = {
  id: string; // Unique ID for this read step
  functionId: string; // Which function to call
  arguments: Record<string, unknown>; // Arguments for the function
};

// Server -> SDK events
export type ServerEvent =
  | {
      type: "EXECUTE_READ";
      requestId: string;
      reads: ReadOperation[]; // Multiple sequential read calls
    }
  | { type: "PROPOSE_FLOW"; plan: FlowPlan }
  | { type: "CHAT_STREAM"; content: string; done: boolean };

// SDK -> Server events
export type ClientEvent =
  | {
      type: "SYNC_REGISTRY";
      functions: FunctionDefinition[]; // Full registry sent on connect
    }
  | {
      type: "READ_RESULT";
      requestId: string;
      results: { id: string; result: unknown; error?: string }[];
    }
  | { type: "FLOW_RESULT"; planId: string; results: FlowNode[] }
  | { type: "CHAT"; sessionId: string; message: string };

// Chat request/response types
export type ChatRequest = {
  sessionId: string;
  message: string;
};

export type ChatResponse = {
  sessionId: string;
  content: string;
};
