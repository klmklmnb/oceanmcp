import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
} from "@ocean-mcp/shared";
import {
  isCodeFunctionDefinition,
  wrapCodeFunctionAsTool,
  wrapCodeFunctionDefinitions,
} from "../src/ai/skills/code-tool-adapter";
import { logger } from "../src/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for code-tool-adapter.ts
//
// Tests the detection, wrapping, and execution of CodeFunctionDefinition
// objects as Vercel AI SDK Tool instances on the server side.
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// isCodeFunctionDefinition — type detection
// ═════════════════════════════════════════════════════════════════════════════

describe("isCodeFunctionDefinition", () => {
  test("returns true for a valid CodeFunctionDefinition", () => {
    const def: CodeFunctionDefinition = {
      id: "testTool",
      name: "Test Tool",
      description: "A test tool",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return { result: "ok" }',
      parameters: [],
    };
    expect(isCodeFunctionDefinition(def)).toBe(true);
  });

  test("returns true for CodeFunctionDefinition with parameters", () => {
    const def: CodeFunctionDefinition = {
      id: "paramTool",
      name: "Param Tool",
      description: "Tool with params",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: "return args.name",
      parameters: [
        {
          name: "name",
          type: PARAMETER_TYPE.STRING,
          description: "A name",
          required: true,
        },
      ],
    };
    expect(isCodeFunctionDefinition(def)).toBe(true);
  });

  test("returns false for a Vercel AI SDK Tool", () => {
    const aiTool = tool({
      description: "An AI tool",
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => x * 2,
    });
    expect(isCodeFunctionDefinition(aiTool)).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isCodeFunctionDefinition(null)).toBe(false);
    expect(isCodeFunctionDefinition(undefined)).toBe(false);
  });

  test("returns false for a plain object missing required fields", () => {
    expect(isCodeFunctionDefinition({ type: "code" })).toBe(false);
    expect(
      isCodeFunctionDefinition({
        type: "code",
        code: "return 1",
        // missing id, description, parameters
      }),
    ).toBe(false);
  });

  test("returns false for executor type", () => {
    expect(
      isCodeFunctionDefinition({
        id: "exec",
        name: "Exec",
        description: "Executor tool",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        executor: async () => {},
        parameters: [],
      }),
    ).toBe(false);
  });

  test("returns false for empty code string", () => {
    expect(
      isCodeFunctionDefinition({
        id: "empty",
        name: "Empty",
        description: "Empty code",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: "",
        parameters: [],
      }),
    ).toBe(false);
  });

  test("returns false for a string", () => {
    expect(isCodeFunctionDefinition("not an object")).toBe(false);
  });

  test("returns false for a number", () => {
    expect(isCodeFunctionDefinition(42)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// wrapCodeFunctionAsTool — single definition wrapping
// ═════════════════════════════════════════════════════════════════════════════

describe("wrapCodeFunctionAsTool", () => {
  test("produces a Tool with correct description", () => {
    const def: CodeFunctionDefinition = {
      id: "descTest",
      name: "Desc Test",
      description: "Returns a greeting",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return "hello"',
      parameters: [],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    expect(wrapped).toBeDefined();
    expect(wrapped.description).toBe("Returns a greeting");
  });

  test("executes code and returns the result", async () => {
    const def: CodeFunctionDefinition = {
      id: "execTest",
      name: "Exec Test",
      description: "Returns computed value",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: "return 2 + 2",
      parameters: [],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!({}, { toolCallId: "test", messages: [] } as any);
    expect(result).toBe(4);
  });

  test("passes args to the code function", async () => {
    const def: CodeFunctionDefinition = {
      id: "argsTest",
      name: "Args Test",
      description: "Greets by name",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return "Hello, " + args.name + "!"',
      parameters: [
        {
          name: "name",
          type: PARAMETER_TYPE.STRING,
          description: "Person name",
          required: true,
        },
      ],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!(
      { name: "World" },
      { toolCallId: "test", messages: [] } as any,
    );
    expect(result).toBe("Hello, World!");
  });

  test("supports async code (fetch calls)", async () => {
    // Mock a simple fetch that returns JSON
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      json: async () => ({ data: "mocked" }),
      ok: true,
      status: 200,
    })) as any;

    try {
      const def: CodeFunctionDefinition = {
        id: "fetchTest",
        name: "Fetch Test",
        description: "Fetches data",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: `
          const res = await fetch("https://example.com/api");
          return res.json();
        `,
        parameters: [],
      };

      const wrapped = wrapCodeFunctionAsTool(def);
      const result = await wrapped.execute!({}, { toolCallId: "test", messages: [] } as any);
      expect(result).toEqual({ data: "mocked" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("handles code execution errors gracefully", async () => {
    const def: CodeFunctionDefinition = {
      id: "errorTest",
      name: "Error Test",
      description: "Throws an error",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'throw new Error("something broke")',
      parameters: [],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    await expect(
      wrapped.execute!({}, { toolCallId: "test", messages: [] } as any),
    ).rejects.toThrow("Code tool execution failed: something broke");
  });

  test("window access returns undefined and logs warning", async () => {
    const warnings: string[] = [];
    const originalWarn = logger.warn.bind(logger);
    logger.warn = ((...args: any[]) => { warnings.push(args.map(String).join(" ")); return logger; }) as any;

    try {
      const def: CodeFunctionDefinition = {
        id: "windowTest",
        name: "Window Test",
        description: "Accesses window",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: `
          const href = window.location;
          const title = document.title;
          return { href, title };
        `,
        parameters: [],
      };

      const wrapped = wrapCodeFunctionAsTool(def);
      const result = await wrapped.execute!({}, { toolCallId: "test", messages: [] } as any);

      // Values should be undefined (not crashing)
      expect(result).toEqual({ href: undefined, title: undefined });

      // Warnings should have been logged
      expect(warnings.some((w) => w.includes("window.location"))).toBe(true);
      expect(warnings.some((w) => w.includes("document.title"))).toBe(true);
    } finally {
      logger.warn = originalWarn;
    }
  });

  test("window warning is logged only once per property", async () => {
    const warnings: string[] = [];
    const originalWarn = logger.warn.bind(logger);
    logger.warn = ((...args: any[]) => { warnings.push(args.map(String).join(" ")); return logger; }) as any;

    try {
      const def: CodeFunctionDefinition = {
        id: "dedupWarn",
        name: "Dedup Warn",
        description: "Accesses window.foo twice",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: `
          const a = window.foo;
          const b = window.foo;
          return a;
        `,
        parameters: [],
      };

      const wrapped = wrapCodeFunctionAsTool(def);
      await wrapped.execute!({}, { toolCallId: "test", messages: [] } as any);

      // Should only warn once for window.foo
      const fooWarnings = warnings.filter((w) => w.includes("window.foo"));
      expect(fooWarnings).toHaveLength(1);
    } finally {
      logger.warn = originalWarn;
    }
  });

  test("generates correct Zod schema from parameters", async () => {
    const def: CodeFunctionDefinition = {
      id: "schemaTest",
      name: "Schema Test",
      description: "Tests Zod schema generation",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: "return { name: args.name, count: args.count, active: args.active }",
      parameters: [
        {
          name: "name",
          type: PARAMETER_TYPE.STRING,
          description: "A name",
          required: true,
        },
        {
          name: "count",
          type: PARAMETER_TYPE.NUMBER,
          description: "A count",
          required: true,
        },
        {
          name: "active",
          type: PARAMETER_TYPE.BOOLEAN,
          description: "Is active",
          required: false,
        },
      ],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!(
      { name: "test", count: 5, active: true },
      { toolCallId: "test", messages: [] } as any,
    );
    expect(result).toEqual({ name: "test", count: 5, active: true });
  });

  test("write operations without autoApprove do not crash (needsApproval is set)", () => {
    const def: CodeFunctionDefinition = {
      id: "writeTest",
      name: "Write Test",
      description: "A write operation",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.WRITE,
      code: 'return "written"',
      parameters: [],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    expect(wrapped).toBeDefined();
    expect(wrapped.description).toBe("A write operation");
  });

  test("write operations with autoApprove produce executable tool", async () => {
    const def: CodeFunctionDefinition = {
      id: "autoApproveTest",
      name: "Auto Approve Test",
      description: "Auto-approved write",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      code: 'return "auto-approved"',
      parameters: [],
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!({}, { toolCallId: "test", messages: [] } as any);
    expect(result).toBe("auto-approved");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// wrapCodeFunctionDefinitions — batch wrapping of mixed exports
// ═════════════════════════════════════════════════════════════════════════════

describe("wrapCodeFunctionDefinitions", () => {
  test("wraps CodeFunctionDefinition entries keyed by def.id", () => {
    const exports = {
      someKey: {
        id: "myCodeTool",
        name: "My Code Tool",
        description: "A code tool",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "code"',
        parameters: [],
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);

    // Keyed by def.id, not the export key
    expect(result).toHaveProperty("myCodeTool");
    expect(result).not.toHaveProperty("someKey");
  });

  test("passes through Vercel AI SDK Tool entries with original key", () => {
    const myTool = tool({
      description: "An AI SDK tool",
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => x * 2,
    });

    const exports = {
      myToolKey: myTool,
    };

    const result = wrapCodeFunctionDefinitions(exports);

    expect(result).toHaveProperty("myToolKey");
    expect(result.myToolKey).toBe(myTool); // same reference
  });

  test("handles mixed exports (Tool + CodeFunctionDefinition)", async () => {
    const aiTool = tool({
      description: "AI SDK tool",
      inputSchema: z.object({}),
      execute: async () => "ai-result",
    });

    const exports = {
      aiTool,
      codeTool: {
        id: "codeTool",
        name: "Code Tool",
        description: "Code-based tool",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "code-result"',
        parameters: [],
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);

    // AI SDK tool passed through
    expect(result).toHaveProperty("aiTool");
    expect(result.aiTool).toBe(aiTool);

    // CodeFunctionDefinition wrapped, keyed by def.id
    expect(result).toHaveProperty("codeTool");
    expect(result.codeTool).not.toBe(exports.codeTool); // wrapped, not the original

    // Wrapped tool is executable
    const codeResult = await result.codeTool.execute!(
      {},
      { toolCallId: "test", messages: [] } as any,
    );
    expect(codeResult).toBe("code-result");
  });

  test("handles empty exports", () => {
    const result = wrapCodeFunctionDefinitions({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  test("skips non-object entries (strings, numbers, etc.)", () => {
    const exports = {
      aString: "not a tool",
      aNumber: 42,
      aBool: true,
      validTool: {
        id: "valid",
        name: "Valid",
        description: "Valid tool",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "ok"',
        parameters: [],
      },
    };

    const result = wrapCodeFunctionDefinitions(exports as any);

    // Only the valid code tool should be in the result
    expect(result).toHaveProperty("valid");
    expect(Object.keys(result)).toHaveLength(1);
  });

  test("multiple CodeFunctionDefinitions are all wrapped", async () => {
    const exports = {
      tool1: {
        id: "fetchUsers",
        name: "Fetch Users",
        description: "Gets users",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "users"',
        parameters: [],
      },
      tool2: {
        id: "fetchOrders",
        name: "Fetch Orders",
        description: "Gets orders",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "orders"',
        parameters: [],
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);

    expect(result).toHaveProperty("fetchUsers");
    expect(result).toHaveProperty("fetchOrders");

    const r1 = await result.fetchUsers.execute!({}, { toolCallId: "t1", messages: [] } as any);
    const r2 = await result.fetchOrders.execute!({}, { toolCallId: "t2", messages: [] } as any);
    expect(r1).toBe("users");
    expect(r2).toBe("orders");
  });
});
