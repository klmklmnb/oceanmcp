import { tool } from "ai";
import { z } from "zod";
import { FLOW_STEP_STATUS, isJSONSchemaParameters } from "@ocean-mcp/shared";
import { connectionManager } from "../../ws/connection-manager";
import { createZodSchema } from "./index";
import { containsVariableRef, resolveVariableRefs } from "./variable-ref";
import { isServerSideTool } from "./browser-proxy-tool";
import type { ToolRetryTracker } from "./retry-tracker";

type Step = {
  functionId: string;
  arguments: Record<string, any>;
  title: string;
};

/**
 * Look up a tool schema by functionId across both standalone tools and
 * skill-bundled tools, mirroring the same fallback logic used by the
 * browserExecute write guard.
 */
function findToolSchema(
  functionId: string,
  connectionId?: string,
): import("@ocean-mcp/shared").FunctionSchema | undefined {
  const toolSchemas = connectionManager.getToolSchemas(connectionId);
  let schema = toolSchemas.find((s) => s.id === functionId);
  if (!schema) {
    const skillSchemas = connectionManager.getSkillSchemas(connectionId);
    for (const skill of skillSchemas) {
      schema = skill.tools?.find((t) => t.id === functionId);
      if (schema) break;
    }
  }
  return schema;
}

/**
 * Validate all steps' arguments against their registered Zod schemas.
 * Steps whose arguments contain $N variable references are skipped because
 * their actual values are only known at execution time.
 * Returns null if all (validatable) steps are valid, or a descriptive error
 * string on first failure.
 */
function validateSteps(steps: Step[], connectionId?: string): string | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Block server-side tools — they cannot be used as executePlan steps
    if (isServerSideTool(step.functionId, connectionId)) {
      return `Step ${i} ("${step.functionId}"): "${step.functionId}" is a server-side tool and cannot be used in an executePlan step. Call it directly instead.`;
    }

    // Skip validation for steps that contain variable references —
    // their argument values depend on previous step results and can't
    // be validated statically.
    if (containsVariableRef(step.arguments)) {
      continue;
    }

    // Search both standalone and skill-bundled tool registries
    const schema = findToolSchema(step.functionId, connectionId);
    if (schema) {
      // Determine if the tool has parameters worth validating
      const hasParams = isJSONSchemaParameters(schema.parameters)
        ? Object.keys(schema.parameters.properties).length > 0
        : schema.parameters.length > 0;

      if (hasParams && !isJSONSchemaParameters(schema.parameters)) {
        // Only validate legacy ParameterDefinition[] with Zod.
        // JSON Schema params are validated by the AI SDK's own validation.
        const zodSchema = createZodSchema(schema.parameters);
        const parseResult = zodSchema.safeParse(step.arguments);

        if (!parseResult.success) {
          const issues = parseResult.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
          return `Step ${i} ("${step.functionId}"): ${issues}`;
        }
      }
    }
  }

  return null;
}

/**
 * Execute a multi-step plan with write operations.
 *
 * Validation gate: `needsApproval` is a function that validates each step's
 * arguments against the registered schema BEFORE the user ever sees the plan.
 * - If validation passes → returns true → plan is shown to user for approval.
 * - If validation fails  → returns false → execute runs immediately, returns
 *   the error to the LLM for silent retry. The user never sees the bad plan.
 */
export function createExecutePlanTool(connectionId?: string, retryTracker?: ToolRetryTracker) {
  return tool({
    description:
      "Execute a multi-step plan with write/mutation operations on the host web application. Each step calls a registered browser-side function. The user must approve the plan before execution proceeds.",
    inputSchema: z.object({
      intent: z
        .string()
        .describe("A clear description of what this plan accomplishes"),
      steps: z.preprocess(
        (val) => {
          // LLMs sometimes emit `steps` as a JSON string instead of an array.
          // Parse it so Zod validation succeeds without a hard failure.
          if (typeof val === "string") {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // fall through — let Zod report the validation error
            }
          }
          return val;
        },
        z.array(
          z.object({
            functionId: z
              .string()
              .describe("The ID of the registered function to execute"),
            arguments: z
              .record(z.any())
              .describe("Arguments to pass to the function")
              .default({}),
            title: z
              .string()
              .describe("A human-readable title describing this step"),
          }),
        ),
      ),
    }),

    // Validation gate: only ask for user approval when all steps pass validation.
    // Invalid plans auto-execute (returning the validation error to the LLM for
    // silent retry) — the user never sees them.
    needsApproval: async (input) => {
      const validationError = validateSteps(input.steps, connectionId);
      return validationError === null;
    },

    execute: async ({ steps }) => {
      // Re-validate: if needsApproval returned false (invalid), this runs
      // immediately and returns the error to the LLM for retry.
      const validationError = validateSteps(steps, connectionId);
      if (validationError) {
        // When a retry tracker is present, consume a retry attempt for the
        // "executePlan" pseudo-function so the LLM cannot loop forever.
        const canRetry = retryTracker
          ? retryTracker.recordFailure("executePlan")
          : true; // backward compat: no tracker → always allow retry

        if (canRetry) {
          return {
            _silentRetry: true,
            totalSteps: steps.length,
            completedSteps: 0,
            validationError: `Validation failed — ${validationError}. Please regenerate the plan with correct parameters.`,
          };
        }

        // Retry budget exhausted — surface the error to the user.
        return {
          totalSteps: steps.length,
          completedSteps: 0,
          validationError: `Validation failed after ${retryTracker!.max} retries — ${validationError}. Report this error to the user.`,
          _retryExhausted: true,
        };
      }

      // All steps validated — proceed with actual execution.
      // stepResults maps step index → its return value, used for $N resolution.
      const stepResults = new Map<number, any>();
      const results: Array<{
        stepIndex: number;
        title: string;
        functionId: string;
        status:
          | typeof FLOW_STEP_STATUS.SUCCESS
          | typeof FLOW_STEP_STATUS.FAILED;
        result?: any;
        error?: string;
      }> = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          // Resolve $N variable references in arguments using previous step results.
          const resolvedArgs = resolveVariableRefs(
            step.arguments,
            stepResults,
          ) as Record<string, any>;

          const result = await connectionManager.executeBrowserTool(
            step.functionId,
            resolvedArgs,
            30_000,
            connectionId,
          );

          // Store the result so subsequent steps can reference it via $i.
          stepResults.set(i, result);

          results.push({
            stepIndex: i,
            title: step.title,
            functionId: step.functionId,
            status: FLOW_STEP_STATUS.SUCCESS,
            result,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const canRetry = retryTracker
            ? retryTracker.recordFailure(step.functionId)
            : false;

          results.push({
            stepIndex: i,
            title: step.title,
            functionId: step.functionId,
            status: FLOW_STEP_STATUS.FAILED,
            error: errMsg,
            ...(retryTracker && canRetry
              ? {
                  _retryHint: `Step execution failed (attempt ${retryTracker.getAttempt(step.functionId) - 1}/${retryTracker.max}). Regenerate the plan with corrected parameters for this step.`,
                }
              : retryTracker
                ? {
                    _retryExhausted: true,
                    _retryHint: `Step execution failed and retry limit (${retryTracker.max}) reached. Report this error to the user.`,
                  }
                : {}),
          });
          // Stop on first failure
          break;
        }
      }

      return {
        totalSteps: steps.length,
        completedSteps: results.length,
        results,
      };
    },
  });
}
