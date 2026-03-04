import type { ModelConfig } from "@ocean-mcp/shared";

export type SupportedLocale = "zh-CN" | "en-US";

export type Theme = "light" | "dark" | "auto";

/**
 * A suggestion question shown on the chat welcome screen.
 *
 * - `label` – the text displayed on the suggestion button.
 * - `text`  – the message actually sent to the chat when the button is
 *   clicked.  If omitted, `label` is used as both display and send text.
 */
export type SuggestionItem = {
  label: string;
  text?: string;
};

export type SDKConfig = {
  locale?: SupportedLocale;
  avatar?: string;
  welcomeTitle?: string;
  welcomeDescription?: string;
  /** LLM model configuration sent to the api-server on each chat request. */
  model?: ModelConfig;
  /** Custom welcome-screen suggestion questions. When set, replaces the default i18n suggestions. */
  suggestions?: SuggestionItem[];
  /** UI Theme preference: "light", "dark", or "auto" (follows system preference). Default is "light". */
  theme?: Theme;
};

const config: SDKConfig = {};

export const sdkConfig = {
  get locale(): SupportedLocale | undefined {
    return config.locale;
  },

  set locale(value: SupportedLocale | undefined) {
    config.locale = value;
  },

  get avatar(): string | undefined {
    return config.avatar;
  },

  set avatar(value: string | undefined) {
    config.avatar = value;
  },

  get welcomeTitle(): string | undefined {
    return config.welcomeTitle;
  },

  set welcomeTitle(value: string | undefined) {
    config.welcomeTitle = value;
  },

  get welcomeDescription(): string | undefined {
    return config.welcomeDescription;
  },

  set welcomeDescription(value: string | undefined) {
    config.welcomeDescription = value;
  },

  get model(): ModelConfig | undefined {
    return config.model;
  },

  set model(value: ModelConfig | undefined) {
    config.model = value;
  },

  get suggestions(): SuggestionItem[] | undefined {
    return config.suggestions;
  },

  set suggestions(value: SuggestionItem[] | undefined) {
    config.suggestions = value;
  },

  get theme(): Theme | undefined {
    return config.theme;
  },

  set theme(value: Theme | undefined) {
    const prev = config.theme;
    config.theme = value;
    if (prev !== value && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ocean-mcp:theme-change", { detail: value }));
    }
  },

  /** Resolve display name: returns cnName when locale is zh-CN, otherwise name */
  resolveDisplayName(name: string, cnName?: string): string {
    if (config.locale === "zh-CN" && cnName) return cnName;
    return name;
  },
};
