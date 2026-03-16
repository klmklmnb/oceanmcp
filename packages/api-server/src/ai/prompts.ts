/**
 * System prompt construction and skills initialization.
 *
 * This module is responsible for:
 *   1. Loading the base system prompt from prompt.md
 *   2. Initializing the skills system (discovering skills at startup)
 *   3. Building the full system prompt (base + skills catalog)
 *   4. Exposing the sandbox + skills context for the loadSkill tool
 *
 * The system prompt includes skills from two sources:
 *   - File-based skills: discovered from SKILL.md files at startup
 *   - Frontend-registered skills: sent by browser clients via WebSocket
 *
 * When a connectionId is provided, the system prompt merges both sources
 * with file-based skills taking priority on name conflicts.
 *
 * Initialization order:
 *   1. Module loads → basePrompt read from disk (sync)
 *   2. Server startup → calls `initSkills()` (async)
 *   3. Chat requests → call `getSystemPrompt(connectionId?)` which includes
 *      both discovered and frontend-registered skills
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createNodeSandbox,
  discoverSkills,
  buildSkillsPrompt,
  type DiscoveredSkill,
} from "./skills";
import { connectionManager } from "../ws/connection-manager";
import { logger } from "../logger";
import basePrompt from "./prompt.md" with { type: "text" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Skills System ───────────────────────────────────────────────────────────

/**
 * Sandbox instance for the skills system.
 *
 * Uses a NodeSandbox (local filesystem) pointing to the api-server
 * package root. To switch to remote skills in the future, replace with:
 *
 *   import { createRemoteSandbox } from './skills/sandbox';
 *   const sandbox = createRemoteSandbox('https://skills.cdn.example.com');
 */
const sandbox = createNodeSandbox(join(__dirname, "../.."));

/**
 * Skill directories to scan, in priority order (first wins on name conflicts).
 *
 * - Project skills: packages/api-server/skills/
 *   → Highest priority. Skills bundled with the project.
 *
 * Future additions:
 * - User-level skills: ~/.config/ocean-mcp/skills/
 * - Global skills: /usr/share/ocean-mcp/skills/
 */
const skillDirectories = [join(__dirname, "../../skills")];

/** Discovered skills — populated by initSkills(), empty until then */
let discoveredSkills: DiscoveredSkill[] = [];

/**
 * Initialize the skills system by scanning configured directories.
 *
 * Must be called (and awaited) before the server starts handling chat
 * requests. Typically called in the server's startup sequence:
 *
 *   await initSkills();
 *   const server = Bun.serve({ ... });
 *
 * Safe to call multiple times (re-discovers skills from scratch).
 */
export async function initSkills(): Promise<void> {
  discoveredSkills = await discoverSkills(sandbox, skillDirectories);
  if (discoveredSkills.length > 0) {
    logger.info(
      `[Skills] Discovered ${discoveredSkills.length} skill(s): ${discoveredSkills.map((s) => s.name).join(", ")}`,
    );
  } else {
    logger.info("[Skills] No skills discovered.");
  }
}

// ─── Template Variables ──────────────────────────────────────────────────────

/**
 * Replace `{{ varName }}` placeholders in the prompt template with values.
 * Unmatched placeholders are removed (replaced with empty string).
 */
function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_match, key: string) => vars[key] ?? "",
  );
}

const SUBAGENT_PROMPT_SECTION = `# Subagent Delegation (Parallel Sub-Tasks)

For complex tasks that benefit from parallel execution, you can delegate independent subtasks to subagents using the \`subagent\` tool.

**When to use subagents:**
- Tasks requiring parallel research or data gathering from multiple sources
- Independent subtasks that don't depend on each other's results
- Tasks that would consume too much context if done in sequence

**Subagent constraints:**
- Subagents can ONLY use READ tools — they cannot perform write/mutation operations
- Subagents are fully autonomous — they cannot ask the user questions
- If a subtask ultimately requires a write operation, instruct the subagent to gather and return the necessary parameters (e.g. IDs, configurations, values). Then perform the write yourself using \`executePlan\`.

**How to call:**
- Provide a clear, self-contained \`task\` description
- Write a \`systemPrompt\` that tells the subagent:
  - What input/context it has
  - What specific task to accomplish
  - What output format to produce in its final response
  - That it can only read data and must write a clear summary as its final response
- You can call multiple \`subagent\` tools in parallel in a single step for concurrent work
- After receiving all subagent results, synthesize them into a coherent response for the user

---`;

const UPLOAD_PROMPT_SECTION = `# File Uploads

The user has a file upload capability enabled. They can attach files to their messages using the paperclip button or by dragging and dropping files into the chat.

When the user uploads files, each file appears in the message as a structured block:

\`\`\`
[Uploaded file]
- Name: <filename>
- Type: <MIME type>
- Size: <file size>
- URL: <accessible URL>
\`\`\`

**Guidelines for handling uploaded files:**
- Acknowledge uploaded files and refer to them by name.
- Use the file URL when you need to reference or process the file content.
- The metadata fields (Name, Type, Size, URL) and any additional fields are provided by the upload handler and can be used in subsequent tool calls.
- If a skill or tool requires file attachments (e.g. for creating records with attachments), use the uploaded file information as provided — do not modify or reconstruct it.

---`;

