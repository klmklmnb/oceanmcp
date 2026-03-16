import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  initSkills,
  getSystemPrompt,
} from "../src/ai/prompts";
import { connectionManager } from "../src/ws/connection-manager";

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

// ---------------------------------------------------------------------------
// Template variable rendering: {{ subagent_section }}
// ---------------------------------------------------------------------------

describe("system prompt — subagent section conditional rendering", () => {
  const connId = "conn-subagent-prompt";

  beforeEach(async () => {
    await initSkills();
    connectionManager.addConnection(connId, createMockWs(connId));
  });

  afterEach(() => {
    connectionManager.removeConnection(connId);
  });

  test("subagent section is INCLUDED when subagentEnabled=true (options object)", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: true,
    });
    expect(prompt).toContain("Subagent Delegation");
    expect(prompt).toContain("subagent");
    expect(prompt).toContain("READ tools");
    expect(prompt).toContain("parallel");
  });

  test("subagent section is EXCLUDED when subagentEnabled=false (options object)", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: false,
    });
    expect(prompt).not.toContain("Subagent Delegation");
    expect(prompt).not.toContain("READ tools");
  });

  test("subagent section is EXCLUDED when subagentEnabled is undefined (options object)", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
    });
    expect(prompt).not.toContain("Subagent Delegation");
  });

  test("subagent section is EXCLUDED when using the old positional signature", () => {
    // Old signature: getSystemPrompt(connectionId, locale)
    // subagentEnabled defaults to false
    const prompt = getSystemPrompt(connId, "en-US");
    expect(prompt).not.toContain("Subagent Delegation");
  });

  test("template placeholder {{ subagent_section }} is fully removed when disabled", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: false,
    });
    // The placeholder itself should not appear in the output
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("}}");
    expect(prompt).not.toContain("subagent_section");
  });

  test("template placeholder {{ subagent_section }} is replaced when enabled", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: true,
    });
    // The placeholder should be replaced, not left in raw form
    expect(prompt).not.toContain("{{ subagent_section }}");
    expect(prompt).not.toContain("{{subagent_section}}");
  });

  test("base prompt content is always present regardless of subagent flag", () => {
    const promptEnabled = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: true,
    });
    const promptDisabled = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: false,
    });

    // Both should contain the base prompt sections
    expect(promptEnabled).toContain("OceanMCP");
    expect(promptDisabled).toContain("OceanMCP");
    expect(promptEnabled).toContain("Guidelines");
    expect(promptDisabled).toContain("Guidelines");
  });

  test("locale instructions are appended regardless of subagent flag", () => {
    const prompt = getSystemPrompt({
      connectionId: connId,
      locale: "zh-CN",
      subagentEnabled: false,
    });
    expect(prompt).toContain("简体中文");
  });

  test("askUser encouragement is appended regardless of subagent flag", () => {
    const promptEnabled = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: true,
    });
    const promptDisabled = getSystemPrompt({
      connectionId: connId,
      subagentEnabled: false,
    });
    expect(promptEnabled).toContain("askUser");
    expect(promptDisabled).toContain("askUser");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: old getSystemPrompt(connectionId, locale) signature
// ---------------------------------------------------------------------------

describe("system prompt — backward compatibility", () => {
  const connId = "conn-compat";

  beforeEach(async () => {
    await initSkills();
    connectionManager.addConnection(connId, createMockWs(connId));
  });

  afterEach(() => {
    connectionManager.removeConnection(connId);
  });

  test("old signature with connectionId only works", () => {
    const prompt = getSystemPrompt(connId);
    expect(prompt).toContain("OceanMCP");
    expect(prompt).not.toContain("Subagent Delegation");
  });

  test("old signature with connectionId and locale works", () => {
    const prompt = getSystemPrompt(connId, "en-US");
    expect(prompt).toContain("OceanMCP");
    expect(prompt).toContain("English");
  });

  test("call with no arguments works", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toContain("OceanMCP");
  });

  test("new options object and old positional produce same base content", () => {
    const oldPrompt = getSystemPrompt(connId, "en-US");
    const newPrompt = getSystemPrompt({
      connectionId: connId,
      locale: "en-US",
      subagentEnabled: false,
    });
    // Both should have the same content since subagent is disabled
    expect(oldPrompt).toBe(newPrompt);
  });
});
