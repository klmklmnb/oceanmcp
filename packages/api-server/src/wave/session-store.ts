/**
 * Wave session store — abstract interface and in-memory implementation.
 *
 * Defines a general-purpose SessionStore interface that can be backed by
 * in-memory Maps (default), Redis, or a relational database. All methods
 * are async to enable transparent migration to external backends without
 * changing call sites.
 *
 * ## Message format
 *
 * Messages are stored in Vercel AI SDK UIMessage format ({role, parts[]}).
 * This is the same format that `convertToModelMessages()` accepts as input,
 * so round-tripping through the store is seamless.
 *
 * Tool calls and tool results are stored as tool parts within assistant
 * messages, matching the shape the frontend builds for the web UI. This
 * means the LLM sees full tool history on subsequent turns.
 *
 * ## Migration path
 *
 * To move from in-memory to Redis/DB:
 *   1. Implement the SessionStore interface (e.g. RedisSessionStore)
 *   2. StoredMessage is fully JSON-serializable — store as JSON string
 *      in Redis, or jsonb column in Postgres
 *   3. Pass the new store to SessionManager constructor
 *   4. No other code changes needed — all call sites already use await
 */

// ── Stored Message Types ─────────────────────────────────────────────────────

/**
 * A tool invocation part stored in message history.
 *
 * Matches the AI SDK's ToolUIPart shape (minus the generic type parameter)
 * so that `convertToModelMessages()` can consume it directly.
 *
 * The `type` field follows the `tool-<toolName>` convention from the SDK.
 */
export interface StoredToolPart {
  type: `tool-${string}`; // "tool-<toolName>" e.g. "tool-askUser", "tool-deploy"
  toolCallId: string;
  state:
    | "output-available"
    | "output-error"
    | "output-denied"
    | "input-available";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
}

/**
 * A serializable message part (subset of UIMessagePart, JSON-safe).
 *
 * This union covers all part types we persist. Non-serializable parts
 * (streaming state, provider metadata) are intentionally omitted.
 */
export type StoredMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "step-start" }
  | StoredToolPart;

/**
 * A serializable message matching the AI SDK's UIMessage shape
 * (minus the `id` field, which is ephemeral).
 *
 * `convertToModelMessages()` accepts `Array<Omit<UIMessage, 'id'>>`,
 * so StoredMessage can be passed directly.
 */
export interface StoredMessage {
  role: "user" | "assistant";
  parts: StoredMessagePart[];
  /** Epoch ms — when this message was created. Useful for DB backends. */
  createdAt?: number;
}

/**
 * Session data — everything needed to reconstruct AI context for a
 * conversation turn.
 */
export interface SessionData {
  /** Session key: "wave:dm:<userId>" or "wave:group:<chatId>" */
  sessionKey: string;
  /** Conversation messages in UIMessage format */
  messages: StoredMessage[];
  /** Last activity timestamp (epoch ms) */
  lastActivity: number;
  /**
   * Arbitrary metadata cache, keyed by string.
   * Used for per-user info (Wave user profiles) cached within the session.
   * Values must be JSON-serializable for DB migration.
   */
  metadata: Record<string, unknown>;
}

// ── SessionStore Interface ───────────────────────────────────────────────────

/**
 * Abstract session storage interface.
 *
 * All methods are async to support future Redis/DB backends.
 * The in-memory implementation wraps synchronous operations in
 * resolved Promises (zero overhead in practice — V8 optimises this).
 */
export interface SessionStore {
  /** Get session data, or null if the session doesn't exist. */
  get(sessionKey: string): Promise<SessionData | null>;

  /** Get or create a session. Creates with empty messages if new. */
  getOrCreate(sessionKey: string): Promise<SessionData>;

  /** Append one or more messages to a session's history. */
  appendMessages(
    sessionKey: string,
    messages: StoredMessage[],
  ): Promise<void>;

  /** Get all messages for a session (empty array if session doesn't exist). */
  getMessages(sessionKey: string): Promise<StoredMessage[]>;

  /**
   * Trim history to keep at most `maxMessages` messages.
   * Keeps the most recent messages.
   */
  trimHistory(sessionKey: string, maxMessages: number): Promise<void>;

  /** Get message count for a session (0 if session doesn't exist). */
  getMessageCount(sessionKey: string): Promise<number>;

  /** Touch session — update lastActivity timestamp. */
  touch(sessionKey: string): Promise<void>;

  /** Store arbitrary metadata within a session. */
  setMetadata(
    sessionKey: string,
    key: string,
    value: unknown,
  ): Promise<void>;

  /** Retrieve metadata from a session. */
  getMetadata(
    sessionKey: string,
    key: string,
  ): Promise<unknown | undefined>;

  /** Delete a session entirely. */
  delete(sessionKey: string): Promise<void>;

  /** Get total number of active sessions. */
  size(): Promise<number>;

  /** Shutdown — clean up timers, connections, etc. */
  destroy(): Promise<void>;
}

// ── In-Memory Implementation ─────────────────────────────────────────────────

/** Default session TTL: 2 hours of inactivity */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Cleanup interval: check every 10 minutes */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * In-memory SessionStore backed by a Map.
 *
 * Suitable for single-process deployments. Sessions are lost on restart.
 * Has TTL-based cleanup for inactive sessions.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionData>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  async get(sessionKey: string): Promise<SessionData | null> {
    return this.sessions.get(sessionKey) ?? null;
  }

  async getOrCreate(sessionKey: string): Promise<SessionData> {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionKey,
        messages: [],
        lastActivity: Date.now(),
        metadata: {},
      };
      this.sessions.set(sessionKey, session);
    }
    session.lastActivity = Date.now();
    return session;
  }

  async appendMessages(
    sessionKey: string,
    messages: StoredMessage[],
  ): Promise<void> {
    const session = await this.getOrCreate(sessionKey);
    session.messages.push(...messages);
    session.lastActivity = Date.now();
  }

  async getMessages(sessionKey: string): Promise<StoredMessage[]> {
    const session = this.sessions.get(sessionKey);
    return session?.messages ?? [];
  }

  async trimHistory(
    sessionKey: string,
    maxMessages: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    if (session.messages.length > maxMessages) {
      session.messages = session.messages.slice(-maxMessages);
    }
  }

  async getMessageCount(sessionKey: string): Promise<number> {
    return this.sessions.get(sessionKey)?.messages.length ?? 0;
  }

  async touch(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  async setMetadata(
    sessionKey: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const session = await this.getOrCreate(sessionKey);
    session.metadata[key] = value;
  }

  async getMetadata(
    sessionKey: string,
    key: string,
  ): Promise<unknown | undefined> {
    const session = this.sessions.get(sessionKey);
    return session?.metadata[key];
  }

  async delete(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
  }

  async size(): Promise<number> {
    return this.sessions.size;
  }

  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  // ── TTL Cleanup ──────────────────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(key);
      }
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      CLEANUP_INTERVAL_MS,
    );
    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
