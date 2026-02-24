/**
 * Skill loader — builds the skills catalog for the system prompt and
 * provides the `loadSkill` tool that the LLM calls to activate a skill.
 *
 * This module implements the "progressive disclosure" activation step:
 *
 *   1. `buildSkillsPrompt()` — injects lightweight skill names + descriptions
 *      into the system prompt. The LLM sees what's available but not the
 *      full instructions, keeping the context window lean.
 *
 *   2. `createLoadSkillTool()` — creates a Vercel AI SDK `tool()` that the
 *      LLM calls when a task matches a skill's description. The tool reads
 *      the full SKILL.md body and returns it, bringing detailed instructions
 *      into the conversation context on demand.
 *
 *   3. The LLM then follows the loaded instructions, using existing tools
 *      (browserExecute, executePlan, etc.) to access bundled resources via
 *      the `skillDirectory` path returned by loadSkill.
 *
 * Skills can come from two sources:
 *   - File-based: discovered from SKILL.md files on disk (DiscoveredSkill)
 *   - Frontend-registered: sent by the browser SDK via WebSocket (SkillSchema)
 *
 * File-based skills take priority over frontend-registered ones with the
 * same name, allowing server-side skills to override client-side ones.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Sandbox, SkillSchema } from "@ocean-mcp/shared";
import { stripFrontmatter, type DiscoveredSkill } from "./discover";

// ─── System Prompt Builder ───────────────────────────────────────────────────

/**
 * Minimal skill info needed for the system prompt catalog.
 * Both DiscoveredSkill and SkillSchema satisfy this shape.
 */
interface SkillCatalogEntry {
  name: string;
  description: string;
}

/**
 * Build the skills catalog section to append to the system prompt.
 *
 * Returns an empty string if no skills are discovered, making it safe to
 * always append: `basePrompt + buildSkillsPrompt(skills)`.
 *
 * The output format is designed so the LLM:
 *   1. Knows what skills exist (name + description)
 *   2. Knows *how* to activate them (call `loadSkill`)
 *   3. Doesn't waste context on full instructions until needed
 *
 * @param skills - Skill catalog entries from any source (file-based or frontend)
 * @returns Markdown section for the system prompt, or empty string
 */
export function buildSkillsPrompt(skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) return "";

  const skillsList = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `

# Available Skills

Use the \`loadSkill\` tool to load a skill when the user's task would benefit from specialized instructions. Only load a skill when the task clearly matches its description.

${skillsList}
`;
}

// ─── loadSkill Tool ──────────────────────────────────────────────────────────

/**
 * Create the `loadSkill` tool for the LLM.
 *
 * When called, this tool:
 *   1. Looks up the skill by name (case-insensitive)
 *   2. For file-based skills: reads the full SKILL.md from the sandbox,
 *      strips YAML frontmatter, returns instructions + skillDirectory
 *   3. For frontend-registered skills: returns the in-memory instructions
 *      directly (no skillDirectory — they don't live on the filesystem)
 *
 * Resolution priority:
 *   1. File-based DiscoveredSkill (from disk) — highest priority
 *   2. Frontend-registered SkillSchema (from WebSocket) — fallback
 *
 * This ensures server-side skills can override client-side ones with the
 * same name, which is useful for testing or gradual migration.
 *
 * @param sandbox - Filesystem abstraction for reading skill files
 * @param fileSkills - File-based skills discovered at startup
 * @param frontendSkills - Frontend-registered skills from the current connection
 * @returns A Vercel AI SDK Tool instance
 */
export function createLoadSkillTool(
  sandbox: Sandbox,
  fileSkills: DiscoveredSkill[],
  frontendSkills: SkillSchema[],
) {
  return tool({
    description:
      "Load a skill to get specialized instructions and workflows for a task. " +
      "Returns the full skill instructions and the skill directory path for accessing bundled resources.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The name of the skill to load (case-insensitive match)"),
    }),
    execute: async ({ name }) => {
      // ── 1. Look up file-based skill (highest priority) ───────────────
      const fileSkill = fileSkills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );

      if (fileSkill) {
        try {
          const content = await sandbox.readFile(
            `${fileSkill.path}/SKILL.md`,
            "utf-8",
          );
          const body = stripFrontmatter(content);

          return {
            /** Absolute path to the skill directory for resource access */
            skillDirectory: fileSkill.path,
            /** Full skill instructions (SKILL.md body without frontmatter) */
            content: body,
          };
        } catch (err) {
          return {
            error: `Failed to load skill '${name}': ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }
      }

      // ── 2. Look up frontend-registered skill (fallback) ──────────────
      const frontendSkill = frontendSkills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );

      if (frontendSkill) {
        return {
          /** Full skill instructions from the frontend registration */
          content: frontendSkill.instructions,
          // No skillDirectory — frontend skills don't have filesystem paths
        };
      }

      // ── 3. Skill not found ───────────────────────────────────────────
      const allNames = [
        ...fileSkills.map((s) => s.name),
        ...frontendSkills.map((s) => s.name),
      ];
      const available = allNames.join(", ");
      return {
        error: `Skill '${name}' not found. Available skills: ${available || "none"}`,
      };
    },
  });
}
