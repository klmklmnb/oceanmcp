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
    }: {
      messages: any[]; // Vercel AI SDK UI messages
      modelId?: string;
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get dynamic tool schemas registered by browser clients
    const dynamicSchemas = connectionManager.getAllToolSchemas();
    const mergedTools = getMergedTools(dynamicSchemas);

    const result = streamText({
      model: getLanguageModel(modelId),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: mergedTools,
      stopWhen: stepCountIs(10),
      onError: (error) => {
        console.error("[Chat] streamText error:", error);
      },
    });

    return result.toUIMessageStreamResponse({ sendReasoning: true });
  } catch (error) {
    console.error("[Chat] Request error:", error);
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
