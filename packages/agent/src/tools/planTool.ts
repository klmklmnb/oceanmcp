import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentContext } from "../types";

export function createPlanTool(context: AgentContext) {
  return new DynamicStructuredTool({
    name: "create_plan",
    description: `Create an execution plan for write operations that require user approval. Available WRITE functions:
${context.functions
  .filter((f) => f.type === "write")
  .map((f) => `- ${f.id}: ${f.description} (params: ${f.parameters.map((p) => `${p.name}: ${p.type}`).join(", ") || "none"})`)
  .join("\n")}

IMPORTANT: For each step, you MUST include the required arguments object with all necessary parameters. For example, if calling "restartCluster" for cluster-1, the step should have: { "functionId": "restartCluster", "arguments": { "clusterId": "cluster-1" }, "title": "..." }

The plan will be shown to the user for review before execution.`,
    
    schema: z.object({
      intent: z.string().describe("A brief description of what this plan aims to accomplish"),
      steps: z.array(
        z.object({
          functionId: z.string().describe("The write function ID to call"),
          arguments: z.record(z.unknown()).optional().default({}).describe("Arguments for the function. Include all necessary parameters like clusterId, nodeCount, etc."),
          title: z.string().describe("A human-readable title for this step"),
        })
      ).describe("Array of steps to execute in order. Each step MUST include the arguments object with required parameters."),
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
        return `Plan "${intent}" sent to user for review. The plan contains ${steps.length} step(s). Waiting for user approval before execution.`;
      } else {
        return "Failed to send plan to user. The WebSocket connection may be unavailable.";
      }
    },
  });
}
