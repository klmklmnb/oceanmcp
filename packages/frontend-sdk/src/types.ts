/**
 * @ocean-mcp/frontend-sdk — Public Type Definitions
 *
 * This file is the **single source of truth** for every type that the SDK
 * exposes to host applications. Both the ESM bundle (`sdk.esm.d.ts`) and
 * the UMD global declaration (`sdk.umd.d.ts`) are generated from this file.
 *
 * Guidelines:
 * - Every type that a consumer might need should be exported from here.
 * - Internal implementation types should NOT be exported.
 * - When adding a new public type, add it here and it will automatically
 *   appear in both the ESM and UMD declaration outputs.
 */

// ─── Re-exports from oceanmcp-shared ───────────────────────────────────────
// These are the shared types that SDK consumers interact with when
// registering tools, skills, and configuring models.

export type {
  ModelConfig,
  FunctionDefinition,
  CodeFunctionDefinition,
  ExecutorFunctionDefinition,
  BaseFunctionDefinition,
  ParameterDefinition,
  ColumnConfig,
  FunctionSchema,
  FunctionParameters,
  JSONSchemaParameters,
  JSONSchemaProperty,
  FileAttachment,
  FlowPlan,
  FlowStep,
} from "oceanmcp-shared";

export {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
} from "oceanmcp-shared";

export type {
  FunctionType,
  OperationType,
  ParameterType,
} from "oceanmcp-shared";

// ─── Re-exports from internal modules ────────────────────────────────────────

export type { SkillDefinition } from "./registry/skill-registry";
export type { UploadHandler, UploadResult } from "./runtime/upload-registry";
export type { SupportedLocale, SuggestionItem, SubagentConfig, Theme } from "./runtime/sdk-config";
export type { SlashCommand } from "./command/command-registry";

// ─── SDK-specific types ──────────────────────────────────────────────────────

/** Mount target: a CSS selector string or an HTMLElement. */
export type MountTarget = string | HTMLElement;

/** Session behavior options for frontend persistence. */
export interface SessionOptions {
  /** Enable session persistence and session UI/commands. */
  enable?: boolean;
  /** Optional namespace to isolate storage across apps on same origin. */
  namespace?: string;
  /** Max number of sessions stored per namespace. 0 means unlimited. Default: 1000. */
  maxSessions?: number;
  /** Whether to inject built-in slash commands `/new` and `/sessions`. Default: true. */
  injectBuiltinSlashCommands?: boolean;
  /** Whether to show the bottom session-entry button. Default: true. */
  showBottomEntryButton?: boolean;
}

/** Options accepted by `OceanMCPSDK.mount()`. */
export interface MountOptions {
  /** CSS selector or element to mount into. */
  root?: MountTarget;
  /** UI locale. */
  locale?: import("./runtime/sdk-config").SupportedLocale;
  /** URL or data-URI for the assistant avatar image. */
  avatar?: string;
  /** Custom welcome screen title. */
  welcomeTitle?: string;
  /** Custom welcome screen description / subtitle. */
  welcomeDescription?: string;
  /**
   * LLM model configuration for chat requests.
   *
   * When set, the config is sent in every `/api/chat` request, allowing the
   * host app to control which models and parameters are used. Any field
   * omitted here falls back to the api-server's `LLM_*` environment
   * variables, then to built-in defaults.
   *
   * @example
   * ```ts
   * OceanMCPSDK.mount({
   *   model: { default: "gpt-4o", fast: "gpt-4o-mini", maxTokens: 8192 },
   * });
   * ```
   */
  model?: import("oceanmcp-shared").ModelConfig;
  /**
   * Whether to render the SDK inside a Shadow DOM for full style isolation.
   *
   * - `true` (default): The widget renders inside a shadow root.
   * - `false`: The widget renders directly in the light DOM.
   */
  shadowDOM?: boolean;
  /**
   * Custom suggestion questions displayed on the chat welcome screen.
   *
   * Each item has a `label` (button display text) and an optional `text`
   * (the message actually sent when clicked). If `text` is omitted, `label`
   * is used as both display and send text.
   *
   * When provided, these suggestions **replace** the default i18n
   * suggestions entirely.
   */
  suggestions?: import("./runtime/sdk-config").SuggestionItem[];
  /**
   * UI Theme preference: "light", "dark", or "auto".
   * - `light` (default): Uses light mode.
   * - `dark`: Uses dark mode.
   * - `auto`: Follows the user's operating system preferences.
   */
  theme?: import("./runtime/sdk-config").Theme;
  /**
   * Maximum number of times the LLM may retry a failed tool call
   * (per distinct tool ID, per chat turn).
   *
   * When a tool execution fails, the error is sent back to the LLM
   * which can analyse the failure and regenerate the call with
   * corrected parameters.  This setting caps how many retry attempts
   * are allowed before the error is surfaced to the user.
   *
   * - Applies independently to each tool ID (tool-A exhausting its
   *   budget does not affect tool-B).
   * - For write tools that require user approval (`executePlan`),
   *   the regenerated plan still goes through the approval flow.
   *
   * @default 5
   */
  toolRetries?: number;
  /**
   * Session options for persistence and isolation.
   *
    * Enabled by default; set `session: { enable: false }` to disable.
    * When `enable` is true, the SDK stores conversations in IndexedDB and
    * supports two UI/command toggles (both default to true):
    * - `injectBuiltinSlashCommands`: inject `/new` and `/sessions`
    * - `showBottomEntryButton`: show the bottom session-history button
    */
  session?: SessionOptions;
  /**
   * Subagent delegation configuration.
   *
   * When enabled, the main agent can delegate parallel research subtasks to
   * autonomous subagents that run in isolated context windows with read-only
   * tool access. Each subagent's progress streams into a collapsible UI card.
   *
   * Both this frontend config AND the server's `SUBAGENT_ENABLED` env var
   * must be truthy for the subagent tool to be active.
   *
   * @default { enable: false }
   *
   * @example
   * ```ts
   * OceanMCPSDK.mount({
   *   subagent: { enable: true },
   * });
   *
   * // With custom model and timeout:
   * OceanMCPSDK.mount({
   *   subagent: {
   *     enable: true,
   *     model: { default: "gpt-4o-mini" },
   *     timeoutSeconds: 60,
   *   },
   * });
   * ```
   */
  subagent?: import("./runtime/sdk-config").SubagentConfig;
  /** Whether to show verbose tool debug cards. Default is false. */
  debug?: boolean;
}

