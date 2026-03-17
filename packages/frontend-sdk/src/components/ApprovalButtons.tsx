import React from "react";
import { t } from "../locale";

type ApprovalButtonsProps = {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  approvalId?: string;
  onApprove: (toolCallId: string, toolName: string, approvalId?: string) => void;
  onDeny: (toolCallId: string, toolName: string, approvalId?: string) => void;
};

/** Approve/Deny buttons for tool approval flow — mirrors the reference UI pattern */
export function ApprovalButtons({
  toolCallId,
  toolName,
  args,
  approvalId,
  onApprove,
  onDeny,
}: ApprovalButtonsProps) {
  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
        <span className="text-sm">🔧</span>
        <span className="text-sm font-semibold text-text-primary">
          {toolName}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-600">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {t("approval.status")}
        </span>
      </div>

      {/* Parameters */}
      <div className="p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {t("approval.parameters")}
        </p>
        <pre className="text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-40 overflow-y-auto">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>

      {/* Buttons */}
      <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
        <button
          onClick={() => onDeny(toolCallId, toolName, approvalId)}
          className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors cursor-pointer"
        >
          {t("approval.deny")}
        </button>
        <button
          onClick={() => onApprove(toolCallId, toolName, approvalId)}
          className="px-4 py-2 text-sm font-medium text-white bg-ocean-600 hover:bg-ocean-700 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          {t("approval.allow")}
        </button>
      </div>
    </div>
  );
}
