/**
 * Wave-specific tool merging.
 *
 * Builds the tool set for Wave chat sessions. Similar to getMergedTools()
 * in tools/index.ts but WITHOUT browser proxy tools (`browserExecute`).
 * Wave uses its own server-side `executePlan` implementation because there
 * is no browser WebSocket connection in webhook flows.
 *
 * Tool sources:
 *   1. Server tools: userSelect (Wave-native interactive card), getCurrentUser
 *   2. loadSkill tool (when any skills exist)
 *   3. Skill-bundled tools (from tools.ts exports — server-side execute)
 *   4. File-based skills discovered at startup (global)
 *
 * All tools here have real server-side `execute` functions.
 *
 * Write tool guard:
 *   Skill-bundled tools that require approval (write/mutation operations) are
 *   wrapped with a guard that rejects direct LLM calls and directs the LLM to
 *   use `executePlan` instead. When `executePlan` invokes the tool after user
 *   approval, it passes `__waveExecutePlanApproved: true` in the options,
 *   bypassing the guard. This mirrors the browser flow's `browserExecute`
 *   write guard (browser-proxy-tool.ts) adapted for Wave's card-based approval.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@ocean-mcp/shared";
import { createLoadSkillTool } from "../ai/skills/loader";
import type { DiscoveredSkill } from "../ai/skills/discover";
import type { WaveClients } from "./client";
import { createWaveExecutePlanTool } from "./execute-plan-tool";
import { waveSessionManager, type WaveUserInfo } from "./session-manager";
import { sendUserSelectCard } from "./message-sender";
import { addPendingSelection, type PendingSelectionOption } from "./pending-selections";
import { imageOcr } from "../ai/tools/image-ocr-tool";

/**
 * Create the Wave-native `userSelect` tool.
 *
 * Unlike the generic `userSelect` (which is client-side with no execute),
 * this version sends an interactive Wave card message (buttons for ≤3 options,
 * dropdown for >3 options) and awaits the user's click via the card reaction
 * callback (EventMsgCardReaction).
 *
 * The tool's `execute()` returns a Promise that resolves when the user clicks
 * an option. The AI SDK's multi-step mechanism pauses the stream while waiting.
 *
 * @param clients    - Wave SDK clients (for sending messages)
 * @param chatId     - The chat ID to send the interactive card to
 * @param sessionKey - Session key for correlation
 */
