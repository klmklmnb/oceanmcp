import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";

type ChatPaneProps = {
  messages: ChatMessage[];
  isTyping: boolean;
  onSendMessage: (message: string) => void;
  disabled?: boolean;
};

export function ChatPane({ messages, isTyping, onSendMessage, disabled }: ChatPaneProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="hacker-agent-chat-pane">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ 
            color: "#666", 
            textAlign: "center", 
            padding: "40px 20px",
            fontSize: "14px"
          }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>👋</div>
            <div>Hello! I'm HackerAgent, your DevOps assistant.</div>
            <div style={{ marginTop: "8px" }}>
              Ask me to check cluster status, view logs, or help manage your infrastructure.
            </div>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.role}`}
          >
            {message.content}
          </div>
        ))}
        
        {isTyping && (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-container" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          placeholder="Ask me anything about your infrastructure..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="submit"
          className="chat-send-button"
          disabled={!input.trim() || disabled}
        >
          Send
        </button>
      </form>
    </div>
  );
}
