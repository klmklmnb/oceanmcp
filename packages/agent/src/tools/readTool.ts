import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentContext } from "../types";

export function createReadTool(context: AgentContext) {
  return new DynamicStructuredTool({
    name: "read_data",
    description: `Execute one or more read operations to fetch data. Available READ functions:
${context.functions
  .filter((f) => f.type === "read")
  .map((f) => `- ${f.id}: ${f.description} (params: ${f.parameters.map((p) => p.name).join(", ") || "none"})`)
  .join("\n")}

Use result substitution with $N syntax to chain reads (e.g., $0.field references the first read's result).`,
    
    schema: z.object({
      reads: z.array(
        z.object({
          functionId: z.string().describe("The function ID to call"),
          arguments: z.record(z.unknown()).default({}).describe("Arguments for the function. Use $N.path syntax to reference previous read results."),
        })
      ).describe("Array of read operations to execute sequentially"),
    }),
    
    func: async ({ reads }) => {
      const requestId = `read-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      const readOperations = reads.map((read, index) => ({
        id: `${requestId}-${index}`,
        functionId: read.functionId,
        arguments: read.arguments,
      }));
      
      try {
        const results = await context.sendExecuteRead(requestId, readOperations);
        return JSON.stringify(results, null, 2);
      } catch (error) {
        return `Error executing reads: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}
