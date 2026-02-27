import { tool } from "ai";
import { z } from "zod";
import { OPERATION_TYPE } from "@ocean-mcp/shared";
import { connectionManager } from "../../ws/connection-manager";

/**
 * Prefix used to namespace server-side tool IDs in the blocklist.
 *
 * The guard set stores entries as `"__ocean__<toolName>"` so that a
 * host application registering a browser-side function with the same
 * bare name (e.g. `"echo"`) will NOT be incorrectly blocked.
 *
 * Callers must use `isServerSideTool()` for the prefixed lookup.
 */
const SERVER_TOOL_PREFIX = "__ocean__";

/**
 * Server-side tool names that must NOT be routed through the browser,
 * stored with the `__ocean__` prefix to avoid collisions with
 * identically-named browser-registered tools from host applications.
 *
 * These tools are executed directly by the Vercel AI SDK on the server.
 * If the LLM mistakenly wraps them in a browserExecute or executePlan
 * call, we reject early with a helpful message so the model can
 * self-correct.
 */
const SERVER_SIDE_TOOL_IDS = new Set([
  `${SERVER_TOOL_PREFIX}loadSkill`,
  `${SERVER_TOOL_PREFIX}userSelect`,
  `${SERVER_TOOL_PREFIX}browserExecute`,
  `${SERVER_TOOL_PREFIX}executePlan`,
  `${SERVER_TOOL_PREFIX}getServerStatus`,
  `${SERVER_TOOL_PREFIX}echo`,
]);

/**
 * Check whether `functionId` is a known server-side tool that must not
 * be dispatched to the browser.
 *
 * The check only matches when the tool is NOT registered on the current
 * browser connection (standalone or skill-bundled). This way, if a host
 * app registers a browser-side tool whose name collides with a
 * server-side tool, the browser-side version is still allowed through.
 */
export function isServerSideTool(
  functionId: string,
  connectionId?: string,
): boolean {
  if (!SERVER_SIDE_TOOL_IDS.has(`${SERVER_TOOL_PREFIX}${functionId}`)) {
    return false;
  }

  // If the browser connection actually registered a tool with this name,
  // it is a legitimate browser tool — let it through.
  const browserTools = connectionManager.getToolSchemas(connectionId);
  if (browserTools.some((t) => t.id === functionId)) {
    return false;
  }

  const browserSkills = connectionManager.getSkillSchemas(connectionId);
  for (const skill of browserSkills) {
    if (skill.tools?.some((t) => t.id === functionId)) {
      return false;
    }
  }

  return true;
}

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
      // Block server-side tools — they should be called directly, not via browserExecute
      if (isServerSideTool(functionId, connectionId)) {
        return {
          error: `"${functionId}" is a server-side tool and cannot be executed via browserExecute. Call the "${functionId}" tool directly instead.`,
          functionId,
        };
      }

      // Check operationType — block write functions
      const toolSchemas = connectionManager.getToolSchemas(connectionId);
      const schema = toolSchemas.find((s) => s.id === functionId);
      if (schema && schema.operationType === OPERATION_TYPE.WRITE) {
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
