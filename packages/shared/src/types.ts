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

// ─── JSON Schema Parameters ─────────────────────────────────────────────────

/**
 * A single property definition within a JSON Schema object.
 *
 * Supports the subset of JSON Schema Draft 7 commonly used for
 * LLM tool parameter definitions. Recursive for nested objects.
 */
export interface JSONSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  const?: unknown;
  default?: unknown;

  // ── String constraints ──
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // ── Number constraints ──
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // ── Array constraints ──
  items?: JSONSchemaProperty;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // ── Object constraints (nested) ──
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;

  // ── Composition ──
  oneOf?: JSONSchemaProperty[];
  anyOf?: JSONSchemaProperty[];
  allOf?: JSONSchemaProperty[];
  not?: JSONSchemaProperty;

  // ── References ──
  $ref?: string;

  /** Allow additional JSON Schema keywords not explicitly listed */
  [key: string]: unknown;
}

/**
 * JSON Schema parameter definition for function tools.
 *
 * An alternative to `ParameterDefinition[]` that allows describing tool
 * parameters using standard JSON Schema (Draft 7) format. This provides
 * richer type information including nested objects, constraints, union
 * types, and more.
 *
 * @example
 * ```ts
 * const params: JSONSchemaParameters = {
 *   type: "object",
 *   required: ["weight", "destination"],
 *   properties: {
 *     weight: { type: "number", description: "包裹重量（千克）" },
 *     destination: { type: "string", description: "目的地国家/城市" },
 *     express: { type: "boolean", description: "是否使用加急物流" },
 *   },
 *   additionalProperties: false,
 * };
 * ```
 */
export interface JSONSchemaParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;
  description?: string;
  /** Allow additional JSON Schema keywords (e.g. $schema, definitions) */
  [key: string]: unknown;
}

/**
 * Parameters for a function tool — either the legacy array format
 * or a JSON Schema object.
 *
 * - `ParameterDefinition[]` — the original flat array format
 * - `JSONSchemaParameters` — a JSON Schema Draft 7 object with
 *   `type: "object"` and `properties`
 *
 * Use {@link isJSONSchemaParameters} to distinguish between the two
 * formats at runtime.
 */
export type FunctionParameters = ParameterDefinition[] | JSONSchemaParameters;

/**
 * Runtime type guard to distinguish JSON Schema parameters from the
 * legacy `ParameterDefinition[]` format.
 *
 * @returns `true` if `params` is a JSON Schema object (has `type: "object"`
 *          and `properties`), `false` if it's a legacy array.
 */
export function isJSONSchemaParameters(
  params: FunctionParameters,
): params is JSONSchemaParameters {
  return (
    !Array.isArray(params) &&
    typeof params === "object" &&
    params !== null &&
    (params as JSONSchemaParameters).type === "object" &&
    typeof (params as JSONSchemaParameters).properties === "object" &&
    (params as JSONSchemaParameters).properties !== null
  );
}

// ─── DOM Render Descriptor ───────────────────────────────────────────────────

/**
 * Framework-agnostic render descriptor for `showRender`.
 *
 * Instead of returning a React element (which requires the same React instance
 * as the SDK), host applications can return a `DOMRenderDescriptor`. The SDK
 * will create a container `<div>`, pass it to `render`, and call `cleanup` on
 * unmount.
 *
 * This allows the host to render with any technology: vanilla DOM, Vue,
 * Angular, a different React version, or imperative libraries like G2.
 */
export interface DOMRenderDescriptor {
  type: "dom";
  /** Called with a mounted DOM container — render your content into it. */
  render: (container: HTMLElement) => void;
  /** Called when the SDK unmounts the container — clean up resources here. */
  cleanup?: () => void;
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
  /**
   * Parameter definitions for this tool.
   *
   * Accepts either:
   * - `ParameterDefinition[]` — the legacy flat array format
   * - `JSONSchemaParameters` — a JSON Schema object with `type: "object"`
   *   and `properties` for richer type definitions
   *
   * Use {@link isJSONSchemaParameters} to distinguish the two formats.
   */
  parameters: FunctionParameters;
  /**
   * Custom render for the tool card UI.
   *
   * Can return either:
   * - A React node (for SDK-internal tools sharing the same React instance)
   * - A {@link DOMRenderDescriptor} (for host applications — framework-agnostic)
   */
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
  /**
   * Parameter definitions — legacy `ParameterDefinition[]` or JSON Schema.
   * @see BaseFunctionDefinition["parameters"]
   */
  parameters: FunctionParameters;
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
