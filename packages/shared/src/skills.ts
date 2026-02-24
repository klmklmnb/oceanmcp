/**
 * Shared skill types used across the OceanMCP monorepo.
 *
 * These types are intentionally kept in the shared package so that both
 * the api-server (which discovers and loads skills) and potentially the
 * frontend-sdk (which may display skill info in the UI) can reference them
 * without circular dependencies.
 */

import type { FunctionSchema } from "./types";

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

/**
 * Serializable skill definition sent from the frontend to the server
 * via WebSocket as part of the REGISTER_CAPABILITIES message.
 *
 * Unlike file-based skills (which are discovered from SKILL.md files on
 * disk), these skills are registered dynamically by the host application
 * at runtime via `window.OceanMCPSDK.registerSkill()`.
 *
 * The server stores these in memory per connection and integrates them
 * into the skills system:
 *   - `name` + `description` are added to the system prompt skills catalog
 *   - `instructions` are returned on-demand via the `loadSkill` tool
 *   - `tools` (if present) are merged into the LLM's available tools
 *
 * @example
 * ```ts
 * const skill: SkillSchema = {
 *   name: 'inventory-ops',
 *   description: 'Manage product inventory: stock levels, transfers, audits.',
 *   instructions: '# Inventory Ops\n\nWhen handling inventory tasks...',
 *   tools: [
 *     { id: 'getStockLevel', name: 'Get Stock Level', ... },
 *   ],
 * };
 * ```
 */
export interface SkillSchema {
  /**
   * Unique skill identifier. Used by the `loadSkill` tool parameter
   * and for deduplication (file-based skills with the same name take
   * priority over frontend-registered ones).
   */
  name: string;

  /**
   * Human-readable description telling the LLM when to use this skill.
   * Included in the system prompt's skills catalog section.
   */
  description: string;

  /**
   * Full markdown instructions returned by the `loadSkill` tool on-demand.
   * Equivalent to the body of a SKILL.md file (without YAML frontmatter).
   */
  instructions: string;

  /**
   * Tool definitions bundled with this skill.
   * These are serialized schemas (no executor functions) — the actual
   * execution happens browser-side via the WebSocket proxy, same as
   * standalone dynamically-registered tools.
   */
  tools?: FunctionSchema[];
}
