import React from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { functionRegistry, skillRegistry } from "./registry";
import type { SkillDefinition } from "./registry";
import { wsClient } from "./runtime/ws-client";
import { FUNCTION_TYPE, OPERATION_TYPE, type FunctionDefinition } from "@ocean-mcp/shared";
import { baseFunctions } from "./registry/base/baseFunctions";
import { chatBridge } from "./runtime/chat-bridge";
import { uploadRegistry, type UploadHandler } from "./runtime/upload-registry";
import { sdkConfig, type SupportedLocale, type SuggestionItem, type Theme } from "./runtime/sdk-config";
import type { ModelConfig } from "@ocean-mcp/shared";
import {
  createShadowHost,
  injectStyles,
  observeMonacoStyles,
  patchCssForShadowDom,
  hoistPropertyRulesToDocument
} from "./shadow-dom";

// Import CSS as a raw string (Vite `?inline` suffix) so we can inject it
// into the Shadow DOM instead of the document <head>.
import sdkStyles from "./styles/index.css?inline";

// ─── Register base functions ─────────────────────────────────────────────────
// These are built-in tools that ship with the SDK and are always available.
for (const fn of baseFunctions) {
  functionRegistry.register(fn);
}

// ─── Connect WebSocket to server ─────────────────────────────────────────────
// SDK connects to the backend so it can send registered capabilities (skills/tools)
// and receive function execution requests.
wsClient.connect();

// ─── Mount the Chat Widget ──────────────────────────────────────────────────
type MountTarget = string | HTMLElement;

