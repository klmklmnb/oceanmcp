import { describe, test, expect, beforeEach } from "vitest";
import { sdkConfig, type SubagentConfig } from "../src/runtime/sdk-config";

// ---------------------------------------------------------------------------
// SubagentConfig in sdkConfig
// ---------------------------------------------------------------------------

describe("sdkConfig.subagent", () => {
  beforeEach(() => {
    // Reset to undefined before each test
    sdkConfig.subagent = undefined;
  });

  test("defaults to undefined", () => {
    expect(sdkConfig.subagent).toBeUndefined();
  });

  test("can be set to a SubagentConfig object", () => {
    const config: SubagentConfig = {
      enable: true,
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent).toEqual({ enable: true });
  });

  test("can be set with model and timeoutSeconds", () => {
    const config: SubagentConfig = {
      enable: true,
      model: { default: "gpt-4o-mini" },
      timeoutSeconds: 60,
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent).toBeDefined();
    expect(sdkConfig.subagent!.enable).toBe(true);
    expect(sdkConfig.subagent!.model).toEqual({ default: "gpt-4o-mini" });
    expect(sdkConfig.subagent!.timeoutSeconds).toBe(60);
  });

  test("enable defaults to false in typical usage", () => {
    const config: SubagentConfig = {
      enable: false,
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent!.enable).toBe(false);
  });

  test("model is optional and defaults to undefined", () => {
    const config: SubagentConfig = {
      enable: true,
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent!.model).toBeUndefined();
  });

  test("timeoutSeconds is optional and defaults to undefined", () => {
    const config: SubagentConfig = {
      enable: true,
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent!.timeoutSeconds).toBeUndefined();
  });

  test("can be reset to undefined", () => {
    sdkConfig.subagent = { enable: true };
    expect(sdkConfig.subagent).toBeDefined();
    sdkConfig.subagent = undefined;
    expect(sdkConfig.subagent).toBeUndefined();
  });

  test("model config supports all ModelConfig fields", () => {
    const config: SubagentConfig = {
      enable: true,
      model: {
        default: "claude-sonnet-4-20250514",
        fast: "gpt-4o-mini",
        maxTokens: 4096,
        thinkingBudget: 8192,
        reasoningEffort: "high",
      },
    };
    sdkConfig.subagent = config;
    expect(sdkConfig.subagent!.model!.default).toBe("claude-sonnet-4-20250514");
    expect(sdkConfig.subagent!.model!.fast).toBe("gpt-4o-mini");
    expect(sdkConfig.subagent!.model!.maxTokens).toBe(4096);
    expect(sdkConfig.subagent!.model!.thinkingBudget).toBe(8192);
    expect(sdkConfig.subagent!.model!.reasoningEffort).toBe("high");
  });
});
