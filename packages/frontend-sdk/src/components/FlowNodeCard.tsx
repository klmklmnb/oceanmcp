import React from "react";
import { FLOW_STEP_STATUS, TOOL_PART_STATE } from "@ocean-mcp/shared";
import type { ColumnConfig } from "@ocean-mcp/shared";
import { functionRegistry } from "../registry";
import { sdkConfig } from "../runtime/sdk-config";
import { t } from "../locale";
import { ArrayTable, RawDataBlock, tryParseArray, isObjectArray } from "./ArrayTable";

// ─── FlowNodeCard ───────────────────────────────────────────────────────────

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
      status: typeof FLOW_STEP_STATUS.SUCCESS | typeof FLOW_STEP_STATUS.FAILED;
      result?: any;
      error?: string;
    }>;
  };
  state: string;
  approval?: {
    approved?: boolean;
    reason?: string;
  };
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
  approval,
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
        state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
        approval?.approved === false
      ) {
        return FLOW_STEP_STATUS.FAILED;
      }
      if (
        (state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
          approval?.approved === true) ||
        state === TOOL_PART_STATE.INPUT_AVAILABLE
      ) {
        return FLOW_STEP_STATUS.RUNNING;
      }
      if (state === TOOL_PART_STATE.OUTPUT_DENIED) {
        return FLOW_STEP_STATUS.FAILED;
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
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm">📋</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
            {t("flow.title")}
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs px-2 py-0.5 rounded-full bg-ocean-100 text-ocean-700 font-medium">
            {t("flow.stepCount", { count: steps.length })}
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
                  className={`shrink-0 w-6 h-6 rounded-full ${config.bg} flex items-center justify-center text-xs ${config.color} font-bold mt-0.5`}
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
                    {typeof step.title === "string" ? step.title : JSON.stringify(step.title)}
                  </p>
                  {(() => {
                    const fnDef = functionRegistry.get(step.functionId);
                    if (fnDef?.showRender) {
                      try {
                        const rendered = fnDef.showRender({
                          id: step.functionId,
                          functionId: step.functionId,
                          title: step.title,
                          arguments: step.arguments || {},
                          status: status as any,
                        });
                        if (React.isValidElement(rendered)) return rendered;
                        return null;
                      } catch {
                        return null;
                      }
                    }

                    // Build maps from param definitions for display overrides
                    const showNameMap = new Map<string, string>();
                    const enumMaps = new Map<string, Record<string, any>>();
                    const columnsMap = new Map<string, Record<string, ColumnConfig>>();
                    if (fnDef?.parameters) {
                      for (const p of fnDef.parameters) {
                        if (sdkConfig.locale === "zh-CN" && p.showName) {
                          showNameMap.set(p.name, p.showName);
                        }
                        if (p.enumMap) enumMaps.set(p.name, p.enumMap);
                        if (p.columns) columnsMap.set(p.name, p.columns);
                      }
                    }

                    const renderValue = (key: string, value: any): React.ReactNode => {
                      const em = enumMaps.get(key);
                      if (em && typeof value === "string" && value in em) {
                        const mapped = em[value];
                        if (React.isValidElement(mapped)) return mapped;
                        return typeof mapped === "string" ? mapped : String(mapped);
                      }

                      // columns-driven: only parse as table when param has columns config
                      if (columnsMap.has(key)) return null;

                      return typeof value === "string"
                        ? `"${value}"`
                        : JSON.stringify(value);
                    };

                    const renderArrayBlock = (key: string, value: any): React.ReactNode | null => {
                      const colConfig = columnsMap.get(key);
                      if (!colConfig) return null;
                      const arr = tryParseArray(value);
                      if (!arr || !isObjectArray(arr)) return null;
                      return (
                        <div key={`${key}-table`} className="mt-0.5">
                          <span className="text-ocean-600">{showNameMap.get(key) ?? key}</span>
                          <span className="text-text-quaternary ml-1">
                            {t("flow.itemCount", { count: arr.length })}
                          </span>
                          <ArrayTable data={arr} columns={colConfig} />
                        </div>
                      );
                    };

                    const fnLabel = fnDef
                      ? sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName)
                      : step.functionId;

                    const entries = Object.entries(step.arguments || {});
                    const inlineEntries = entries.filter(([key]) => !columnsMap.has(key));
                    const arrayEntries = entries.filter(([key]) => columnsMap.has(key));

                    const rawArgs = step.arguments && Object.keys(step.arguments).length > 0
                      ? JSON.stringify(step.arguments, null, 2)
                      : null;

                    return (
                      <div className="text-xs text-text-tertiary mt-0.5 font-mono">
                        <span>{fnLabel}</span>
                        {inlineEntries.length > 0 && (
                          <>
                            <span>(</span>
                            <div className="pl-4 overflow-x-auto">
                              {inlineEntries.map(
                                ([key, value], idx, arr) => (
                                  <div key={key}>
                                    <span className="text-ocean-600">
                                      {showNameMap.get(key) ?? key}
                                    </span>
                                    <span className="text-text-quaternary">
                                      {" = "}
                                    </span>
                                    <span className="text-text-secondary">
                                      {renderValue(key, value)}
                                    </span>
                                    {idx < arr.length - 1 && ","}
                                  </div>
                                ),
                              )}
                            </div>
                            <span>)</span>
                          </>
                        )}
                        {arrayEntries.map(([key, value]) => renderArrayBlock(key, value))}
                        {rawArgs && <RawDataBlock data={rawArgs} />}
                      </div>
                    );
                  })()}

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
                        {typeof stepResult.error === "string" ? stepResult.error : JSON.stringify(stepResult.error)}
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
              {t("flow.deny")}
            </button>
            <button
              onClick={() => onApprove(toolCallId, toolName, approvalId)}
              className="px-4 py-2 text-sm font-medium text-white bg-ocean-600 hover:bg-ocean-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              {t("flow.approve")}
            </button>
          </div>
        )}
    </div>
  );
}
