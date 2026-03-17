import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  OPERATION_TYPE,
  PARAMETER_TYPE,
  WSMessageType,
  type WSMessage,
} from "oceanmcp-shared";
import type { FunctionSchema, SkillSchema } from "oceanmcp-shared";
import { connectionManager } from "../src/ws/connection-manager";
import { createBrowserProxyToolFromSchema } from "../src/ai/tools";
import { createExecutePlanTool } from "../src/ai/tools/execute-plan-tool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONN_ID = "test-write-guard-proxy";

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
 * Minimal fake WebSocket that auto-resolves tool execution requests.
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
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  connectionManager.addConnection(CONN_ID, createMockWs());
});

afterEach(() => {
  connectionManager.removeConnection(CONN_ID);
});

// ---------------------------------------------------------------------------
// Bug #1: createBrowserProxyToolFromSchema — missing write guard
//
// When tools are registered as native LLM tools via
// createBrowserProxyToolFromSchema (for skill-bundled or standalone dynamic
// tools), WRITE tools without autoApprove must have `needsApproval`
// set so the Vercel AI SDK pauses for user approval.
// ---------------------------------------------------------------------------

describe("createBrowserProxyToolFromSchema — needsApproval gate", () => {
  test("WRITE tool without autoApprove has needsApproval that returns true", async () => {
    const schema = makeFunctionSchema({
      id: "deleteItem",
      operationType: OPERATION_TYPE.WRITE,
    });
    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID);

    // The tool must have a needsApproval property
    expect((proxyTool as any).needsApproval).toBeDefined();

    // needsApproval should resolve to true (require approval)
    const needs =
      typeof (proxyTool as any).needsApproval === "function"
        ? await (proxyTool as any).needsApproval({})
        : (proxyTool as any).needsApproval;
    expect(needs).toBe(true);
  });

  test("WRITE tool with autoApprove: true does NOT require approval", async () => {
    const schema = makeFunctionSchema({
      id: "addLog",
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
    });
    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID);

    // needsApproval should be absent, false, or a function returning false
    const raw = (proxyTool as any).needsApproval;
    if (raw == null || raw === false) {
      // OK — no approval needed
      expect(true).toBe(true);
    } else if (typeof raw === "function") {
      expect(await raw({})).toBe(false);
    } else {
      // needsApproval is truthy — that's wrong for autoApprove tools
      expect(raw).toBeFalsy();
    }
  });

  test("READ tool does NOT require approval", async () => {
    const schema = makeFunctionSchema({
      id: "getData",
      operationType: OPERATION_TYPE.READ,
    });
    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID);

    const raw = (proxyTool as any).needsApproval;
    if (raw == null || raw === false) {
      expect(true).toBe(true);
    } else if (typeof raw === "function") {
      expect(await raw({})).toBe(false);
    } else {
      expect(raw).toBeFalsy();
    }
  });

  test("WRITE tool without autoApprove still executes correctly after approval", async () => {
    const schema = makeFunctionSchema({
      id: "updateRecord",
      operationType: OPERATION_TYPE.WRITE,
    });
    connectionManager.registerTools(CONN_ID, [schema]);

    const proxyTool = createBrowserProxyToolFromSchema(schema, CONN_ID);
    // Simulate post-approval execution
    const result = await (proxyTool as any).execute({});
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Bug #3: executePlan validateSteps only checks standalone toolSchemas,
// not skill-bundled schemas — so validation can pass for skill-bundled
// tools with incorrect arguments, and the plan goes straight to user
// approval with bad data.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bug: LLM sends `steps` as a JSON string instead of an array, causing
// Zod schema validation to fail with "Expected array, received string"
// before execute() is ever called. The z.preprocess wrapper should
// auto-parse stringified JSON arrays so the plan proceeds normally.
// ---------------------------------------------------------------------------

describe("executePlan — stringified steps auto-parsing", () => {
  test("accepts steps as a JSON string and parses it into an array", async () => {
    connectionManager.registerTools(CONN_ID, [
      makeFunctionSchema({
        id: "updateFormValues",
        operationType: OPERATION_TYPE.WRITE,
      }),
    ]);

    const planTool = createExecutePlanTool(CONN_ID);

    const stepsArray = [
      {
        functionId: "updateFormValues",
        title: "Fill form values",
        arguments: { title: "2025年5月通行费报销" },
      },
    ];

    const input = {
      intent: "Fill reimbursement form",
      // Simulate the LLM sending steps as a JSON string
      steps: JSON.stringify(stepsArray),
    };

    // The inputSchema should preprocess the string into an array,
    // so needsApproval receives a valid parsed input.
    const inputSchema = (planTool as any).inputSchema;
    const parsed = inputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.steps)).toBe(true);
    expect(parsed.data.steps).toHaveLength(1);
    expect(parsed.data.steps[0].functionId).toBe("updateFormValues");
  });

  test("still rejects steps that are a non-array JSON string", async () => {
    const planTool = createExecutePlanTool(CONN_ID);
    const inputSchema = (planTool as any).inputSchema;

    const parsed = inputSchema.safeParse({
      intent: "test",
      steps: JSON.stringify({ not: "an array" }),
    });
    expect(parsed.success).toBe(false);
  });

  test("still rejects steps that are a non-JSON string", async () => {
    const planTool = createExecutePlanTool(CONN_ID);
    const inputSchema = (planTool as any).inputSchema;

    const parsed = inputSchema.safeParse({
      intent: "test",
      steps: "this is not json at all",
    });
    expect(parsed.success).toBe(false);
  });

  test("normal array steps still work as before", async () => {
    const planTool = createExecutePlanTool(CONN_ID);
    const inputSchema = (planTool as any).inputSchema;

    const parsed = inputSchema.safeParse({
      intent: "test",
      steps: [
        {
          functionId: "someFunc",
          title: "Do something",
          arguments: { key: "value" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.steps).toHaveLength(1);
  });
});

describe("executePlan — validateSteps skill-bundled schema lookup", () => {
  test("validates parameters of skill-bundled tools (rejects invalid args)", async () => {
    // Register a skill with a tool that has a REQUIRED string parameter
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
          parameters: [
            {
              name: "itemId",
              type: PARAMETER_TYPE.STRING,
              description: "The item ID",
              required: true,
            },
            {
              name: "quantity",
              type: PARAMETER_TYPE.NUMBER,
              description: "New quantity",
              required: true,
            },
          ],
        }),
      ]),
    ]);
    // Do NOT register it as a standalone tool
    connectionManager.registerTools(CONN_ID, []);

    const planTool = createExecutePlanTool(CONN_ID);

    const input = {
      intent: "Update stock",
      steps: [
        {
          functionId: "updateStock",
          title: "Update stock level",
          // Missing required "itemId" and "quantity" — should fail validation
          arguments: {},
        },
      ],
    };

    // needsApproval should return false (validation fails → silent retry),
    // meaning the plan is NOT shown to the user.
    const needs = await (planTool as any).needsApproval(input);
    expect(needs).toBe(false);

    // execute should return a validation error, not actually run the tool
    const result = await (planTool as any).execute(input);
    expect(result.validationError).toBeDefined();
    expect(result._silentRetry).toBe(true);
  });

  test("accepts valid parameters for skill-bundled tools", async () => {
    connectionManager.registerSkills(CONN_ID, [
      makeSkillSchema("inventory", [
        makeFunctionSchema({
          id: "updateStock",
          operationType: OPERATION_TYPE.WRITE,
          parameters: [
            {
              name: "itemId",
              type: PARAMETER_TYPE.STRING,
              description: "The item ID",
              required: true,
            },
          ],
        }),
      ]),
    ]);
    connectionManager.registerTools(CONN_ID, []);

    const planTool = createExecutePlanTool(CONN_ID);

    const input = {
      intent: "Update stock",
      steps: [
        {
          functionId: "updateStock",
          title: "Update stock level",
          arguments: { itemId: "SKU-123" },
        },
      ],
    };

    // Valid args → needsApproval returns true (show plan to user)
    const needs = await (planTool as any).needsApproval(input);
    expect(needs).toBe(true);
  });
});
