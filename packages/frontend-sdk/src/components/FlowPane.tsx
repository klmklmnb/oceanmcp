import type { FlowPlan } from "../types";
import { FlowNodeComponent } from "./FlowNode";

type FlowPaneProps = {
  plan: FlowPlan | null;
  isRunning: boolean;
  onRunFlow: () => void;
  onCancelFlow: () => void;
};

export function FlowPane({ plan, isRunning, onRunFlow, onCancelFlow }: FlowPaneProps) {
  const hasCompletedNodes = plan?.nodes.some(
    (n) => n.status === "success" || n.status === "failed"
  );
  const allCompleted = plan?.nodes.every(
    (n) => n.status === "success" || n.status === "failed"
  );

  return (
    <div className="hacker-agent-flow-pane">
      {plan ? (
        <>
          <div className="flow-header">
            <div className="flow-title">Execution Plan</div>
            <div className="flow-intent">{plan.intent}</div>
          </div>

          <div className="flow-nodes">
            {plan.nodes.map((node) => (
              <FlowNodeComponent key={node.id} node={node} />
            ))}
          </div>

          <div className="flow-actions">
            {!isRunning && !allCompleted && (
              <>
                <button
                  className="flow-action-button primary"
                  onClick={onRunFlow}
                  disabled={hasCompletedNodes}
                >
                  Run Flow
                </button>
                <button
                  className="flow-action-button secondary"
                  onClick={onCancelFlow}
                >
                  Cancel
                </button>
              </>
            )}
            
            {isRunning && (
              <button
                className="flow-action-button secondary"
                disabled
              >
                Running...
              </button>
            )}
            
            {allCompleted && (
              <button
                className="flow-action-button secondary"
                onClick={onCancelFlow}
              >
                Clear
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="flow-empty">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>📋</div>
            <div>Waiting for plan...</div>
            <div style={{ fontSize: "12px", marginTop: "4px", color: "#555" }}>
              Plans will appear here when the agent proposes actions
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
