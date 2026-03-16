import type {
  SessionAdapter,
  SessionData,
  SessionMeta,
  SessionUpdateInput,
} from "./session-adapter";
import { DEFAULT_SESSION_TITLE, TITLE_MAX_LENGTH } from "./session-adapter";

const DB_NAME_PREFIX = "ocean-mcp-sessions";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const DEFAULT_MAX_SESSIONS = 1000;

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

function normalizeMaxSessions(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_MAX_SESSIONS;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) return DEFAULT_MAX_SESSIONS;
  return normalized;
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
  private dbName: string;
  private maxSessions: number;

  constructor(namespace?: string, maxSessions?: number) {
    const normalized = namespace?.trim();
    this.dbName = normalized
      ? `${DB_NAME_PREFIX}:${normalized}`
      : DB_NAME_PREFIX;
    this.maxSessions = normalizeMaxSessions(maxSessions);
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("[OceanMCP] IndexedDB is not available in this environment."));
        return;
      }

      const request = indexedDB.open(this.dbName, DB_VERSION);

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

  private async enforceMaxSessions(
    store: IDBObjectStore,
    records: StoredSessionRecord[],
    protectedId?: string | null,
  ): Promise<StoredSessionRecord[]> {
    if (this.maxSessions <= 0 || records.length <= this.maxSessions) return records;
    const guardedId = protectedId ?? null;
    let keep: StoredSessionRecord[];
    if (guardedId) {
      const protectedRecord = records.find((record) => record.id === guardedId) ?? null;
      if (protectedRecord) {
        const others = records
          .filter((record) => record.id !== guardedId)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        keep = [protectedRecord, ...others.slice(0, Math.max(0, this.maxSessions - 1))];
      } else {
        keep = [...records]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, this.maxSessions);
      }
    } else {
      keep = [...records]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, this.maxSessions);
    }
    const keepIds = new Set(keep.map((record) => record.id));
    for (const record of records) {
      if (!keepIds.has(record.id)) {
        await withRequest(store.delete(record.id));
      }
    }
    return keep;
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

  async prune(protectedId?: string | null): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      const records = (await withRequest(store.getAll())) as StoredSessionRecord[] | undefined;
      await this.enforceMaxSessions(store, records ?? [], protectedId);
    });
  }

  async update(id: string, data: SessionUpdateInput): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      const existing = (await withRequest(store.get(id))) as StoredSessionRecord | undefined;
      if (!existing) {
        throw new Error(`[OceanMCP] Session "${id}" does not exist.`);
      }

      const next: StoredSessionRecord = {
        ...existing,
        ...(data.title != null && { title: normalizeTitle(data.title) }),
        ...(data.messages != null && { messages: data.messages }),
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
