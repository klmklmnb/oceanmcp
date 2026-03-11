/**
 * Wave configuration — types and environment variable loading.
 *
 * All Wave configuration is loaded from environment variables prefixed with
 * `WAVE_`. The module exports a typed config object and a loader function.
 */

/** Wave API environment */
export type WaveEnv = "Dev" | "Prod";

export interface WaveConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  aesKey: string;
  token: string;
  /** API environment: Dev (testing) | Prod (production). Default: Dev */
  env: WaveEnv;

  // ── Access Control ───────────────────────────────────────────────────
  /** DM policy: "open" allows all, "allowlist" restricts to allowFrom list */
  dmPolicy: "open" | "allowlist";
  /** Group policy: "open" allows all groups, "allowlist" restricts, "disabled" ignores group messages */
  groupPolicy: "open" | "allowlist" | "disabled";
  /** Comma-separated user IDs allowed for DM */
  allowFrom: string[];
  /** Comma-separated group/chat IDs allowed for group messages */
  groupAllowFrom: string[];
  /** Whether the bot must be @mentioned in group chats to respond */
  requireMention: boolean;

  // ── Chat ─────────────────────────────────────────────────────────────
  /** Maximum messages per session history. Default: 20 */
  historyLimit: number;
  /** Enable streaming card responses. Default: true */
  streaming: boolean;
}

/**
 * Parse a comma-separated env var into a trimmed string array.
 */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Load Wave configuration from environment variables.
 *
 * Returns `null` if `WAVE_ENABLED` is not `"true"`, indicating the Wave
 * integration should not be initialized.
 */
export function loadWaveConfig(): WaveConfig | null {
  if (process.env.WAVE_ENABLED !== "true") return null;

  const appId = process.env.WAVE_APP_ID ?? "";
  const appSecret = process.env.WAVE_APP_SECRET ?? "";
  const aesKey = process.env.WAVE_AES_KEY ?? "";
  const token = process.env.WAVE_TOKEN ?? "";

  if (!appId || !appSecret) {
    console.warn("[Wave] WAVE_ENABLED=true but WAVE_APP_ID or WAVE_APP_SECRET is missing. Wave integration disabled.");
    return null;
  }

  const envRaw = (process.env.WAVE_ENV ?? "Dev") as WaveEnv;
  const env: WaveEnv = envRaw === "Prod" ? "Prod" : "Dev";

  return {
    enabled: true,
    appId,
    appSecret,
    aesKey,
    token,
    env,
    dmPolicy: (process.env.WAVE_DM_POLICY as "open" | "allowlist") ?? "open",
    groupPolicy: (process.env.WAVE_GROUP_POLICY as "open" | "allowlist" | "disabled") ?? "disabled",
    allowFrom: parseList(process.env.WAVE_ALLOW_FROM),
    groupAllowFrom: parseList(process.env.WAVE_GROUP_ALLOW_FROM),
    requireMention: process.env.WAVE_REQUIRE_MENTION !== "false",
    historyLimit: Math.max(1, Number(process.env.WAVE_HISTORY_LIMIT) || 20),
    streaming: process.env.WAVE_STREAMING !== "false",
  };
}
