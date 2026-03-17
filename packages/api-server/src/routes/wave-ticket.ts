/**
 * GET /api/wave/ticket
 *
 * Returns a JSSDK ticket (and app ID) that the frontend can use to call
 * `hyw.config()` for permission-gated APIs like `enterChat`.
 *
 * Flow:
 *   1. POST {base}/openapi/auth/v1/access_token/internal  → access_token
 *   2. POST {base}/openapi/jssdk/v1/ticket/get             → ticket
 *   3. Return { appId, ticket } to the frontend
 *
 * The Wave app credentials (WAVE_APP_ID, WAVE_APP_SECRET) and environment
 * (WAVE_ENV) are read from the existing Wave config.
 */

import { loadWaveConfig, type WaveEnv } from "../wave/config";
import { logger } from "../logger";

/** Map WAVE_ENV to the Open API base URL. */
function getApiBase(env: WaveEnv): string {
  return env === "Prod"
    ? "https://open.hoyowave.com"
    : "https://open-testing.hoyowave.com";
}

export async function handleWaveTicket(_req: Request): Promise<Response> {
  const config = loadWaveConfig();

  if (!config) {
    return Response.json(
      { error: "Wave integration is not configured" },
      { status: 503 },
    );
  }

  const base = getApiBase(config.env);

  try {
    // ── Step 1: Get access_token ──────────────────────────────────────────
    const tokenRes = await fetch(
      `${base}/openapi/auth/v1/access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: config.appId,
          app_secret: config.appSecret,
        }),
      },
    );

    if (!tokenRes.ok) {
      logger.error(
        `[WaveTicket] access_token request failed: ${tokenRes.status} ${tokenRes.statusText}`,
      );
      return Response.json(
        { error: "Failed to obtain access token from Wave" },
        { status: 502 },
      );
    }

    const tokenData = (await tokenRes.json()) as {
      retcode: number;
      message: string;
      data?: { access_token?: string };
    };

    const accessToken = tokenData.data?.access_token;
    if (!accessToken) {
      logger.error("[WaveTicket] No access_token in response", tokenData);
      return Response.json(
        { error: "Wave returned empty access token" },
        { status: 502 },
      );
    }

    // ── Step 2: Get JSSDK ticket ──────────────────────────────────────────
    const ticketRes = await fetch(
      `${base}/openapi/jssdk/v1/ticket/get`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: accessToken,
        },
        body: JSON.stringify({}),
      },
    );

    if (!ticketRes.ok) {
      logger.error(
        `[WaveTicket] ticket request failed: ${ticketRes.status} ${ticketRes.statusText}`,
      );
      return Response.json(
        { error: "Failed to obtain JSSDK ticket from Wave" },
        { status: 502 },
      );
    }

    const ticketData = (await ticketRes.json()) as {
      retcode: number;
      message: string;
      data?: { ticket?: string };
    };

    const ticket = ticketData.data?.ticket;
    if (!ticket) {
      logger.error("[WaveTicket] No ticket in response", ticketData);
      return Response.json(
        { error: "Wave returned empty ticket" },
        { status: 502 },
      );
    }

    // ── Return appId + ticket to the frontend ─────────────────────────────
    return Response.json({ appId: config.appId, ticket });
  } catch (err) {
    logger.error("[WaveTicket] Unexpected error:", err);
    return Response.json(
      { error: "Internal server error while fetching Wave ticket" },
      { status: 500 },
    );
  }
}
