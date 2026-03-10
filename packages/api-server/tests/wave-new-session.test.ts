import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WaveClients } from "../src/wave/client";
import { tryHandleWaveKeywordCommand } from "../src/wave/event-handler";
import type { WaveMessageContext } from "../src/wave/message-parser";
import {
  addPendingPlanApproval,
  hasPendingPlanApproval,
  removePendingPlanApproval,
} from "../src/wave/pending-approvals";
import {
  addPendingSelection,
  hasPendingSelection,
  removePendingSelection,
} from "../src/wave/pending-selections";
import { waveSessionManager } from "../src/wave/session-manager";

function createMockWaveClients(
  overrides: {
    msgReply?: (...args: any[]) => any;
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
      send: mock(async () => ({ msg_id: "mock_send" })),
      reply: overrides.msgReply ?? mock(async () => ({ msg_id: "mock_reply" })),
      updateCard: mock(async () => ({})),
      updateCardActively: mock(async () => ({})),
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

function createWaveContext(
  overrides: Partial<WaveMessageContext> = {},
): WaveMessageContext {
  return {
    chatId: "ou_default",
    messageId: "msg_default",
    senderId: "ou_default",
    senderIdType: "union_id",
    chatType: "p2p",
    mentionedBot: false,
    content: "/new",
    contentType: "text",
    imageKeys: [],
    ...overrides,
  };
}

const sessionKeys = new Set<string>();
const selectionIds = new Set<string>();
const approvalIds = new Set<string>();

function trackSession(sessionKey: string): string {
  sessionKeys.add(sessionKey);
  return sessionKey;
}

function trackSelection(cardMessageId: string): string {
  selectionIds.add(cardMessageId);
  return cardMessageId;
}

function trackApproval(cardMessageId: string): string {
  approvalIds.add(cardMessageId);
  return cardMessageId;
}

afterEach(async () => {
  for (const selectionId of selectionIds) {
    if (hasPendingSelection(selectionId)) {
      removePendingSelection(selectionId, "test cleanup");
    }
  }
  selectionIds.clear();

  for (const approvalId of approvalIds) {
    if (hasPendingPlanApproval(approvalId)) {
      removePendingPlanApproval(approvalId, "test cleanup");
    }
  }
  approvalIds.clear();

  for (const sessionKey of sessionKeys) {
    await waveSessionManager.clear(sessionKey);
  }
  sessionKeys.clear();
});

describe("tryHandleWaveKeywordCommand", () => {
  test("clears session state, aborts active work, and replies to /new", async () => {
    const replyCalls: any[][] = [];
    const clients = createMockWaveClients({
      msgReply: mock(async (...args: any[]) => {
        replyCalls.push(args);
        return { msg_id: "mock_reply" };
      }),
    });

    const sessionKey = trackSession("wave:dm:ou_reset_user");
    await waveSessionManager.addUserMessage(sessionKey, "old question");
    await waveSessionManager.addAssistantMessage(sessionKey, {
      role: "assistant",
      parts: [{ type: "text", text: "old answer" }],
    });

    const selectionPromise = addPendingSelection(
      trackSelection("card_reset_selection"),
      [{ value: "a", label: "Option A" }],
      sessionKey,
    );
    const approvalPromise = addPendingPlanApproval(
      trackApproval("card_reset_approval"),
      {
        intent: "Delete record",
        steps: [{ functionId: "deleteRecord", title: "Delete", arguments: {} }],
      },
      sessionKey,
    );

    const controller = new AbortController();
    waveSessionManager.setActiveAbortController(sessionKey, controller);

    const handled = await tryHandleWaveKeywordCommand(
      createWaveContext({
        messageId: "msg_reset",
        senderId: "ou_reset_user",
        chatId: "ou_reset_user",
        content: " /new ",
      }),
      clients,
    );

    expect(handled).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(waveSessionManager.getActiveAbortController(sessionKey)).toBeUndefined();
    expect(await waveSessionManager.getMessages(sessionKey)).toEqual([]);
    expect(hasPendingSelection("card_reset_selection")).toBe(false);
    expect(hasPendingPlanApproval("card_reset_approval")).toBe(false);
    await expect(selectionPromise).rejects.toThrow("User started a new session");
    await expect(approvalPromise).rejects.toThrow("User started a new session");

    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0][0]).toBe("msg_reset");
    expect(JSON.stringify(replyCalls[0][1])).toContain("已开始新会话");
  });

  test("uses the shared group session key when resetting a group chat", async () => {
    const replyCalls: any[][] = [];
    const clients = createMockWaveClients({
      msgReply: mock(async (...args: any[]) => {
        replyCalls.push(args);
        return { msg_id: "mock_reply" };
      }),
    });

    const targetSession = trackSession("wave:group:oc_group_1");
    const otherSession = trackSession("wave:group:oc_group_2");
    await waveSessionManager.addUserMessage(targetSession, "keep?");
    await waveSessionManager.addUserMessage(otherSession, "other group");

    const handled = await tryHandleWaveKeywordCommand(
      createWaveContext({
        chatId: "oc_group_1",
        messageId: "msg_group_reset",
        senderId: "ou_group_user",
        chatType: "group",
        content: "/new",
      }),
      clients,
    );

    expect(handled).toBe(true);
    expect(await waveSessionManager.getMessages(targetSession)).toEqual([]);
    expect(await waveSessionManager.getMessages(otherSession)).toHaveLength(1);
    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0][0]).toBe("msg_group_reset");
  });

  test("ignores non-command messages", async () => {
    const replyCalls: any[][] = [];
    const clients = createMockWaveClients({
      msgReply: mock(async (...args: any[]) => {
        replyCalls.push(args);
        return { msg_id: "mock_reply" };
      }),
    });

    const sessionKey = trackSession("wave:dm:ou_normal_user");
    await waveSessionManager.addUserMessage(sessionKey, "hello");

    const handled = await tryHandleWaveKeywordCommand(
      createWaveContext({
        senderId: "ou_normal_user",
        chatId: "ou_normal_user",
        messageId: "msg_normal",
        content: "/new please",
      }),
      clients,
    );

    const messages = await waveSessionManager.getMessages(sessionKey);
    expect(handled).toBe(false);
    expect(messages).toHaveLength(1);
    expect(replyCalls).toHaveLength(0);
  });
});
