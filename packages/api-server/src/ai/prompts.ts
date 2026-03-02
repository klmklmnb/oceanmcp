/**
 * System prompt construction and skills initialization.
 *
 * This module is responsible for:
 *   1. Loading the base system prompt from prompt.md
 *   2. Initializing the skills system (discovering skills at startup)
 *   3. Building the full system prompt (base + skills catalog)
 *   4. Exposing the sandbox + skills context for the loadSkill tool
 *
 * The system prompt includes skills from two sources:
 *   - File-based skills: discovered from SKILL.md files at startup
 *   - Frontend-registered skills: sent by browser clients via WebSocket
 *
 * When a connectionId is provided, the system prompt merges both sources
 * with file-based skills taking priority on name conflicts.
 *
 * Initialization order:
 *   1. Module loads → basePrompt read from disk (sync)
 *   2. Server startup → calls `initSkills()` (async)
 *   3. Chat requests → call `getSystemPrompt(connectionId?)` which includes
 *      both discovered and frontend-registered skills
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createNodeSandbox,
  discoverSkills,
  buildSkillsPrompt,
  type DiscoveredSkill,
} from "./skills";
import { connectionManager } from "../ws/connection-manager";
import basePrompt from "./prompt.md" with { type: "text" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Merges skills from three sources (in priority order):
 *   1. File-based skills: discovered from SKILL.md files at startup (global)
 *   2. Zip-loaded skills: downloaded from CDN URLs (per-connection)
 *   3. Frontend-registered skills: sent by browser clients via WebSocket (per-connection)
 *
 * File-based and zip-loaded skills (server-side) take priority over
 * frontend-registered skills on name conflicts.
 *
 * Called on every chat request to ensure the latest skills are included.
 */
const LOCALE_INSTRUCTIONS: Record<string, string> = {
  "zh-CN": "You MUST respond in Simplified Chinese (简体中文). All text output, explanations, and labels should be in Chinese.",
  "en-US": "You MUST respond in English. All text output, explanations, and labels should be in English.",
};

export function getSystemPrompt(connectionId?: string, locale?: string): string {
  const fileSkills = discoveredSkills;
  const zipSkills = connectionManager.getZipSkills(connectionId);
  const serverSkillNames = new Set(
    [...fileSkills, ...zipSkills].map((s) => s.name.toLowerCase()),
  );

  const frontendSkills = connectionManager.getSkillSchemas(connectionId);

  const allSkills: Array<{ name: string; description: string }> = [
    ...fileSkills,
    ...zipSkills,
    ...frontendSkills.filter(
      (s) => !serverSkillNames.has(s.name.toLowerCase()),
    ),
  ];

  let prompt = basePrompt + buildSkillsPrompt(allSkills);

  if (locale) {
    const instruction = LOCALE_INSTRUCTIONS[locale];
    if (instruction) {
      prompt += `\n\n## Language\n${instruction}\n`;
    }
  }

  return prompt;
}

/**
 * Get the sandbox and discovered skills for use by the loadSkill tool
 * and for merging skill-bundled tools into getMergedTools().
 *
 * Returns the sandbox instance and the combined list of file-based +
 * zip-loaded skills for the given connection. The tools/index.ts module
 * calls this to wire up the loadSkill tool and merge any tools exported
 * by skill directories.
 *
 * @param connectionId - Optional WS connection ID to include per-connection zip skills
 */
export function getSkillsContext(connectionId?: string) {
  return {
    sandbox,
    skills: [
      ...discoveredSkills,
      ...connectionManager.getZipSkills(connectionId),
    ],
  };
}
