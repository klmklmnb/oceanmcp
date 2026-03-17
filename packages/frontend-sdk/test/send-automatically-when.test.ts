import { describe, test, expect } from "vitest";
import { evaluateSendAutomatically } from "../src/components/ChatWidget";

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

// ── Tool part factories ──────────────────────────────────────────────────────

/** A server-executed tool that completed successfully (e.g. browserExecute) */
function completedToolPart(toolCallId: string, toolName = "browserExecute") {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-available",
    input: { functionId: "test" },
    output: { result: "ok" },
  };
}

/** A server-executed tool that errored */
function erroredToolPart(toolCallId: string, toolName = "browserExecute") {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-error",
    input: { functionId: "test" },
    errorText: "Something went wrong",
  };
}

/** A tool that was denied (via auto-deny or user deny) */
function deniedToolPart(toolCallId: string, toolName = "someTool") {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-denied",
    input: {},
    approval: {
      id: `deny-${toolCallId}`,
      approved: false,
      reason: "Denied",
    },
  };
}

/** A tool awaiting user approval (needsApproval: true) */
function approvalRequestedPart(toolCallId: string, approvalId: string) {
  return {
    type: `tool-someTool`,
    toolCallId,
    state: "approval-requested",
    input: { action: "delete" },
    approval: { id: approvalId },
  };
}

/** A tool where the user has responded to the approval (approved or denied) */
function approvalRespondedPart(
  toolCallId: string,
  approvalId: string,
  approved: boolean,
) {
  return {
    type: `tool-someTool`,
    toolCallId,
    state: "approval-responded",
    input: { action: "delete" },
    approval: {
      id: approvalId,
      approved,
      reason: approved ? undefined : "User denied",
    },
  };
}

/** An askUser tool waiting for user input (stream ended, card shown) */
function pendingAskUserPart(toolCallId: string) {
  return {
    type: "tool-askUser",
    toolCallId,
    state: "input-available",
    input: {
      message: "Pick one",
      options: [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ],
    },
  };
}

