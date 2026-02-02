import type { FunctionDefinition } from "@hacker-agent/shared";
import type { SessionData, BunWebSocket } from "./types";

class SessionStore {
  private sessions: Map<string, SessionData> = new Map();
  private connections: Map<string, BunWebSocket> = new Map();

  createSession(sessionId: string): SessionData {
    const session: SessionData = {
      sessionId,
      functions: [],
      pendingReads: new Map(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.connections.delete(sessionId);
  }

  setConnection(sessionId: string, ws: BunWebSocket): void {
    this.connections.set(sessionId, ws);
  }

  getConnection(sessionId: string): BunWebSocket | undefined {
    return this.connections.get(sessionId);
  }

  updateFunctions(sessionId: string, functions: FunctionDefinition[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.functions = functions;
    }
  }

  getFunctions(sessionId: string): FunctionDefinition[] {
    return this.sessions.get(sessionId)?.functions || [];
  }

  addPendingRead(
    sessionId: string,
    requestId: string,
    resolver: { resolve: (results: unknown[]) => void; reject: (error: Error) => void }
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pendingReads.set(requestId, resolver);
    }
  }

  resolvePendingRead(sessionId: string, requestId: string, results: unknown[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const resolver = session.pendingReads.get(requestId);
      if (resolver) {
        resolver.resolve(results);
        session.pendingReads.delete(requestId);
      }
    }
  }

  rejectPendingRead(sessionId: string, requestId: string, error: Error): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const resolver = session.pendingReads.get(requestId);
      if (resolver) {
        resolver.reject(error);
        session.pendingReads.delete(requestId);
      }
    }
  }
}

export const sessionStore = new SessionStore();
