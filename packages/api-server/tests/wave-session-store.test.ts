/**
 * Tests for the Wave session store abstraction and message history builder.
 *
 * Covers:
 *   1. InMemorySessionStore — CRUD, TTL cleanup, metadata
 *   2. buildAssistantStoredMessage — step-to-StoredMessage conversion
 *   3. buildUserStoredMessage — simple user message builder
 *   4. SessionManager — delegation to store, async API
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  InMemorySessionStore,
  type StoredMessage,
} from "../src/wave/session-store";

import {
  buildAssistantStoredMessage,
  buildUserStoredMessage,
} from "../src/wave/message-history";

import { waveSessionManager } from "../src/wave/session-manager";

// =========================================================================
// 1. InMemorySessionStore
// =========================================================================

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  afterEach(async () => {
    await store.destroy();
  });

  describe("getOrCreate", () => {
    test("creates a new session with empty messages", async () => {
      const session = await store.getOrCreate("wave:dm:user1");
      expect(session.sessionKey).toBe("wave:dm:user1");
      expect(session.messages).toEqual([]);
      expect(session.lastActivity).toBeGreaterThan(0);
      expect(session.metadata).toEqual({});
    });

    test("returns existing session on second call", async () => {
      const s1 = await store.getOrCreate("wave:dm:user1");
      s1.messages.push({ role: "user", parts: [{ type: "text", text: "hi" }] });
      const s2 = await store.getOrCreate("wave:dm:user1");
      expect(s2.messages).toHaveLength(1);
    });

    test("updates lastActivity on access", async () => {
      const s1 = await store.getOrCreate("wave:dm:user1");
      const t1 = s1.lastActivity;
      await new Promise((r) => setTimeout(r, 5));
      const s2 = await store.getOrCreate("wave:dm:user1");
      expect(s2.lastActivity).toBeGreaterThanOrEqual(t1);
    });
  });

  describe("get", () => {
    test("returns null for non-existent session", async () => {
      const result = await store.get("wave:dm:nobody");
      expect(result).toBeNull();
    });

    test("returns existing session", async () => {
      await store.getOrCreate("wave:dm:user1");
      const result = await store.get("wave:dm:user1");
      expect(result).not.toBeNull();
      expect(result!.sessionKey).toBe("wave:dm:user1");
    });
  });

  describe("appendMessages", () => {
    test("appends messages to session", async () => {
      await store.getOrCreate("s1");
      const msg: StoredMessage = {
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      };
      await store.appendMessages("s1", [msg]);
      const messages = await store.getMessages("s1");
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0]).toEqual({ type: "text", text: "hello" });
    });

    test("creates session if it does not exist", async () => {
      const msg: StoredMessage = {
        role: "user",
        parts: [{ type: "text", text: "auto-create" }],
      };
      await store.appendMessages("new_session", [msg]);
      const messages = await store.getMessages("new_session");
      expect(messages).toHaveLength(1);
    });

    test("appends multiple messages at once", async () => {
      const msgs: StoredMessage[] = [
        { role: "user", parts: [{ type: "text", text: "q1" }] },
        { role: "assistant", parts: [{ type: "text", text: "a1" }] },
        { role: "user", parts: [{ type: "text", text: "q2" }] },
      ];
      await store.appendMessages("s1", msgs);
      expect(await store.getMessageCount("s1")).toBe(3);
    });

    test("appends to existing messages", async () => {
      await store.appendMessages("s1", [
        { role: "user", parts: [{ type: "text", text: "first" }] },
      ]);
      await store.appendMessages("s1", [
        { role: "assistant", parts: [{ type: "text", text: "second" }] },
      ]);
      const msgs = await store.getMessages("s1");
      expect(msgs).toHaveLength(2);
      expect((msgs[0].parts[0] as any).text).toBe("first");
      expect((msgs[1].parts[0] as any).text).toBe("second");
    });
  });

  describe("getMessages", () => {
    test("returns empty array for non-existent session", async () => {
      const msgs = await store.getMessages("nope");
      expect(msgs).toEqual([]);
    });
  });

  describe("trimHistory", () => {
    test("keeps only last N messages", async () => {
      const msgs: StoredMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        parts: [{ type: "text" as const, text: `msg${i}` }],
      }));
      await store.appendMessages("s1", msgs);
      await store.trimHistory("s1", 3);
      const result = await store.getMessages("s1");
      expect(result).toHaveLength(3);
      expect((result[0].parts[0] as any).text).toBe("msg7");
      expect((result[2].parts[0] as any).text).toBe("msg9");
    });

    test("no-op when count is within limit", async () => {
      await store.appendMessages("s1", [
        { role: "user", parts: [{ type: "text", text: "a" }] },
        { role: "user", parts: [{ type: "text", text: "b" }] },
      ]);
      await store.trimHistory("s1", 10);
      expect(await store.getMessageCount("s1")).toBe(2);
    });

    test("no-op for non-existent session", async () => {
      await store.trimHistory("nope", 5);
      // Should not throw
    });
  });

  describe("metadata", () => {
    test("set and get metadata", async () => {
      await store.setMetadata("s1", "userInfo:ou_abc", { name: "Alice" });
      const val = await store.getMetadata("s1", "userInfo:ou_abc");
      expect(val).toEqual({ name: "Alice" });
    });

    test("returns undefined for missing key", async () => {
      await store.getOrCreate("s1");
      const val = await store.getMetadata("s1", "nope");
      expect(val).toBeUndefined();
    });

    test("returns undefined for missing session", async () => {
      const val = await store.getMetadata("nope", "key");
      expect(val).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("removes session", async () => {
      await store.getOrCreate("s1");
      await store.delete("s1");
      expect(await store.get("s1")).toBeNull();
    });

    test("no-op for non-existent session", async () => {
      await store.delete("nope");
      // Should not throw
    });
  });

  describe("size", () => {
    test("returns number of sessions", async () => {
      expect(await store.size()).toBe(0);
      await store.getOrCreate("s1");
      await store.getOrCreate("s2");
      expect(await store.size()).toBe(2);
      await store.delete("s1");
      expect(await store.size()).toBe(1);
    });
  });

  describe("destroy", () => {
    test("clears all sessions", async () => {
      await store.getOrCreate("s1");
      await store.getOrCreate("s2");
      await store.destroy();
      expect(await store.size()).toBe(0);
    });
  });
});

// =========================================================================
// 2. buildAssistantStoredMessage
// =========================================================================

describe("buildAssistantStoredMessage", () => {
  test("returns null for empty steps", () => {
    const result = buildAssistantStoredMessage([]);
    expect(result).toBeNull();
  });

  test("single step with text only", () => {
    const steps = [
      {
        content: [{ type: "text", text: "Hello world" }],
        text: "Hello world",
        toolCalls: [],
        toolResults: [],
      },
    ];
    const result = buildAssistantStoredMessage(steps as any);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("assistant");

    // With single step, step-start is still included
    const textParts = result!.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("Hello world");
  });

  test("single step with tool call and result", () => {
    const steps = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "deploy",
            input: { env: "staging" },
          },
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "deploy",
            input: { env: "staging" },
            output: { status: "ok" },
          },
          { type: "text", text: "Deployed!" },
        ],
        text: "Deployed!",
        toolCalls: [
          { toolCallId: "call_1", toolName: "deploy", input: { env: "staging" } },
        ],
        toolResults: [
          {
            toolCallId: "call_1",
            toolName: "deploy",
            input: { env: "staging" },
            output: { status: "ok" },
          },
        ],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    expect(result).not.toBeNull();

    const toolParts = result!.parts.filter((p) =>
      p.type.startsWith("tool-"),
    );
    // tool-deploy part
    const deployPart = toolParts.find((p) => p.type === "tool-deploy") as any;
    expect(deployPart).toBeDefined();
    expect(deployPart.toolCallId).toBe("call_1");
    expect(deployPart.state).toBe("output-available");
    expect(deployPart.input).toEqual({ env: "staging" });
    expect(deployPart.output).toEqual({ status: "ok" });

    // text part
    const textParts = result!.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("Deployed!");
  });

  test("multi-step with tool call in first step and text in second", () => {
    const steps = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_sel",
            toolName: "userSelect",
            input: { message: "Pick env", options: [] },
          },
          {
            type: "tool-result",
            toolCallId: "call_sel",
            toolName: "userSelect",
            input: { message: "Pick env", options: [] },
            output: { selectedValue: "prod", selectedLabel: "Production" },
          },
        ],
        text: "",
        toolCalls: [
          {
            toolCallId: "call_sel",
            toolName: "userSelect",
            input: { message: "Pick env", options: [] },
          },
        ],
        toolResults: [
          {
            toolCallId: "call_sel",
            toolName: "userSelect",
            input: { message: "Pick env", options: [] },
            output: { selectedValue: "prod", selectedLabel: "Production" },
          },
        ],
      },
      {
        content: [{ type: "text", text: "Deploying to production..." }],
        text: "Deploying to production...",
        toolCalls: [],
        toolResults: [],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    expect(result).not.toBeNull();

    // Should have step-start markers
    const stepStarts = result!.parts.filter((p) => p.type === "step-start");
    expect(stepStarts.length).toBe(2);

    // userSelect tool part
    const selectPart = result!.parts.find(
      (p) => p.type === "tool-userSelect",
    ) as any;
    expect(selectPart).toBeDefined();
    expect(selectPart.state).toBe("output-available");
    expect(selectPart.output).toEqual({
      selectedValue: "prod",
      selectedLabel: "Production",
    });

    // Final text
    const textParts = result!.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("Deploying to production...");
  });

  test("tool error produces output-error state", () => {
    const steps = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_fail",
            toolName: "deploy",
            input: { env: "bad" },
          },
          {
            type: "tool-error",
            toolCallId: "call_fail",
            toolName: "deploy",
            input: { env: "bad" },
            error: new Error("Permission denied"),
          },
        ],
        text: "",
        toolCalls: [
          { toolCallId: "call_fail", toolName: "deploy", input: { env: "bad" } },
        ],
        toolResults: [],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    const errorPart = result!.parts.find(
      (p) => p.type === "tool-deploy",
    ) as any;
    expect(errorPart).toBeDefined();
    expect(errorPart.state).toBe("output-error");
    expect(errorPart.errorText).toBe("Permission denied");
  });

  test("executePlan denied output is stored as output-denied with approval metadata", () => {
    const steps = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_plan_deny",
            toolName: "executePlan",
            input: {
              intent: "Delete record",
              steps: [{ functionId: "deleteRecord", title: "Delete", arguments: {} }],
            },
          },
          {
            type: "tool-result",
            toolCallId: "call_plan_deny",
            toolName: "executePlan",
            input: {
              intent: "Delete record",
              steps: [{ functionId: "deleteRecord", title: "Delete", arguments: {} }],
            },
            output: {
              denied: true,
              reason: "User denied the plan in Wave.",
              totalSteps: 1,
              completedSteps: 0,
              results: [],
            },
          },
        ],
        text: "",
        toolCalls: [
          {
            toolCallId: "call_plan_deny",
            toolName: "executePlan",
            input: {
              intent: "Delete record",
              steps: [{ functionId: "deleteRecord", title: "Delete", arguments: {} }],
            },
          },
        ],
        toolResults: [
          {
            toolCallId: "call_plan_deny",
            toolName: "executePlan",
            input: {
              intent: "Delete record",
              steps: [{ functionId: "deleteRecord", title: "Delete", arguments: {} }],
            },
            output: {
              denied: true,
              reason: "User denied the plan in Wave.",
              totalSteps: 1,
              completedSteps: 0,
              results: [],
            },
          },
        ],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    const planPart = result!.parts.find(
      (p) => p.type === "tool-executePlan",
    ) as any;
    expect(planPart).toBeDefined();
    expect(planPart.state).toBe("output-denied");
    expect(planPart.approval).toEqual({
      id: "wave-denied-call_plan_deny",
      approved: false,
      reason: "User denied the plan in Wave.",
    });
  });

  test("tool call without result gets input-available state", () => {
    const steps = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_noexec",
            toolName: "approve",
            input: { action: "delete" },
          },
        ],
        text: "",
        toolCalls: [
          {
            toolCallId: "call_noexec",
            toolName: "approve",
            input: { action: "delete" },
          },
        ],
        toolResults: [],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    const part = result!.parts.find(
      (p) => p.type === "tool-approve",
    ) as any;
    expect(part).toBeDefined();
    expect(part.state).toBe("input-available");
    expect(part.output).toBeUndefined();
  });

  test("reasoning parts are preserved", () => {
    const steps = [
      {
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          { type: "text", text: "The answer is 42." },
        ],
        text: "The answer is 42.",
        toolCalls: [],
        toolResults: [],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    const reasoning = result!.parts.find((p) => p.type === "reasoning") as any;
    expect(reasoning).toBeDefined();
    expect(reasoning.text).toBe("Let me think about this...");
  });

  test("empty text parts are skipped", () => {
    const steps = [
      {
        content: [
          { type: "text", text: "" },
          { type: "text", text: "real content" },
        ],
        text: "real content",
        toolCalls: [],
        toolResults: [],
      },
    ];

    const result = buildAssistantStoredMessage(steps as any);
    const textParts = result!.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("real content");
  });

  test("createdAt is set", () => {
    const before = Date.now();
    const steps = [
      {
        content: [{ type: "text", text: "hi" }],
        text: "hi",
        toolCalls: [],
        toolResults: [],
      },
    ];
    const result = buildAssistantStoredMessage(steps as any);
    expect(result!.createdAt).toBeGreaterThanOrEqual(before);
    expect(result!.createdAt).toBeLessThanOrEqual(Date.now());
  });
});

// =========================================================================
// 3. buildUserStoredMessage
// =========================================================================

describe("buildUserStoredMessage", () => {
  test("creates a user message with text part", () => {
    const msg = buildUserStoredMessage("hello");
    expect(msg.role).toBe("user");
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toEqual({ type: "text", text: "hello" });
  });

  test("sets createdAt", () => {
    const before = Date.now();
    const msg = buildUserStoredMessage("test");
    expect(msg.createdAt).toBeGreaterThanOrEqual(before);
  });
});

// =========================================================================
// 4. SessionManager — async delegation
// =========================================================================

describe("SessionManager (waveSessionManager)", () => {
  const testKey = "wave:dm:store_test";

  afterEach(async () => {
    await waveSessionManager.clear(testKey);
  });

  test("addUserMessage stores a user message", async () => {
    await waveSessionManager.addUserMessage(testKey, "hello");
    const msgs = await waveSessionManager.getMessages(testKey);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect((msgs[0].parts[0] as any).text).toBe("hello");
  });

  test("addAssistantMessage stores full StoredMessage", async () => {
    const assistantMsg: StoredMessage = {
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-deploy",
          toolCallId: "c1",
          state: "output-available",
          input: { env: "prod" },
          output: { ok: true },
        },
        { type: "text", text: "Done" },
      ],
    };
    await waveSessionManager.addAssistantMessage(testKey, assistantMsg);
    const msgs = await waveSessionManager.getMessages(testKey);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts).toHaveLength(3);
    expect(msgs[0].parts[1].type).toBe("tool-deploy");
  });

  test("multi-turn conversation preserves all messages", async () => {
    await waveSessionManager.addUserMessage(testKey, "deploy to staging");
    await waveSessionManager.addAssistantMessage(testKey, {
      role: "assistant",
      parts: [
        {
          type: "tool-userSelect",
          toolCallId: "c1",
          state: "output-available",
          input: { message: "Pick env" },
          output: { selectedValue: "staging" },
        },
        { type: "text", text: "Deployed to staging." },
      ],
    });
    await waveSessionManager.addUserMessage(testKey, "now rollback");
    await waveSessionManager.addAssistantMessage(testKey, {
      role: "assistant",
      parts: [{ type: "text", text: "Rolled back." }],
    });

    const msgs = await waveSessionManager.getMessages(testKey);
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
    expect(msgs[3].role).toBe("assistant");

    // First assistant has tool part
    const toolPart = msgs[1].parts.find(
      (p) => p.type === "tool-userSelect",
    ) as any;
    expect(toolPart).toBeDefined();
    expect(toolPart.output.selectedValue).toBe("staging");
  });

  test("trimHistory works via manager", async () => {
    for (let i = 0; i < 5; i++) {
      await waveSessionManager.addUserMessage(testKey, `msg${i}`);
    }
    await waveSessionManager.trimHistory(testKey, 2);
    const msgs = await waveSessionManager.getMessages(testKey);
    expect(msgs).toHaveLength(2);
    expect((msgs[0].parts[0] as any).text).toBe("msg3");
  });

  test("setUserInfo / getUserInfo round trip", async () => {
    const info = {
      name: "Alice",
      en_name: "Alice",
      nick_name: "Ali",
      avatar: "https://example.com/a.png",
      union_id: "ou_abc",
      user_id: "uid_1",
      display_status: "active",
      email: "alice@example.com",
    };
    await waveSessionManager.setUserInfo(testKey, "ou_abc", info);
    const cached = await waveSessionManager.getUserInfo(testKey, "ou_abc");
    expect(cached).toEqual(info);
  });

  test("getUserInfo returns undefined for uncached user", async () => {
    const result = await waveSessionManager.getUserInfo(testKey, "ou_zzz");
    expect(result).toBeUndefined();
  });

  test("size returns session count", async () => {
    const before = await waveSessionManager.size();
    await waveSessionManager.addUserMessage(testKey, "hi");
    expect(await waveSessionManager.size()).toBe(before + 1);
  });
});

// =========================================================================
// 5. StoredMessage JSON serialization (migration readiness)
// =========================================================================

describe("StoredMessage JSON serialization", () => {
  test("round-trips through JSON.stringify/parse", () => {
    const msg: StoredMessage = {
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-userSelect",
          toolCallId: "call_1",
          state: "output-available",
          input: { message: "Pick", options: [{ value: "a" }] },
          output: { selectedValue: "a", selectedLabel: "A" },
        },
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "Done!" },
      ],
      createdAt: Date.now(),
    };

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json) as StoredMessage;

    expect(parsed.role).toBe("assistant");
    expect(parsed.parts).toHaveLength(4);
    expect(parsed.parts[0].type).toBe("step-start");
    expect(parsed.parts[1].type).toBe("tool-userSelect");
    expect((parsed.parts[1] as any).state).toBe("output-available");
    expect((parsed.parts[1] as any).output.selectedValue).toBe("a");
    expect(parsed.parts[2].type).toBe("reasoning");
    expect(parsed.parts[3].type).toBe("text");
    expect(parsed.createdAt).toBe(msg.createdAt);
  });

  test("tool error part serializes correctly", () => {
    const msg: StoredMessage = {
      role: "assistant",
      parts: [
        {
          type: "tool-deploy",
          toolCallId: "c1",
          state: "output-error",
          input: { env: "bad" },
          errorText: "Permission denied",
        },
      ],
    };

    const parsed = JSON.parse(JSON.stringify(msg)) as StoredMessage;
    const part = parsed.parts[0] as any;
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe("Permission denied");
    expect(part.output).toBeUndefined();
  });
});
