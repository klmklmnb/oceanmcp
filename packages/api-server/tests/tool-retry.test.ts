import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  OPERATION_TYPE,
  PARAMETER_TYPE,
  WSMessageType,
  type WSMessage,
} from "oceanmcp-shared";
import type { FunctionSchema, SkillSchema } from "oceanmcp-shared";
import { connectionManager } from "../src/ws/connection-manager";
import { createBrowserExecuteTool } from "../src/ai/tools/browser-proxy-tool";
import { createExecutePlanTool } from "../src/ai/tools/execute-plan-tool";
import { createBrowserProxyToolFromSchema } from "../src/ai/tools";
import { ToolRetryTracker } from "../src/ai/tools/retry-tracker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONN_ID = "test-tool-retry";

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
 * Minimal fake WebSocket that auto-resolves tool execution requests
 * with success.
 */
function createSuccessMockWs() {
  return {
    send: (raw: string) => {
      try {
        const msg: WSMessage = JSON.parse(raw);
        if (msg.type === WSMessageType.EXECUTE_TOOL) {
          const { requestId, functionId } = msg.payload as {
            requestId: string;
            functionId: string;
          };
          queueMicrotask(() =>
            connectionManager.resolveToolResult({
              requestId,
              functionId,
              result: { ok: true },
            }),
          );
        }
      } catch {}
    },
  } as any;
}

/**
 * Fake WebSocket that always rejects tool execution with an error.
 */
function createErrorMockWs(errorMsg = "Simulated failure") {
  return {
    send: (raw: string) => {
      try {
        const msg: WSMessage = JSON.parse(raw);
        if (msg.type === WSMessageType.EXECUTE_TOOL) {
          const { requestId, functionId } = msg.payload as {
            requestId: string;
            functionId: string;
          };
          queueMicrotask(() =>
            connectionManager.resolveToolResult({
              requestId,
              functionId,
              error: errorMsg,
            }),
          );
        }
      } catch {}
    },
  } as any;
}

/**
 * Helper to call browserExecute tool directly.
 */
async function callBrowserExecute(
  functionId: string,
  args: Record<string, any> = {},
  retryTracker?: ToolRetryTracker,
) {
  const t = createBrowserExecuteTool(CONN_ID, retryTracker);
  return (t as any).execute({ functionId, arguments: args });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default: error mock (tests override as needed)
  connectionManager.addConnection(CONN_ID, createErrorMockWs());
});

afterEach(() => {
  connectionManager.removeConnection(CONN_ID);
});

// ===========================================================================
// browserExecute — retry behavior
// ===========================================================================

describe("browserExecute — retry behavior", () => {
  test("returns _retryHint on first failure when retries remain", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    const result = await callBrowserExecute("getData", {}, tracker);

    expect(result.error).toBeDefined();
    expect(result._retryHint).toBeDefined();
    expect(result._retryHint).toContain("attempt");
    expect(result._retryExhausted).toBeUndefined();
  });

  test("returns _retryExhausted after max retries reached", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    // First failure — retries remain
    const result1 = await callBrowserExecute("getData", {}, tracker);
    expect(result1._retryExhausted).toBeUndefined();

    // Second failure — exhausted
    const result2 = await callBrowserExecute("getData", {}, tracker);
    expect(result2._retryExhausted).toBe(true);
    expect(result2._retryHint).toContain("retry limit");
    expect(result2._retryHint).toContain("Report this error");
  });

  test("tracks retry count per function ID independently", async () => {
    const tracker = new ToolRetryTracker(1);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "toolA", operationType: OPERATION_TYPE.READ }),
      makeFunctionSchema({ id: "toolB", operationType: OPERATION_TYPE.READ }),
    ]);

    // toolA first failure → exhausted (maxRetries=1)
    const resultA = await callBrowserExecute("toolA", {}, tracker);
    expect(resultA._retryExhausted).toBe(true);

    // toolB first failure → also exhausted (maxRetries=1)
    const resultB = await callBrowserExecute("toolB", {}, tracker);
    expect(resultB._retryExhausted).toBe(true);
  });

  test("returns error without retry fields when no tracker provided", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    // No tracker → backward compatible
    const result = await callBrowserExecute("getData", {});
    expect(result.error).toBeDefined();
    expect(result._retryHint).toBeUndefined();
    expect(result._retryExhausted).toBeUndefined();
  });

  test("server-side tool rejection is NOT counted as a retry", async () => {
    const tracker = new ToolRetryTracker(1);
    // No tools registered — "loadSkill" is a server-side tool
    connectionManager.registerTools(CONN_ID, []);

    const result = await callBrowserExecute("loadSkill", {}, tracker);
    expect(result.error).toContain("server-side tool");
    // Should NOT consume a retry
    expect(result._retryHint).toBeUndefined();
    expect(result._retryExhausted).toBeUndefined();
  });

  test("write-guard rejection is NOT counted as a retry", async () => {
    const tracker = new ToolRetryTracker(1);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({
        id: "deleteItem",
        operationType: OPERATION_TYPE.WRITE,
      }),
    ]);

    const result = await callBrowserExecute("deleteItem", {}, tracker);
    expect(result.error).toContain("write/mutation");
    // Should NOT consume a retry
    expect(result._retryHint).toBeUndefined();
    expect(result._retryExhausted).toBeUndefined();
  });

  test("retryHint message includes attempt number and max", async () => {
    const tracker = new ToolRetryTracker(3);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    const result = await callBrowserExecute("getData", {}, tracker);
    // Should show "attempt 1/3"
    expect(result._retryHint).toContain("1/3");
  });

  test("maxRetries=0 immediately exhausts on first failure", async () => {
    const tracker = new ToolRetryTracker(0);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    const result = await callBrowserExecute("getData", {}, tracker);
    expect(result._retryExhausted).toBe(true);
  });

  test("successful execution does NOT increment retry counter", async () => {
    const tracker = new ToolRetryTracker(1);
    // Replace with success mock
    connectionManager.removeConnection(CONN_ID);
    connectionManager.addConnection(CONN_ID, createSuccessMockWs());
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    // Successful call
    const successResult = await callBrowserExecute("getData", {}, tracker);
    expect(successResult.ok).toBe(true);

    // Now switch to error mock and fail
    connectionManager.removeConnection(CONN_ID);
    connectionManager.addConnection(CONN_ID, createErrorMockWs());
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
    ]);

    // First failure — should still be exhausted at maxRetries=1
    const failResult = await callBrowserExecute("getData", {}, tracker);
    expect(failResult._retryExhausted).toBe(true);
  });
});

