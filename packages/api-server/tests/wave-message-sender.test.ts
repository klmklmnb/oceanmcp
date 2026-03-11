import { describe, expect, mock, test } from "bun:test";
import type { WaveClients } from "../src/wave/client";

function createMockWaveClients(
  overrides: {
    msgReply?: (...args: any[]) => any;
    msgSend?: (...args: any[]) => any;
    msgUpdateCardActively?: (...args: any[]) => any;
    msgUpdateCardMode?: (...args: any[]) => any;
    msgUpdateCardStreamingActively?: (...args: any[]) => any;
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
      send: overrides.msgSend ?? mock(async () => ({ msg_id: "mock_send_001" })),
      reply: overrides.msgReply ?? mock(async () => ({ msg_id: "mock_reply_001" })),
      updateCard: mock(async () => ({})),
      updateCardActively:
        overrides.msgUpdateCardActively ?? mock(async () => ({})),
      updateCardMode:
        overrides.msgUpdateCardMode ??
        mock(async () => ({ streaming_id: "mock_stream_001" })),
      updateCardStreamingActively:
        overrides.msgUpdateCardStreamingActively ?? mock(async () => ({})),
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

describe("wave message sender formatting", () => {
  test("sendSimpleReply renders think blocks as italic gray markdown", async () => {
    let replyPayload: any;
    const clients = createMockWaveClients({
      msgReply: mock(async (_replyToMessageId: string, payload: any) => {
        replyPayload = payload;
        return { msg_id: "reply_001" };
      }),
    });

    const { sendSimpleReply } = await import("../src/wave/message-sender");
    await sendSimpleReply(
      clients,
      "msg_001",
      "开始 <think>灰色</think> 结束",
    );

    expect(replyPayload.content.card.text).toBe(
      '开始 *<font color="comment">灰色</font>* 结束',
    );
    expect(JSON.stringify(replyPayload)).not.toContain("<think>");
    expect(JSON.stringify(replyPayload)).not.toContain("</think>");
  });

  test("updateStreamingText formats unfinished think blocks before streaming update", async () => {
    const streamingUpdates: Array<{
      cardMessageId: string;
      streamingId: string;
      text: string;
      sequence: number;
    }> = [];
    const clients = createMockWaveClients({
      msgUpdateCardStreamingActively: mock(
        async (
          cardMessageId: string,
          streamingId: string,
          text: string,
          sequence: number,
        ) => {
          streamingUpdates.push({ cardMessageId, streamingId, text, sequence });
        },
      ),
    });

    const { updateStreamingText } = await import("../src/wave/message-sender");
    await updateStreamingText(
      clients,
      {
        cardMessageId: "card_001",
        streamingId: "stream_001",
        accumulatedText: "",
        sequence: 1,
        streamingEnabled: true,
        fallbackToCardUpdate: false,
      },
      "答复 <think>灰色",
    );

    expect(streamingUpdates).toHaveLength(1);
    expect(streamingUpdates[0].text).toBe(
      '答复 *<font color="comment">灰色</font>*',
    );
  });

  test("finalizeReplyCard formats think blocks in the final card content", async () => {
    const modeUpdates: any[] = [];
    const activeUpdates: any[] = [];
    const clients = createMockWaveClients({
      msgUpdateCardMode: mock(async (_msgId: string, payload: any) => {
        modeUpdates.push(payload);
        return {};
      }),
      msgUpdateCardActively: mock(async (_msgId: string, content: any) => {
        activeUpdates.push(content);
        return {};
      }),
    });

    const { finalizeReplyCard } = await import("../src/wave/message-sender");
    await finalizeReplyCard(
      clients,
      {
        cardMessageId: "card_002",
        streamingId: "stream_002",
        accumulatedText: "结果 <think>灰色</think>",
        sequence: 1,
        streamingEnabled: true,
        fallbackToCardUpdate: false,
      },
      "chat_001",
    );

    expect(modeUpdates).toHaveLength(1);
    expect(
      JSON.parse(modeUpdates[0].content).card.elements[0].text,
    ).toBe('结果 *<font color="comment">灰色</font>*');
    expect(activeUpdates).toHaveLength(1);
    expect(activeUpdates[0].card.elements[0].text).toBe(
      '结果 *<font color="comment">灰色</font>*',
    );
  });
});
