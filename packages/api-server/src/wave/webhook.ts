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
 * the interactive user-selection cards sent by the Wave `userSelect` tool.
 */

import type { WaveConfig } from "./config";
import { getWaveClients } from "./client";
import { handleWaveMessage } from "./event-handler";
import type { WaveEvent } from "./message-parser";
import {
  resolvePendingSelection,
  hasPendingSelection,
} from "./pending-selections";
import { updateCardAfterSelection, updateCardAsExpired } from "./message-sender";

let waveConfig: WaveConfig | null = null;

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

  try {
    const t0 = Date.now();
    const body = await req.json();
    const tParse = Date.now();
    const headers = Object.fromEntries(req.headers.entries());

    if (process.env.DEBUG === "true") {
      console.log("[Wave][Debug] Webhook query params:", Object.fromEntries(url.searchParams.entries()));
      console.log("[Wave][Debug] Webhook headers:", headers);
    }

    const clients = getWaveClients();

    // Let the SDK handle decryption, verification, and event dispatch.
    // The event handlers are registered in initWave() and process
    // messages asynchronously (fire-and-forget).
    const result = clients.event.handle(body, headers);
    if (process.env.DEBUG === "true") {
      console.log(`[Wave][Perf] Webhook: parse=${tParse - t0}ms, decrypt+dispatch=${Date.now() - tParse}ms, total=${Date.now() - t0}ms`);
    }

    // For verification events, the SDK returns { challenge: "..." }
    if (result && typeof result === "object" && "challenge" in result) {
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
    console.error("[Wave] Webhook error:", err);
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
    if (process.env.DEBUG === "true") {
      console.log("[Wave][Debug] DM event (decrypted):", JSON.stringify(event, null, 2));
    }
    // Fire and forget — the webhook response has already been sent
    const zipUrl = currentSkillsZipUrl;
    void handleWaveMessage(event as WaveEvent, config, zipUrl).catch((err) =>
      console.error("[Wave] DM handler error:", err),
    );
  });

  clients.event.onMsgGroupSendV2((event) => {
    if (process.env.DEBUG === "true") {
      console.log("[Wave][Debug] Group event (decrypted):", JSON.stringify(event, null, 2));
    }
    const zipUrl = currentSkillsZipUrl;
    void handleWaveMessage(event as WaveEvent, config, zipUrl).catch((err) =>
      console.error("[Wave] Group handler error:", err),
    );
  });

  // ── Card interaction callback (buttons / dropdown selection) ─────────
  //
  // When a user clicks a button or selects a dropdown option on an
  // interactive card sent by `userSelect`, Wave fires a
  // `MsgCardReaction` event. We look up the pending selection by the
  // card's message ID and resolve the corresponding Promise so the
  // tool's execute() can return the selected value to the LLM.
  clients.event.onMsgCardReaction((event) => {
    const { open_msg_id, token, action } = event.event;
    const selectedValue = action?.values?.[0];

    if (process.env.DEBUG === "true") {
      console.log(
        "[Wave][Debug] Card reaction event:",
        JSON.stringify(
          { open_msg_id, selectedValue, allValues: action?.values },
          null,
          2,
        ),
      );
    }

    // Only handle events for cards we sent (pending userSelect cards).
    // If the card is not pending, it may be stale (server restart, abort,
    // timeout, etc.) — update it to inform the user.
    if (!open_msg_id || !hasPendingSelection(open_msg_id)) {
      if (process.env.DEBUG === "true") {
        console.log(
          `[Wave][Debug] Card reaction for non-pending card ${open_msg_id}, sending expired notice`,
        );
      }
      if (open_msg_id) {
        void updateCardAsExpired(clients, open_msg_id).catch(() => {});
      }
      return;
    }

    if (!selectedValue) {
      console.warn(
        `[Wave] Card reaction for ${open_msg_id} has no selected value`,
      );
      return;
    }

    // Resolve the pending selection — this unblocks the tool's execute()
    const pending = resolvePendingSelection(open_msg_id, selectedValue);
    if (!pending) return;

    // Find the label of the selected option for the card update
    const selectedOption = pending.options.find(
      (o) => o.value === selectedValue,
    );
    const selectedLabel = selectedOption?.label || selectedValue;

    // Update the card to show the confirmed selection (fire-and-forget)
    void updateCardAfterSelection(
      clients,
      open_msg_id,
      "选择完成",
      selectedLabel,
    ).catch((err) =>
      console.error("[Wave] Failed to update card after selection:", err),
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
  try {
    return await handleWaveWebhook(req);
  } finally {
    currentSkillsZipUrl = undefined;
  }
}
