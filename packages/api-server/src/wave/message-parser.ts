/**
 * Wave message content parser.
 *
 * Extracts plain text from incoming Wave message events. Supports:
 * - Text messages
 * - Rich text (with @mentions, emoji, URLs)
 * - Markdown messages
 * - Image / Video / File (as placeholder text)
 *
 * Adapted from openclaw-wave-extension's message-parser.ts, simplified
 * for server-side use (no image download, no file URL resolution).
 */

import {
  MsgType,
  RichTextType,
  type EventMsgDirectSendV2,
  type EventMsgGroupSendV2,
} from "@mihoyo/wave-opensdk";
import type { WaveConfig } from "./config";

export type WaveEvent = EventMsgDirectSendV2 | EventMsgGroupSendV2;

/** Parsed message context — everything needed for the chat pipeline */
export interface WaveMessageContext {
  /** Chat / receiver ID */
  chatId: string;
  /** Message ID (for replying) */
  messageId: string;
  /** Sender's ID */
  senderId: string;
  /** Sender ID type */
  senderIdType: string;
  /** p2p (DM) or group */
  chatType: "p2p" | "group";
  /** Whether the bot was @mentioned */
  mentionedBot: boolean;
  /** Extracted text content */
  content: string;
  /** Original message type */
  contentType: string;
}

// ── Content Parsing ──────────────────────────────────────────────────────────

/**
 * Safely parse the `content` field which may be a JSON string or an object.
 */
function ensureContentObject(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return { text: content };
    }
  }
  if (content && typeof content === "object") {
    return content as Record<string, unknown>;
  }
  return {};
}

/**
 * Parse rich text blocks into plain text.
 */
function parseRichText(
  content: { tags?: Array<{ items?: Array<Record<string, any>> }> },
  appId?: string,
): string {
  const tags = content.tags;
  if (!tags) return "";

  return tags
    .map((block) => {
      if (!block.items) return "";
      return block.items
        .map((item) => {
          switch (item.type) {
            case RichTextType.At: {
              const atContent = item.content as { id?: string; id_type: string };
              if (atContent.id_type === "all") return "@all";
              // Filter out @bot-self
              if (atContent.id_type === "app_id" && atContent.id === appId) return "";
              return `@${atContent.id ?? "unknown"}`;
            }
            case RichTextType.Emoji:
              return `[emoji:${item.content.code}]`;
            case RichTextType.Image:
              return `[image:${item.content.image_key}]`;
            case RichTextType.Text:
              return item.content.text ?? "";
            case RichTextType.Url:
              return item.content.url ?? "";
            default:
              return "";
          }
        })
        .join("");
    })
    .join("\n");
}

/**
 * Extract text content from a Wave message event.
 */
function parseMessageContent(event: WaveEvent, appId?: string): string {
  const message = event.event.message;
  const contentObj = ensureContentObject((message as any).content);

  switch ((message as any).msg_type) {
    case MsgType.Text:
      return String(contentObj.text ?? "");

    case MsgType.RichText:
      return parseRichText(contentObj as any, appId);

    case MsgType.Markdown:
      return String(contentObj.text ?? "");

    case MsgType.Image:
      return `[image:${contentObj.image_key ?? "unknown"}]`;

    case MsgType.Video:
      return `[video:${contentObj.file_key ?? "unknown"}]`;

    case MsgType.File:
      return `[file:${contentObj.file_key ?? "unknown"}, name:${contentObj.file_name ?? "unknown"}]`;

    default:
      // Card, CustomEmoticon, etc. — fallback
      return String(contentObj.text ?? contentObj.content ?? "");
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Wave message event into a structured WaveMessageContext.
 */
export function parseWaveEvent(
  event: WaveEvent,
  appId?: string,
): WaveMessageContext {
  const message = event.event.message;
  const sender = event.event.sender;
  const receiver = event.event.receiver;

  // Determine chat type
  const isDirectChat = receiver.id_type === "union_id" || receiver.id_type === "app_id";
  const chatType = isDirectChat ? ("p2p" as const) : ("group" as const);

  // Check if bot was @mentioned
  const mentions = (message as any).mentions ?? [];
  const mentionedBot = mentions.some(
    (m: { id_type: string; id: string }) => m.id_type === "app_id" && m.id === appId,
  );

  // Parse content
  let content = parseMessageContent(event, appId);

  // Strip @bot mentions from text
  for (const mention of mentions) {
    if ((mention as any).id_type === "app_id") {
      content = content.replace(new RegExp(`\\s*@${(mention as any).name}\\s*`, "g"), " ").trim();
    }
  }

  // For DMs the receiver is the bot itself (app_id / cli_xxx). The Wave
  // msg.send API requires a valid receiver_id_type — "app_id" is rejected
  // (error 10401004). In DMs the correct send target is the *sender*
  // (union_id / ou_xxx). For groups the receiver is already the chat
  // (chat_id / oc_xxx) which is correct.
  const chatId = isDirectChat ? sender.id : receiver.id;

  return {
    chatId,
    messageId: (message as any).msg_id,
    senderId: sender.id,
    senderIdType: String(sender.id_type ?? "union_id"),
    chatType,
    mentionedBot,
    content,
    contentType: (message as any).msg_type,
  };
}

/**
 * Derive a session key from a parsed message context.
 *
 * DMs: keyed by sender (each user gets their own conversation)
 * Groups: keyed by chat ID (each group has one shared conversation)
 */
export function deriveSessionKey(ctx: WaveMessageContext): string {
  if (ctx.chatType === "p2p") {
    return `wave:dm:${ctx.senderId}`;
  }
  return `wave:group:${ctx.chatId}`;
}
