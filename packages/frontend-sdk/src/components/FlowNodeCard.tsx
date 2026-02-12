import React from "react";
import { FLOW_STEP_STATUS, TOOL_PART_STATE } from "@ocean-mcp/shared";

type FlowNodeCardProps = {
  steps: Array<{
    functionId: string;
    title: string;
    arguments: Record<string, any>;
  }>;
  result?: {
    totalSteps?: number;
    completedSteps?: number;
    results?: Array<{
      stepIndex: number;
      title: string;
      status:
        | typeof FLOW_STEP_STATUS.SUCCESS
        | typeof FLOW_STEP_STATUS.FAILED;
      result?: any;
      error?: string;
    }>;
  };
  state: string;
  /** Approval props — only needed when state === "approval-requested" */
  toolCallId?: string;
  toolName?: string;
  approvalId?: string;
  onApprove?: (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => void;
  onDeny?: (toolCallId: string, toolName: string, approvalId?: string) => void;
};

/** Inline flow node card — renders multi-step plan execution with status indicators */
export function FlowNodeCard({
  steps,
  result,
  state,
  toolCallId,
  toolName,
  approvalId,
  onApprove,
  onDeny,
}: FlowNodeCardProps) {
  const getStepStatus = (index: number) => {
    if (!result?.results) {
      // AI SDK v6 states: "approval-requested", "input-available", "output-available", etc.
      if (
        state === TOOL_PART_STATE.APPROVAL_REQUESTED ||
        state === TOOL_PART_STATE.CALL
      ) {
        return FLOW_STEP_STATUS.PENDING;
      }
      if (
        state === TOOL_PART_STATE.APPROVAL_RESPONDED ||
        state === TOOL_PART_STATE.INPUT_AVAILABLE
      ) {
        return FLOW_STEP_STATUS.RUNNING;
      }
      return FLOW_STEP_STATUS.PENDING;
    }
    const stepResult = result.results.find((r) => r.stepIndex === index);
    if (!stepResult) {
      if (
        state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
        state === TOOL_PART_STATE.RESULT
      ) {
        return FLOW_STEP_STATUS.PENDING;
      }
      return FLOW_STEP_STATUS.RUNNING;
    }
    return stepResult.status;
  };

  const statusConfig: Record<
    (typeof FLOW_STEP_STATUS)[keyof typeof FLOW_STEP_STATUS],
    { icon: string; color: string; bg: string }
  > = {
    [FLOW_STEP_STATUS.PENDING]: {
      icon: "○",
      color: "text-text-tertiary",
      bg: "bg-surface-tertiary",
    },
    [FLOW_STEP_STATUS.RUNNING]: {
      icon: "◌",
      color: "text-ocean-500",
      bg: "bg-ocean-50",
    },
    [FLOW_STEP_STATUS.SUCCESS]: {
      icon: "✓",
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    [FLOW_STEP_STATUS.FAILED]: {
      icon: "✕",
      color: "text-red-500",
      bg: "bg-red-50",
    },
  };

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-surface-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm">📋</span>
          <span className="text-sm font-semibold text-text-primary">
            Execution Plan
          </span>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-ocean-100 text-ocean-700 font-medium">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-border">
        {steps.map((step, i) => {
          const status = getStepStatus(i);
          const config =
            statusConfig[status] || statusConfig[FLOW_STEP_STATUS.PENDING];
          const stepResult = result?.results?.find((r) => r.stepIndex === i);

          return (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {/* Status icon */}
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full ${config.bg} flex items-center justify-center text-xs ${config.color} font-bold mt-0.5`}
                >
                  {status === FLOW_STEP_STATUS.RUNNING ? (
                    <span
                      className="inline-block w-3 h-3 border-2 border-ocean-500 border-t-transparent rounded-full"
                      style={{ animation: "ocean-spin 0.8s linear infinite" }}
                    />
                  ) : (
                    config.icon
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {step.title}
                  </p>
                  <div className="text-xs text-text-tertiary mt-0.5 font-mono">
                    <span>{step.functionId}(</span>
                    {Object.entries(step.arguments || {}).length > 0 && (
                      <div className="pl-4">
                        {Object.entries(step.arguments || {}).map(
                          ([key, value], idx, arr) => (
                            <div key={key}>
                              <span className="text-ocean-600">{key}</span>
                              <span className="text-text-quaternary">
                                {" = "}
                              </span>
                              <span className="text-text-secondary">
                                {typeof value === "string"
                                  ? `"${value}"`
                                  : JSON.stringify(value)}
                              </span>
                              {idx < arr.length - 1 && ","}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                    <span>)</span>
                  </div>

                  {/* Result */}
                  {stepResult?.status === FLOW_STEP_STATUS.SUCCESS &&
                    stepResult.result && (
                    <pre className="mt-2 text-xs bg-surface-tertiary rounded-lg p-2 overflow-x-auto text-text-secondary max-h-24 overflow-y-auto">
                      {typeof stepResult.result === "string"
                        ? stepResult.result
                        : JSON.stringify(stepResult.result, null, 2)}
                    </pre>
                    )}
                  {stepResult?.status === FLOW_STEP_STATUS.FAILED &&
                    stepResult.error && (
                    <p className="mt-1 text-xs text-red-500">
                      {stepResult.error}
                    </p>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Approval buttons — rendered inside the card */}
      {state === TOOL_PART_STATE.APPROVAL_REQUESTED &&
        toolCallId &&
        toolName &&
        onApprove &&
        onDeny && (
          <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
            <button
              onClick={() => onDeny(toolCallId, toolName, approvalId)}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors cursor-pointer"
            >
              Deny
            </button>
            <button
              onClick={() => onApprove(toolCallId, toolName, approvalId)}
              className="px-4 py-2 text-sm font-medium text-white bg-ocean-600 hover:bg-ocean-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              Allow
            </button>
          </div>
        )}
    </div>
  );
}