// ===========================================================================
// executePlan — retry behavior
// ===========================================================================

describe("executePlan — retry behavior", () => {
  test("validation failure with retries remaining returns _silentRetry", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
          parameters: [
            {
              name: "itemId",
              type: PARAMETER_TYPE.STRING,
              description: "Item ID",
              required: true,
            },
          ],
        }),
      ]),
    ]);
    connectionManager.registerTools(CONN_ID, []);

    const planTool = createExecutePlanTool(CONN_ID, tracker);
    const input = {
      intent: "Update stock",
      steps: [
        {
          functionId: "updateStock",
          title: "Update stock level",
          arguments: {}, // Missing required "itemId"
        },
      ],
    };

    const result = await (planTool as any).execute(input);
    expect(result._silentRetry).toBe(true);
    expect(result.validationError).toBeDefined();
    expect(result._retryExhausted).toBeUndefined();
  });

  test("validation failure after retries exhausted drops _silentRetry", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
          parameters: [
            {
              name: "itemId",
              type: PARAMETER_TYPE.STRING,
              description: "Item ID",
              required: true,
            },
          ],
        }),
      ]),
    ]);
    connectionManager.registerTools(CONN_ID, []);

    const planTool = createExecutePlanTool(CONN_ID, tracker);
    const input = {
      intent: "Update stock",
      steps: [
        {
          functionId: "updateStock",
          title: "Update stock level",
          arguments: {}, // Missing required "itemId"
        },
      ],
    };

    // First validation failure — silent retry allowed
    const result1 = await (planTool as any).execute(input);
    expect(result1._silentRetry).toBe(true);

    // Second validation failure — retry budget exhausted
    const result2 = await (planTool as any).execute(input);
    expect(result2._silentRetry).toBeUndefined();
    expect(result2._retryExhausted).toBe(true);
    expect(result2.validationError).toContain("Report this error");
  });

  test("step execution failure with retries remaining includes _retryHint", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "writeData", operationType: OPERATION_TYPE.WRITE }),
    ]);

    const planTool = createExecutePlanTool(CONN_ID, tracker);
    const input = {
      intent: "Write some data",
      steps: [
        {
          functionId: "writeData",
          title: "Write data",
          arguments: {},
        },
      ],
    };

    const result = await (planTool as any).execute(input);
    expect(result.results).toHaveLength(1);

    const failedStep = result.results[0];
    expect(failedStep.status).toBe("failed");
    expect(failedStep.error).toBeDefined();
    expect(failedStep._retryHint).toBeDefined();
    expect(failedStep._retryHint).toContain("Regenerate the plan");
    expect(failedStep._retryExhausted).toBeUndefined();
  });

  test("step execution failure after retries exhausted includes _retryExhausted", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "writeData", operationType: OPERATION_TYPE.WRITE }),
    ]);

    const planTool = createExecutePlanTool(CONN_ID, tracker);
    const input = {
      intent: "Write some data",
      steps: [
        {
          functionId: "writeData",
          title: "Write data",
          arguments: {},
        },
      ],
    };

    // First failure — retry available
    await (planTool as any).execute(input);

    // Second failure — exhausted
    const result2 = await (planTool as any).execute(input);
    const failedStep = result2.results[0];
    expect(failedStep.status).toBe("failed");
    expect(failedStep._retryExhausted).toBe(true);
    expect(failedStep._retryHint).toContain("Report this error");
  });

  test("validation failure without tracker still uses _silentRetry (backward compat)", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
          parameters: [
            {
              name: "itemId",
              type: PARAMETER_TYPE.STRING,
              description: "Item ID",
              required: true,
            },
          ],
        }),
      ]),
    ]);
    connectionManager.registerTools(CONN_ID, []);

    // No tracker
    const planTool = createExecutePlanTool(CONN_ID);
    const input = {
      intent: "Update stock",
      steps: [
        {
          functionId: "updateStock",
          title: "Update stock level",
          arguments: {},
        },
      ],
    };

    const result = await (planTool as any).execute(input);
    expect(result._silentRetry).toBe(true);
    expect(result.validationError).toBeDefined();
  });
});

