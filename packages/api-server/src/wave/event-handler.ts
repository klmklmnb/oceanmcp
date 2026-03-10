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
import {
  sendInitialReplyCard,
  enableStreaming,
  updateStreamingText,
  finalizeReplyCard,
  sendSimpleReply,
  type StreamingCardState,
} from "./message-sender";

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
      console.warn(`[Wave] Failed to load skills from ${url}, using cached: ${err}`);
      return cached;
    }
    console.error(`[Wave] Failed to load skills from ${url}:`, err);
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
  return basePrompt + buildSkillsPrompt(allSkills) + "\n\n请用简体中文回复用户的所有消息。";
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
  const clients = getWaveClients();

  // 1. Parse message
  const ctx = parseWaveEvent(event, config.appId);

  // Ignore empty messages
  if (!ctx.content.trim()) return;

  // Ignore messages from bots (prevent loops)
  if (ctx.senderIdType === "app_id") return;

  // 2. Policy check
  const policy = checkPolicy(ctx, config);
  if (!policy.allowed) {
    if (process.env.DEBUG === "true") {
      console.log(`[Wave] Message blocked: ${policy.reason}`);
    }
    return;
  }

  // 3. Load skills from zip URL (if provided)
  const { sandbox, discoveredSkills: fileSkills } = getBasePromptContext();
  let zipSkills: DiscoveredSkill[] = [];
  if (skillsZipUrl) {
    zipSkills = await loadZipSkills(sandbox, skillsZipUrl);
  }

  // 4. Get/create session and append user message
  const sessionKey = deriveSessionKey(ctx);
  waveSessionManager.addUserMessage(sessionKey, ctx.content);
  waveSessionManager.trimHistory(sessionKey, config.historyLimit);
  const session = waveSessionManager.getOrCreate(sessionKey);

  // 5. Build tools and system prompt
  const tools = buildWaveTools(fileSkills, zipSkills, sandbox, clients, ctx.senderId, sessionKey);
  const systemPrompt = buildWaveSystemPrompt(fileSkills, zipSkills);

  // 6. Convert messages to model format
  const modelMessages = await convertToModelMessages(session.messages);

  // 7. Stream AI response
  const resolvedModel = getLanguageModel();
  const thinkingConfig = resolveThinkingConfig();

  try {
    if (config.streaming) {
      await handleStreamingResponse(ctx, clients, resolvedModel, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey);
    } else {
      await handleSimpleResponse(ctx, clients, resolvedModel, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey);
    }
  } catch (err) {
    console.error(`[Wave] Chat error for ${sessionKey}:`, err);
    try {
      await sendSimpleReply(
        clients,
        ctx.messageId,
        `An error occurred while processing your message. Please try again.`,
      );
    } catch {
      // best effort
    }
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
): Promise<void> {
  // Send initial placeholder card
  const cardMessageId = await sendInitialReplyCard(
    clients,
    ctx.messageId,
    "...",
  );

  if (!cardMessageId) {
    // Fallback to non-streaming
    return handleSimpleResponse(ctx, clients, model, systemPrompt, modelMessages, tools, thinkingConfig, sessionKey);
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
  const result = withThinkingConfig(thinkingConfig, () =>
    streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      maxOutputTokens: resolveMaxTokens(),
      stopWhen: stepCountIs(10),
    }),
  );

  // Consume the text stream and push updates to Wave
  let lastUpdateTime = 0;
  const MIN_UPDATE_INTERVAL_MS = 300; // Throttle updates to avoid rate limits

  for await (const textPart of result.textStream) {
    if (!textPart) continue;

    state.accumulatedText += textPart;

    const now = Date.now();
    if (now - lastUpdateTime >= MIN_UPDATE_INTERVAL_MS) {
      await updateStreamingText(clients, state, state.accumulatedText);
      lastUpdateTime = now;
    }
  }

  // Final update with any remaining text
  if (state.accumulatedText) {
    await updateStreamingText(clients, state, state.accumulatedText);
  }

  // Finalize
  await finalizeReplyCard(clients, state, ctx.chatId);

  // Save assistant response to session
  if (state.accumulatedText.trim()) {
    waveSessionManager.addAssistantMessage(sessionKey, state.accumulatedText);
  }
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
): Promise<void> {
  const result = withThinkingConfig(thinkingConfig, () =>
    streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      maxOutputTokens: resolveMaxTokens(),
      stopWhen: stepCountIs(10),
    }),
  );

  // Collect full text
  let fullText = "";
  for await (const textPart of result.textStream) {
    fullText += textPart;
  }

  if (fullText.trim()) {
    await sendSimpleReply(clients, ctx.messageId, fullText);
    waveSessionManager.addAssistantMessage(sessionKey, fullText);
  }
}
