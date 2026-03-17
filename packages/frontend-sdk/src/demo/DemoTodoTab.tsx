import React, { useSyncExternalStore } from "react";
import { todoStore, type TodoItem } from "./demo-store";
import type { DemoStrings } from "./demo-i18n";

interface DemoTodoTabProps {
  strings: DemoStrings;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  medium: { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  low: { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
};

const STATUS_CONFIG: Record<string, { icon: string; color: string }> = {
  pending: { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", color: "#94a3b8" },
  "in-progress": { icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "#3b82f6" },
  done: { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "#22c55e" },
};

export function DemoTodoTab({ strings }: DemoTodoTabProps) {
  const items = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot);

  const pending = items.filter((t) => t.status === "pending");
  const inProgress = items.filter((t) => t.status === "in-progress");
  const done = items.filter((t) => t.status === "done");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%" }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
          {strings.todoTitle}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
          {strings.todoDescription}
        </p>
      </div>

      {/* Stats Row */}
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatBadge label={strings.todoPending} count={pending.length} color="#94a3b8" />
          <StatBadge label={strings.todoInProgress} count={inProgress.length} color="#3b82f6" />
          <StatBadge label={strings.todoDone} count={done.length} color="#22c55e" />
        </div>
      )}

      {/* TODO List */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              color: "#94a3b8",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span style={{ fontSize: 14 }}>{strings.todoEmpty}</span>
          </div>
        ) : (
          <>
            {/* Group by status */}
            {inProgress.length > 0 && (
              <TodoGroup label={strings.todoInProgress} items={inProgress} strings={strings} />
            )}
            {pending.length > 0 && (
              <TodoGroup label={strings.todoPending} items={pending} strings={strings} />
            )}
            {done.length > 0 && (
              <TodoGroup label={strings.todoDone} items={done} strings={strings} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 20,
        background: `${color}15`,
        border: `1px solid ${color}30`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{count}</span>
      <span style={{ fontSize: 11, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function TodoGroup({
  label,
  items,
  strings,
}: {
  label: string;
  items: TodoItem[];
  strings: DemoStrings;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label} ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => (
          <TodoCard key={item.id} item={item} strings={strings} />
        ))}
      </div>
    </div>
  );
}

function TodoCard({ item, strings }: { item: TodoItem; strings: DemoStrings }) {
  const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
  const priorityCfg = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.medium;
  const isDone = item.status === "done";
  const priorityLabel = item.priority === "high"
    ? strings.todoPriorityHigh
    : item.priority === "medium"
      ? strings.todoPriorityMedium
      : strings.todoPriorityLow;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        background: isDone ? "#f8fafc" : "#fff",
        border: "1px solid #e2e8f0",
        opacity: isDone ? 0.7 : 1,
        transition: "all 0.15s",
      }}
    >
      {/* Status icon */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={statusCfg.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <path d={statusCfg.icon} />
      </svg>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: isDone ? "#94a3b8" : "#1e293b",
              textDecoration: isDone ? "line-through" : "none",
            }}
          >
            {item.title}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 10,
              background: priorityCfg.bg,
              color: priorityCfg.text,
              border: `1px solid ${priorityCfg.border}`,
            }}
          >
            {priorityLabel}
          </span>
        </div>
        {item.description && (
          <p style={{ margin: 0, fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
            {item.description}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
          <span>{item.id}</span>
          {item.dueDate && <span>Due: {item.dueDate}</span>}
        </div>
      </div>
    </div>
  );
}
