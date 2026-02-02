import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentContext } from "../types";

export function createPlanTool(context: AgentContext) {
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
    name: "create_plan",
    description: `Create an execution plan for write operations.

Available WRITE functions:
${context.functions
  .filter((f) => f.type === "write")
  .map((f) => {
    const requiredParams =
      f.parameters.length > 0
        ? f.parameters
            .filter((p) => p.required)
            .map((p) => `"${p.name}": <${p.type}>`)
            .join(", ")
        : "";
    const optionalParams =
      f.parameters.length > 0
        ? f.parameters
            .filter((p) => !p.required)
            .map((p) => `"${p.name}": <${p.type}>`)
            .join(", ")
        : "";
    return `- ${f.id}: ${f.description}
  Required arguments: { ${requiredParams || "none"} }
  Optional arguments: { ${optionalParams || "none"} }`;
  })
  .join("\n")}

CRITICAL: Each step MUST include an "arguments" field with all required parameters. Example:
{
  "functionId": "createCluster",
  "arguments": { "env": "testing" },
  "title": "Create testing cluster"
}

The plan will be sent to the user.`,
    
    schema: z.object({
      intent: z.string().describe("A brief description of what this plan aims to accomplish"),
      steps: z.array(
        z
          .object({
            functionId: z.string().describe("The write function ID to call"),
            arguments: z
              .record(z.string(), z.any())
              .optional()
              .describe(
                "REQUIRED object with function parameters. For createCluster use {\"env\": \"testing\"}. Never omit this field."
              ),
            title: z.string().describe("A human-readable title for this step"),
          })
          .passthrough()
      ).describe("Steps to execute. Each step MUST have functionId, arguments, and title."),
    }),
    
    func: async ({ intent, steps }) => {
      const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const missingRequired: string[] = [];

      const normalizedSteps = steps.map((step) => {
        const { functionId, arguments: args, title, ...rest } = step;
        const normalizedArgs =
          args && Object.keys(args).length > 0 ? args : rest;
        return {
          functionId,
          title,
          arguments: normalizedArgs ?? {},
        };
      });

      normalizedSteps.forEach((step, index) => {
        const missing = getMissingRequiredParams(step.functionId, step.arguments);
        if (missing.length > 0) {
          missingRequired.push(
            `steps[${index}] ${step.functionId}: ${missing.join(", ")}`
          );
        }
      });

      if (missingRequired.length > 0) {
        return `Missing required parameters for create_plan. Please retry with these missing params: ${missingRequired.join(
          " | "
        )}`;
      }
      
      const plan = {
        planId,
        intent,
        nodes: normalizedSteps.map((step, index) => ({
          id: `${planId}-${index}`,
          functionId: step.functionId,
          title: step.title,
          arguments: step.arguments,
          status: "pending" as const,
        })),
      };
      
      const success = context.sendProposeFlow(plan);
      
      if (success) {
        return `Plan "${intent}" created with ${steps.length} step(s).`;
      } else {
        return "Failed to send plan to user. The WebSocket connection may be unavailable.";
      }
    },
  });
}
