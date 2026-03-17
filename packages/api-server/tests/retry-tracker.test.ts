import { describe, test, expect } from "bun:test";
import { ToolRetryTracker } from "../src/ai/tools/retry-tracker";

describe("ToolRetryTracker", () => {
  // ── recordFailure ──────────────────────────────────────────────────────

  test("recordFailure returns true when retries remain", () => {
    const tracker = new ToolRetryTracker(2);
    // First failure — one retry still available
    expect(tracker.recordFailure("toolA")).toBe(true);
  });

  test("recordFailure returns false when retries exhausted", () => {
    const tracker = new ToolRetryTracker(2);
    tracker.recordFailure("toolA"); // attempt 1 → true
    expect(tracker.recordFailure("toolA")).toBe(false); // attempt 2 → exhausted
  });

  test("tracks per function ID independently", () => {
    const tracker = new ToolRetryTracker(2);
    tracker.recordFailure("toolA"); // toolA: 1/2
    tracker.recordFailure("toolA"); // toolA: 2/2 → exhausted

    // toolB is untouched — should still have retries
    expect(tracker.recordFailure("toolB")).toBe(true);
  });

  test("exhaustion of one tool does not affect another", () => {
    const tracker = new ToolRetryTracker(1);
    expect(tracker.recordFailure("toolA")).toBe(false); // toolA exhausted

    // toolB has its own budget
    expect(tracker.recordFailure("toolB")).toBe(false); // toolB also exhausted after 1
  });

  // ── getAttempt ─────────────────────────────────────────────────────────

  test("getAttempt returns 1 before any failure", () => {
    const tracker = new ToolRetryTracker(3);
    expect(tracker.getAttempt("toolA")).toBe(1);
  });

  test("getAttempt returns 2 after one failure", () => {
    const tracker = new ToolRetryTracker(3);
    tracker.recordFailure("toolA");
    expect(tracker.getAttempt("toolA")).toBe(2);
  });

  test("getAttempt increments with each failure", () => {
    const tracker = new ToolRetryTracker(5);
    tracker.recordFailure("toolA");
    tracker.recordFailure("toolA");
    tracker.recordFailure("toolA");
    expect(tracker.getAttempt("toolA")).toBe(4);
  });

  // ── maxRetries = 0 ─────────────────────────────────────────────────────

  test("maxRetries=0 means first failure is immediately exhausted", () => {
    const tracker = new ToolRetryTracker(0);
    expect(tracker.recordFailure("toolA")).toBe(false);
  });

  // ── maxRetries = 1 ─────────────────────────────────────────────────────

  test("maxRetries=1 exhausts after exactly one failure", () => {
    const tracker = new ToolRetryTracker(1);
    // First failure: 1 >= 1 → exhausted
    expect(tracker.recordFailure("toolA")).toBe(false);
  });

  // ── max getter ─────────────────────────────────────────────────────────

  test("max getter returns configured value", () => {
    expect(new ToolRetryTracker(3).max).toBe(3);
    expect(new ToolRetryTracker(0).max).toBe(0);
    expect(new ToolRetryTracker(10).max).toBe(10);
  });

  // ── multiple tools interleaved ─────────────────────────────────────────

  test("interleaved failures track correctly per tool", () => {
    const tracker = new ToolRetryTracker(3);

    expect(tracker.recordFailure("a")).toBe(true); // a: 1/3
    expect(tracker.recordFailure("b")).toBe(true); // b: 1/3
    expect(tracker.recordFailure("a")).toBe(true); // a: 2/3
    expect(tracker.recordFailure("c")).toBe(true); // c: 1/3
    expect(tracker.recordFailure("a")).toBe(false); // a: 3/3 → exhausted
    expect(tracker.recordFailure("b")).toBe(true); // b: 2/3
    expect(tracker.recordFailure("b")).toBe(false); // b: 3/3 → exhausted

    expect(tracker.getAttempt("a")).toBe(4);
    expect(tracker.getAttempt("b")).toBe(4);
    expect(tracker.getAttempt("c")).toBe(2);
  });
});
