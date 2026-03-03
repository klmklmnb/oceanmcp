import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
  type FileAttachment,
} from "@ocean-mcp/shared";
import { MessageRenderer } from "./MessageRenderer";
import { wsClient } from "../runtime/ws-client";
import { chatBridge } from "../runtime/chat-bridge";
import { uploadRegistry } from "../runtime/upload-registry";
import { sdkConfig } from "../runtime/sdk-config";
import { t } from "../locale";
import { CHAT_STATUS } from "../constants/chat";
import { API_URL } from "../config";

const AUTO_DENY_REASON =
  "User sent a new message instead of responding to approval";

type PendingFile = {
  id: string;
  file: File;
  status: "uploading" | "ready" | "error";
  attachment?: FileAttachment;
  error?: string;
};

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

/** Paperclip icon for upload */
function AttachIcon() {
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
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/**
 * Main Chat Widget component.
 * Uses Vercel AI SDK's `useChat` with `fetch`-based transport to connect
 * to the api-server's /api/chat endpoint.
 */
export function ChatWidget({ avatar }: { avatar?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  /** Track approval IDs that have already triggered an auto-submit to prevent re-sends. */
  const submittedApprovalIdsRef = useRef<Set<string>>(new Set());
  /** Track userSelect toolCallIds that have already triggered an auto-submit to prevent re-sends. */
  const submittedUserSelectIdsRef = useRef<Set<string>>(new Set());

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/api/chat`,
        body: () => ({
          connectionId: wsClient.currentConnectionId ?? undefined,
        }),
      }),
    [],
  );

  const sendAutomaticallyWhen = useCallback(
    ({ messages: msgs }: { messages: any[] }) => {
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.role !== MESSAGE_ROLE.ASSISTANT) return false;

      const toolParts = (lastMsg.parts || []).filter(isToolPart);

      const approvalRespondedParts = toolParts.filter((part: any) => {
        return (
          part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
          part.approval?.approved != null &&
          !submittedApprovalIdsRef.current.has(part.approval?.id)
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

      const settledUserSelectParts = toolParts.filter((part: any) => {
        if (getToolName(part) !== "userSelect") return false;
        if (!part.toolCallId) return false;
        if (submittedUserSelectIdsRef.current.has(part.toolCallId))
          return false;
        return (
          part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
          part.state === TOOL_PART_STATE.OUTPUT_ERROR
        );
      });

      const hasUserSelectResult = settledUserSelectParts.length > 0;

      const decision = Boolean(
        allToolPartsSettled &&
          (hasAnyApprovalResponse
            ? hasApprovedApprovalResponse
            : hasUserSelectResult),
      );

      if (decision) {
        console.log(
          "[OceanMCP] sendAutomaticallyWhen → true",
          { approvalCount: approvalRespondedParts.length, userSelectCount: settledUserSelectParts.length },
        );
        for (const part of approvalRespondedParts) {
          if ((part as any).approval?.id) {
            submittedApprovalIdsRef.current.add((part as any).approval.id);
          }
        }
        for (const part of settledUserSelectParts) {
          if ((part as any).toolCallId) {
            submittedUserSelectIdsRef.current.add((part as any).toolCallId);
          }
        }
      }

      return decision;
    },
    [],
  );

  const {
    messages,
    setMessages,
    status,
    error,
    addToolResult,
    addToolApprovalResponse,
    sendMessage,
  } = useChat({ transport, sendAutomaticallyWhen });

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
    
    const hasText = input.trim();
    const readyFiles = pendingFiles.filter((f) => f.status === "ready");
    
    if (!hasText && readyFiles.length === 0) return;

    const value = input;
    setInput("");
    setPendingFiles([]);

    const normalized = denyPendingApprovalParts(messages as any[]);
    if (normalized.changed) {
      setMessages(normalized.messages as any);
    }

    const parts: any[] = [];
    
    if (hasText) {
      parts.push({ type: MESSAGE_PART_TYPE.TEXT, text: value });
    }
    
    if (readyFiles.length > 0) {
      parts.push({
        type: MESSAGE_PART_TYPE.FILE_ATTACHMENT,
        data: readyFiles.map((f) => f.attachment!),
      });
    }

    await sendMessage({
      role: MESSAGE_ROLE.USER,
      parts,
    });
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

  // ─── Upload ──────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    const newPending: PendingFile[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      status: "uploading",
    }));

    setPendingFiles((prev) => [...prev, ...newPending]);

    try {
      const results = await uploadRegistry.upload(files);

      setPendingFiles((prev) =>
        prev.map((pf) => {
          const idx = newPending.findIndex((np) => np.id === pf.id);
          if (idx === -1) return pf;

          const result = results[idx];
          const { url, name, size, type, ...rest } = result;
          const attachment: FileAttachment = {
            url,
            name: name ?? pf.file.name,
            size: size ?? pf.file.size,
            mimeType: type ?? (pf.file.type || "application/octet-stream"),
          };
          if (Object.keys(rest).length > 0) {
            attachment.metadata = rest;
          }

          return { ...pf, status: "ready", attachment };
        })
      );
    } catch (err: any) {
      console.error("[OceanMCP] Upload failed:", err);
      setPendingFiles((prev) =>
        prev.map((pf) =>
          newPending.some((np) => np.id === pf.id)
            ? { ...pf, status: "error", error: err.message || "Upload failed" }
            : pf
        )
      );
    }
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Bridge: expose widget capabilities to OceanMCPSDK.*() methods
  const sendUserTextRef = useRef(sendUserText);
  sendUserTextRef.current = sendUserText;

  useEffect(() => {
    chatBridge.register("chat", async (text: string) => {
      setInput(text);
      await new Promise((r) => setTimeout(r, 80));
      setInput("");
      await sendUserTextRef.current(text);
    });

    chatBridge.register("setInput", (text: string) => {
      setInput(text);
    });

    chatBridge.register("getMessages", () => messages);

    chatBridge.register("clearMessages", () => {
      setMessages([]);
    });

    return () => chatBridge.unregisterAll();
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
              {avatar ? (
                <img src={avatar} alt="AI" className="w-16 h-16 object-cover mb-6" />
              ) : (
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
              )}
              <h2 className="text-xl font-semibold text-text-primary mb-2">
                OceanMCP
              </h2>
              <p className="text-sm text-text-tertiary text-center max-w-sm">
                {t("chat.welcome.description")}
              </p>
              {/* Suggested messages */}
              <div className="flex flex-wrap gap-2 mt-8 justify-center max-w-lg">
                {[
                  t("chat.welcome.suggestion1"),
                  t("chat.welcome.suggestion2"),
                  t("chat.welcome.suggestion3"),
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
              avatar={avatar}
            />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3 ocean-fade-in">
              {avatar ? (
                <img src={avatar} alt="AI" className="flex-shrink-0 w-8 h-8 object-cover" />
              ) : (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z"
                      fill="white"
                    />
                  </svg>
                </div>
              )}
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
          <strong>{t("chat.error.label")}</strong> {typeof error.message === "string" ? error.message : JSON.stringify(error.message ?? error)}
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
            {/* File preview area */}
            {pendingFiles.length > 0 && (
              <div className="px-4 pt-4 pb-2 border-b border-border/30">
                <div className="flex gap-2 overflow-x-auto overflow-y-visible">
                  {pendingFiles.map((pf) => (
                    <div
                      key={pf.id}
                      className="relative flex-shrink-0 w-[45px] h-[45px] rounded-md border border-border bg-surface-secondary overflow-visible group"
                    >
                      {pf.status === "uploading" && (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-ocean-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {pf.status === "ready" && pf.attachment && (
                        <div className="w-full h-full overflow-hidden rounded-md">
                          {pf.attachment.mimeType.startsWith("image/") ? (
                            <img
                              src={pf.attachment.url}
                              alt={pf.attachment.name}
                              className="w-full h-full object-cover"
                              title={pf.attachment.name}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center" title={pf.attachment.name}>
                              <span className="text-xl">📄</span>
                            </div>
                          )}
                        </div>
                      )}
                      {pf.status === "error" && (
                        <div className="w-full h-full flex items-center justify-center bg-red-50" title={pf.error || "Error"}>
                          <span className="text-lg text-red-500">⚠</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(pf.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-black/80"
                        title={t("chat.upload.remove")}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.input.placeholder")}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-12 text-sm text-text-primary placeholder-text-tertiary focus:outline-none rounded-2xl"
              style={{ minHeight: "56px", maxHeight: "200px" }}
              disabled={isStreaming || isLoading}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-text-tertiary">
                {uploadRegistry.isRegistered && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isStreaming || isLoading}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary"
                    title={t("chat.upload.title")}
                  >
                    <AttachIcon />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={
                  (!input.trim() && pendingFiles.filter(f => f.status === "ready").length === 0) ||
                  isStreaming ||
                  isLoading ||
                  pendingFiles.some(f => f.status === "uploading")
                }
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                  (input.trim() || pendingFiles.some(f => f.status === "ready")) &&
                  !isStreaming &&
                  !isLoading &&
                  !pendingFiles.some(f => f.status === "uploading")
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
