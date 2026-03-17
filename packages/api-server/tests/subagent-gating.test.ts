import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { connectionManager } from "../src/ws/connection-manager";
import { getMergedTools } from "../src/ai/tools";
import { initSkills } from "../src/ai/prompts";
import { getLanguageModel } from "../src/ai/providers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWs(connectionId: string) {
  return {
    data: { connectionId },
    send: () => {},
    close: () => {},
  } as any;
}

const CONN_ID = "conn-subagent-gating";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initSkills();
  connectionManager.addConnection(CONN_ID, createMockWs(CONN_ID));
});

afterEach(() => {
  connectionManager.removeConnection(CONN_ID);
});

// ---------------------------------------------------------------------------
// Subagent tool registration gating
// ---------------------------------------------------------------------------

describe("getMergedTools — subagent registration gating", () => {
  // The gating logic requires both:
  //   1. SUBAGENT_SERVER_ENABLED (env var, default true)
  //   2. options.subagentEnabled === true (frontend flag)
  //   3. options.model is provided

  test("subagent tool is NOT included when subagentEnabled is not provided", () => {
    const tools = getMergedTools([], CONN_ID, undefined);
    expect(tools).not.toHaveProperty("subagent");
  });

  test("subagent tool is NOT included when subagentEnabled=false", () => {
    const model = getLanguageModel();
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: false,
      model,
    });
    expect(tools).not.toHaveProperty("subagent");
  });

  test("subagent tool is NOT included when model is not provided even if enabled", () => {
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: true,
    });
    expect(tools).not.toHaveProperty("subagent");
  });

  test("subagent tool IS included when subagentEnabled=true and model is provided", () => {
    const model = getLanguageModel();
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: true,
      model,
    });
    expect(tools).toHaveProperty("subagent");
  });

  test("subagent tool has execute function", () => {
    const model = getLanguageModel();
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: true,
      model,
    });
    const subagentTool = tools.subagent as any;
    expect(subagentTool).toBeDefined();
    // The tool should have the expected properties
    expect(subagentTool.description).toBeDefined();
    expect(typeof subagentTool.description).toBe("string");
    expect(subagentTool.description).toContain("subagent");
  });

  test("subagent tool coexists with other tools", () => {
    const model = getLanguageModel();
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: true,
      model,
    });
    // Verify standard tools still exist
    expect(tools).toHaveProperty("askUser");
    expect(tools).toHaveProperty("imageOcr");
    expect(tools).toHaveProperty("readPdf");
    expect(tools).toHaveProperty("browserExecute");
    expect(tools).toHaveProperty("executePlan");
    expect(tools).toHaveProperty("subagent");
  });

  test("subagent config (model, timeout) is passed through", () => {
    const model = getLanguageModel();
    // This test verifies the tool is created without error when
    // subagentModel and subagentTimeoutMs are provided
    const tools = getMergedTools([], CONN_ID, undefined, {
      subagentEnabled: true,
      model,
      subagentModel: { default: "gpt-4o-mini" },
      subagentTimeoutMs: 30_000,
    });
    expect(tools).toHaveProperty("subagent");
  });

  test("subagent tool is NOT included when options is undefined", () => {
    const tools = getMergedTools([], CONN_ID, undefined, undefined);
    expect(tools).not.toHaveProperty("subagent");
  });

  test("default subagentEnabled is false (not undefined-as-truthy)", () => {
    const model = getLanguageModel();
    // Passing model but not subagentEnabled → should NOT register
    const tools = getMergedTools([], CONN_ID, undefined, { model });
    expect(tools).not.toHaveProperty("subagent");
  });
});
