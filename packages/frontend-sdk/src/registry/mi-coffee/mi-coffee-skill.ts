import { miCoffeeFunctions } from "./mi-coffee-functions";
import type { SkillDefinition } from "../skill-registry";
import instructions from "./mi-coffee-instructions.md?raw";

// ─── Mi Coffee Skill Definition ──────────────────────────────────────────────

/**
 * Pre-registered Mi Coffee skill that bundles:
 * - Skill metadata (name, description) for the system prompt catalog
 * - Full instructions (loaded on-demand via loadSkill) from mi-coffee-instructions.md
 * - Coffee shop tool definitions (registered for browser-side execution)
 */
export const miCoffeeSkill: SkillDefinition = {
  name: "mi-coffee",
  description:
    "miHoYo coffee shop operations. Browse the drink menu, view drink details and customization options, manage the shopping cart, and add drinks to cart. Use when the user wants to see available drinks, check drink options, or order from the coffee shop.",
  instructions,
  tools: miCoffeeFunctions,
};
