import { describe, test, expect } from "bun:test";
import { normalizeStaleInteractions } from "../src/routes/normalize-stale-interactions";

// ---------------------------------------------------------------------------
// Helpers — factory functions for building message parts & messages
// ---------------------------------------------------------------------------

function assistantMsg(parts: any[]) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: "assistant",
    parts,
  };
}

function userMsg(text: string) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function approvalRequestedPart(toolCallId: string, approvalId?: string) {
  return {
    type: "tool-someTool",
    toolCallId,
    state: "approval-requested",
    input: {},
    approval: approvalId
      ? { id: approvalId }
      : undefined,
  };
}

function approvalRespondedDeniedPart(
  toolCallId: string,
  approvalId: string,
  reason?: string,
) {
  return {
    type: "tool-someTool",
    toolCallId,
    state: "approval-responded",
    input: {},
    approval: {
      id: approvalId,
      approved: false,
      reason: reason ?? "User denied the action",
    },
  };
}

function settledToolPart(toolCallId: string) {
  return {
    type: "tool-someTool",
    toolCallId,
    state: "output-available",
    input: {},
    output: { result: "ok" },
  };
}

function pendingUserSelectPart(toolCallId: string, options?: any[]) {
  return {
    type: "tool-userSelect",
    toolCallId,
    state: "input-available",
    input: {
      message: "Pick one",
      options: options ?? [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ],
    },
  };
}

function settledUserSelectPart(toolCallId: string) {
  return {
    type: "tool-userSelect",
    toolCallId,
    state: "output-available",
    input: {
      message: "Pick one",
      options: [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ],
    },
    output: { selectedValue: "a", selectedLabel: "Option A" },
  };
}

function deniedUserSelectPart(toolCallId: string) {
  return {
    type: "tool-userSelect",
    toolCallId,
    state: "output-denied",
    input: {
      message: "Pick one",
      options: [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ],
    },
    output: { denied: true, reason: "Already denied" },
    approval: {
      id: `auto-deny-select-${toolCallId}`,
      approved: false,
      reason: "Already denied",
    },
  };
}

