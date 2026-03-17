/**
 * Wave integration — module entry point.
 *
 * Initializes the Wave SDK clients and registers event handlers.
 * Call `initWave()` during server startup (after `initSkills()`).
 *
 * Usage in src/index.ts:
 *   import { initWave, handleWaveWebhookWithContext } from "./wave";
 *
 *   await initWave();
 *   // Mount: POST /wave/events → handleWaveWebhookWithContext(req)
 */

import { loadWaveConfig, type WaveConfig } from "./config";
import { createWaveClients } from "./client";
import { setWebhookConfig, registerEventHandlers } from "./webhook";
import { logger } from "../logger";

export { handleWaveWebhookWithContext } from "./webhook";
export { loadWaveConfig } from "./config";

let waveEnabled = false;

function maskSecret(value: string, visiblePrefix = 4, visibleSuffix = 2): string {
  if (!value) return "<missing>";
  if (value.length <= visiblePrefix + visibleSuffix) {
    return `${"*".repeat(value.length)} (len=${value.length})`;
  }

  return `${value.slice(0, visiblePrefix)}***${value.slice(-visibleSuffix)} (len=${value.length})`;
}

/**
 * Initialize the Wave integration.
 *
 * Loads configuration from environment variables, creates SDK clients,
 * and registers event handlers. Returns `true` if Wave was successfully
 * initialized, `false` if disabled or misconfigured.
 *
 * Safe to call multiple times (no-op after first successful init).
 */
export async function initWave(): Promise<boolean> {
  if (waveEnabled) return true;

  const config = loadWaveConfig();
  if (!config) {
    logger.info("[Wave] Integration disabled (WAVE_ENABLED is not 'true').");
    return false;
  }

  try {
    logger.info("[Wave] Initializing Wave clients", {
      appId: config.appId,
      env: config.env,
      token: maskSecret(config.token),
      aesKey: maskSecret(config.aesKey),
      appSecret: maskSecret(config.appSecret),
      dmPolicy: config.dmPolicy,
      groupPolicy: config.groupPolicy,
      requireMention: config.requireMention,
      historyLimit: config.historyLimit,
      streaming: config.streaming,
    });

    createWaveClients(config);
    setWebhookConfig(config);
    registerEventHandlers(config);

    waveEnabled = true;
    logger.info(
      `[Wave] Initialized (appId: ${config.appId}, env: ${config.env}, ` +
      `dm: ${config.dmPolicy}, group: ${config.groupPolicy}, ` +
      `streaming: ${config.streaming})`,
    );
    return true;
  } catch (err) {
    logger.error("[Wave] Initialization failed:", err);
    return false;
  }
}

/**
 * Check if Wave integration is currently active.
 */
export function isWaveEnabled(): boolean {
  return waveEnabled;
}
