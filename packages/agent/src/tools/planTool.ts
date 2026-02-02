import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentContext } from "../types";

export function createPlanTool(context: AgentContext) {
  return new DynamicStructuredTool({
    name: "create_plan",
    description: `Create an execution plan for write operations.

Available WRITE functions:
${context.functions
  .filter((f) => f.type === "write")
  .map((f) => {
    const params = f.parameters.length > 0 
      ? f.parameters.map((p) => `"${p.name}": <${p.type}>`).join(", ")
      : "";
    return `- ${f.id}: ${f.description}
  Required arguments: { ${params || "none"} }`;
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
        z.object({
          functionId: z.string().describe("The write function ID to call"),
          arguments: z.record(z.string(), z.any()).describe("REQUIRED object with function parameters. For createCluster use {\"env\": \"testing\"}. Never omit this field."),
          title: z.string().describe("A human-readable title for this step"),
        })
      ).describe("Steps to execute. Each step MUST have functionId, arguments, and title."),
    }),
    
    func: async ({ intent, steps }) => {
      const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      const plan = {
        planId,
        intent,
        nodes: steps.map((step, index) => ({
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
