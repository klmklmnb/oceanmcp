import type { LocaleKey } from "../locale";

export interface SlashCommand {
  /** Command name without `/`, e.g. `new` or `sessions`. */
  name: string;
  description: string;
  /** Optional i18n key resolved at render time. */
  descriptionKey?: LocaleKey;
  execute: (args?: string) => void | Promise<void>;
}

type RegistryChangeListener = () => void;

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

function normalizeName(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const raw = trimmed.slice(1).trim();
  if (!raw) {
    return { name: "", args: "" };
  }

  const firstSpaceIndex = raw.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return {
      name: normalizeName(raw),
      args: "",
    };
  }

  return {
    name: normalizeName(raw.slice(0, firstSpaceIndex)),
    args: raw.slice(firstSpaceIndex + 1).trim(),
  };
}

class CommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private listeners = new Set<RegistryChangeListener>();

  register(command: SlashCommand): void {
    const key = normalizeName(command.name);
    if (!key) {
      throw new Error("[OceanMCP] Slash command name cannot be empty.");
    }
    this.commands.set(key, {
      ...command,
      name: key,
    });
    this.notify();
  }

  unregister(name: string): boolean {
    const deleted = this.commands.delete(normalizeName(name));
    if (deleted) this.notify();
    return deleted;
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(normalizeName(name));
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  search(prefix: string): SlashCommand[] {
    const normalized = normalizeName(prefix);
    if (!normalized) return this.getAll();
    return this.getAll().filter((command) => command.name.startsWith(normalized));
  }

  subscribe(listener: RegistryChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const commandRegistry = new CommandRegistry();
