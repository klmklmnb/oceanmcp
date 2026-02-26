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

// ─── Mount the Chat Widget ──────────────────────────────────────────────────
function mountOceanMCP() {
  let container = document.getElementById("ocean-mcp-root");
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
    // Dev mode: full height
    container.style.height = "100vh";
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

  /** Mount the chat widget (called automatically, can be re-called) */
  mount: mountOceanMCP,

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
if (typeof document !== "undefined" && import.meta.env.DEV) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountOceanMCP);
  } else {
    mountOceanMCP();
  }
}

export default OceanMCPSDK;
