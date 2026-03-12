/**
 * Wave message sender — streaming card responses.
 *
 * Handles the outbound flow: AI response text -> Wave streaming card API.
 * Follows the pattern from openclaw-wave-extension's reply-dispatcher.ts,
 * simplified for server-side use.
 *
 * Flow:
 *   1. Reply with a card message containing a named Markdown component
 *   2. Enable streaming mode on the card
 *   3. Incrementally update the Markdown content via streaming API
 *   4. Disable streaming mode and finalize the card
 *   5. If content exceeds card limit (~28KB), split into continuation messages
 */

import {
  CardTag,
  msgCard,
  msgMarkdown,
  cardMarkdown,
  cardPlainText,
  cardButton,
  cardOptionValue,
  cardDropdown,
  cardFlow,
  cardColumn,
  cardHeader,
  type MsgCard,
  type Card,
  type CardOption,
} from "@mihoyo/wave-opensdk";
import { FLOW_STEP_STATUS } from "@ocean-mcp/shared";
import type { WaveClients } from "./client";
import type { PendingSelectionOption } from "./pending-selections";
import { logger } from "../logger";

const TAG = "[Wave][Perf]";

function debugLog(...args: unknown[]): void {
  logger.debug(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
}

/** Named Markdown component for streaming updates */
const STREAMING_COMPONENT_NAME = "reply_content";

/** Wave card body safe limit in bytes (leave headroom for JSON structure) */
const CARD_BODY_SAFE_BYTES = 24_000;
const CARD_JSON_OVERHEAD = 500;
const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";
const THINK_MARKDOWN_PREFIX = '*<font color="comment">';
const THINK_MARKDOWN_SUFFIX = "</font>*";

// ── Card Building ────────────────────────────────────────────────────────────

function formatWaveReplyText(text: string): string {
  if (!text.includes("<think")) return text;

  let formatted = "";
  let cursor = 0;
  let inThinkBlock = false;

  while (cursor < text.length) {
    const nextOpen = text.indexOf(THINK_OPEN_TAG, cursor);
    const nextClose = text.indexOf(THINK_CLOSE_TAG, cursor);

    if (!inThinkBlock) {
      if (nextOpen === -1 && nextClose === -1) {
        formatted += text.slice(cursor);
        break;
      }

      if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
        formatted += text.slice(cursor, nextClose);
        cursor = nextClose + THINK_CLOSE_TAG.length;
        continue;
      }

      formatted += text.slice(cursor, nextOpen);
      formatted += THINK_MARKDOWN_PREFIX;
      cursor = nextOpen + THINK_OPEN_TAG.length;
      inThinkBlock = true;
      continue;
    }

    if (nextClose === -1 && nextOpen === -1) {
      formatted += text.slice(cursor);
      break;
    }

    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      formatted += text.slice(cursor, nextOpen);
      cursor = nextOpen + THINK_OPEN_TAG.length;
      continue;
    }

    formatted += text.slice(cursor, nextClose);
    formatted += THINK_MARKDOWN_SUFFIX;
    cursor = nextClose + THINK_CLOSE_TAG.length;
    inThinkBlock = false;
  }

  if (inThinkBlock) {
    formatted += THINK_MARKDOWN_SUFFIX;
  }

  return formatted;
}

export function buildReplyCardContent(
  text: string,
  opts?: { streaming?: boolean; streamingMode?: boolean; appendElements?: Card[] },
): MsgCard["content"] {
  const formattedText = formatWaveReplyText(text);
  const elements: Card[] = [
    {
      tag: CardTag.Markdown,
      text: formattedText,
      name: STREAMING_COMPONENT_NAME,
    } as Card,
  ];
  if (opts?.appendElements) {
    elements.push(...opts.appendElements);
  }
  return {
    card: {
      tag: CardTag.Column,
      elements,
    },
    ...(opts?.streaming && {
      config: {
        ...(opts?.streamingMode && { mode: "streaming" as const }),
        streaming_config: {
          component_name: STREAMING_COMPONENT_NAME,
        },
      },
    }),
  };
}

function estimateCardBytes(text: string): number {
  return Buffer.byteLength(formatWaveReplyText(text), "utf-8") + CARD_JSON_OVERHEAD;
}

/**
 * Split text into chunks that fit within the card size limit.
 */
function splitTextForCards(text: string): string[] {
  const formattedText = formatWaveReplyText(text);

  if (estimateCardBytes(formattedText) <= CARD_BODY_SAFE_BYTES) {
    return [formattedText];
  }

  const maxTextBytes = CARD_BODY_SAFE_BYTES - CARD_JSON_OVERHEAD;
  const chunks: string[] = [];
  let remaining = formattedText;

  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, "utf-8") <= maxTextBytes) {
      chunks.push(remaining);
      break;
    }

    // Find the max cut point within byte limit
    let byteLen = 0;
    let cutIndex = 0;
    for (let i = 0; i < remaining.length; i++) {
      const charBytes = Buffer.byteLength(remaining[i], "utf-8");
      if (byteLen + charBytes > maxTextBytes) break;
      byteLen += charBytes;
      cutIndex = i + 1;
    }

    // Try to break at newline (search backward up to 20%)
    const minCut = Math.floor(cutIndex * 0.8);
    let breakAt = cutIndex;
    for (let i = cutIndex - 1; i >= minCut; i--) {
      if (remaining[i] === "\n") {
        breakAt = i + 1;
        break;
      }
    }

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }

  return chunks;
}

