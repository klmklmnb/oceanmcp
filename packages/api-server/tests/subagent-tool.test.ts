import { describe, test, expect } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { OPERATION_TYPE, type FunctionSchema, type SkillSchema } from "@ocean-mcp/shared";
import { filterReadOnlyTools, SUBAGENT_SERVER_ENABLED } from "../src/ai/tools/subagent-tool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal AI SDK tool (read-only, no needsApproval). */
function makeReadTool(name: string) {
  return tool({
    description: `Read tool: ${name}`,
    inputSchema: z.object({}),
    execute: async () => ({ result: name }),
  });
}

/** Create a tool with needsApproval (write/mutation tool). */
function makeWriteTool(name: string) {
  return Object.assign(
    tool({
      description: `Write tool: ${name}`,
      inputSchema: z.object({}),
      execute: async () => ({ result: name }),
    }),
    { needsApproval: true },
  );
}

/** Create a tool with needsApproval as a function (dynamic approval gate). */
function makeDynamicApprovalTool(name: string) {
  return Object.assign(
    tool({
      description: `Dynamic approval tool: ${name}`,
      inputSchema: z.object({}),
      execute: async () => ({ result: name }),
    }),
    { needsApproval: () => true },
  );
}

function makeFunctionSchema(
  overrides: Partial<FunctionSchema> & { id: string },
): FunctionSchema {
  return {
    name: overrides.id,
    description: `Schema for ${overrides.id}`,
    type: "executor",
    operationType: OPERATION_TYPE.READ,
    parameters: [],
    ...overrides,
  } as FunctionSchema;
}

function makeSkillSchema(name: string, tools: FunctionSchema[]): SkillSchema {
  return { name, description: `Skill ${name}`, tools } as SkillSchema;
}

// ---------------------------------------------------------------------------
// filterReadOnlyTools
// ---------------------------------------------------------------------------

