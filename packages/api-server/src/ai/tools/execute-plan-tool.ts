import { tool } from "ai";
import { z } from "zod";
import { FLOW_STEP_STATUS } from "@ocean-mcp/shared";
import { connectionManager } from "../../ws/connection-manager";
import { createZodSchema } from "./index";
import { containsVariableRef, resolveVariableRefs } from "./variable-ref";

type Step = {
  functionId: string;
  arguments: Record<string, any>;
  title: string;
};

/**
 * Validate all steps' arguments against their registered Zod schemas.
 * Steps whose arguments contain $N variable references are skipped because
 * their actual values are only known at execution time.
 * Returns null if all (validatable) steps are valid, or a descriptive error
 * string on first failure.
 */
function validateSteps(steps: Step[], connectionId?: string): string | null {
  const toolSchemas = connectionManager.getToolSchemas(connectionId);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Skip validation for steps that contain variable references —
    // their argument values depend on previous step results and can't
    // be validated statically.
    if (containsVariableRef(step.arguments)) {
      continue;
    }

    const schema = toolSchemas.find((s) => s.id === step.functionId);
    if (schema && schema.parameters.length > 0) {
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
export function createExecutePlanTool(connectionId?: string) {
  return tool({
    description:
      "Execute a multi-step plan with write/mutation operations on the host web application. Each step calls a registered browser-side function. The user must approve the plan before execution proceeds.",
    inputSchema: z.object({
      intent: z
        .string()
        .describe("A clear description of what this plan accomplishes"),
      steps: z.array(
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
        return {
          _silentRetry: true,
          totalSteps: steps.length,
          completedSteps: 0,
          validationError: `Validation failed — ${validationError}. Please regenerate the plan with correct parameters.`,
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
          results.push({
            stepIndex: i,
            title: step.title,
            functionId: step.functionId,
            status: FLOW_STEP_STATUS.FAILED,
            error: error instanceof Error ? error.message : String(error),
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
