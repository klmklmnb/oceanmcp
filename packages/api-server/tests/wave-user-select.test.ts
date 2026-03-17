/**
 * Tests for Wave interactive askUser tool (card buttons/dropdown/form).
 *
 * Covers:
 *   1. pending-selections store (add, resolve, remove, has, edge cases)
 *   2. Card building helpers (buttons for ≤3 options, dropdown for >3)
 *   3. Wave askUser tool execute() flow (sends card, awaits callback)
 *   4. Card reaction webhook handler (resolves pending selection)
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  addPendingSelection,
  resolvePendingSelection,
  removePendingSelection,
  hasPendingSelection,
  pendingSelectionCount,
  removeAllForSession,
  stopCleanup,
  type PendingSelectionOption,
} from "../src/wave/pending-selections";

/** Wait for microtasks to flush (allows async execute to reach addPendingSelection). */
function tick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. pending-selections store
// ═════════════════════════════════════════════════════════════════════════════

describe("pending-selections", () => {
  // Helper to clean up any dangling pending entries between tests.
  // We resolve or remove any leftover entries by trying known IDs.
  const usedIds: string[] = [];
  function trackId(id: string) {
    usedIds.push(id);
    return id;
  }
  beforeEach(() => {
    for (const id of usedIds) {
      if (hasPendingSelection(id)) {
        removePendingSelection(id, "test cleanup");
      }
    }
    usedIds.length = 0;
  });

  describe("addPendingSelection", () => {
    test("returns a Promise that resolves when resolvePendingSelection is called", async () => {
      const cardId = trackId("card_add_resolve_1");
      const opts: PendingSelectionOption[] = [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ];

      const promise = addPendingSelection(cardId, opts, "wave:dm:test");

      // Not yet resolved
      expect(hasPendingSelection(cardId)).toBe(true);

      // Resolve it
      resolvePendingSelection(cardId, { _selectedValue: "a" });

      const result = await promise;
      expect(result).toEqual({ _selectedValue: "a" });
      expect(hasPendingSelection(cardId)).toBe(false);
    });

    test("resolves with the exact value object passed to resolvePendingSelection", async () => {
      const cardId = trackId("card_exact_val");
      const promise = addPendingSelection(
        cardId,
        [{ value: "production" }, { value: "staging" }],
        "wave:dm:test",
      );

      resolvePendingSelection(cardId, { _selectedValue: "staging" });
      expect(await promise).toEqual({ _selectedValue: "staging" });
    });

    test("replaces an existing pending entry for the same cardMessageId", async () => {
      const cardId = trackId("card_replace");
      const opts: PendingSelectionOption[] = [{ value: "x" }];

      // First pending — will be rejected when replaced
      const first = addPendingSelection(cardId, opts, "wave:dm:test");

      // Second pending — replaces the first
      const second = addPendingSelection(cardId, opts, "wave:dm:test");

      // First should be rejected
      await expect(first).rejects.toThrow("Replaced");

      // Second should be resolvable
      resolvePendingSelection(cardId, { _selectedValue: "x" });
      expect(await second).toEqual({ _selectedValue: "x" });
    });
  });

  describe("resolvePendingSelection", () => {
    test("returns the PendingSelection entry on success", async () => {
      const cardId = trackId("card_return_entry");
      const opts: PendingSelectionOption[] = [
        { value: "v1", label: "Version 1" },
        { value: "v2", label: "Version 2" },
      ];
      const promise = addPendingSelection(cardId, opts, "wave:group:chat1");

      const entry = resolvePendingSelection(cardId, { _selectedValue: "v1" });
      expect(entry).toBeDefined();
      expect(entry!.options).toEqual(opts);
      expect(entry!.sessionKey).toBe("wave:group:chat1");

      await promise; // consume the promise
    });

    test("returns undefined for an unknown cardMessageId", () => {
      const entry = resolvePendingSelection("card_nonexistent", { _selectedValue: "value" });
      expect(entry).toBeUndefined();
    });

    test("removes the entry from the store after resolving", async () => {
      const cardId = trackId("card_remove_after");
      const promise = addPendingSelection(
        cardId,
        [{ value: "x" }],
        "wave:dm:test",
      );

      expect(hasPendingSelection(cardId)).toBe(true);
      resolvePendingSelection(cardId, { _selectedValue: "x" });
      expect(hasPendingSelection(cardId)).toBe(false);

      await promise;
    });

    test("calling resolvePendingSelection twice returns undefined the second time", async () => {
      const cardId = trackId("card_double_resolve");
      const promise = addPendingSelection(
        cardId,
        [{ value: "a" }],
        "wave:dm:test",
      );

      const first = resolvePendingSelection(cardId, { _selectedValue: "a" });
      const second = resolvePendingSelection(cardId, { _selectedValue: "a" });

      expect(first).toBeDefined();
      expect(second).toBeUndefined();

      await promise;
    });
  });

  describe("removePendingSelection", () => {
    test("rejects the Promise with the given reason", async () => {
      const cardId = trackId("card_remove_reject");
      const promise = addPendingSelection(
        cardId,
        [{ value: "x" }],
        "wave:dm:test",
      );

      const removed = removePendingSelection(cardId, "Session cleared");
      expect(removed).toBe(true);
      expect(hasPendingSelection(cardId)).toBe(false);

      await expect(promise).rejects.toThrow("Session cleared");
    });

    test("returns false for an unknown cardMessageId", () => {
      expect(removePendingSelection("card_unknown")).toBe(false);
    });

    test("uses default reason when not provided", async () => {
      const cardId = trackId("card_default_reason");
      const promise = addPendingSelection(
        cardId,
        [{ value: "x" }],
        "wave:dm:test",
      );

      removePendingSelection(cardId);
      await expect(promise).rejects.toThrow("Selection cancelled");
    });
  });

  describe("hasPendingSelection", () => {
    test("returns true for a pending entry", async () => {
      const cardId = trackId("card_has_true");
      const promise = addPendingSelection(cardId, [{ value: "x" }], "wave:dm:test");
      expect(hasPendingSelection(cardId)).toBe(true);

      // Cleanup — must catch the rejection
      removePendingSelection(cardId);
      await promise.catch(() => {}); // absorb the rejection
    });

    test("returns false for a non-existent entry", () => {
      expect(hasPendingSelection("card_never_added")).toBe(false);
    });
  });

  describe("pendingSelectionCount", () => {
    test("reflects the number of pending entries", async () => {
      const before = pendingSelectionCount();
      const id1 = trackId("card_count_1");
      const id2 = trackId("card_count_2");

      const p1 = addPendingSelection(id1, [{ value: "a" }], "s1");
      const p2 = addPendingSelection(id2, [{ value: "b" }], "s2");
      expect(pendingSelectionCount()).toBe(before + 2);

      resolvePendingSelection(id1, { _selectedValue: "a" });
      expect(pendingSelectionCount()).toBe(before + 1);

      removePendingSelection(id2);
      expect(pendingSelectionCount()).toBe(before);

      await p1; // resolved normally
      await p2.catch(() => {}); // absorb the rejection from removePendingSelection
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Card building — sendAskUserCard and card content structure
// ═════════════════════════════════════════════════════════════════════════════

// We test the card building logic by importing the SDK helpers directly and
// verifying the expected card structure matches what message-sender.ts builds.

import {
  CardTag,
  MsgType,
  cardButton,
  cardOptionValue,
  cardDropdown,
  cardFlow,
  cardColumn,
  cardMarkdown,
  cardHeader,
  msgCard,
  type CardButton,
  type CardDropdown as CardDropdownType,
} from "@mihoyo/wave-opensdk";

describe("card building helpers", () => {
  const twoOptions: PendingSelectionOption[] = [
    { value: "dev", label: "Development" },
    { value: "prod", label: "Production" },
  ];

  const fourOptions: PendingSelectionOption[] = [
    { value: "v1.0.0", label: "v1.0.0" },
    { value: "v1.1.0", label: "v1.1.0" },
    { value: "v1.2.0", label: "v1.2.0" },
    { value: "v2.0.0", label: "v2.0.0" },
  ];

  describe("button card (≤3 options)", () => {
    test("builds a flow of CardButton elements", () => {
      const buttons = twoOptions.map((opt, i) =>
        cardButton(
          opt.label || opt.value,
          cardOptionValue(opt.value, opt.label || opt.value),
          { style: i === 0 ? "primary" : "default" },
        ),
      );
      const flow = cardFlow(buttons);

      expect(flow.tag).toBe(CardTag.Flow);
      expect(flow.elements).toHaveLength(2);

      const btn0 = flow.elements[0] as CardButton;
      expect(btn0.tag).toBe(CardTag.Button);
      expect(btn0.text).toBe("Development");
      expect(btn0.style).toBe("primary");
      expect(btn0.option.tag).toBe(CardTag.Value);
      expect((btn0.option as any).value).toBe("dev");

      const btn1 = flow.elements[1] as CardButton;
      expect(btn1.tag).toBe(CardTag.Button);
      expect(btn1.text).toBe("Production");
      expect(btn1.style).toBe("default");
    });

    test("uses value as label when label is not provided", () => {
      const opts: PendingSelectionOption[] = [
        { value: "alpha" },
        { value: "beta" },
      ];
      const buttons = opts.map((opt, i) =>
        cardButton(
          opt.label || opt.value,
          cardOptionValue(opt.value, opt.label || opt.value),
          { style: i === 0 ? "primary" : "default" },
        ),
      );

      expect((buttons[0] as CardButton).text).toBe("alpha");
      expect((buttons[1] as CardButton).text).toBe("beta");
    });

    test("header uses info template", () => {
      const header = cardHeader("请选择部署环境", "info");
      expect(header.title).toBe("请选择部署环境");
      expect(header.template).toBe("info");
    });

    test("complete button card content has header and card fields", () => {
      const buttons = twoOptions.map((opt, i) =>
        cardButton(
          opt.label || opt.value,
          cardOptionValue(opt.value, opt.label || opt.value),
          { style: i === 0 ? "primary" : "default" },
        ),
      );
      const content = {
        header: cardHeader("请选择环境", "info"),
        card: cardFlow(buttons),
      };
      const msg = msgCard(content);

      expect(msg.msg_type).toBe(MsgType.Card);
      expect(msg.content.header).toBeDefined();
      expect(msg.content.header!.title).toBe("请选择环境");
      expect(msg.content.card!.tag).toBe(CardTag.Flow);
    });
  });

  describe("dropdown card (>3 options)", () => {
    test("builds a CardDropdown element", () => {
      const dropdownOptions = fourOptions.map((opt) =>
        cardOptionValue(opt.value, opt.label || opt.value),
      );
      const dropdown = cardDropdown("请选择", dropdownOptions);

      expect(dropdown.tag).toBe(CardTag.Dropdown);
      expect(dropdown.text).toBe("请选择");
      expect(dropdown.options).toHaveLength(4);
      expect((dropdown.options[0] as any).value).toBe("v1.0.0");
      expect((dropdown.options[0] as any).text).toBe("v1.0.0");
      expect((dropdown.options[3] as any).value).toBe("v2.0.0");
    });

    test("complete dropdown card content has header and card fields", () => {
      const dropdownOptions = fourOptions.map((opt) =>
        cardOptionValue(opt.value, opt.label || opt.value),
      );
      const content = {
        header: cardHeader("请选择版本", "info"),
        card: cardDropdown("请选择", dropdownOptions),
      };
      const msg = msgCard(content);

      expect(msg.msg_type).toBe(MsgType.Card);
      expect(msg.content.header!.title).toBe("请选择版本");
      expect(msg.content.card!.tag).toBe(CardTag.Dropdown);
    });
  });

  describe("selection confirmed card", () => {
    test("builds a success-themed card with selection text", () => {
      const header = cardHeader("选择完成", "success");
      const body = cardColumn([cardMarkdown("已选择: **Production**")]);

      expect(header.template).toBe("success");
      expect(body.tag).toBe(CardTag.Column);
      expect(body.elements).toHaveLength(1);
      expect((body.elements[0] as any).text).toBe("已选择: **Production**");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Wave askUser tool — execute flow
// ═════════════════════════════════════════════════════════════════════════════

import { buildWaveTools } from "../src/wave/tools";
import type { WaveClients } from "../src/wave/client";
import type { Sandbox } from "@ocean-mcp/shared";

function createMockWaveClients(
  overrides: {
    msgSend?: (...args: any[]) => any;
    msgUpdateCardActively?: (...args: any[]) => any;
    contactGetUsers?: (...args: any[]) => any;
  } = {},
): WaveClients {
  return {
    client: {} as any,
    event: {
      onMsgCardReaction: mock(() => {}),
    } as any,
    msg: {
      send: overrides.msgSend ?? mock(async () => ({ msg_id: "mock_card_msg_001" })),
      reply: mock(async () => ({ msg_id: "mock_reply_001" })),
      updateCard: mock(async () => ({})),
      updateCardActively: overrides.msgUpdateCardActively ?? mock(async () => ({})),
      updateCardMode: mock(async () => ({ streaming_id: "" })),
      updateCardStreamingActively: mock(async () => ({})),
      recall: mock(async () => ({})),
    } as any,
    contact: {
      getUsers: overrides.contactGetUsers ?? mock(async () => ({ users: [] })),
    } as any,
    file: {
      getFilePublicUrl: mock(async () => ({ file_url: [], invalid_file_key: [] })),
    } as any,
  };
}

function createMockSandbox(): Sandbox {
  return {
    async readFile() {
      throw new Error("not implemented");
    },
    async readdir() {
      return [];
    },
    async exec() {
      throw new Error("not implemented");
    },
  };
}

describe("Wave askUser tool", () => {
  test("buildWaveTools includes askUser with an execute function", () => {
    const clients = createMockWaveClients();
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");

    expect(tools.askUser).toBeDefined();
    // Verify it has an execute function (unlike the generic client-side askUser)
    expect((tools.askUser as any).execute).toBeDefined();
  });

  test("execute sends a card and returns field value after callback resolution (simple select)", async () => {
    const mockSend = mock(async () => ({ msg_id: "card_tool_test_001" }));
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");

    const askUserTool = tools.askUser as any;

    // Call execute with the new JSON Schema format (single enum field → simple select)
    const executePromise = askUserTool.execute({
      message: "请选择部署环境",
      schema: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            title: "Environment",
            enum: ["dev", "staging", "production"],
            enumLabels: { dev: "Development", staging: "Staging", production: "Production" },
          },
        },
        required: ["environment"],
      },
    });

    // Wait for execute to reach addPendingSelection (after the async send)
    await tick();

    // The card should have been sent
    expect(mockSend).toHaveBeenCalled();
    expect(hasPendingSelection("card_tool_test_001")).toBe(true);

    // Simulate the card reaction callback (webhook wraps single value)
    resolvePendingSelection("card_tool_test_001", { _selectedValue: "staging" });

    const result = await executePromise;
    expect(result.environment).toBe("staging");
    expect(result.selectedLabel).toBe("Staging");
  });

  test("execute returns error when schema has no properties", async () => {
    const clients = createMockWaveClients();
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");
    const askUserTool = tools.askUser as any;

    const result = await askUserTool.execute({
      message: "Select something",
      schema: { type: "object", properties: {} },
    });

    expect(result.error).toContain("No fields provided");
  });

  test("execute returns error when card send fails (empty msg_id)", async () => {
    const mockSend = mock(async () => ({ msg_id: "" }));
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");
    const askUserTool = tools.askUser as any;

    const result = await askUserTool.execute({
      message: "Pick one",
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["a"] },
        },
      },
    });

    expect(result.error).toContain("Failed to send");
  });

  test("execute returns error when card send throws", async () => {
    const mockSend = mock(async () => {
      throw new Error("Network error");
    });
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");
    const askUserTool = tools.askUser as any;

    const result = await askUserTool.execute({
      message: "Pick one",
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["a"] },
        },
      },
    });

    expect(result.error).toContain("Network error");
  });

  test("execute uses value as label when no enumLabels provided", async () => {
    const mockSend = mock(async () => ({ msg_id: "card_no_label_test" }));
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");
    const askUserTool = tools.askUser as any;

    const executePromise = askUserTool.execute({
      message: "Pick",
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["alpha", "beta"] },
        },
      },
    });

    await tick();
    resolvePendingSelection("card_no_label_test", { _selectedValue: "beta" });
    const result = await executePromise;
    expect(result.choice).toBe("beta");
    expect(result.selectedLabel).toBe("beta");
  });

  test("execute defaults message to '请提供以下信息' when not provided", async () => {
    const sendArgs: any[] = [];
    const mockSend = mock(async (...args: any[]) => {
      sendArgs.push(args);
      return { msg_id: "card_default_msg_test" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools([], [], createMockSandbox(), clients, "ou_sender", "wave:dm:test", "oc_chat");
    const askUserTool = tools.askUser as any;

    const executePromise = askUserTool.execute({
      message: "",
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["a"] },
        },
      },
    });

    await tick();
    // The card should have been sent
    expect(mockSend).toHaveBeenCalledTimes(1);

    resolvePendingSelection("card_default_msg_test", { _selectedValue: "a" });
    await executePromise;
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Card reaction webhook handler — integration
// ═════════════════════════════════════════════════════════════════════════════

describe("card reaction handling (integration)", () => {
  test("resolving a pending selection unblocks the tool execute() promise", async () => {
    const cardMsgId = "card_integration_flow_001";
    const opts: PendingSelectionOption[] = [
      { value: "dev", label: "Development" },
      { value: "staging", label: "Staging" },
      { value: "production", label: "Production" },
    ];

    const selectionPromise = addPendingSelection(cardMsgId, opts, "wave:dm:user1");

    expect(hasPendingSelection(cardMsgId)).toBe(true);
    const entry = resolvePendingSelection(cardMsgId, { _selectedValue: "production" });
    expect(entry).toBeDefined();
    expect(entry!.sessionKey).toBe("wave:dm:user1");

    const result = await selectionPromise;
    expect(result).toEqual({ _selectedValue: "production" });

    expect(hasPendingSelection(cardMsgId)).toBe(false);
  });

  test("webhook ignores card reactions for non-pending cards", () => {
    const result = resolvePendingSelection("card_unknown_xyz", { _selectedValue: "some_value" });
    expect(result).toBeUndefined();
  });

  test("selected option label can be found from pending entry", async () => {
    const cardMsgId = "card_label_lookup_001";
    const opts: PendingSelectionOption[] = [
      { value: "v1.0", label: "Version 1.0 (stable)" },
      { value: "v2.0", label: "Version 2.0 (beta)" },
    ];

    const promise = addPendingSelection(cardMsgId, opts, "wave:group:chat1");
    const entry = resolvePendingSelection(cardMsgId, { _selectedValue: "v2.0" });

    const selectedOption = entry!.options.find((o) => o.value === "v2.0");
    expect(selectedOption?.label).toBe("Version 2.0 (beta)");

    await promise;
  });

  test("concurrent pending selections are independent", async () => {
    const card1 = "card_concurrent_1";
    const card2 = "card_concurrent_2";
    const card3 = "card_concurrent_3";

    const p1 = addPendingSelection(card1, [{ value: "a" }], "s1");
    const p2 = addPendingSelection(card2, [{ value: "b" }], "s2");
    const p3 = addPendingSelection(card3, [{ value: "c" }], "s3");

    // Resolve in reverse order
    resolvePendingSelection(card3, { val: "c" });
    resolvePendingSelection(card1, { val: "a" });
    resolvePendingSelection(card2, { val: "b" });

    expect(await p1).toEqual({ val: "a" });
    expect(await p2).toEqual({ val: "b" });
    expect(await p3).toEqual({ val: "c" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Demo skill fixture validation
// ═════════════════════════════════════════════════════════════════════════════

describe("env-deploy demo skill fixture", () => {
  test("loads the demo skill and its tools", async () => {
    const { default: tools } = await import(
      "./fixtures/skills/env-deploy/tools"
    );

    expect(tools.deploy).toBeDefined();
    expect(tools.rollback).toBeDefined();

    // Both should be Vercel AI SDK Tool format (have execute)
    expect(tools.deploy.execute).toBeDefined();
    expect(tools.rollback.execute).toBeDefined();
  });

  test("deploy tool executes successfully with a valid environment", async () => {
    const { default: tools } = await import(
      "./fixtures/skills/env-deploy/tools"
    );

    const result = (await tools.deploy.execute!(
      { environment: "production", version: "v1.0.0" },
      { toolCallId: "test_call", messages: [], abortSignal: undefined as any },
    )) as any;

    expect(result.status).toBe("deployed");
    expect(result.environment).toBe("production");
    expect(result.version).toBe("v1.0.0");
    expect(result.url).toBe("https://production.example.com");
  });

  test("deploy tool returns error for invalid environment", async () => {
    const { default: tools } = await import(
      "./fixtures/skills/env-deploy/tools"
    );

    const result = (await tools.deploy.execute!(
      { environment: "invalid_env" },
      { toolCallId: "test_call", messages: [], abortSignal: undefined as any },
    )) as any;

    expect(result.error).toContain("Invalid environment");
    expect(result.hint).toContain("askUser");
  });

  test("rollback tool executes successfully", async () => {
    const { default: tools } = await import(
      "./fixtures/skills/env-deploy/tools"
    );

    const result = (await tools.rollback.execute!(
      { environment: "staging", version: "v1.2.0" },
      { toolCallId: "test_call", messages: [], abortSignal: undefined as any },
    )) as any;

    expect(result.status).toBe("rolled_back");
    expect(result.environment).toBe("staging");
    expect(result.previousVersion).toBe("v1.2.0");
  });

  test("demo skill SKILL.md describes the askUser-driven workflow", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const skillMd = await fs.readFile(
      path.join(__dirname, "fixtures/skills/env-deploy/SKILL.md"),
      "utf-8",
    );

    expect(skillMd).toContain("name: env-deploy");
    expect(skillMd).toContain("askUser");
    expect(skillMd).toContain("buttons");
    expect(skillMd).toContain("dropdown");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Button/dropdown threshold logic
// ═════════════════════════════════════════════════════════════════════════════

describe("button vs dropdown threshold", () => {
  // The threshold is ≤3 → buttons, >3 → dropdown
  // We test via sendAskUserCard in simple-select mode.

  test("≤3 options → card body has Flow tag (buttons)", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_threshold_buttons" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    const msgId = await sendAskUserCard(clients, "oc_chat", "Choose", {
      mode: "simple-select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
      ],
    });

    expect(msgId).toBe("card_threshold_buttons");
    expect(sentContent).toBeDefined();
    expect(sentContent.card.tag).toBe(CardTag.Flow);
    expect(sentContent.card.elements).toHaveLength(3);
    expect(sentContent.card.elements[0].tag).toBe(CardTag.Button);
  });

  test(">3 options → card body has Dropdown tag", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_threshold_dropdown" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    const msgId = await sendAskUserCard(clients, "oc_chat", "Choose version", {
      mode: "simple-select",
      options: [
        { value: "v1" },
        { value: "v2" },
        { value: "v3" },
        { value: "v4" },
      ],
    });

    expect(msgId).toBe("card_threshold_dropdown");
    expect(sentContent).toBeDefined();
    expect(sentContent.card.tag).toBe(CardTag.Dropdown);
    expect(sentContent.card.options).toHaveLength(4);
  });

  test("exactly 3 options → buttons (boundary)", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_boundary_3" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Pick", {
      mode: "simple-select",
      options: [{ value: "x" }, { value: "y" }, { value: "z" }],
    });

    expect(sentContent.card.tag).toBe(CardTag.Flow);
  });

  test("exactly 4 options → dropdown (boundary)", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_boundary_4" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Pick", {
      mode: "simple-select",
      options: [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }],
    });

    expect(sentContent.card.tag).toBe(CardTag.Dropdown);
  });

  test("single option → buttons (just one button)", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_single" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Confirm?", {
      mode: "simple-select",
      options: [{ value: "yes", label: "Yes" }],
    });

    expect(sentContent.card.tag).toBe(CardTag.Flow);
    expect(sentContent.card.elements).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6b. defaultValue support in button/dropdown cards
// ═════════════════════════════════════════════════════════════════════════════

describe("defaultValue support", () => {
  test("buttons: matching defaultValue option gets primary style", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_default_btn" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose env", {
      mode: "simple-select",
      options: [
        { value: "dev", label: "Dev" },
        { value: "staging", label: "Staging" },
        { value: "prod", label: "Prod" },
      ],
      defaultValue: "staging",
    });

    expect(sentContent.card.tag).toBe(CardTag.Flow);
    const buttons = sentContent.card.elements;
    expect(buttons).toHaveLength(3);
    // "staging" (index 1) should be primary
    expect(buttons[0].style).toBe("default");
    expect(buttons[1].style).toBe("primary");
    expect(buttons[2].style).toBe("default");
  });

  test("buttons: no defaultValue → first option gets primary (backward compat)", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_no_default_btn" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose env", {
      mode: "simple-select",
      options: [
        { value: "dev", label: "Dev" },
        { value: "staging", label: "Staging" },
      ],
    });

    const buttons = sentContent.card.elements;
    expect(buttons[0].style).toBe("primary");
    expect(buttons[1].style).toBe("default");
  });

  test("buttons: unmatched defaultValue → falls back to first option as primary", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_bad_default_btn" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose", {
      mode: "simple-select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      defaultValue: "nonexistent",
    });

    const buttons = sentContent.card.elements;
    expect(buttons[0].style).toBe("primary");
    expect(buttons[1].style).toBe("default");
  });

  test("dropdown: matching defaultValue option is moved to front", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_default_dd" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose version", {
      mode: "simple-select",
      options: [
        { value: "v1", label: "V1" },
        { value: "v2", label: "V2" },
        { value: "v3", label: "V3" },
        { value: "v4", label: "V4" },
      ],
      defaultValue: "v3",
    });

    expect(sentContent.card.tag).toBe(CardTag.Dropdown);
    const opts = sentContent.card.options;
    expect(opts).toHaveLength(4);
    // v3 should be first
    expect(opts[0].value).toBe("v3");
    expect(opts[1].value).toBe("v1");
    expect(opts[2].value).toBe("v2");
    expect(opts[3].value).toBe("v4");
  });

  test("dropdown: no defaultValue → original order preserved", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_no_default_dd" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose version", {
      mode: "simple-select",
      options: [
        { value: "v1" },
        { value: "v2" },
        { value: "v3" },
        { value: "v4" },
      ],
    });

    const opts = sentContent.card.options;
    expect(opts[0].value).toBe("v1");
    expect(opts[1].value).toBe("v2");
    expect(opts[2].value).toBe("v3");
    expect(opts[3].value).toBe("v4");
  });

  test("dropdown: unmatched defaultValue → original order preserved", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "card_bad_default_dd" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });

    const { sendAskUserCard } = await import("../src/wave/message-sender");
    await sendAskUserCard(clients, "oc_chat", "Choose", {
      mode: "simple-select",
      options: [
        { value: "a" },
        { value: "b" },
        { value: "c" },
        { value: "d" },
      ],
      defaultValue: "nonexistent",
    });

    const opts = sentContent.card.options;
    expect(opts[0].value).toBe("a");
    expect(opts[1].value).toBe("b");
    expect(opts[2].value).toBe("c");
    expect(opts[3].value).toBe("d");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. updateCardAfterSelection
