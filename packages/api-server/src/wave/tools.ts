/**
 * Wave-specific tool merging.
 *
 * Builds the tool set for Wave chat sessions. Similar to getMergedTools()
 * in tools/index.ts but WITHOUT browser proxy tools (`browserExecute`).
 * Wave uses its own server-side `executePlan` implementation because there
 * is no browser WebSocket connection in webhook flows.
 *
 * Tool sources:
 *   1. Server tools: askUser (Wave-native interactive card/form), getCurrentUser
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
import { sendAskUserCard } from "./message-sender";
import { addPendingSelection, type PendingSelectionOption } from "./pending-selections";
import {
  isSimpleSelectSchema,
  getSimpleSelectInfo,
  buildAskUserFormCard,
  parseFormValues,
  type AskUserSchema,
  type AskUserFieldSchema,
} from "./ask-user-form-builder";
import { imageOcr } from "../ai/tools/image-ocr-tool";
import { readPdf } from "../ai/tools/read-pdf-tool";
import { logger } from "../logger";

const WAVE_BLOB_DOWNLOAD_BASE_URL = "https://oc.app.mihoyo.com/blob/v1/download/";

function normalizeWaveImageReference(value: string): {
  kind: "public_url" | "blob_token" | "file_key" | "unknown";
  token?: string;
  url?: string;
} {
  if (/^https?:\/\//.test(value)) {
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (
        parsed.host === "oc.app.mihoyo.com" &&
        parsed.pathname.includes("/blob/v1/download/") &&
        lastSegment
      ) {
        return { kind: "public_url", token: lastSegment, url: value };
      }
      return { kind: "public_url", url: value };
    } catch {
      return { kind: "unknown" };
    }
  }
  if (value.startsWith("of_")) {
    return { kind: "file_key" };
  }
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) {
    return {
      kind: "blob_token",
      token: value,
      url: `${WAVE_BLOB_DOWNLOAD_BASE_URL}${value}`,
    };
  }
  return { kind: "unknown" };
}

/**
 * Create the Wave-native `askUser` tool.
 *
 * Unlike the generic `askUser` (which is client-side with no execute),
 * this version sends an interactive Wave card message and awaits the
 * user's response via the card reaction callback (EventMsgCardReaction).
 *
 * For simple single-field enum schemas, it sends buttons (≤3 options) or
 * a dropdown (>3 options) — same UX as the old `userSelect`.
 *
 * For multi-field or complex schemas, it sends a Wave form card with
 * the appropriate input elements (text, select, date picker, checkbox, etc.)
 * and a submit button. The user's response comes back via `form_values`.
 *
 * The tool's `execute()` returns a Promise that resolves when the user
 * responds. The AI SDK's multi-step mechanism pauses the stream while waiting.
 *
 * @param clients    - Wave SDK clients (for sending messages)
 * @param chatId     - The chat ID to send the interactive card to
 * @param sessionKey - Session key for correlation
 */
