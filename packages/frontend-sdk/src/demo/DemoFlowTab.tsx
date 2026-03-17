import React, { useSyncExternalStore, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeChange,
  type EdgeChange,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowStore } from "./demo-store";
import type { DemoStrings } from "./demo-i18n";

interface DemoFlowTabProps {
  strings: DemoStrings;
}

function FlowCanvas() {
  const state = useSyncExternalStore(flowStore.subscribe, flowStore.getSnapshot);
  const { fitView } = useReactFlow();
  const prevNodeCountRef = useRef(state.nodes.length);

  // Auto-fit the viewport whenever nodes are added or removed
  useEffect(() => {
    if (state.nodes.length !== prevNodeCountRef.current) {
      prevNodeCountRef.current = state.nodes.length;
      // Short delay so React Flow finishes laying out the new node first
      const timer = setTimeout(() => {
        fitView({ padding: 0.3, duration: 300 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [state.nodes.length, fitView]);

  // Map our store nodes/edges to xyflow format
  const nodes: Node[] = useMemo(
    () =>
      state.nodes.map((n) => ({
        id: n.id,
        type: n.type || "default",
        position: n.position,
        data: n.data,
        style: n.style as Record<string, any> | undefined,
      })),
    [state.nodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.animated,
        type: e.type || "smoothstep",
      })),
    [state.edges],
  );

  // Handle drag-to-move from xyflow back to our store
  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        flowStore.updateNode(change.id, { position: change.position });
      }
    }
  }, []);

  const onEdgesChange: OnEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // Edge changes from xyflow UI (selection, etc.) — no-op for now
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      style={{ background: "#fafbfc" }}
    >
      <Background color="#e2e8f0" gap={20} size={1} />
      <Controls
        showZoom
        showFitView
        showInteractive={false}
        style={{ borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
      />
      <MiniMap
        nodeColor={(n) => {
          if (n.type === "input") return "#22c55e";
          if (n.type === "output") return "#ef4444";
          return "#3b82f6";
        }}
        style={{
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          background: "#fff",
        }}
      />
    </ReactFlow>
  );
}

export function DemoFlowTab({ strings }: DemoFlowTabProps) {
  const state = useSyncExternalStore(flowStore.subscribe, flowStore.getSnapshot);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
          {strings.flowTitle}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
          {strings.flowDescription}
        </p>
      </div>

      {/* Stats */}
      {(state.nodes.length > 0 || state.edges.length > 0) && (
        <div style={{ display: "flex", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 20,
              background: "#3b82f615",
              border: "1px solid #3b82f630",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{state.nodes.length}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>Nodes</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 20,
              background: "#8b5cf615",
              border: "1px solid #8b5cf630",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "#8b5cf6" }}>{state.edges.length}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>Edges</span>
          </div>
        </div>
      )}

      {/* Flow Canvas */}
      <div
        style={{
          flex: 1,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          minHeight: 300,
        }}
      >
        {state.nodes.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              color: "#94a3b8",
              background: "#fafbfc",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
            </svg>
            <span style={{ fontSize: 14 }}>{strings.flowEmpty}</span>
          </div>
        ) : (
          <ReactFlowProvider>
            <FlowCanvas />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
