import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import {
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
} from "@ocean-mcp/shared";
import { getLanguageModel } from "../ai/providers";
import { getSystemPrompt } from "../ai/prompts";
import { getMergedTools } from "../ai/tools";
import { connectionManager } from "../ws/connection-manager";

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

    const normalizedMessages = normalizeStaleApprovals(messages);
    const modelMessages = await convertToModelMessages(normalizedMessages);

    const result = streamText({
      model: getLanguageModel(modelId),
      system: getSystemPrompt(),
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
