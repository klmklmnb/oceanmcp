import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
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

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const result = streamText({
          model: getLanguageModel(modelId),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          tools: mergedTools,
          onError: (error) => {
            console.error("[Chat] streamText error:", error);
          },
        });

        dataStream.merge(result.toUIMessageStream());
      },
      onError: (error) => {
        console.error("[Chat] Stream error:", error);
        return error instanceof Error ? error.message : "Unknown error";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
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
