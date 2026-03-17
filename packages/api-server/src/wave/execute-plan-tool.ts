import { tool, type Tool } from "ai";
import { z } from "zod";
import { FLOW_STEP_STATUS, getErrorMessage } from "@ocean-mcp/shared";
import type { WaveClients } from "./client";
import {
  addPendingPlanApproval,
  PLAN_APPROVAL_ACTION,
  type PendingPlanStep,
} from "./pending-approvals";
import {
  sendExecutePlanCard,
  updateExecutePlanResultCard,
} from "./message-sender";
import {
  containsVariableRef,
  resolveVariableRefs,
} from "../ai/tools/variable-ref";

type Step = PendingPlanStep;

type ExecutableWaveTool = Tool<any, any> & {
  execute?: (
    args: Record<string, any>,
    options?: Record<string, any>,
  ) => Promise<any>;
  inputSchema?: {
    safeParse?: (input: unknown) =>
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };
  };
};

const BLOCKED_STEP_TOOL_IDS = new Set([
  "executePlan",
  "loadSkill",
  "askUser",
]);

function getWaveExecutableTool(
  functionId: string,
  getTools: () => Record<string, Tool<any, any>>,
): ExecutableWaveTool | undefined {
  const candidate = getTools()[functionId] as ExecutableWaveTool | undefined;
  if (!candidate || typeof candidate.execute !== "function") {
    return undefined;
  }
  return candidate;
}

function validateSteps(
  steps: Step[],
  getTools: () => Record<string, Tool<any, any>>,
): string | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (BLOCKED_STEP_TOOL_IDS.has(step.functionId)) {
      return `Step ${i} ("${step.functionId}"): "${step.functionId}" cannot be used as an executePlan step in Wave.`;
    }

    const toolDef = getWaveExecutableTool(step.functionId, getTools);
    if (!toolDef) {
      return `Step ${i} ("${step.functionId}"): tool "${step.functionId}" is not available in the current Wave session.`;
    }

    if (containsVariableRef(step.arguments)) {
      continue;
    }

    const parseResult = toolDef.inputSchema?.safeParse?.(step.arguments);
    if (parseResult && !parseResult.success) {
      const issues = parseResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      return `Step ${i} ("${step.functionId}"): ${issues}`;
    }
  }

  return null;
}

export function createWaveExecutePlanTool(
  getTools: () => Record<string, Tool<any, any>>,
  clients: WaveClients,
  chatId: string,
  sessionKey: string,
  senderId: string,
) {
  return tool({
    description:
      "Execute a multi-step plan with write or mutation operations in Wave. " +
      "Each step calls an available Wave/server-side tool. Before execution, " +
      "Wave will send an approval card that the user must click to approve or deny.",
    inputSchema: z.object({
      intent: z
        .string()
        .describe("A clear description of what this plan accomplishes"),
      steps: z.preprocess(
        (val) => {
          if (typeof val === "string") {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // let Zod report the error
            }
          }
          return val;
        },
        z.array(
          z.object({
            functionId: z
              .string()
              .describe("The ID of the Wave/server-side tool to execute"),
            arguments: z
              .record(z.any())
              .describe("Arguments to pass to the tool")
              .default({}),
            title: z
              .string()
              .describe("A human-readable title describing this step"),
          }),
        ),
      ),
    }),
    execute: async ({ intent, steps }, options) => {
      const validationError = validateSteps(steps, getTools);
      if (validationError) {
        return {
          _silentRetry: true,
          totalSteps: steps.length,
          completedSteps: 0,
          validationError: `Validation failed — ${validationError}. Please regenerate the plan with correct parameters.`,
        };
      }

      const planCardMessageId = await sendExecutePlanCard(
        clients,
        chatId,
        intent,
        steps,
      );
      if (!planCardMessageId) {
        return {
          error: "Failed to send executePlan approval card in Wave.",
          totalSteps: steps.length,
          completedSteps: 0,
          results: [],
        };
      }

      let decision: string;
      try {
        decision = await addPendingPlanApproval(
          planCardMessageId,
          { intent, steps },
          sessionKey,
        );
      } catch (error) {
        const reason = getErrorMessage(error);
        return {
          denied: true,
          reason,
          totalSteps: steps.length,
          completedSteps: 0,
          results: [],
        };
      }

      if (decision !== PLAN_APPROVAL_ACTION.APPROVE) {
        return {
          denied: true,
          reason: "User denied the plan in Wave.",
          totalSteps: steps.length,
          completedSteps: 0,
          results: [],
        };
      }

      const stepResults = new Map<number, any>();
      const results: Array<{
        stepIndex: number;
        title: string;
        functionId: string;
        status:
          | typeof FLOW_STEP_STATUS.SUCCESS
          | typeof FLOW_STEP_STATUS.FAILED;
        result?: any;
        error?: string;
      }> = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          const resolvedArgs = resolveVariableRefs(
            step.arguments,
            stepResults,
          ) as Record<string, any>;
          const toolDef = getWaveExecutableTool(step.functionId, getTools);
          if (!toolDef?.execute) {
            throw new Error(
              `Tool "${step.functionId}" is no longer available in the current Wave session.`,
            );
          }

          const result = await toolDef.execute(resolvedArgs, {
            toolCallId: options?.toolCallId,
            messages: options?.messages,
            abortSignal: options?.abortSignal,
            // Bypass the Wave write-tool guard: this step has been approved
            // by the user via the interactive approval card.
            __waveExecutePlanApproved: true,
          });

          stepResults.set(i, result);
          results.push({
            stepIndex: i,
            title: step.title,
            functionId: step.functionId,
            status: FLOW_STEP_STATUS.SUCCESS,
            result,
          });
        } catch (error) {
          results.push({
            stepIndex: i,
            title: step.title,
            functionId: step.functionId,
            status: FLOW_STEP_STATUS.FAILED,
            error: getErrorMessage(error),
          });
          break;
        }
      }

      const finalResult = {
        totalSteps: steps.length,
        completedSteps: results.length,
        results,
      };

      await updateExecutePlanResultCard(
        clients,
        planCardMessageId,
        intent,
        steps,
        finalResult,
      );

      // Post-plan action buttons (总结当前会话 / 开启新会话) are no longer
      // sent eagerly here. Instead, the streaming event handler appends
      // them to the final LLM response card so they appear at the bottom
      // of the conversation rather than above the LLM's follow-up text.

      return finalResult;
    },
  });
}
