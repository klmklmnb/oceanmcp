import enUS from "./en-US";
import zhCN from "./zh-CN";
import { sdkConfig } from "../runtime/sdk-config";

type LocaleMessages = typeof enUS;
export type LocaleKey = keyof LocaleMessages;

const locales: Record<string, LocaleMessages> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

/**
 * Get a localized string by key.
 * Falls back to en-US if the current locale or key is not found.
 */
export function t(key: LocaleKey, params?: Record<string, string | number>): string {
  const messages = locales[sdkConfig.locale ?? "zh-CN"] ?? zhCN;
  let text = messages[key] ?? enUS[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}
