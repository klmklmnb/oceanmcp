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
  type MsgCard,
} from "@mihoyo/wave-opensdk";
import type { WaveClients } from "./client";

const TAG = "[Wave][Perf]";

function debugLog(...args: unknown[]): void {
  if (process.env.DEBUG === "true") console.log(...args);
}

/** Named Markdown component for streaming updates */
const STREAMING_COMPONENT_NAME = "reply_content";

/** Wave card body safe limit in bytes (leave headroom for JSON structure) */
const CARD_BODY_SAFE_BYTES = 24_000;
const CARD_JSON_OVERHEAD = 500;

// ── Card Building ────────────────────────────────────────────────────────────

function buildReplyCardContent(
  text: string,
  opts?: { streaming?: boolean; streamingMode?: boolean },
): MsgCard["content"] {
  return {
    card: {
      tag: CardTag.Column,
      elements: [
        {
          tag: CardTag.Markdown,
          text,
          name: STREAMING_COMPONENT_NAME,
        },
      ],
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
  return Buffer.byteLength(text, "utf-8") + CARD_JSON_OVERHEAD;
}

/**
 * Split text into chunks that fit within the card size limit.
 */
function splitTextForCards(text: string): string[] {
  if (estimateCardBytes(text) <= CARD_BODY_SAFE_BYTES) {
    return [text];
  }

  const maxTextBytes = CARD_BODY_SAFE_BYTES - CARD_JSON_OVERHEAD;
  const chunks: string[] = [];
  let remaining = text;

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
    console.error(`${TAG} msg.reply (initial card) FAILED after ${Date.now() - t0}ms:`, err);
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
    console.error(`${TAG} msg.updateCardMode (enable streaming) FAILED after ${Date.now() - t0}ms:`, err);
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

  if (!state.cardMessageId) return;

  if (state.fallbackToCardUpdate) {
    // Fallback: full card update
    const t0 = Date.now();
    try {
      const safeText =
        estimateCardBytes(text) > CARD_BODY_SAFE_BYTES
          ? text.slice(0, Math.floor((CARD_BODY_SAFE_BYTES - CARD_JSON_OVERHEAD) * text.length / Buffer.byteLength(text, "utf-8")))
          : text;
      await clients.msg.updateCardActively(
        state.cardMessageId,
        buildReplyCardContent(safeText),
      );
      debugLog(`${TAG} msg.updateCardActively (fallback): ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`${TAG} msg.updateCardActively (fallback) FAILED after ${Date.now() - t0}ms:`, err);
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
        text,
        state.sequence++,
      );
      // Only log slow streaming updates (>200ms) to avoid noise
      const dur = Date.now() - t0;
      if (dur > 200) {
        debugLog(`${TAG} msg.updateCardStreamingActively: ${dur}ms (SLOW)`);
      }
    } catch (err) {
      console.error(`${TAG} msg.updateCardStreamingActively FAILED after ${Date.now() - t0}ms:`, err);
      state.streamingEnabled = false;
      state.streamingId = "";
      state.fallbackToCardUpdate = true;
      // Retry as fallback
      const t1 = Date.now();
      try {
        await clients.msg.updateCardActively(
          state.cardMessageId,
          buildReplyCardContent(text),
        );
        debugLog(`${TAG} msg.updateCardActively (retry fallback): ${Date.now() - t1}ms`);
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Finalize the reply card: disable streaming mode and ensure final content.
 * Splits into multiple messages if content exceeds card size limit.
 */
export async function finalizeReplyCard(
  clients: WaveClients,
  state: StreamingCardState,
  chatId: string,
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
      console.error(`${TAG} msg.updateCardMode (disable streaming) FAILED after ${Date.now() - t0}ms:`, err);
    }
  }

  // Split content and update
  const chunks = splitTextForCards(state.accumulatedText);

  // First chunk goes into the existing card
  const t1 = Date.now();
  try {
    await clients.msg.updateCardActively(
      state.cardMessageId,
      buildReplyCardContent(chunks[0]),
    );
    debugLog(`${TAG} msg.updateCardActively (final): ${Date.now() - t1}ms (chunks=${chunks.length})`);
  } catch (err) {
    console.error(`${TAG} msg.updateCardActively (final) FAILED after ${Date.now() - t1}ms:`, err);
  }

  // Remaining chunks as new messages
  for (let i = 1; i < chunks.length; i++) {
    const t2 = Date.now();
    try {
      await clients.msg.send(chatId, msgMarkdown(chunks[i]));
      debugLog(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}): ${Date.now() - t2}ms`);
    } catch (err) {
      console.error(`${TAG} msg.send (continuation ${i + 1}/${chunks.length}) FAILED after ${Date.now() - t2}ms:`, err);
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
  await clients.msg.reply(replyToMessageId, msgMarkdown(text));
  debugLog(`${TAG} msg.reply (simple): ${Date.now() - t0}ms`);
}
