/**
 * System prompt construction and skills initialization.
 *
 * This module is responsible for:
 *   1. Loading the base system prompt from prompt.md
 *   2. Initializing the skills system (discovering skills at startup)
 *   3. Building the full system prompt (base + skills catalog)
 *   4. Exposing the sandbox + skills context for the loadSkill tool
 *
 * The transition from a static `systemPrompt` export to `getSystemPrompt()`
 * is necessary because skill discovery is async (filesystem I/O), while the
 * base prompt can still be loaded synchronously at module evaluation time.
 *
 * Initialization order:
 *   1. Module loads → basePrompt read from disk (sync)
 *   2. Server startup → calls `initSkills()` (async)
 *   3. Chat requests → call `getSystemPrompt()` which includes discovered skills
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createNodeSandbox,
  discoverSkills,
  buildSkillsPrompt,
  type DiscoveredSkill,
} from "./skills";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Base Prompt ─────────────────────────────────────────────────────────────

/** Base system prompt loaded from prompt.md (sync, available immediately) */
const basePrompt = readFileSync(join(__dirname, "prompt.md"), "utf-8");

// ─── Skills System ───────────────────────────────────────────────────────────

/**
 * Sandbox instance for the skills system.
 *
 * Uses a NodeSandbox (local filesystem) pointing to the api-server
 * package root. To switch to remote skills in the future, replace with:
 *
 *   import { createRemoteSandbox } from './skills/sandbox';
 *   const sandbox = createRemoteSandbox('https://skills.cdn.example.com');
 */
const sandbox = createNodeSandbox(join(__dirname, "../.."));

/**
 * Skill directories to scan, in priority order (first wins on name conflicts).
 *
 * - Project skills: packages/api-server/skills/
 *   → Highest priority. Skills bundled with the project.
 *
 * Future additions:
 * - User-level skills: ~/.config/ocean-mcp/skills/
 * - Global skills: /usr/share/ocean-mcp/skills/
 */
const skillDirectories = [join(__dirname, "../../skills")];

/** Discovered skills — populated by initSkills(), empty until then */
let discoveredSkills: DiscoveredSkill[] = [];

/**
 * Initialize the skills system by scanning configured directories.
 *
 * Must be called (and awaited) before the server starts handling chat
 * requests. Typically called in the server's startup sequence:
 *
 *   await initSkills();
 *   const server = Bun.serve({ ... });
 *
 * Safe to call multiple times (re-discovers skills from scratch).
 */
export async function initSkills(): Promise<void> {
  discoveredSkills = await discoverSkills(sandbox, skillDirectories);
  if (discoveredSkills.length > 0) {
    console.log(
      `[Skills] Discovered ${discoveredSkills.length} skill(s): ${discoveredSkills.map((s) => s.name).join(", ")}`,
    );
  } else {
    console.log("[Skills] No skills discovered.");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full system prompt, including the skills catalog.
 *
 * Called on every chat request to ensure the latest skills are included.
 * The skills catalog section is empty if no skills were discovered,
 * making this safe to call even before initSkills().
 */
export function getSystemPrompt(): string {
  return basePrompt + buildSkillsPrompt(discoveredSkills);
}

/**
 * Get the sandbox and discovered skills for use by the loadSkill tool
 * and for merging skill-bundled tools into getMergedTools().
 *
 * Returns the sandbox instance and the current list of discovered skills.
 * The tools/index.ts module calls this to wire up the loadSkill tool and
 * merge any tools exported by skill directories.
 */
export function getSkillsContext() {
  return { sandbox, skills: discoveredSkills };
}