function createWaveUserSelectTool(
  clients: WaveClients,
  chatId: string,
  sessionKey: string,
): Tool<any, any> {
  return tool({
    description:
      "Ask the user to select one option before continuing. " +
      "Use this whenever a value is uncertain and there are known or inferred candidate options. " +
      "An interactive card (buttons or dropdown) will be sent to the user in Wave.",
    inputSchema: z
      .object({
        functionId: z
          .string()
          .optional()
          .describe(
            "Optional target tool ID. Use with parameterName to resolve option metadata from the target tool.",
          ),
        parameterName: z
          .string()
          .optional()
          .describe(
            "Optional target parameter name on functionId. Used to resolve enumMap/display hints when explicit options are not provided.",
          ),
        message: z
          .string()
          .optional()
          .describe("Optional prompt text shown to the user."),
        options: z
          .array(
            z.object({
              value: z.any().describe("The raw option value."),
              label: z
                .string()
                .optional()
                .describe("Optional user-facing option label."),
              description: z
                .string()
                .optional()
                .describe("Optional extra detail shown with the option."),
            }),
          )
          .optional()
          .describe(
            "Explicit candidate options. For non-enum parameters, prefer providing this after reasoning candidates from context/descriptions.",
          ),
      })
      .refine(
        (input) =>
          (Array.isArray(input.options) && input.options.length > 0) ||
          Boolean(input.functionId && input.parameterName),
        {
          message:
            "Provide either non-empty options, or both functionId and parameterName.",
        },
      ),
    execute: async (input) => {
      const promptMessage = input.message || "请选择一个选项";
      const opts: PendingSelectionOption[] = (input.options ?? []).map(
        (o: { value?: any; label?: string; description?: string }) => ({
          value: String(o.value ?? ""),
          label: o.label || (o.description ? `${o.value} — ${o.description}` : undefined),
        }),
      );

      if (opts.length === 0) {
        return {
          error:
            "No options provided and functionId/parameterName resolution is not supported in Wave context. Please provide explicit options.",
        };
      }

      try {
        // Send the interactive card
        const cardMsgId = await sendUserSelectCard(
          clients,
          chatId,
          promptMessage,
          opts,
        );

        if (!cardMsgId) {
          return { error: "Failed to send interactive selection card." };
        }

        // Wait for the user to click an option (resolved by onMsgCardReaction)
        const selectedValue = await addPendingSelection(
          cardMsgId,
          opts,
          sessionKey,
        );

        // Find the label for the selected value
        const selectedOption = opts.find((o) => o.value === selectedValue);
        const selectedLabel = selectedOption?.label || selectedValue;

        return { selectedValue, selectedLabel };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Wave] userSelect failed:`, message);
        return { error: `Selection failed: ${message}` };
      }
    },
  });
}

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
      const cached = await waveSessionManager.getUserInfo(sessionKey, senderId);
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
        await waveSessionManager.setUserInfo(sessionKey, senderId, userInfo);
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
 * Create the `getImageUrl` tool.
 *
 * Resolves a Wave `image_key` (file reference) to a temporary public URL
 * via the Wave File API. The returned URL is valid for ~10 minutes.
 *
 * @param clients - Wave SDK clients (needs `file` for getFilePublicUrl)
 */
function createGetImageUrlTool(
  clients: WaveClients,
): Tool<any, any> {
  return tool({
    description:
      "Resolve a Wave image_key to a temporary public URL (valid ~10 minutes). " +
      "Use this when you need to access the actual image content from an image_key reference. " +
      "Accepts a single image_key or an array of image_keys for batch resolution.",
    inputSchema: z.object({
      imageKeys: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "A single image_key string or an array of image_key strings to resolve.",
        ),
    }),
    execute: async (input) => {
      const keys = Array.isArray(input.imageKeys)
        ? input.imageKeys
        : [input.imageKeys];

      if (keys.length === 0) {
        return { error: "No image keys provided." };
      }

      try {
        const result = await clients.file.getFilePublicUrl(keys);

        if (process.env.DEBUG === "true") {
          console.log(
            `[Wave][Debug] getImageUrl: resolved=${result.file_url.length}, invalid=${result.invalid_file_key.length}`,
          );
          for (const entry of result.file_url) {
            console.log(`[Wave][Debug] getImageUrl: ${entry.file_key} → ${entry.file_url}`);
          }
          if (result.invalid_file_key.length > 0) {
            console.log(`[Wave][Debug] getImageUrl invalid keys: ${result.invalid_file_key.join(", ")}`);
          }
        }

        const urls: Record<string, string> = {};
        for (const entry of result.file_url) {
          urls[entry.file_key] = entry.file_url;
        }

        return {
          urls,
          invalidKeys: result.invalid_file_key,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Wave] getImageUrl failed:`, message);
        return { error: `Failed to resolve image URLs: ${message}` };
      }
    },
  });
}

// ── Write Tool Guard ─────────────────────────────────────────────────────────

/**
 * Detect whether a tool requires approval (i.e. is a write/mutation tool).
 *
 * In the Vercel AI SDK, `needsApproval` can be `true` (static) or a function
 * (dynamic validation gate, as used by the browser executePlan tool). Either
 * form indicates the tool is a write operation that needs user confirmation.
 *
 * In the Wave webhook flow there is no browser UI to handle `needsApproval`,
 * so we intercept these tools and redirect them through `executePlan`.
 */
