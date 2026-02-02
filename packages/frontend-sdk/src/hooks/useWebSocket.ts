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
  sendMessage: (event: ClientEvent) => boolean;
  onChatStream: (callback: (content: string, done: boolean) => void) => void;
  onProposeFlow: (callback: (plan: FlowPlan) => void) => void;
  onExecuteRead: (callback: (requestId: string, reads: unknown[]) => void) => void;
};

export function useWebSocket(wsUrl: string): UseWebSocketReturn {
  const [state, setState] = useState<WebSocketState>({
    status: "disconnected",
    sessionId: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<number>(0);
  const chatStreamCallbackRef = useRef<((content: string, done: boolean) => void) | null>(null);
  const proposeFlowCallbackRef = useRef<((plan: FlowPlan) => void) | null>(null);
  const executeReadCallbackRef = useRef<((requestId: string, reads: unknown[]) => void) | null>(null);

  const connect = useCallback(() => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Increment connection ID to invalidate callbacks from old connections
    const currentConnectionId = ++connectionIdRef.current;

    setState((s) => ({ ...s, status: "connecting", error: null }));

    const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const ws = new WebSocket(`${wsUrl}?sessionId=${sessionId}`);

    ws.onopen = () => {
      // Only update state if this is still the current connection
      if (connectionIdRef.current !== currentConnectionId) {
        console.log("[SDK] Ignoring stale onopen for", sessionId);
        ws.close();
        return;
      }
      setState({ status: "connected", sessionId, error: null });
      console.log("[SDK] WebSocket connected", sessionId);
    };

    ws.onmessage = (event) => {
      // Ignore messages from stale connections
      if (connectionIdRef.current !== currentConnectionId) return;
      
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
      if (connectionIdRef.current !== currentConnectionId) return;
      setState((s) => ({ ...s, status: "error", error: "WebSocket connection error" }));
    };

    ws.onclose = () => {
      if (connectionIdRef.current !== currentConnectionId) return;
      setState((s) => ({ ...s, status: "disconnected" }));
      wsRef.current = null;
    };

    wsRef.current = ws;
  }, [wsUrl]);

  const disconnect = useCallback(() => {
    connectionIdRef.current++; // Invalidate current connection
    wsRef.current?.close();
    wsRef.current = null;
    setState({ status: "disconnected", sessionId: null, error: null });
  }, []);

  const sendMessage = useCallback((event: ClientEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
      return true;
    } else {
      console.warn("[SDK] WebSocket not ready, state:", ws?.readyState);
      return false;
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
      connectionIdRef.current++; // Invalidate on unmount
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
  sendMessage: (event: ClientEvent) => boolean,
  functions: FunctionDefinition[]
): boolean {
  return sendMessage({
    type: "SYNC_REGISTRY",
    functions,
  });
}
