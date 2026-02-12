// ─── Parameter Definition ────────────────────────────────────────────────────

export type ParameterDefinition = {
  name: string;
  type: string;
  description?: string;
  required: boolean;
};

// ─── Function Definitions ────────────────────────────────────────────────────

/** A "code" function: stored as a code string, executed via new Function() */
export type CodeFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: "code";
  operationType: "read" | "write";
  code: string;
  parameters: ParameterDefinition[];
};

/** An "executor" function: a real JS function registered by the host app */
export type ExecutorFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: "executor";
  operationType: "read" | "write";
  executor: (args: Record<string, any>) => Promise<any>;
  parameters: ParameterDefinition[];
};

export type FunctionDefinition =
  | CodeFunctionDefinition
  | ExecutorFunctionDefinition;

/** Serializable definition sent to the server (no executor fn) */
export type FunctionSchema = {
  id: string;
  name: string;
  description: string;
  type: "code" | "executor";
  operationType: "read" | "write";
  parameters: ParameterDefinition[];
};

// ─── WebSocket: Tool Execution ───────────────────────────────────────────────

/** Server → Browser: execute a tool on the browser side */
export type ExecuteToolRequest = {
  requestId: string;
  functionId: string;
  arguments: Record<string, any>;
};

/** Browser → Server: result of a tool execution */
export type ToolResultResponse = {
  requestId: string;
  functionId: string;
  result?: any;
  error?: string;
};

// ─── Flow Plan ───────────────────────────────────────────────────────────────

export type FlowPlan = {
  planId: string;
  intent: string;
  steps: FlowStep[];
};

export type FlowStep = {
  id: string;
  functionId: string;
  title: string;
  arguments: Record<string, any>;
  status: "pending" | "running" | "success" | "failed";
  result?: any;
};
