export type SupportedLocale = "zh-CN" | "en-US";

export type SDKConfig = {
  locale?: SupportedLocale;
  avatar?: string;
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

  /** Resolve display name: returns cnName when locale is zh-CN, otherwise name */
  resolveDisplayName(name: string, cnName?: string): string {
    if (config.locale === "zh-CN" && cnName) return cnName;
    return name;
  },
};
