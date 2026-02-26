/**
 * Skills system — public API.
 *
 * Re-exports everything needed to integrate skills into the chat pipeline.
 *
 * Usage in the api-server:
 *
 *   import {
 *     createNodeSandbox,    // Create a local filesystem sandbox
 *     discoverSkills,       // Scan directories for SKILL.md files
 *     buildSkillsPrompt,    // Generate the system prompt skills catalog
 *     createLoadSkillTool,  // Create the loadSkill AI tool
 *     loadSkillsFromZip,    // Download + extract a .zip CDN skill pack
 *   } from './skills';
 *
 * The Sandbox interface itself is exported from @ocean-mcp/shared, since
 * it's the cross-package contract for future remote implementations.
 */

export { createNodeSandbox } from "./sandbox";
export {
  discoverSkills,
  parseFrontmatter,
  stripFrontmatter,
} from "./discover";
export type { DiscoveredSkill } from "./discover";
export { buildSkillsPrompt, createLoadSkillTool } from "./loader";
export { loadSkillsFromZip, type ZipLoadResult } from "./zip-loader";
