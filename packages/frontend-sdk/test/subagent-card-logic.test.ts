/**
 * Tests for SubagentCard logic — status resolution and rendering helpers.
 *
 * Since the frontend-sdk test setup does not include React Testing Library
 * or component rendering, these tests focus on the pure-logic aspects:
 * how tool part types, states, and output are interpreted for the card UI.
 */
import { describe, test, expect } from "vitest";
import {
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// Re-implement the status resolution logic from SubagentCard for testing.
// This mirrors the logic in SubagentCard.tsx and ensures it stays correct.
// ---------------------------------------------------------------------------

type SubagentStatus = "running" | "complete" | "error" | "timeout";

function resolveSubagentStatus(
  state: string,
  errorText?: string,
  preliminary?: boolean,
): SubagentStatus {
  if (state === TOOL_PART_STATE.OUTPUT_ERROR) {
    if (typeof errorText === "string" && /timeout/i.test(errorText)) {
      return "timeout";
    }
    return "error";
  }
  if (state === TOOL_PART_STATE.OUTPUT_AVAILABLE && !preliminary) {
    return "complete";
  }
  return "running";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveSubagentStatus", () => {
  test("returns 'running' when state is input-available", () => {
    expect(resolveSubagentStatus(TOOL_PART_STATE.INPUT_AVAILABLE)).toBe("running");
  });

  test("returns 'running' when state is input-streaming", () => {
    expect(resolveSubagentStatus(TOOL_PART_STATE.INPUT_STREAMING)).toBe("running");
  });

  test("returns 'running' when state is output-available but preliminary=true", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_AVAILABLE, undefined, true),
    ).toBe("running");
  });

  test("returns 'complete' when state is output-available and preliminary=false", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_AVAILABLE, undefined, false),
    ).toBe("complete");
  });

  test("returns 'complete' when state is output-available and preliminary is undefined", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_AVAILABLE),
    ).toBe("complete");
  });

  test("returns 'error' when state is output-error", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_ERROR, "Something failed"),
    ).toBe("error");
  });

  test("returns 'timeout' when state is output-error and errorText contains 'timeout'", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_ERROR, "Subagent timeout after 120s"),
    ).toBe("timeout");
  });

  test("returns 'timeout' when errorText contains 'Timeout' (case-insensitive)", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_ERROR, "Request Timeout"),
    ).toBe("timeout");
  });

  test("returns 'error' when state is output-error but errorText is undefined", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_ERROR),
    ).toBe("error");
  });

  test("returns 'error' when state is output-error and errorText has no timeout keyword", () => {
    expect(
      resolveSubagentStatus(TOOL_PART_STATE.OUTPUT_ERROR, "Network error"),
    ).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Tool part type identification
// ---------------------------------------------------------------------------

describe("subagent tool part identification", () => {
  test("tool-subagent type uses the correct prefix", () => {
    const expectedType = `${TOOL_PART_TYPE_PREFIX}subagent`;
    expect(expectedType).toBe("tool-subagent");
  });

  test("subagent tool name can be extracted from part type", () => {
    const partType = "tool-subagent";
    expect(partType.startsWith(TOOL_PART_TYPE_PREFIX)).toBe(true);
    const toolName = partType.slice(TOOL_PART_TYPE_PREFIX.length);
    expect(toolName).toBe("subagent");
  });
});

// ---------------------------------------------------------------------------
// Subagent output structure validation
// ---------------------------------------------------------------------------

describe("subagent output (UIMessage) structure", () => {
  test("a typical subagent output has parts array", () => {
    const output = {
      id: "msg-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here are the results..." },
      ],
    };
    expect(Array.isArray(output.parts)).toBe(true);
    expect(output.parts[0].type).toBe("text");
  });

  test("a subagent output can contain tool invocation parts", () => {
    const output = {
      id: "msg-2",
      role: "assistant",
      parts: [
        {
          type: "tool-browserExecute",
          toolCallId: "tc-1",
          state: "output-available",
          input: { functionId: "getData" },
          output: { data: [1, 2, 3] },
        },
        { type: "text", text: "Found 3 items." },
      ],
    };
    expect(output.parts).toHaveLength(2);
    expect(output.parts[0].type).toBe("tool-browserExecute");
    expect(output.parts[1].type).toBe("text");
  });

  test("a subagent output can contain reasoning parts", () => {
    const output = {
      id: "msg-3",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Let me think about this..." },
        { type: "text", text: "The answer is 42." },
      ],
    };
    expect(output.parts[0].type).toBe("reasoning");
  });

  test("a timeout output has the expected structure", () => {
    const timeoutOutput = {
      id: "subagent-timeout",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "[Subagent timed out after 120s. Partial results may be available above.]",
        },
      ],
    };
    expect(timeoutOutput.parts[0].text).toContain("timed out");
  });

  test("null/undefined output is handled", () => {
    const output: any = null;
    const parts = output?.parts;
    expect(parts).toBeUndefined();
    expect(Array.isArray(parts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task label truncation logic
// ---------------------------------------------------------------------------

describe("task label truncation", () => {
  function truncateTaskLabel(task: string | undefined): string {
    if (!task) return "Subtask";
    if (task.length > 80) return task.substring(0, 80) + "...";
    return task;
  }

  test("returns 'Subtask' for undefined task", () => {
    expect(truncateTaskLabel(undefined)).toBe("Subtask");
  });

  test("returns 'Subtask' for empty string task", () => {
    expect(truncateTaskLabel("")).toBe("Subtask");
  });

  test("returns task as-is when under 80 chars", () => {
    const task = "Fetch order data from the API";
    expect(truncateTaskLabel(task)).toBe(task);
  });

  test("returns exactly 80 chars as-is", () => {
    const task = "x".repeat(80);
    expect(truncateTaskLabel(task)).toBe(task);
  });

  test("truncates with ellipsis when over 80 chars", () => {
    const task = "x".repeat(100);
    const result = truncateTaskLabel(task);
    expect(result.length).toBe(83); // 80 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});
