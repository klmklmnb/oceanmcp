import React from "react";
import type { UIMessage } from "ai";
import { FlowNodeCard } from "./FlowNodeCard";
import { ApprovalButtons } from "./ApprovalButtons";

type MessageRendererProps = {
  message: UIMessage;
  onApprove: (toolCallId: string, toolName: string) => void;
  onDeny: (toolCallId: string, toolName: string) => void;
};

/** Sparkle icon for AI messages */
function SparkleIcon() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-sm">
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
      title="Copy"
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

/**
 * Message renderer — renders a single message with inline tool-call parts.
 * Follows the ai-chatbot demo pattern: user messages as blue pills,
 * AI messages left-aligned with sparkle icon.
 */
import { MessageReasoning } from "./MessageReasoning";

/**
 * Message renderer — renders a single message with inline tool-call parts.
 * Follows the ai-chatbot demo pattern: user messages as blue pills,
 * AI messages left-aligned with sparkle icon.
 */
export function MessageRenderer({
  message,
  onApprove,
  onDeny,
}: MessageRendererProps) {
  const isUser = message.role === "user";

  const renderPart = (part: any, index: number) => {
    // 1. Tool Invocations
    if (part.type === "tool-invocation") {
      const toolInvocation = part.toolInvocation;
      if (!toolInvocation) return null;

      const { toolCallId, toolName, args, state, result } = toolInvocation;

      // executePlan tool — render as flow node card
      if (toolName === "executePlan") {
        return (
          <div key={toolCallId || index}>
            {state === "partial-call" ? (
              <TypingIndicator />
            ) : (
              <>
                <FlowNodeCard
                  steps={args?.steps || []}
                  result={result}
                  state={state}
                />
                {state === "call" && (
                  <ApprovalButtons
                    toolCallId={toolCallId}
                    toolName={toolName}
                    args={args}
                    onApprove={onApprove}
                    onDeny={onDeny}
                  />
                )}
              </>
            )}
          </div>
        );
      }

      // Other tools — render as generic tool card
      return (
        <div key={toolCallId || index}>
          {state === "partial-call" ? (
            <TypingIndicator />
          ) : state === "call" ? (
            <ApprovalButtons
              toolCallId={toolCallId}
              toolName={toolName}
              args={args || {}}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ) : (
            <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
              <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
                <span className="text-sm">🔧</span>
                <span className="text-sm font-semibold text-text-primary">
                  tool-{toolName}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Complete
                </span>
              </div>
              {result !== undefined && (
                <div className="p-4">
                  <pre className="text-xs bg-surface-tertiary rounded-lg p-3 overflow-x-auto text-text-secondary font-mono max-h-32 overflow-y-auto">
                    {typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // 2. Reasoning Parts (Native AI SDK)
    if (part.type === "reasoning") {
      return (
        <MessageReasoning
          key={`reasoning-${index}`}
          reasoning={part.details?.text || part.text || ""}
          isLoading={part.state === "streaming"}
        />
      );
    }

    // 3. Text Parts (with potential <think> tags)
    if (part.type === "text") {
      const text = part.text || "";

      // Regex to process <think> tags
      // Captures: 1. pre-think text, 2. think content, 3. post-think text (which might be processed in next iteration if multiple)
      // Simple split approach:
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
              <div
                key={`text-${lastIndex}`}
                className={
                  isUser
                    ? "inline-block px-4 py-2.5 rounded-2xl bg-ocean-600 text-white text-sm leading-relaxed"
                    : "text-sm text-text-primary leading-relaxed whitespace-pre-wrap"
                }
              >
                {content}
              </div>,
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
          <div
            key={`text-${lastIndex}`}
            className={
              isUser
                ? "inline-block px-4 py-2.5 rounded-2xl bg-ocean-600 text-white text-sm leading-relaxed"
                : "text-sm text-text-primary leading-relaxed whitespace-pre-wrap"
            }
          >
            {content}
          </div>,
        );
      }

      return <React.Fragment key={index}>{parts}</React.Fragment>;
    }

    return null;
  };

  const hasTextContent = message.parts?.some(
    (p) => p.type === "text" && p.text,
  );

  return (
    <div
      className={`ocean-fade-in ${isUser ? "flex justify-end" : "flex gap-3"}`}
    >
      {/* AI sparkle icon */}
      {!isUser && <SparkleIcon />}

      <div className={`max-w-[80%] ${isUser ? "" : "flex-1"}`}>
        {/* Render all parts */}
        {message.parts?.map((part, index) => renderPart(part, index))}

        {/* Action buttons for AI messages */}
        {!isUser && hasTextContent && (
          <div className="flex gap-0.5 mt-1.5">
            <CopyButton
              text={
                message.parts
                  ?.filter((p) => p.type === "text")
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
