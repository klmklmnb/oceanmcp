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
  /**
   * Fast / lightweight model ID used for simple, low-latency tasks
   * (e.g. intent classification, short summaries, tool-selection steps).
   *
   * Falls back to env `LLM_FAST_MODEL` → `LLM_MODEL` → `"gpt-4o-mini"`.
   *
   * **Not yet consumed by the server** — the value is forwarded in every
   * `/api/chat` request but the server currently only reads `default`.
   * This field is reserved for future use once task-level model routing
   * is implemented on the server side.
   */
  fast?: string;
  /** Maximum number of output tokens per response. Falls back to env `LLM_MAX_TOKENS` → `16384`. */
  maxTokens?: number;

  // ── Thinking / Reasoning Configuration ───────────────────────────────

  /**
   * Claude thinking budget in tokens.
   *
   * Controls the `thinking.budget_tokens` parameter sent to Claude models
   * via OpenAI-compatible proxies that require it.
   *
   * Falls back to env `LLM_THINKING_BUDGET` → `10240`.
   * Set to `0` to disable thinking for Claude.
   */
  thinkingBudget?: number;

  /**
   * OpenAI reasoning effort level.
   *
   * Controls the `reasoning_effort` parameter sent to OpenAI reasoning
   * models (e.g. gpt-5.1+, o1, o3, o4).
   *
   * Falls back to env `LLM_REASONING_EFFORT` → `"medium"`.
   * Set to `"disabled"` to skip injection.
   */
  reasoningEffort?: "low" | "medium" | "high" | "none" | "disabled";

  /**
   * GLM thinking toggle.
   *
   * Controls the `extra_body.chat_template_kwargs.enable_thinking`
   * parameter sent to GLM models.
   *
   * Falls back to env `LLM_GLM_THINKING` → `true`.
   */
  glmThinking?: boolean;
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
  /**
   * When `true` and `operationType` is `"write"`, the tool can be executed
   * directly via `browserExecute` without going through the `executePlan`
   * approval flow.  Has no effect on `"read"` tools (they already execute
   * immediately).
   *
   * @default false
   */
  autoApprove?: boolean;
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
  /** @see BaseFunctionDefinition["autoApprove"] */
  autoApprove?: boolean;
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