// ── Tool Activity Display ────────────────────────────────────────────────────

/**
 * Tracked tool call activity, used to render status lines in the Wave card.
 */
export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  /** Summarised args for display */
  argsSummary: string;
  status: "running" | "complete" | "error";
  errorMessage?: string;
}

/**
 * An ordered segment of card content. Segments are rendered in order as
 * Wave card elements, preserving the natural interleaving of text and
 * tool invocations from the LLM stream.
 *
 *   - `text`  → rendered as a CardMarkdown element
 *   - `tool`  → rendered as a CardPlainText element with lines=1
 */
export type CardSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; activity: ToolActivity };

/** Tools that manage their own UI and should NOT appear as tool status lines. */
const HIDDEN_TOOL_NAMES = new Set(["userSelect", "executePlan"]);

/** Check whether a tool activity is displayable (not hidden). */
export function isDisplayableTool(toolName: string): boolean {
  return !HIDDEN_TOOL_NAMES.has(toolName);
}

/**
 * Format a single tool activity into a display string for plain_text element.
 */
function formatToolActivityText(activity: ToolActivity): string {
  const nameLabel =
    activity.toolName === "loadSkill" ? "技能装填" : activity.toolName;
  const argsLabel = activity.argsSummary ? `(${activity.argsSummary})` : "";
  const statusLabel =
    activity.status === "running"
      ? "执行中..."
      : activity.status === "complete"
        ? "完成"
        : `失败${activity.errorMessage ? `: ${activity.errorMessage}` : ""}`;

  // Let Wave handle truncation via plain_text lines=1
  return `🔧 ${nameLabel}${argsLabel} — ${statusLabel}`;
}

/**
 * Summarise tool input args into a short string for display.
 * e.g. { name: "math-skill" } → 'math-skill'
 * e.g. { expression: "2+2" } → 'expression: 2+2'
 */
export function summariseToolArgs(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";

  // For loadSkill, just show the skill name
  if (toolName === "loadSkill" && typeof obj.name === "string") {
    return obj.name;
  }

  // For single-key inputs, show value directly
  if (keys.length === 1) {
    return String(obj[keys[0]] ?? "");
  }

  // For multi-key inputs, show key: value pairs
  return keys
    .map((key) => {
      const val = String(obj[key] ?? "");
      return `${key}: ${val}`;
    })
    .join(", ");
}

/**
 * Check if a segments list has any displayable tool segments.
 */
export function hasDisplayableTools(segments: CardSegment[]): boolean {
  return segments.some(
    (s) => s.kind === "tool" && isDisplayableTool(s.activity.toolName),
  );
}

/**
 * Build a card from ordered segments, preserving the interleaving of
 * text and tool invocations from the LLM stream.
 *
 * Each segment becomes a Wave card element in order:
 *   - `text` segments  → CardMarkdown
 *   - `tool` segments  → CardPlainText with lines=1
 *
 * The LAST text segment carries the `name` attribute used by the
 * streaming API so that live text updates target the correct element.
 *
 * If there are no displayable tool segments, falls back to the
 * standard single-markdown card layout.
 */
export function buildReplyCardFromSegments(
  segments: CardSegment[],
  opts?: { streaming?: boolean; streamingMode?: boolean; appendElements?: Card[] },
): MsgCard["content"] {
  // Filter out hidden tools but keep text segments as-is
  const visible = segments.filter(
    (s) => s.kind === "text" || isDisplayableTool(s.activity.toolName),
  );

  // No displayable tool segments? Fall back to plain markdown card
  const hasTools = visible.some((s) => s.kind === "tool");
  if (!hasTools) {
    const fullText = visible
      .filter((s): s is Extract<CardSegment, { kind: "text" }> => s.kind === "text")
      .map((s) => s.text)
      .join("");
    return buildReplyCardContent(fullText || "...", opts);
  }

  const elements: Card[] = [];

  // Find the index of the last text segment (it gets the streaming name)
  let lastTextIdx = -1;
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].kind === "text") {
      lastTextIdx = i;
      break;
    }
  }

  for (let i = 0; i < visible.length; i++) {
    const seg = visible[i];
    if (seg.kind === "tool") {
      elements.push(
        cardPlainText(formatToolActivityText(seg.activity), { lines: 1 }),
      );
    } else {
      const formatted = formatWaveReplyText(seg.text || "...");
      const isLast = i === lastTextIdx;
      elements.push({
        tag: CardTag.Markdown,
        text: formatted,
        ...(isLast ? { name: STREAMING_COMPONENT_NAME } : {}),
      } as Card);
    }
  }

  // If there are no text segments at all, add a placeholder
  if (lastTextIdx === -1) {
    elements.push({
      tag: CardTag.Markdown,
      text: "...",
      name: STREAMING_COMPONENT_NAME,
    } as Card);
  }

  if (opts?.appendElements) {
    elements.push(...opts.appendElements);
  }

  return {
    card: {
      tag: CardTag.Column,
      elements,
    },
    ...(opts?.streaming && {
      config: {
        ...(opts?.streamingMode && { mode: "streaming" as const }),
        streaming_config: {
          component_name: STREAMING_COMPONENT_NAME,
        },
      },
    }),
  };
}

