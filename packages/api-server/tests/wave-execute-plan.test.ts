import { beforeEach, describe, expect, mock, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@ocean-mcp/shared";
import type { WaveClients } from "../src/wave/client";
import { buildWaveTools } from "../src/wave/tools";
import {
  addPendingPlanApproval,
  hasPendingPlanApproval,
  PLAN_APPROVAL_ACTION,
  removeAllPlanApprovalsForSession,
  removePendingPlanApproval,
  resolvePendingPlanApproval,
} from "../src/wave/pending-approvals";

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockWaveClients(
  overrides: {
    msgSend?: (...args: any[]) => any;
    msgUpdateCardActively?: (...args: any[]) => any;
  } = {},
): WaveClients {
  return {
    client: {} as any,
    event: {
      onMsgDirectSendV2: mock(() => {}),
      onMsgGroupSendV2: mock(() => {}),
      onMsgCardReaction: mock(() => {}),
      handle: mock(() => ({ code: 0 })),
    } as any,
    msg: {
      send: overrides.msgSend ?? mock(async () => ({ msg_id: "mock_execute_plan_card" })),
      reply: mock(async () => ({ msg_id: "mock_reply" })),
      updateCard: mock(async () => ({})),
      updateCardActively: overrides.msgUpdateCardActively ?? mock(async () => ({})),
      updateCardMode: mock(async () => ({ streaming_id: "" })),
      updateCardStreamingActively: mock(async () => ({})),
      recall: mock(async () => ({})),
    } as any,
    contact: {
      getUsers: mock(async () => ({ users: [] })),
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

function createSkillTools() {
  return {
    createDraft: tool({
      description: "Create a draft record",
      inputSchema: z.object({
        name: z.string(),
      }),
      execute: async ({ name }: { name: string }) => ({
        id: `draft-${name}`,
        name,
      }),
    }),
    publishDraft: tool({
      description: "Publish a draft record",
      inputSchema: z.object({
        draftId: z.string(),
        channel: z.string(),
      }),
      execute: async ({
        draftId,
        channel,
      }: {
        draftId: string;
        channel: string;
      }) => ({
        published: true,
        draftId,
        channel,
      }),
    }),
  };
}

/**
 * Create skill tools with a mix of read and write tools.
 * Write tools have `needsApproval: true` (like code-tool-adapter does).
 */
function createMixedSkillTools() {
  return {
    // Read tool — no needsApproval
    fetchRecords: tool({
      description: "Fetch records from the database",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }: { query: string }) => ({
        records: [{ id: "1", query }],
      }),
    }),
    // Write tool — needsApproval: true (static, like CodeFunctionDefinition wrapper)
    deleteRecord: tool({
      description: "Delete a record from the database",
      inputSchema: z.object({
        recordId: z.string(),
      }),
      needsApproval: true,
      execute: async ({ recordId }: { recordId: string }) => ({
        deleted: true,
        recordId,
      }),
    }),
    // Write tool — needsApproval as function (like browser executePlan's validation gate)
    updateRecord: tool({
      description: "Update a record in the database",
      inputSchema: z.object({
        recordId: z.string(),
        data: z.record(z.any()),
      }),
      needsApproval: async () => true,
      execute: async ({ recordId, data }: { recordId: string; data: Record<string, any> }) => ({
        updated: true,
        recordId,
        data,
      }),
    }),
  };
}

describe("pending-plan-approvals", () => {
  const usedIds: string[] = [];

  function trackId(id: string): string {
    usedIds.push(id);
    return id;
  }

  beforeEach(() => {
    for (const id of usedIds) {
      if (hasPendingPlanApproval(id)) {
        removePendingPlanApproval(id, "test cleanup");
      }
    }
    usedIds.length = 0;
  });

  test("resolves with the chosen decision", async () => {
    const cardId = trackId("plan_approval_resolve");
    const promise = addPendingPlanApproval(
      cardId,
      { intent: "Publish draft", steps: [] },
      "wave:dm:test",
    );

    expect(hasPendingPlanApproval(cardId)).toBe(true);
    resolvePendingPlanApproval(cardId, PLAN_APPROVAL_ACTION.APPROVE);
    expect(await promise).toBe(PLAN_APPROVAL_ACTION.APPROVE);
    expect(hasPendingPlanApproval(cardId)).toBe(false);
  });

  test("removeAllPlanApprovalsForSession rejects only matching session entries", async () => {
    const a1 = trackId("plan_session_a_1");
    const a2 = trackId("plan_session_a_2");
    const b1 = trackId("plan_session_b_1");

    const p1 = addPendingPlanApproval(a1, { intent: "A1", steps: [] }, "session-a");
    const p2 = addPendingPlanApproval(a2, { intent: "A2", steps: [] }, "session-a");
    const p3 = addPendingPlanApproval(b1, { intent: "B1", steps: [] }, "session-b");

    const removed = removeAllPlanApprovalsForSession(
      "session-a",
      "User sent a new message",
    );
    expect(removed).toBe(2);

    await expect(p1).rejects.toThrow("User sent a new message");
    await expect(p2).rejects.toThrow("User sent a new message");

    resolvePendingPlanApproval(b1, PLAN_APPROVAL_ACTION.DENY);
    expect(await p3).toBe(PLAN_APPROVAL_ACTION.DENY);
  });
});

describe("Wave executePlan tool", () => {
  test("buildWaveTools includes a Wave-native executePlan tool", () => {
    const clients = createMockWaveClients();
    const tools = buildWaveTools(
      [],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    expect(tools.executePlan).toBeDefined();
    expect((tools.executePlan as any).execute).toBeDefined();
  });

  test("invalid executePlan steps return silentRetry without sending a card", async () => {
    const mockSend = mock(async () => ({ msg_id: "should_not_be_called" }));
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools(
      [],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    const result = await (tools.executePlan as any).execute({
      intent: "Recursive plan",
      steps: [
        {
          functionId: "executePlan",
          title: "Bad recursive step",
          arguments: {},
        },
      ],
    });

    expect(result._silentRetry).toBe(true);
    expect(result.validationError).toContain("cannot be used as an executePlan step");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("denied approval returns a denied result envelope", async () => {
    let sentContent: any = null;
    const mockSend = mock(async (_chatId: string, msg: any) => {
      sentContent = msg.content;
      return { msg_id: "wave_plan_deny_card" };
    });
    const clients = createMockWaveClients({ msgSend: mockSend });
    const tools = buildWaveTools(
      [],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    const executePromise = (tools.executePlan as any).execute({
      intent: "Delete record",
      steps: [
        {
          functionId: "getCurrentUser",
          title: "Load user",
          arguments: {},
        },
      ],
    });

    await tick();
    expect(sentContent.header.title).toBe("待审批执行计划");
    expect(sentContent.card.elements[1].tag).toBe("flow");
    expect(sentContent.card.elements[0].text).toContain("```json");
    expect(sentContent.card.elements[0].text).toContain("{}");

    resolvePendingPlanApproval("wave_plan_deny_card", PLAN_APPROVAL_ACTION.DENY);
    const result = await executePromise;

    expect(result.denied).toBe(true);
    expect(result.completedSteps).toBe(0);
    expect(result.results).toEqual([]);
  });

  test("approved plan executes server-side steps and resolves variable refs", async () => {
    const updateCalls: Array<{ msgId: string; content: any }> = [];
    const clients = createMockWaveClients({
      msgSend: mock(async () => ({ msg_id: "wave_plan_approve_card" })),
      msgUpdateCardActively: mock(async (msgId: string, content: any) => {
        updateCalls.push({ msgId, content });
        return {};
      }),
    });

    const skill = {
      name: "plan-skill",
      description: "Plan test skill",
      path: "/tmp/plan-skill",
      tools: createSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    const executePromise = (tools.executePlan as any).execute({
      intent: "Create and publish a draft",
      steps: [
        {
          functionId: "createDraft",
          title: "Create draft",
          arguments: { name: "release-note" },
        },
        {
          functionId: "publishDraft",
          title: "Publish draft",
          arguments: {
            draftId: "$0.id",
            channel: "wave",
          },
        },
      ],
    });

    await tick();
    resolvePendingPlanApproval(
      "wave_plan_approve_card",
      PLAN_APPROVAL_ACTION.APPROVE,
    );
    const result = await executePromise;

    expect(result.totalSteps).toBe(2);
    expect(result.completedSteps).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].result).toEqual({
      id: "draft-release-note",
      name: "release-note",
    });
    expect(result.results[1].status).toBe("success");
    expect(result.results[1].result).toEqual({
      published: true,
      draftId: "draft-release-note",
      channel: "wave",
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].msgId).toBe("wave_plan_approve_card");
    expect(updateCalls[0].content.header.title).toBe("执行计划执行完成");
    expect(updateCalls[0].content.card.elements[0].text).toContain("   - 参数:");
    expect(updateCalls[0].content.card.elements[0].text).toContain(
      '```json\n{\n  "name": "release-note"\n}\n```',
    );
    expect(updateCalls[0].content.card.elements[0].text).toContain("   - 输出:");
    expect(updateCalls[0].content.card.elements[0].text).toContain(
      '```json\n{\n  "published": true,\n  "draftId": "draft-release-note",\n  "channel": "wave"\n}\n```',
    );
  });
});

describe("Wave write tool guard", () => {
  test("write skill tool called directly returns error directing to executePlan", async () => {
    const clients = createMockWaveClients();
    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // Calling the write tool (needsApproval: true) directly should be rejected
    const result = await (tools.deleteRecord as any).execute({ recordId: "rec-1" });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("write/mutation operation");
    expect(result.error).toContain("executePlan");
  });

  test("write skill tool with needsApproval function is also guarded", async () => {
    const clients = createMockWaveClients();
    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // needsApproval as a function should also be detected and guarded
    const result = await (tools.updateRecord as any).execute({
      recordId: "rec-2",
      data: { name: "updated" },
    });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("write/mutation operation");
    expect(result.error).toContain("executePlan");
  });

  test("read skill tool called directly works without guard", async () => {
    const clients = createMockWaveClients();
    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // Read tool should execute normally without any guard
    const result = await (tools.fetchRecords as any).execute({ query: "SELECT *" });
    expect(result.error).toBeUndefined();
    expect(result.records).toEqual([{ id: "1", query: "SELECT *" }]);
  });

  test("write skill tool works when called through executePlan after approval", async () => {
    const updateCalls: Array<{ msgId: string; content: any }> = [];
    const clients = createMockWaveClients({
      msgSend: mock(async () => ({ msg_id: "wave_write_guard_card" })),
      msgUpdateCardActively: mock(async (msgId: string, content: any) => {
        updateCalls.push({ msgId, content });
        return {};
      }),
    });

    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // Use executePlan to call the write tool — should work after approval
    const executePromise = (tools.executePlan as any).execute({
      intent: "Delete a record via plan",
      steps: [
        {
          functionId: "deleteRecord",
          title: "Delete record rec-42",
          arguments: { recordId: "rec-42" },
        },
      ],
    });

    await tick();

    // Approve the plan
    resolvePendingPlanApproval(
      "wave_write_guard_card",
      PLAN_APPROVAL_ACTION.APPROVE,
    );
    const result = await executePromise;

    expect(result.totalSteps).toBe(1);
    expect(result.completedSteps).toBe(1);
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].result).toEqual({ deleted: true, recordId: "rec-42" });
  });

  test("guarded write tool preserves original description and inputSchema", () => {
    const clients = createMockWaveClients();
    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // The guarded tool should preserve description and schema so executePlan
    // validation can inspect its parameters
    const deleteTool = tools.deleteRecord as any;
    expect(deleteTool).toBeDefined();
    expect(deleteTool.description).toBe("Delete a record from the database");
    // inputSchema should still validate correctly
    const valid = deleteTool.inputSchema.safeParse({ recordId: "abc" });
    expect(valid.success).toBe(true);
    const invalid = deleteTool.inputSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  test("guarded write tool does not have needsApproval", () => {
    const clients = createMockWaveClients();
    const skill = {
      name: "mixed-skill",
      description: "Skill with read and write tools",
      path: "/tmp/mixed-skill",
      tools: createMixedSkillTools(),
    };

    const tools = buildWaveTools(
      [skill],
      [],
      createMockSandbox(),
      clients,
      "ou_sender",
      "wave:dm:test",
      "oc_chat",
    );

    // needsApproval should be stripped — it has no meaning in Wave
    const deleteTool = tools.deleteRecord as any;
    expect(deleteTool.needsApproval).toBeUndefined();
  });
});
