import React, { useState } from "react";
import type { ColumnConfig } from "@ocean-mcp/shared";
import { t } from "../locale";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function tryParseArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value.length > 0 ? value : null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* not JSON */ }
  }
  return null;
}

export function isObjectArray(arr: any[]): arr is Record<string, any>[] {
  return arr.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
}

// ─── ArrayTable ─────────────────────────────────────────────────────────────

const MAX_COLLAPSED_ROWS = 5;

export function ArrayTable({ data, columns: colConfig }: { data: Record<string, any>[]; columns?: Record<string, ColumnConfig> }) {
  const [expanded, setExpanded] = useState(false);

  const visibleCols = colConfig
    ? Object.keys(colConfig)
    : (() => {
        const keySet = new Set<string>();
        for (const row of data) {
          for (const k of Object.keys(row)) keySet.add(k);
        }
        return [...keySet];
      })();

  if (visibleCols.length === 0) return null;

  const visibleRows = expanded ? data : data.slice(0, MAX_COLLAPSED_ROWS);
  const hiddenCount = data.length - MAX_COLLAPSED_ROWS;

  const defaultRenderCell = (value: unknown): React.ReactNode => {
    if (value == null) return <span className="text-text-quaternary">-</span>;
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      return value.length > 40 ? (
        <span title={value}>{value.slice(0, 37)}...</span>
      ) : value;
    }
    const json = JSON.stringify(value);
    return (
      <span className="text-text-quaternary" title={json}>
        {json.length > 30 ? json.slice(0, 27) + "..." : json}
      </span>
    );
  };

  return (
    <div className="mt-1 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs text-text-secondary">
        <thead>
          <tr className="bg-surface-tertiary">
            {visibleCols.map((col) => {
              const cfg = colConfig?.[col];
              return (
                <th
                  key={col}
                  className="px-2 py-1.5 text-left font-semibold text-text-tertiary whitespace-nowrap border-b border-border"
                  title={cfg?.label ? col : undefined}
                >
                  {cfg?.label ?? col}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "" : "bg-surface-tertiary/50"}>
              {visibleCols.map((col) => {
                const cfg = colConfig?.[col];
                const cellContent = cfg?.render
                  ? cfg.render(row[col], row)
                  : defaultRenderCell(row[col]);
                return (
                  <td
                    key={col}
                    className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate border-b border-border/50"
                  >
                    {cellContent}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > MAX_COLLAPSED_ROWS && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full py-1.5 text-xs text-ocean-600 hover:text-ocean-700 hover:bg-surface-tertiary transition-colors cursor-pointer"
        >
          {expanded
            ? t("flow.collapse")
            : t("flow.showMore", { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}

// ─── RawDataBlock (collapsible JSON for debugging) ──────────────────────────

export function RawDataBlock({ data }: { data: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 font-sans">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-text-quaternary hover:text-text-tertiary transition-colors cursor-pointer flex items-center gap-1"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        {t("flow.rawData")}
      </button>
      {open && (
        <pre className="mt-1 text-xs bg-surface-tertiary rounded-lg p-2 overflow-x-auto text-text-secondary max-h-40 overflow-y-auto">
          {data}
        </pre>
      )}
    </div>
  );
}
