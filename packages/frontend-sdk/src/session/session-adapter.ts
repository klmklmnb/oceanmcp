export type SessionMessage = any;

export const DEFAULT_SESSION_TITLE = "New Session";
export const LEGACY_ZH_DEFAULT_SESSION_TITLE = "新会话";
export const TITLE_MAX_LENGTH = 50;
export const TITLE_GENERATION_PENDING = "pending";
export const TITLE_GENERATION_COMPLETED = "completed";
export type SessionTitleGenerationState =
  | typeof TITLE_GENERATION_PENDING
  | typeof TITLE_GENERATION_COMPLETED;

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Historical records may not have this field.
   * Treat undefined as completed (do not generate again).
   */
  titleGenerationState?: SessionTitleGenerationState;
}

export interface SessionData extends SessionMeta {
  messages: SessionMessage[];
}

export interface SessionUpdateInput {
  title?: string;
  messages?: SessionMessage[];
  titleGenerationState?: SessionTitleGenerationState;
}

export interface SessionAdapter {
  create(title?: string): Promise<SessionData>;
  get(id: string): Promise<SessionData | null>;
  list(): Promise<SessionMeta[]>;
  update(id: string, data: SessionUpdateInput): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  prune?(protectedId?: string | null): Promise<void>;
}
