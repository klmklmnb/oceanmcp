import React, { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import {
  MESSAGE_PART_STATE,
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
  OPERATION_TYPE,
  type FileAttachment,
} from "@ocean-mcp/shared";
import { FlowNodeCard, CollapsibleError } from "./FlowNodeCard";
import { ApprovalButtons } from "./ApprovalButtons";
import { AskUserCard } from "./AskUserCard";
import { SubagentCard } from "./SubagentCard";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { functionRegistry, skillRegistry } from "../registry";
import { isDOMRenderDescriptor, DOMContainer } from "./DOMContainer";
import { sdkConfig } from "../runtime/sdk-config";
import { captureException } from "../runtime/sentry";
import { t } from "../locale";

function getPartToolName(partData: any): string | undefined {
  if (
    typeof partData?.type === "string" &&
    partData.type.startsWith(TOOL_PART_TYPE_PREFIX)
  ) {
    return partData.type.slice(TOOL_PART_TYPE_PREFIX.length);
  }

  return partData?.toolName;
}

function getPartMetadata(partData: any) {
  return {
    partType: typeof partData?.type === "string" ? partData.type : "unknown",
    partState: typeof partData?.state === "string" ? partData.state : undefined,
    toolName: getPartToolName(partData),
    hasApprovalId: Boolean(partData?.approval?.id),
  };
}

class PartErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    partIndex: number;
    partData?: any;
    messageRole: string;
  },
  { hasError: boolean; error?: Error }
