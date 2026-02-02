import type { FunctionDefinition, FlowPlan, ReadOperation } from "@hacker-agent/shared";
import type { AgentContext } from "./types";
import { createAgent } from "./agent";

// Session state for chat history
const sessionHistories = new Map<string, Array<{ role: string; content: string }>>();

export async function processChat(
  sessionId: string,
  message: string,
  functions: FunctionDefinition[]
): Promise<void> {
  // Dynamically import mcp-server to avoid circular dependency at module load time
  const { sendExecuteRead, sendProposeFlow, sendChatStream } = await import(
    "@hacker-agent/mcp-server"
  );

  const context: AgentContext = {
    sessionId,
    functions,
    sendExecuteRead: (requestId: string, reads: ReadOperation[]) =>
      sendExecuteRead(sessionId, requestId, reads),
    sendProposeFlow: (plan: FlowPlan) => sendProposeFlow(sessionId, plan),
    sendChatStream: (content: string, done: boolean) =>
      sendChatStream(sessionId, content, done),
  };

  // Get or create chat history for this session
  if (!sessionHistories.has(sessionId)) {
    sessionHistories.set(sessionId, []);
  }
  const chatHistory = sessionHistories.get(sessionId)!;

  try {
    // Stream thinking indicator
    sendChatStream(sessionId, "", false);

    const executor = await createAgent(context);

    // Convert chat history to LangChain format
    const formattedHistory = chatHistory.map((msg) => ({
      role: msg.role as "human" | "ai",
      content: msg.content,
    }));

    const result = await executor.invoke({
      input: message,
      chat_history: formattedHistory,
    });

    const output = result.output as string;

    // Add to chat history
    chatHistory.push({ role: "human", content: message });
    chatHistory.push({ role: "ai", content: output });

    // Limit history to last 20 messages
    if (chatHistory.length > 20) {
      chatHistory.splice(0, chatHistory.length - 20);
    }

    // Send the final response
    sendChatStream(sessionId, output, true);
  } catch (error) {
    console.error("[Agent] Error processing chat:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    sendChatStream(
      sessionId,
      `I encountered an error while processing your request: ${errorMessage}`,
      true
    );
  }
}

export function clearSessionHistory(sessionId: string): void {
  sessionHistories.delete(sessionId);
}

export { createAgent } from "./agent";
export * from "./types";
