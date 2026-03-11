import { commandRegistry } from "./command-registry";
import { sessionManager } from "../session/session-manager";

export const OPEN_SESSIONS_EVENT = "ocean-mcp:open-sessions";

const BUILTIN_COMMAND = [{
  name: "new",
  description: "Create and switch to a new session",
  descriptionKey: "chat.command.new",
  execute: async () => {
    if (!sessionManager.isEnabled) return;
    await sessionManager.createNewSession();
  },
}, {
  name: "sessions",
  description: "Browse and switch session history",
  descriptionKey: "chat.command.sessions",
  execute: () => {
    if (!sessionManager.isEnabled) return;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(OPEN_SESSIONS_EVENT));
  },
}] as const;

let registered = false;

export function registerSessionBuiltinCommands(): void {
  if (registered) return;
  for (const command of BUILTIN_COMMAND) {
    commandRegistry.register(command);
  }

  registered = true;
}

export function unregisterSessionBuiltinCommands(): void {
  if (!registered) return;
  for (const command of BUILTIN_COMMAND) {
    commandRegistry.unregister(command.name);
  }
  registered = false;
}
