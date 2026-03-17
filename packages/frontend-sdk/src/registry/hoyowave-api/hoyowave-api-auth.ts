/**
 * HoYowave JSAPI Authentication Utility
 *
 * Most HoYowave JSAPIs require a prior `hyw.config()` call with a valid
 * JSSDK ticket before they can be used. This module provides a shared
 * helper that:
 *
 *   1. Fetches `{ appId, ticket }` from the api-server (`GET /api/wave/ticket`)
 *   2. Calls `hyw.config({ appId, ticket, jsApiList })` to authorize the APIs
 *   3. Caches authorized API names so subsequent calls for the same APIs
 *      skip the server round-trip
 *
 * Auth-free JSAPIs (per Wave docs):
 *   getTenantInfo, getSystemInfo, onWebviewStateChange, offWebviewStateChange,
 *   onAppStateChange, offAppStateChange, onThemeChange, offThemeChange,
 *   getOTPToken, closeWindow, config, requestAppRedirectUrl
 *
 * All other JSAPIs require auth via this utility.
 */

import * as hyw from "@hoyowave/jsapi";
import { API_URL } from "../../config";

/** Set of JSAPI names that have already been authorized via hyw.config(). */
const configuredApis = new Set<string>();

/**
 * Ensure the given JSAPI names are authorized before calling them.
 *
 * If all requested APIs are already authorized (from a previous call),
 * this is a no-op. Otherwise it fetches a fresh ticket from the
 * api-server and runs `hyw.config()`.
 *
 * @param jsApiList - Array of JSAPI method names that need authorization,
 *                    e.g. `["showToast"]`, `["enterChat", "scanCode"]`
 * @throws If the api-server is unreachable or returns an error,
 *         or if `hyw.config()` rejects.
 */
export async function ensureHywAuth(jsApiList: string[]): Promise<void> {
  // Skip if every requested API is already authorized
  if (jsApiList.every((api) => configuredApis.has(api))) {
    return;
  }

  // Fetch appId + ticket from the api-server
  const ticketRes = await fetch(`${API_URL}/api/wave/ticket`);
  if (!ticketRes.ok) {
    const body = await ticketRes.json().catch(() => ({}));
    throw new Error(
      (body as any).error ||
        `Failed to get Wave JSSDK ticket (HTTP ${ticketRes.status})`,
    );
  }

  const { appId, ticket } = (await ticketRes.json()) as {
    appId: string;
    ticket: string;
  };

  // Authorize via hyw.config() — include both new and previously-authorized
  // APIs so the config call covers everything in one shot.
  const allApis = [...new Set([...configuredApis, ...jsApiList])];
  await hyw.config({ appId, ticket, jsApiList: allApis });

  // Mark all as authorized on success
  for (const api of allApis) {
    configuredApis.add(api);
  }
}
