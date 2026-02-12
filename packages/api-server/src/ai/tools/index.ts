import { getServerStatus, echo } from "./server-tools";
import { browserExecute } from "./browser-proxy-tool";
import { executePlan } from "./execute-plan-tool";
import type { FunctionSchema } from "@ocean-mcp/shared";
import { tool } from "ai";
import { z } from "zod";

/** Static tools that are always available */
export const serverTools = {
  getServerStatus,
  echo,
};

/** Browser proxy tools */
export const browserTools = {
  browserExecute,
  executePlan,
};

/**
 * Merge all tools for a streamText call.
 * Combines server tools + browser proxy tools + dynamic tools from the frontend registry.
 */
export function getMergedTools(dynamicToolSchemas?: FunctionSchema[]) {
  const tools: Record<string, any> = {
    ...serverTools,
    ...browserTools,
  };

  // If dynamic tool schemas are provided from the frontend,
  // we can create additional tool definitions that give the LLM
  // better descriptions of available browser-side functions.
  if (dynamicToolSchemas && dynamicToolSchemas.length > 0) {
    // Create a tool that lists available browser functions for the LLM
    tools.listBrowserFunctions = tool({
      description:
        "List all available browser-side functions that can be executed",
      inputSchema: z.object({}),
      execute: async () => {
        return dynamicToolSchemas.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          operationType: s.operationType,
          parameters: s.parameters,
        }));
      },
    });
  }

  return tools;
}
