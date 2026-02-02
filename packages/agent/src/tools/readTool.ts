import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentContext } from "../types";

export function createReadTool(context: AgentContext) {
  const functionMap = new Map(context.functions.map((f) => [f.id, f]));

  const getMissingRequiredParams = (
    functionId: string,
    args: Record<string, unknown>
  ): string[] => {
    const func = functionMap.get(functionId);
    if (!func) {
      return [];
    }
    return func.parameters
      .filter((p) => p.required)
      .filter((p) => args[p.name] === undefined)
      .map((p) => p.name);
  };

  return new DynamicStructuredTool({
    name: "read_data",
    description: `Execute one or more read operations to fetch data. Available READ functions:
${context.functions
  .filter((f) => f.type === "read")
  .map(
    (f) =>
      `- ${f.id}: ${f.description} (params: ${
        f.parameters.length > 0
          ? f.parameters
              .map((p) => `${p.name}${p.required ? "" : " (optional)"}`)
              .join(", ")
          : "none"
      })`
  )
  .join("\n")}

Use result substitution with $N syntax to chain reads (e.g., $0.field references the first read's result).
Provide parameters inside the "arguments" object. If parameters are provided at the top level of a read item, they will be treated as arguments.`,
    
    schema: z.object({
      reads: z.array(
        z
          .object({
            functionId: z.string().describe("The function ID to call"),
            arguments: z
              .record(z.unknown())
              .optional()
              .describe(
                "Arguments for the function. Use $N.path syntax to reference previous read results."
              ),
          })
          .passthrough()
      ).describe("Array of read operations to execute sequentially"),
    }),
    
    func: async ({ reads }) => {
      const requestId = `read-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const missingRequired: string[] = [];

      const normalizedReads = reads.map((read) => {
        const { functionId, arguments: args, ...rest } = read;
        const normalizedArgs =
          args && Object.keys(args).length > 0 ? args : rest;
        return {
          functionId,
          arguments: normalizedArgs ?? {},
        };
      });

      normalizedReads.forEach((read, index) => {
        const missing = getMissingRequiredParams(
          read.functionId,
          read.arguments
        );
        if (missing.length > 0) {
          missingRequired.push(
            `reads[${index}] ${read.functionId}: ${missing.join(", ")}`
          );
        }
      });

      if (missingRequired.length > 0) {
        return `Missing required parameters for read_data. Please retry with these missing params: ${missingRequired.join(
          " | "
        )}`;
      }
      
      const readOperations = normalizedReads.map((read, index) => ({
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
