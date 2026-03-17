/**
 * Skill discovery — scans configured directories for SKILL.md files,
 * extracts metadata from YAML frontmatter, and optionally imports
 * bundled tool definitions.
 *
 * The discovery process follows the "progressive disclosure" pattern
 * from the AgentSkills specification (https://agentskills.io):
 *
 *   1. At startup, only name + description are loaded (lightweight metadata)
 *   2. Full SKILL.md body is loaded on-demand via the loadSkill tool
 *   3. Bundled resources (scripts/, references/, assets/) are accessed
 *      by the LLM using existing tools + the skillDirectory path
 *
 * Expected skill directory structure:
 *
 *   my-skill/
 *   ├── SKILL.md          # Required: YAML frontmatter + markdown instructions
 *   ├── tools.ts          # Optional: exports tool() definitions for the LLM
 *   ├── scripts/          # Optional: executable scripts
 *   ├── references/       # Optional: documentation the LLM can read
 *   └── assets/           # Optional: templates, configs, other resources
 *
 * Conflict resolution:
 *   When multiple directories are scanned, the first skill with a given name
 *   wins. This enables project-level skills to override user-level or global
 *   skills by placing the project directory earlier in the scan order.
 *
 *   Example: if both /project/skills/my-skill and ~/.config/ocean-mcp/skills/my-skill
 *   exist, the project-level one takes precedence when /project/skills is listed first.
 */

import type { Sandbox, SkillMetadata } from "oceanmcp-shared";
import type { Tool } from "ai";
import { wrapCodeFunctionDefinitions } from "./code-tool-adapter";

// ─── Extended Skill Metadata ─────────────────────────────────────────────────

/**
 * Extends the base `SkillMetadata` with optional dynamically-imported tools.
 *
 * When a skill directory contains a `tools.ts` file that exports tool
 * definitions (using Vercel AI SDK's `tool()` helper), those tools are
 * imported at discovery time and merged into the LLM's available tools
 * alongside server and browser-proxy tools.
 *
 * A skill's tools can be:
 *   - Server-side tools (with an `execute` function)
 *   - Browser-proxy tools (that delegate to connectionManager)
 *   - Client-side tools (without `execute`, rendered by the frontend)
 */
export interface DiscoveredSkill extends SkillMetadata {
  /**
   * Tools exported by the skill's tools.ts file (if present).
   * Keys are tool names, values are Vercel AI SDK Tool instances.
   * These are merged into getMergedTools() at the same level as
   * server tools and browser-proxy tools.
   */
  tools?: Record<string, Tool<any, any>>;
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from SKILL.md content.
 *
 * Supports a minimal subset of YAML: simple `key: value` pairs on separate
 * lines. This is intentional — we avoid adding a full YAML library dependency
 * for what is essentially just `name` and `description` fields.
 *
 * If richer frontmatter is needed in the future (nested objects, arrays, etc.),
 * replace this with a proper YAML parser (e.g. the `yaml` npm package).
 *
 * Expected format:
 *   ---
 *   name: my-skill
 *   description: Does something useful for the user.
 *   ---
 *   # Skill Instructions
 *   ...
 *
 * @param content - Raw SKILL.md file content
 * @returns Parsed name and description
 * @throws If no frontmatter block is found, or if name/description are missing
 */
export function parseFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    throw new Error("No frontmatter found in SKILL.md");
  }

  const lines = match[1].split("\n");
  const data: Record<string, string> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      data[key] = value;
    }
  }

  if (!data.name) {
    throw new Error('SKILL.md frontmatter missing required "name" field');
  }
  if (!data.description) {
    throw new Error(
      'SKILL.md frontmatter missing required "description" field',
    );
  }

  return { name: data.name, description: data.description };
}

/**
 * Strip YAML frontmatter from SKILL.md, returning only the markdown body.
 *
 * Used by the `loadSkill` tool to return instructions without metadata.
 * If no frontmatter is present, the entire content is returned as-is.
 *
 * @param content - Raw SKILL.md file content
 * @returns The markdown body with frontmatter removed and leading whitespace trimmed
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

// ─── Skill Discovery ─────────────────────────────────────────────────────────

/**
 * Discover all skills from the given directories.
 *
 * Scans each directory for subdirectories containing a valid SKILL.md file.
 * Extracts metadata from the frontmatter and optionally imports bundled
 * tool definitions from a tools.ts file.
 *
 * @param sandbox - Filesystem abstraction (local, remote, or mock for testing)
 * @param directories - Ordered list of directories to scan. Earlier entries
 *   have higher priority — the first skill with a given name wins, allowing
 *   project-level overrides of user-level or global skills.
 * @returns Array of discovered skill metadata, deduplicated by name
 *
 * @example
 * ```ts
 * const sandbox = createNodeSandbox(process.cwd());
 * const skills = await discoverSkills(sandbox, [
 *   '/project/skills',           // project-level (highest priority)
 *   '~/.config/ocean-mcp/skills' // user-level (lower priority)
 * ]);
 * ```
 */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    // ── Read directory entries ──────────────────────────────────────────
    let entries;
    try {
      entries = await sandbox.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or can't be read — skip silently.
      // This is expected: not all configured paths need to exist.
      // For example, ~/.config/ocean-mcp/skills/ may not exist yet.
      continue;
    }

    // ── Scan each subdirectory for SKILL.md ─────────────────────────────
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = `${dir}/${entry.name}`;
      const skillFile = `${skillDir}/SKILL.md`;

      try {
        const content = await sandbox.readFile(skillFile, "utf-8");
        const frontmatter = parseFrontmatter(content);

        // ── Deduplication: first skill with a given name wins ──────────
        // This enables project-level skills to override global ones
        // when the project directory is listed first in `directories`.
        if (seenNames.has(frontmatter.name)) continue;
        seenNames.add(frontmatter.name);

        const skill: DiscoveredSkill = {
          name: frontmatter.name,
          description: frontmatter.description,
          path: skillDir,
        };

        // ── Optional: import bundled tool definitions ──────────────────
        // Skills may export tools via a tools.ts (or tools.js) file.
        // These tools are dynamically imported and merged into the
        // LLM's available tools alongside server and browser-proxy tools.
        //
        // Supports two tool formats in the same export map:
        //   - Vercel AI SDK Tool objects (passed through as-is)
        //   - CodeFunctionDefinition objects (auto-wrapped into Tool via new Function())
        //
        // Expected tools.ts export shape:
        //   export default { myTool: tool({ ... }), myCodeTool: { type: "code", ... } }
        //   // or
        //   export const tools = { myTool: tool({ ... }), myCodeTool: { type: "code", ... } }
        try {
          const toolsModule = await import(`${skillDir}/tools.ts`);
          const exportedTools = toolsModule.default ?? toolsModule.tools;
          if (exportedTools && typeof exportedTools === "object") {
            skill.tools = wrapCodeFunctionDefinitions(exportedTools);
          }
        } catch {
          // No tools file or import failed — that's fine, tools are optional.
          // Most skills are prompt-only and don't bundle tool definitions.
        }

        skills.push(skill);
      } catch {
        // Invalid SKILL.md (missing file, bad frontmatter, etc.) — skip.
        // We log nothing here to avoid noise; skills with issues are simply
        // not discovered. Use the example skill as a valid reference.
        continue;
      }
    }
  }

  return skills;
}
