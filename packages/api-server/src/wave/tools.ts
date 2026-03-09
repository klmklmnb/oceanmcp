/**
 * Wave-specific tool merging.
 *
 * Builds the tool set for Wave chat sessions. Similar to getMergedTools()
 * in tools/index.ts but WITHOUT browser proxy tools (browserExecute,
 * executePlan) since there is no browser WebSocket connection.
 *
 * Tool sources:
 *   1. Server tools: userSelect
 *   2. loadSkill tool (when any skills exist)
 *   3. Skill-bundled tools (from tools.ts exports — server-side execute)
 *   4. File-based skills discovered at startup (global)
 *
 * All tools here have real server-side `execute` functions.
 */

import type { Tool } from "ai";
import type { Sandbox } from "@ocean-mcp/shared";
import { userSelect } from "../ai/tools/user-select-tool";
import { createLoadSkillTool } from "../ai/skills/loader";
import type { DiscoveredSkill } from "../ai/skills/discover";

/**
 * Build the merged tool set for a Wave chat session.
 *
 * @param fileSkills - File-based skills discovered at startup
 * @param zipSkills - Skills loaded from the webhook's ?skills= URL
 * @param sandbox - Filesystem sandbox for skill resource loading
 */
export function buildWaveTools(
  fileSkills: DiscoveredSkill[],
  zipSkills: DiscoveredSkill[],
  sandbox: Sandbox,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    userSelect,
  };

  const allSkills = [...fileSkills, ...zipSkills];

  if (allSkills.length > 0) {
    // loadSkill allows the LLM to load full skill instructions on-demand.
    // No frontend skills in Wave context (empty array for frontendSkills).
    tools.loadSkill = createLoadSkillTool(sandbox, allSkills, []);

    // Merge tools exported by skill directories (from tools.ts files).
    // These have real server-side execute functions.
    for (const skill of allSkills) {
      if (!skill.tools) continue;
      for (const [name, skillTool] of Object.entries(skill.tools)) {
        if (tools[name]) continue; // Collision avoidance — first wins
        tools[name] = skillTool;
      }
    }
  }

  return tools;
}
