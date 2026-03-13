/**
 * Wave webhook HTTP handler.
 *
 * Handles incoming POST requests to `/wave/events`. The Wave platform
 * sends encrypted event payloads here. The handler:
 *
 *   1. Extracts the `?skills=` query parameter (zip URL for tools/skills)
 *   2. Passes the body to the Wave SDK's event handler for decryption + dispatch
 *   3. Returns the appropriate response (challenge for verification, empty for events)
 *
 * Also handles card interaction callbacks (EventMsgCardReaction) for
 * the interactive cards sent by the Wave `askUser` tool.
 */

import type { WaveConfig } from "./config";
import { getWaveClients } from "./client";
import {
  handleWaveMessage,
  handleWaveMessageFromContext,
  tryHandleWaveKeywordCommand,
} from "./event-handler";
import type { WaveEvent, WaveMessageContext } from "./message-parser";
import {
  resolvePendingPlanApproval,
  hasPendingPlanApproval,
  PLAN_APPROVAL_ACTION,
} from "./pending-approvals";
import {
  resolvePendingSelection,
  hasPendingSelection,
} from "./pending-selections";
import {
  hasPendingPostPlanAction,
  resolvePendingPostPlanAction,
  POST_PLAN_ACTION,
} from "./pending-post-plan-actions";
import {
  updateCardAfterSelection,
  updateCardAsExpired,
  updateExecutePlanDecisionCard,
  updatePostExecutePlanActionsCard,
  updateEmbeddedPostPlanCard,
} from "./message-sender";
import { logger } from "../logger";

let waveConfig: WaveConfig | null = null;

function maskSecret(value: string | undefined, visiblePrefix = 4, visibleSuffix = 2): string {
  if (!value) return "<missing>";
  if (value.length <= visiblePrefix + visibleSuffix) {
    return `${"*".repeat(value.length)} (len=${value.length})`;
  }

  return `${value.slice(0, visiblePrefix)}***${value.slice(-visibleSuffix)} (len=${value.length})`;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("authorization") ||
      lowerKey.includes("cookie") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("token")
    ) {
      redacted[key] = "<redacted>";
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}

function summarizeBody(body: unknown): Record<string, unknown> {
  if (body === null) return { type: "null" };
  if (body === undefined) return { type: "undefined" };
  if (typeof body !== "object") return { type: typeof body, value: body };

  const objectBody = body as Record<string, unknown>;
  const event = typeof objectBody.event === "object" && objectBody.event !== null
    ? (objectBody.event as Record<string, unknown>)
    : null;

  return {
    type: Array.isArray(body) ? "array" : "object",
    keys: Object.keys(objectBody),
    hasChallenge: typeof objectBody.challenge === "string",
    encryptLength:
      typeof objectBody.encrypt === "string" ? objectBody.encrypt.length : undefined,
    eventType:
      typeof objectBody.event_type === "string"
        ? objectBody.event_type
        : typeof event?.event_type === "string"
          ? event.event_type
          : undefined,
    openMessageId:
      typeof event?.open_msg_id === "string" ? event.open_msg_id : undefined,
  };
}