/** An askUser tool that the user has answered */
function settledAskUserPart(toolCallId: string) {
  return {
    type: "tool-askUser",
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

/** An askUser tool that errored */
function erroredAskUserPart(toolCallId: string) {
  return {
    type: "tool-askUser",
    toolCallId,
    state: "output-error",
    input: {
      message: "Pick one",
      options: [{ value: "a", label: "Option A" }],
    },
    errorText: "Selection failed",
  };
}

/** A tool still streaming its input args */
function inputStreamingPart(toolCallId: string, toolName = "browserExecute") {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-streaming",
    input: {},
  };
}

/** A non-askUser tool in INPUT_AVAILABLE state (unusual but possible) */
function inputAvailablePart(toolCallId: string, toolName = "someTool") {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-available",
    input: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateSendAutomatically", () => {
  // ── Baseline: should NOT trigger ──────────────────────────────────────

  describe("should NOT trigger (returns false)", () => {
    test("empty messages", () => {
      const { decision } = evaluateSendAutomatically([], new Set(), new Set());
      expect(decision).toBe(false);
    });

    test("last message is from user", () => {
      const { decision } = evaluateSendAutomatically(
        [userMsg("hello")],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(false);
    });

    test("assistant message with no parts", () => {
      const msg = { id: "1", role: "assistant", parts: [] };
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      // No tool parts → allToolPartsSettled is vacuously true, but
      // neither hasAnyApprovalResponse nor hasAskUserResult is true
      expect(decision).toBe(false);
    });

    test("assistant message with only text parts (no tool parts)", () => {
      const msg = {
        id: "1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      };
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(false);
    });

    test("only server-executed tools settled (no askUser / no approval)", () => {
      // This is the normal case: LLM called tools, server executed them,
      // multi-step loop continued on server. Stream finished normally.
      // No auto-send needed — the server already handled continuation.
      const msg = assistantMsg([
        completedToolPart("call-1"),
        completedToolPart("call-2", "loadSkill"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(false);
    });

    test("pending askUser not yet answered (input-available)", () => {
      const msg = assistantMsg([pendingAskUserPart("sel-1")]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(false);
    });

    test("approval requested but not yet responded", () => {
      const msg = assistantMsg([
        approvalRequestedPart("call-1", "approval-1"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(false);
    });

    test("tool still streaming input (input-streaming blocks)", () => {
      const msg = assistantMsg([
        settledAskUserPart("sel-1"),
        inputStreamingPart("call-2"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      // input-streaming is NOT in the settled list — blocks auto-send
      expect(decision).toBe(false);
    });

    test("already-submitted askUser ID is ignored", () => {
      const msg = assistantMsg([settledAskUserPart("sel-1")]);
      const submittedAskUserIds = new Set(["sel-1"]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        submittedAskUserIds,
      );
      expect(decision).toBe(false);
    });

    test("already-submitted approval ID is ignored", () => {
      const msg = assistantMsg([
        approvalRespondedPart("call-1", "approval-1", true),
      ]);
      const submittedApprovalIds = new Set(["approval-1"]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        submittedApprovalIds,
        new Set(),
      );
      expect(decision).toBe(false);
    });
  });

  // ── Should trigger: askUser answered ───────────────────────────────

  describe("should trigger when askUser is answered", () => {
    test("single askUser resolved (output-available)", () => {
      const msg = assistantMsg([settledAskUserPart("sel-1")]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-1"]);
    });

    test("askUser errored (output-error)", () => {
      const msg = assistantMsg([erroredAskUserPart("sel-1")]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-1"]);
    });

    test("askUser resolved alongside completed server tool", () => {
      const msg = assistantMsg([
        completedToolPart("call-1"),
        settledAskUserPart("sel-1"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
    });

    test("askUser resolved alongside denied tool", () => {
      const msg = assistantMsg([
        deniedToolPart("call-1"),
        settledAskUserPart("sel-1"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
    });

    test("multiple askUsers, both resolved", () => {
      const msg = assistantMsg([
        settledAskUserPart("sel-1"),
        settledAskUserPart("sel-2"),
      ]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-1", "sel-2"]);
    });
  });

  // ── Should trigger: approval responded ────────────────────────────────

  describe("should trigger when approval is responded", () => {
    test("single approval approved", () => {
      const msg = assistantMsg([
        approvalRespondedPart("call-1", "approval-1", true),
      ]);
      const { decision, approvalIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(approvalIds).toEqual(["approval-1"]);
    });

    test("single approval denied", () => {
      const msg = assistantMsg([
        approvalRespondedPart("call-1", "approval-1", false),
      ]);
      const { decision, approvalIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(approvalIds).toEqual(["approval-1"]);
    });

    test("approval responded alongside completed server tool", () => {
      const msg = assistantMsg([
        completedToolPart("call-1"),
        approvalRespondedPart("call-2", "approval-1", true),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
    });
  });

  // ── BUG REGRESSION: mixed interactive parts ───────────────────────────
  //
  // These tests verify the fix for the core bug: when a resolved
  // askUser sits next to an unresolved approval (or vice versa),
  // the old code would block the auto-send because APPROVAL_REQUESTED
  // and INPUT_AVAILABLE were not considered "settled".

  describe("BUG FIX: mixed interactive parts (regression tests)", () => {
    test("askUser resolved + sibling APPROVAL_REQUESTED → should trigger", () => {
      // This was the main bug: the user answered the askUser, but the
      // approval card was still waiting. The old code had allToolPartsSettled
      // = false because APPROVAL_REQUESTED was not in the settled set.
      const msg = assistantMsg([
        settledAskUserPart("sel-1"),
        approvalRequestedPart("call-2", "approval-1"),
      ]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-1"]);
    });

    test("approval responded + sibling pending askUser → should trigger", () => {
      // The user responded to the approval, but a askUser card is
      // still waiting for input. The approval response should still
      // trigger auto-send — the askUser will be handled later.
      const msg = assistantMsg([
        approvalRespondedPart("call-1", "approval-1", true),
        pendingAskUserPart("sel-1"),
      ]);
      const { decision, approvalIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(approvalIds).toEqual(["approval-1"]);
    });

    test("askUser resolved + sibling INPUT_AVAILABLE non-askUser → should trigger", () => {
      // A non-askUser tool is in input-available state (unusual but
      // possible). This should not block the askUser auto-send.
      const msg = assistantMsg([
        settledAskUserPart("sel-1"),
        inputAvailablePart("call-2", "someOtherTool"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
    });

    test("askUser resolved + completed tool + approval requested → should trigger", () => {
      // Three tools: one completed, one askUser answered, one approval
      // waiting. The answered askUser should still trigger.
      const msg = assistantMsg([
        completedToolPart("call-1"),
        settledAskUserPart("sel-1"),
        approvalRequestedPart("call-3", "approval-1"),
      ]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
    });

    test("both askUser answered AND approval responded → should trigger with both IDs", () => {
      const msg = assistantMsg([
        settledAskUserPart("sel-1"),
        approvalRespondedPart("call-2", "approval-1", true),
      ]);
      const { decision, approvalIds, askUserIds } =
        evaluateSendAutomatically([msg], new Set(), new Set());
      expect(decision).toBe(true);
      expect(approvalIds).toEqual(["approval-1"]);
      expect(askUserIds).toEqual(["sel-1"]);
    });
  });

  // ── Deduplication tracking ────────────────────────────────────────────

  describe("deduplication: subsequent calls with same IDs return false", () => {
    test("askUser ID tracked after first trigger", () => {
      const msg = assistantMsg([settledAskUserPart("sel-1")]);
      const approvalIds = new Set<string>();
      const selectIds = new Set<string>();

      // First call — should trigger
      const first = evaluateSendAutomatically([msg], approvalIds, selectIds);
      expect(first.decision).toBe(true);

      // Simulate marking IDs as submitted
      for (const id of first.askUserIds) selectIds.add(id);

      // Second call with same state — should NOT trigger
      const second = evaluateSendAutomatically([msg], approvalIds, selectIds);
      expect(second.decision).toBe(false);
    });

    test("approval ID tracked after first trigger", () => {
      const msg = assistantMsg([
        approvalRespondedPart("call-1", "approval-1", true),
      ]);
      const approvalIds = new Set<string>();
      const selectIds = new Set<string>();

      const first = evaluateSendAutomatically([msg], approvalIds, selectIds);
      expect(first.decision).toBe(true);

      for (const id of first.approvalIds) approvalIds.add(id);

      const second = evaluateSendAutomatically([msg], approvalIds, selectIds);
      expect(second.decision).toBe(false);
    });

    test("new askUser in a new message triggers after previous was tracked", () => {
      const approvalIds = new Set<string>();
      const selectIds = new Set<string>(["sel-1"]); // already submitted

      // New message with a different askUser
      const msg = assistantMsg([settledAskUserPart("sel-2")]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        approvalIds,
        selectIds,
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-2"]);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("askUser with no toolCallId is ignored", () => {
      const part = {
        type: "tool-askUser",
        // no toolCallId
        state: "output-available",
        input: { message: "Pick" },
        output: { selectedValue: "a" },
      };
      const msg = assistantMsg([part]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      // No valid askUser → hasAskUserResult is false
      expect(decision).toBe(false);
    });

    test("only looks at the LAST message", () => {
      // Even though the first message has a settled askUser,
      // the function only looks at the last message.
      const msg1 = assistantMsg([settledAskUserPart("sel-1")]);
      const msg2 = assistantMsg([completedToolPart("call-1")]);

      const { decision } = evaluateSendAutomatically(
        [msg1, msg2],
        new Set(),
        new Set(),
      );
      // Last message has no askUser/approval → false
      expect(decision).toBe(false);
    });

    test("user message between assistant messages — only last msg matters", () => {
      const msg1 = assistantMsg([settledAskUserPart("sel-old")]);
      const msg2 = userMsg("follow up");
      const msg3 = assistantMsg([settledAskUserPart("sel-new")]);

      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg1, msg2, msg3],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-new"]);
    });

    test("denied askUser is not counted as a trigger", () => {
      // A denied askUser has state OUTPUT_DENIED, which is "settled"
      // but is NOT counted as hasAskUserResult (which requires
      // OUTPUT_AVAILABLE or OUTPUT_ERROR).
      const part = {
        type: "tool-askUser",
        toolCallId: "sel-1",
        state: "output-denied",
        input: { message: "Pick" },
        output: { denied: true },
        approval: { id: "auto-deny", approved: false, reason: "Auto-denied" },
      };
      const msg = assistantMsg([part]);
      const { decision } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      // Denied askUser does not satisfy hasAskUserResult
      expect(decision).toBe(false);
    });

    test("mix of denied + settled askUsers → triggers for the settled one", () => {
      const deniedPart = {
        type: "tool-askUser",
        toolCallId: "sel-denied",
        state: "output-denied",
        input: { message: "Pick" },
        output: { denied: true },
        approval: {
          id: "auto-deny",
          approved: false,
          reason: "Auto-denied",
        },
      };
      const msg = assistantMsg([
        deniedPart,
        settledAskUserPart("sel-answered"),
      ]);
      const { decision, askUserIds } = evaluateSendAutomatically(
        [msg],
        new Set(),
        new Set(),
      );
      expect(decision).toBe(true);
      expect(askUserIds).toEqual(["sel-answered"]);
    });
  });
});
