// Demo entry point — comprehensive showcase of OceanMCP SDK capabilities.
//
// This file demonstrates how to:
// 1. Import the SDK
// 2. Register skills with browser-side tools
// 3. Mount the chat widget in a tabbed demo application
//
// The demo has three tabs:
// - Form: AI-driven dynamic form builder
// - TODO List: AI-managed task list with live UI updates
// - React Flow: AI-created flow diagrams with interactive canvas

import React from "react";
import { createRoot } from "react-dom/client";
import OceanMCPSDK from "./main";
import { DemoApp } from "./demo/DemoApp";
import { registerSkillFixtures, registerStandaloneToolFixtures } from "./test/tool-skill-fixtures";
import { jsonSchemaTestTools } from "./registry/base/baseFunctions";

// Register test fixture skills (including askUser form tests) in dev mode only
if (import.meta.env.DEV) {
  registerSkillFixtures(OceanMCPSDK);
  registerStandaloneToolFixtures(OceanMCPSDK);
  // Register JSON Schema test tools (demonstrates new parameter format)
  for (const fn of jsonSchemaTestTools) {
    OceanMCPSDK.functionRegistry.register(fn);
  }
}

// ─── Mount the Demo Application ─────────────────────────────────────────────
const root = document.getElementById("ocean-mcp-root");
if (root) {
  createRoot(root).render(<DemoApp />);
}
