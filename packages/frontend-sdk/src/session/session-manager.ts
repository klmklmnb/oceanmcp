import { chatBridge } from "../runtime/chat-bridge";
import { IndexedDBSessionAdapter } from "./indexeddb-adapter";
import type { SessionAdapter, SessionData, SessionMeta } from "./session-adapter";

type SessionChangeListener = (currentSessionId: string | null) => void;

export class SessionManager {
  private adapter: SessionAdapter;
  private currentSessionId: string | null = null;
  private enabled = false;
  private listeners = new Set<SessionChangeListener>();

  constructor(adapter?: SessionAdapter) {
    this.adapter = adapter ?? new IndexedDBSessionAdapter();
  }

  setAdapter(adapter: SessionAdapter): void {
    this.adapter = adapter;
    this.currentSessionId = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentSessionId = null;
      this.notify();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get activeSessionId(): string | null {
    return this.currentSessionId;
  }

  subscribe(listener: SessionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentSessionId);
    }
  }

  private hasPersistableMessages(messages: any[]): boolean {
    return Array.isArray(messages) && messages.length > 0;
  }

  private async getBridgeMessages(): Promise<any[]> {
    if (chatBridge.has("getMessages")) {
      const data = await chatBridge.call<any[]>("getMessages");
      return Array.isArray(data) ? data : [];
    }
    return [];
  }

  private async setBridgeMessages(messages: any[]): Promise<void> {
    if (chatBridge.has("loadSession")) {
      await chatBridge.call("loadSession", messages);
      return;
    }
    if (chatBridge.has("clearMessages")) {
      await chatBridge.call("clearMessages");
    }
  }

  async initialize(): Promise<SessionData | null> {
    if (!this.enabled) return null;

    if (this.currentSessionId) {
      const existing = await this.adapter.get(this.currentSessionId);
      if (existing) {
        await this.setBridgeMessages(existing.messages);
        return existing;
      }
      this.currentSessionId = null;
    }

    // Lazy mode: do not persist an empty session on init.
    this.currentSessionId = null;
    await this.setBridgeMessages([]);
    this.notify();
    return null;
  }

  async listSessions(): Promise<SessionMeta[]> {
    if (!this.enabled) return [];
    return this.adapter.list();
  }

  async saveCurrentSession(
    messages?: any[],
    sessionId?: string | null,
  ): Promise<void> {
    if (!this.enabled) return;
    const hasExplicitSession = sessionId !== undefined;
    if (hasExplicitSession && sessionId !== this.currentSessionId) {
      // Stale timer callback after session switched.
      return;
    }
    const nextMessages = messages ?? (await this.getBridgeMessages());
    if (!this.hasPersistableMessages(nextMessages)) {
      return;
    }

    let targetId = hasExplicitSession ? sessionId : this.currentSessionId;
    if (!targetId) {
      const created = await this.adapter.create();
      this.currentSessionId = created.id;
      targetId = created.id;
      this.notify();
    }

    await this.adapter.update(targetId, {
      messages: nextMessages,
    });
  }

  async switchSession(id: string): Promise<SessionData | null> {
    if (!this.enabled) return null;
    if (!id) return null;

    if (this.currentSessionId === id) {
      const current = await this.adapter.get(id);
      if (current) {
        await this.setBridgeMessages(current.messages);
      }
      return current;
    }

    await this.saveCurrentSession();

    const target = await this.adapter.get(id);
    if (!target) return null;

    this.currentSessionId = id;
    await this.setBridgeMessages(target.messages);
    this.notify();
    return target;
  }

  async createNewSession(_title?: string): Promise<SessionData | null> {
    if (!this.enabled) return null;

    await this.saveCurrentSession();

    // Lazy mode: reset to draft state without persisting an empty session.
    this.currentSessionId = null;
    await this.setBridgeMessages([]);
    this.notify();
    return null;
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.enabled || !id) return;

    const deletingCurrent = this.currentSessionId === id;
    await this.adapter.delete(id);

    if (!deletingCurrent) return;

    const sessions = await this.adapter.list();
    if (sessions.length === 0) {
      this.currentSessionId = null;
      await this.setBridgeMessages([]);
      this.notify();
      return;
    }

    const next = await this.adapter.get(sessions[0].id);
    if (!next) return;

    this.currentSessionId = next.id;
    await this.setBridgeMessages(next.messages);
    this.notify();
  }
}

export const sessionManager = new SessionManager();
