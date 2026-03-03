import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
  type FileAttachment,
} from "@ocean-mcp/shared";
import type { ModelConfig } from "@ocean-mcp/shared";
import { getLanguageModel, resolveMaxTokens } from "../ai/providers";
import { getSystemPrompt } from "../ai/prompts";
import { getMergedTools } from "../ai/tools";
import { connectionManager } from "../ws/connection-manager";
import { deduplicateAssistantParts } from "./deduplicate-parts";

const AUTO_DENY_REASON =
  "User sent a new message instead of responding to approval.";

function isToolPart(part: any): boolean {
  return (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

function shouldAutoDeny(part: any): boolean {
  return (
    isToolPart(part) &&
    part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
    part.approval?.approved === false
  );
}

/**
 * OpenAI-compatible chat completions require a tool result message for each
 * prior tool call before the next user turn. Approval-only parts do not satisfy
 * that requirement, so we convert stale approval waits (when user already moved
 * on) and explicit denied approvals into `output-denied` to emit a proper
 * tool result.
 */
function normalizeStaleApprovals(messages: any[]): any[] {
  return messages.map((message, index) => {
    if (
      message.role !== MESSAGE_ROLE.ASSISTANT ||
      !Array.isArray(message.parts)
    ) {
      return message;
    }

    const hasLaterUserMessage = messages
      .slice(index + 1)
      .some((m) => m?.role === MESSAGE_ROLE.USER);

    let changed = false;
    const parts = message.parts.map((part: any) => {
      const denyBecauseMovedOn =
        isToolPart(part) &&
        part.state === TOOL_PART_STATE.APPROVAL_REQUESTED &&
        hasLaterUserMessage;

      if (!denyBecauseMovedOn && !shouldAutoDeny(part)) return part;
      changed = true;

      return {
        ...part,
        state: TOOL_PART_STATE.OUTPUT_DENIED,
        approval: {
          id: part.approval?.id ?? `auto-deny-${part.toolCallId ?? index}`,
          approved: false,
          reason: part.approval?.reason ?? AUTO_DENY_REASON,
        },
      };
    });

    return changed ? { ...message, parts } : message;
  });
}

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
    }: {
      messages: any[];
      modelConfig?: ModelConfig;
      connectionId?: string;
      locale?: string;
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

    const normalizedMessages = materialiseFileAttachments(
      deduplicateAssistantParts(normalizeStaleApprovals(messages)),
    );
    const modelMessages = await convertToModelMessages(normalizedMessages);

    const result = streamText({
      // NOTE: Currently only the "default" model is used for all requests.
      // `modelConfig.fast` is accepted from the frontend but not yet wired
      // in — it will be consumed once task-level model routing is added
      // (e.g. using the fast model for intent classification or summaries).
      model: getLanguageModel(modelConfig?.default),
      system: getSystemPrompt(connectionId, locale),
      messages: modelMessages,
      tools: mergedTools,
      maxOutputTokens: resolveMaxTokens(modelConfig?.maxTokens),
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
