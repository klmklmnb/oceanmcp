/**
 * Shared skill types used across the OceanMCP monorepo.
 *
 * These types are intentionally kept in the shared package so that both
 * the api-server (which discovers and loads skills) and potentially the
 * frontend-sdk (which may display skill info in the UI) can reference them
 * without circular dependencies.
 */

/**
 * Lightweight metadata extracted from a skill's SKILL.md frontmatter.
 *
 * Only the `name` and `description` are loaded at discovery time
 * (progressive disclosure pattern). The full SKILL.md body is loaded
 * on-demand when the LLM calls the `loadSkill` tool, keeping the
 * system prompt lean and the context window efficient.
 *
 * @example
 * ```ts
 * const skill: SkillMetadata = {
 *   name: 'pdf-processing',
 *   description: 'Extract text and tables from PDF files, fill forms, merge documents.',
 *   path: '/project/skills/pdf-processing',
 * };
 * ```
 */
export interface SkillMetadata {
  /**
   * Short identifier from the SKILL.md frontmatter.
   * Used as the key for deduplication and the `loadSkill` tool parameter.
   * Example: "pdf-processing", "k8s-ops"
   */
  name: string;

  /**
   * Human-readable description telling the LLM when to use this skill.
   * Included in the system prompt's skills catalog section.
   */
  description: string;

  /**
   * Absolute path (or URL, for future remote sandboxes) to the skill
   * directory. Used by the `loadSkill` tool to read the full SKILL.md
   * and by the LLM to construct paths to bundled resources
   * (scripts/, references/, assets/).
   */
  path: string;
}
