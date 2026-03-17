import React, { useState } from "react";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_PART_STATE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
} from "oceanmcp-shared";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MessageReasoning } from "./MessageReasoning";
import { functionRegistry } from "../registry";
import { sdkConfig } from "../runtime/sdk-config";
import { t } from "../locale";

// ── Helper: detect subagent-specific states ──────────────────────────────────

type SubagentStatus = "running" | "complete" | "error" | "timeout";

function resolveSubagentStatus(
  state: string,
  errorText?: string,
  preliminary?: boolean,
): SubagentStatus {
  if (state === TOOL_PART_STATE.OUTPUT_ERROR) {
    if (typeof errorText === "string" && /timeout/i.test(errorText)) {
      return "timeout";
    }
    return "error";
  }
  if (state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !preliminary) {
    return "complete";
  }
  return "running";
}

function getStatusConfig(status: SubagentStatus) {
  switch (status) {
    case "running":
      return {
        text: t("subagent.status.running"),
        dotClass: "bg-ocean-400",
        textClass: "text-ocean-500",
        showSpinner: true,
      };
    case "complete":
      return {
        text: t("subagent.status.complete"),
        dotClass: "bg-emerald-400",
        textClass: "text-emerald-600",
        showSpinner: false,
      };
    case "error":
      return {
        text: t("subagent.status.error"),
        dotClass: "bg-red-400",
        textClass: "text-red-500",
        showSpinner: false,
      };
    case "timeout":
      return {
        text: t("subagent.status.timeout"),
        dotClass: "bg-amber-400",
        textClass: "text-amber-600",
        showSpinner: false,
      };
  }
}

// ── Model output extraction (mirrors server-side toModelOutput logic) ────────

/**
 * Extract the text that `toModelOutput` returns to the main agent.
 *
 * The server's `toModelOutput` finds the last text part from the subagent's
 * UIMessage output and returns it as the compressed context for the main agent.
 * This function replicates that logic on the frontend for debug display.
 *
 * @exported for testing
 */
export function extractModelOutput(output: any): string {
  if (!output?.parts || !Array.isArray(output.parts)) {
    return "Subagent task completed with no output.";
  }

  const lastTextPart = [...output.parts]
    .reverse()
    .find(
      (p: any) => p.type === "text" && typeof p.text === "string" && p.text.trim(),
    );

  return lastTextPart?.text ?? "Subagent task completed with no text output.";
}

// ── Inline tool status for subagent's internal tool calls ────────────────────

function SubagentToolInlineStatus({
  displayName,
  state,
  output,
  streamingActive,
}: {
  displayName: string;
  state: string;
  output?: any;
  streamingActive?: boolean;
}) {
  const isOutputError =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
    output != null &&
    typeof output === "object" &&
    typeof output.error === "string";

  const isComplete = state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !isOutputError;
  const isError = state === TOOL_PART_STATE.OUTPUT_ERROR || isOutputError;
  const isRunning = !isComplete && !isError;

  const statusText = isError
    ? t("tool.inline.error", { name: displayName })
    : isComplete
      ? t("tool.inline.complete", { name: displayName })
      : t("tool.inline.running", { name: displayName });

  const statusClass = isError
    ? "text-red-500"
    : "text-text-secondary";

  return (
    <div className="my-1 px-0.5">
      <p
        className={`text-[13px] leading-5 font-semibold ${statusClass} ${
          isRunning && streamingActive ? "ocean-tool-inline-text-shimmer" : ""
        }`}
      >
        {statusText}
      </p>
    </div>
  );
}

// ── Part renderer for subagent output ────────────────────────────────────────

/**
 * Render the parts of a subagent's UIMessage output.
 * Reuses the same components as the main MessageRenderer (MarkdownRenderer,
 * MessageReasoning, ToolCallInlineStatus) but in a simplified form since
 * subagents are autonomous (no approval buttons, no askUser cards).
 */
