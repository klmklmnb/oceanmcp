import { hoyocloudFunctions } from "./hoyocloud";
import type { SkillDefinition } from "../skill-registry";
import instructions from "./devops-instructions.md?raw";

// ─── DevOps Skill Definition ─────────────────────────────────────────────────

/**
 * Pre-registered DevOps skill that bundles:
 * - Skill metadata (name, description) for the system prompt catalog
 * - Full instructions (loaded on-demand via loadSkill) from devops-instructions.md
 * - All hoyocloud tool definitions (registered for browser-side execution)
 *
 * This replaces the file-based skills/devops/ directory on the api-server.
 * The tools are the same CodeFunctionDefinition entries from hoyocloud.ts,
 * and the instructions are imported from devops-instructions.md at build time.
 */
export const devopsSkill: SkillDefinition = {
  name: "devops",
  cnName: "运维",
  description:
    "Frontend DevOps operations for the Trinity platform. Handles deploy group management, archive deployment, work order lifecycle, cluster operations, and dynamic render HTML updates. Use when the user wants to deploy, release, publish, or manage frontend static resources across testing, pre, and prod environments.",
  instructions,
  tools: hoyocloudFunctions,
};
