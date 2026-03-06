import { describe, expect, it } from "vitest";
import { MAX_STRING_LENGTH } from "../../src/runtime/sentry/constants";
import {
  normalizeTags,
  sanitizeValue,
  toError,
  truncateString,
} from "../../src/runtime/sentry/sanitize";

describe("sanitize helpers", () => {
  it("truncates oversized strings", () => {
    const longText = "x".repeat(MAX_STRING_LENGTH + 20);

    expect(truncateString(longText)).toHaveLength(MAX_STRING_LENGTH);
    expect(truncateString(longText).endsWith("...")).toBe(true);
  });

  it("sanitizes nested values without leaking deep structures", () => {
    const value = {
      error: new Error("boom"),
      fileUrl: new URL("https://cdn.test/file.png?token=secret"),
      nested: { a: { b: { c: { d: { e: "hidden" } } } } },
    };

    expect(sanitizeValue(value)).toEqual({
      error: { name: "Error", message: "boom" },
      fileUrl: "https://cdn.test/file.png",
      nested: { a: { b: { c: "[Truncated]" } } },
    });
  });

  it("normalizes tags and drops empty values", () => {
    const tags = normalizeTags({
      locale: "zh-CN",
      empty: undefined,
      nullable: null,
      retries: 2,
      enabled: true,
      long: "y".repeat(MAX_STRING_LENGTH + 10),
    });

    expect(tags).toEqual({
      locale: "zh-CN",
      retries: 2,
      enabled: true,
      long: `${"y".repeat(MAX_STRING_LENGTH - 3)}...`,
    });
  });

  it("converts unknown values into Error instances", () => {
    expect(toError(new Error("known")).message).toBe("known");
    expect(toError("failed").message).toBe("failed");
    expect(toError({ message: "hidden" }).message).toBe("Unknown error");
  });
});
