import React from "react";

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
      status: "success" | "failed";
      result?: any;
      error?: string;
    }>;
  };
  state: string;
};

/** Inline flow node card — renders multi-step plan execution with status indicators */
export function FlowNodeCard({ steps, result, state }: FlowNodeCardProps) {
  const getStepStatus = (index: number) => {
    if (!result?.results) {
      if (state === "call") return "pending";
      return "pending";
    }
    const stepResult = result.results.find((r) => r.stepIndex === index);
    if (!stepResult) {
      if (state === "result") return "pending";
      return "running";
    }
    return stepResult.status;
  };

  const statusConfig: Record<
    string,
    { icon: string; color: string; bg: string }
  > = {
    pending: {
      icon: "○",
      color: "text-text-tertiary",
      bg: "bg-surface-tertiary",
    },
    running: { icon: "◌", color: "text-ocean-500", bg: "bg-ocean-50" },
    success: { icon: "✓", color: "text-emerald-600", bg: "bg-emerald-50" },
    failed: { icon: "✕", color: "text-red-500", bg: "bg-red-50" },
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
          const config = statusConfig[status] || statusConfig.pending;
          const stepResult = result?.results?.find((r) => r.stepIndex === i);

          return (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {/* Status icon */}
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full ${config.bg} flex items-center justify-center text-xs ${config.color} font-bold mt-0.5`}
                >
                  {status === "running" ? (
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
                  <p className="text-xs text-text-tertiary mt-0.5 font-mono">
                    {step.functionId}(
                    {Object.keys(step.arguments || {}).join(", ")})
                  </p>

                  {/* Result */}
                  {stepResult?.status === "success" && stepResult.result && (
                    <pre className="mt-2 text-xs bg-surface-tertiary rounded-lg p-2 overflow-x-auto text-text-secondary max-h-24 overflow-y-auto">
                      {typeof stepResult.result === "string"
                        ? stepResult.result
                        : JSON.stringify(stepResult.result, null, 2)}
                    </pre>
                  )}
                  {stepResult?.status === "failed" && stepResult.error && (
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
    </div>
  );
}