function isWriteTool(t: Tool<any, any>): boolean {
  const raw = (t as any).needsApproval;
  return raw === true || typeof raw === "function";
}

/**
 * Wrap a write/mutation skill tool with a guard for the Wave context.
 *
 * When the LLM calls this tool directly, `execute()` returns an error
 * instructing it to use `executePlan` instead.
 *
 * When `executePlan` calls this tool after the user approves the plan card,
 * it passes `__waveExecutePlanApproved: true` in the options object,
 * which bypasses the guard and delegates to the original `execute()`.
 *
 * The resulting tool:
 *   - Preserves the original `description` and `inputSchema`
 *   - Preserves the original `execute` (accessible to executePlan)
 *   - Strips `needsApproval` (not applicable in Wave — no browser UI)
 */
function wrapWriteToolWithGuard(
  toolName: string,
  originalTool: Tool<any, any>,
): Tool<any, any> {
  const orig = originalTool as any;
  const originalExecute = orig.execute as (
    args: Record<string, any>,
    options?: Record<string, any>,
  ) => Promise<any>;

  return tool({
    description: orig.description,
    inputSchema: orig.inputSchema,
    execute: async (args: Record<string, any>, options?: Record<string, any>) => {
      // executePlan passes this flag after user approval on the Wave card
      if (options?.__waveExecutePlanApproved) {
        return originalExecute(args, options);
      }

      return {
        error:
          `Function "${toolName}" is a write/mutation operation and cannot be ` +
          `called directly in Wave. You MUST use the executePlan tool to ` +
          `propose a plan that includes this operation, which sends an ` +
          `approval card for the user to approve before execution.`,
      };
    },
  });
}

/**
 * Build the merged tool set for a Wave chat session.
 *
 * @param fileSkills - File-based skills discovered at startup
 * @param zipSkills - Skills loaded from the webhook's ?skills= URL
 * @param sandbox - Filesystem sandbox for skill resource loading
 * @param clients - Wave SDK clients (for getCurrentUser + userSelect tools)
 * @param senderId - The sender's union_id (for getCurrentUser tool)
 * @param sessionKey - Session key (for getCurrentUser caching)
 * @param chatId - The chat ID for sending interactive cards (userSelect)
 */
export function buildWaveTools(
  fileSkills: DiscoveredSkill[],
  zipSkills: DiscoveredSkill[],
  sandbox: Sandbox,
  clients: WaveClients,
  senderId: string,
  sessionKey: string,
  chatId: string,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    userSelect: createWaveUserSelectTool(clients, chatId, sessionKey),
    getCurrentUser: createGetCurrentUserTool(clients, senderId, sessionKey),
    getImageUrl: createGetImageUrlTool(clients),
    imageOcr,
  };

  const allSkills = [...fileSkills, ...zipSkills];

  if (allSkills.length > 0) {
    // loadSkill allows the LLM to load full skill instructions on-demand.
    // No frontend skills in Wave context (empty array for frontendSkills).
    tools.loadSkill = createLoadSkillTool(sandbox, allSkills, []);

    // Merge tools exported by skill directories (from tools.ts files).
    // These have real server-side execute functions.
    //
    // Write/mutation tools (those with `needsApproval`) are wrapped with a
    // guard that rejects direct LLM calls and directs the LLM to use
    // `executePlan`. The guard is bypassed when executePlan invokes the
    // tool after user approval via the `__waveExecutePlanApproved` flag.
    for (const skill of allSkills) {
      if (!skill.tools) continue;
      for (const [name, skillTool] of Object.entries(skill.tools)) {
        if (tools[name]) continue; // Collision avoidance — first wins
        tools[name] = isWriteTool(skillTool)
          ? wrapWriteToolWithGuard(name, skillTool)
          : skillTool;
      }
    }
  }

  tools.executePlan = createWaveExecutePlanTool(
    () => tools,
    clients,
    chatId,
    sessionKey,
  );

  return tools;
}
