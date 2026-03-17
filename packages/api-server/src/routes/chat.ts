import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  type FileAttachment,
} from "oceanmcp-shared";
import type { ModelConfig } from "oceanmcp-shared";
import { getLanguageModel, resolveMaxTokens, resolveThinkingConfig, withThinkingConfig } from "../ai/providers";
import { getSystemPrompt } from "../ai/prompts";
import { getMergedTools } from "../ai/tools";
import { ToolRetryTracker } from "../ai/tools/retry-tracker";
import { connectionManager } from "../ws/connection-manager";
import { deduplicateAssistantParts } from "./deduplicate-parts";
import { normalizeStaleInteractions } from "./normalize-stale-interactions";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert custom `file-attachment` parts into `text` parts that
 * `convertToModelMessages` understands, so the LLM receives a readable
 * description of each uploaded file.
 */
function materialiseFileAttachments(messages: any[]): any[] {
  return messages.map((message) => {
    if (message.role !== MESSAGE_ROLE.USER || !Array.isArray(message.parts)) {
      return message;
    }

    let changed = false;
    const parts = message.parts.flatMap((part: any) => {
      if (part.type !== MESSAGE_PART_TYPE.FILE_ATTACHMENT) return [part];

      changed = true;
      const files: FileAttachment[] = Array.isArray(part.data)
        ? part.data
        : [part.data];
      const text = files
        .map((f) => {
          const lines = [
            `[Uploaded file]`,
            `- Name: ${f.name}`,
            `- Type: ${f.mimeType}`,
            `- Size: ${formatFileSize(f.size)}`,
            `- URL: ${f.url}`,
          ];
          if (f.metadata) {
            for (const [key, value] of Object.entries(f.metadata)) {
              lines.push(`- ${key}: ${String(value)}`);
            }
          }
          return lines.join("\n");
        })
        .join("\n\n");
      return [{ type: MESSAGE_PART_TYPE.TEXT, text }];
    });

    return changed ? { ...message, parts } : message;
  });
}

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
      modelConfig,
      connectionId,
      locale,
      toolRetries,
      subagentEnabled,
      subagentModel,
      subagentTimeoutMs,
      subagentMaxParallel,
      uploaderRegistered,
    }: {
      messages: any[];
      modelConfig?: ModelConfig;
      connectionId?: string;
      locale?: string;
      toolRetries?: number;
      subagentEnabled?: boolean;
      subagentModel?: ModelConfig;
      subagentTimeoutMs?: number;
      subagentMaxParallel?: number;
      uploaderRegistered?: boolean;
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
    const retryTracker = new ToolRetryTracker(toolRetries ?? 5);
    const resolvedModel = getLanguageModel(modelConfig?.default);
    const mergedTools = getMergedTools(dynamicSchemas, connectionId, retryTracker, {
      subagentEnabled,
      subagentModel,
      subagentTimeoutMs,
      subagentMaxParallel,
      model: resolvedModel,
    });

    const normalizedMessages = materialiseFileAttachments(
      deduplicateAssistantParts(normalizeStaleInteractions(messages)),
    );
    const modelMessages = await convertToModelMessages(normalizedMessages);

    const thinkingConfig = resolveThinkingConfig(modelConfig);

    // Wrap in withThinkingConfig so the customFetch interceptor can read
    // the per-request thinking/reasoning config via AsyncLocalStorage.
    const result = withThinkingConfig(thinkingConfig, () =>
      streamText({
        // NOTE: Currently only the "default" model is used for all requests.
        // `modelConfig.fast` is accepted from the frontend but not yet wired
        // in — it will be consumed once task-level model routing is added
        // (e.g. using the fast model for intent classification or summaries).
        model: resolvedModel,
        system: getSystemPrompt({ connectionId, locale, subagentEnabled, uploaderRegistered }),
        messages: modelMessages,
        tools: mergedTools,
        maxOutputTokens: resolveMaxTokens(modelConfig?.maxTokens),
        stopWhen: stepCountIs(100),
      }),
    );

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
