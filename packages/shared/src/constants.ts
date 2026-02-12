type ValueOf<T> = T[keyof T];

export const FUNCTION_TYPE = {
  CODE: "code",
  EXECUTOR: "executor",
} as const;
export type FunctionType = ValueOf<typeof FUNCTION_TYPE>;

export const OPERATION_TYPE = {
  READ: "read",
  WRITE: "write",
} as const;
export type OperationType = ValueOf<typeof OPERATION_TYPE>;

export const PARAMETER_TYPE = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  OBJECT: "object",
  ARRAY: "array",
} as const;
export type ParameterType = ValueOf<typeof PARAMETER_TYPE> | (string & {});

export const FLOW_STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
} as const;
export type FlowStepStatus = ValueOf<typeof FLOW_STEP_STATUS>;

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;
export type MessageRole = ValueOf<typeof MESSAGE_ROLE>;

export const MESSAGE_PART_TYPE = {
  TEXT: "text",
  REASONING: "reasoning",
  STEP_START: "step-start",
} as const;
export type MessagePartType = ValueOf<typeof MESSAGE_PART_TYPE>;

export const MESSAGE_PART_STATE = {
  STREAMING: "streaming",
} as const;
export type MessagePartState = ValueOf<typeof MESSAGE_PART_STATE>;

export const TOOL_PART_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  APPROVAL_REQUESTED: "approval-requested",
  APPROVAL_RESPONDED: "approval-responded",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
  OUTPUT_DENIED: "output-denied",
  CALL: "call",
  RESULT: "result",
} as const;
export type ToolPartState = ValueOf<typeof TOOL_PART_STATE>;

export const TOOL_PART_TYPE_PREFIX = "tool-" as const;
