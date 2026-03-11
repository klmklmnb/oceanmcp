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

  private isSessionEmpty(session: SessionData): boolean {
    return !Array.isArray(session.messages) || session.messages.length === 0;
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
    }

    // On first entry, reuse the latest session only when it is still empty.
    // This avoids creating multiple empty sessions on page refresh.
    const sessions = await this.adapter.list();
    if (sessions.length > 0) {
      const latest = await this.adapter.get(sessions[0].id);
      if (latest && this.isSessionEmpty(latest)) {
        this.currentSessionId = latest.id;
        await this.setBridgeMessages(latest.messages);
        this.notify();
        return latest;
      }
    }

    // Otherwise, start with a brand-new session.
    const created = await this.adapter.create();
    this.currentSessionId = created.id;
    await this.setBridgeMessages(created.messages);
    this.notify();
    return created;
  }

  async listSessions(): Promise<SessionMeta[]> {
    if (!this.enabled) return [];
    return this.adapter.list();
  }

  async saveCurrentSession(messages?: any[]): Promise<void> {
    if (!this.enabled || !this.currentSessionId) return;
    const nextMessages = messages ?? (await this.getBridgeMessages());
    await this.adapter.update(this.currentSessionId, {
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

  async createNewSession(title?: string): Promise<SessionData | null> {
    if (!this.enabled) return null;

    await this.saveCurrentSession();

    const created = await this.adapter.create(title);
    this.currentSessionId = created.id;
    await this.setBridgeMessages(created.messages);
    this.notify();
    return created;
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.enabled || !id) return;

    const deletingCurrent = this.currentSessionId === id;
    await this.adapter.delete(id);

    if (!deletingCurrent) return;

    const sessions = await this.adapter.list();
    if (sessions.length === 0) {
      const created = await this.adapter.create();
      this.currentSessionId = created.id;
      await this.setBridgeMessages(created.messages);
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