function createWaveAskUserTool(
  clients: WaveClients,
  chatId: string,
  sessionKey: string,
): Tool<any, any> {
  return tool({
    description:
      "Ask the user for input before continuing. ALWAYS prefer this tool over asking " +
      "questions in plain text — it provides a much better interactive experience " +
      "(form fields, dropdowns, date pickers, checkboxes, etc.). Use this whenever " +
      "you need the user to provide values, make choices, confirm information, or " +
      "answer questions. Provide a JSON Schema describing the fields you need. " +
      "An interactive card will be sent to the user in Wave.",
    inputSchema: z.object({
      message: z
        .string()
        .describe("Prompt or title text shown to the user above the form."),
      schema: z
        .object({
          type: z.literal("object"),
          properties: z.record(z.string(), z.any()),
          required: z.array(z.string()).optional(),
        })
        .describe(
          'JSON Schema (type:"object") describing the form fields the user should fill in.',
        ),
    }),
    execute: async (input) => {
      const promptMessage = input.message || "请提供以下信息";
      const schema = input.schema as AskUserSchema;

      if (!schema?.properties || Object.keys(schema.properties).length === 0) {
        return {
          error: "No fields provided in the schema. Please provide at least one field.",
        };
      }

      try {
        // Detect simple single-field enum → use button/dropdown card
        if (isSimpleSelectSchema(schema)) {
          const { fieldName, options, defaultValue } = getSimpleSelectInfo(schema);
          const opts: PendingSelectionOption[] = options.map((o) => ({
            value: o.value,
            label: o.label,
          }));

          const cardMsgId = await sendAskUserCard(
            clients,
            chatId,
            promptMessage,
            { mode: "simple-select", options: opts, defaultValue },
          );

          if (!cardMsgId) {
            return { error: "Failed to send interactive selection card." };
          }

          // Wait for the user to click an option
          const responseData = await addPendingSelection(
            cardMsgId,
            opts,
            sessionKey,
          );

          // Unwrap the simple-select response into the proper field name
          const selectedValue = responseData._selectedValue ?? Object.values(responseData)[0];
          const selectedOption = opts.find((o) => o.value === selectedValue);
          const selectedLabel = selectedOption?.label || selectedValue;
          return { [fieldName]: selectedValue, selectedLabel };
        }

        // Multi-field or complex schema → use form card
        const formContent = buildAskUserFormCard({
          message: promptMessage,
          schema,
        });

        const cardMsgId = await sendAskUserCard(
          clients,
          chatId,
          promptMessage,
          { mode: "form", formContent },
        );

        if (!cardMsgId) {
          return { error: "Failed to send interactive form card." };
        }

        // Wait for the user to submit the form
        const rawFormValues = await addPendingSelection(
          cardMsgId,
          [], // No simple options for form mode
          sessionKey,
        );

        // Parse and coerce form values back to the declared types
        const parsedValues = parseFormValues(rawFormValues, schema);

        return parsedValues;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[Wave] askUser failed:`, message);
        return { error: `User input failed: ${message}` };
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
        logger.error(`[Wave] getCurrentUser failed for ${senderId}:`, message);
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

      const normalizedEntries = keys.map((key) => ({
        original: String(key),
        normalized: normalizeWaveImageReference(String(key)),
      }));
      const directlyResolvableEntries = normalizedEntries.filter(
        (entry) =>
          entry.normalized.kind === "public_url" ||
          entry.normalized.kind === "blob_token",
      );
      const fileKeyEntries = normalizedEntries.filter(
        (entry) => entry.normalized.kind === "file_key",
      );
      const unknownEntries = normalizedEntries.filter(
        (entry) => entry.normalized.kind === "unknown",
      );

      if (directlyResolvableEntries.length > 0 && fileKeyEntries.length === 0 && unknownEntries.length === 0) {
        const urls: Record<string, string> = {};
        for (const entry of directlyResolvableEntries) {
          if (entry.normalized.url) {
            urls[entry.original] = entry.normalized.url;
          }
        }

        return {
          urls,
          invalidKeys: [],
        };
      }

      if (fileKeyEntries.length === 0) {
        const urls: Record<string, string> = {};
        for (const entry of directlyResolvableEntries) {
          if (entry.normalized.url) {
            urls[entry.original] = entry.normalized.url;
          }
        }

        return {
          urls,
          invalidKeys: unknownEntries.map((entry) => entry.original),
        };
      }

      try {
        const result = await clients.file.getFilePublicUrl(
          fileKeyEntries.map((entry) => entry.original),
        );

        logger.debug(
          `[Wave] getImageUrl: resolved=${result.file_url.length}, invalid=${result.invalid_file_key.length}`,
        );
        for (const entry of result.file_url) {
          logger.debug(`[Wave] getImageUrl: ${entry.file_key} → ${entry.file_url}`);
        }
        if (result.invalid_file_key.length > 0) {
          logger.debug(`[Wave] getImageUrl invalid keys: ${result.invalid_file_key.join(", ")}`);
        }

        const urls: Record<string, string> = {};
        for (const entry of directlyResolvableEntries) {
          if (entry.normalized.url) {
            urls[entry.original] = entry.normalized.url;
          }
        }
        for (const entry of result.file_url) {
          urls[entry.file_key] = entry.file_url;
        }

        return {
          urls,
          invalidKeys: [
            ...result.invalid_file_key,
            ...unknownEntries.map((entry) => entry.original),
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[Wave] getImageUrl failed:`, message);
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
 * @param clients - Wave SDK clients (for getCurrentUser + askUser tools)
 * @param senderId - The sender's union_id (for getCurrentUser tool)
 * @param sessionKey - Session key (for getCurrentUser caching)
 * @param chatId - The chat ID for sending interactive cards (askUser)
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
    askUser: createWaveAskUserTool(clients, chatId, sessionKey),
    getCurrentUser: createGetCurrentUserTool(clients, senderId, sessionKey),
    getImageUrl: createGetImageUrlTool(clients),
    imageOcr,
    readPdf,
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
    senderId,
  );

  return tools;
}
