/**
 * Wave-specific tool merging.
 *
 * Builds the tool set for Wave chat sessions. Similar to getMergedTools()
 * in tools/index.ts but WITHOUT browser proxy tools (browserExecute,
 * executePlan) since there is no browser WebSocket connection.
 *
 * Tool sources:
 *   1. Server tools: userSelect, getCurrentUser
 *   2. loadSkill tool (when any skills exist)
 *   3. Skill-bundled tools (from tools.ts exports — server-side execute)
 *   4. File-based skills discovered at startup (global)
 *
 * All tools here have real server-side `execute` functions.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@ocean-mcp/shared";
import { userSelect } from "../ai/tools/user-select-tool";
import { createLoadSkillTool } from "../ai/skills/loader";
import type { DiscoveredSkill } from "../ai/skills/discover";
import type { WaveClients } from "./client";
import { waveSessionManager, type WaveUserInfo } from "./session-manager";

/**
 * Create the `getCurrentUser` tool.
 *
 * Returns a tool that fetches the current message sender's user info
 * via the Wave contact:user API. Results are cached in the session
 * to avoid redundant API calls within the same conversation.
 *
 * @param clients - Wave SDK clients (needs `contact` for getUsers)
 * @param senderId - The sender's union_id from the webhook event
 * @param sessionKey - Session key for caching the result
 */
function createGetCurrentUserTool(
  clients: WaveClients,
  senderId: string,
  sessionKey: string,
): Tool<any, any> {
  return tool({
    description:
      "Get information about the current user who sent this message, " +
      "including their name, display name, email, avatar URL, user ID, etc.",
    inputSchema: z.object({}),
    execute: async () => {
      // Check session cache first
      const cached = waveSessionManager.getUserInfo(sessionKey, senderId);
      if (cached) return cached;

      try {
        const result = await clients.contact.getUsers([senderId], {
          uid_type: "union_id" as any,
        });

        const user = result?.users?.[0];
        if (!user) {
          return { error: `User not found for id: ${senderId}` };
        }

        const userInfo: WaveUserInfo = {
          name: user.name,
          en_name: user.en_name,
          nick_name: user.nick_name,
          avatar: user.avatar,
          union_id: user.union_id,
          user_id: user.user_id,
          display_status: user.display_status,
          email: user.email,
        };

        // Cache in session for subsequent calls
        waveSessionManager.setUserInfo(sessionKey, senderId, userInfo);
        return userInfo;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Wave] getCurrentUser failed for ${senderId}:`, message);
        return { error: `Failed to fetch user info: ${message}` };
      }
    },
  });
}

/**
 * Build the merged tool set for a Wave chat session.
 *
 * @param fileSkills - File-based skills discovered at startup
 * @param zipSkills - Skills loaded from the webhook's ?skills= URL
 * @param sandbox - Filesystem sandbox for skill resource loading
 * @param clients - Wave SDK clients (for getCurrentUser tool)
 * @param senderId - The sender's union_id (for getCurrentUser tool)
 * @param sessionKey - Session key (for getCurrentUser caching)
 */
export function buildWaveTools(
  fileSkills: DiscoveredSkill[],
  zipSkills: DiscoveredSkill[],
  sandbox: Sandbox,
  clients: WaveClients,
  senderId: string,
  sessionKey: string,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    userSelect,
    getCurrentUser: createGetCurrentUserTool(clients, senderId, sessionKey),
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
