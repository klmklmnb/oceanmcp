export type SessionMessage = any;

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionData extends SessionMeta {
  messages: SessionMessage[];
}

export interface SessionUpdateInput {
  title?: string;
  messages?: SessionMessage[];
}

export interface SessionAdapter {
  create(title?: string): Promise<SessionData>;
  get(id: string): Promise<SessionData | null>;
  list(): Promise<SessionMeta[]>;
  update(id: string, data: SessionUpdateInput): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