function previewText(text: string, limit = 1200): string {
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...<truncated>` : text;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return { value: error };
}

/**
 * Set the config for the webhook handler. Called by initWave().
 */
export function setWebhookConfig(config: WaveConfig): void {
  waveConfig = config;
}

/**
 * Handle an incoming Wave webhook request.
 *
 * This is mounted as `POST /wave/events` on the main Bun server.
 */
export async function handleWaveWebhook(req: Request): Promise<Response> {
  if (!waveConfig) {
    return new Response(JSON.stringify({ error: "Wave not initialized" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract ?skills= URL from query params
  const url = new URL(req.url, "http://localhost");
  const skillsZipUrl = url.searchParams.get("skills") || undefined;
  const requestId = `wave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let rawBody = "";
  let parsedBody: unknown;
  let headers: Record<string, string> = {};

  try {
    const t0 = Date.now();
    rawBody = await req.text();
    const tParse = Date.now();
    headers = Object.fromEntries(req.headers.entries());
    logger.info("[Wave] Webhook request received", {
      requestId,
      method: req.method,
      url: req.url,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      skillsZipUrl,
      contentType: req.headers.get("content-type"),
      contentLength: rawBody.length,
      userAgent: req.headers.get("user-agent"),
      forwardedFor: req.headers.get("x-forwarded-for"),
    });
    logger.debug("[Wave] Webhook headers", {
      requestId,
      headers: redactHeaders(headers),
    });
    logger.debug("[Wave] Webhook raw body preview", {
      requestId,
      preview: previewText(rawBody),
    });

    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch (parseError) {
      logger.error("[Wave] Failed to parse webhook JSON body", {
        requestId,
        error: serializeError(parseError),
        contentType: req.headers.get("content-type"),
        rawBodyPreview: previewText(rawBody),
      });
      throw parseError;
    }

    logger.info("[Wave] Webhook body summary", {
      requestId,
      summary: summarizeBody(parsedBody),
    });

    const clients = getWaveClients();
    logger.debug("[Wave] Webhook verification context", {
      requestId,
      appId: waveConfig.appId,
      env: waveConfig.env,
      token: maskSecret(waveConfig.token),
      aesKey: maskSecret(waveConfig.aesKey),
      skillsZipUrl,
    });

    // Let the SDK handle decryption, verification, and event dispatch.
    // The event handlers are registered in initWave() and process
    // messages asynchronously (fire-and-forget).
    let result: unknown;
    const bodyForHandle = parsedBody as Parameters<typeof clients.event.handle>[0];
    try {
      result = clients.event.handle(bodyForHandle, headers);
    } catch (handleError) {
      logger.error("[Wave] SDK webhook handle failed", {
        requestId,
        error: serializeError(handleError),
        headers: redactHeaders(headers),
        bodySummary: summarizeBody(parsedBody),
        rawBodyPreview: previewText(rawBody),
      });
      throw handleError;
    }
    logger.info("[Wave] Webhook dispatch completed", {
      requestId,
      parseMs: tParse - t0,
      handleMs: Date.now() - tParse,
      totalMs: Date.now() - t0,
      resultType: result === null ? "null" : typeof result,
      resultSummary:
        result && typeof result === "object"
          ? {
              keys: Object.keys(result as Record<string, unknown>),
              hasChallenge: "challenge" in (result as Record<string, unknown>),
              challengeLength:
                typeof (result as Record<string, unknown>).challenge === "string"
                  ? ((result as Record<string, unknown>).challenge as string).length
                  : undefined,
            }
          : result,
    });

    // For verification events, the SDK returns { challenge: "..." }
    if (result && typeof result === "object" && "challenge" in result) {
      logger.info("[Wave] Responding to webhook challenge", {
        requestId,
        challengeLength:
          typeof result.challenge === "string" ? result.challenge.length : undefined,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // For message events, we return 200 immediately.
    // The actual processing happens asynchronously in the event handlers
    // registered in initWave(), which call handleWaveMessage().
    // However, the SDK's handle() is synchronous in dispatching to handlers,
    // so we need to register async handlers that fire-and-forget.

    return new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error("[Wave] Webhook request failed", {
      requestId,
      error: serializeError(err),
      method: req.method,
      url: req.url,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: redactHeaders(headers),
      bodySummary: summarizeBody(parsedBody),
      rawBodyPreview: previewText(rawBody),
    });
    return new Response(
      JSON.stringify({ error: "Internal webhook error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Register event handlers on the Wave SDK event client.
 *
 * Called once by initWave(). Each handler fires the async chat flow
 * without blocking the webhook response.
 */
export function registerEventHandlers(config: WaveConfig): void {
  const clients = getWaveClients();

  // Cache skillsZipUrl at the handler level — it comes from the webhook URL
  // query string. We need a way to pass it from handleWaveWebhook to the
  // event handlers. Since the SDK's handle() doesn't support passing context,
  // we use a per-request store.
  //
  // Approach: store the current request's skillsZipUrl in a module-level
  // variable before calling handle(), and read it in the event handler.
  // This is safe because Bun processes requests sequentially within each
  // handler call (handle() dispatches synchronously).

  clients.event.onMsgDirectSendV2((event) => {
    logger.debug("[Wave] DM event (decrypted):", JSON.stringify(event, null, 2));
    // Fire and forget — the webhook response has already been sent
    const zipUrl = currentSkillsZipUrl;
    void handleWaveMessage(event as WaveEvent, config, zipUrl).catch((err) =>
      logger.error("[Wave] DM handler error:", err),
    );
  });

  clients.event.onMsgGroupSendV2((event) => {
    logger.debug("[Wave] Group event (decrypted):", JSON.stringify(event, null, 2));
    const zipUrl = currentSkillsZipUrl;
    void handleWaveMessage(event as WaveEvent, config, zipUrl).catch((err) =>
      logger.error("[Wave] Group handler error:", err),
    );
  });

  // ── Card interaction callback (buttons / dropdown / form submission) ──
  //
  // When a user clicks a button, selects a dropdown option, or submits a
  // form on an interactive card sent by `askUser`, Wave fires a
  // `MsgCardReaction` event. We look up the pending interaction by the
  // card's message ID and resolve the corresponding Promise so the
  // tool's execute() can return the user's response to the LLM.
  clients.event.onMsgCardReaction((event) => {
    const { open_msg_id, action } = event.event;
    const selectedValue = action?.values?.[0];

    logger.debug(
      "[Wave] Card reaction event:",
      JSON.stringify(
        { open_msg_id, selectedValue, allValues: action?.values, formValues: action?.form_values },
        null,
        2,
      ),
    );

    if (!open_msg_id) {
      return;
    }

    if (hasPendingPlanApproval(open_msg_id)) {
      if (!selectedValue) {
      logger.warn(
        `[Wave] Plan approval card reaction for ${open_msg_id} has no selected value`,
      );
        return;
      }

      const pending = resolvePendingPlanApproval(open_msg_id, selectedValue as any);
      if (!pending) return;

      const decision =
        selectedValue === PLAN_APPROVAL_ACTION.APPROVE
          ? "approved"
          : selectedValue === PLAN_APPROVAL_ACTION.DENY
            ? "denied"
            : null;
      if (!decision) {
      logger.warn(
        `[Wave] Unknown executePlan decision "${selectedValue}" for ${open_msg_id}`,
      );
        return;
      }

      const reason =
        decision === "denied" ? "用户在 Wave 中拒绝了本次执行。" : undefined;
      void updateExecutePlanDecisionCard(
        clients,
        open_msg_id,
        pending.intent,
        pending.steps,
        decision,
        reason,
      ).catch((err) =>
        logger.error("[Wave] Failed to update executePlan approval card:", err),
      );
      return;
    }

    // ── Post-executePlan action buttons (总结当前会话 / 开启新会话) ─────
    if (hasPendingPostPlanAction(open_msg_id)) {
      const pendingAction = resolvePendingPostPlanAction(open_msg_id);
      if (!pendingAction) return;

      // Helper: update the card to show the selected action.
      // For embedded cards (buttons inside an LLM response card), use
      // the stored card content to replace only the buttons with a
      // confirmation line while preserving the LLM text. For standalone
      // cards, replace the whole card with a simple confirmation.
      const updateCard = (label: string) => {
        if (pendingAction.isEmbedded && pendingAction.cardContent) {
          void updateEmbeddedPostPlanCard(
            clients,
            open_msg_id,
            label,
            pendingAction.cardContent,
          ).catch((err) =>
            logger.error("[Wave] Failed to update embedded post-plan card:", err),
          );
        } else if (!pendingAction.isEmbedded) {
          void updatePostExecutePlanActionsCard(
            clients,
            open_msg_id,
            label,
          ).catch((err) =>
            logger.error("[Wave] Failed to update post-plan action card:", err),
          );
        }
      };

      if (selectedValue === POST_PLAN_ACTION.SUMMARIZE) {
        updateCard("总结当前会话");

        // Construct a synthetic context and trigger the AI summary pipeline
        const syntheticCtx: WaveMessageContext = {
          chatId: pendingAction.chatId,
          messageId: open_msg_id,
          senderId: pendingAction.senderId,
          senderIdType: "union_id",
          chatType: pendingAction.chatId.startsWith("oc_") ? "group" : "p2p",
          mentionedBot: false,
          content: "请总结当前会话的内容",
          contentType: "text",
          imageKeys: [],
          sendAsNewMessage: true,
        };
        void handleWaveMessageFromContext(syntheticCtx, config).catch((err) =>
          logger.error("[Wave] Failed to handle post-plan summary:", err),
        );
      } else if (selectedValue === POST_PLAN_ACTION.NEW_SESSION) {
        updateCard("开启新会话");

        // Perform the same action as the /new command
        const syntheticCtx: WaveMessageContext = {
          chatId: pendingAction.chatId,
          messageId: open_msg_id,
          senderId: pendingAction.senderId,
          senderIdType: "union_id",
          chatType: pendingAction.chatId.startsWith("oc_") ? "group" : "p2p",
          mentionedBot: false,
          content: "/new",
          contentType: "text",
          imageKeys: [],
          sendAsNewMessage: true,
        };
        void tryHandleWaveKeywordCommand(syntheticCtx, clients).catch((err) =>
          logger.error("[Wave] Failed to handle post-plan new session:", err),
        );
      } else {
        logger.warn(
          `[Wave] Unknown post-plan action "${selectedValue}" for ${open_msg_id}`,
        );
      }
      return;
    }

    // Only handle events for cards we sent (pending askUser cards).
    // If the card is not pending, it may be stale (server restart, abort,
    // timeout, etc.) — update it to inform the user.
    if (!hasPendingSelection(open_msg_id)) {
      logger.debug(
        `[Wave] Card reaction for non-pending card ${open_msg_id}, sending expired notice`,
      );
      const looksLikePlanDecision =
        selectedValue === PLAN_APPROVAL_ACTION.APPROVE ||
        selectedValue === PLAN_APPROVAL_ACTION.DENY;
      void updateCardAsExpired(
        clients,
        open_msg_id,
        looksLikePlanDecision
          ? {
              title: "审批已过期",
              body: "该执行计划审批已失效，请重新发送消息。",
            }
          : undefined,
      ).catch(() => {});
      return;
    }

    // Determine the response data:
    //   - Form submissions: action.form_values contains all field values
    //   - Button/dropdown clicks: action.values[0] is the selected value
    const formValues = action?.form_values;
    const isFormSubmission = formValues != null && typeof formValues === "object" && Object.keys(formValues).length > 0;

    if (!isFormSubmission && !selectedValue) {
      logger.warn(
        `[Wave] Card reaction for ${open_msg_id} has no selected value and no form data`,
      );
      return;
    }

    let responseData: Record<string, any>;
    let displayLabel: string;

    if (isFormSubmission) {
      // Form submission — pass all form values
      responseData = formValues as Record<string, any>;
      const fieldCount = Object.keys(responseData).length;
      displayLabel = `${fieldCount} 个字段已提交`;
    } else {
      // Simple button/dropdown click — wrap in a record
      responseData = { _selectedValue: selectedValue };
      displayLabel = selectedValue!;
    }

    // Resolve the pending interaction — this unblocks the tool's execute()
    const pending = resolvePendingSelection(open_msg_id, responseData);
    if (!pending) return;

    // For simple selects, resolve the display label from pending options
    if (!isFormSubmission && selectedValue) {
      const selectedOption = pending.options.find(
        (o) => o.value === selectedValue,
      );
      displayLabel = selectedOption?.label || selectedValue;
    }

    // Update the card to show the confirmed response (fire-and-forget)
    void updateCardAfterSelection(
      clients,
      open_msg_id,
      "提交完成",
      displayLabel,
      isFormSubmission ? responseData : undefined,
    ).catch((err) =>
      logger.error("[Wave] Failed to update card after user response:", err),
    );
  });
}

// ── Per-request skills URL threading ─────────────────────────────────────────

let currentSkillsZipUrl: string | undefined;

/**
 * Handle a Wave webhook with skills URL context.
 *
 * Sets the skills URL before dispatching to the SDK event handler,
 * so event callbacks can pick it up.
 */
export async function handleWaveWebhookWithContext(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  currentSkillsZipUrl = url.searchParams.get("skills") || undefined;
  logger.debug("[Wave] Bound webhook request context", {
    pathname: url.pathname,
    skillsZipUrl: currentSkillsZipUrl,
  });
  try {
    return await handleWaveWebhook(req);
  } finally {
    currentSkillsZipUrl = undefined;
  }
}
