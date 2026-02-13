import React, { useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
} from "@ocean-mcp/shared";
import { MessageRenderer } from "./MessageRenderer";
import { wsClient } from "../runtime/ws-client";
import { CHAT_STATUS } from "../constants/chat";

const API_URL =
  (typeof window !== "undefined" && (window as any).__OCEAN_MCP_SERVER_URL__) ||
  "http://localhost:4000";

const AUTO_DENY_REASON =
  "User sent a new message instead of responding to approval";

function isToolPart(part: any): boolean {
  return (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

function getToolName(part: any): string {
  if (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  ) {
    return part.type.slice(TOOL_PART_TYPE_PREFIX.length);
  }
  return part?.toolName || "unknown";
}

function shouldAutoDeny(part: any): boolean {
  return (
    isToolPart(part) &&
    (part.state === TOOL_PART_STATE.APPROVAL_REQUESTED ||
      (part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
        part.approval?.approved === false))
  );
}

function denyPendingApprovalParts(messages: any[]): {
  messages: any[];
  changed: boolean;
} {
  let changed = false;

  const nextMessages = messages.map((message, index) => {
    if (
      message.role !== MESSAGE_ROLE.ASSISTANT ||
      !Array.isArray(message.parts)
    ) {
      return message;
    }

    let messageChanged = false;
    const nextParts = message.parts.map((part: any) => {
      if (!shouldAutoDeny(part)) return part;

      messageChanged = true;
      changed = true;

      return {
        ...part,
        state: TOOL_PART_STATE.OUTPUT_DENIED,
        approval: {
          id: part.approval?.id ?? `auto-deny-${part.toolCallId ?? index}`,
          approved: false,
          reason: part.approval?.reason ?? AUTO_DENY_REASON,
        },
      };
    });

    return messageChanged ? { ...message, parts: nextParts } : message;
  });

  return { messages: nextMessages, changed };
}

/** Send icon */
function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

/**
 * Main Chat Widget component.
 * Uses Vercel AI SDK's `useChat` with `fetch`-based transport to connect
 * to the api-server's /api/chat endpoint.
 */
export function ChatWidget() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const {
    messages,
    setMessages,
    status,
    error,
    addToolResult,
    addToolApprovalResponse,
    sendMessage,
  } = useChat({
    transport: new DefaultChatTransport({
      api: `${API_URL}/api/chat`,
      body: () => ({
        connectionId: wsClient.currentConnectionId ?? undefined,
      }),
    }),
    /**
     * AI SDK v6: After approval responses or client-side tool outputs are added,
     * decide whether to auto-submit the updated message back to the server.
     *
     * Important: we only auto-submit approval responses once *all* tool parts in
     * the last assistant message are settled. Otherwise we can submit a mixed
     * state (one approval responded, another still approval-requested), which
     * leads to missing tool-result pairs for OpenAI-compatible APIs.
     */
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.role !== MESSAGE_ROLE.ASSISTANT) return false;

      const toolParts = (lastMsg.parts || []).filter(isToolPart);
      const approvalRespondedParts = toolParts.filter((part: any) => {
        return (
          part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
          part.approval?.approved != null
        );
      });

      const hasApprovedApprovalResponse = approvalRespondedParts.some(
        (part: any) => part.approval?.approved === true,
      );

      const hasAnyApprovalResponse = approvalRespondedParts.length > 0;

      const allToolPartsSettled = toolParts.every((part: any) => {
        return (
          part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
          part.state === TOOL_PART_STATE.OUTPUT_ERROR ||
          part.state === TOOL_PART_STATE.APPROVAL_RESPONDED ||
          part.state === TOOL_PART_STATE.OUTPUT_DENIED
        );
      });

      const hasUserSelectResult = lastMsg.parts?.some((part: any) => {
        if (!isToolPart(part)) return false;
        if (getToolName(part) !== "userSelect") return false;
        return (
          part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
          part.state === TOOL_PART_STATE.OUTPUT_ERROR
        );
      });

      const decision = Boolean(
        allToolPartsSettled &&
          (hasAnyApprovalResponse
            ? hasApprovedApprovalResponse
            : hasUserSelectResult),
      );

      return decision;
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const sendUserText = async (text: string) => {
    if (!text.trim()) return;

    const normalized = denyPendingApprovalParts(messages as any[]);
    if (normalized.changed) {
      setMessages(normalized.messages as any);
    }

    await sendMessage({
      role: MESSAGE_ROLE.USER,
      parts: [{ type: MESSAGE_PART_TYPE.TEXT, text }],
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    const value = input;
    setInput("");

    await sendUserText(value);
  };

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * AI SDK v6 approval flow:
   * - For tools with `needsApproval: true`, use `addToolApprovalResponse`
   *   with the approval `id` from the tool part's `approval` object.
   * - For client-side tools needing output, use `addToolResult` / `addToolOutput`.
   *
   * The `approvalId` is passed from the ApprovalButtons component (extracted
   * from `part.approval.id` in the MessageRenderer).
   */
  const handleApprove = (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => {
    if (approvalId) {
      // AI SDK v6: use addToolApprovalResponse for needsApproval tools
      addToolApprovalResponse({
        id: approvalId,
        approved: true,
      });
    } else {
      // Fallback for tools without approval flow
      addToolResult({
        toolCallId,
        tool: toolName,
        output: "User approved the action",
      });
    }
  };

  const handleDeny = (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => {
    if (approvalId) {
      // AI SDK v6: use addToolApprovalResponse for needsApproval tools
      addToolApprovalResponse({
        id: approvalId,
        approved: false,
        reason: "User denied the action",
      });
    } else {
      addToolResult({
        toolCallId,
        tool: toolName,
        output: "User denied the action",
      });
    }
  };

  const handleUserSelect = (toolCallId: string, output: Record<string, any>) => {
    addToolResult({
      toolCallId,
      tool: "userSelect",
      output,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const isStreaming = status === CHAT_STATUS.STREAMING;
  const isLoading = status === CHAT_STATUS.SUBMITTED;

  return (
    <div className="flex flex-col h-full bg-surface-secondary">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto ocean-scrollbar px-4 py-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 ocean-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-lg mb-6">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z"
                    fill="white"
                    stroke="white"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-text-primary mb-2">
                OceanMCP
              </h2>
              <p className="text-sm text-text-tertiary text-center max-w-sm">
                Your browser-in-the-loop AI assistant. I can read data, execute
                actions, and automate workflows within this application.
              </p>
              {/* Suggested messages */}
              <div className="flex flex-wrap gap-2 mt-8 justify-center max-w-lg">
                {[
                  "What's on this page?",
                  "Show me the page info",
                  "What can you do?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput("");
                      void sendUserText(suggestion);
                    }}
                    className="px-4 py-2 text-sm text-text-secondary border border-border rounded-xl hover:bg-surface hover:border-ocean-300 hover:text-ocean-600 transition-all cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageRenderer
              key={message.id}
              message={message}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onUserSelect={handleUserSelect}
            />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3 ocean-fade-in">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z"
                    fill="white"
                  />
                </svg>
              </div>
              <div className="flex gap-1.5 items-center py-2">
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 mx-auto max-w-3xl mb-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 ocean-fade-in">
          <strong>Error:</strong> {error.message}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <form
            id="ocean-mcp-chat-form"
            onSubmit={handleSubmit}
            className="relative bg-surface border border-border rounded-2xl shadow-float transition-shadow focus-within:shadow-glow focus-within:border-ocean-300"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-12 text-sm text-text-primary placeholder-text-tertiary focus:outline-none rounded-2xl"
              style={{ minHeight: "56px", maxHeight: "200px" }}
              disabled={isStreaming || isLoading}
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-text-tertiary">
                {/* <span className="text-xs flex items-center gap-1">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z" />
                  </svg>
                  OceanMCP
                </span> */}
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || isLoading}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                  input.trim() && !isStreaming && !isLoading
                    ? "bg-ocean-600 text-white hover:bg-ocean-700 shadow-sm"
                    : "bg-surface-tertiary text-text-tertiary"
                }`}
              >
                <SendIcon />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
