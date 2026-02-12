import { tool } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";

/**
 * Execute a multi-step plan with write operations.
 * Uses Vercel AI SDK's built-in approval flow via `needsApproval: true`.
 * The user must approve the plan before any steps are executed.
 */
export const executePlan = tool({
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
  needsApproval: true,
  execute: async ({ steps }) => {
    const results: Array<{
      stepIndex: number;
      title: string;
      functionId: string;
      status: "success" | "failed";
      result?: any;
      error?: string;
    }> = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await connectionManager.executeBrowserTool(
          step.functionId,
          step.arguments,
        );
        results.push({
          stepIndex: i,
          title: step.title,
          functionId: step.functionId,
          status: "success",
          result,
        });
      } catch (error) {
        results.push({
          stepIndex: i,
          title: step.title,
          functionId: step.functionId,
          status: "failed",
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
