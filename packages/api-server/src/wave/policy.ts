/**
 * Wave access control policy.
 *
 * Checks whether an incoming message should be processed based on
 * DM/group policy, allowlists, and mention requirements.
 */

import type { WaveConfig } from "./config";
import type { WaveMessageContext } from "./message-parser";

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a message passes the access control policy.
 */
export function checkPolicy(
  ctx: WaveMessageContext,
  config: WaveConfig,
): PolicyResult {
  if (ctx.chatType === "p2p") {
    return checkDmPolicy(ctx, config);
  }
  return checkGroupPolicy(ctx, config);
}

function checkDmPolicy(
  ctx: WaveMessageContext,
  config: WaveConfig,
): PolicyResult {
  if (config.dmPolicy === "open") {
    return { allowed: true };
  }

  // allowlist mode
  if (config.allowFrom.length === 0) {
    return { allowed: false, reason: "DM allowlist is empty" };
  }

  if (config.allowFrom.includes(ctx.senderId)) {
    return { allowed: true };
  }

  return { allowed: false, reason: `Sender ${ctx.senderId} not in DM allowlist` };
}

function checkGroupPolicy(
  ctx: WaveMessageContext,
  config: WaveConfig,
): PolicyResult {
  if (config.groupPolicy === "disabled") {
    return { allowed: false, reason: "Group messages are disabled" };
  }

  // Check @mention requirement
  if (config.requireMention && !ctx.mentionedBot) {
    return { allowed: false, reason: "Bot not @mentioned in group" };
  }

  if (config.groupPolicy === "open") {
    return { allowed: true };
  }

  // allowlist mode
  if (config.groupAllowFrom.length === 0) {
    return { allowed: false, reason: "Group allowlist is empty" };
  }

  if (config.groupAllowFrom.includes(ctx.chatId)) {
    return { allowed: true };
  }

  return { allowed: false, reason: `Chat ${ctx.chatId} not in group allowlist` };
}
