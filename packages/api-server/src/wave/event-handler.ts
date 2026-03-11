/**
 * Wave event handler — core chat flow.
 *
 * Processes incoming Wave messages through the AI pipeline:
 *   message → policy check → session lookup → skills loading →
 *   tool merging → streamText() → streaming card response
 *
 * This module is the Wave equivalent of routes/chat.ts but operates
 * in push mode (webhook-driven) rather than pull mode (HTTP request).
 */

import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { Sandbox } from "@ocean-mcp/shared";
import { getLanguageModel, resolveThinkingConfig, resolveMaxTokens, withThinkingConfig } from "../ai/providers";
import { getBasePromptContext } from "../ai/prompts";
import { buildSkillsPrompt } from "../ai/skills/loader";
import { loadSkillsFromZip } from "../ai/skills/zip-loader";
import type { DiscoveredSkill } from "../ai/skills/discover";
import type { WaveConfig } from "./config";
import { getWaveClients } from "./client";
import {
  parseWaveEvent,
  deriveSessionKey,
  type WaveEvent,
  type WaveMessageContext,
} from "./message-parser";
import { checkPolicy } from "./policy";
import { waveSessionManager } from "./session-manager";
import { buildWaveTools } from "./tools";
import { removeAllPlanApprovalsForSession } from "./pending-approvals";
import { removeAllForSession } from "./pending-selections";
import { buildAssistantStoredMessage } from "./message-history";
import { msgCard } from "@mihoyo/wave-opensdk";
import {
  sendInitialReplyCard,
  enableStreaming,
  updateStreamingText,
  updateCardFromSegments,
  finalizeReplyCard,
  finalizeReplyCardFromSegments,
  buildReplyCardFromSegments,
  sendSimpleReply,
  summariseToolArgs,
  isDisplayableTool,
  hasDisplayableTools,
  type StreamingCardState,
  type ToolActivity,
  type CardSegment,
} from "./message-sender";
import { logger } from "../logger";

// ── Debug Timing Helpers ─────────────────────────────────────────────────────

const TAG = "[Wave][Perf]";

function elapsed(startMs: number): string {
  return `${(Date.now() - startMs).toLocaleString()}ms`;
}

