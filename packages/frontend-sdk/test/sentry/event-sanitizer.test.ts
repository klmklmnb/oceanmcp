import { beforeEach, describe, expect, it } from "vitest";
import { MAX_STRING_LENGTH } from "../../src/runtime/sentry/constants";
import { sanitizeEvent } from "../../src/runtime/sentry/event-sanitizer";
import { sentryState } from "../../src/runtime/sentry/state";

describe("sanitizeEvent", () => {
  beforeEach(() => {
    sentryState.tags = { locale: "zh-CN" };
    window.history.replaceState({}, "", "/chat?room=alpha");
  });

  it("preserves a caller-provided request url while sanitizing other fields", () => {
    const longText = "x".repeat(MAX_STRING_LENGTH + 30);
    const sourceEvent = {
      user: { id: "user-1", email: "hidden@sdk.test" },
      request: {
        method: "POST",
        url: "https://api.sdk.test/messages?token=secret",
      },
      extra: {
        payload: longText,
        fileUrl: new URL("https://cdn.test/demo.png?signature=secret"),
      },
      contexts: {
        ui: {
          nested: { a: { b: { c: { d: { e: "hidden" } } } } },
        },
      },
      breadcrumbs: [{ message: longText, data: { body: longText } }],
      tags: { toolName: "apply_patch" },
    };
    const event = sanitizeEvent(sourceEvent);
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }

    expect(event.user).toEqual({});
    expect(sourceEvent.user).toEqual({ id: "user-1", email: "hidden@sdk.test" });
    expect(event.request).toEqual({
      method: "POST",
      url: "https://api.sdk.test/messages?token=secret",
    });
    expect(event.extra).toEqual({
      payload: `${"x".repeat(MAX_STRING_LENGTH - 3)}...`,
      fileUrl: "https://cdn.test/demo.png",
    });
    expect(event.contexts).toEqual({
      ui: { nested: { a: { b: { c: "[Truncated]" } } } },
    });
    expect(event.breadcrumbs).toEqual([
      {
        message: `${"x".repeat(MAX_STRING_LENGTH - 3)}...`,
        data: { body: `${"x".repeat(MAX_STRING_LENGTH - 3)}...` },
      },
    ]);
    expect(event.tags).toEqual(
      expect.objectContaining({
        toolName: "apply_patch",
        locale: "zh-CN",
        sdk_build: "demo",
        sdk_version: "0.0.0-test",
        api_host: expect.any(String),
        origin: "https://sdk.test",
        href: "https://sdk.test/chat",
        pathname: "/chat",
      }),
    );
    expect(event.tags).not.toHaveProperty("searchParams.room");
  });

  it("replaces iframe placeholder url and transaction with the host page url", () => {
    const event = sanitizeEvent({
      request: {
        method: "GET",
        url: "about:blank",
      },
      transaction: "about:blank",
    });
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }

    expect(event.request).toEqual({
      method: "GET",
      url: "https://sdk.test/chat?room=alpha",
    });
    expect(event.transaction).toBe("/chat");
    expect(event.tags).toEqual(
      expect.objectContaining({
        href: "https://sdk.test/chat",
        pathname: "/chat",
      }),
    );
  });
});