// ─── Locale Instructions ─────────────────────────────────────────────────────

const LOCALE_INSTRUCTIONS: Record<string, string> = {
  "zh-CN": "\n\n请用简体中文回复用户的所有消息。",
  "en-US": "\n\nPlease respond to all user messages in English.",
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Options for building the system prompt.
 */
export interface SystemPromptOptions {
  /** Optional WS connection ID for per-connection skills. */
  connectionId?: string;
  /** Optional locale string (e.g., "zh-CN", "en-US") to append language instructions. */
  locale?: string;
  /** Whether the subagent feature is enabled for this request. Default: false. */
  subagentEnabled?: boolean;
  /** Whether the frontend has a file upload handler registered. Default: false. */
  uploaderRegistered?: boolean;
}

/**
 * Get the full system prompt, including the skills catalog.
 *
 * Merges skills from three sources (in priority order):
 *   1. File-based skills: discovered from SKILL.md files at startup (global)
 *   2. Zip-loaded skills: downloaded from CDN URLs (per-connection)
 *   3. Frontend-registered skills: sent by browser clients via WebSocket (per-connection)
 *
 * File-based and zip-loaded skills (server-side) take priority over
 * frontend-registered skills on name conflicts.
 *
 * Template variables in prompt.md are resolved:
 *   - `{{ subagent_section }}` → subagent delegation instructions (when enabled) or empty
 *   - `{{ upload_section }}` → file upload instructions (when uploader is registered) or empty
 *
 * Called on every chat request to ensure the latest skills are included.
 *
 * @param options - System prompt options (connectionId, locale, subagentEnabled, uploaderRegistered)
 */
export function getSystemPrompt(options?: SystemPromptOptions): string;
/**
 * @deprecated Use the options-object overload instead.
 */
export function getSystemPrompt(connectionId?: string, locale?: string): string;
export function getSystemPrompt(
  connectionIdOrOptions?: string | SystemPromptOptions,
  localeArg?: string,
): string {
  // Support both old (positional) and new (options object) signatures
  let connectionId: string | undefined;
  let locale: string | undefined;
  let subagentEnabled = false;
  let uploaderRegistered = false;

  if (typeof connectionIdOrOptions === "object" && connectionIdOrOptions !== null) {
    connectionId = connectionIdOrOptions.connectionId;
    locale = connectionIdOrOptions.locale;
    subagentEnabled = connectionIdOrOptions.subagentEnabled === true;
    uploaderRegistered = connectionIdOrOptions.uploaderRegistered === true;
  } else {
    connectionId = connectionIdOrOptions;
    locale = localeArg;
  }

  // Resolve template variables
  const templateVars: Record<string, string> = {
    subagent_section: subagentEnabled ? SUBAGENT_PROMPT_SECTION : "",
    upload_section: uploaderRegistered ? UPLOAD_PROMPT_SECTION : "",
  };

  const renderedPrompt = renderPromptTemplate(basePrompt, templateVars);

  // Server-side skills: file-based (global) + zip-loaded (per-connection)
  const fileSkills = discoveredSkills;
  const zipSkills = connectionManager.getZipSkills(connectionId);
  const serverSkillNames = new Set(
    [...fileSkills, ...zipSkills].map((s) => s.name.toLowerCase()),
  );

  // Frontend-registered skills (per-connection), excluding name conflicts
  const frontendSkills = connectionManager.getSkillSchemas(connectionId);

  const allSkills: Array<{ name: string; description: string }> = [
    ...fileSkills,
    ...zipSkills,
    ...frontendSkills.filter(
      (s) => !serverSkillNames.has(s.name.toLowerCase()),
    ),
  ];

  let system = renderedPrompt + buildSkillsPrompt(allSkills);

  // Always encourage using the askUser tool over plain-text questions
  system += "\n\nWhen you need to ask the user a question, collect information, or have the user make a choice, " +
    "ALWAYS prefer using the `askUser` tool instead of asking in plain text. " +
    "The `askUser` tool renders an interactive form (dropdowns, text inputs, date pickers, checkboxes, etc.) " +
    "which provides a much better user experience than plain-text questions.";

  if (locale && LOCALE_INSTRUCTIONS[locale]) {
    system += LOCALE_INSTRUCTIONS[locale];
  }

  return system;
}

/**
 * Get the sandbox and discovered skills for use by the loadSkill tool
 * and for merging skill-bundled tools into getMergedTools().
 *
 * Returns the sandbox instance and the combined list of file-based +
 * zip-loaded skills for the given connection. The tools/index.ts module
 * calls this to wire up the loadSkill tool and merge any tools exported
 * by skill directories.
 *
 * @param connectionId - Optional WS connection ID to include per-connection zip skills
 */
export function getSkillsContext(connectionId?: string) {
  return {
    sandbox,
    skills: [
      ...discoveredSkills,
      ...connectionManager.getZipSkills(connectionId),
    ],
  };
}

/**
 * Get the base system prompt components for non-browser channels (e.g. Wave).
 *
 * Returns the base prompt text, the sandbox instance, and the file-based
 * discovered skills. The caller is responsible for merging channel-specific
 * skills (e.g. zip-loaded) and building the full system prompt.
 */
export function getBasePromptContext() {
  return {
    basePrompt,
    sandbox,
    discoveredSkills,
  };
}