function debugLog(...args: unknown[]): void {
  logger.debug(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
}

const NEW_SESSION_COMMAND = "/new";
const NEW_SESSION_CONFIRMATION = "已开始新会话。";

/** Cached zip skills per URL — reuses loadSkillsFromZip's HTTP cache */
const zipSkillsCache = new Map<string, DiscoveredSkill[]>();

/**
 * Load skills from a zip URL, using an in-memory cache on top of
 * the HTTP-cache-aware loadSkillsFromZip().
 */
async function loadZipSkills(
  sandbox: Sandbox,
  url: string,
): Promise<DiscoveredSkill[]> {
  // The underlying loadSkillsFromZip already does HTTP caching (ETag,
  // Last-Modified, Cache-Control). This layer caches the DiscoveredSkill[]
  // objects in memory to avoid re-scanning the extracted directory.
  // Since loadSkillsFromZip revalidates on every call (conditional GET),
  // we let it handle freshness and just cache the result objects.
  try {
    const result = await loadSkillsFromZip(sandbox, url);
    const skills = result.skills;
    zipSkillsCache.set(url, skills);
    return skills;
  } catch (err) {
    // If loading fails but we have a cached copy, use it
    const cached = zipSkillsCache.get(url);
    if (cached) {
      logger.warn(`[Wave] Failed to load skills from ${url}, using cached: ${err}`);
      return cached;
    }
    logger.error(`[Wave] Failed to load skills from ${url}:`, err);
    return [];
  }
}

/**
 * Build the system prompt for a Wave session.
 *
 * Merges the base prompt with file-based skills and zip-loaded skills.
 */
function buildWaveSystemPrompt(
  fileSkills: DiscoveredSkill[],
  zipSkills: DiscoveredSkill[],
): string {
  const { basePrompt } = getBasePromptContext();
  const allSkills = [...fileSkills, ...zipSkills];
  // Always use Chinese for Wave (internal IM)
  return (
    basePrompt +
    buildSkillsPrompt(allSkills) +
    "\n\n请用简体中文回复用户的所有消息。" +
    "\n对于会修改数据、状态或外部系统的操作，必须调用 executePlan。" +
    "\nexecutePlan 会在 Wave 中发送可点击的审批卡片，等待用户点击批准或拒绝。" +
    "\n不要要求用户通过输入文字来确认执行计划。"
  );
}

function isNewSessionCommand(content: string): boolean {
  return content.trim() === NEW_SESSION_COMMAND;
}

export async function tryHandleWaveKeywordCommand(
  ctx: WaveMessageContext,
  clients: ReturnType<typeof getWaveClients>,
): Promise<boolean> {
  if (!isNewSessionCommand(ctx.content)) {
    return false;
  }

  const sessionKey = deriveSessionKey(ctx);
  const activeController =
    waveSessionManager.getActiveAbortController(sessionKey);
  if (activeController) {
    activeController.abort(new Error("Session reset requested by user"));
  }

  const removedSelections = removeAllForSession(
    sessionKey,
    "User started a new session",
  );
  const removedApprovals = removeAllPlanApprovalsForSession(
    sessionKey,
    "User started a new session",
  );
  await waveSessionManager.clear(sessionKey);

  debugLog(
    `${TAG} Reset session via ${NEW_SESSION_COMMAND}: key=${sessionKey}, ` +
      `selections=${removedSelections}, approvals=${removedApprovals}`,
  );

  await sendSimpleReply(clients, ctx.messageId, NEW_SESSION_CONFIRMATION);
  return true;
}

/**
 * Handle an incoming Wave message event.
 *
 * This is the main entry point called by the webhook handler.
 * It runs the full pipeline: parse → policy → skills → LLM → respond.
 */
export async function handleWaveMessage(
  event: WaveEvent,
  config: WaveConfig,
  skillsZipUrl?: string,
): Promise<void> {
  const t0 = Date.now();
  const clients = getWaveClients();

  // 1. Parse message
  const ctx = parseWaveEvent(event, config.appId);

  // Ignore empty messages
  if (!ctx.content.trim()) return;

  // Ignore messages from bots (prevent loops)
  if (ctx.senderIdType === "app_id") return;

  const reqId = ctx.messageId.slice(-8); // short ID for log correlation
  debugLog(`${TAG} [${reqId}] ── Start ── sender=${ctx.senderId.slice(-8)} chat=${ctx.chatType}`);

  // 2. Policy check
  const t1 = Date.now();
  const policy = checkPolicy(ctx, config);
  debugLog(`${TAG} [${reqId}] Policy check: ${elapsed(t1)} (allowed=${policy.allowed})`);
  if (!policy.allowed) {
    logger.debug(`[Wave] Message blocked: ${policy.reason}`);
    return;
  }

  if (await tryHandleWaveKeywordCommand(ctx, clients)) {
    debugLog(`${TAG} [${reqId}] Handled keyword command: ${ctx.content.trim()}`);
    return;
  }

  // 2.5 Resolve image_key references to public URLs
  if (ctx.imageKeys.length > 0) {
    const tImg = Date.now();
    try {
      const fileResult = await clients.file.getFilePublicUrl(ctx.imageKeys);
      debugLog(
        `${TAG} [${reqId}] Resolve image URLs: ${elapsed(tImg)} ` +
        `(keys=${ctx.imageKeys.length}, resolved=${fileResult.file_url.length}, invalid=${fileResult.invalid_file_key.length})`,
      );
      for (const entry of fileResult.file_url) {
        debugLog(`${TAG} [${reqId}] Image resolved: ${entry.file_key} → ${entry.file_url}`);
        ctx.content = ctx.content.replaceAll(`[image:${entry.file_key}]`, `[image:${entry.file_url}]`);
      }
      if (fileResult.invalid_file_key.length > 0) {
        debugLog(`${TAG} [${reqId}] Invalid image keys: ${fileResult.invalid_file_key.join(", ")}`);
      }
    } catch (err) {
      logger.warn(`${TAG} [${reqId}] Failed to resolve image URLs (${elapsed(tImg)}):`, err);
    }
  }

  // 3. Load skills from zip URL (if provided)
  const t2 = Date.now();
  const { sandbox, discoveredSkills: fileSkills } = getBasePromptContext();
  let zipSkills: DiscoveredSkill[] = [];
  if (skillsZipUrl) {
    zipSkills = await loadZipSkills(sandbox, skillsZipUrl);
  }
  debugLog(`${TAG} [${reqId}] Load skills: ${elapsed(t2)} (file=${fileSkills.length}, zip=${zipSkills.length}, url=${skillsZipUrl ? 'yes' : 'none'})`);

  // 4. Get/create session and append user message
  const t3 = Date.now();
  const sessionKey = deriveSessionKey(ctx);

  // 4a. Abort any previous active stream for this session.
  // This handles the case where the user sends a new message while a
  // userSelect is waiting — the old streamText() gets aborted and any
  // pending selections for the session are rejected.
  const previousController = waveSessionManager.getActiveAbortController(sessionKey);
  if (previousController) {
    debugLog(`${TAG} [${reqId}] Aborting previous stream for session ${sessionKey}`);
    previousController.abort(new Error("New message received, aborting previous stream"));
    const removedSelections = removeAllForSession(sessionKey, "User sent a new message");
    const removedApprovals = removeAllPlanApprovalsForSession(
      sessionKey,
      "User sent a new message",
    );
    if (removedSelections > 0 || removedApprovals > 0) {
      debugLog(
        `${TAG} [${reqId}] Rejected pending interactions for session ${sessionKey} ` +
        `(selections=${removedSelections}, approvals=${removedApprovals})`,
      );
    }
    waveSessionManager.clearActiveAbortController(sessionKey);
  }

  await waveSessionManager.addUserMessage(sessionKey, ctx.content);
  await waveSessionManager.trimHistory(sessionKey, config.historyLimit);
  const messages = await waveSessionManager.getMessages(sessionKey);
  debugLog(`${TAG} [${reqId}] Session setup: ${elapsed(t3)} (key=${sessionKey}, msgs=${messages.length})`);

  // 4b. Create a new AbortController for this stream
  const abortController = new AbortController();
  waveSessionManager.setActiveAbortController(sessionKey, abortController);

  // 5. Build tools and system prompt
  const t4 = Date.now();
  const tools = buildWaveTools(fileSkills, zipSkills, sandbox, clients, ctx.senderId, sessionKey, ctx.chatId);
  const systemPrompt = buildWaveSystemPrompt(fileSkills, zipSkills);
  debugLog(`${TAG} [${reqId}] Build tools+prompt: ${elapsed(t4)} (tools=${Object.keys(tools).length}, promptLen=${systemPrompt.length})`);

  // 6. Convert messages to model format
  //
  // StoredMessage is a serialization-friendly subset of UIMessage. The
  // parts array is structurally compatible with UIMessagePart (same field
  // names and values), but TypeScript's template literal type for tool
  // part state discriminants doesn't match our simplified union. The cast
  // is safe because convertToModelMessages reads the same fields we store.
  const t5 = Date.now();
  const modelMessages = await convertToModelMessages(messages as any);
  debugLog(`${TAG} [${reqId}] Convert messages: ${elapsed(t5)} (count=${modelMessages.length})`);

  // 7. Stream AI response
  const t6 = Date.now();
  const resolvedModel = getLanguageModel();
  const thinkingConfig = resolveThinkingConfig();
  debugLog(`${TAG} [${reqId}] Resolve model: ${elapsed(t6)} (streaming=${config.streaming})`);

  debugLog(`${TAG} [${reqId}] ── Pipeline ready ── total prep: ${elapsed(t0)}`);

  try {
    const t7 = Date.now();
    if (config.streaming) {
      await handleStreamingResponse(ctx, clients, resolvedModel, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey, reqId, abortController.signal);
    } else {
      await handleSimpleResponse(ctx, clients, resolvedModel, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey, reqId, abortController.signal);
    }
    debugLog(`${TAG} [${reqId}] ── Response complete ── response: ${elapsed(t7)}, total: ${elapsed(t0)}`);
  } catch (err) {
    // Check if this was an intentional abort (user sent a new message)
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.includes("aborting previous stream") ||
        abortController.signal.aborted);

    if (isAbort) {
      debugLog(`${TAG} [${reqId}] ── Aborted (new message) after ${elapsed(t0)} ──`);
      return; // Don't send error reply — user already moved on
    }

    logger.error(`${TAG} [${reqId}] ── Error after ${elapsed(t0)} ──`, err);
    try {
      await sendSimpleReply(
        clients,
        ctx.messageId,
        `An error occurred while processing your message. Please try again.`,
      );
    } catch {
      // best effort
    }
  } finally {
    // Clear the active controller for this session once the stream ends
    // (whether normally, by error, or by abort).
    waveSessionManager.clearActiveAbortController(sessionKey);
  }
}

