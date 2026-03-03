import { miFoodFunctions } from "./mi-food-functions";
import type { SkillDefinition } from "../skill-registry";
import instructions from "./mi-food-instructions.md?raw";

// ─── Mi Food Skill Definition ────────────────────────────────────────────────

/**
 * Pre-registered Mi Food (米饭) skill that bundles:
 * - Skill metadata (name, description) for the system prompt catalog
 * - Full instructions (loaded on-demand via loadSkill) from mi-food-instructions.md
 * - Catering tool definitions (registered for browser-side execution)
 */
export const miFoodSkill: SkillDefinition = {
  name: "mi-food",
  cnName: "米饭",
  description:
    "miHoYo catering (米饭) operations. Supports two flows: in-place eating (堂食) to browse the on-site cafeteria menu, and pre-order (预订) to browse available shops, view their menus, and add meals to the shopping cart for pickup. Use when the user wants to see what food is available, check the menu, pre-order meals, or manage the meal shopping cart.",
  instructions,
  tools: miFoodFunctions,
};
