import React, { useState } from "react";
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
import { FlowNodeCard } from "./FlowNodeCard";
import { ApprovalButtons } from "./ApprovalButtons";
import { UserSelectCard } from "./UserSelectCard";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { functionRegistry, skillRegistry } from "../registry";
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
  approvalId?: string;
  onApprove?: (toolCallId: string, toolName: string, approvalId?: string) => void;
  onDeny?: (toolCallId: string, toolName: string, approvalId?: string) => void;
};

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
  approvalId,
  onApprove,
  onDeny,
}: ToolCallCardProps) {
  const isReadOp = fnDef?.operationType === OPERATION_TYPE.READ;
  const isLoadSkill = toolName === "loadSkill";
  const [expanded, setExpanded] = useState(!isReadOp && !isLoadSkill);

  const hasCustomRender = !!fnDef?.showRender;

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 border-b border-border bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">{expanded ? "▼" : "▶"}</span>
          <span className="text-sm">🔧</span>
          <span className="text-sm font-semibold text-text-primary">
            {displayName}
          </span>
          {state === TOOL_PART_STATE.OUTPUT_AVAILABLE && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {t("tool.status.complete")}
            </span>
          )}
          {state === TOOL_PART_STATE.OUTPUT_ERROR && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {t("tool.status.error")}
            </span>
          )}
          {(state === TOOL_PART_STATE.INPUT_AVAILABLE ||
            state === TOOL_PART_STATE.APPROVAL_RESPONDED) && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ocean-500">
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
              {fnDef!.showRender!({
                id: fnDef!.id,
                functionId: fnDef!.id,
                title: displayName,
                arguments: fnArgs,
                status: state === TOOL_PART_STATE.OUTPUT_AVAILABLE
                  ? ("success" as any)
                  : state === TOOL_PART_STATE.OUTPUT_ERROR
                    ? ("failed" as any)
                    : ("running" as any),
              })}
              {state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
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
          {state === TOOL_PART_STATE.OUTPUT_ERROR && errorText && (
            <div className="p-4">
              <p className="text-xs text-red-500">{typeof errorText === "string" ? errorText : JSON.stringify(errorText)}</p>
            </div>
          )}
        </>
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
  avatar?: string;
};

/** Avatar icon for AI messages */
function AvatarIcon({ avatar }: { avatar?: string }) {
  if (avatar) {
    return <img src={avatar} alt="AI" className="shrink-0 w-8 h-8 object-cover" />;
  }
  
  return (
    <div className="shrink-0 w-8 h-8 rounded-full bg-linear-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-sm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z"
          fill="white"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

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
  avatar,
}: MessageRendererProps) {
  const isUser = message.role === MESSAGE_ROLE.USER;

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
              <TypingIndicator />
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
                  <div className="my-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                    <strong>Error:</strong> {typeof errorText === "string" ? errorText : JSON.stringify(errorText)}
                  </div>
                )}
              </>
            )}
          </div>
        );
      }

      if (toolName === "userSelect") {
        return (
          <div key={toolCallId || index}>
            {state === TOOL_PART_STATE.INPUT_STREAMING ? (
              <TypingIndicator />
            ) : (
              <UserSelectCard
                toolCallId={toolCallId}
                input={input}
                output={output}
                state={state}
                errorText={errorText}
                onSubmit={onUserSelect}
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
        const skill = skillRegistry.get(input.name);
        const skillLabel = skill
          ? sdkConfig.resolveDisplayName(skill.name, skill.cnName)
          : input.name;
        displayName = sdkConfig.locale === "zh-CN"
          ? `技能装填：${skillLabel}`
          : `Load Skill: ${skillLabel}`;
      } else {
        // Direct proxy tool — toolName is the function ID itself
        fnDef = functionRegistry.get(toolName);
        if (fnDef) {
          displayName = sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName) || toolName;
          fnArgs = input || {};
        }
      }

      return (
        <div key={toolCallId || index}>
          {state === TOOL_PART_STATE.INPUT_STREAMING ? (
            <TypingIndicator />
          ) : state === TOOL_PART_STATE.APPROVAL_REQUESTED ? (
            <ApprovalButtons
              toolCallId={toolCallId}
              toolName={toolName}
              args={input || {}}
              approvalId={approvalId}
              onApprove={onApprove}
              onDeny={onDeny}
            />
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
      return (
        <MessageReasoning
          key={`reasoning-${index}`}
          reasoning={reasoningText}
          isLoading={part.state === MESSAGE_PART_STATE.STREAMING}
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

        parts.push(
          <MessageReasoning
            key={`think-${match.index}`}
            reasoning={thinkContent}
            isLoading={
              isUnfinished && index === (message.parts?.length || 0) - 1
            }
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

  const hasTextContent = message.parts?.some(
    (p) => p.type === MESSAGE_PART_TYPE.TEXT && (p as any).text,
  );

  // For user messages with both files and text, split into two separate bubbles
  if (isUser && message.parts && message.parts.length > 1) {
    const fileParts = message.parts.filter((p) => p.type === MESSAGE_PART_TYPE.FILE_ATTACHMENT);
    const textParts = message.parts.filter((p) => p.type === MESSAGE_PART_TYPE.TEXT);
    
    if (fileParts.length > 0 && textParts.length > 0) {
      return (
        <div className="ocean-fade-in flex flex-col gap-2 items-end">
          {/* File bubble */}
          <div className="max-w-[80%]">
            {fileParts.map((part, index) => {
              const node = renderPart(part, index);
              if (node === null) return null;
              return (
                <PartErrorBoundary
                  key={`eb-file-${index}`}
                  partIndex={index}
                  partData={part}
                  messageRole={message.role}
                >
                  {node}
                </PartErrorBoundary>
              );
            })}
          </div>
          {/* Text bubble */}
          <div className="max-w-[80%]">
            {textParts.map((part, index) => {
              const node = renderPart(part, index);
              if (node === null) return null;
              return (
                <PartErrorBoundary
                  key={`eb-text-${index}`}
                  partIndex={index}
                  partData={part}
                  messageRole={message.role}
                >
                  {node}
                </PartErrorBoundary>
              );
            })}
          </div>
        </div>
      );
    }
  }

  return (
    <div
      className={`ocean-fade-in ${isUser ? "flex justify-end" : "flex gap-3"}`}
    >
      {/* AI avatar icon */}
      {!isUser && <AvatarIcon avatar={avatar} />}

      <div className={`max-w-[80%] ${isUser ? "" : "flex-1"}`}>
        {/* Render all parts */}
        {message.parts?.map((part, index) => {
          const node = renderPart(part, index);
          if (node === null) return null;
          return (
            <PartErrorBoundary
              key={`eb-${index}`}
              partIndex={index}
              partData={part}
              messageRole={message.role}
            >
              {node}
            </PartErrorBoundary>
          );
        })}

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
