import { describe, test, expect } from "bun:test";
import { tool, jsonSchema } from "ai";
import { z } from "zod";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  isJSONSchemaParameters,
  type ParameterDefinition,
  type JSONSchemaParameters,
  type FunctionParameters,
  type CodeFunctionDefinition,
} from "@ocean-mcp/shared";
import { createZodSchema, createInputSchema } from "../src/ai/tools/index";
import {
  isCodeFunctionDefinition,
  wrapCodeFunctionAsTool,
  wrapCodeFunctionDefinitions,
} from "../src/ai/skills/code-tool-adapter";

// ═════════════════════════════════════════════════════════════════════════════
// isJSONSchemaParameters — type guard
// ═════════════════════════════════════════════════════════════════════════════

describe("isJSONSchemaParameters", () => {
  test("returns true for a valid JSON Schema parameters object", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      properties: {
        name: { type: "string", description: "User name" },
      },
      required: ["name"],
    };
    expect(isJSONSchemaParameters(params)).toBe(true);
  });

  test("returns true for minimal JSON Schema (empty properties)", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      properties: {},
    };
    expect(isJSONSchemaParameters(params)).toBe(true);
  });

  test("returns true for JSON Schema with nested objects", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    };
    expect(isJSONSchemaParameters(params)).toBe(true);
  });

  test("returns true for JSON Schema with additionalProperties: false", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      properties: {
        weight: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    };
    expect(isJSONSchemaParameters(params)).toBe(true);
  });

  test("returns false for legacy ParameterDefinition[]", () => {
    const params: ParameterDefinition[] = [
      { name: "name", type: PARAMETER_TYPE.STRING, required: true },
    ];
    expect(isJSONSchemaParameters(params)).toBe(false);
  });

  test("returns false for empty array", () => {
    expect(isJSONSchemaParameters([])).toBe(false);
  });

  test("returns false for object without type: 'object'", () => {
    const params = {
      type: "string",
      properties: { name: { type: "string" } },
    } as any;
    expect(isJSONSchemaParameters(params)).toBe(false);
  });

  test("returns false for object without properties", () => {
    const params = { type: "object" } as any;
    expect(isJSONSchemaParameters(params)).toBe(false);
  });

  test("returns false for null", () => {
    expect(isJSONSchemaParameters(null as any)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createZodSchema — legacy ParameterDefinition[] format
// ═════════════════════════════════════════════════════════════════════════════

describe("createZodSchema (legacy format)", () => {
  test("creates schema for string parameters", () => {
    const params: ParameterDefinition[] = [
      { name: "name", type: PARAMETER_TYPE.STRING, required: true },
    ];
    const schema = createZodSchema(params);
    expect(schema.safeParse({ name: "hello" }).success).toBe(true);
    expect(schema.safeParse({ name: 42 }).success).toBe(false);
  });

  test("creates schema for number parameters", () => {
    const params: ParameterDefinition[] = [
      { name: "count", type: PARAMETER_TYPE.NUMBER, required: true },
    ];
    const schema = createZodSchema(params);
    expect(schema.safeParse({ count: 42 }).success).toBe(true);
    expect(schema.safeParse({ count: "42" }).success).toBe(false);
  });

  test("creates schema for boolean parameters", () => {
    const params: ParameterDefinition[] = [
      { name: "active", type: PARAMETER_TYPE.BOOLEAN, required: true },
    ];
    const schema = createZodSchema(params);
    expect(schema.safeParse({ active: true }).success).toBe(true);
    expect(schema.safeParse({ active: "true" }).success).toBe(false);
  });

  test("creates schema for optional parameters", () => {
    const params: ParameterDefinition[] = [
      { name: "label", type: PARAMETER_TYPE.STRING, required: false },
    ];
    const schema = createZodSchema(params);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ label: "test" }).success).toBe(true);
  });

  test("creates schema with enum values from enumMap", () => {
    const params: ParameterDefinition[] = [
      {
        name: "env",
        type: PARAMETER_TYPE.STRING,
        required: true,
        enumMap: { dev: "Development", prod: "Production" },
      },
    ];
    const schema = createZodSchema(params);
    expect(schema.safeParse({ env: "dev" }).success).toBe(true);
    expect(schema.safeParse({ env: "prod" }).success).toBe(true);
    expect(schema.safeParse({ env: "staging" }).success).toBe(false);
  });

  test("creates schema for array types", () => {
    const params: ParameterDefinition[] = [
      { name: "tags", type: PARAMETER_TYPE.STRING_ARRAY, required: true },
      { name: "scores", type: PARAMETER_TYPE.NUMBER_ARRAY, required: true },
    ];
    const schema = createZodSchema(params);
    expect(
      schema.safeParse({ tags: ["a", "b"], scores: [1, 2, 3] }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ tags: [1, 2], scores: [1, 2, 3] }).success,
    ).toBe(false);
  });

  test("creates schema for empty parameters", () => {
    const schema = createZodSchema([]);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createInputSchema — unified function (legacy + JSON Schema)
// ═════════════════════════════════════════════════════════════════════════════

describe("createInputSchema", () => {
  test("returns Zod schema for legacy ParameterDefinition[]", () => {
    const params: ParameterDefinition[] = [
      { name: "name", type: PARAMETER_TYPE.STRING, required: true },
    ];
    const schema = createInputSchema(params);
    // Zod schemas have the shape property
    expect(schema).toBeDefined();
    // Should be a Zod object schema (has `shape` property)
    expect((schema as any).shape || (schema as any).jsonSchema).toBeDefined();
  });

  test("returns JSON Schema wrapper for JSONSchemaParameters", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      required: ["weight"],
      properties: {
        weight: { type: "number", description: "Weight in kg" },
        express: { type: "boolean", description: "Express shipping" },
      },
      additionalProperties: false,
    };
    const schema = createInputSchema(params);
    expect(schema).toBeDefined();
    // JSON Schema wrapper from AI SDK has a `jsonSchema` property
    expect((schema as any).jsonSchema).toBeDefined();
  });

  test("handles empty legacy parameters", () => {
    const schema = createInputSchema([]);
    expect(schema).toBeDefined();
  });

  test("handles empty JSON Schema properties", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      properties: {},
    };
    const schema = createInputSchema(params);
    expect(schema).toBeDefined();
  });

  test("handles complex nested JSON Schema", () => {
    const params: JSONSchemaParameters = {
      type: "object",
      required: ["name", "address"],
      properties: {
        name: { type: "string", minLength: 1 },
        age: { type: "number", minimum: 0, maximum: 150 },
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string", pattern: "^[0-9]{5}$" },
          },
          required: ["city"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
        },
        role: {
          type: "string",
          enum: ["admin", "user", "guest"],
        },
      },
    };
    const schema = createInputSchema(params);
    expect(schema).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// isCodeFunctionDefinition — with JSON Schema parameters
// ═════════════════════════════════════════════════════════════════════════════

describe("isCodeFunctionDefinition with JSON Schema params", () => {
  test("returns true for CodeFunctionDefinition with JSON Schema parameters", () => {
    const def = {
      id: "shippingCalc",
      name: "Shipping Calculator",
      description: "Calculate shipping cost",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return { cost: args.weight * 5 }',
      parameters: {
        type: "object",
        required: ["weight"],
        properties: {
          weight: { type: "number", description: "Weight in kg" },
        },
        additionalProperties: false,
      },
    };
    expect(isCodeFunctionDefinition(def)).toBe(true);
  });

  test("returns true for CodeFunctionDefinition with legacy array parameters", () => {
    const def = {
      id: "echo",
      name: "Echo",
      description: "Echo back",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return args.msg',
      parameters: [
        { name: "msg", type: "string", required: true },
      ],
    };
    expect(isCodeFunctionDefinition(def)).toBe(true);
  });

  test("returns false for object with invalid parameters (not array, not JSON Schema)", () => {
    const def = {
      id: "bad",
      name: "Bad",
      description: "Bad tool",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return 1',
      parameters: "invalid",
    };
    expect(isCodeFunctionDefinition(def)).toBe(false);
  });

  test("returns false for JSON Schema without properties field", () => {
    const def = {
      id: "bad2",
      name: "Bad2",
      description: "Bad tool 2",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return 1',
      parameters: { type: "object" }, // missing properties
    };
    expect(isCodeFunctionDefinition(def)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// wrapCodeFunctionAsTool — with JSON Schema parameters
// ═════════════════════════════════════════════════════════════════════════════

describe("wrapCodeFunctionAsTool with JSON Schema params", () => {
  test("produces a Tool with correct description", () => {
    const def: CodeFunctionDefinition = {
      id: "jsonSchemaTest",
      name: "JSON Schema Test",
      description: "Test tool with JSON Schema params",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return { weight: args.weight }',
      parameters: {
        type: "object",
        required: ["weight"],
        properties: {
          weight: { type: "number", description: "Weight in kg", minimum: 0 },
        },
        additionalProperties: false,
      },
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    expect(wrapped).toBeDefined();
    expect(wrapped.description).toBe("Test tool with JSON Schema params");
  });

  test("executes code and returns result with JSON Schema params", async () => {
    const def: CodeFunctionDefinition = {
      id: "calcTest",
      name: "Calc Test",
      description: "Calculate with JSON Schema",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return { total: args.a + args.b }',
      parameters: {
        type: "object",
        required: ["a", "b"],
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
      },
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!(
      { a: 3, b: 7 },
      { toolCallId: "test", messages: [] } as any,
    );
    expect(result).toEqual({ total: 10 });
  });

  test("handles nested object args with JSON Schema params", async () => {
    const def: CodeFunctionDefinition = {
      id: "nestedTest",
      name: "Nested Test",
      description: "Test with nested objects",
      type: FUNCTION_TYPE.CODE,
      operationType: OPERATION_TYPE.READ,
      code: 'return { city: args.address.city, name: args.name }',
      parameters: {
        type: "object",
        required: ["name", "address"],
        properties: {
          name: { type: "string" },
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              city: { type: "string" },
            },
            required: ["city"],
          },
        },
      },
    };

    const wrapped = wrapCodeFunctionAsTool(def);
    const result = await wrapped.execute!(
      { name: "Alice", address: { city: "Shanghai", street: "Nanjing Rd" } },
      { toolCallId: "test", messages: [] } as any,
    );
    expect(result).toEqual({ city: "Shanghai", name: "Alice" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// wrapCodeFunctionDefinitions — mixed exports with JSON Schema
// ═════════════════════════════════════════════════════════════════════════════

describe("wrapCodeFunctionDefinitions with JSON Schema params", () => {
  test("wraps CodeFunctionDefinition with JSON Schema params", () => {
    const exports = {
      myTool: {
        id: "jsonSchemaTool",
        name: "JSON Schema Tool",
        description: "A tool with JSON Schema params",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return { ok: true }',
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);
    expect(result).toHaveProperty("jsonSchemaTool");
  });

  test("handles mixed legacy and JSON Schema tools in same export", async () => {
    const exports = {
      legacyTool: {
        id: "legacyTool",
        name: "Legacy Tool",
        description: "Legacy params",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return args.msg',
        parameters: [
          { name: "msg", type: "string", required: true },
        ],
      },
      jsonSchemaTool: {
        id: "jsonSchemaTool",
        name: "JSON Schema Tool",
        description: "JSON Schema params",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return { weight: args.weight }',
        parameters: {
          type: "object",
          required: ["weight"],
          properties: {
            weight: { type: "number", minimum: 0 },
          },
        },
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);

    expect(result).toHaveProperty("legacyTool");
    expect(result).toHaveProperty("jsonSchemaTool");

    // Both should be executable
    const legacyResult = await result.legacyTool.execute!(
      { msg: "hello" },
      { toolCallId: "t1", messages: [] } as any,
    );
    expect(legacyResult).toBe("hello");

    const jsonResult = await result.jsonSchemaTool.execute!(
      { weight: 5 },
      { toolCallId: "t2", messages: [] } as any,
    );
    expect(jsonResult).toEqual({ weight: 5 });
  });

  test("mixes AI SDK tools and CodeFunctionDefinitions with JSON Schema", () => {
    const aiTool = tool({
      description: "AI SDK tool",
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => x * 2,
    });

    const exports = {
      aiTool,
      codeWithJsonSchema: {
        id: "codeWithJsonSchema",
        name: "Code With JSON Schema",
        description: "Code tool with JSON Schema",
        type: FUNCTION_TYPE.CODE,
        operationType: OPERATION_TYPE.READ,
        code: 'return "ok"',
        parameters: {
          type: "object",
          properties: {},
        },
      },
    };

    const result = wrapCodeFunctionDefinitions(exports);

    // AI SDK tool passed through
    expect(result).toHaveProperty("aiTool");
    expect(result.aiTool).toBe(aiTool);

    // Code tool with JSON Schema wrapped
    expect(result).toHaveProperty("codeWithJsonSchema");
    expect(result.codeWithJsonSchema).not.toBe(exports.codeWithJsonSchema);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Integration: JSON Schema test fixture tools
// ═════════════════════════════════════════════════════════════════════════════

describe("JSON Schema fixture tools integration", () => {
  test("loads and wraps json-schema-tools fixture", async () => {
    const fixtureExports = await import(
      "./fixtures/skills/json-schema-tools/tools"
    );
    const tools = fixtureExports.default;

    // greetUser is a CodeFunctionDefinition with JSON Schema params
    expect(isCodeFunctionDefinition(tools.greetUser)).toBe(true);
    expect(
      isJSONSchemaParameters(tools.greetUser.parameters as FunctionParameters),
    ).toBe(true);

    // processOrder is a Vercel AI SDK Tool
    expect(isCodeFunctionDefinition(tools.processOrder)).toBe(false);

    // legacyEcho is a legacy CodeFunctionDefinition
    expect(isCodeFunctionDefinition(tools.legacyEcho)).toBe(true);
    expect(
      isJSONSchemaParameters(tools.legacyEcho.parameters as FunctionParameters),
    ).toBe(false);

    // Wrap all exports
    const wrapped = wrapCodeFunctionDefinitions(tools);
    expect(Object.keys(wrapped).length).toBe(3);

    // Execute greetUser
    const greetResult = await wrapped.greetUser.execute!(
      { name: "Alice", language: "en", formal: false },
      { toolCallId: "t1", messages: [] } as any,
    );
    expect(greetResult).toEqual({ greeting: "Hey Alice!" });

    // Execute legacyEcho
    const echoResult = await wrapped.legacyEcho.execute!(
      { message: "test" },
      { toolCallId: "t2", messages: [] } as any,
    );
    expect(echoResult).toEqual({ echo: "test" });
  });
});
