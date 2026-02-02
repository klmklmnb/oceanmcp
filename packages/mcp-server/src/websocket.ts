import type { ServerWebSocket } from "bun";
import type { ServerEvent, ReadOperation, FlowPlan } from "@hacker-agent/shared";
import type { WebSocketData, BunWebSocket } from "./types";
import { ClientEventSchema } from "./schemas";
import { sessionStore } from "./sessionStore";

export function handleWebSocketOpen(ws: BunWebSocket): void {
  const { sessionId } = ws.data;
  console.log(`[WS] Client connected: ${sessionId}`);
  
  sessionStore.createSession(sessionId);
  sessionStore.setConnection(sessionId, ws);
}

export function handleWebSocketMessage(ws: BunWebSocket, message: string | Buffer): void {
  const { sessionId } = ws.data;
  
  try {
    const data = JSON.parse(message.toString());
    const result = ClientEventSchema.safeParse(data);
    
    if (!result.success) {
      console.error(`[WS] Invalid message from ${sessionId}:`, result.error.errors);
      return;
    }

    const event = result.data;

    switch (event.type) {
      case "SYNC_REGISTRY":
        console.log(`[WS] Registry synced for ${sessionId}: ${event.functions.length} functions`);
        sessionStore.updateFunctions(sessionId, event.functions);
        break;

      case "READ_RESULT":
        console.log(`[WS] Read result for ${sessionId}, request: ${event.requestId}`);
        sessionStore.resolvePendingRead(
          sessionId,
          event.requestId,
          event.results.map((r) => r.result)
        );
        break;

      case "FLOW_RESULT":
        console.log(`[WS] Flow result for ${sessionId}, plan: ${event.planId}`);
        // Flow results can be used for logging/analytics
        break;

      case "CHAT":
        console.log(`[WS] Chat message from ${sessionId}: ${event.message}`);
        // This will be handled by the agent integration
        break;
    }
  } catch (error) {
    console.error(`[WS] Error processing message from ${sessionId}:`, error);
  }
}

export function handleWebSocketClose(ws: BunWebSocket): void {
  const { sessionId } = ws.data;
  console.log(`[WS] Client disconnected: ${sessionId}`);
  sessionStore.deleteSession(sessionId);
}

// Helper functions to send events to SDK

export function sendToClient(sessionId: string, event: ServerEvent): boolean {
  const ws = sessionStore.getConnection(sessionId);
  if (!ws) {
    console.error(`[WS] No connection found for session: ${sessionId}`);
    return false;
  }
  
  ws.send(JSON.stringify(event));
  return true;
}

export function sendExecuteRead(
  sessionId: string,
  requestId: string,
  reads: ReadOperation[]
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const event: ServerEvent = {
      type: "EXECUTE_READ",
      requestId,
      reads,
    };

    sessionStore.addPendingRead(sessionId, requestId, { resolve, reject });
    
    if (!sendToClient(sessionId, event)) {
      sessionStore.rejectPendingRead(sessionId, requestId, new Error("Failed to send to client"));
    }
  });
}

export function sendProposeFlow(sessionId: string, plan: FlowPlan): boolean {
  return sendToClient(sessionId, {
    type: "PROPOSE_FLOW",
    plan,
  });
}

export function sendChatStream(sessionId: string, content: string, done: boolean): boolean {
  return sendToClient(sessionId, {
    type: "CHAT_STREAM",
    content,
    done,
  });
}
