import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  OPERATION_TYPE,
  WSMessageType,
  type WSMessage,
} from "oceanmcp-shared";
import type { FunctionSchema, SkillSchema } from "oceanmcp-shared";
import { connectionManager } from "../src/ws/connection-manager";
import {
  isServerSideTool,
  createBrowserExecuteTool,
} from "../src/ai/tools/browser-proxy-tool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONN_ID = "test-browser-proxy";

function makeFunctionSchema(
  overrides: Partial<FunctionSchema> & { id: string },
): FunctionSchema {
  return {
    name: overrides.id,
    description: `Test tool ${overrides.id}`,
    type: "executor",
    operationType: OPERATION_TYPE.READ,
    parameters: [],
    ...overrides,
  } as FunctionSchema;
}

function makeSkillSchema(
  name: string,
  tools: FunctionSchema[],
): SkillSchema {
  return { name, description: `Skill ${name}`, tools } as SkillSchema;
}

/**
 * Execute the tool's handler directly.
 * The tool is scoped to CONN_ID so schema lookups work.
 */
async function callBrowserExecute(
  functionId: string,
  args: Record<string, any> = {},
) {
  const t = createBrowserExecuteTool(CONN_ID);
  return (t as any).execute({ functionId, arguments: args });
}

/**
 * Minimal fake WebSocket that auto-resolves tool execution requests.
 * When `send` is called with an EXECUTE_TOOL message, it immediately
 * resolves the pending request via `connectionManager.resolveToolResult`.
 */
