import { MESSAGE_ROLE, TOOL_PART_TYPE_PREFIX } from "@ocean-mcp/shared";

function isToolPart(part: any): boolean {
  return (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

/**
 * Deduplicate assistant message parts.
 *
 * When the frontend auto-submits after a client-side tool result (e.g.
 * askUser), the server runs a new streamText call whose output is appended
 * to the *same* assistant message by the AI SDK. The LLM may regenerate
 * identical tool calls and text it already emitted in an earlier step, causing
 * the user to see the same selection cards / text blocks multiple times.
 *
 * This function removes duplicate parts from each assistant message:
 *  - Tool parts: if two tool parts share the same type and serialised input,
 *    only the first occurrence is kept.
 *  - Text parts: consecutive text parts with identical text are collapsed.
 *  - Orphaned step-start parts (those immediately followed by another
 *    step-start or at the end of the array after pruning) are removed.
 */
export function deduplicateAssistantParts(messages: any[]): any[] {
  return messages.map((message) => {
    if (
      message.role !== MESSAGE_ROLE.ASSISTANT ||
      !Array.isArray(message.parts) ||
      message.parts.length === 0
    ) {
      return message;
    }

    // --- Pass 1: remove duplicate tool parts and consecutive duplicate texts ---
    const seenToolKeys = new Set<string>();
    let lastTextContent: string | undefined;

    const filtered: any[] = [];

    for (const part of message.parts) {
      // Tool part dedup — keyed by type + serialised input
      if (isToolPart(part)) {
        let inputKey: string;
        try {
          inputKey = JSON.stringify(part.input ?? {});
        } catch {
          inputKey = String(part.input);
        }
        const key = `${part.type}::${inputKey}`;

        if (seenToolKeys.has(key)) {
          // Duplicate tool call — skip it
          continue;
        }
        seenToolKeys.add(key);
        lastTextContent = undefined; // reset text dedup tracker
        filtered.push(part);
        continue;
      }

      // Text part dedup — collapse consecutive identical texts
      if (part.type === "text") {
        const text = part.text ?? "";
        if (text === lastTextContent) {
          // Consecutive duplicate text — skip
          continue;
        }
        lastTextContent = text;
        filtered.push(part);
        continue;
      }

      // Step-start is just a boundary marker — don't reset text dedup tracker
      if (part.type === "step-start") {
        filtered.push(part);
        continue;
      }

      // Other part types (reasoning, etc.) — keep as-is, reset text tracker
      lastTextContent = undefined;
      filtered.push(part);
    }

    // --- Pass 2: remove orphaned step-start markers ---
    // A step-start is orphaned if it is immediately followed by another
    // step-start, or if it is the last part in the array.
    const cleaned: any[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const part = filtered[i];
      if (part.type === "step-start") {
        const next = filtered[i + 1];
        if (!next || next.type === "step-start") {
          // orphaned — skip
          continue;
        }
      }
      cleaned.push(part);
    }

    if (cleaned.length === message.parts.length) {
      return message; // nothing changed
    }

    return { ...message, parts: cleaned };
  });
}
