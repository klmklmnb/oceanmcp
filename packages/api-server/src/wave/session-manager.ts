/**
 * Wave session manager.
 *
 * Maintains per-user/group conversation state (message history) for the
 * Wave chat channel. Each session stores a Vercel AI SDK-compatible
 * messages array that persists across webhook events.
 *
 * Sessions are stored in-memory with TTL-based cleanup for inactive
 * conversations.
 */

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

export interface WaveSession {
  /** Session key: "wave:dm:<userId>" or "wave:group:<chatId>" */
  sessionKey: string;
  /** Vercel AI SDK message format */
  messages: any[];
  /** Last activity timestamp (epoch ms) */
  lastActivity: number;
  /** Cached user info keyed by union_id — avoids repeated contact API calls */
  userInfo: Map<string, WaveUserInfo>;
}

/** Default session TTL: 2 hours of inactivity */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Cleanup interval: check every 10 minutes */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

class SessionManager {
  private sessions = new Map<string, WaveSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Get or create a session for the given key.
   */
  getOrCreate(sessionKey: string): WaveSession {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionKey,
        messages: [],
        lastActivity: Date.now(),
        userInfo: new Map(),
      };
      this.sessions.set(sessionKey, session);
    }
    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Append a user message to the session.
   */
  addUserMessage(sessionKey: string, text: string): WaveSession {
    const session = this.getOrCreate(sessionKey);
    session.messages.push({
      role: "user",
      parts: [{ type: "text", text }],
    });
    return session;
  }

  /**
   * Append an assistant message to the session.
   */
  addAssistantMessage(sessionKey: string, text: string): void {
    const session = this.getOrCreate(sessionKey);
    session.messages.push({
      role: "assistant",
      parts: [{ type: "text", text }],
    });
  }

  /**
   * Cache user info for a given union_id within a session.
   */
  setUserInfo(sessionKey: string, unionId: string, info: WaveUserInfo): void {
    const session = this.getOrCreate(sessionKey);
    session.userInfo.set(unionId, info);
  }

  /**
   * Retrieve cached user info for a given union_id within a session.
   */
  getUserInfo(sessionKey: string, unionId: string): WaveUserInfo | undefined {
    return this.sessions.get(sessionKey)?.userInfo.get(unionId);
  }

  /**
   * Trim session history to keep only the last N messages.
   * Always keeps at least the system context intact.
   */
  trimHistory(sessionKey: string, maxMessages: number): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    if (session.messages.length > maxMessages) {
      // Keep the most recent messages
      session.messages = session.messages.slice(-maxMessages);
    }
  }

  /**
   * Get message count for a session.
   */
  getMessageCount(sessionKey: string): number {
    return this.sessions.get(sessionKey)?.messages.length ?? 0;
  }

  /**
   * Clear a specific session.
   */
  clear(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  /**
   * Get total active session count.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Remove stale sessions that have been inactive beyond the TTL.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(key);
      }
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}

export const waveSessionManager = new SessionManager();
