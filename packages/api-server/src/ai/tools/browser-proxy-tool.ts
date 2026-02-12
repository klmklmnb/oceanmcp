import { tool } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";

/**
 * Browser proxy tool — executes a registered READ function on the browser side
 * via WebSocket. The function runs in the user's authenticated browser session.
 * Write/mutation functions must go through the executePlan tool instead.
 */
const browserExecuteParameters = z.object({
  functionId: z
    .string()
    .describe("The ID of the registered function to execute"),
  arguments: z
    .record(z.any())
    .describe("Arguments to pass to the function")
    .default({}),
});

/**
 * Browser proxy tool — executes a registered READ function on the browser side
 * via WebSocket. Only read/query operations are allowed here; write/mutation
 * operations must use the executePlan tool which requires user approval.
 */
export function createBrowserExecuteTool(connectionId?: string) {
  return tool({
    description:
      "Execute a registered READ function on the browser side. This runs in the user's authenticated browser session and can access the host web application's APIs, DOM, and state. IMPORTANT: This tool only supports read/query operations. For write/mutation operations, you MUST use the executePlan tool to generate a plan that requires user approval.",
    inputSchema: browserExecuteParameters,
    execute: async ({
      functionId,
      arguments: args,
    }: z.infer<typeof browserExecuteParameters>) => {
      // Check operationType — block write functions
      const toolSchemas = connectionManager.getToolSchemas(connectionId);
      const schema = toolSchemas.find((s) => s.id === functionId);
      if (schema && schema.operationType === "write") {
        return {
          error: `Function "${functionId}" is a write/mutation operation and cannot be executed directly via browserExecute. You MUST use the executePlan tool to propose a plan for write operations, which requires user approval before execution.`,
          functionId,
        };
      }

      try {
        return await connectionManager.executeBrowserTool(
          functionId,
          args,
          30_000,
          connectionId,
        );
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          functionId,
        };
      }
    },
  });
}
