/**
 * Wave session manager.
 *
 * High-level facade over a SessionStore that provides the domain-specific
 * API used by the Wave event handler and tools. Delegates all persistence
 * to a pluggable SessionStore implementation (in-memory by default).
 *
 * ## Responsibilities
 *
 *   - Message history management (add user/assistant messages, trim, get)
 *   - User info caching (via SessionStore metadata)
 *   - Active stream AbortController tracking (in-memory only — cannot
 *     be serialised, so NOT part of SessionStore)
 *
 * ## Async API
 *
 * All message/session methods are async to support future migration to
 * Redis or database-backed SessionStore implementations. The AbortController
 * methods remain synchronous since they are always in-memory.
 */

import {
  InMemorySessionStore,
  type SessionStore,
  type SessionData,
  type StoredMessage,
} from "./session-store";
import { buildUserStoredMessage } from "./message-history";

// ── Re-exports for backward compatibility ────────────────────────────────────

export type { SessionStore, SessionData, StoredMessage } from "./session-store";

// ── WaveUserInfo ─────────────────────────────────────────────────────────────

/** Cached user info fetched via contact:user API */
export interface WaveUserInfo {
  name: string;
  en_name: string;
  nick_name: string;
  avatar: string;
  union_id: string;
  user_id: string;
  display_status: string;
  email: string;
}

/** Metadata key prefix for user info cache within a session */
const USER_INFO_PREFIX = "userInfo:";

// ── SessionManager ───────────────────────────────────────────────────────────

class SessionManager {
  private store: SessionStore;

  /**
   * Active AbortController per session — used to cancel a running
   * streamText() when the user sends a new message.
   *
   * Kept separate from SessionStore because AbortController is not
   * serializable and is strictly a runtime concern.
   */
  private activeControllers = new Map<string, AbortController>();

  constructor(store?: SessionStore) {
    this.store = store ?? new InMemorySessionStore();
  }

  /**
   * Replace the backing store (e.g. for testing or migration).
   */
  setStore(store: SessionStore): void {
    this.store = store;
  }

  /**
   * Get the backing store (for direct access in tests or advanced usage).
   */
  getStore(): SessionStore {
    return this.store;
  }

  // ── Session lifecycle ──────────────────────────────────────────────────

  /**
   * Get or create a session for the given key.
   */
  async getOrCreate(sessionKey: string): Promise<SessionData> {
    return this.store.getOrCreate(sessionKey);
  }

  /**
   * Get all messages for a session.
   */
  async getMessages(sessionKey: string): Promise<StoredMessage[]> {
    return this.store.getMessages(sessionKey);
  }

  /**
   * Append a user message to the session.
   */
  async addUserMessage(sessionKey: string, text: string): Promise<void> {
    const msg = buildUserStoredMessage(text);
    await this.store.appendMessages(sessionKey, [msg]);
  }

  /**
   * Append a fully-formed assistant message (with tool parts) to the session.
   *
   * The message should be built via `buildAssistantStoredMessage()` from
   * the `message-history` module, which reconstructs tool call and result
   * parts from the streamText steps.
   */
  async addAssistantMessage(
    sessionKey: string,
    message: StoredMessage,
  ): Promise<void> {
    await this.store.appendMessages(sessionKey, [message]);
  }

  /**
   * Trim session history to keep only the last N messages.
   */
  async trimHistory(sessionKey: string, maxMessages: number): Promise<void> {
    await this.store.trimHistory(sessionKey, maxMessages);
  }

  /**
   * Get message count for a session.
   */
  async getMessageCount(sessionKey: string): Promise<number> {
    return this.store.getMessageCount(sessionKey);
  }

  // ── User info cache (stored as session metadata) ───────────────────────

  /**
   * Cache user info for a given union_id within a session.
   */
  async setUserInfo(
    sessionKey: string,
    unionId: string,
    info: WaveUserInfo,
  ): Promise<void> {
    await this.store.setMetadata(
      sessionKey,
      `${USER_INFO_PREFIX}${unionId}`,
      info,
    );
  }

  /**
   * Retrieve cached user info for a given union_id within a session.
   */
  async getUserInfo(
    sessionKey: string,
    unionId: string,
  ): Promise<WaveUserInfo | undefined> {
    const value = await this.store.getMetadata(
      sessionKey,
      `${USER_INFO_PREFIX}${unionId}`,
    );
    return value as WaveUserInfo | undefined;
  }

  // ── Active stream AbortController management ──────────────────────────
  //
  // These remain synchronous — AbortController is a runtime-only concern
  // that cannot be serialised to an external store.

  /**
   * Store the AbortController for the currently active streamText() call
   * on a session. Called at the start of handleWaveMessage().
   */
  setActiveAbortController(
    sessionKey: string,
    controller: AbortController,
  ): void {
    this.activeControllers.set(sessionKey, controller);
  }

  /**
   * Get the AbortController for the session's current active stream
   * (if any). Returns `undefined` when no stream is running.
   */
  getActiveAbortController(
    sessionKey: string,
  ): AbortController | undefined {
    return this.activeControllers.get(sessionKey);
  }

  /**
   * Remove the tracked AbortController for a session.
   * Called when a stream completes normally or after aborting.
   */
  clearActiveAbortController(sessionKey: string): void {
    this.activeControllers.delete(sessionKey);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Clear a specific session (both store and controller).
   */
  async clear(sessionKey: string): Promise<void> {
    this.activeControllers.delete(sessionKey);
    await this.store.delete(sessionKey);
  }

  /**
   * Get total active session count.
   */
  async size(): Promise<number> {
    return this.store.size();
  }

  /**
   * Shutdown — clean up all resources.
   */
  async destroy(): Promise<void> {
    this.activeControllers.clear();
    await this.store.destroy();
  }
}

export const waveSessionManager = new SessionManager();
