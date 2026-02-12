import React from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { registry } from "./registry";
import { mockFunctions } from "./registry/mockFunctions";
import { wsClient } from "./runtime/ws-client";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type FunctionDefinition,
} from "@ocean-mcp/shared";
import "./styles/index.css";

// ─── Register pre-bundled mock functions ─────────────────────────────────────
for (const fn of mockFunctions) {
  registry.register(fn);
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
   * Register a tool dynamically from the host application.
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

    registry.register(fn);

    // Re-register tools with the server so it knows about the new tool
    if (wsClient.isConnected) {
      wsClient.registerTools();
    }

    console.log(`[OceanMCP] Tool registered: ${fn.id}`);
  },

  /** Unregister a tool by ID */
  unregisterTool(id: string) {
    registry.unregister(id);
    if (wsClient.isConnected) {
      wsClient.registerTools();
    }
  },

  /** Get all registered tools */
  getTools() {
    return registry.getAll();
  },

  /** Mount the chat widget (called automatically, can be re-called) */
  mount: mountOceanMCP,

  /** Registry and WebSocket client refs for advanced usage */
  registry: registry as any,
  wsClient: wsClient as any,
};

// Attach to window
if (typeof window !== "undefined") {
  (window as any).OceanMCPSDK = OceanMCPSDK;
}

// Auto-mount when script loads
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountOceanMCP);
  } else {
    mountOceanMCP();
  }
}

export default OceanMCPSDK;
