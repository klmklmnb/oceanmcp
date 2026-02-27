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
import { miFoodSkill } from "./registry/mi-food";

const preregisteredSkills = [devopsSkill, miCoffeeSkill, miFoodSkill];
for (const skill of preregisteredSkills) {
  OceanMCPSDK.registerSkill(skill);
}

// ─── Register skill from zip ────────────────────────────────────────────────
OceanMCPSDK.registerSkillFromZip(
  "https://fastcdn.mihoyo.com/static-resource-v2/2026/02/26/058beb1461340237f7a317cce3bc92c8_9174939835677374533.zip",
);

// ─── Mount the chat widget ──────────────────────────────────────────────────
OceanMCPSDK.mount();