function SubagentParts({
  parts,
  streamingActive,
}: {
  parts: any[];
  streamingActive?: boolean;
}) {
  if (!parts || !Array.isArray(parts) || parts.length === 0) return null;

  return (
    <>
      {parts.map((part: any, index: number) => {
        // Text parts
        if (part.type === MESSAGE_PART_TYPE.TEXT) {
          const text = typeof part.text === "string" ? part.text : "";
          if (!text.trim()) return null;

          // Handle <think> tags embedded in text (same as main renderer)
          const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/g;
          const segments: React.ReactNode[] = [];
          let lastIndex = 0;
          let match: RegExpExecArray | null;
          let segIdx = 0;

          while ((match = thinkRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
              const content = text.substring(lastIndex, match.index);
              if (content.trim()) {
                segments.push(
                  <MarkdownRenderer key={`text-${index}-${segIdx}`} content={content} />,
                );
                segIdx++;
              }
            }
            const thinkContent = match[1];
            const isUnfinished = !match[0].endsWith("</think>");
            if (thinkContent.trim() || isUnfinished) {
              segments.push(
                <MessageReasoning
                  key={`think-${index}-${segIdx}`}
                  reasoning={thinkContent}
                  isLoading={streamingActive === true && isUnfinished && index === parts.length - 1}
                  debug={false}
                />,
              );
              segIdx++;
            }
            lastIndex = thinkRegex.lastIndex;
          }

          if (lastIndex < text.length) {
            const content = text.substring(lastIndex);
            if (content.trim()) {
              segments.push(
                <MarkdownRenderer key={`text-tail-${index}`} content={content} />,
              );
            }
          }

          return <React.Fragment key={index}>{segments}</React.Fragment>;
        }

        // Reasoning parts
        if (part.type === MESSAGE_PART_TYPE.REASONING) {
          const reasoningText =
            typeof part.text === "string"
              ? part.text
              : typeof part.details?.text === "string"
                ? part.details.text
                : "";
          const isLoading = streamingActive === true && part.state === MESSAGE_PART_STATE.STREAMING;
          if (!reasoningText.trim() && !isLoading) return null;
          return (
            <MessageReasoning
              key={`reasoning-${index}`}
              reasoning={reasoningText}
              isLoading={isLoading}
              debug={false}
            />
          );
        }

        // Step-start — skip
        if (part.type === MESSAGE_PART_TYPE.STEP_START) {
          return null;
        }

        // Tool invocation parts (tool-<name>)
        if (typeof part.type === "string" && part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
          const toolName = part.type.slice(TOOL_PART_TYPE_PREFIX.length);

          // Resolve display name
          let displayName = toolName;
          if (toolName === "browserExecute" && part.input?.functionId) {
            const fnDef = functionRegistry.get(part.input.functionId);
            displayName = fnDef
              ? sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName)
              : part.input.functionId;
          } else {
            const fnDef = functionRegistry.get(toolName);
            if (fnDef) {
              displayName = sdkConfig.resolveDisplayName(fnDef.name, fnDef.cnName) || toolName;
            }
          }

          // Skip input-streaming state
          if (part.state === TOOL_PART_STATE.INPUT_STREAMING) {
            return null;
          }

          return (
            <SubagentToolInlineStatus
              key={part.toolCallId || `tool-${index}`}
              displayName={displayName}
              state={part.state}
              output={part.output}
              streamingActive={streamingActive}
            />
          );
        }

        return null;
      })}
    </>
  );
}

// ── SubagentCard ─────────────────────────────────────────────────────────────

type SubagentCardProps = {
  toolCallId: string;
  input: { task: string; systemPrompt: string };
  output: any; // UIMessage from readUIMessageStream
  state: string;
  errorText?: string;
  preliminary?: boolean;
  streamingActive?: boolean;
};

export function SubagentCard({
  toolCallId,
  input,
  output,
  state,
  errorText,
  preliminary,
  streamingActive,
}: SubagentCardProps) {
  const status = resolveSubagentStatus(state, errorText, preliminary);
  const statusConfig = getStatusConfig(status);
  const [expanded, setExpanded] = useState(false);
  const isDebug = sdkConfig.debug;
  const isComplete = status === "complete";

  const taskLabel = input?.task
    ? input.task.length > 80
      ? input.task.substring(0, 80) + "..."
      : input.task
    : t("subagent.title");

  const outputParts = output?.parts;
  const hasOutput = Array.isArray(outputParts) && outputParts.length > 0;

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 border-b border-border bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-text-tertiary">{expanded ? "▼" : "▶"}</span>
            <span className="text-sm">🤖</span>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <span
              className="block truncate text-sm font-semibold text-text-primary"
              title={input?.task || t("subagent.title")}
            >
              {taskLabel}
            </span>
          </div>
          <span
            className={`ml-auto flex shrink-0 whitespace-nowrap items-center gap-1.5 text-xs ${statusConfig.textClass}`}
          >
            {statusConfig.showSpinner ? (
              <span
                className="inline-block w-3 h-3 border-2 border-ocean-500 border-t-transparent rounded-full"
                style={{ animation: "ocean-spin 0.8s linear infinite" }}
              />
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dotClass}`} />
            )}
            {statusConfig.text}
          </span>
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 py-3">
          {/* System prompt (collapsible code block, debug mode only) */}
          {isDebug && input?.systemPrompt && (
            <DebugCollapsibleSection
              label={t("subagent.systemPrompt")}
              content={input.systemPrompt}
            />
          )}

          {/* Subagent output parts */}
          {hasOutput ? (
            <SubagentParts
              parts={outputParts}
              streamingActive={streamingActive && preliminary === true}
            />
          ) : status === "running" ? (
            <div className="flex gap-1.5 py-2">
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
            </div>
          ) : null}

          {/* Error display */}
          {state === TOOL_PART_STATE.OUTPUT_ERROR && errorText && (
            <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
              {typeof errorText === "string" ? errorText : JSON.stringify(errorText)}
            </div>
          )}

          {/* Streaming indicator */}
          {preliminary && hasOutput && (
            <div className="flex gap-1.5 py-2 mt-1">
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
            </div>
          )}

          {/* Model output — what the main agent sees (debug mode, after completion) */}
          {isDebug && isComplete && hasOutput && (
            <DebugCollapsibleSection
              label={t("subagent.modelOutput")}
              content={extractModelOutput(output)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Debug-only collapsible code snippet ──────────────────────────────────────

/**
 * Collapsible code snippet for debug-mode inspection.
 * Used for both the system prompt and the model output sections.
 * Collapsed by default.
 */
function DebugCollapsibleSection({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="mb-3">
      <button
        onClick={() => setShow((v) => !v)}
        className="text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
      >
        {show ? "▼" : "▶"} {label}
      </button>
      {show && (
        <pre className="mt-1.5 text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-40 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}
