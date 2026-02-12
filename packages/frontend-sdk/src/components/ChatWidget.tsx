import React, { useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageRenderer } from "./MessageRenderer";

const API_URL =
  (typeof window !== "undefined" && (window as any).__OCEAN_MCP_SERVER_URL__) ||
  "http://localhost:4000";

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

  const { messages, status, error, addToolResult, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      api: `${API_URL}/api/chat`,
    }),
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    const value = input;
    setInput("");

    // Use append to match legacy behavior closer if sendMessage is tricky
    // But ai-chatbot uses sendMessage. Let's try append first as it's more standard for simple usage
    // defined in useChat? Wait, useChat v3 return doesn't seem to have append in my grep?
    // ai-chatbot used sendMessage.
    // sendMessage({ role: 'user', parts: [{ type: 'text', text: value }] })

    await sendMessage({
      role: "user",
      parts: [{ type: "text", text: value }],
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

  const handleApprove = (toolCallId: string, toolName: string) => {
    addToolResult({
      toolCallId,
      tool: toolName,
      output: "User approved the action",
    });
  };

  const handleDeny = (toolCallId: string, toolName: string) => {
    addToolResult({
      toolCallId,
      tool: toolName,
      output: "User denied the action",
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const isStreaming = status === "streaming";
  const isLoading = status === "submitted";

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
                      setInput(suggestion);
                      // Trigger submit slightly later to allow state update?
                      // Actually better to just call submit logic directly
                      sendMessage({
                        role: "user",
                        parts: [{ type: "text", text: suggestion }],
                      });
                      setInput("");
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
        <div className="px-4 py-2 mx-4 mb-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 ocean-fade-in">
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
