import { useState, useEffect, useCallback, useRef } from "react";
import type { ServerEvent, ClientEvent, FunctionDefinition, FlowPlan } from "../types";

type WebSocketState = {
  status: "disconnected" | "connecting" | "connected" | "error";
  sessionId: string | null;
  error: string | null;
};

type UseWebSocketReturn = {
  status: WebSocketState["status"];
  sessionId: string | null;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (event: ClientEvent) => void;
  onChatStream: (callback: (content: string, done: boolean) => void) => void;
  onProposeFlow: (callback: (plan: FlowPlan) => void) => void;
  onExecuteRead: (
    callback: (requestId: string, reads: ServerEvent extends { type: "EXECUTE_READ" } ? ServerEvent["reads"] : never) => void
  ) => void;
};

export function useWebSocket(wsUrl: string): UseWebSocketReturn {
  const [state, setState] = useState<WebSocketState>({
    status: "disconnected",
    sessionId: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const chatStreamCallbackRef = useRef<((content: string, done: boolean) => void) | null>(null);
  const proposeFlowCallbackRef = useRef<((plan: FlowPlan) => void) | null>(null);
  const executeReadCallbackRef = useRef<((requestId: string, reads: unknown[]) => void) | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setState((s) => ({ ...s, status: "connecting", error: null }));

    const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const ws = new WebSocket(`${wsUrl}?sessionId=${sessionId}`);

    ws.onopen = () => {
      setState({ status: "connected", sessionId, error: null });
      console.log("[SDK] WebSocket connected", sessionId);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        
        switch (data.type) {
          case "CHAT_STREAM":
            chatStreamCallbackRef.current?.(data.content, data.done);
            break;
          case "PROPOSE_FLOW":
            proposeFlowCallbackRef.current?.(data.plan);
            break;
          case "EXECUTE_READ":
            executeReadCallbackRef.current?.(data.requestId, data.reads);
            break;
        }
      } catch (error) {
        console.error("[SDK] Error parsing WebSocket message:", error);
      }
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, status: "error", error: "WebSocket connection error" }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, status: "disconnected" }));
      wsRef.current = null;
    };

    wsRef.current = ws;
  }, [wsUrl]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState({ status: "disconnected", sessionId: null, error: null });
  }, []);

  const sendMessage = useCallback((event: ClientEvent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    } else {
      console.error("[SDK] WebSocket not connected");
    }
  }, []);

  const onChatStream = useCallback((callback: (content: string, done: boolean) => void) => {
    chatStreamCallbackRef.current = callback;
  }, []);

  const onProposeFlow = useCallback((callback: (plan: FlowPlan) => void) => {
    proposeFlowCallbackRef.current = callback;
  }, []);

  const onExecuteRead = useCallback(
    (callback: (requestId: string, reads: unknown[]) => void) => {
      executeReadCallbackRef.current = callback;
    },
    []
  );

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    status: state.status,
    sessionId: state.sessionId,
    error: state.error,
    connect,
    disconnect,
    sendMessage,
    onChatStream,
    onProposeFlow,
    onExecuteRead,
  };
}

export function syncRegistry(
  sendMessage: (event: ClientEvent) => void,
  functions: FunctionDefinition[]
): void {
  sendMessage({
    type: "SYNC_REGISTRY",
    functions,
  });
}
