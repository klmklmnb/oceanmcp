/**
 * Wave message history builder.
 *
 * Converts `streamText()` step results into the StoredMessage format
 * used by SessionStore. This is the bridge between the AI SDK's runtime
 * types and our serializable storage format.
 *
 * ## Why not just store text?
 *
 * When `streamText` runs multi-step (tool call → tool result → next LLM
 * step), the intermediate tool interactions are critical context for the
 * LLM on subsequent turns. Without them, the model has no memory of what
 * tools it called or what results it received.
 *
 * ## How it works
 *
 * After `streamText` finishes, `await result.steps` gives us an array of
 * StepResult objects. Each step's `.content` array contains interleaved:
 *   - text parts        (the LLM's text output)
 *   - reasoning parts   (chain-of-thought, if thinking model)
 *   - tool-call parts   (what the LLM called)
 *   - tool-result parts (what the tool returned)
 *   - tool-error parts  (if the tool threw)
 *
 * We reconstruct a single assistant StoredMessage with step-start
 * boundaries and tool parts in the UIMessage format that
 * `convertToModelMessages()` expects.
 */

import type {
  StoredMessage,
  StoredMessagePart,
  StoredToolPart,
} from "./session-store";

// ── Type helpers for step content parts ──────────────────────────────────────

/** Minimal shape of a step content part (avoids importing generic ToolSet) */
interface ContentPartLike {
  type: string;
  // text parts
  text?: string;
  // tool-call / tool-result / tool-error parts
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

/** Minimal shape of a StepResult (avoids importing generic ToolSet) */
interface StepResultLike {
  readonly content: ReadonlyArray<ContentPartLike>;
  readonly text: string;
  readonly toolCalls: ReadonlyArray<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  readonly toolResults: ReadonlyArray<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }>;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a StoredMessage from completed streamText steps.
 *
 * Reconstructs a single assistant message containing all text, reasoning,
 * and tool interaction parts across all steps. Step boundaries are marked
 * with `{ type: "step-start" }` parts.
 *
 * The resulting message's parts array has the exact shape that the AI SDK's
 * `convertToModelMessages()` expects, so it round-trips cleanly.
 *
 * @param steps - The steps array from `await streamTextResult.steps`
 * @returns A StoredMessage with role "assistant", or null if steps are empty
 */
export function buildAssistantStoredMessage(
  steps: ReadonlyArray<StepResultLike>,
): StoredMessage | null {
  if (steps.length === 0) return null;

  const parts: StoredMessagePart[] = [];

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];

    // Mark step boundaries (matches StepStartUIPart)
    if (stepIdx > 0 || steps.length > 1) {
      parts.push({ type: "step-start" });
    }

    // Build a map of tool results by toolCallId for quick lookup
    const resultMap = new Map<string, { output: unknown }>();
    for (const tr of step.toolResults) {
      resultMap.set(tr.toolCallId, { output: tr.output });
    }

    // Walk through the content array in order — it preserves the natural
    // interleaving of text, reasoning, tool-call, tool-result, tool-error
    for (const part of step.content) {
      switch (part.type) {
        case "text": {
          if (part.text) {
            parts.push({ type: "text", text: part.text });
          }
          break;
        }

        case "reasoning": {
          if (part.text) {
            parts.push({ type: "reasoning", text: part.text });
          }
          break;
        }

        case "tool-call": {
          // When we see a tool-call in content, check if there's a
          // corresponding tool-result or tool-error later in the same
          // content array. If so, we'll emit a single merged tool part
          // with state "output-available". If not, it's a pending/incomplete
          // call (shouldn't happen after stream completes, but handle gracefully).
          const toolName = part.toolName ?? "unknown";
          const toolCallId = part.toolCallId ?? "";

          // Look for matching result in the step's toolResults
          const matchedResult = resultMap.get(toolCallId);

          // Also check for matching error in content
          const matchedError = step.content.find(
            (p) =>
              p.type === "tool-error" && p.toolCallId === toolCallId,
          );

          const toolPart: StoredToolPart = {
            type: `tool-${toolName}`,
            toolCallId,
            state: matchedError
              ? "output-error"
              : matchedResult
                ? "output-available"
                : "input-available",
            input: part.input,
          };

          if (matchedResult) {
            toolPart.output = matchedResult.output;
          }

          if (matchedError) {
            toolPart.errorText =
              matchedError.error instanceof Error
                ? matchedError.error.message
                : String(matchedError.error ?? "Tool execution error");
          }

          parts.push(toolPart);
          break;
        }

        // tool-result and tool-error are already handled above (merged
        // into the tool-call part). Skip them to avoid duplication.
        case "tool-result":
        case "tool-error":
          break;

        // Other part types (source, file, tool-approval-request) are
        // not persisted in history — they are ephemeral UI concerns.
        default:
          break;
      }
    }
  }

  // Don't create an empty message
  if (parts.length === 0) return null;

  // If the only parts are step-start markers with no content, skip
  const hasContent = parts.some((p) => p.type !== "step-start");
  if (!hasContent) return null;

  return {
    role: "assistant",
    parts,
    createdAt: Date.now(),
  };
}

/**
 * Build a simple user StoredMessage from text content.
 *
 * @param text - The user's message text
 * @returns A StoredMessage with role "user"
 */
export function buildUserStoredMessage(text: string): StoredMessage {
  return {
    role: "user",
    parts: [{ type: "text", text }],
    createdAt: Date.now(),
  };
}
