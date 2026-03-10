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

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function formatStepArguments(args: Record<string, any>): string {
  const json = JSON.stringify(args ?? {});
  return truncateText(json, 180);
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
      `   - 参数: \`${formatStepArguments(step.arguments)}\``,
      `   - 状态: ${statusPrefix}`,
    );

    if (stepResult?.error) {
      lines.push(`   - 错误: ${truncateText(stepResult.error, 160)}`);
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
    console.error(
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
    console.error(
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
    console.error(
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
    console.error(
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
    console.error(
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
 *   - The 10-minute safety timeout fired
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
    console.error(
      `${TAG} msg.updateCardActively (selection expired) FAILED after ${Date.now() - t0}ms:`,
      err,
    );
    // Non-fatal
  }
}
