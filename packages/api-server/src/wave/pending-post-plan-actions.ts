/**
 * Pending post-plan action store for Wave executePlan follow-up buttons.
 *
 * After a successful executePlan, a card with "总结当前会话" and "开启新会话"
 * buttons is sent. This store tracks which card messages correspond to which
 * sessions so the onMsgCardReaction callback can dispatch the appropriate action.
 *
 * Unlike pending-approvals, these are fire-and-forget — they do NOT block the
 * executePlan tool's execute() with a Promise. The store simply maps card
 * message IDs to the context needed to handle the button click.
 */

export const POST_PLAN_ACTION = {
  SUMMARIZE: "summarize_session",
  NEW_SESSION: "new_session",
} as const;

export type PostPlanActionType =
  (typeof POST_PLAN_ACTION)[keyof typeof POST_PLAN_ACTION];

export interface PendingPostPlanAction {
  sessionKey: string;
  chatId: string;
  senderId: string;
  createdAt: number;
}

const pendingMap = new Map<string, PendingPostPlanAction>();
const sessionIndex = new Map<string, Set<string>>();

const ACTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [cardMsgId, entry] of pendingMap) {
      if (now - entry.createdAt > ACTION_TIMEOUT_MS) {
        pendingMap.delete(cardMsgId);
        const sessionSet = sessionIndex.get(entry.sessionKey);
        if (sessionSet) {
          sessionSet.delete(cardMsgId);
          if (sessionSet.size === 0) sessionIndex.delete(entry.sessionKey);
        }
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

startCleanup();

export function addPendingPostPlanAction(
  cardMessageId: string,
  action: Omit<PendingPostPlanAction, "createdAt">,
): void {
  pendingMap.set(cardMessageId, {
    ...action,
    createdAt: Date.now(),
  });

  let sessionSet = sessionIndex.get(action.sessionKey);
  if (!sessionSet) {
    sessionSet = new Set();
    sessionIndex.set(action.sessionKey, sessionSet);
  }
  sessionSet.add(cardMessageId);
}

/**
 * Resolve (consume) a pending post-plan action.
 * Returns the stored context or undefined if not found / already consumed.
 */
export function resolvePendingPostPlanAction(
  cardMessageId: string,
): PendingPostPlanAction | undefined {
  const entry = pendingMap.get(cardMessageId);
  if (!entry) return undefined;

  pendingMap.delete(cardMessageId);

  const sessionSet = sessionIndex.get(entry.sessionKey);
  if (sessionSet) {
    sessionSet.delete(cardMessageId);
    if (sessionSet.size === 0) sessionIndex.delete(entry.sessionKey);
  }

  return entry;
}

export function hasPendingPostPlanAction(cardMessageId: string): boolean {
  return pendingMap.has(cardMessageId);
}

/**
 * Remove all pending post-plan actions for a session.
 * Called when the session is reset (/new) or a new message aborts the stream.
 */
export function removeAllPostPlanActionsForSession(
  sessionKey: string,
): number {
  const sessionSet = sessionIndex.get(sessionKey);
  if (!sessionSet || sessionSet.size === 0) return 0;

  let count = 0;
  for (const cardMsgId of [...sessionSet]) {
    if (pendingMap.has(cardMsgId)) {
      pendingMap.delete(cardMsgId);
      count++;
    }
  }
  sessionIndex.delete(sessionKey);
  return count;
}

export function pendingPostPlanActionCount(): number {
  return pendingMap.size;
}

export function stopPostPlanActionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
