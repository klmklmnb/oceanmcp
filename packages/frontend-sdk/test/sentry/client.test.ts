import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimeConfig,
  SdkSentryState,
} from "../../src/runtime/sentry/types";

const hoisted = vi.hoisted(() => ({
  runtimeConfig: {
    dsn: "https://public@example.ingest.sentry.io/1",
    environment: "test",
    tunnel: undefined,
    integrations: undefined,
    bundleUrl: "https://cdn.test/scripts/sentry@8.13.0/bundle.min.js",
    bundleIntegrity: undefined,
  } as RuntimeConfig,
  sentryState: {
    current: undefined,
    runningPromise: undefined,
    enabled: false,
    initialized: false,
    warnedMissingDsn: false,
    warnedInitFailure: false,
    tags: {},
  } as SdkSentryState,
  loadIframeSentryMock: vi.fn(),
  resolveIntegrationsMock: vi.fn(() => ["filtered"]),
  getSdkContextMock: vi.fn(() => ({ build: "demo" })),
  getSdkTagsMock: vi.fn(() => ({ sdk_build: "demo" })),
}));

vi.mock("../../src/runtime/sentry/config", () => ({
  getRuntimeConfig: () => hoisted.runtimeConfig,
}));
vi.mock("../../src/runtime/sentry/iframe-loader", () => ({
  loadIframeSentry: hoisted.loadIframeSentryMock,
}));
vi.mock("../../src/runtime/sentry/integrations", () => ({
  resolveIntegrations: hoisted.resolveIntegrationsMock,
}));
vi.mock("../../src/runtime/sentry/metadata", () => ({
  getSdkContext: hoisted.getSdkContextMock,
  getSdkTags: hoisted.getSdkTagsMock,
}));
vi.mock("../../src/runtime/sentry/state", () => ({
  isBrowserEnvironment: () => true,
  sentryState: hoisted.sentryState,
}));

function createSentryModule() {
  return {
    init: vi.fn(),
    withScope: vi.fn(),
    captureException: vi.fn(),
    captureEvent: vi.fn(),
    addBreadcrumb: vi.fn(),
    setContext: vi.fn(),
    setTags: vi.fn(),
    setUser: vi.fn(),
    getDefaultIntegrations: vi.fn(() => []),
  };
}

describe("initSentryBrowser", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(hoisted.runtimeConfig, {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "test",
      tunnel: undefined,
      integrations: undefined,
      bundleUrl: "https://cdn.test/scripts/sentry@8.13.0/bundle.min.js",
      bundleIntegrity: undefined,
    });
    Object.assign(hoisted.sentryState, {
      current: undefined,
      runningPromise: undefined,
      enabled: false,
      initialized: false,
      warnedMissingDsn: false,
      warnedInitFailure: false,
      tags: {},
    });
    hoisted.loadIframeSentryMock.mockReset();
    hoisted.resolveIntegrationsMock.mockClear();
  });

  it("returns undefined when no DSN is configured", async () => {
    hoisted.runtimeConfig.dsn = undefined;
    const { initSentryBrowser } = await import("../../src/runtime/sentry/client");

    await expect(initSentryBrowser()).resolves.toBeUndefined();
    expect(hoisted.loadIframeSentryMock).not.toHaveBeenCalled();
    expect(hoisted.sentryState.initialized).toBe(true);
    expect(hoisted.sentryState.enabled).toBe(false);
  });

  it("initializes the iframe sentry client once and reuses it", async () => {
    const sentry = createSentryModule();
    hoisted.loadIframeSentryMock.mockResolvedValue(sentry);
    const { checkSentry, initSentryBrowser } = await import(
      "../../src/runtime/sentry/client"
    );

    await expect(initSentryBrowser()).resolves.toBe(sentry);
    await expect(checkSentry()).resolves.toBe(sentry);
    expect(hoisted.loadIframeSentryMock).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "test",
        sendDefaultPii: false,
        maxBreadcrumbs: 50,
        integrations: ["filtered"],
        beforeSend: expect.any(Function),
      }),
    );
    expect(sentry.setUser).toHaveBeenCalledWith(null);
    expect(sentry.setContext).toHaveBeenCalledWith("ocean_mcp_sdk", { build: "demo" });
    expect(sentry.setTags).toHaveBeenCalledWith({ sdk_build: "demo" });
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "sdk.sentry_initialized" }),
    );
    expect(hoisted.sentryState.current).toBe(sentry);
    expect(hoisted.sentryState.enabled).toBe(true);
  });
});
