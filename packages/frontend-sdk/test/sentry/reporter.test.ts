import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const scope = {
    setContext: vi.fn(),
    setTags: vi.fn(),
    setExtras: vi.fn(),
    setLevel: vi.fn(),
    setFingerprint: vi.fn(),
  };

  const sentry = {
    withScope: vi.fn((callback) => callback(scope)),
    captureEvent: vi.fn(),
  };

  return {
    scope,
    sentry,
    checkSentryMock: vi.fn(async () => sentry),
    sentryState: {
      enabled: true,
      tags: {},
    },
  };
});

vi.mock("../../src/runtime/sentry/client", () => ({
  checkSentry: hoisted.checkSentryMock,
}));

vi.mock("../../src/runtime/sentry/state", () => ({
  sentryState: hoisted.sentryState,
}));

describe("captureSdkEvent", () => {
  beforeEach(() => {
    hoisted.checkSentryMock.mockClear();
    hoisted.sentry.withScope.mockClear();
    hoisted.sentry.captureEvent.mockClear();
    hoisted.scope.setContext.mockClear();
    hoisted.scope.setTags.mockClear();
    hoisted.scope.setExtras.mockClear();
    hoisted.scope.setLevel.mockClear();
    hoisted.scope.setFingerprint.mockClear();
    hoisted.sentryState.enabled = true;
    hoisted.sentryState.tags = {};
  });

  it("sends a grouped info event with sanitized metadata", async () => {
    const { captureSdkEvent } = await import("../../src/runtime/sentry/reporter");

    captureSdkEvent("chat.submit", {
      data: {
        partCount: 2,
        body: "x".repeat(400),
      },
      tags: {
        tool_name: "apply_patch",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.checkSentryMock).toHaveBeenCalledTimes(1);
    expect(hoisted.scope.setFingerprint).toHaveBeenCalledWith([
      "sdk_event",
      "chat.submit",
    ]);
    expect(hoisted.sentry.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "chat.submit",
        level: "info",
        tags: expect.objectContaining({
          sdk_event: "chat.submit",
          tool_name: "apply_patch",
        }),
        extra: expect.objectContaining({
          partCount: 2,
          body: `${"x".repeat(237)}...`,
        }),
      }),
      expect.any(Object),
    );
  });
});
