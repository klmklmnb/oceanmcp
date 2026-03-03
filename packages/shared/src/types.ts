import { FUNCTION_TYPE } from "./constants";
import type {
  FlowStepStatus,
  FunctionType,
  OperationType,
  ParameterType,
} from "./constants";

// ─── Model Configuration ─────────────────────────────────────────────────────

/**
 * LLM model configuration passed from the frontend SDK to the api-server.
 *
 * All fields are optional. When omitted the server falls back to the
 * corresponding `LLM_*` environment variables, then to built-in defaults.
 */
export interface ModelConfig {
  /** Primary model ID (e.g. "gpt-4o", "claude-sonnet-4-20250514"). Falls back to env `LLM_MODEL` → `"default"` alias. */
  default?: string;
  /** Fast / lightweight model ID used for simple tasks. Falls back to env `LLM_FAST_MODEL` → `LLM_MODEL`. */
  fast?: string;
  /** Maximum number of output tokens per response. Falls back to env `LLM_MAX_TOKENS` → `16384`. */
  maxTokens?: number;
}

// ─── File Attachment ─────────────────────────────────────────────────────────

export interface FileAttachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  /** Extra fields from the upload handler (e.g. id, file_id) */
  metadata?: Record<string, unknown>;
}

// ─── Parameter Definition ────────────────────────────────────────────────────

/** Per-column configuration for array parameters rendered as tables */
export interface ColumnConfig {
  /** Display label for the column header (defaults to field name) */
  label?: string;
  /** Custom cell renderer; receives the cell value and the full row object */
  render?: (value: any, row: Record<string, any>) => any;
}

export interface ParameterDefinition {
  name: string;
  type: ParameterType;
  description?: string;
  required: boolean;
  /** Display name override shown in the FlowNodeCard UI */
  showName?: string;
  /** Maps raw param values to custom render nodes; overrides the default value display in FlowNodeCard */
  enumMap?: Record<string, any>;
  /** Column config for array/object params; presence triggers table rendering */
  columns?: Record<string, ColumnConfig>;
}

// ─── Function Definitions ────────────────────────────────────────────────────

/** Common fields shared by all function definition variants */
export interface BaseFunctionDefinition {
  id: string;
  name: string;
  /** Localized Chinese display name; shown when locale is zh-CN */
  cnName?: string;
  description: string;
  operationType: OperationType;
  parameters: ParameterDefinition[];
  /** Custom render for the FlowNodeCard; receives the FlowStep info and should return a valid React node */
  showRender?: (step: FlowStep) => any;
}

/** A "code" function: stored as a code string, executed via new Function() */
export interface CodeFunctionDefinition extends BaseFunctionDefinition {
  type: typeof FUNCTION_TYPE.CODE;
  code: string;
}

/** An "executor" function: a real JS function registered by the host app */
export interface ExecutorFunctionDefinition extends BaseFunctionDefinition {
  type: typeof FUNCTION_TYPE.EXECUTOR;
  executor: (args: Record<string, any>) => Promise<any>;
}

export type FunctionDefinition =
  | CodeFunctionDefinition
  | ExecutorFunctionDefinition;

/** Serializable definition sent to the server (no executor fn) */
export interface FunctionSchema {
  id: string;
  name: string;
  description: string;
  type: FunctionType;
  operationType: OperationType;
  parameters: ParameterDefinition[];
}

// ─── WebSocket: Tool Execution ───────────────────────────────────────────────

/** Server → Browser: execute a tool on the browser side */
export interface ExecuteToolRequest {
  requestId: string;
  functionId: string;
  arguments: Record<string, any>;
}

/** Browser → Server: result of a tool execution */
export interface ToolResultResponse {
  requestId: string;
  functionId: string;
  result?: any;
  error?: string;
}

// ─── Flow Plan ───────────────────────────────────────────────────────────────

export interface FlowPlan {
  planId: string;
  intent: string;
  steps: FlowStep[];
}

export interface FlowStep {
  id: string;
  functionId: string;
  title: string;
  arguments: Record<string, any>;
  status: FlowStepStatus;
  result?: any;
}
