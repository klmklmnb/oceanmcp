import { getServerStatus, echo } from "./server-tools";
import { createBrowserExecuteTool } from "./browser-proxy-tool";
import { createExecutePlanTool } from "./execute-plan-tool";
import {
  PARAMETER_TYPE,
  type FunctionSchema,
  type ParameterDefinition,
} from "@ocean-mcp/shared";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";

/** Static tools that are always available */
export const serverTools = {
  getServerStatus,
  echo,
};

function getBrowserTools(
  connectionId?: string,
): Record<string, Tool<any, any>> {
  return {
    browserExecute: createBrowserExecuteTool(connectionId),
    executePlan: createExecutePlanTool(connectionId),
  };
}

// Helper to convert parameter definitions to Zod schema
export function createZodSchema(parameters: ParameterDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of parameters) {
    let schema: z.ZodTypeAny;

    switch (param.type) {
      case PARAMETER_TYPE.STRING:
        schema = z.string();
        break;
      case PARAMETER_TYPE.NUMBER:
        schema = z.number();
        break;
      case PARAMETER_TYPE.BOOLEAN:
        schema = z.boolean();
        break;
      case PARAMETER_TYPE.OBJECT:
        schema = z.any();
        break;
      case PARAMETER_TYPE.ARRAY:
        schema = z.array(z.any());
        break;
      default:
        schema = z.any();
    }

    if (param.description) {
      schema = schema.describe(param.description);
    }

    if (!param.required) {
      schema = schema.optional();
    }

    shape[param.name] = schema;
  }

  return z.object(shape);
}

/**
 * Merge all tools for a streamText call.
 * Combines server tools + browser proxy tools + dynamic tools from the frontend registry.
 */
export function getMergedTools(
  dynamicToolSchemas?: FunctionSchema[],
  connectionId?: string,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    // ...serverTools,
    ...getBrowserTools(connectionId),
  };

  // If dynamic tool schemas are provided from the frontend,
  // we register them as native tools for the LLM.
  if (dynamicToolSchemas && dynamicToolSchemas.length > 0) {
    for (const schema of dynamicToolSchemas) {
      // Skip if already defined (collision avoidance)
      if (tools[schema.id]) continue;

      tools[schema.id] = tool({
        description: schema.description,
        inputSchema: createZodSchema(schema.parameters),
        execute: async (args) => {
          return connectionManager.executeBrowserTool(
            schema.id,
            args,
            30_000,
            connectionId,
          );
        },
      });
    }
  }

  return tools;
}