// ─── SDK Interface ───────────────────────────────────────────────────────────

/**
 * The public interface of the OceanMCP frontend SDK.
 *
 * ESM consumers get this as the type of the default export.
 * UMD consumers get this as `window.OceanMCPSDK`.
 */
export interface OceanMCPSDKType {
  /** Reactive locale — setting this dispatches a change event. */
  locale: import("./runtime/sdk-config").SupportedLocale | undefined;

  /** Reactive theme — setting this dispatches a change event. */
  theme: import("./runtime/sdk-config").Theme | undefined;

  /** Reactive debug mode for tool-call rendering. */
  debug: boolean;

  /**
   * Register a skill with bundled tools from the host application.
   *
   * @example
   * ```ts
   * OceanMCPSDK.registerSkill({
   *   name: 'inventory-ops',
   *   description: 'Manage product inventory.',
   *   instructions: '# Inventory Ops\n\n...',
   *   tools: [
   *     { id: 'getStock', type: 'executor', operationType: 'read',
   *       executor: async (args) => fetch(`/api/stock/${args.id}`).then(r => r.json()),
   *       parameters: [{ name: 'id', type: 'string', required: true }] },
   *   ],
   * });
   * ```
   */
  registerSkill(definition: import("./registry/skill-registry").SkillDefinition): void;

  /** Unregister a skill and its bundled tools by name. */
  unregisterSkill(name: string): void;

  /**
   * Register skill(s) from a remote `.zip` file hosted on a CDN.
   *
   * @param url - CDN URL pointing to a `.zip` file
   * @returns Promise resolving to the metadata of all discovered skills
   */
  registerSkillFromZip(url: string): Promise<Array<{ name: string; description: string }>>;

  /**
   * Register a standalone tool dynamically from the host application.
   * Supports both `'code'` and `'executor'` type definitions.
   */
  registerTool(
    definition: Partial<import("oceanmcp-shared").FunctionDefinition> & { id: string },
  ): void;

  /** Unregister a tool by ID. */
  unregisterTool(id: string): void;

  /** Get all registered tools. */
  getTools(): import("oceanmcp-shared").FunctionDefinition[];

  /** Get all registered skills. */
  getSkills(): import("./registry/skill-registry").SkillDefinition[];

  /**
   * Programmatically send a chat message.
   *
   * @param text - The message text to send
   */
  chat(text: string): Promise<void>;

  /**
   * Set the input box text without sending.
   */
  setInput(text: string): Promise<void>;

  /**
   * Get the current chat messages.
   */
  getMessages(): Promise<any[]>;

  /**
   * Clear all chat messages.
   */
  clearMessages(): Promise<void>;

  /**
   * Open the built-in session history dialog.
   *
   * Useful when host applications want to trigger the session dialog from
   * custom UI (buttons, menus, shortcuts) instead of using built-in entries.
   */
  openSessions(): Promise<void>;

  /**
   * Register a file upload handler.
   *
   * When registered, a paperclip button appears in the input area.
   *
   * @param handler - Async function that receives a `File[]` and returns `UploadResult[]`
   * @returns A function to unregister the handler
   */
  registerUploader(handler: import("./runtime/upload-registry").UploadHandler): () => void;

  /** Remove the registered upload handler. */
  unregisterUploader(): void;

  /** Register a slash command (without leading `/`). */
  registerCommand(command: import("./command/command-registry").SlashCommand): void;

  /** Unregister a slash command by name. */
  unregisterCommand(name: string): void;

  /**
   * Mount the chat widget to a specific target.
   *
   * @param target - CSS selector string, HTMLElement, or options object.
   *                 If not provided, creates a floating overlay.
   */
  mount(target?: MountTarget | MountOptions): void;

  /** Function registry for advanced usage. */
  functionRegistry: any;
  /** Skill registry for advanced usage. */
  skillRegistry: any;
  /** WebSocket client for advanced usage. */
  wsClient: any;
}