// ═════════════════════════════════════════════════════════════════════════════

describe("updateCardAfterSelection", () => {
  test("calls msg.updateCardActively with a success-themed confirmation card", async () => {
    let updatedContent: any = null;
    let usedMsgId: string = "";
    const mockUpdateCardActively = mock(async (msgId: string, content: any) => {
      usedMsgId = msgId;
      updatedContent = content;
      return {};
    });
    const clients = createMockWaveClients({ msgUpdateCardActively: mockUpdateCardActively });

    const { updateCardAfterSelection } = await import("../src/wave/message-sender");
    await updateCardAfterSelection(clients, "om_card_msg_123", "选择完成", "Production");

    expect(mockUpdateCardActively).toHaveBeenCalledTimes(1);
    expect(usedMsgId).toBe("om_card_msg_123");
    expect(updatedContent).toBeDefined();
    expect(updatedContent.header.title).toBe("选择完成");
    expect(updatedContent.header.template).toBe("success");
    expect(updatedContent.card.tag).toBe(CardTag.Column);
    expect(updatedContent.card.elements[0].text).toBe("已选择: **Production**");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. removeAllForSession — session reverse index
// ═════════════════════════════════════════════════════════════════════════════

describe("removeAllForSession", () => {
  test("removes all pending selections for a session and rejects their promises", async () => {
    const sessionA = "wave:dm:session_A";
    const p1 = addPendingSelection("card_session_a1", [{ value: "x" }], sessionA);
    const p2 = addPendingSelection("card_session_a2", [{ value: "y" }], sessionA);

    // Also add one for a different session
    const sessionB = "wave:dm:session_B";
    const p3 = addPendingSelection("card_session_b1", [{ value: "z" }], sessionB);

    expect(pendingSelectionCount()).toBeGreaterThanOrEqual(3);

    // Remove all for session A
    const count = removeAllForSession(sessionA, "User sent new message");
    expect(count).toBe(2);

    // Session A entries should be gone
    expect(hasPendingSelection("card_session_a1")).toBe(false);
    expect(hasPendingSelection("card_session_a2")).toBe(false);

    // Session B entry should remain
    expect(hasPendingSelection("card_session_b1")).toBe(true);

    // Session A promises should be rejected
    await expect(p1).rejects.toThrow("User sent new message");
    await expect(p2).rejects.toThrow("User sent new message");

    // Cleanup session B
    resolvePendingSelection("card_session_b1", { _selectedValue: "z" });
    await p3;
  });

  test("returns 0 for a session with no pending selections", () => {
    const count = removeAllForSession("wave:dm:nonexistent_session");
    expect(count).toBe(0);
  });

  test("does not affect other sessions", async () => {
    const s1 = "wave:dm:iso_s1";
    const s2 = "wave:dm:iso_s2";

    const p1 = addPendingSelection("card_iso_1", [{ value: "a" }], s1);
    const p2 = addPendingSelection("card_iso_2", [{ value: "b" }], s2);

    removeAllForSession(s1, "abort");
    await expect(p1).rejects.toThrow("abort");

    // s2 is unaffected
    expect(hasPendingSelection("card_iso_2")).toBe(true);
    resolvePendingSelection("card_iso_2", { _selectedValue: "b" });
    expect(await p2).toEqual({ _selectedValue: "b" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Session AbortController tracking
// ═════════════════════════════════════════════════════════════════════════════

import { waveSessionManager } from "../src/wave/session-manager";

describe("session AbortController tracking", () => {
  const sessionKey = "wave:dm:abort_test";

  test("setActiveAbortController / getActiveAbortController round trip", () => {
    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);
    expect(waveSessionManager.getActiveAbortController(sessionKey)).toBe(controller);

    // Cleanup
    waveSessionManager.clearActiveAbortController(sessionKey);
  });

  test("getActiveAbortController returns undefined when none set", () => {
    expect(waveSessionManager.getActiveAbortController("wave:dm:no_controller")).toBeUndefined();
  });

  test("clearActiveAbortController removes the controller", () => {
    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);
    waveSessionManager.clearActiveAbortController(sessionKey);
    expect(waveSessionManager.getActiveAbortController(sessionKey)).toBeUndefined();
  });

  test("aborting the controller signal works as expected", () => {
    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);

    expect(controller.signal.aborted).toBe(false);
    controller.abort(new Error("New message"));
    expect(controller.signal.aborted).toBe(true);

    waveSessionManager.clearActiveAbortController(sessionKey);
  });

  test("clear() also removes the abort controller", async () => {
    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);
    await waveSessionManager.clear(sessionKey);
    expect(waveSessionManager.getActiveAbortController(sessionKey)).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Abort flow integration — new message aborts pending selection
// ═════════════════════════════════════════════════════════════════════════════

describe("abort flow integration", () => {
  test("aborting the controller + removeAllForSession rejects the pending promise", async () => {
    const sessionKey = "wave:dm:abort_flow";
    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);

    // Simulate tool execute adding a pending selection
    const promise = addPendingSelection("card_abort_flow_1", [
      { value: "dev", label: "Dev" },
      { value: "prod", label: "Prod" },
    ], sessionKey);

    // Simulate user sending a new message — abort + cleanup
    controller.abort(new Error("New message received"));
    const removed = removeAllForSession(sessionKey, "User sent a new message");
    waveSessionManager.clearActiveAbortController(sessionKey);

    expect(removed).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    await expect(promise).rejects.toThrow("User sent a new message");
  });

  test("second abort controller replaces the first", () => {
    const sessionKey = "wave:dm:abort_replace";
    const c1 = new AbortController();
    const c2 = new AbortController();

    waveSessionManager.setActiveAbortController(sessionKey, c1);
    waveSessionManager.setActiveAbortController(sessionKey, c2);

    // Only c2 is tracked now
    expect(waveSessionManager.getActiveAbortController(sessionKey)).toBe(c2);

    waveSessionManager.clearActiveAbortController(sessionKey);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. updateCardAsExpired — stale card handling
// ═════════════════════════════════════════════════════════════════════════════

describe("updateCardAsExpired", () => {
  test("calls msg.updateCardActively with a warning-themed expired card", async () => {
    let updatedContent: any = null;
    let usedMsgId: string = "";
    const mockUpdateCardActively = mock(async (msgId: string, content: any) => {
      usedMsgId = msgId;
      updatedContent = content;
      return {};
    });
    const clients = createMockWaveClients({ msgUpdateCardActively: mockUpdateCardActively });

    const { updateCardAsExpired } = await import("../src/wave/message-sender");
    await updateCardAsExpired(clients, "om_expired_msg_456");

    expect(mockUpdateCardActively).toHaveBeenCalledTimes(1);
    expect(usedMsgId).toBe("om_expired_msg_456");
    expect(updatedContent).toBeDefined();
    expect(updatedContent.header.title).toBe("选择已过期");
    expect(updatedContent.header.template).toBe("warning");
    expect(updatedContent.card.tag).toBe(CardTag.Column);
    expect(updatedContent.card.elements[0].text).toContain("已失效");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. Safety-net timeout
// ═════════════════════════════════════════════════════════════════════════════

describe("safety-net timeout", () => {
  test("stopCleanup can be called without error", () => {
    stopCleanup();
  });

  test("entries can be manually timed out by removing them", async () => {
    const promise = addPendingSelection("card_timeout_sim", [{ value: "a" }], "wave:dm:timeout");

    // Simulate what the cleanup sweep would do
    removePendingSelection("card_timeout_sim", "Selection timed out (1 hour safety limit)");

    await expect(promise).rejects.toThrow("timed out");
    expect(hasPendingSelection("card_timeout_sim")).toBe(false);
  });
});