> {
  constructor(props: {
    children: React.ReactNode;
    partIndex: number;
    partData?: any;
    messageRole: string;
  }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const metadata = getPartMetadata(this.props.partData);
    captureException(error, {
      tags: {
        component: "MessageRenderer",
        stage: "part_error_boundary",
        message_role: this.props.messageRole,
        part_type: metadata.partType,
        tool_name: metadata.toolName,
      },
      extras: {
        partIndex: this.props.partIndex,
        partState: metadata.partState,
        hasApprovalId: metadata.hasApprovalId,
        componentStack: info.componentStack,
      },
    });
    console.error(
      `[OceanMCP] Render error in message part ${this.props.partIndex}:`,
      "\n  Error:", error.message,
      "\n  Component Stack:", info.componentStack,
      "\n  Part type:", metadata.partType,
      "\n  Part state:", metadata.partState,
      "\n  Tool name:", metadata.toolName,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="my-1 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-500">
          {t("tool.renderError")} {this.state.error?.message ?? "Unknown error"}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── ToolCallCard (collapsible tool execution card) ─────────────────────────

type ToolCallCardProps = {
  toolCallId: string;
  toolName: string;
  displayName: string;
  state: string;
  input?: any;
  output?: any;
  errorText?: string;
  fnDef?: ReturnType<typeof functionRegistry.get>;
  fnArgs: Record<string, any>;
  approval?: { approved?: boolean; reason?: string };
  approvalId?: string;
  onApprove?: (toolCallId: string, toolName: string, approvalId?: string) => void;
  onDeny?: (toolCallId: string, toolName: string, approvalId?: string) => void;
};

type ToolInlineStatus = "running" | "complete" | "error" | "denied";

function resolveInlineStatus(
  state: string,
  isOutputError: boolean,
  approval?: { approved?: boolean; reason?: string },
): ToolInlineStatus {
  if (state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError) {
    return "error";
  }

  if (
    state === TOOL_PART_STATE.OUTPUT_DENIED ||
    (state === TOOL_PART_STATE.APPROVAL_RESPONDED && approval?.approved === false)
  ) {
    return "denied";
  }

  if (state === TOOL_PART_STATE.OUTPUT_AVAILABLE) {
    return "complete";
  }

  return "running";
}

function getInlineStatusText(status: ToolInlineStatus, displayName: string): string {
  return t(`tool.inline.${status}`, { name: displayName });
}

function getInlineErrorDetail(state: string, errorText: unknown, output: unknown): string | null {
  const rawError =
    state === TOOL_PART_STATE.OUTPUT_ERROR
      ? errorText
      : output != null && typeof output === "object" && typeof (output as any).error === "string"
        ? (output as any).error
        : null;

  if (rawError == null) return null;

  const text = typeof rawError === "string" ? rawError : JSON.stringify(rawError);
  if (!text) return null;
  return text;
}

function ToolCallInlineStatus({
  displayName,
  state,
  output,
  errorText,
  approval,
  streamingActive,
}: {
  displayName: string;
  state: string;
  output?: any;
  errorText?: any;
  approval?: { approved?: boolean; reason?: string };
  streamingActive?: boolean;
}) {
  const isOutputError =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
    output != null &&
    typeof output === "object" &&
    typeof output.error === "string";
  const status = resolveInlineStatus(state, isOutputError, approval);
  const statusClassName =
    status === "error"
      ? "text-red-500"
      : status === "denied"
        ? "text-text-secondary"
        : status === "complete"
          ? "text-text-secondary"
          : "text-text-secondary";
  const inlineErrorDetail =
    status === "error" ? getInlineErrorDetail(state, errorText, output) : null;
  const shouldAnimateRunning = status === "running" && streamingActive;

  return (
    <div className="my-1.5 px-0.5">
      <p
        className={`text-[13px] leading-5 font-semibold ${statusClassName} ${
          shouldAnimateRunning ? "ocean-tool-inline-text-shimmer" : ""
        }`}
      >
        {getInlineStatusText(status, displayName)}
      </p>
      {inlineErrorDetail && (
        <p
          className="mt-0.5 block max-w-full truncate text-xs leading-5 text-red-500/90"
          title={inlineErrorDetail}
        >
          {inlineErrorDetail}
        </p>
      )}
    </div>
  );
}

function ToolCallCard({
  toolCallId,
  toolName,
  displayName,
  state,
  input,
  output,
  errorText,
  fnDef,
  fnArgs,
  approval,
  approvalId,
  onApprove,
  onDeny,
}: ToolCallCardProps) {
  const isReadOp = fnDef?.operationType === OPERATION_TYPE.READ;
  const isLoadSkill = toolName === "loadSkill";
  const hasCustomRender = !!fnDef?.showRender;
  const [expanded, setExpanded] = useState(hasCustomRender || (!isReadOp && !isLoadSkill));

  // Detect error embedded in a successful tool result (e.g. retry logic
  // returns { error: "...", _retryHint: "..." } as output instead of throwing).
  const isOutputError =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
    output != null &&
    typeof output === "object" &&
    typeof output.error === "string";

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 border-b border-border bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-text-tertiary">{expanded ? "▼" : "▶"}</span>
            <span className="text-sm">🔧</span>
          </div>
          <span
            className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary"
            title={displayName}
          >
            {displayName}
          </span>
          {state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !isOutputError && (
            <span className="ml-auto flex whitespace-nowrap items-center gap-1.5 text-xs text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {t("tool.status.complete")}
            </span>
          )}
          {(state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError) && (
            <span className="ml-auto flex whitespace-nowrap items-center gap-1.5 text-xs text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {t("tool.status.error")}
            </span>
          )}
          {(state === TOOL_PART_STATE.OUTPUT_DENIED ||
            (state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
              approval?.approved === false)) && (
            <span className="ml-auto flex whitespace-nowrap items-center gap-1.5 text-xs text-text-tertiary">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
              {t("tool.status.denied")}
            </span>
          )}
          {(state === TOOL_PART_STATE.INPUT_AVAILABLE ||
            (state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
              approval?.approved !== false)) && (
            <span className="ml-auto flex whitespace-nowrap items-center gap-1.5 text-xs text-ocean-500">
              <span
                className="inline-block w-3 h-3 border-2 border-ocean-500 border-t-transparent rounded-full"
                style={{ animation: "ocean-spin 0.8s linear infinite" }}
              />
              {t("tool.status.running")}
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <>
          {hasCustomRender ? (
            <div className="px-4 py-3">
              {(() => {
                const rendered = fnDef!.showRender!({
                  id: fnDef!.id,
                  functionId: fnDef!.id,
                  title: displayName,
                  arguments: fnArgs,
                  status: (state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !isOutputError)
                    ? ("success" as any)
                    : (state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError)
                      ? ("failed" as any)
                      : ("running" as any),
                });
                if (isDOMRenderDescriptor(rendered)) {
                  return <DOMContainer descriptor={rendered} />;
                }
                return rendered;
              })()}
              {state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
                !isOutputError &&
                output !== undefined && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-text-tertiary mb-1.5">{t("tool.label.result")}</p>
                  <pre className="text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-32 overflow-y-auto">
                    {typeof output === "string"
                      ? output
                      : JSON.stringify(output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <>
              {input !== undefined &&
                Object.keys(input).length > 0 && (
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs font-medium text-text-tertiary mb-1.5">{t("tool.label.parameters")}</p>
                  <pre className="text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-32 overflow-y-auto">
                    {toolName === "browserExecute"
                      ? JSON.stringify(input.arguments ?? {}, null, 2)
                      : JSON.stringify(input, null, 2)}
                  </pre>
                </div>
                )}
              {state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
                !isOutputError &&
                output !== undefined && (
                <div className="px-4 pt-2 pb-3">
                  <p className="text-xs font-medium text-text-tertiary mb-1.5">{t("tool.label.result")}</p>
                  <pre className="text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-32 overflow-y-auto">
                    {typeof output === "string"
                      ? output
                      : JSON.stringify(output, null, 2)}
                  </pre>
                </div>
                )}
            </>
          )}
          {(state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError) && (
            <div className="p-4">
              <p className="text-xs text-red-500">
                {isOutputError
                  ? output.error
                  : typeof errorText === "string" ? errorText : JSON.stringify(errorText)}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getSkillLabel(skillName?: string): string {
  if (!skillName) {
    return sdkConfig.locale === "zh-CN" ? "未知技能" : "Unknown skill";
  }

  const skill = skillRegistry.get(skillName);
  return skill
    ? sdkConfig.resolveDisplayName(skill.name, skill.cnName)
    : skillName;
}

function getLoadSkillDisplayName(skillName?: string): string {
  const skillLabel = getSkillLabel(skillName);
  return sdkConfig.locale === "zh-CN"
    ? `技能装填：${skillLabel}`
    : `Load Skill: ${skillLabel}`;
}

function stringifyToolData(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function isLoadSkillPart(part: any): boolean {
  return isToolPart(part) && getToolName(part) === "loadSkill";
}

function LoadSkillItemCard({ part }: { part: any }) {
  const [expanded, setExpanded] = useState(false);
  const itemState = part.state === TOOL_PART_STATE.OUTPUT_ERROR
    ? { text: t("tool.status.error"), className: "text-red-500" }
    : part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE
      ? { text: t("tool.status.complete"), className: "text-emerald-600" }
      : { text: t("tool.status.running"), className: "text-ocean-500" };
  const hasInput = part.input !== undefined && Object.keys(part.input || {}).length > 0;
  const hasOutput = part.output !== undefined;
  const hasError = Boolean(part.errorText);

  return (
    <div className="rounded-lg border border-border/60 bg-surface-tertiary overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full px-3 py-2.5 text-left hover:bg-surface transition-colors cursor-pointer"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-xs text-text-tertiary">{expanded ? "▼" : "▶"}</span>
          <span
            className="min-w-0 flex-1 truncate text-sm text-text-primary"
            title={getSkillLabel(part.input?.name)}
          >
            {getSkillLabel(part.input?.name)}
          </span>
          <span className={`ml-auto shrink-0 whitespace-nowrap text-xs ${itemState.className}`}>
            {itemState.text}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          {hasInput && (
            <div>
              <p className="text-xs font-medium text-text-tertiary mb-1.5">
                {t("tool.label.parameters")}
              </p>
              <pre className="text-xs bg-surface rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-40 overflow-y-auto">
                {stringifyToolData(part.input)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <p className="text-xs font-medium text-text-tertiary mb-1.5">
                {t("tool.label.result")}
              </p>
              <pre className="text-xs bg-surface rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-40 overflow-y-auto">
                {stringifyToolData(part.output)}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <p className="text-xs font-medium text-red-500 mb-1.5">
                {t("tool.status.error")}
              </p>
              <pre className="text-xs bg-red-50 rounded-lg p-3 overflow-x-auto text-red-600 font-mono max-h-40 overflow-y-auto">
                {stringifyToolData(part.errorText)}
              </pre>
            </div>
          )}
          {!hasInput && !hasOutput && !hasError && (
            <p className="text-xs text-text-tertiary">
              {sdkConfig.locale === "zh-CN" ? "暂无详情" : "No details yet"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LoadSkillGroupCard({ parts }: { parts: any[] }) {
  const [expanded, setExpanded] = useState(false);

  const summaryState = parts.some((part) => part.state === TOOL_PART_STATE.OUTPUT_ERROR)
    ? TOOL_PART_STATE.OUTPUT_ERROR
    : parts.every((part) => part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE)
      ? TOOL_PART_STATE.OUTPUT_AVAILABLE
      : TOOL_PART_STATE.INPUT_AVAILABLE;

  const title = sdkConfig.locale === "zh-CN" ? "技能装填" : "Load Skills";
  const countLabel = sdkConfig.locale === "zh-CN"
    ? `${parts.length} 项`
    : `${parts.length} skills`;

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full px-4 py-3 bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-text-tertiary">{expanded ? "▼" : "▶"}</span>
            <span className="text-sm">🔧</span>
          </div>
          <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
            <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
              {title}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-text-tertiary">({countLabel})</span>
          </div>
          {summaryState === TOOL_PART_STATE.OUTPUT_AVAILABLE && (
            <span className="ml-auto flex shrink-0 whitespace-nowrap items-center gap-1.5 text-xs text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {t("tool.status.complete")}
            </span>
          )}
          {summaryState === TOOL_PART_STATE.OUTPUT_ERROR && (
            <span className="ml-auto flex shrink-0 whitespace-nowrap items-center gap-1.5 text-xs text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {t("tool.status.error")}
            </span>
          )}
          {summaryState === TOOL_PART_STATE.INPUT_AVAILABLE && (
            <span className="ml-auto flex shrink-0 whitespace-nowrap items-center gap-1.5 text-xs text-ocean-500">
              <span
                className="inline-block w-3 h-3 border-2 border-ocean-500 border-t-transparent rounded-full"
                style={{ animation: "ocean-spin 0.8s linear infinite" }}
              />
              {t("tool.status.running")}
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-4 py-3">
          <div className="flex flex-col gap-2">
            {parts.map((part, index) => (
              <LoadSkillItemCard
                key={part.toolCallId || `load-skill-${index}`}
                part={part}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type MessageRendererProps = {
  message: UIMessage;
  onApprove: (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => void;
  onDeny: (toolCallId: string, toolName: string, approvalId?: string) => void;
  onUserSelect: (toolCallId: string, output: Record<string, any>) => void;
  onDenySelect: (toolCallId: string) => void;
  avatar?: string;
  showTrailingIndicator?: boolean;
  streamingActive?: boolean;
};

/** Typing indicator */
function TypingIndicator() {
  return (
    <div className="flex gap-1.5 py-2 px-1">
      <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
      <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
      <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
    </div>
  );
}

/** Copy button for messages */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-text-tertiary hover:text-text-secondary transition-colors rounded-md hover:bg-surface-tertiary cursor-pointer"
      title={t("copy.title")}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

import { MessageReasoning } from "./MessageReasoning";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (isImage) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    );
  }

  if (isPdf) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    );
  }

  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

function FileAttachmentCard({ file }: { file: FileAttachment }) {
  const isImage = file.mimeType.startsWith("image/");

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
    >
      {isImage ? (
        <img
          src={file.url}
          alt={file.name}
          className="w-9 h-9 rounded-md object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-md bg-white/15 flex items-center justify-center shrink-0 text-white/80">
          <FileIcon mimeType={file.mimeType} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate">{file.name}</p>
        <p className="text-xs text-white/60">
          {formatFileSize(file.size)}
        </p>
      </div>
    </a>
  );
}

function FileAttachmentGroup({ files }: { files: FileAttachment[] }) {
  return (
    <div className="inline-flex flex-col gap-1 px-3 py-2.5 rounded-2xl bg-ocean-600 max-w-xs">
      {files.map((file, i) => (
        <FileAttachmentCard key={`${file.url}-${i}`} file={file} />
      ))}
    </div>
  );
}

/**
 * Helper: Check if a part is a tool part (AI SDK v6 uses `tool-${toolName}` pattern)
 */
function isToolPart(part: any): boolean {
  return (
    typeof part.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

/**
 * Helper: Extract tool name from part type (e.g. "tool-executePlan" → "executePlan")
 */
function getToolName(part: any): string {
  if (
    typeof part.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  ) {
    return part.type.slice(TOOL_PART_TYPE_PREFIX.length);
  }
  return part.toolName || "unknown";
}

function isToolMetaPart(part: any): boolean {
  if (!isToolPart(part)) return false;
  const toolName = getToolName(part);
  if (toolName === "executePlan" || toolName === "userSelect" || toolName === "askUser" || toolName === "subagent") return false;
  if (part.state === TOOL_PART_STATE.APPROVAL_REQUESTED) return false;
  return true;
}

function isToolMetaSettled(part: any): boolean {
  const state = part?.state;
  if (
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
    state === TOOL_PART_STATE.OUTPUT_ERROR ||
    state === TOOL_PART_STATE.OUTPUT_DENIED
  ) {
    return true;
  }

  if (state === TOOL_PART_STATE.APPROVAL_RESPONDED && part?.approval?.approved === false) {
    return true;
  }

  return false;
}

function isToolMetaError(part: any): boolean {
  const state = part?.state;
  if (state === TOOL_PART_STATE.OUTPUT_ERROR) {
    return true;
  }

  if (
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
    part?.output != null &&
    typeof part.output === "object" &&
    typeof part.output.error === "string"
  ) {
    return true;
  }

  return false;
}

function getToolDisplayNameFromPart(part: any): string {
  const toolName = getToolName(part);
  const input = part?.input;

  if (toolName === "browserExecute" && input?.functionId) {
    const fnDef = functionRegistry.get(input.functionId);
    return fnDef
      ? sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName)
      : input.functionId;
  }

  if (toolName === "loadSkill") {
    return getSkillLabel(input?.name);
  }

  const fnDef = functionRegistry.get(toolName);
  if (fnDef) {
    return sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName) || toolName;
  }

  return toolName;
}

function getToolRenderContext(part: any): {
  toolName: string;
  displayName: string;
  fnDef?: ReturnType<typeof functionRegistry.get>;
  fnArgs: Record<string, any>;
} {
  const toolName = getToolName(part);
  const input = part?.input;
  let displayName = toolName;
  let fnDef: ReturnType<typeof functionRegistry.get> | undefined;
  let fnArgs: Record<string, any> = {};

  if (toolName === "browserExecute" && input?.functionId) {
    fnDef = functionRegistry.get(input.functionId);
    displayName = fnDef
      ? sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName)
      : input.functionId;
    fnArgs = input.arguments || {};
  } else if (toolName === "loadSkill" && input?.name) {
    displayName = getLoadSkillDisplayName(input.name);
  } else {
    fnDef = functionRegistry.get(toolName);
    if (fnDef) {
      displayName = sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName) || toolName;
      fnArgs = input || {};
    }
  }

  return { toolName, displayName, fnDef, fnArgs };
}

function ToolCustomRender({
  fnDef,
  displayName,
  fnArgs,
  state,
  output,
}: {
  fnDef?: ReturnType<typeof functionRegistry.get>;
  displayName: string;
  fnArgs: Record<string, any>;
  state: string;
  output?: any;
}) {
  if (!fnDef?.showRender) return null;
  const isOutputError =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
    output != null &&
    typeof output === "object" &&
    typeof output.error === "string";
  const status =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !isOutputError
      ? ("success" as any)
      : state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError
        ? ("failed" as any)
        : ("running" as any);
  const rendered = fnDef.showRender({
    id: fnDef.id,
    functionId: fnDef.id,
    title: displayName,
    arguments: fnArgs,
    status,
    result: output,
  });
  if (isDOMRenderDescriptor(rendered)) {
    return <DOMContainer descriptor={rendered} />;
  }
  return rendered ?? null;
}

/**
 * Message renderer — renders a single message with inline tool-call parts.
 *
 * AI SDK v6 part types:
 * - "text" — text content
 * - "reasoning" — model reasoning/thinking
 * - "tool-${toolName}" — tool invocation (e.g. "tool-executePlan")
 * - "step-start" — step boundary marker
 *
 * AI SDK v6 tool part fields (directly on part, NOT nested):
 * - part.toolCallId — unique call ID
 * - part.input — tool arguments (was "args" in v4/v5)
 * - part.output — tool result (was "result" in v4/v5)
 * - part.state — lifecycle: "input-streaming" | "input-available" | "approval-requested" | "approval-responded" | "output-available" | "output-error"
 * - part.errorText — error message (when state === "output-error")
 */
export function MessageRenderer({
  message,
  onApprove,
  onDeny,
  onUserSelect,
  onDenySelect,
  avatar,
  showTrailingIndicator = false,
  streamingActive = false,
}: MessageRendererProps) {
  const isUser = message.role === MESSAGE_ROLE.USER;
  const suppressInlineTypingIndicator = showTrailingIndicator;
  const showToolDebugCards = sdkConfig.debug;
  const renderPart = (part: any, index: number) => {
    try {
    // 1. Tool Parts (AI SDK v6: type is "tool-${toolName}")
    if (isToolPart(part)) {
      const toolName = getToolName(part);
      const { toolCallId, input, output, state, errorText, approval } = part;
      const approvalId = approval?.id;
      // executePlan tool — render as flow node card
      if (toolName === "executePlan") {
        // Skip silently-retried validation failures — user should never see these
        if (output?._silentRetry) {
          return null;
        }

        return (
          <div key={toolCallId || index}>
            {state === TOOL_PART_STATE.INPUT_STREAMING ? (
              streamingActive && !suppressInlineTypingIndicator ? <TypingIndicator /> : null
            ) : (
              <>
                <FlowNodeCard
                  steps={input?.steps || []}
                  result={output}
                  state={state}
                  approval={approval}
                  toolCallId={toolCallId}
                  toolName={toolName}
                  approvalId={approvalId}
                  onApprove={onApprove}
                  onDeny={onDeny}
                />
                {state === TOOL_PART_STATE.OUTPUT_ERROR && errorText && (
                  <div className="my-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl">
                    <CollapsibleError
                      error={
                        typeof errorText === "string"
                          ? errorText
                          : JSON.stringify(errorText)
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
        );
      }

      if (toolName === "askUser") {
        return (
          <div key={toolCallId || index}>
            {state === TOOL_PART_STATE.INPUT_STREAMING ? (
              streamingActive && !suppressInlineTypingIndicator ? <TypingIndicator /> : null
            ) : (
              <AskUserCard
                toolCallId={toolCallId}
                input={input}
                output={output}
                state={state}
                errorText={errorText}
                onSubmit={onUserSelect}
                onDeny={onDenySelect}
              />
            )}
          </div>
        );
      }

      // Subagent tool — render as subagent card with streaming output
      if (toolName === "subagent") {
        return (
          <div key={toolCallId || index}>
            {state === TOOL_PART_STATE.INPUT_STREAMING ? (
              streamingActive && !suppressInlineTypingIndicator ? <TypingIndicator /> : null
            ) : (
              <SubagentCard
                toolCallId={toolCallId}
                input={input}
                output={output}
                state={state}
                errorText={errorText}
                preliminary={part.preliminary === true}
                streamingActive={streamingActive}
              />
            )}
          </div>
        );
      }

      // Other tools — render as generic tool card
      // Resolve the registered function definition for custom rendering.
      // Tools can reach here via two paths:
      //   1. browserExecute — wraps a function call (input.functionId identifies the function)
      //   2. Direct proxy tool — skill-bundled tools registered as native tools on the server
      //      (toolName IS the function ID, input contains the function's own arguments)
      const { displayName, fnDef, fnArgs } = getToolRenderContext(part);

      return (
        <div key={toolCallId || index}>
          {state === TOOL_PART_STATE.APPROVAL_REQUESTED ? (
            <ApprovalButtons
              toolCallId={toolCallId}
              toolName={toolName}
              args={input || {}}
              approvalId={approvalId}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ) : !showToolDebugCards && !fnDef?.showRender ? (
            <ToolCallInlineStatus
              displayName={displayName}
              state={state}
              output={output}
              errorText={errorText}
              approval={approval}
              streamingActive={streamingActive}
            />
          ) : state === TOOL_PART_STATE.INPUT_STREAMING ? (
            streamingActive && !suppressInlineTypingIndicator ? <TypingIndicator /> : null
          ) : (
            <ToolCallCard
              toolCallId={toolCallId}
              toolName={toolName}
              displayName={displayName}
              state={state}
              input={input}
              output={output}
              errorText={errorText}
              fnDef={fnDef}
              fnArgs={fnArgs}
              approval={approval}
              approvalId={approvalId}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          )}
        </div>
      );
    }

    // 2. Step-start boundary — skip (visual separator not needed)
    if (part.type === MESSAGE_PART_TYPE.STEP_START) {
      return null;
    }

    // 3. Reasoning Parts (Native AI SDK)
    if (part.type === MESSAGE_PART_TYPE.REASONING) {
      const reasoningText = typeof part.text === "string"
        ? part.text
        : typeof part.details?.text === "string"
          ? part.details.text
          : "";
      // Skip empty reasoning blocks that are not actively streaming
      const isReasoningLoading =
        streamingActive && part.state === MESSAGE_PART_STATE.STREAMING;
      if (!reasoningText.trim() && !isReasoningLoading) {
        return null;
      }
      return (
        <MessageReasoning
          key={`reasoning-${index}`}
          reasoning={reasoningText}
          isLoading={isReasoningLoading}
          debug={showToolDebugCards}
        />
      );
    }

    // 4. File Attachment Parts
    if (part.type === MESSAGE_PART_TYPE.FILE_ATTACHMENT && part.data) {
      const files: FileAttachment[] = Array.isArray(part.data)
        ? part.data
        : [part.data];
      return (
        <FileAttachmentGroup key={`file-${index}`} files={files} />
      );
    }

    // 5. Skip any other data-* parts to prevent rendering objects as React children
    if (typeof part.type === "string" && part.type.startsWith("data-")) {
      return null;
    }

    // 6. Text Parts (with potential <think> tags)
    if (part.type === MESSAGE_PART_TYPE.TEXT) {
      const text = typeof part.text === "string" ? part.text : "";

      // Regex to process <think> tags
      const parts: React.ReactNode[] = [];
      const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/g;

      let lastIndex = 0;
      let match;

      while ((match = thinkRegex.exec(text)) !== null) {
        // Text before <think>
        if (match.index > lastIndex) {
          const content = text.substring(lastIndex, match.index);
          if (content.trim()) {
            parts.push(
              isUser ? (
                <div
                  key={`text-${lastIndex}`}
                  className="inline-block px-4 py-2.5 rounded-2xl bg-ocean-600 text-white text-sm leading-relaxed"
                >
                  {content}
                </div>
              ) : (
                <MarkdownRenderer key={`text-${lastIndex}`} content={content} />
              ),
            );
          }
        }

        // The thinking content
        const thinkContent = match[1];
        const isUnfinished = !match[0].endsWith("</think>");

        // Skip empty think blocks that are finished
        if (!thinkContent.trim() && !isUnfinished) {
          lastIndex = thinkRegex.lastIndex;
          continue;
        }

        parts.push(
          <MessageReasoning
            key={`think-${match.index}`}
            reasoning={thinkContent}
            isLoading={
              streamingActive &&
              isUnfinished &&
              index === (message.parts?.length || 0) - 1
            }
            debug={showToolDebugCards}
          />,
        );

        lastIndex = thinkRegex.lastIndex;
      }

      // Remaining text after last </think>
      if (lastIndex < text.length) {
        const content = text.substring(lastIndex);
        parts.push(
          isUser ? (
            <div
              key={`text-${lastIndex}`}
              className="inline-block px-4 py-2.5 rounded-2xl bg-ocean-600 text-white text-sm leading-relaxed"
            >
              {content}
            </div>
          ) : (
            <MarkdownRenderer key={`text-${lastIndex}`} content={content} />
          ),
        );
      }

      return <React.Fragment key={index}>{parts}</React.Fragment>;
    }

    return null;
    } catch (err: any) {
      const metadata = getPartMetadata(part);
      captureException(err, {
        tags: {
          component: "MessageRenderer",
          stage: "render_part",
          message_role: message.role,
          part_type: metadata.partType,
          tool_name: metadata.toolName,
        },
        extras: {
          partIndex: index,
          partState: metadata.partState,
          hasApprovalId: metadata.hasApprovalId,
        },
      });
      console.error(
        "[OceanMCP] renderPart error:",
        "\n  Part index:", index,
        "\n  Part type:", metadata.partType,
        "\n  Part state:", metadata.partState,
        "\n  Tool name:", metadata.toolName,
        "\n  Error:", err?.message,
      );
      return null;
    }
  };

  const buildAssistantSegments = (parts: any[], keyPrefix: string) => {
    type SegmentEntry = {
      kind: "thinking" | "content";
      node: React.ReactNode;
      metaIsActive?: boolean;
      metaHasError?: boolean;
      metaToolName?: string;
      metaSkillName?: string;
    };

    type AssistantSegment = {
      kind: "thinking" | "content";
      nodes: React.ReactNode[];
      hasActiveMeta: boolean;
      metaToolCount: number;
      metaHasError: boolean;
      activeToolNames: string[];
      activeSkillNames: string[];
    };

    const entries: SegmentEntry[] = [];

    const pushWrappedNode = (
      kind: "thinking" | "content",
      node: React.ReactNode,
      key: string,
      partIndex: number,
      partData: any,
      metadata?: Omit<SegmentEntry, "kind" | "node">,
    ) => {
      const wrappedNode = (
        <PartErrorBoundary
          key={key}
          partIndex={partIndex}
          partData={partData}
          messageRole={message.role}
        >
          {node}
        </PartErrorBoundary>
      );

      entries.push({ kind, node: wrappedNode, ...metadata });
    };

    for (let index = 0; index < parts.length; index ++) {
      const part = parts[index];

      if (part.type === MESSAGE_PART_TYPE.TEXT) {
        const text = typeof part.text === "string" ? part.text : "";
        const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let textSegment = 0;

        while ((match = thinkRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const content = text.substring(lastIndex, match.index);
            if (content.trim()) {
              pushWrappedNode(
                "content",
                <MarkdownRenderer key={`text-${index}-${textSegment}`} content={content} />,
                `${keyPrefix}-content-text-${index}-${textSegment}`,
                index,
                part,
              );
              textSegment += 1;
            }
          }

          const thinkContent = match[1];
          const isUnfinished = !match[0].endsWith("</think>");
          if (thinkContent.trim() || isUnfinished) {
            const isLoading =
              streamingActive && isUnfinished && index === (message.parts?.length || 0) - 1;
            pushWrappedNode(
              "thinking",
              <MessageReasoning
                key={`think-${index}-${textSegment}`}
                reasoning={thinkContent}
                isLoading={isLoading}
                debug={false}
              />,
              `${keyPrefix}-meta-think-${index}-${textSegment}`,
              index,
              part,
              { metaIsActive: isUnfinished },
            );
            textSegment += 1;
          }

          lastIndex = thinkRegex.lastIndex;
        }

        if (lastIndex < text.length) {
          const content = text.substring(lastIndex);
          if (content.trim()) {
            pushWrappedNode(
              "content",
              <MarkdownRenderer key={`text-tail-${index}`} content={content} />,
              `${keyPrefix}-content-text-tail-${index}`,
              index,
              part,
            );
          }
        }
        continue;
      }

      if (part.type === MESSAGE_PART_TYPE.REASONING) {
        const reasoningText =
          typeof part.text === "string"
            ? part.text
            : typeof part.details?.text === "string"
              ? part.details.text
              : "";
        const isReasoningLoading =
          streamingActive && part.state === MESSAGE_PART_STATE.STREAMING;
        const isReasoningUnfinished = part.state === MESSAGE_PART_STATE.STREAMING;
        if (!reasoningText.trim() && !isReasoningLoading) {
          continue;
        }
        pushWrappedNode(
          "thinking",
          <MessageReasoning
            key={`reasoning-${index}`}
            reasoning={reasoningText}
            isLoading={isReasoningLoading}
            debug={false}
          />,
          `${keyPrefix}-meta-reasoning-${index}`,
          index,
          part,
          { metaIsActive: isReasoningUnfinished },
        );
        continue;
      }

      if (isToolMetaPart(part)) {
        const { displayName, fnDef, fnArgs } = getToolRenderContext(part);
        const node = fnDef?.showRender ? (
          <ToolCallInlineStatus
            displayName={displayName}
            state={part.state}
            output={part.output}
            errorText={part.errorText}
            approval={part.approval}
            streamingActive={streamingActive}
          />
        ) : renderPart(part, index);
        if (node !== null) {
          const isActiveTool = !isToolMetaSettled(part);
          pushWrappedNode(
            "thinking",
            node,
            `${keyPrefix}-meta-tool-${index}`,
            index,
            part,
            {
              metaIsActive: isActiveTool,
              metaHasError: isToolMetaError(part),
              metaToolName: isActiveTool && !isLoadSkillPart(part)
                ? getToolDisplayNameFromPart(part)
                : undefined,
              metaSkillName: isActiveTool && isLoadSkillPart(part)
                ? getSkillLabel(part.input?.name)
                : undefined,
            },
          );
        }
        const shouldRenderCustomOutput =
          part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE && Boolean(fnDef?.showRender);
        if (shouldRenderCustomOutput) {
          pushWrappedNode(
            "content",
            <div className="my-3 ocean-fade-in">
              <ToolCustomRender
                fnDef={fnDef}
                displayName={displayName}
                fnArgs={fnArgs}
                state={part.state}
                output={part.output}
              />
            </div>,
            `${keyPrefix}-content-tool-custom-${index}`,
            index,
            part,
          );
        }
        continue;
      }

      const node = renderPart(part, index);
      if (node !== null) {
        pushWrappedNode(
          "content",
          node,
          `${keyPrefix}-content-${index}`,
          index,
          part,
        );
      }
    }

    const segments: AssistantSegment[] = [];

    for (const entry of entries) {
      const lastSegment = segments[segments.length - 1];
      const shouldStartNew = !lastSegment || lastSegment.kind !== entry.kind;

      if (shouldStartNew) {
        segments.push({
          kind: entry.kind,
          nodes: [],
          hasActiveMeta: false,
          metaToolCount: 0,
          metaHasError: false,
          activeToolNames: [],
          activeSkillNames: [],
        });
      }

      const current = segments[segments.length - 1];
      current.nodes.push(entry.node);

      if (entry.kind === "thinking") {
        current.hasActiveMeta = current.hasActiveMeta || Boolean(entry.metaIsActive);
        current.metaHasError = current.metaHasError || Boolean(entry.metaHasError);

        if (entry.metaToolName) {
          current.metaToolCount += 1;
          if (!current.activeToolNames.includes(entry.metaToolName)) {
            current.activeToolNames.push(entry.metaToolName);
          }
        }

        if (entry.metaSkillName) {
          current.metaToolCount += 1;
          if (!current.activeSkillNames.includes(entry.metaSkillName)) {
            current.activeSkillNames.push(entry.metaSkillName);
          }
        }
      }
    }

    return segments;
  };

  const renderParts = (parts: any[], keyPrefix: string) => {
    const nodes: React.ReactNode[] = [];

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];

      if (showToolDebugCards && isLoadSkillPart(part)) {
        const groupedParts = [part];
        let nextIndex = index + 1;

        while (nextIndex < parts.length && isLoadSkillPart(parts[nextIndex])) {
          groupedParts.push(parts[nextIndex]);
          nextIndex += 1;
        }

        if (groupedParts.length > 1) {
          nodes.push(
            <PartErrorBoundary
              key={`${keyPrefix}-load-skill-${index}`}
              partIndex={index}
              partData={part}
              messageRole={message.role}
            >
              <LoadSkillGroupCard parts={groupedParts} />
            </PartErrorBoundary>,
          );
          index = nextIndex - 1;
          continue;
        }
      }

      const node = renderPart(part, index);
      if (node === null) continue;

      nodes.push(
        <PartErrorBoundary
          key={`${keyPrefix}-${index}`}
          partIndex={index}
          partData={part}
          messageRole={message.role}
        >
          {node}
        </PartErrorBoundary>,
      );
    }

    return nodes;
  };

  const hasTextContent = message.parts?.some(
    (p) => p.type === MESSAGE_PART_TYPE.TEXT && (p as any).text,
  );

  const assistantSegments =
    !isUser &&
    !showToolDebugCards &&
    Array.isArray(message.parts)
      ? buildAssistantSegments(message.parts, "eb")
      : null;
  const [expandedThinkingSegments, setExpandedThinkingSegments] = useState<Record<number, boolean>>({});
  const [processTicker, setProcessTicker] = useState(0);

  useEffect(() => {
    setExpandedThinkingSegments({});
    setProcessTicker(0);
  }, [message.id]);

  const processHasRunningHeadline = Boolean(
    assistantSegments &&
      streamingActive &&
      assistantSegments.some((segment) => segment.kind === "thinking" && segment.hasActiveMeta),
  );

  useEffect(() => {
    if (!processHasRunningHeadline) {
      setProcessTicker(0);
      return;
    }

    const interval = window.setInterval(() => {
      setProcessTicker((value) => value + 1);
    }, 2100);

    return () => window.clearInterval(interval);
  }, [
    processHasRunningHeadline,
    assistantSegments?.length,
  ]);

  // For user messages with both files and text, split into two separate bubbles
  if (isUser && message.parts && message.parts.length > 1) {
    const fileParts = message.parts.filter((p) => p.type === MESSAGE_PART_TYPE.FILE_ATTACHMENT);
    const textParts = message.parts.filter((p) => p.type === MESSAGE_PART_TYPE.TEXT);
    
    if (fileParts.length > 0 && textParts.length > 0) {
      return (
        <div className="ocean-fade-in flex flex-col gap-2 items-end">
          {/* File bubble */}
          <div className="max-w-[80%]">
            {renderParts(fileParts, "eb-file")}
          </div>
          {/* Text bubble */}
          <div className="max-w-[80%]">
            {renderParts(textParts, "eb-text")}
          </div>
        </div>
      );
    }
  }

  return (
    <div
      className={`ocean-fade-in ${isUser ? "flex justify-end" : "flex"}`}
    >
      <div className={isUser ? "max-w-[80%]" : "min-w-0 flex-1 max-w-full"}>
        {/* Render all parts */}
        {assistantSegments ? (
          <>
            {(() => {
              const activeThinkingIndexes = assistantSegments
                .map((segment, index) => (segment.kind === "thinking" && segment.hasActiveMeta ? index : -1))
                .filter((value) => value !== -1);
              const lastActiveThinkingIndex =
                activeThinkingIndexes.length > 0
                  ? activeThinkingIndexes[activeThinkingIndexes.length - 1]
                  : -1;

              return assistantSegments.map((segment, segmentIndex) => {
                if (segment.kind === "content") {
                  return (
                    <React.Fragment key={`segment-content-${segmentIndex}`}>
                      {segment.nodes}
                    </React.Fragment>
                  );
                }

                const isRunning =
                  streamingActive &&
                  segment.hasActiveMeta &&
                  segmentIndex === lastActiveThinkingIndex;
                const isStopped = segment.hasActiveMeta && !streamingActive;
                const runningStatusItems: string[] = [];

                if (isRunning) {
                  if (segment.activeToolNames.length > 0) {
                    for (const toolName of segment.activeToolNames) {
                      runningStatusItems.push(t("thinking.callingTool", { name: toolName }));
                    }
                  }

                  if (segment.activeSkillNames.length > 0) {
                    for (const skillName of segment.activeSkillNames) {
                      runningStatusItems.push(t("thinking.loadingSkill", { name: skillName }));
                    }
                  }

                  if (runningStatusItems.length === 0) {
                    runningStatusItems.push(t("thinking.running"));
                  }
                }

                const statusText =
                  runningStatusItems.length > 0
                    ? runningStatusItems[processTicker % runningStatusItems.length]
                    : isStopped
                      ? t("thinking.stopped")
                      : t("thinking.done");
                const isExpanded = expandedThinkingSegments[segmentIndex] === true;

                return (
                  <div className="mb-2" key={`segment-thinking-${segmentIndex}`}>
                    <button
                      onClick={() =>
                        setExpandedThinkingSegments((prev) => ({
                          ...prev,
                          [segmentIndex]: !prev[segmentIndex],
                        }))
                      }
                      className="mb-1 inline-flex max-w-full min-w-0 items-center justify-start gap-1.5 text-left text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      <span
                        className={`inline-block min-w-0 max-w-[min(70vw,28rem)] truncate text-[11px] text-text-tertiary ${
                          isRunning ? "ocean-tool-inline-text-shimmer" : ""
                        }`}
                        title={statusText}
                      >
                        {statusText}
                      </span>
                      <span className="inline-flex shrink-0 items-center justify-center text-text-quaternary" aria-hidden="true">
                        <svg
                          className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="pl-4 border-l border-border/50 space-y-0.5">
                        {segment.nodes}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </>
        ) : message.parts ? (
          renderParts(message.parts, "eb")
        ) : null}

        {!isUser && showTrailingIndicator && (
          <div className="mt-2">
            <TypingIndicator />
          </div>
        )}

        {/* Action buttons for AI messages */}
        {!isUser && hasTextContent && (
          <div className="flex gap-0.5 mt-1.5">
            <CopyButton
              text={
                message.parts
                  ?.filter((p) => p.type === MESSAGE_PART_TYPE.TEXT)
                  .map((p) => (p as any).text)
                  .join("") || ""
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
