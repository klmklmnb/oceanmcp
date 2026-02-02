import type { FlowNode as FlowNodeType } from "../types";

type FlowNodeProps = {
  node: FlowNodeType;
};

export function FlowNodeComponent({ node }: FlowNodeProps) {
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
      <div className="flow-node-function">{node.functionId}</div>
      
      {Object.keys(node.arguments).length > 0 && (
        <div style={{ 
          marginTop: "8px", 
          fontSize: "11px", 
          color: "#888",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.2)",
          padding: "6px 8px",
          borderRadius: "4px",
          wordBreak: "break-all"
        }}>
          {JSON.stringify(node.arguments)}
        </div>
      )}
      
      <div className="flow-node-status">
        <span 
          className={`status-indicator ${node.status}`}
          style={{ background: statusColors[node.status] }}
        />
        <span style={{ color: statusColors[node.status] }}>
          {statusLabels[node.status]}
        </span>
      </div>
      
      {node.result && (
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
