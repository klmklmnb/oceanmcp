// Demo entry point - shows how to use the OceanMCP SDK
//
// This file demonstrates how to:
// 1. Import the SDK
// 2. Register pre-bundled skills and their tools
// 3. Mount the chat widget
//
// For production usage, you can:
// - Only import the SDK and use OceanMCPSDK.registerSkill() / registerTool()
// - Or skip this file entirely and use OceanMCPSDK in your own entry point

import OceanMCPSDK from "./main";

// ─── Register functions ─────────────────────────────────────
// These are example tools that come bundled with the SDK for demonstration.
// In production, register your own tools via OceanMCPSDK.registerTool()
import { mockFunctions } from "./registry/mock/mockFunctions";
for (const fn of mockFunctions) {
  OceanMCPSDK.registerTool(fn);
}

// ─── Register skills ─────────────────────────────────────────────
// Skills bundle instructions (for the LLM) and tools (for browser execution).
// In production, use OceanMCPSDK.registerSkill() or registerSkillFromZip()
import { devopsSkill } from "./registry/devops";
import { miCoffeeSkill } from "./registry/mi-coffee";

const preregisteredSkills = [devopsSkill, miCoffeeSkill];
for (const skill of preregisteredSkills) {
  OceanMCPSDK.registerSkill(skill);
}

// ─── Mount the chat widget ──────────────────────────────────────────────────
OceanMCPSDK.mount();
