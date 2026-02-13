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
 */

import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@ocean-mcp/shared";
import { stripFrontmatter, type DiscoveredSkill } from "./discover";

// ─── System Prompt Builder ───────────────────────────────────────────────────

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
 * @param skills - Discovered skill metadata from startup
 * @returns Markdown section for the system prompt, or empty string
 */
export function buildSkillsPrompt(skills: DiscoveredSkill[]): string {
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
 *   2. Reads the full SKILL.md from the sandbox
 *   3. Strips the YAML frontmatter
 *   4. Returns the instruction body + the skill directory path
 *
 * The `skillDirectory` in the response is important: it allows the LLM to
 * construct full paths to bundled resources. For example, if a skill's
 * instructions say "read the template at templates/config.json", the LLM
 * can use `${skillDirectory}/templates/config.json` with the readFile tool.
 *
 * Error handling:
 *   - Unknown skill name → returns error with list of available skills
 *     (helps the LLM self-correct)
 *   - Sandbox read failure → returns error with the underlying message
 *
 * @param sandbox - Filesystem abstraction for reading skill files
 * @param skills - Discovered skill metadata from startup
 * @returns A Vercel AI SDK Tool instance
 */
export function createLoadSkillTool(
  sandbox: Sandbox,
  skills: DiscoveredSkill[],
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
      // ── Look up skill by name (case-insensitive) ─────────────────────
      const skill = skills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );

      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        return {
          error: `Skill '${name}' not found. Available skills: ${available || "none"}`,
        };
      }

      // ── Read and return the full SKILL.md body ──────────────────────
      try {
        const content = await sandbox.readFile(
          `${skill.path}/SKILL.md`,
          "utf-8",
        );
        const body = stripFrontmatter(content);

        return {
          /** Absolute path to the skill directory for resource access */
          skillDirectory: skill.path,
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
    },
  });
}