function textPart(text: string) {
  return { type: "text", text, state: "done" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeStaleInteractions", () => {
  // ─── Pass-through cases ──────────────────────────────────────────────

  describe("pass-through (no-op) cases", () => {
    test("returns empty array for empty input", () => {
      expect(normalizeStaleInteractions([])).toEqual([]);
    });

    test("passes through user messages untouched", () => {
      const msg = userMsg("hello");
      const result = normalizeStaleInteractions([msg]);
      expect(result[0]).toBe(msg);
    });

    test("passes through assistant message with no parts array", () => {
      const msg = { id: "1", role: "assistant" };
      const result = normalizeStaleInteractions([msg]);
      expect(result[0]).toBe(msg);
    });

    test("does not touch settled tool parts", () => {
      const msg = assistantMsg([settledToolPart("call1")]);
      const result = normalizeStaleInteractions([msg, userMsg("next")]);
      expect(result[0]).toBe(msg);
    });

    test("does not touch settled userSelect parts", () => {
      const msg = assistantMsg([settledUserSelectPart("call1")]);
      const result = normalizeStaleInteractions([msg, userMsg("next")]);
      expect(result[0]).toBe(msg);
    });

    test("does not touch already denied userSelect parts", () => {
      const msg = assistantMsg([deniedUserSelectPart("call1")]);
      const result = normalizeStaleInteractions([msg, userMsg("next")]);
      expect(result[0]).toBe(msg);
    });
  });

  // ─── Approval auto-deny (existing behavior, regression tests) ────────

  describe("approval auto-deny (regression)", () => {
    test("denies approval-requested part when later user message exists", () => {
      const part = approvalRequestedPart("call1", "approval-1");
      const messages = [
        assistantMsg([part]),
        userMsg("moved on"),
      ];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.state).toBe("output-denied");
      expect(deniedPart.approval.approved).toBe(false);
      expect(deniedPart.approval.id).toBe("approval-1");
      expect(typeof deniedPart.approval.reason).toBe("string");
    });

    test("denies approval-responded with approved=false", () => {
      const part = approvalRespondedDeniedPart(
        "call1",
        "approval-1",
        "User denied the action",
      );
      const messages = [assistantMsg([part])];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.state).toBe("output-denied");
      expect(deniedPart.approval.approved).toBe(false);
      expect(deniedPart.approval.reason).toBe("User denied the action");
    });

    test("does not deny approval-requested when no later user message", () => {
      const part = approvalRequestedPart("call1", "approval-1");
      const messages = [assistantMsg([part])];

      const result = normalizeStaleInteractions(messages);
      expect(result[0]).toBe(messages[0]);
    });
  });

  // ─── userSelect auto-deny ────────────────────────────────────────────

  describe("userSelect auto-deny", () => {
    test("denies pending userSelect when later user message exists", () => {
      const part = pendingUserSelectPart("select-1");
      const messages = [
        assistantMsg([part]),
        userMsg("I changed my mind"),
      ];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.state).toBe("output-denied");
    });

    test("denied userSelect output contains denied: true", () => {
      const part = pendingUserSelectPart("select-1");
      const messages = [
        assistantMsg([part]),
        userMsg("never mind"),
      ];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.output).toBeDefined();
      expect(deniedPart.output.denied).toBe(true);
      expect(typeof deniedPart.output.reason).toBe("string");
    });

    test("denied userSelect has approval object with reason (required by AI SDK v6)", () => {
      const part = pendingUserSelectPart("select-1");
      const messages = [
        assistantMsg([part]),
        userMsg("cancel"),
      ];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.approval).toBeDefined();
      expect(deniedPart.approval.approved).toBe(false);
      expect(typeof deniedPart.approval.reason).toBe("string");
      expect(deniedPart.approval.reason.length).toBeGreaterThan(0);
      expect(typeof deniedPart.approval.id).toBe("string");
    });

    test("denied userSelect preserves original input and toolCallId", () => {
      const options = [
        { value: "latte", label: "Latte" },
        { value: "mocha", label: "Mocha" },
      ];
      const part = pendingUserSelectPart("select-42", options);
      const messages = [
        assistantMsg([part]),
        userMsg("cancel"),
      ];

      const result = normalizeStaleInteractions(messages);
      const deniedPart = result[0].parts[0];

      expect(deniedPart.toolCallId).toBe("select-42");
      expect(deniedPart.type).toBe("tool-userSelect");
      expect(deniedPart.input.options).toEqual(options);
    });

    test("does NOT deny pending userSelect when no later user message", () => {
      const part = pendingUserSelectPart("select-1");
      const messages = [assistantMsg([part])];

      const result = normalizeStaleInteractions(messages);
      // Same reference — message was not changed
      expect(result[0]).toBe(messages[0]);
      expect(result[0].parts[0].state).toBe("input-available");
    });

    test("does NOT deny already settled userSelect (output-available)", () => {
      const part = settledUserSelectPart("select-1");
      const messages = [
        assistantMsg([part]),
        userMsg("next question"),
      ];

      const result = normalizeStaleInteractions(messages);
      expect(result[0]).toBe(messages[0]);
      expect(result[0].parts[0].state).toBe("output-available");
    });

    test("does NOT deny non-userSelect tool parts in input-available state", () => {
      const part = {
        type: "tool-someOtherTool",
        toolCallId: "call-other",
        state: "input-available",
        input: {},
      };
      const messages = [
        assistantMsg([part]),
        userMsg("hi"),
      ];

      const result = normalizeStaleInteractions(messages);
      // someOtherTool is not a userSelect — should not be auto-denied
      expect(result[0].parts[0].state).toBe("input-available");
    });
  });

  // ─── Mixed scenarios ─────────────────────────────────────────────────

  describe("mixed approval + userSelect", () => {
    test("denies both approval and userSelect parts when later user message exists", () => {
      const approvalPart = approvalRequestedPart("call-approve", "ap-1");
      const selectPart = pendingUserSelectPart("call-select");
      const messages = [
        assistantMsg([approvalPart, selectPart]),
        userMsg("skip all"),
      ];

      const result = normalizeStaleInteractions(messages);
      const parts = result[0].parts;

      expect(parts[0].state).toBe("output-denied");
      expect(parts[0].approval.approved).toBe(false);

      expect(parts[1].state).toBe("output-denied");
      expect(parts[1].output.denied).toBe(true);
      expect(parts[1].approval.approved).toBe(false);
    });

    test("denies pending userSelect but leaves settled tool parts intact", () => {
      const settled = settledToolPart("call-done");
      const pending = pendingUserSelectPart("call-pending");
      const messages = [
        assistantMsg([settled, pending]),
        userMsg("next"),
      ];

      const result = normalizeStaleInteractions(messages);
      const parts = result[0].parts;

      // Settled part is unchanged
      expect(parts[0].state).toBe("output-available");
      expect(parts[0].toolCallId).toBe("call-done");

      // Pending userSelect is denied
      expect(parts[1].state).toBe("output-denied");
      expect(parts[1].toolCallId).toBe("call-pending");
    });

    test("text parts in the same message are preserved unchanged", () => {
      const text = textPart("Please choose:");
      const select = pendingUserSelectPart("call-sel");
      const messages = [
        assistantMsg([text, select]),
        userMsg("nah"),
      ];

      const result = normalizeStaleInteractions(messages);
      const parts = result[0].parts;

      expect(parts[0]).toEqual(text);
      expect(parts[1].state).toBe("output-denied");
    });
  });

  // ─── Multi-message scenarios ─────────────────────────────────────────

  describe("multi-message scenarios", () => {
    test("only denies parts in messages that have a later user message", () => {
      const earlySelect = pendingUserSelectPart("early");
      const lateSelect = pendingUserSelectPart("late");
      const messages = [
        assistantMsg([earlySelect]),
        userMsg("middle message"),
        assistantMsg([lateSelect]),
        // No user message after the second assistant message
      ];

      const result = normalizeStaleInteractions(messages);

      // First assistant message has a later user message → denied
      expect(result[0].parts[0].state).toBe("output-denied");

      // Second assistant message has NO later user message → not denied
      expect(result[2]).toBe(messages[2]);
      expect(result[2].parts[0].state).toBe("input-available");
    });

    test("handles conversation with multiple rounds of selects", () => {
      const select1 = settledUserSelectPart("sel-1");
      const select2 = pendingUserSelectPart("sel-2");
      const messages = [
        assistantMsg([select1]),
        userMsg("chose A"),
        assistantMsg([select2]),
        userMsg("actually, cancel"),
      ];

      const result = normalizeStaleInteractions(messages);

      // First select was already settled — unchanged
      expect(result[0]).toBe(messages[0]);

      // Second select has a later user message — denied
      expect(result[2].parts[0].state).toBe("output-denied");
      expect(result[2].parts[0].output.denied).toBe(true);
      expect(result[2].parts[0].approval).toBeDefined();
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("handles userSelect part with no toolCallId gracefully", () => {
      const part = {
        type: "tool-userSelect",
        state: "input-available",
        input: { message: "Pick", options: [] },
        // no toolCallId
      };
      const messages = [
        assistantMsg([part]),
        userMsg("skip"),
      ];

      // Should not throw
      const result = normalizeStaleInteractions(messages);
      expect(result[0].parts[0].state).toBe("output-denied");
      expect(result[0].parts[0].approval.id).toContain("auto-deny-select-");
    });

    test("assistant message with empty parts array is unchanged", () => {
      const msg = assistantMsg([]);
      const result = normalizeStaleInteractions([msg, userMsg("hi")]);
      expect(result[0]).toBe(msg);
    });
  });
});