type MountOptions = {
  root?: MountTarget;
  locale?: SupportedLocale;
  avatar?: string;
  welcomeTitle?: string;
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
   * // Use a specific model with token limit
   * OceanMCPSDK.mount({
   *   model: { default: "gpt-4o", fast: "gpt-4o-mini", maxTokens: 8192 },
   * });
   *
   * // Only override the default model
   * OceanMCPSDK.mount({ model: { default: "claude-sonnet-4-20250514" } });
   *
   * // Claude with custom thinking budget (tokens)
   * OceanMCPSDK.mount({
   *   model: { default: "mihoyo.claude-4-6-opus", thinkingBudget: 20480 },
   * });
   *
   * // OpenAI with reasoning effort
   * OceanMCPSDK.mount({
   *   model: { default: "gpt-5.1", reasoningEffort: "high" },
   * });
   *
   * // GLM with explicit thinking toggle
   * OceanMCPSDK.mount({
   *   model: { default: "mihoyo-glm-4.6", glmThinking: true },
   * });
   * ```
   */
  model?: ModelConfig;
  /**
   * Whether to render the SDK inside a Shadow DOM for full style isolation.
   *
   * - `true` (default): The widget renders inside a shadow root. Host-page
   *   styles cannot leak in and SDK styles cannot leak out. Tailwind v4
   *   `@property` rules are automatically patched for compatibility.
   * - `false`: The widget renders directly in the light DOM. Useful for
   *   development, debugging, or environments where Shadow DOM causes issues
   *   (e.g. certain browser extensions or test frameworks). Note that SDK
   *   styles **will** be injected into the document `<head>` and may
   *   interact with host-page styles.
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
   * suggestions entirely. If not provided, the built-in default suggestions
   * are shown.
   *
   * @example
   * ```ts
   * OceanMCPSDK.mount({
   *   suggestions: [
   *     { label: "What's on this page?", text: "Analyze the current page content in detail" },
   *     { label: "Help me debug", text: "Look at the console errors and help me fix them" },
   *     { label: "What can you do?" }, // text omitted → sends "What can you do?"
   *   ],
   * });
   * ```
   */
  suggestions?: SuggestionItem[];
  /**
   * UI Theme preference: "light", "dark", or "auto".
   * - `light` (default): Uses light mode.
   * - `dark`: Uses dark mode.
   * - `auto`: Follows the user's operating system preferences via `prefers-color-scheme`.
   */
  theme?: Theme;
};

/** Cleanup function returned by the Monaco style observer. */
let _cleanupMonacoObserver: (() => void) | null = null;

function mountOceanMCP(target?: MountTarget | MountOptions) {
  let container: HTMLElement | null = null;
  let useShadowDOM = true; // default: shadow DOM enabled

  // Handle options object
  if (target && typeof target === "object" && !("nodeType" in target)) {
    const options = target as MountOptions;
    if (options.locale) {
      sdkConfig.locale = options.locale;
    }
    if (options.avatar) {
      sdkConfig.avatar = options.avatar;
    }
    if (options.welcomeTitle !== undefined) {
      sdkConfig.welcomeTitle = options.welcomeTitle;
    }
    if (options.welcomeDescription !== undefined) {
      sdkConfig.welcomeDescription = options.welcomeDescription;
    }
    if (options.suggestions !== undefined) {
      sdkConfig.suggestions = options.suggestions;
    }
    if (options.model) {
      sdkConfig.model = options.model;
    }
    if (options.theme) {
      sdkConfig.theme = options.theme;
    }
    if (options.shadowDOM === false) {
      useShadowDOM = false;
    }
    target = options.root;
  }

  if (typeof target === "string") {
    container = document.getElementById(target);
  } else if (target instanceof HTMLElement) {
    container = target;
  } else {
    // Fallback: try to find existing container or create one
    container = document.getElementById("ocean-mcp-root");
    if (!container) {
      container = document.createElement("div");
      container.id = "ocean-mcp-root";
      // Float overlay style for injection into existing apps
      Object.assign(container.style, {
        position: "fixed",
        bottom: "0",
        right: "0",
        width: "420px",
        height: "600px",
        zIndex: "99999",
        borderRadius: "16px 16px 0 0",
        overflow: "hidden",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.12)"
      });
      document.body.appendChild(container);
    } else {
      // Existing container: full height
      container.style.height = "100vh";
    }
  }

  if (!container) {
    console.error("[OceanMCP] Mount target not found:", target);
    return;
  }

  let mountPoint: HTMLElement;

  if (useShadowDOM) {
    // ─── Shadow DOM isolation ────────────────────────────────────────────
    // All SDK UI renders inside a Shadow DOM so host-page styles cannot
    // leak in and SDK styles cannot leak out.
    const result = createShadowHost(container);
    mountPoint = result.mountPoint;

    // Patch Tailwind v4 CSS for Shadow DOM compatibility:
    // 1. Strip the @supports guard so --tw-* fallback variables always apply.
    // 2. Hoist @property rules to the document so typed initial values and
    //    animation interpolation still work (e.g. animating box-shadow).
    const patchedStyles = patchCssForShadowDom(sdkStyles);
    hoistPropertyRulesToDocument(sdkStyles);

    // Inject the (patched) SDK stylesheet into the shadow root.
    injectStyles(result.shadowRoot, patchedStyles);

    // Observe document.head for Monaco Editor's dynamically-injected <style>
    // tags and clone them into the shadow root.
    _cleanupMonacoObserver?.();
    _cleanupMonacoObserver = observeMonacoStyles(result.shadowRoot);
  } else {
    // ─── Light DOM mode (no Shadow DOM) ──────────────────────────────────
    // Render directly into the container. Styles are injected into the
    // document <head>. Useful for development or environments where
    // Shadow DOM is problematic.
    mountPoint = document.createElement("div");
    mountPoint.id = "ocean-mcp-inner";
    mountPoint.style.height = "100%";
    container.appendChild(mountPoint);

    // Inject SDK styles into <head> (skip if already present)
    const STYLE_ID = "ocean-mcp-styles";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = sdkStyles;
      document.head.appendChild(style);
    }
  }

  const root = createRoot(mountPoint);
  root.render(
    <React.StrictMode>
      <ChatWidget avatar={sdkConfig.avatar} />
    </React.StrictMode>
  );
}

// ─── Expose Global SDK API ───────────────────────────────────────────────────
const OceanMCPSDK = {
  /** Reactive locale — proxied to sdkConfig so the setter dispatches change events. */
  get locale(): SupportedLocale | undefined {
    return sdkConfig.locale;
  },
  set locale(value: SupportedLocale | undefined) {
    sdkConfig.locale = value;
  },

  /** Reactive theme — proxied to sdkConfig so the setter dispatches change events. */
  get theme(): Theme | undefined {
    return sdkConfig.theme;
  },
  set theme(value: Theme | undefined) {
    sdkConfig.theme = value;
  },

  /**
   * Register a skill with bundled tools from the host application.
   *
   * The skill's metadata (name, description) is added to the system prompt
   * catalog. Its full instructions are loaded on-demand via the `loadSkill`
   * tool. Bundled tools are registered in both the tool registry (for
   * browser-side execution) and sent to the server (for LLM access).
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
  registerSkill(definition: SkillDefinition) {
    skillRegistry.register(definition);

    // Also register bundled tools into the function registry for browser-side execution
    if (definition.tools) {
      for (const tool of definition.tools) {
        functionRegistry.register(tool);
      }
    }

    // Sync capabilities to server
    if (wsClient.isConnected) {
      wsClient.registerCapabilities();
    }

    console.log(`[OceanMCP] Skill registered: ${definition.name}`);
  },

  /** Unregister a skill and its bundled tools by name */
  unregisterSkill(name: string) {
    const skill = skillRegistry.get(name);
    if (skill?.tools) {
      for (const tool of skill.tools) {
        functionRegistry.unregister(tool.id);
      }
    }
    skillRegistry.unregister(name);

    if (wsClient.isConnected) {
      wsClient.registerCapabilities();
    }

    console.log(`[OceanMCP] Skill unregistered: ${name}`);
  },

  /**
   * Register skill(s) from a remote .zip file hosted on a CDN.
   *
   * The zip is downloaded and extracted on the server. Skills are discovered
   * using the same directory convention as server-side file-based skills:
   *
   *   - If the zip root contains `SKILL.md`, it's treated as a single skill.
   *     Subdirectories are NOT scanned (they're treated as resources).
   *   - Otherwise, each subdirectory containing a `SKILL.md` is registered
   *     as a separate skill.
   *
   * Registered skills are added to the server's discovered skills pool and
   * become available in the system prompt catalog and via `loadSkill`.
   *
   * @param url - CDN URL pointing to a .zip file
   * @returns Promise resolving to the metadata of all discovered skills
   *
   * @example
   * ```ts
   * // Single skill zip
   * const skills = await OceanMCPSDK.registerSkillFromZip(
   *   'https://cdn.example.com/skills/pdf-processing.zip',
   * );
   *
   * // Multi-skill zip
   * const skills = await OceanMCPSDK.registerSkillFromZip(
   *   'https://cdn.example.com/skills/devops-pack.zip',
   * );
   * console.log('Registered:', skills.map(s => s.name));
   * ```
   */
  async registerSkillFromZip(url: string) {
    const skills = await wsClient.registerSkillFromZip(url);
    console.log(`[OceanMCP] Zip skill(s) registered: ${skills.map((s) => s.name).join(", ")}`);
    return skills;
  },

  /**
   * Register a standalone tool dynamically from the host application.
   * Supports both 'code' and 'executor' type definitions.
   */
  registerTool(definition: Partial<FunctionDefinition> & { id: string }) {
    const fn: FunctionDefinition = {
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.READ,
      parameters: [],
      name: definition.id,
      description: "",
      ...definition
    } as FunctionDefinition;

    functionRegistry.register(fn);

    // Re-register capabilities with the server so it knows about the new tool
    if (wsClient.isConnected) {
      wsClient.registerCapabilities();
    }

    console.log(`[OceanMCP] Tool registered: ${fn.id}`);
  },

  /** Unregister a tool by ID */
  unregisterTool(id: string) {
    functionRegistry.unregister(id);
    if (wsClient.isConnected) {
      wsClient.registerCapabilities();
    }
  },

  /** Get all registered tools */
  getTools() {
    return functionRegistry.getAll();
  },

  /** Get all registered skills */
  getSkills() {
    return skillRegistry.getAll();
  },

  /**
   * Programmatically send a chat message.
   *
   * The text is briefly shown in the input box for visual feedback,
   * then automatically submitted as a user message.
   *
   * @param text - The message text to send
   * @returns Promise that resolves when the message has been sent
   *
   * @example
   * ```ts
   * await OceanMCPSDK.chat("What's on this page?");
   * ```
   */
  async chat(text: string) {
    return chatBridge.call("chat", text);
  },

  /**
   * Set the input box text without sending.
   *
   * @example
   * ```ts
   * OceanMCPSDK.setInput("draft message...");
   * ```
   */
  async setInput(text: string) {
    return chatBridge.call("setInput", text);
  },

  /**
   * Get the current chat messages.
   */
  async getMessages() {
    return chatBridge.call<any[]>("getMessages");
  },

  /**
   * Clear all chat messages.
   */
  async clearMessages() {
    return chatBridge.call("clearMessages");
  },

  /**
   * Register a file upload handler.
   *
   * When registered, a paperclip button appears in the input area.
   * Clicking it opens a file picker. All selected files are passed to
   * your handler as an array, which should upload them and return the results.
   * The results are then sent as a user message in the chat.
   *
   * @param handler - Async function that receives a File[] and returns UploadResult[]
   * @returns A function to unregister the handler
   *
   * @example
   * ```ts
   * OceanMCPSDK.registerUploader(async (files) => {
   *   const form = new FormData();
   *   files.forEach((file) => form.append('files', file));
   *   const res = await fetch('/api/upload', { method: 'POST', body: form });
   *   const data = await res.json();
   *   return data.map((d, i) => ({
   *     url: d.url, name: files[i].name, size: files[i].size, type: files[i].type,
   *   }));
   * });
   * ```
   */
  registerUploader(handler: UploadHandler) {
    uploadRegistry.register(handler);
    console.log("[OceanMCP] Upload handler registered");
    return () => this.unregisterUploader();
  },

  /** Remove the registered upload handler. The upload button will be hidden. */
  unregisterUploader() {
    uploadRegistry.unregister();
    console.log("[OceanMCP] Upload handler unregistered");
  },

  /**
   * Mount the chat widget to a specific target.
   *
   * @param target - CSS selector string, HTMLElement, or options object with
   *                 root, locale, and shadowDOM settings.
   *                 If not provided, creates a floating overlay or uses existing #ocean-mcp-root.
   *
   * @example
   * ```ts
   * // Mount to a specific element (shadow DOM enabled by default)
   * OceanMCPSDK.mount(document.getElementById("chat-container"));
   *
   * // Mount to an element by ID
   * OceanMCPSDK.mount("#my-chat");
   *
   * // Mount with locale configuration
   * OceanMCPSDK.mount({ locale: "zh-CN" });
   * OceanMCPSDK.mount({ root: "#my-chat", locale: "zh-CN" });
   *
   * // Mount with custom welcome message and suggestions
   * OceanMCPSDK.mount({
   *   welcomeTitle: "My AI Assistant",
   *   welcomeDescription: "Ask me anything about this page!",
   *   suggestions: ["Help me get started", "What can you do?", "Show me examples"]
   * });
   *
   * // Mount with LLM model configuration
   * OceanMCPSDK.mount({ model: { default: "gpt-4o", maxTokens: 8192 } });
   * OceanMCPSDK.mount({
   *   root: "#my-chat",
   *   model: { default: "gpt-4o", fast: "gpt-4o-mini", maxTokens: 16384 },
   *   locale: "zh-CN",
   * });
   *
   * // Mount without Shadow DOM (light DOM mode)
   * OceanMCPSDK.mount({ shadowDOM: false });
   * OceanMCPSDK.mount({ root: "#my-chat", shadowDOM: false });
   *
   * // Auto-create floating overlay (default behavior)
   * OceanMCPSDK.mount();
   * ```
   */
  mount(target?: MountTarget | MountOptions) {
    mountOceanMCP(target);
  },

  /** Registry and WebSocket client refs for advanced usage */
  functionRegistry: functionRegistry as any,
  skillRegistry: skillRegistry as any,
  wsClient: wsClient as any,
};

// Attach to window
if (typeof window !== "undefined") {
  (window as any).OceanMCPSDK = OceanMCPSDK;
}

// In production/SDK usage, call OceanMCPSDK.mount() explicitly

export default OceanMCPSDK;
export type { SuggestionItem };