// ── Streaming Response Sender ────────────────────────────────────────────────

export interface StreamingCardState {
  /** The reply card's message ID */
  cardMessageId: string;
  /** Streaming session ID (from enable streaming mode) */
  streamingId: string;
  /** Accumulated response text */
  accumulatedText: string;
  /** Monotonically increasing sequence number for streaming updates */
  sequence: number;
  /** Whether streaming mode is currently active */
  streamingEnabled: boolean;
  /** Whether we've fallen back to full card updates */
  fallbackToCardUpdate: boolean;
}

/**
 * Send the initial reply card for a streaming response.
 *
 * @returns The message ID of the reply card
 */
export async function sendInitialReplyCard(
  clients: WaveClients,
  replyToMessageId: string,
  initialText: string,
): Promise<string> {
  const card = buildReplyCardContent(initialText, { streaming: true });
  const t0 = Date.now();
  try {
    const result = await clients.msg.reply(replyToMessageId, msgCard(card));
    debugLog(`${TAG} msg.reply (initial card): ${Date.now() - t0}ms`);
    return result?.msg_id ?? "";
  } catch (err) {
    logger.error(`${TAG} msg.reply (initial card) FAILED after ${Date.now() - t0}ms:`, err);
    throw err;
  }
}

/**
 * Send the initial card as a new message (not a reply) for a streaming response.
 *
 * Used when the AI response should appear as a standalone message (e.g. when
 * triggered by post-executePlan action buttons).
 *
 * @returns The message ID of the new card
 */
export async function sendInitialNewMessageCard(
  clients: WaveClients,
  chatId: string,
  initialText: string,
): Promise<string> {
  const card = buildReplyCardContent(initialText, { streaming: true });
  const t0 = Date.now();
  try {
    const result = await clients.msg.send(chatId, msgCard(card));
    debugLog(`${TAG} msg.send (initial card): ${Date.now() - t0}ms`);
    return result?.msg_id ?? "";
  } catch (err) {
    logger.error(`${TAG} msg.send (initial card) FAILED after ${Date.now() - t0}ms:`, err);
    throw err;
  }
}

/**
 * Enable streaming mode on a card.
 */
export async function enableStreaming(
  clients: WaveClients,
  state: StreamingCardState,
): Promise<void> {
  const t0 = Date.now();
  try {
    const result = await clients.msg.updateCardMode(state.cardMessageId, {
      name: STREAMING_COMPONENT_NAME,
      sequence: state.sequence++,
      mode: "streaming",
      content: JSON.stringify(
        buildReplyCardContent(state.accumulatedText, { streaming: true, streamingMode: true }),
      ),
    }) as { streaming_id?: string };

    state.streamingId = result?.streaming_id ?? "";
    state.streamingEnabled = true;
    debugLog(`${TAG} msg.updateCardMode (enable streaming): ${Date.now() - t0}ms`);
  } catch (err) {
    logger.error(`${TAG} msg.updateCardMode (enable streaming) FAILED after ${Date.now() - t0}ms:`, err);
    state.fallbackToCardUpdate = true;
  }
}

/**
 * Send a streaming text update.
 */
