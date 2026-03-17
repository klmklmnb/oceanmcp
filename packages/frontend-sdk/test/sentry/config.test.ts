/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  INTERNAL_SENTRY_DSN,
  SENTRY_BUNDLE_INTEGRITY,
  SENTRY_BUNDLE_URL,
} from "../../src/runtime/sentry/constants";
import { getRuntimeConfig } from "../../src/runtime/sentry/config";

function getExpectedEnvironment(): string {
  if (import.meta.env.DEV) {
    return "development";
  }

  const mode = import.meta.env.MODE ?? "test";
  return mode === "production"
    ? "production"
    : mode;
}

describe("getRuntimeConfig", () => {
  it("returns the internal sentry runtime config", () => {
    expect(getRuntimeConfig()).toEqual({
      dsn: INTERNAL_SENTRY_DSN,
      environment: getExpectedEnvironment(),
      tunnel: undefined,
      integrations: undefined,
      bundleUrl: SENTRY_BUNDLE_URL,
      bundleIntegrity: SENTRY_BUNDLE_INTEGRITY,
    });
  });

  it("keeps the Sentry bundle location fixed inside the SDK", () => {
    expect(getRuntimeConfig()).toMatchObject({
      bundleUrl: SENTRY_BUNDLE_URL,
      bundleIntegrity: SENTRY_BUNDLE_INTEGRITY,
    });
  });
});