// ===========================================================================
// createBrowserProxyToolFromSchema — retry behavior
// ===========================================================================

describe("createBrowserProxyToolFromSchema — retry behavior", () => {
  test("READ proxy tool returns _retryHint on first failure", async () => {
    const tracker = new ToolRetryTracker(2);
    const schema = makeFunctionSchema({
      id: "getData",
      operationType: OPERATION_TYPE.READ,
    });
    connectionManager.registerTools(CONN_ID, [schema]);

    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID, tracker);
    const result = await (proxyTool as any).execute({});

    expect(result.error).toBeDefined();
    expect(result._retryHint).toBeDefined();
    expect(result._retryHint).toContain("attempt");
    expect(result._retryExhausted).toBeUndefined();
  });

  test("READ proxy tool returns _retryExhausted after max failures", async () => {
    const tracker = new ToolRetryTracker(2);
    const schema = makeFunctionSchema({
      id: "getData",
      operationType: OPERATION_TYPE.READ,
    });
    connectionManager.registerTools(CONN_ID, [schema]);

    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID, tracker);

    // First failure
    await (proxyTool as any).execute({});

    // Second failure — exhausted
    const result2 = await (proxyTool as any).execute({});
    expect(result2._retryExhausted).toBe(true);
    expect(result2._retryHint).toContain("retry limit");
  });

  test("WRITE autoApprove proxy tool has same retry behavior", async () => {
    const tracker = new ToolRetryTracker(2);
    const schema = makeFunctionSchema({
      id: "addLog",
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
    });
    connectionManager.registerTools(CONN_ID, [schema]);

    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID, tracker);
    const result = await (proxyTool as any).execute({});

    expect(result.error).toBeDefined();
    expect(result._retryHint).toBeDefined();
    expect(result._retryExhausted).toBeUndefined();
  });

  test("proxy tool without tracker throws error (original behavior)", async () => {
    const schema = makeFunctionSchema({
      id: "getData",
      operationType: OPERATION_TYPE.READ,
    });
    connectionManager.registerTools(CONN_ID, [schema]);

    // No tracker — should throw (not catch and wrap)
    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID);
    try {
      await (proxyTool as any).execute({});
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toBe("Simulated failure");
    }
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("tool retry — edge cases", () => {
  test("different tools within same executePlan have independent retry budgets", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "stepA", operationType: OPERATION_TYPE.WRITE }),
      makeFunctionSchema({ id: "stepB", operationType: OPERATION_TYPE.WRITE }),
    ]);

    const planTool = createExecutePlanTool(CONN_ID, tracker);

    // Plan where stepA fails
    const input1 = {
      intent: "Do things",
      steps: [{ functionId: "stepA", title: "Step A", arguments: {} }],
    };
    const result1 = await (planTool as any).execute(input1);
    expect(result1.results[0]._retryHint).toBeDefined();
    expect(result1.results[0]._retryExhausted).toBeUndefined();

    // Plan where stepB fails — separate budget
    const input2 = {
      intent: "Do things",
      steps: [{ functionId: "stepB", title: "Step B", arguments: {} }],
    };
    const result2 = await (planTool as any).execute(input2);
    expect(result2.results[0]._retryHint).toBeDefined();
    expect(result2.results[0]._retryExhausted).toBeUndefined();

    // stepA fails again — now exhausted
    const result3 = await (planTool as any).execute(input1);
    expect(result3.results[0]._retryExhausted).toBe(true);

    // stepB still has one retry left
    // (second failure for stepB → exhausted)
    const result4 = await (planTool as any).execute(input2);
    expect(result4.results[0]._retryExhausted).toBe(true);
  });

  test("retry tracker shared across browserExecute and executePlan", async () => {
    const tracker = new ToolRetryTracker(2);
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({ id: "myTool", operationType: OPERATION_TYPE.READ }),
    ]);

    // First failure via browserExecute
    const r1 = await callBrowserExecute("myTool", {}, tracker);
    expect(r1._retryHint).toBeDefined();
    expect(r1._retryExhausted).toBeUndefined();

    // Second failure via executePlan step — same functionId, shared tracker
    const planTool = createExecutePlanTool(CONN_ID, tracker);
    const result = await (planTool as any).execute({
      intent: "Read data",
      steps: [{ functionId: "myTool", title: "Read", arguments: {} }],
    });
    expect(result.results[0]._retryExhausted).toBe(true);
  });
});
