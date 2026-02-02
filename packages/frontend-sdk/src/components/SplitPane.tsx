import { useState, useEffect, useCallback, useRef } from "react";
import { ChatPane } from "./ChatPane";
import { FlowPane } from "./FlowPane";
import { useWebSocket, syncRegistry } from "../hooks/useWebSocket";
import { getRegistry } from "../registry";
import { executeFlow } from "../runtime/executor";
import type { ChatMessage, FlowPlan, ReadOperation } from "../types";

type SplitPaneProps = {
  serverUrl: string;
  wsUrl: string;
  onClose: () => void;
};

export function SplitPane({ serverUrl, wsUrl, onClose }: SplitPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<FlowPlan | null>(null);
  const [isRunningFlow, setIsRunningFlow] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const registrySyncedRef = useRef(false);

  const ws = useWebSocket(wsUrl);

  // Connect on mount
  useEffect(() => {
    ws.connect();
    registrySyncedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Sync registry when connected (only once per connection)
  useEffect(() => {
    if (ws.status === "connected" && !registrySyncedRef.current) {
      const functions = getRegistry();
      const sent = syncRegistry(ws.sendMessage, functions);
      if (sent) {
        registrySyncedRef.current = true;
        console.log("[SDK] Registry synced with", functions.length, "functions");
      }
    }
  }, [ws.status, ws.sendMessage]);

  // Handle chat stream
  useEffect(() => {
    ws.onChatStream((content, done) => {
      if (done) {
        setIsTyping(false);
        if (content || streamingContent) {
          const finalContent = content || streamingContent;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: "assistant",
              content: finalContent,
              timestamp: Date.now(),
            },
          ]);
          setStreamingContent("");
        }
      } else {
        setIsTyping(true);
        if (content) {
          setStreamingContent((prev) => prev + content);
        }
      }
    });
  }, [ws.onChatStream, streamingContent]);

  // Handle propose flow
  useEffect(() => {
    ws.onProposeFlow((plan) => {
      setCurrentPlan(plan);
    });
  }, [ws.onProposeFlow]);

  // Handle execute read requests
  useEffect(() => {
    ws.onExecuteRead(async (requestId, reads) => {
      const registry = getRegistry();
      const results: { id: string; result: unknown; error?: string }[] = [];
      const previousResults: unknown[] = [];

      for (const read of reads as ReadOperation[]) {
        const func = registry.find((f) => f.id === read.functionId);
        if (!func) {
          results.push({
            id: read.id,
            result: null,
            error: `Function not found: ${read.functionId}`,
          });
          continue;
        }

        try {
          // Substitute $N references with previous results
          const args = substituteReferences(read.arguments, previousResults);
          
          // Execute the function
          const executor = new Function("args", "window", func.code);
          const result = await executor(args, window);
          results.push({ id: read.id, result });
          previousResults.push(result);
        } catch (error) {
          results.push({
            id: read.id,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          });
          previousResults.push(null);
        }
      }

      ws.sendMessage({
        type: "READ_RESULT",
        requestId,
        results,
      });
    });
  }, [ws.onExecuteRead, ws.sendMessage]);

  const handleSendMessage = useCallback(
    async (message: string) => {
      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "user",
          content: message,
          timestamp: Date.now(),
        },
      ]);

      setIsTyping(true);

      // Send to server
      try {
        await fetch(`${serverUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: ws.sessionId,
            message,
          }),
        });
      } catch (error) {
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: `Error: Failed to send message. ${error instanceof Error ? error.message : ""}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [serverUrl, ws.sessionId]
  );

  const handleRunFlow = useCallback(async () => {
    if (!currentPlan) return;

    setIsRunningFlow(true);
    const registry = getRegistry();

    const updatedNodes = await executeFlow(
      currentPlan.nodes,
      registry,
      (nodeId, status, result, error) => {
        setCurrentPlan((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === nodeId ? { ...n, status, result, error } : n
            ),
          };
        });
      }
    );

    // Send flow result
    ws.sendMessage({
      type: "FLOW_RESULT",
      planId: currentPlan.planId,
      results: updatedNodes,
    });

    setIsRunningFlow(false);
  }, [currentPlan, ws.sendMessage]);

  const handleCancelFlow = useCallback(() => {
    setCurrentPlan(null);
    setIsRunningFlow(false);
  }, []);

  const connectionStatus = ws.status === "connected" 
    ? "🟢 Connected" 
    : ws.status === "connecting" 
    ? "🟡 Connecting..." 
    : "🔴 Disconnected";

  return (
    <div className="hacker-agent-container">
      <div className="hacker-agent-header">
        <div className="hacker-agent-title">
          <span>⚡</span>
          <span>HackerAgent</span>
          <span style={{ 
            fontSize: "12px", 
            color: "#666", 
            fontWeight: "normal",
            marginLeft: "12px"
          }}>
            {connectionStatus}
          </span>
        </div>
        <button className="hacker-agent-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="hacker-agent-body">
        <ChatPane
          messages={messages}
          isTyping={isTyping}
          onSendMessage={handleSendMessage}
          disabled={ws.status !== "connected"}
        />
        <FlowPane
          plan={currentPlan}
          isRunning={isRunningFlow}
          onRunFlow={handleRunFlow}
          onCancelFlow={handleCancelFlow}
        />
      </div>
    </div>
  );
}

// Helper to substitute $N.path references
function substituteReferences(
  args: Record<string, unknown>,
  previousResults: unknown[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const match = value.match(/^\$(\d+)(.*)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const path = match[2];
        let resolved = previousResults[index];
        
        if (path) {
          // Navigate the path (e.g., .clusters[0].id)
          const pathParts = path.match(/\.(\w+)|\[(\d+)\]/g) || [];
          for (const part of pathParts) {
            if (resolved == null) break;
            if (part.startsWith(".")) {
              resolved = (resolved as Record<string, unknown>)[part.slice(1)];
            } else if (part.startsWith("[")) {
              const idx = parseInt(part.slice(1, -1), 10);
              resolved = (resolved as unknown[])[idx];
            }
          }
        }
        
        result[key] = resolved;
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
