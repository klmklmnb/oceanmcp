import React from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { functionRegistry, skillRegistry } from "./registry";
import type { SkillDefinition } from "./registry";
import { mockFunctions } from "./registry/mock/mockFunctions";
import { devopsSkill } from "./registry/devops";
import { miCoffeeSkill } from "./registry/mi-coffee";
import { wsClient } from "./runtime/ws-client";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type FunctionDefinition,
} from "@ocean-mcp/shared";
import "./styles/index.css";

// ─── Register pre-bundled mock functions ─────────────────────────────────────
for (const fn of mockFunctions) {
    functionRegistry.register(fn);
}

// ─── Register pre-bundled skills ─────────────────────────────────────────────
// Skills bundle both instructions (for the LLM) and tools (for browser-side
// execution). The skill registry sends metadata to the server, while tools
// are also added to the function registry for local execution.
const preregisteredSkills: SkillDefinition[] = [devopsSkill, miCoffeeSkill];

for (const skill of preregisteredSkills) {
  skillRegistry.register(skill);
  if (skill.tools) {
    for (const tool of skill.tools) {
      functionRegistry.register(tool);
    }
  }
}

// ─── Connect WebSocket to server ─────────────────────────────────────────────
wsClient.connect();

// ─── Mock: register a zip skill from CDN (dev mode only) ─────────────────────
// Demonstrates the registerSkillFromZip flow by loading a skill pack from a
// CDN-hosted .zip file. The server downloads, extracts, and discovers skills
// from the zip, then makes them available in the system prompt and loadSkill.
if (import.meta.env.DEV) {
  const ZIP_SKILL_URL =
    "https://fastcdn.mihoyo.com/static-resource-v2/2026/02/26/058beb1461340237f7a317cce3bc92c8_9174939835677374533.zip";

  // Wait for WebSocket to connect before sending the zip registration request
  const waitForConnection = () => {
    if (wsClient.isConnected) {
      wsClient
        .registerSkillFromZip(ZIP_SKILL_URL)
        .then((skills) => {
          console.log(
            `[OceanMCP][Mock] Zip skill(s) registered: ${skills.map((s) => s.name).join(", ")}`,
          );
        })
        .catch((err) => {
          console.error("[OceanMCP][Mock] Failed to register zip skill:", err);
        });
    } else {
      setTimeout(waitForConnection, 500);
    }
  };
  waitForConnection();
}

// ─── Mount the Chat Widget ──────────────────────────────────────────────────
type MountTarget = string | HTMLElement;

function mountOceanMCP(target?: MountTarget) {
  let container: HTMLElement | null = null;

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
        boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
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

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ChatWidget />
    </React.StrictMode>,
  );
}

// ─── Expose Global SDK API ───────────────────────────────────────────────────
const OceanMCPSDK = {
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
    console.log(
      `[OceanMCP] Zip skill(s) registered: ${skills.map((s) => s.name).join(", ")}`,
    );
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
      ...definition,
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
   * Mount the chat widget to a specific target.
   *
   * @param target - CSS selector string (e.g., "#my-container") or HTMLElement.
   *                 If not provided, creates a floating overlay or uses existing #ocean-mcp-root.
   * @example
   * ```ts
   * // Mount to a specific element
   * OceanMCPSDK.mount(document.getElementById("chat-container"));
   *
   * // Mount to an element by ID
   * OceanMCPSDK.mount("#my-chat");
   *
   * // Auto-create floating overlay (default behavior)
   * OceanMCPSDK.mount();
   * ```
   */
  mount(target?: MountTarget) {
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

// Auto-mount when script loads (dev mode only)
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountOceanMCP());
  } else {
    mountOceanMCP();
  }
}

export default OceanMCPSDK;
