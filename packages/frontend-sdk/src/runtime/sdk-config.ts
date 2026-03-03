import type { ModelConfig } from "@ocean-mcp/shared";

export type SupportedLocale = "zh-CN" | "en-US";

export type SDKConfig = {
  locale?: SupportedLocale;
  avatar?: string;
  /** LLM model configuration sent to the api-server on each chat request. */
  model?: ModelConfig;
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

  get model(): ModelConfig | undefined {
    return config.model;
  },

  set model(value: ModelConfig | undefined) {
    config.model = value;
  },

  /** Resolve display name: returns cnName when locale is zh-CN, otherwise name */
  resolveDisplayName(name: string, cnName?: string): string {
    if (config.locale === "zh-CN" && cnName) return cnName;
    return name;
  },
};
