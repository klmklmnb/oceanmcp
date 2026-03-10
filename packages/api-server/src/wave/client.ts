/**
 * Wave SDK client wrapper.
 *
 * Thin layer around `@mihoyo/wave-opensdk`'s `createAppClient`, `createAppEvent`,
 * and `createAppMsg`. Manages a singleton client per config, handles token
 * lifecycle automatically (the SDK refreshes access tokens internally).
 */

import {
  createAppClient,
  createAppEvent,
  createAppMsg,
  createAppContact,
  type AppClient,
  type AppEvent,
  type AppMsg,
  type AppContact,
} from "@mihoyo/wave-opensdk";
import type { WaveConfig } from "./config";

export interface WaveClients {
  /** Base HTTP client — handles auth token lifecycle */
  client: AppClient;
  /** Event handler — decrypts + verifies + dispatches webhook events */
  event: AppEvent;
  /** Message client — send, reply, update cards, streaming */
  msg: AppMsg;
  /** Contact client — user info lookups via contact:user API */
  contact: AppContact;
}

/** Singleton clients instance, created once by initWave() */
let clients: WaveClients | null = null;

/**
 * Create Wave SDK clients from config.
 *
 * Should be called once during server startup. Subsequent calls to
 * `getWaveClients()` return the cached instance.
 */
export function createWaveClients(config: WaveConfig): WaveClients {
  const clientOptions = {
    appId: config.appId,
    appSecret: config.appSecret,
    aesKey: config.aesKey,
    token: config.token,
    env: config.env,
  };

  const client = createAppClient(clientOptions);
  const event = createAppEvent({
    aesKey: config.aesKey,
    token: config.token,
  });
  const msg = createAppMsg({ client });
  const contact = createAppContact({ client });

  clients = { client, event, msg, contact };
  return clients;
}

/**
 * Get the initialized Wave clients.
 *
 * @throws If called before `createWaveClients()`.
 */
export function getWaveClients(): WaveClients {
  if (!clients) {
    throw new Error("[Wave] Clients not initialized. Call createWaveClients() first.");
  }
  return clients;
}
