import { hoyowaveApiFunctions } from "./hoyowave-api-functions";
import type { SkillDefinition } from "../skill-registry";
import instructions from "./hoyowave-api-instructions.md?raw";

// ─── HoYowave API Skill Definition ──────────────────────────────────────────

/**
 * Pre-registered HoYowave API skill that bundles:
 * - Skill metadata (name, description) for the system prompt catalog
 * - Full instructions (loaded on-demand via loadSkill) from hoyowave-api-instructions.md
 * - HoYowave JS API tool definitions (registered for browser-side execution)
 *
 * This skill should only be registered when the page is running inside the
 * HoYowave (Wave) app. Use {@link isWaveEnv} from the index barrel to check.
 */
export const hoyowaveApiSkill: SkillDefinition = {
  name: "hoyowave-api",
  cnName: "HoYowave API",
  description:
    "HoYowave JS API bridge for the Wave app environment. Provides device system info, toast notifications, navigation bar customization, webview/browser URL opening, and chat conversations. Only available inside the HoYowave (Wave) app — detected by navigator.userAgent containing 'wave'.",
  instructions,
  tools: hoyowaveApiFunctions,
};
