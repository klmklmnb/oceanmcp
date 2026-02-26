import { describe, test, expect } from "bun:test";
import { deduplicateAssistantParts } from "../src/routes/deduplicate-parts";

// ---------------------------------------------------------------------------
// Helpers — factory functions for building message parts
// ---------------------------------------------------------------------------

function stepStart() {
  return { type: "step-start" };
}

function textPart(text: string) {
  return { type: "text", text, state: "done" };
}

function toolPart(
  toolName: string,
  input: Record<string, any>,
  overrides: Record<string, any> = {},
) {
  return {
    type: `tool-${toolName}`,
    toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
    state: "output-available",
    input,
    output: {},
    ...overrides,
  };
}

function userSelectPart(
  input: { message: string; options: any[] },
  output?: Record<string, any>,
) {
  return toolPart("userSelect", input, {
    ...(output ? { output } : {}),
  });
}

function assistantMsg(parts: any[], id?: string) {
  return {
    id: id ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: "assistant",
    parts,
  };
}

function userMsg(text: string) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

// ---------------------------------------------------------------------------
// Non-assistant messages — should be passed through untouched
// ---------------------------------------------------------------------------
describe("deduplicateAssistantParts", () => {
  describe("pass-through (no-op) cases", () => {
    test("returns empty array for empty input", () => {
      expect(deduplicateAssistantParts([])).toEqual([]);
    });

    test("passes through user messages untouched", () => {
      const msg = userMsg("hello");
      const msgs = [msg];
      const result = deduplicateAssistantParts(msgs);
      expect(result[0]).toBe(msg); // same element reference — not cloned
    });

    test("passes through assistant message with no parts array", () => {
      const msg = { id: "1", role: "assistant" };
      const result = deduplicateAssistantParts([msg]);
      expect(result[0]).toBe(msg);
    });

    test("passes through assistant message with empty parts", () => {
      const msg = assistantMsg([]);
      const result = deduplicateAssistantParts([msg]);
      expect(result[0]).toBe(msg);
    });

    test("passes through assistant message with no duplicates", () => {
      const msg = assistantMsg([
        stepStart(),
        toolPart("loadSkill", { name: "devops" }),
        stepStart(),
        textPart("Hello, how can I help?"),
      ]);
      const result = deduplicateAssistantParts([msg]);
      // nothing changed → same reference
      expect(result[0]).toBe(msg);
    });

    test("passes through messages of unknown roles", () => {
      const msg = { id: "1", role: "system", parts: [textPart("sys")] };
      const result = deduplicateAssistantParts([msg as any]);
      expect(result[0]).toBe(msg);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate tool parts
  // -------------------------------------------------------------------------
  describe("duplicate tool parts", () => {
    test("removes duplicate userSelect with identical input", () => {
      const selectInput = {
        message: "Pick a tenant",
        options: [
          { value: "mihoyo", label: "Mihoyo" },
          { value: "lml", label: "LML" },
        ],
      };

      const first = userSelectPart(selectInput, { selectedValue: "mihoyo" });
      const duplicate = userSelectPart(selectInput, {
        selectedValue: "mihoyo",
      });

      const msg = assistantMsg([
        stepStart(),
        first,
        stepStart(),
        textPart("OK, using Mihoyo"),
        stepStart(),
        duplicate, // should be removed
      ]);

      const result = deduplicateAssistantParts([msg]);
      const toolParts = result[0].parts.filter(
        (p: any) => p.type === "tool-userSelect",
      );
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0]).toBe(first);
    });

    test("keeps tool parts with different inputs (same tool name)", () => {
      const select1 = userSelectPart({
        message: "Pick env",
        options: [{ value: "pre", label: "Pre" }],
      });
      const select2 = userSelectPart({
        message: "Pick bucket",
        options: [{ value: "intranet", label: "Intranet" }],
      });

      const msg = assistantMsg([
        stepStart(),
        select1,
        stepStart(),
        select2,
      ]);

      const result = deduplicateAssistantParts([msg]);
      const toolParts = result[0].parts.filter(
        (p: any) => p.type === "tool-userSelect",
      );
      expect(toolParts).toHaveLength(2);
    });

    test("removes duplicate non-userSelect tool parts with same input", () => {
      const tool1 = toolPart("listAppClustersMihoyo", {});
      const tool2 = toolPart("listAppClustersMihoyo", {});

      const msg = assistantMsg([
        stepStart(),
        tool1,
        stepStart(),
        tool2, // duplicate
      ]);

      const result = deduplicateAssistantParts([msg]);
      const tools = result[0].parts.filter((p: any) =>
        p.type.startsWith("tool-"),
      );
      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(tool1);
    });

    test("keeps tool parts of different types even with same input shape", () => {
      const tool1 = toolPart("listAppClustersMihoyo", {});
      const tool2 = toolPart("listAppClustersLML", {});

      const msg = assistantMsg([
        stepStart(),
        tool1,
        stepStart(),
        tool2,
      ]);

      const result = deduplicateAssistantParts([msg]);
      const tools = result[0].parts.filter((p: any) =>
        p.type.startsWith("tool-"),
      );
      expect(tools).toHaveLength(2);
    });

    test("removes multiple duplicates of the same tool call", () => {
      const input = { message: "Choose", options: [{ value: "a" }] };
      const first = userSelectPart(input);
      const dup1 = userSelectPart(input);
      const dup2 = userSelectPart(input);

      const msg = assistantMsg([
        stepStart(),
        first,
        stepStart(),
        dup1,
        stepStart(),
        dup2,
      ]);

      const result = deduplicateAssistantParts([msg]);
      const selects = result[0].parts.filter(
        (p: any) => p.type === "tool-userSelect",
      );
      expect(selects).toHaveLength(1);
      expect(selects[0]).toBe(first);
    });

    test("handles tool part with undefined input (treated as {})", () => {
      const tool1 = toolPart("myTool", undefined as any);
      const tool2 = toolPart("myTool", undefined as any);

      const msg = assistantMsg([tool1, tool2]);

      const result = deduplicateAssistantParts([msg]);
      const tools = result[0].parts.filter((p: any) =>
        p.type.startsWith("tool-"),
      );
      expect(tools).toHaveLength(1);
    });

    test("handles tool part with null input (treated as {})", () => {
      const tool1 = { ...toolPart("myTool", {}), input: null };
      const tool2 = { ...toolPart("myTool", {}), input: null };

      const msg = assistantMsg([tool1, tool2]);

      const result = deduplicateAssistantParts([msg]);
      const tools = result[0].parts.filter((p: any) =>
        p.type.startsWith("tool-"),
      );
      expect(tools).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate text parts
  // -------------------------------------------------------------------------
  describe("duplicate text parts", () => {
    test("removes consecutive duplicate text parts", () => {
      const msg = assistantMsg([
        stepStart(),
        textPart("Please provide domain and public_path"),
        stepStart(),
        textPart("Please provide domain and public_path"), // duplicate
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(1);
      expect(texts[0].text).toBe("Please provide domain and public_path");
    });

    test("keeps non-consecutive identical text parts", () => {
      const msg = assistantMsg([
        textPart("Hello"),
        toolPart("someTool", { x: 1 }),
        textPart("Hello"), // same text but not consecutive (tool in between)
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(2);
    });

    test("keeps consecutive text parts with different content", () => {
      const msg = assistantMsg([
        textPart("First message"),
        textPart("Second message"),
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(2);
    });

    test("collapses three consecutive identical texts to one", () => {
      const msg = assistantMsg([
        textPart("Repeat"),
        textPart("Repeat"),
        textPart("Repeat"),
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(1);
    });

    test("handles empty text parts correctly", () => {
      const msg = assistantMsg([
        textPart(""),
        textPart(""),
        textPart("Non-empty"),
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(2); // one "" and one "Non-empty"
    });

    test("treats text parts separated by step-start as consecutive for dedup", () => {
      // step-start is just a boundary marker and should NOT reset the text
      // dedup tracker, so identical texts across step-starts are still deduped.
      const msg = assistantMsg([
        textPart("Same"),
        stepStart(),
        textPart("Same"), // should be removed — step-start doesn't break dedup
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Orphaned step-start markers
  // -------------------------------------------------------------------------
  describe("orphaned step-start removal", () => {
    test("removes trailing step-start at end of parts", () => {
      const msg = assistantMsg([
        stepStart(),
        textPart("Hello"),
        stepStart(), // trailing — orphaned
      ]);

      const result = deduplicateAssistantParts([msg]);
      const stepStarts = result[0].parts.filter(
        (p: any) => p.type === "step-start",
      );
      expect(stepStarts).toHaveLength(1);
    });

    test("removes consecutive step-starts (keeps only one before content)", () => {
      const msg = assistantMsg([
        stepStart(),
        stepStart(),
        stepStart(),
        textPart("Hello"),
      ]);

      const result = deduplicateAssistantParts([msg]);
      expect(result[0].parts).toHaveLength(2); // one step-start + text
      expect(result[0].parts[0].type).toBe("step-start");
      expect(result[0].parts[1].type).toBe("text");
    });

    test("removes step-start left orphaned after tool dedup", () => {
      const input = { message: "Pick", options: [{ value: "a" }] };
      const first = userSelectPart(input);
      const duplicate = userSelectPart(input);

      const msg = assistantMsg([
        stepStart(),
        first,
        stepStart(),     // this step-start precedes the duplicate
        duplicate,       // duplicate removed by pass 1
        // → step-start is now followed by nothing (end of array) → orphaned
      ]);

      const result = deduplicateAssistantParts([msg]);
      const stepStarts = result[0].parts.filter(
        (p: any) => p.type === "step-start",
      );
      expect(stepStarts).toHaveLength(1); // only the first one remains
    });

    test("preserves step-start that precedes real content", () => {
      const msg = assistantMsg([
        stepStart(),
        textPart("Content A"),
        stepStart(),
        toolPart("someTool", { key: "val" }),
      ]);

      const result = deduplicateAssistantParts([msg]);
      // no duplicates, no orphans → same reference
      expect(result[0]).toBe(msg);
    });
  });

  // -------------------------------------------------------------------------
  // Real-world scenario from the reported bug
  // -------------------------------------------------------------------------
  describe("real-world reproduction: userSelect duplication bug", () => {
    test("removes duplicate userSelect cards and text from multi-step conversation", () => {
      const tenantSelectInput = {
        message: "你要在哪个租户继续创建 test 发布分组并发布执行？",
        options: [
          { value: "mihoyo", label: "Mihoyo（已创建 testing 集群 cluster_id=8217）" },
          { value: "lml", label: "LML（需先创建 testing 集群）" },
        ],
      };

      const bucketSelectInput = {
        message: "该 test 发布分组的 bucket_tag 选哪个？",
        options: [
          { value: "intranet", label: "intranet（内网）" },
          { value: "external_network", label: "external_network（外网）" },
        ],
      };

      const responseText =
        "继续在 **Mihoyo** 做（testing 集群 `cluster_id=8217`），bucket_tag 选 **intranet**。\n\n请提供 domain 和 public_path。";

      const msg = assistantMsg([
        // --- earlier steps (unique, should be kept) ---
        stepStart(),
        toolPart("loadSkill", { name: "devops" }),
        stepStart(),
        toolPart("listAppClustersMihoyo", {}),
        toolPart("listAppClustersLML", {}),
        stepStart(),
        userSelectPart(
          {
            message: "未在 LML 租户下查到任何集群…",
            options: [
              { value: "mihoyo:pre", label: "Mihoyo 预发(pre)" },
              { value: "mihoyo:create_testing", label: "在 Mihoyo 创建测试集群(testing)" },
            ],
          },
          { selectedValue: "mihoyo:create_testing" },
        ),
        stepStart(),
        toolPart("executePlan", {
          intent: "创建 testing 集群",
          steps: [{ functionId: "createClusterMihoyo" }],
        }),
        stepStart(),
        userSelectPart(
          {
            message: "Mihoyo testing 集群已创建，下一步做什么？",
            options: [
              { value: "create_group", label: "创建一个 test 发布分组" },
              { value: "switch_env", label: "改为发布到 pre/prod" },
            ],
          },
          { selectedValue: "create_group" },
        ),

        // --- first occurrence (should be kept) ---
        stepStart(),
        textPart(responseText),
        stepStart(),
        userSelectPart(tenantSelectInput, { selectedValue: "mihoyo" }),
        stepStart(),
        userSelectPart(bucketSelectInput, { selectedValue: "intranet" }),
        stepStart(),
        textPart(responseText),

        // --- duplicates (should be removed) ---
        stepStart(),
        userSelectPart(tenantSelectInput, { selectedValue: "mihoyo" }),  // dup
        stepStart(),
        userSelectPart(bucketSelectInput, { selectedValue: "intranet" }), // dup
        stepStart(),
        textPart(responseText), // dup (consecutive after step-start reset)
      ]);

      const result = deduplicateAssistantParts([msg]);
      const parts = result[0].parts;

      // Count userSelect with tenant input
      const tenantSelects = parts.filter(
        (p: any) =>
          p.type === "tool-userSelect" &&
          p.input?.message === tenantSelectInput.message,
      );
      expect(tenantSelects).toHaveLength(1);

      // Count userSelect with bucket input
      const bucketSelects = parts.filter(
        (p: any) =>
          p.type === "tool-userSelect" &&
          p.input?.message === bucketSelectInput.message,
      );
      expect(bucketSelects).toHaveLength(1);

      // The responseText should appear twice:
      // Once after the create_group selection, and once after bucket selection.
      // The step-start between them resets the text dedup tracker.
      // But the third occurrence (the duplicate) should be removed only if
      // it's consecutive with the second. Since there's a step-start (other
      // type) between the second and third, the tracker resets and the third
      // would also be kept — BUT the step-start before it becomes orphaned
      // after the duplicate tool parts are removed.
      // Actually: pass 1 removes dup tools but keeps texts separated by
      // step-starts (since step-start resets tracker). The duplicate texts
      // are separated by step-starts + removed tool parts. After pass 1,
      // the sequence around the dup text is: step-start, text(response).
      // In pass 2, the step-start before it is valid (followed by text).
      // So the third text is kept. That's acceptable — the key fix is the
      // duplicate tool parts being removed.

      // Verify total tool-userSelect count (4 unique ones exist):
      // 1. env question ("未在 LML 租户下查到任何集群…")
      // 2. next-step question ("Mihoyo testing 集群已创建…")
      // 3. tenant question (tenantSelectInput)
      // 4. bucket question (bucketSelectInput)
      // The duplicate tenant + bucket calls should be removed.
      const allSelects = parts.filter(
        (p: any) => p.type === "tool-userSelect",
      );
      expect(allSelects).toHaveLength(4);

      // The duplicate responseText parts should be collapsed.
      // With step-start NOT resetting the text tracker, consecutive identical
      // texts across step-starts are deduped. The original first and second
      // text occurrences are separated by tool parts (which DO reset the
      // tracker), so both are kept. The third occurrence (after the removed
      // dup tools) follows the second via step-starts only, so it's deduped.
      const responseParts = parts.filter(
        (p: any) => p.type === "text" && p.text === responseText,
      );
      expect(responseParts).toHaveLength(2); // first + second kept, third deduped
    });
  });

  // -------------------------------------------------------------------------
  // Multiple messages
  // -------------------------------------------------------------------------
  describe("multiple messages in array", () => {
    test("deduplicates each assistant message independently", () => {
      const input1 = { message: "Q1", options: [{ value: "a" }] };
      const input2 = { message: "Q2", options: [{ value: "b" }] };

      const msg1 = assistantMsg([
        userSelectPart(input1),
        userSelectPart(input1), // dup within msg1
      ]);

      const msg2 = assistantMsg([
        userSelectPart(input2),
        userSelectPart(input2), // dup within msg2
      ]);

      const result = deduplicateAssistantParts([msg1, msg2]);

      expect(
        result[0].parts.filter((p: any) => p.type === "tool-userSelect"),
      ).toHaveLength(1);
      expect(
        result[1].parts.filter((p: any) => p.type === "tool-userSelect"),
      ).toHaveLength(1);
    });

    test("same tool input across different messages is NOT deduped", () => {
      const input = { message: "Q", options: [{ value: "a" }] };

      const msg1 = assistantMsg([userSelectPart(input)]);
      const msg2 = assistantMsg([userSelectPart(input)]);

      const result = deduplicateAssistantParts([msg1, msg2]);

      // Each message is processed independently — both keep their part
      expect(
        result[0].parts.filter((p: any) => p.type === "tool-userSelect"),
      ).toHaveLength(1);
      expect(
        result[1].parts.filter((p: any) => p.type === "tool-userSelect"),
      ).toHaveLength(1);
    });

    test("preserves user messages mixed with assistant messages", () => {
      const uMsg = userMsg("hello");
      const aMsg = assistantMsg([
        textPart("Reply"),
        textPart("Reply"), // dup
      ]);

      const result = deduplicateAssistantParts([uMsg, aMsg]);
      expect(result[0]).toBe(uMsg); // user message untouched
      expect(result[1].parts.filter((p: any) => p.type === "text")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    test("handles message with only step-start parts", () => {
      const msg = assistantMsg([stepStart(), stepStart(), stepStart()]);

      const result = deduplicateAssistantParts([msg]);
      expect(result[0].parts).toHaveLength(0);
    });

    test("handles message with single text part (no dedup needed)", () => {
      const msg = assistantMsg([textPart("Only one")]);

      const result = deduplicateAssistantParts([msg]);
      // nothing changed → same reference
      expect(result[0]).toBe(msg);
    });

    test("handles message with single tool part (no dedup needed)", () => {
      const msg = assistantMsg([toolPart("echo", { text: "hi" })]);

      const result = deduplicateAssistantParts([msg]);
      expect(result[0]).toBe(msg);
    });

    test("handles reasoning parts without interference", () => {
      const reasoning = { type: "reasoning", text: "Thinking..." };
      const msg = assistantMsg([
        reasoning,
        textPart("Result"),
        reasoning, // reasoning is "other" type — resets text dedup tracker
        textPart("Result"), // not consecutive with first (reasoning in between resets tracker)
      ]);

      const result = deduplicateAssistantParts([msg]);
      // reasoning resets lastTextContent, so second "Result" is kept
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(2);
      expect(result[0]).toBe(msg); // nothing changed
    });

    test("preserves other fields on the message object", () => {
      const msg = {
        id: "msg_123",
        role: "assistant" as const,
        parts: [textPart("Dup"), textPart("Dup")],
        createdAt: "2026-01-01",
        customField: 42,
      };

      const result = deduplicateAssistantParts([msg]);
      expect(result[0].id).toBe("msg_123");
      expect((result[0] as any).createdAt).toBe("2026-01-01");
      expect((result[0] as any).customField).toBe(42);
    });

    test("handles tool part with circular reference in input gracefully", () => {
      // JSON.stringify will throw on circular refs — fallback to String()
      const circularInput: any = { a: 1 };
      circularInput.self = circularInput;

      const tool1 = toolPart("myTool", circularInput);
      const tool2 = toolPart("myTool", circularInput);

      const msg = assistantMsg([tool1, tool2]);

      // Should not throw
      const result = deduplicateAssistantParts([msg]);
      // Both have the same String() representation of the circular object
      const tools = result[0].parts.filter((p: any) =>
        p.type.startsWith("tool-"),
      );
      expect(tools).toHaveLength(1);
    });

    test("tool parts with same tool name but different input are preserved", () => {
      const tool1 = toolPart("executePlan", {
        intent: "Create cluster",
        steps: [{ functionId: "createClusterMihoyo" }],
      });
      const tool2 = toolPart("executePlan", {
        intent: "Deploy group",
        steps: [{ functionId: "deployGroupMihoyo" }],
      });

      const msg = assistantMsg([
        stepStart(),
        tool1,
        stepStart(),
        tool2,
      ]);

      const result = deduplicateAssistantParts([msg]);
      // same reference — nothing changed
      expect(result[0]).toBe(msg);
    });

    test("text part with null text treated as empty string", () => {
      const msg = assistantMsg([
        { type: "text", text: null },
        { type: "text", text: null }, // consecutive duplicate (both → "")
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(1);
    });

    test("text part with undefined text treated as empty string", () => {
      const msg = assistantMsg([
        { type: "text" },
        { type: "text" }, // consecutive duplicate (both → "")
      ]);

      const result = deduplicateAssistantParts([msg]);
      const texts = result[0].parts.filter((p: any) => p.type === "text");
      expect(texts).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Reference identity — unchanged messages should keep same reference
  // -------------------------------------------------------------------------
  describe("reference identity optimization", () => {
    test("returns same message reference when no parts were removed", () => {
      const msg = assistantMsg([
        stepStart(),
        toolPart("loadSkill", { name: "devops" }),
        stepStart(),
        textPart("All good"),
      ]);

      const result = deduplicateAssistantParts([msg]);
      expect(result[0]).toBe(msg);
    });

    test("returns new message object when parts were pruned", () => {
      const msg = assistantMsg([textPart("A"), textPart("A")]);

      const result = deduplicateAssistantParts([msg]);
      expect(result[0]).not.toBe(msg);
      expect(result[0].id).toBe(msg.id);
      expect(result[0].role).toBe(msg.role);
    });
  });
});
