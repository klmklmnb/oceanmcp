import type { FunctionDefinition, ReadOperation, FlowPlan } from "@hacker-agent/shared";

export type AgentContext = {
  sessionId: string;
  functions: FunctionDefinition[];
  sendExecuteRead: (requestId: string, reads: ReadOperation[]) => Promise<unknown[]>;
  sendProposeFlow: (plan: FlowPlan) => boolean;
  sendChatStream: (content: string, done: boolean) => boolean;
};

export type ReadToolInput = {
  reads: {
    functionId: string;
    arguments: Record<string, unknown>;
  }[];
};

export type PlanToolInput = {
  intent: string;
  steps: {
    functionId: string;
    arguments: Record<string, unknown>;
    title: string;
  }[];
};