export async function updateStreamingText(
  clients: WaveClients,
  state: StreamingCardState,
  text: string,
): Promise<void> {
  state.accumulatedText = text;
  const formattedText = formatWaveReplyText(text);

  if (!state.cardMessageId) return;

  if (state.fallbackToCardUpdate) {
    // Fallback: full card update
    const t0 = Date.now();
    try {
      const safeText =
        estimateCardBytes(formattedText) > CARD_BODY_SAFE_BYTES
          ? formattedText.slice(0, Math.floor((CARD_BODY_SAFE_BYTES - CARD_JSON_OVERHEAD) * formattedText.length / Buffer.byteLength(formattedText, "utf-8")))
          : formattedText;
      await clients.msg.updateCardActively(
        state.cardMessageId,
        buildReplyCardContent(safeText),
      );
      debugLog(`${TAG} msg.updateCardActively (fallback): ${Date.now() - t0}ms`);
    } catch (err) {
      logger.error(`${TAG} msg.updateCardActively (fallback) FAILED after ${Date.now() - t0}ms:`, err);
    }
    return;
  }

  // First update: enable streaming mode
  if (!state.streamingEnabled) {
    await enableStreaming(clients, state);
    if (state.fallbackToCardUpdate) {
      // enableStreaming failed, retry as fallback
      await updateStreamingText(clients, state, text);
      return;
    }
  }

  // Subsequent updates: streaming API
  if (state.streamingId) {
    const t0 = Date.now();
    try {
      await clients.msg.updateCardStreamingActively(
        state.cardMessageId,
        state.streamingId,
        formattedText,
        state.sequence++,
      );
      // Only log slow streaming updates (>200ms) to avoid noise
      const dur = Date.now() - t0;
      if (dur > 200) {
        debugLog(`${TAG} msg.updateCardStreamingActively: ${dur}ms (SLOW)`);
      }
    } catch (err) {
      logger.error(`${TAG} msg.updateCardStreamingActively FAILED after ${Date.now() - t0}ms:`, err);
      state.streamingEnabled = false;
      state.streamingId = "";
      state.fallbackToCardUpdate = true;
      // Retry as fallback
      const t1 = Date.now();
      try {
        await clients.msg.updateCardActively(
          state.cardMessageId,
          buildReplyCardContent(formattedText),
        );
        debugLog(`${TAG} msg.updateCardActively (retry fallback): ${Date.now() - t1}ms`);
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Update the card with tool status lines and the current markdown text.
 *
 * Uses `updateCardActively` (full card replacement) to add/update the
 * plain_text tool status elements. This is called when a tool event
 * occurs (tool-call start, tool-result, tool-error).
 *
 * IMPORTANT: The Wave API does not allow `updateCardActively` while
 * streaming mode is active (retcode 10401200 "卡片模式异常"). When a
 * tool event arrives mid-stream, we must first disable streaming mode
 * before switching to full card updates. Once switched, we stay on
 * full card updates for the remainder of this response.
 */
export async function updateCardFromSegments(
  clients: WaveClients,
  state: StreamingCardState,
  segments: CardSegment[],
): Promise<void> {
  if (!state.cardMessageId) return;

  // If streaming mode is active, disable it first — updateCardActively
  // cannot be used while the card is in streaming mode.
  if (state.streamingEnabled) {
    const tMode = Date.now();
    try {
      await clients.msg.updateCardMode(state.cardMessageId, {
        name: STREAMING_COMPONENT_NAME,
        sequence: state.sequence++,
        mode: "normal",
        content: JSON.stringify(
          buildReplyCardFromSegments(segments),
        ),
      });
      debugLog(`${TAG} msg.updateCardMode (disable for tool status): ${Date.now() - tMode}ms`);
    } catch (err) {
      debugLog(`${TAG} msg.updateCardMode (disable for tool status) FAILED after ${Date.now() - tMode}ms:`, err);
    }
    state.streamingEnabled = false;
    state.streamingId = "";
    // Mark as fallback so subsequent text-delta updates also use
    // updateCardActively instead of trying to re-enable streaming.
    state.fallbackToCardUpdate = true;
    return; // The updateCardMode content already contains the latest state
  }

  const t0 = Date.now();
  try {
    const content = buildReplyCardFromSegments(segments);
    await clients.msg.updateCardActively(state.cardMessageId, content);
    const dur = Date.now() - t0;
    if (dur > 200) {
      debugLog(`${TAG} msg.updateCardActively (tool status): ${dur}ms (SLOW)`);
    }
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (tool status) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
  }
}

/**
 * Finalize a card that includes tool status lines.
 *
 * Similar to `finalizeReplyCard` but preserves the tool status
 * plain_text elements in the final card layout. Handles content
 * splitting the same way.
 *
 * @param appendElements - Optional extra Card elements to append at the bottom
 *                         of the LAST card (e.g. post-executePlan action buttons).
 */
export async function finalizeReplyCardFromSegments(
  clients: WaveClients,
  state: StreamingCardState,
  chatId: string,
  segments: CardSegment[],
  appendElements?: Card[],
): Promise<void> {
  if (!state.cardMessageId) return;

  const hasContent =
    segments.some((s) => s.kind === "text" && s.text.trim()) ||
    segments.some((s) => s.kind === "tool" && isDisplayableTool(s.activity.toolName));

  if (!hasContent) {
    // No content and no tools — recall the empty card
    const t0 = Date.now();
    try {
      await clients.msg.recall(state.cardMessageId);
      debugLog(`${TAG} msg.recall (empty card): ${Date.now() - t0}ms`);
    } catch {
      // best effort
    }
    return;
  }

  // Disable streaming mode if it was enabled
  if (state.streamingEnabled) {
    const t0 = Date.now();
    try {
      await clients.msg.updateCardMode(state.cardMessageId, {
        name: STREAMING_COMPONENT_NAME,
        sequence: state.sequence++,
        mode: "normal",
        content: JSON.stringify(
          buildReplyCardFromSegments(segments),
        ),
      });
      debugLog(`${TAG} msg.updateCardMode (disable streaming): ${Date.now() - t0}ms`);
    } catch (err) {
      logger.error(`${TAG} msg.updateCardMode (disable streaming) FAILED after ${Date.now() - t0}ms:`, err);
    }
  }

  // For the final card, we can't easily split segments across multiple
  // cards, so we just use the full segments in the first card.
  // If the accumulated text is very long, split for continuation messages.
  const fullText = segments
    .filter((s): s is Extract<CardSegment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("");
  const chunks = splitTextForCards(fullText);

  // First chunk: render the full segments card (append buttons only if single chunk)
  const isOnlyChunk = chunks.length === 1;
  const t1 = Date.now();
  try {
    await clients.msg.updateCardActively(
      state.cardMessageId,
      buildReplyCardFromSegments(segments, {
        appendElements: isOnlyChunk ? appendElements : undefined,
      }),
    );
    debugLog(`${TAG} msg.updateCardActively (final with tools): ${Date.now() - t1}ms (chunks=${chunks.length})`);
  } catch (err) {
    logger.error(`${TAG} msg.updateCardActively (final with tools) FAILED after ${Date.now() - t1}ms:`, err);
  }

  // Remaining chunks as new messages (markdown only, no tool status)
  for (let i = 1; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const t2 = Date.now();
    try {
      if (isLast && appendElements?.length) {
        // Last continuation chunk: send as card with appended elements
        await clients.msg.send(
          chatId,
          msgCard(buildReplyCardContent(chunks[i], { appendElements })),
        );
      } else {
        await clients.msg.send(chatId, msgMarkdown(chunks[i]));
      }
      debugLog(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}): ${Date.now() - t2}ms`);
    } catch (err) {
      logger.error(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}) FAILED after ${Date.now() - t2}ms:`, err);
    }
  }
}

/**
 * Finalize the reply card: disable streaming mode and ensure final content.
 * Splits into multiple messages if content exceeds card size limit.
 *
 * @param appendElements - Optional extra Card elements to append at the bottom
 *                         of the LAST card (e.g. post-executePlan action buttons).
 */
export async function finalizeReplyCard(
  clients: WaveClients,
  state: StreamingCardState,
  chatId: string,
  appendElements?: Card[],
): Promise<void> {
  if (!state.cardMessageId) return;

  if (!state.accumulatedText.trim()) {
    // No content — recall the empty card
    const t0 = Date.now();
    try {
      await clients.msg.recall(state.cardMessageId);
      debugLog(`${TAG} msg.recall (empty card): ${Date.now() - t0}ms`);
    } catch {
      // best effort
    }
    return;
  }

  // Disable streaming mode
  if (state.streamingEnabled) {
    const t0 = Date.now();
    try {
      await clients.msg.updateCardMode(state.cardMessageId, {
        name: STREAMING_COMPONENT_NAME,
        sequence: state.sequence++,
        mode: "normal",
        content: JSON.stringify(
          buildReplyCardContent(state.accumulatedText),
        ),
      });
      debugLog(`${TAG} msg.updateCardMode (disable streaming): ${Date.now() - t0}ms`);
    } catch (err) {
      logger.error(`${TAG} msg.updateCardMode (disable streaming) FAILED after ${Date.now() - t0}ms:`, err);
    }
  }

  // Split content and update
  const chunks = splitTextForCards(state.accumulatedText);

  // First chunk goes into the existing card (append buttons only to last chunk)
  const isOnlyChunk = chunks.length === 1;
  const t1 = Date.now();
  try {
    await clients.msg.updateCardActively(
      state.cardMessageId,
      buildReplyCardContent(chunks[0], {
        appendElements: isOnlyChunk ? appendElements : undefined,
      }),
    );
    debugLog(`${TAG} msg.updateCardActively (final): ${Date.now() - t1}ms (chunks=${chunks.length})`);
  } catch (err) {
    logger.error(`${TAG} msg.updateCardActively (final) FAILED after ${Date.now() - t1}ms:`, err);
  }

  // Remaining chunks as new messages
  for (let i = 1; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const t2 = Date.now();
    try {
      if (isLast && appendElements?.length) {
        // Last continuation chunk: send as card with appended elements
        await clients.msg.send(
          chatId,
          msgCard(buildReplyCardContent(chunks[i], { appendElements })),
        );
      } else {
        await clients.msg.send(chatId, msgMarkdown(chunks[i]));
      }
      debugLog(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}): ${Date.now() - t2}ms`);
    } catch (err) {
      logger.error(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}) FAILED after ${Date.now() - t2}ms:`, err);
    }
  }
}

/**
 * Send a simple non-streaming markdown reply.
 */
export async function sendSimpleReply(
  clients: WaveClients,
  replyToMessageId: string,
  text: string,
): Promise<void> {
  const t0 = Date.now();
  await clients.msg.reply(replyToMessageId, msgMarkdown(formatWaveReplyText(text)));
  debugLog(`${TAG} msg.reply (simple): ${Date.now() - t0}ms`);
}

/**
 * Send a simple non-streaming markdown message (not a reply).
 *
 * Used when the AI response should appear as a standalone message.
 */
export async function sendSimpleNewMessage(
  clients: WaveClients,
  chatId: string,
  text: string,
): Promise<void> {
  const t0 = Date.now();
  await clients.msg.send(chatId, msgMarkdown(formatWaveReplyText(text)));
  debugLog(`${TAG} msg.send (simple): ${Date.now() - t0}ms`);
}

// ── Interactive User-Select Card ─────────────────────────────────────────────

/** Max options count rendered as inline buttons. Above this threshold, use dropdown. */
const BUTTON_THRESHOLD = 3;

type ExecutePlanStep = {
  functionId: string;
  title: string;
  arguments: Record<string, any>;
};

type ExecutePlanResult = {
  totalSteps?: number;
  completedSteps?: number;
  results?: Array<{
    stepIndex: number;
    title: string;
    functionId: string;
    status:
      | typeof FLOW_STEP_STATUS.SUCCESS
      | typeof FLOW_STEP_STATUS.FAILED;
    result?: unknown;
    error?: string;
  }>;
};

function formatExecutePlanCodeBlock(value: unknown): string {
  if (typeof value === "string") {
    return `\`\`\`\n${value}\n\`\`\``;
  }

  const json = JSON.stringify(value ?? {}, null, 2);
  return `\`\`\`json\n${json}\n\`\`\``;
}

function buildExecutePlanMarkdown(
  intent: string,
  steps: ExecutePlanStep[],
  result?: ExecutePlanResult,
  statusNote?: string,
): string {
  const lines: string[] = [`**目标**`, intent];

  if (statusNote) {
    lines.push("", statusNote);
  }

  lines.push("", `**步骤 (${steps.length})**`);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepResult = result?.results?.find((entry) => entry.stepIndex === i);
    const statusPrefix =
      stepResult?.status === FLOW_STEP_STATUS.SUCCESS
        ? "已完成"
        : stepResult?.status === FLOW_STEP_STATUS.FAILED
          ? "失败"
          : "待执行";

    lines.push(
      `${i + 1}. ${step.title}`,
      `   - 工具: \`${step.functionId}\``,
      `   - 参数:`,
      formatExecutePlanCodeBlock(step.arguments),
      `   - 状态: ${statusPrefix}`,
    );

    if (stepResult?.result !== undefined) {
      lines.push("   - 输出:", formatExecutePlanCodeBlock(stepResult.result));
    }

    if (stepResult?.error) {
      lines.push("   - 错误:", formatExecutePlanCodeBlock(stepResult.error));
    }
  }

  if (result) {
    lines.push(
      "",
      `**执行结果**`,
      `已完成 ${result.completedSteps ?? 0}/${result.totalSteps ?? steps.length} 步`,
    );
  }

  return lines.join("\n");
}

