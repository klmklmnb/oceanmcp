import {
  INTERNAL_SENTRY_DSN,
  INTERNAL_SENTRY_TUNNEL,
  MIHOYO_SENTRY_BUNDLE_INTEGRITY,
  MIHOYO_SENTRY_BUNDLE_URL,
} from "./constants";
import type { RuntimeConfig } from "./types";

function resolveInternalEnvironment(): string {
  if (import.meta.env.DEV) {
    return "development";
  }

  return import.meta.env.MODE === "production"
    ? "production"
    : import.meta.env.MODE;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    dsn: INTERNAL_SENTRY_DSN,
    environment: resolveInternalEnvironment(),
    tunnel: INTERNAL_SENTRY_TUNNEL,
    integrations: undefined,
    bundleUrl: MIHOYO_SENTRY_BUNDLE_URL,
    bundleIntegrity: MIHOYO_SENTRY_BUNDLE_INTEGRITY,
  };
}