/**
 * Handle a streaming card response.
 */
async function handleStreamingResponse(
  ctx: WaveMessageContext,
  clients: ReturnType<typeof getWaveClients>,
  model: ReturnType<typeof getLanguageModel>,
  systemPrompt: string,
  modelMessages: any[],
  tools: Record<string, any>,
  thinkingConfig: any,
  sessionKey: string,
  reqId: string,
  abortSignal: AbortSignal,
): Promise<void> {
  // Send initial placeholder card
  const tCard = Date.now();
  const cardMessageId = await sendInitialReplyCard(
    clients,
    ctx.messageId,
    "...",
  );
  debugLog(`${TAG} [${reqId}] Send initial card: ${elapsed(tCard)} (cardId=${cardMessageId ? cardMessageId.slice(-8) : 'NONE'})`);

  if (!cardMessageId) {
    // Fallback to non-streaming
    debugLog(`${TAG} [${reqId}] No card ID, falling back to simple response`);
    return handleSimpleResponse(ctx, clients, model, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey, reqId, abortSignal);
  }

  const state: StreamingCardState = {
    cardMessageId,
    streamingId: "",
    accumulatedText: "",
    sequence: 1,
    streamingEnabled: false,
    fallbackToCardUpdate: false,
  };

  // Start streaming
  const tLlm = Date.now();
  const result = withThinkingConfig(thinkingConfig, () =>
    streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      maxOutputTokens: resolveMaxTokens(),
      stopWhen: stepCountIs(10),
      abortSignal,
    }),
  );

  // Consume the full stream (text + tool events) and push updates to Wave
  let lastUpdateTime = 0;
  let firstTokenTime = 0;
  let updateCount = 0;
  const MIN_UPDATE_INTERVAL_MS = 300; // Throttle updates to avoid rate limits
  const segments: CardSegment[] = [];
  let hasToolCalls = false;

  /**
   * Get or create the trailing text segment. When text-delta events
   * arrive, they append to this segment. When a tool event interrupts,
   * the next text-delta will create a new text segment after the tool.
   */
  function currentTextSegment(): Extract<CardSegment, { kind: "text" }> {
    const last = segments[segments.length - 1];
    if (last && last.kind === "text") return last;
    const seg: CardSegment = { kind: "text", text: "" };
    segments.push(seg);
    return seg as Extract<CardSegment, { kind: "text" }>;
  }

  /** Get accumulated text across all text segments (for state tracking). */
  function getFullText(): string {
    return segments
      .filter((s): s is Extract<CardSegment, { kind: "text" }> => s.kind === "text")
      .map((s) => s.text)
      .join("");
  }

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        if (!part.text) break;
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          debugLog(`${TAG} [${reqId}] First token (TTFT): ${elapsed(tLlm)}`);
        }

        currentTextSegment().text += part.text;
        state.accumulatedText = getFullText();

        const now = Date.now();
        if (now - lastUpdateTime >= MIN_UPDATE_INTERVAL_MS) {
          const tUpd = Date.now();
          if (hasToolCalls) {
            await updateCardFromSegments(clients, state, segments);
          } else {
            await updateStreamingText(clients, state, state.accumulatedText);
          }
          lastUpdateTime = now;
          updateCount++;
          if (updateCount <= 3 || updateCount % 5 === 0) {
            debugLog(`${TAG} [${reqId}] Stream update #${updateCount}: ${elapsed(tUpd)} (${state.accumulatedText.length} chars)`);
          }
        }
        break;
      }

      case "tool-call": {
        hasToolCalls = true;
        const activity: ToolActivity = {
          toolCallId: (part as any).toolCallId ?? "",
          toolName: (part as any).toolName ?? "unknown",
          argsSummary: summariseToolArgs(
            (part as any).toolName ?? "unknown",
            (part as any).input,
          ),
          status: "running",
        };
        segments.push({ kind: "tool", activity });
        debugLog(`${TAG} [${reqId}] Tool call: ${activity.toolName}(${activity.argsSummary})`);

        // Immediately update card to show the tool status
        await updateCardFromSegments(clients, state, segments);
        lastUpdateTime = Date.now();
        break;
      }

      case "tool-result": {
        const callId = (part as any).toolCallId ?? "";
        const existing = segments.find(
          (s): s is Extract<CardSegment, { kind: "tool" }> =>
            s.kind === "tool" && s.activity.toolCallId === callId,
        );
        if (existing) {
          existing.activity.status = "complete";
          debugLog(`${TAG} [${reqId}] Tool result: ${existing.activity.toolName} — complete`);
        }
        // Update card to show completion
        await updateCardFromSegments(clients, state, segments);
        lastUpdateTime = Date.now();
        break;
      }

      case "tool-error": {
        const callId = (part as any).toolCallId ?? "";
        const existing = segments.find(
          (s): s is Extract<CardSegment, { kind: "tool" }> =>
            s.kind === "tool" && s.activity.toolCallId === callId,
        );
        if (existing) {
          existing.activity.status = "error";
          const errObj = (part as any).error;
          existing.activity.errorMessage =
            errObj instanceof Error
              ? errObj.message
              : typeof errObj === "string"
                ? errObj
                : "执行失败";
          debugLog(`${TAG} [${reqId}] Tool error: ${existing.activity.toolName} — ${existing.activity.errorMessage}`);
        }
        // Update card to show error
        await updateCardFromSegments(clients, state, segments);
        lastUpdateTime = Date.now();
        break;
      }

      // Skip other event types (reasoning, step boundaries, sources, etc.)
      default:
        break;
    }
  }

  const tStreamDone = Date.now();
  debugLog(`${TAG} [${reqId}] Stream complete: LLM total=${elapsed(tLlm)}, updates=${updateCount}, chars=${state.accumulatedText.length}`);

  // Final update with any remaining text
  if (state.accumulatedText) {
    const tFinalUpd = Date.now();
    if (hasToolCalls) {
      await updateCardFromSegments(clients, state, segments);
    } else {
      await updateStreamingText(clients, state, state.accumulatedText);
    }
    debugLog(`${TAG} [${reqId}] Final stream update: ${elapsed(tFinalUpd)}`);
  }

  // Finalize
  const tFinalize = Date.now();
  if (hasToolCalls) {
    await finalizeReplyCardFromSegments(clients, state, ctx.chatId, segments);
  } else {
    await finalizeReplyCard(clients, state, ctx.chatId);
  }
  debugLog(`${TAG} [${reqId}] Finalize card: ${elapsed(tFinalize)}`);

  const toolSegs = segments.filter((s): s is Extract<CardSegment, { kind: "tool" }> => s.kind === "tool");
  debugLog(
    `${TAG} [${reqId}] Tool activity: ${toolSegs.length} calls ` +
    `(${toolSegs.filter(s => s.activity.status === "complete").length} complete, ` +
    `${toolSegs.filter(s => s.activity.status === "error").length} errors)`,
  );

  // Save assistant response to session (including tool call/result parts).
  // Guard: if the session was reset (e.g. /new command) while the stream was
  // running, skip the save to avoid re-creating a cleared session with stale
  // data (image references, tool history, etc.).
  const tSave = Date.now();
  if (abortSignal.aborted) {
    debugLog(`${TAG} [${reqId}] Skipping assistant message save — session was reset`);
  } else {
    try {
      const steps = await result.steps;
      const assistantMsg = buildAssistantStoredMessage(steps);
      if (assistantMsg) {
        await waveSessionManager.addAssistantMessage(sessionKey, assistantMsg);
        debugLog(`${TAG} [${reqId}] Save assistant message: ${elapsed(tSave)} (parts=${assistantMsg.parts.length})`);
      }
    } catch (err) {
      // If steps resolution fails (e.g. partial abort), skip saving.
      // The text was already sent to the user via streaming.
      debugLog(`${TAG} [${reqId}] Failed to save assistant message: ${err}`);
    }
  }

  debugLog(`${TAG} [${reqId}] Post-stream overhead (finalize+save): ${elapsed(tStreamDone)}`);
}