/**
 * Build a card with interactive buttons for user selection (≤3 options).
 *
 * Layout:
 *   header  (info template, shows the prompt message)
 *   flow    [Button] [Button] [Button]
 */
function buildButtonSelectCard(
  message: string,
  options: PendingSelectionOption[],
): MsgCard["content"] {
  const buttons: Card[] = options.map((opt, i) =>
    cardButton(
      opt.label || String(opt.value),
      cardOptionValue(String(opt.value), opt.label || String(opt.value)),
      // First option gets primary style to hint the "default" choice
      { style: i === 0 ? "primary" : "default" },
    ),
  );

  return {
    header: cardHeader(message, "info"),
    card: cardFlow(buttons),
  };
}

/**
 * Build a card with a dropdown for user selection (>3 options).
 *
 * Uses the dropdown component structure matching the Wave card spec:
 *   header   (info template, shows the prompt message)
 *   dropdown with value options
 */
function buildDropdownSelectCard(
  message: string,
  options: PendingSelectionOption[],
): MsgCard["content"] {
  const dropdownOptions: CardOption[] = options.map((opt) =>
    cardOptionValue(String(opt.value), opt.label || String(opt.value)),
  );

  return {
    header: cardHeader(message, "info"),
    card: cardDropdown("请选择", dropdownOptions),
  };
}

