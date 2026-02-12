import { tool } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";

/**
 * Browser proxy tool — executes a registered function on the browser side
 * via WebSocket. The function runs in the user's authenticated browser session.
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
 * Browser proxy tool — executes a registered function on the browser side
 * via WebSocket. The function runs in the user's authenticated browser session.
 */
export const browserExecute = tool({
  description:
    "Execute a registered function on the browser side. This runs in the user's authenticated browser session and can access the host web application's APIs, DOM, and state.",
  inputSchema: browserExecuteParameters,
  execute: async ({
    functionId,
    arguments: args,
  }: z.infer<typeof browserExecuteParameters>) => {
    try {
      const result = await connectionManager.executeBrowserTool(
        functionId,
        args,
      );
      return result;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        functionId,
      };
    }
  },
});