function createMockWs() {
  return {
    send: (raw: string) => {
      try {
        const msg: WSMessage = JSON.parse(raw);
        if (msg.type === WSMessageType.EXECUTE_TOOL) {
          const { requestId } = msg.payload as { requestId: string };
          queueMicrotask(() =>
            connectionManager.resolveToolResult({
              requestId,
              functionId: (msg.payload as any).functionId,
              result: { ok: true },
            }),
          );
        }
      } catch {}
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Setup / teardown — register a real connection so schema lookups work
// ---------------------------------------------------------------------------

beforeEach(() => {
  connectionManager.addConnection(CONN_ID, createMockWs());
});

afterEach(() => {
  connectionManager.removeConnection(CONN_ID);
});

// ---------------------------------------------------------------------------
// isServerSideTool
// ---------------------------------------------------------------------------

describe("isServerSideTool", () => {
  test("returns true for a known server-side tool with no browser registration", () => {
    expect(isServerSideTool("loadSkill", CONN_ID)).toBe(true);
    expect(isServerSideTool("executePlan", CONN_ID)).toBe(true);
  });

  test("returns true for the subagent tool", () => {
    expect(isServerSideTool("subagent", CONN_ID)).toBe(true);
  });

  test("returns false for an unknown tool name", () => {
    expect(isServerSideTool("getOrderList", CONN_ID)).toBe(false);
    expect(isServerSideTool("randomTool", CONN_ID)).toBe(false);
  });

  test("returns false when the tool is registered as a standalone browser tool", () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "echo" }),
    ]);
    expect(isServerSideTool("echo", CONN_ID)).toBe(false);
  });

  test("returns false when the tool is bundled inside a skill", () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("my-skill", [makeFunctionSchema({ id: "echo" })]),
    ]);
    expect(isServerSideTool("echo", CONN_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createBrowserExecuteTool — write operation guard
//
// We test the guard logic by inspecting the returned error messages.
// Tools that PASS the guard will attempt a real WebSocket send and fail
// with a generic execution error — that's fine, we only care that the
// write-guard didn't reject them.
// ---------------------------------------------------------------------------

/** The guard's specific rejection message substring */
const WRITE_GUARD_MSG = "write/mutation operation";

describe("createBrowserExecuteTool — write operation guard", () => {
  // ── Standalone tools ───────────────────────────────────────────────────

  test("allows a standalone READ tool (no write-guard rejection)", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);
    const result = await callBrowserExecute("getData");
    expect(result.error ?? "").not.toContain(WRITE_GUARD_MSG);
  });

  test("blocks a standalone WRITE tool without autoApprove", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({
        id: "deleteItem",
        operationType: OPERATION_TYPE.WRITE,
      }),
    ]);
    const result = await callBrowserExecute("deleteItem");
    expect(result.error).toContain(WRITE_GUARD_MSG);
    expect(result.error).toContain("executePlan");
    expect(result.functionId).toBe("deleteItem");
  });

  test("allows a standalone WRITE tool with autoApprove: true", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({
        id: "addLog",
        operationType: OPERATION_TYPE.WRITE,
        autoApprove: true,
      }),
    ]);
    const result = await callBrowserExecute("addLog");
    expect(result.error ?? "").not.toContain(WRITE_GUARD_MSG);
  });

  // ── Skill-bundled tools (the fix) ──────────────────────────────────────

  test("allows a skill-bundled READ tool (no write-guard rejection)", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "getStock",
          operationType: OPERATION_TYPE.READ,
        }),
      ]),
    ]);
    const result = await callBrowserExecute("getStock");
    expect(result.error ?? "").not.toContain(WRITE_GUARD_MSG);
  });

  test("blocks a skill-bundled WRITE tool without autoApprove", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
        }),
      ]),
    ]);
    const result = await callBrowserExecute("updateStock");
    expect(result.error).toContain(WRITE_GUARD_MSG);
    expect(result.error).toContain("executePlan");
    expect(result.functionId).toBe("updateStock");
  });

  test("allows a skill-bundled WRITE tool with autoApprove: true", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("logging", [
        makeFunctionSchema({
          id: "appendAuditLog",
          operationType: OPERATION_TYPE.WRITE,
          autoApprove: true,
        }),
      ]),
    ]);
    const result = await callBrowserExecute("appendAuditLog");
    expect(result.error ?? "").not.toContain(WRITE_GUARD_MSG);
  });

  test("finds tool in second skill when multiple skills exist", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("alpha", [
        makeFunctionSchema({
          id: "readAlpha",
          operationType: OPERATION_TYPE.READ,
        }),
      ]),
      makeSkillSchema("beta", [
        makeFunctionSchema({
          id: "writeBeta",
          operationType: OPERATION_TYPE.WRITE,
        }),
      ]),
    ]);
    const result = await callBrowserExecute("writeBeta");
    expect(result.error).toContain(WRITE_GUARD_MSG);
  });

  test("prefers standalone schema over skill-bundled when both exist", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({
        id: "dualTool",
        operationType: OPERATION_TYPE.WRITE,
        autoApprove: true,
      }),
    ]);
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("some-skill", [
        makeFunctionSchema({
          id: "dualTool",
          operationType: OPERATION_TYPE.WRITE,
          autoApprove: false,
        }),
      ]),
    ]);
    // Standalone has autoApprove: true → guard should NOT reject
    const result = await callBrowserExecute("dualTool");
    expect(result.error ?? "").not.toContain(WRITE_GUARD_MSG);
  });

  // ── Server-side tool guard ─────────────────────────────────────────────

  test("rejects a server-side tool called via browserExecute", async () => {
    const result = await callBrowserExecute("loadSkill");
    expect(result.error).toContain("server-side tool");
    expect(result.error).toContain("loadSkill");
  });

  // ── Fail-closed guard: unknown / unregistered tools ────────────────────
  //
  // Bug #2: When the schema for a functionId is not found in ANY registry
  // (standalone tools or skill-bundled tools), the guard used to silently
  // pass through and attempt execution via WebSocket (where
  // connectionManager might catch it). The guard should block early with
  // a specific message mentioning "cannot verify" / "operation type",
  // rather than delegating rejection to the WS layer.

  test("guard rejects unregistered tool before reaching WebSocket layer (fail-closed)", async () => {
    // Register NO tools and NO skills — "ghostTool" has no schema at all
    connectionManager.registerTools(CONN_ID, []);
    connectionManager.registerSkills(CONN_ID, []);
    const result = await callBrowserExecute("ghostTool");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("ghostTool");
    // The guard-level rejection must mention "operation type" to prove it
    // came from the write-guard, not the connection manager.
    expect(result.error).toContain("operation type");
  });

  test("guard rejects tool from different connection before reaching WebSocket layer", async () => {
    const OTHER_CONN = "other-connection";
    connectionManager.addConnection(OTHER_CONN, createMockWs());
    try {
      // Register a WRITE tool on OTHER_CONN, but NOT on CONN_ID
      connectionManager.registerTools(OTHER_CONN, [
        makeFunctionSchema({
          id: "dangerousAction",
          operationType: OPERATION_TYPE.WRITE,
        }),
      ]);
      connectionManager.registerTools(CONN_ID, []);
      connectionManager.registerSkills(CONN_ID, []);

      // browserExecute is scoped to CONN_ID — guard should fail-closed
      const result = await callBrowserExecute("dangerousAction");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("dangerousAction");
      expect(result.error).toContain("operation type");
    } finally {
      connectionManager.removeConnection(OTHER_CONN);
    }
  });
});