/**
 * Build a "selection confirmed" card shown after the user clicks an option.
 */
function buildSelectionConfirmedCard(
  message: string,
  selectedLabel: string,
): MsgCard["content"] {
  return {
    header: cardHeader(message, "success"),
    card: cardColumn([
      cardMarkdown(`已选择: **${selectedLabel}**`),
    ]),
  };
}

function buildExecutePlanCard(
  intent: string,
  steps: ExecutePlanStep[],
): MsgCard["content"] {
  return {
    header: cardHeader("待审批执行计划", "info"),
    card: cardColumn([
      cardMarkdown(buildExecutePlanMarkdown(intent, steps)),
      cardFlow([
        cardButton(
          "拒绝",
          cardOptionValue("deny", "拒绝"),
          { style: "default" },
        ),
        cardButton(
          "批准并执行",
          cardOptionValue("approve", "批准并执行"),
          { style: "primary" },
        ),
      ]),
    ]),
  };
}

function buildExecutePlanDecisionCard(
  intent: string,
  steps: ExecutePlanStep[],
  decision: "approved" | "denied" | "expired",
  reason?: string,
): MsgCard["content"] {
  const template =
    decision === "approved"
      ? "success"
      : decision === "denied"
        ? "warning"
        : "warning";
  const title =
    decision === "approved"
      ? "执行计划已批准"
      : decision === "denied"
        ? "执行计划已拒绝"
        : "执行计划已过期";
  const note =
    decision === "approved"
      ? "_正在执行已批准的步骤..._"
      : decision === "denied"
        ? `_${reason || "用户拒绝了本次执行。"}_`
        : `_${reason || "该执行计划审批已失效，请重新发送消息。"}_`;

  return {
    header: cardHeader(title, template),
    card: cardColumn([
      cardMarkdown(buildExecutePlanMarkdown(intent, steps, undefined, note)),
    ]),
  };
}

