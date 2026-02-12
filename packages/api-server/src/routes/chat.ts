import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import { getLanguageModel } from "../ai/providers";
import { systemPrompt } from "../ai/prompts";
import { getMergedTools } from "../ai/tools";
import { connectionManager } from "../ws/connection-manager";

/**
 * POST /api/chat handler
 *
 * Receives chat messages from the frontend SDK, runs the AI agent via
 * Vercel AI SDK `streamText()`, and returns a UI message stream response.
 */
export async function handleChatRequest(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const {
      messages,
      modelId,
      connectionId,
    }: {
      messages: any[]; // Vercel AI SDK UI messages
      modelId?: string;
      connectionId?: string;
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!connectionId && connectionManager.getConnectionCount() > 1) {
      return new Response(
        JSON.stringify({
          error:
            "Missing browser connection ID for a multi-client session. Please retry after WebSocket registration completes.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    if (connectionId && !connectionManager.hasConnection(connectionId)) {
      return new Response(
        JSON.stringify({
          error: `Browser connection not found: ${connectionId}`,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    // Scope tools to the requesting browser connection when available.
    const dynamicSchemas = connectionManager.getToolSchemas(connectionId);
    const mergedTools = getMergedTools(dynamicSchemas, connectionId);

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: getLanguageModel(modelId),
      system: systemPrompt,
      messages: modelMessages,
      tools: mergedTools,
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse({ sendReasoning: true });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}
