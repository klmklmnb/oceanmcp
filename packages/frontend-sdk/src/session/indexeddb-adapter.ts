import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
} from "@ocean-mcp/shared";
import type {
  SessionAdapter,
  SessionData,
  SessionMessage,
  SessionMeta,
  SessionUpdateInput,
} from "./session-adapter";

const DB_NAME = "ocean-mcp-sessions";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const DEFAULT_SESSION_TITLE = "New Session";
const TITLE_MAX_LENGTH = 50;

type StoredSessionRecord = SessionData;

function normalizeTitle(title?: string): string {
  const trimmed = title?.trim();
  if (!trimmed) return DEFAULT_SESSION_TITLE;
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TITLE_MAX_LENGTH);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
    if (text) return normalizeTitle(text);
  }
  return undefined;
}

function withRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function withTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDBSessionAdapter implements SessionAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("[OceanMCP] IndexedDB is not available in this environment."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const txDone = withTransaction(tx);
    const result = await run(store);
    await txDone;
    return result;
  }

  async create(title?: string): Promise<SessionData> {
    const now = Date.now();
    const session: SessionData = {
      id: generateId(),
      title: normalizeTitle(title),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    await this.withStore("readwrite", async (store) => {
      await withRequest(store.put(session));
    });

    return session;
  }

  async get(id: string): Promise<SessionData | null> {
    return this.withStore("readonly", async (store) => {
      const result = await withRequest(store.get(id));
      return (result as StoredSessionRecord | undefined) ?? null;
    });
  }

  async list(): Promise<SessionMeta[]> {
    const sessions = await this.withStore("readonly", async (store) => {
      const records = await withRequest(store.getAll());
      return (records as StoredSessionRecord[]) ?? [];
    });

    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, createdAt, updatedAt }) => ({
        id,
        title,
        createdAt,
        updatedAt,
      }));
  }

  async update(id: string, data: SessionUpdateInput): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      const existing = (await withRequest(store.get(id))) as StoredSessionRecord | undefined;
      if (!existing) {
        throw new Error(`[OceanMCP] Session "${id}" does not exist.`);
      }

      const nextMessages = data.messages ?? existing.messages;
      const titleFromMessages = deriveTitleFromMessages(nextMessages);
      const explicitTitle = data.title != null ? normalizeTitle(data.title) : undefined;

      const next: StoredSessionRecord = {
        ...existing,
        title: explicitTitle ?? titleFromMessages ?? existing.title,
        messages: nextMessages,
        updatedAt: Date.now(),
      };

      await withRequest(store.put(next));
    });
  }

  async delete(id: string): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      await withRequest(store.delete(id));
    });
  }

  async clear(): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      await withRequest(store.clear());
    });
  }
}