function buildExecutePlanResultContent(
  intent: string,
  steps: ExecutePlanStep[],
  result: ExecutePlanResult,
): MsgCard["content"] {
  const failed = result.results?.some(
    (entry) => entry.status === FLOW_STEP_STATUS.FAILED,
  );
  const title = failed ? "执行计划执行失败" : "执行计划执行完成";
  const template = failed ? "warning" : "success";

  return {
    header: cardHeader(title, template),
    card: cardColumn([
      cardMarkdown(buildExecutePlanMarkdown(intent, steps, result)),
    ]),
  };
}

/**
 * Send an interactive user-select card (buttons or dropdown).
 *
 * @param clients   - Wave SDK clients
 * @param chatId    - The chat/receiver ID to send to
 * @param message   - Prompt text shown to the user
 * @param options   - Selection options
 * @returns The message ID of the sent card (used to correlate with the callback)
 */
export async function sendUserSelectCard(
  clients: WaveClients,
  chatId: string,
  message: string,
  options: PendingSelectionOption[],
): Promise<string> {
  const content =
    options.length <= BUTTON_THRESHOLD
      ? buildButtonSelectCard(message, options)
      : buildDropdownSelectCard(message, options);

  const t0 = Date.now();
  try {
    const result = await clients.msg.send(chatId, msgCard(content));
    debugLog(
      `${TAG} msg.send (userSelect card, ${options.length <= BUTTON_THRESHOLD ? "buttons" : "dropdown"}): ${Date.now() - t0}ms`,
    );
    return result?.msg_id ?? "";
  } catch (err) {
    logger.error(
      `${TAG} msg.send (userSelect card) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    throw err;
  }
}

export async function sendExecutePlanCard(
  clients: WaveClients,
  chatId: string,
  intent: string,
  steps: ExecutePlanStep[],
): Promise<string> {
  const t0 = Date.now();
  try {
    const result = await clients.msg.send(
      chatId,
      msgCard(buildExecutePlanCard(intent, steps)),
    );
    debugLog(`${TAG} msg.send (executePlan card): ${Date.now() - t0}ms`);
    return result?.msg_id ?? "";
  } catch (err) {
    logger.error(
      `${TAG} msg.send (executePlan card) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    return "";
  }
}

export async function updateExecutePlanDecisionCard(
  clients: WaveClients,
  cardMessageId: string,
  intent: string,
  steps: ExecutePlanStep[],
  decision: "approved" | "denied" | "expired",
  reason?: string,
): Promise<void> {
  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(
      cardMessageId,
      buildExecutePlanDecisionCard(intent, steps, decision, reason),
    );
    debugLog(
      `${TAG} msg.updateCardActively (executePlan ${decision}): ${Date.now() - t0}ms`,
    );
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (executePlan ${decision}) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
  }
}

export async function updateExecutePlanResultCard(
  clients: WaveClients,
  cardMessageId: string,
  intent: string,
  steps: ExecutePlanStep[],
  result: ExecutePlanResult,
): Promise<void> {
  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(
      cardMessageId,
      buildExecutePlanResultContent(intent, steps, result),
    );
    debugLog(
      `${TAG} msg.updateCardActively (executePlan result): ${Date.now() - t0}ms`,
    );
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (executePlan result) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
  }
}

/**
 * Update the interactive card after the user makes a selection.
 *
 * Replaces the buttons/dropdown with a confirmation showing the selected option.
 *
 * Uses `updateCardActively` (by message ID) instead of `updateCard` (by token)
 * because the token-based endpoint has issues with `receiver_id_type` validation
 * in DM contexts.
 *
 * @param clients        - Wave SDK clients
 * @param cardMessageId  - The `open_msg_id` from the `EventMsgCardReaction` event
 * @param message        - Original prompt text
 * @param selectedLabel  - The label of the selected option
 */
export async function updateCardAfterSelection(
  clients: WaveClients,
  cardMessageId: string,
  message: string,
  selectedLabel: string,
): Promise<void> {
  const content = buildSelectionConfirmedCard(message, selectedLabel);
  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(cardMessageId, content);
    debugLog(`${TAG} msg.updateCardActively (selection confirmed): ${Date.now() - t0}ms`);
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (selection confirmed) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    // Non-fatal — the selection was already resolved
  }
}

/**
 * Update an interactive card to show that the selection has expired.
 *
 * Used when:
 *   - The server restarted and the pending selection was lost
 *   - The user's previous stream was aborted (new message sent)
 *   - The 1-hour safety timeout fired
 *
 * Uses `updateCardActively` (by message ID) instead of `updateCard` (by token)
 * because the token-based endpoint has issues with `receiver_id_type` validation
 * in DM contexts.
 *
 * @param clients        - Wave SDK clients
 * @param cardMessageId  - The `open_msg_id` from the `EventMsgCardReaction` event
 */
export async function updateCardAsExpired(
  clients: WaveClients,
  cardMessageId: string,
  opts?: {
    title?: string;
    body?: string;
  },
): Promise<void> {
  const content = {
    header: cardHeader(opts?.title || "选择已过期", "warning"),
    card: cardColumn([
      cardMarkdown(opts?.body || "该选择已失效，请重新发送消息。"),
    ]),
  };
  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(cardMessageId, content);
    debugLog(`${TAG} msg.updateCardActively (selection expired): ${Date.now() - t0}ms`);
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (selection expired) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    // Non-fatal
  }
}

