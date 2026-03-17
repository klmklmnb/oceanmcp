import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
} from "oceanmcp-shared";
import { chatBridge } from "../runtime/chat-bridge";
import { IndexedDBSessionAdapter } from "./indexeddb-adapter";
import type { SessionAdapter, SessionData, SessionMeta, SessionMessage } from "./session-adapter";
import {
  TITLE_GENERATION_COMPLETED,
  TITLE_MAX_LENGTH,
} from "./session-adapter";

function extractMessageText(message: SessionMessage): string {
  if (!message || message.role !== MESSAGE_ROLE.USER || !Array.isArray(message.parts)) {
    return "";
  }
  for (const part of message.parts) {
    if (part?.type === MESSAGE_PART_TYPE.TEXT && typeof part.text === "string") {
      return part.text.trim();
    }
  }
  return "";
}

function deriveTitleFromMessages(messages?: SessionMessage[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages) {
    const text = extractMessageText(message);
    if (!text) continue;
    const trimmed = text.length <= TITLE_MAX_LENGTH ? text : text.slice(0, TITLE_MAX_LENGTH);
    return trimmed;
  }
  return undefined;
}

type SessionChangeListener = (currentSessionId: string | null) => void;

export class SessionManager {
  private adapter: SessionAdapter;
  private currentSessionId: string | null = null;
  private enabled = false;
  private listeners = new Set<SessionChangeListener>();
  private titleDerivedSessions = new Set<string>();

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
      if (import.meta.env.DEV) {
        console.warn("[OceanMCP] Skipped saving stale session", {
          requestedSessionId: sessionId,
          activeSessionId: this.currentSessionId,
        });
      }
      return;
    }
    const nextMessages = messages ?? (await this.getBridgeMessages());
    if (!this.hasPersistableMessages(nextMessages)) {
      return;
    }

    let targetId = hasExplicitSession ? sessionId : this.currentSessionId;
    let isNewSession = false;
    if (!targetId) {
      const created = await this.adapter.create();
      this.currentSessionId = created.id;
      targetId = created.id;
      isNewSession = true;
      this.notify();
      await this.adapter.prune?.(this.currentSessionId);
    }

    const updatePayload: { messages: any[]; title?: string } = {
      messages: nextMessages,
    };

    if (isNewSession && !this.titleDerivedSessions.has(targetId)) {
      const derived = deriveTitleFromMessages(nextMessages);
      if (derived) {
        updatePayload.title = derived;
        this.titleDerivedSessions.add(targetId);
      }
    }

    await this.adapter.update(targetId, updatePayload);
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

    await this.setBridgeMessages(target.messages);
    this.currentSessionId = id;
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

  async updateSessionTitle(id: string, title: string): Promise<void> {
    if (!this.enabled || !id) return;
    await this.adapter.update(id, {
      title,
      titleGenerationState: TITLE_GENERATION_COMPLETED,
    });
    this.titleDerivedSessions.add(id);
  }

  async markSessionTitleGenerationCompleted(id: string): Promise<void> {
    if (!this.enabled || !id) return;
    await this.adapter.update(id, {
      titleGenerationState: TITLE_GENERATION_COMPLETED,
    });
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
