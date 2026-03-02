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

import React from "react";
import { createRoot } from "react-dom/client";
import OceanMCPSDK from "./main";
import { TestPanel } from "./components/TestPanel";

// ─── Register skills ─────────────────────────────────────────────
import { devopsSkill } from "./registry/devops";
import { miCoffeeSkill } from "./registry/mi-coffee";
import { miFoodSkill } from "./registry/mi-food";

const preregisteredSkills = [devopsSkill, miCoffeeSkill, miFoodSkill];
for (const skill of preregisteredSkills) {
  OceanMCPSDK.registerSkill(skill);
}

// ─── Register skill from zip ────────────────────────────────────────────────
OceanMCPSDK.registerSkillFromZip(
  "https://fastcdn.mihoyo.com/static-resource-v2/2026/02/27/7cc1ae17ed278759a3ba318dafcecf27_7974366858840692508.zip",
);

// ─── Register upload handler (demo mock) ────────────────────────────────────
OceanMCPSDK.registerUploader(async (files: File[]) => {
  await new Promise((r) => setTimeout(r, 1000));
  return files.map((file) => ({
    url: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    type: file.type,
  }));
});

// ─── Mount the chat widget ──────────────────────────────────────────────────
OceanMCPSDK.mount({ locale: "zh-CN" });

// ─── Mount the test panel ───────────────────────────────────────────────────

const panelRoot = document.getElementById("demo-panel");
if (panelRoot) {
  createRoot(panelRoot).render(<TestPanel />);
}
