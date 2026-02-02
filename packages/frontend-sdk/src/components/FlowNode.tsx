import type { FlowNode as FlowNodeType } from "../types";
import { getRegistry } from "../registry";

type FlowNodeProps = {
  node: FlowNodeType;
};

/**
 * Format argument value for display
 */
function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Format function call with actual argument values
 * e.g., "getClusterDetails(clusterId: "cluster-1")"
 */
function formatFunctionCall(
  functionId: string,
  params: { name: string; type: string; description?: string; required: boolean }[],
  args: Record<string, unknown>
): string {
  if (params.length === 0 && Object.keys(args).length === 0) {
    return `${functionId}()`;
  }
  
  // Use params order if available, otherwise fall back to args keys
  const paramNames = params.length > 0 
    ? params.map((p) => p.name) 
    : Object.keys(args);
  
  const paramStr = paramNames
    .map((name) => `${name}: ${formatValue(args[name])}`)
    .join(", ");
  
  return `${functionId}(${paramStr})`;
}

export function FlowNodeComponent({ node }: FlowNodeProps) {
  const registry = getRegistry();
  const funcDef = registry.find((f) => f.id === node.functionId);
  const params = funcDef?.parameters ?? [];

  const statusLabels = {
    pending: "Pending",
    running: "Running...",
    success: "Completed",
    failed: "Failed",
  };

  const statusColors = {
    pending: "#666",
    running: "#3b82f6",
    success: "#22c55e",
    failed: "#ef4444",
  };

  return (
    <div className={`flow-node ${node.status}`}>
      <div className="flow-node-title">{node.title}</div>
      <div className="flow-node-function" style={{ wordBreak: "break-all" }}>
        {formatFunctionCall(node.functionId, params, node.arguments)}
      </div>
      
      <div className="flow-node-status">
        <span 
          className={`status-indicator ${node.status}`}
          style={{ background: statusColors[node.status] }}
        />
        <span style={{ color: statusColors[node.status] }}>
          {statusLabels[node.status]}
        </span>
      </div>
      
      {node.result !== undefined && node.result !== null && (
        <div style={{
          marginTop: "8px",
          fontSize: "11px",
          color: "#22c55e",
          fontFamily: "monospace",
          background: "rgba(34, 197, 94, 0.1)",
          padding: "6px 8px",
          borderRadius: "4px",
          maxHeight: "60px",
          overflow: "auto"
        }}>
          {typeof node.result === "string" 
            ? node.result 
            : JSON.stringify(node.result, null, 2)}
        </div>
      )}
      
      {node.error && (
        <div style={{
          marginTop: "8px",
          fontSize: "11px",
          color: "#ef4444",
          fontFamily: "monospace",
          background: "rgba(239, 68, 68, 0.1)",
          padding: "6px 8px",
          borderRadius: "4px"
        }}>
          {node.error}
        </div>
      )}
    </div>
  );
}