describe("filterReadOnlyTools", () => {
  // ── Blocked tools ──────────────────────────────────────────────────────

  describe("always blocked tools", () => {
    test("removes 'subagent' to prevent recursion", () => {
      const allTools = {
        subagent: makeReadTool("subagent"),
        safeRead: makeReadTool("safeRead"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("subagent");
      expect(result).toHaveProperty("safeRead");
    });

    test("removes 'askUser' (requires user interaction)", () => {
      const allTools = {
        askUser: makeReadTool("askUser"),
        imageOcr: makeReadTool("imageOcr"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("askUser");
      expect(result).toHaveProperty("imageOcr");
    });

    test("removes 'executePlan' (write-only)", () => {
      const allTools = {
        executePlan: makeReadTool("executePlan"),
        readPdf: makeReadTool("readPdf"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("executePlan");
      expect(result).toHaveProperty("readPdf");
    });

    test("removes 'browserExecute' (can reach write tools)", () => {
      const allTools = {
        browserExecute: makeReadTool("browserExecute"),
        loadSkill: makeReadTool("loadSkill"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("browserExecute");
      expect(result).toHaveProperty("loadSkill");
    });

    test("removes all blocked tools simultaneously", () => {
      const allTools = {
        subagent: makeReadTool("subagent"),
        askUser: makeReadTool("askUser"),
        executePlan: makeReadTool("executePlan"),
        browserExecute: makeReadTool("browserExecute"),
        imageOcr: makeReadTool("imageOcr"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(Object.keys(result)).toEqual(["imageOcr"]);
    });
  });

  // ── Allowed server-side tools ──────────────────────────────────────────

  describe("allowed server-side tools (explicit allowlist)", () => {
    test("includes imageOcr", () => {
      const allTools = { imageOcr: makeReadTool("imageOcr") };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).toHaveProperty("imageOcr");
    });

    test("includes readPdf", () => {
      const allTools = { readPdf: makeReadTool("readPdf") };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).toHaveProperty("readPdf");
    });

    test("includes loadSkill", () => {
      const allTools = { loadSkill: makeReadTool("loadSkill") };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).toHaveProperty("loadSkill");
    });
  });

  // ── Browser-proxy tools (via FunctionSchema) ───────────────────────────

  describe("browser-proxy tools filtered by operationType", () => {
    test("includes browser-proxy tool with operationType=read", () => {
      const allTools = {
        getOrders: makeReadTool("getOrders"),
      };
      const schemas = [
        makeFunctionSchema({ id: "getOrders", operationType: OPERATION_TYPE.READ }),
      ];
      const result = filterReadOnlyTools(allTools, schemas, []);
      expect(result).toHaveProperty("getOrders");
    });

    test("excludes browser-proxy tool with operationType=write", () => {
      const allTools = {
        deleteOrder: makeReadTool("deleteOrder"),
      };
      const schemas = [
        makeFunctionSchema({ id: "deleteOrder", operationType: OPERATION_TYPE.WRITE }),
      ];
      const result = filterReadOnlyTools(allTools, schemas, []);
      expect(result).not.toHaveProperty("deleteOrder");
    });

    test("filters mixed read/write browser-proxy tools correctly", () => {
      const allTools = {
        getData: makeReadTool("getData"),
        setData: makeReadTool("setData"),
        listItems: makeReadTool("listItems"),
      };
      const schemas = [
        makeFunctionSchema({ id: "getData", operationType: OPERATION_TYPE.READ }),
        makeFunctionSchema({ id: "setData", operationType: OPERATION_TYPE.WRITE }),
        makeFunctionSchema({ id: "listItems", operationType: OPERATION_TYPE.READ }),
      ];
      const result = filterReadOnlyTools(allTools, schemas, []);
      expect(result).toHaveProperty("getData");
      expect(result).not.toHaveProperty("setData");
      expect(result).toHaveProperty("listItems");
    });
  });

  // ── Skill-bundled tool schemas ─────────────────────────────────────────

  describe("skill-bundled tool schemas", () => {
    test("includes tool from skill schema with operationType=read", () => {
      const allTools = {
        skillReadTool: makeReadTool("skillReadTool"),
      };
      const skillSchemas = [
        makeSkillSchema("my-skill", [
          makeFunctionSchema({ id: "skillReadTool", operationType: OPERATION_TYPE.READ }),
        ]),
      ];
      const result = filterReadOnlyTools(allTools, [], skillSchemas);
      expect(result).toHaveProperty("skillReadTool");
    });

    test("excludes tool from skill schema with operationType=write", () => {
      const allTools = {
        skillWriteTool: makeReadTool("skillWriteTool"),
      };
      const skillSchemas = [
        makeSkillSchema("my-skill", [
          makeFunctionSchema({ id: "skillWriteTool", operationType: OPERATION_TYPE.WRITE }),
        ]),
      ];
      const result = filterReadOnlyTools(allTools, [], skillSchemas);
      expect(result).not.toHaveProperty("skillWriteTool");
    });

    test("standalone schema takes priority over skill-bundled schema", () => {
      const allTools = {
        dualTool: makeReadTool("dualTool"),
      };
      // Standalone says READ, skill says WRITE
      const toolSchemas = [
        makeFunctionSchema({ id: "dualTool", operationType: OPERATION_TYPE.READ }),
      ];
      const skillSchemas = [
        makeSkillSchema("my-skill", [
          makeFunctionSchema({ id: "dualTool", operationType: OPERATION_TYPE.WRITE }),
        ]),
      ];
      const result = filterReadOnlyTools(allTools, toolSchemas, skillSchemas);
      // Standalone (READ) should take priority → included
      expect(result).toHaveProperty("dualTool");
    });
  });

  // ── needsApproval detection ────────────────────────────────────────────

  describe("write tools detected via needsApproval", () => {
    test("excludes tool with needsApproval: true", () => {
      const allTools = {
        writeTool: makeWriteTool("writeTool"),
        readTool: makeReadTool("readTool"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("writeTool");
      expect(result).toHaveProperty("readTool");
    });

    test("excludes tool with needsApproval as a function", () => {
      const allTools = {
        dynamicTool: makeDynamicApprovalTool("dynamicTool"),
        safeTool: makeReadTool("safeTool"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).not.toHaveProperty("dynamicTool");
      expect(result).toHaveProperty("safeTool");
    });
  });

  // ── Unknown tools (no schema, no needsApproval) ────────────────────────

  describe("unknown tools with no schema and no needsApproval", () => {
    test("includes unknown tool (defensive pass-through)", () => {
      const allTools = {
        mysteryTool: makeReadTool("mysteryTool"),
      };
      // No schemas at all — the tool is unknown
      const result = filterReadOnlyTools(allTools, [], []);
      expect(result).toHaveProperty("mysteryTool");
    });
  });

  // ── Comprehensive integration scenario ─────────────────────────────────

  describe("integration: complex tool set filtering", () => {
    test("filters a realistic tool set correctly", () => {
      const allTools = {
        // Blocked
        subagent: makeReadTool("subagent"),
        askUser: makeReadTool("askUser"),
        executePlan: makeReadTool("executePlan"),
        browserExecute: makeReadTool("browserExecute"),
        // Allowed server tools
        imageOcr: makeReadTool("imageOcr"),
        readPdf: makeReadTool("readPdf"),
        loadSkill: makeReadTool("loadSkill"),
        // Browser proxy: read
        getPageInfo: makeReadTool("getPageInfo"),
        getOrderList: makeReadTool("getOrderList"),
        // Browser proxy: write
        deleteOrder: makeReadTool("deleteOrder"),
        updateConfig: makeReadTool("updateConfig"),
        // Skill tool: read (via needsApproval=false, no schema)
        skillReadTool: makeReadTool("skillReadTool"),
        // Skill tool: write (via needsApproval=true)
        skillWriteTool: makeWriteTool("skillWriteTool"),
        // Unknown tool
        unknownCustomTool: makeReadTool("unknownCustomTool"),
      };

      const toolSchemas = [
        makeFunctionSchema({ id: "getPageInfo", operationType: OPERATION_TYPE.READ }),
        makeFunctionSchema({ id: "getOrderList", operationType: OPERATION_TYPE.READ }),
        makeFunctionSchema({ id: "deleteOrder", operationType: OPERATION_TYPE.WRITE }),
        makeFunctionSchema({ id: "updateConfig", operationType: OPERATION_TYPE.WRITE }),
      ];

      const result = filterReadOnlyTools(allTools, toolSchemas, []);
      const names = Object.keys(result).sort();

      expect(names).toEqual([
        "getOrderList",
        "getPageInfo",
        "imageOcr",
        "loadSkill",
        "readPdf",
        "skillReadTool",
        "unknownCustomTool",
      ]);
    });
  });

  // ── Empty inputs ───────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("returns empty object when all tools are blocked", () => {
      const allTools = {
        subagent: makeReadTool("subagent"),
        askUser: makeReadTool("askUser"),
        executePlan: makeReadTool("executePlan"),
        browserExecute: makeReadTool("browserExecute"),
      };
      const result = filterReadOnlyTools(allTools, [], []);
      expect(Object.keys(result)).toHaveLength(0);
    });

    test("returns empty object when input is empty", () => {
      const result = filterReadOnlyTools({}, [], []);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SUBAGENT_SERVER_ENABLED
// ---------------------------------------------------------------------------

describe("SUBAGENT_SERVER_ENABLED", () => {
  test("is a boolean", () => {
    expect(typeof SUBAGENT_SERVER_ENABLED).toBe("boolean");
  });
});
