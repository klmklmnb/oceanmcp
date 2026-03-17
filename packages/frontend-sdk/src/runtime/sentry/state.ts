import type { OceanWindow, SdkSentryState } from "./types";

export function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const globalScope = isBrowserEnvironment()
  ? (window as OceanWindow)
  : (globalThis as typeof globalThis & OceanWindow);

export const sentryState: SdkSentryState =
  globalScope.__OCEAN_MCP_SENTRY__ ??
  (globalScope.__OCEAN_MCP_SENTRY__ = {
    enabled: false,
    initialized: false,
    warnedMissingDsn: false,
    warnedInitFailure: false,
    tags: {},
  });