/**
 * Handle a simple (non-streaming) response.
 */
async function handleSimpleResponse(
  ctx: WaveMessageContext,
  clients: ReturnType<typeof getWaveClients>,
  model: ReturnType<typeof getLanguageModel>,
  systemPrompt: string,
  modelMessages: any[],
  tools: Record<string, any>,
  thinkingConfig: any,
  sessionKey: string,
  reqId: string,
  abortSignal: AbortSignal,
): Promise<void> {
  const tLlm = Date.now();
  const result = withThinkingConfig(thinkingConfig, () =>
    streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      maxOutputTokens: resolveMaxTokens(),
      stopWhen: stepCountIs(10),
      abortSignal,
    }),
  );

  // Collect ordered segments (text + tool) preserving LLM output order
  let firstTokenTime = 0;
  const segments: CardSegment[] = [];

  function currentTextSeg(): Extract<CardSegment, { kind: "text" }> {
    const last = segments[segments.length - 1];
    if (last && last.kind === "text") return last;
    const seg: CardSegment = { kind: "text", text: "" };
    segments.push(seg);
    return seg as Extract<CardSegment, { kind: "text" }>;
  }

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        if (!part.text) break;
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          debugLog(`${TAG} [${reqId}] First token (TTFT): ${elapsed(tLlm)}`);
        }
        currentTextSeg().text += part.text;
        break;
      }
      case "tool-call": {
        segments.push({
          kind: "tool",
          activity: {
            toolCallId: (part as any).toolCallId ?? "",
            toolName: (part as any).toolName ?? "unknown",
            argsSummary: summariseToolArgs(
              (part as any).toolName ?? "unknown",
              (part as any).input,
            ),
            status: "running",
          },
        });
        break;
      }
      case "tool-result": {
        const callId = (part as any).toolCallId ?? "";
        const existing = segments.find(
          (s): s is Extract<CardSegment, { kind: "tool" }> =>
            s.kind === "tool" && s.activity.toolCallId === callId,
        );
        if (existing) existing.activity.status = "complete";
        break;
      }
      case "tool-error": {
        const callId = (part as any).toolCallId ?? "";
        const existing = segments.find(
          (s): s is Extract<CardSegment, { kind: "tool" }> =>
            s.kind === "tool" && s.activity.toolCallId === callId,
        );
        if (existing) {
          existing.activity.status = "error";
          const errObj = (part as any).error;
          existing.activity.errorMessage =
            errObj instanceof Error
              ? errObj.message
              : typeof errObj === "string"
                ? errObj
                : "执行失败";
        }
        break;
      }
      default:
        break;
    }
  }

  const fullText = segments
    .filter((s): s is Extract<CardSegment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("");
  debugLog(`${TAG} [${reqId}] LLM complete: ${elapsed(tLlm)} (chars=${fullText.length}, segments=${segments.length})`);

  if (fullText.trim() || hasDisplayableTools(segments)) {
    const tSend = Date.now();
    if (hasDisplayableTools(segments)) {
      // Send as a card with ordered tool status + markdown segments
      const content = buildReplyCardFromSegments(segments);
      await clients.msg.reply(ctx.messageId, msgCard(content));
    } else {
      await sendSimpleReply(clients, ctx.messageId, fullText);
    }
    debugLog(`${TAG} [${reqId}] Send reply: ${elapsed(tSend)}`);

    // Save assistant response with full tool history.
    // Guard: skip if session was reset (/new) to avoid re-creating a cleared
    // session with stale data (image references, tool history, etc.).
    if (!abortSignal.aborted) {
      try {
        const steps = await result.steps;
        const assistantMsg = buildAssistantStoredMessage(steps);
        if (assistantMsg) {
          await waveSessionManager.addAssistantMessage(sessionKey, assistantMsg);
        }
      } catch (err) {
        debugLog(`${TAG} [${reqId}] Failed to save assistant message: ${err}`);
      }
    }
  }
}
