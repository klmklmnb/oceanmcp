import { FUNCTION_TYPE } from "./constants";
import type {
  FlowStepStatus,
  FunctionType,
  OperationType,
  ParameterType,
} from "./constants";

// ─── Parameter Definition ────────────────────────────────────────────────────

export type ParameterDefinition = {
  name: string;
  type: ParameterType;
  description?: string;
  required: boolean;
};

// ─── Function Definitions ────────────────────────────────────────────────────

/** A "code" function: stored as a code string, executed via new Function() */
export type CodeFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: typeof FUNCTION_TYPE.CODE;
  operationType: OperationType;
  code: string;
  parameters: ParameterDefinition[];
};

/** An "executor" function: a real JS function registered by the host app */
export type ExecutorFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: typeof FUNCTION_TYPE.EXECUTOR;
  operationType: OperationType;
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
  type: FunctionType;
  operationType: OperationType;
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
  status: FlowStepStatus;
  result?: any;
};