// ── Post-ExecutePlan Action Card ─────────────────────────────────────────────

/**
 * Build the post-executePlan action button flow element.
 *
 * Returns a `cardFlow` element containing "总结当前会话" and "开启新会话"
 * buttons. This can be appended to an existing card's elements array
 * (e.g. the final LLM response card) so the buttons appear at the bottom
 * of the same message instead of as a separate card.
 */
export function buildPostPlanActionFlow(): Card {
  return cardFlow([
    cardButton(
      "开启新会话",
      cardOptionValue("new_session", "开启新会话"),
      { style: "primary" },
    ),
    cardButton(
      "总结当前会话",
      cardOptionValue("summarize_session", "总结当前会话"),
      { style: "default" },
    ),
  ]);
}

/**
 * Send a card with a task summary and follow-up action buttons after a
 * successful executePlan.
 *
 * Layout:
 *   header    (success template, "执行完成")
 *   markdown  task summary + prompt for next action
 *   flow      [总结当前会话] [开启新会话]
 *
 * @param clients        - Wave SDK clients
 * @param chatId         - The chat/receiver ID to send to
 * @param intent         - The plan intent description (what was accomplished)
 * @param completedSteps - Number of successfully completed steps
 * @returns The message ID of the sent card
 */
export async function sendPostExecutePlanActionsCard(
  clients: WaveClients,
  chatId: string,
  intent: string,
  completedSteps: number,
): Promise<string> {
  const summaryText =
    `**${intent}**\n` +
    `已成功执行 ${completedSteps} 个步骤。你可以选择：\n` +
    `- **总结当前会话** — 生成本次会话的内容摘要\n` +
    `- **开启新会话** — 清除历史记录，开始全新对话`;

  const content = {
    header: cardHeader("执行完成", "success"),
    card: cardColumn([
      cardMarkdown(summaryText),
      cardFlow([
        cardButton(
          "总结当前会话",
          cardOptionValue("summarize_session", "总结当前会话"),
          { style: "primary" },
        ),
        cardButton(
          "开启新会话",
          cardOptionValue("new_session", "开启新会话"),
          { style: "default" },
        ),
      ]),
    ]),
  };

  const t0 = Date.now();
  try {
    const result = await clients.msg.send(chatId, msgCard(content));
    debugLog(`${TAG} msg.send (post-executePlan actions card): ${Date.now() - t0}ms`);
    return result?.msg_id ?? "";
  } catch (err) {
    logger.error(
      `${TAG} msg.send (post-executePlan actions card) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    return "";
  }
}

/**
 * Update the post-executePlan actions card after the user clicks a button.
 *
 * Replaces the buttons with a confirmation message.
 */
export async function updatePostExecutePlanActionsCard(
  clients: WaveClients,
  cardMessageId: string,
  selectedLabel: string,
): Promise<void> {
  const content = {
    header: cardHeader("执行完成", "success"),
    card: cardColumn([
      cardMarkdown(`已选择: **${selectedLabel}**`),
    ]),
  };
  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(cardMessageId, content);
    debugLog(`${TAG} msg.updateCardActively (post-executePlan action confirmed): ${Date.now() - t0}ms`);
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (post-executePlan action confirmed) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    // Non-fatal
  }
}

/**
 * Update an embedded post-plan actions card after the user clicks a button.
 *
 * When action buttons are embedded in an LLM response card, we must
 * preserve the LLM text while replacing the button flow with a
 * confirmation line. This function takes the original card content
 * (stored when the card was finalized), replaces the last `flow`
 * element (the action buttons) with a confirmation markdown, and
 * updates the card.
 *
 * @param clients         - Wave SDK clients
 * @param cardMessageId   - The card's message ID
 * @param selectedLabel   - The label of the selected action
 * @param originalContent - The card content at finalization time
 */
export async function updateEmbeddedPostPlanCard(
  clients: WaveClients,
  cardMessageId: string,
  selectedLabel: string,
  originalContent: MsgCard["content"],
): Promise<void> {
  // Deep clone to avoid mutating the stored content
  const content = JSON.parse(JSON.stringify(originalContent)) as MsgCard["content"];

  // Replace the last flow element (action buttons) with a confirmation line
  const elements = (content as any)?.card?.elements;
  if (Array.isArray(elements) && elements.length > 0) {
    const lastIdx = elements.length - 1;
    if (elements[lastIdx]?.tag === "flow") {
      elements[lastIdx] = cardMarkdown(`已选择: **${selectedLabel}**`);
    }
  }

  const t0 = Date.now();
  try {
    await clients.msg.updateCardActively(cardMessageId, content);
    debugLog(`${TAG} msg.updateCardActively (embedded post-plan action confirmed): ${Date.now() - t0}ms`);
  } catch (err) {
    logger.error(
      `${TAG} msg.updateCardActively (embedded post-plan action confirmed) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    // Non-fatal
  }
}
