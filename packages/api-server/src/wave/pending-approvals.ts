/**
 * Pending plan-approval store for Wave interactive executePlan cards.
 *
 * Mirrors the pending-selections flow: when the Wave-native executePlan tool
 * sends an approval card, we keep a pending entry keyed by the card message ID.
 * The Wave card reaction callback resolves approve / deny, which unblocks the
 * tool's execute() Promise and lets the plan continue or stop.
 */

export const PLAN_APPROVAL_ACTION = {
  APPROVE: "approve",
  DENY: "deny",
} as const;

export type PlanApprovalAction =
  (typeof PLAN_APPROVAL_ACTION)[keyof typeof PLAN_APPROVAL_ACTION];

export interface PendingPlanStep {
  functionId: string;
  title: string;
  arguments: Record<string, any>;
}

export interface PendingPlanApproval {
  resolve: (decision: PlanApprovalAction) => void;
  reject: (reason: Error) => void;
  sessionKey: string;
  intent: string;
  steps: PendingPlanStep[];
  createdAt: number;
}

const pendingMap = new Map<string, PendingPlanApproval>();
const sessionIndex = new Map<string, Set<string>>();

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [cardMsgId, entry] of pendingMap) {
      if (now - entry.createdAt > APPROVAL_TIMEOUT_MS) {
        pendingMap.delete(cardMsgId);
        const sessionSet = sessionIndex.get(entry.sessionKey);
        if (sessionSet) {
          sessionSet.delete(cardMsgId);
          if (sessionSet.size === 0) sessionIndex.delete(entry.sessionKey);
        }
        entry.reject(
          new Error("Plan approval timed out (10 minute safety limit)"),
        );
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

startCleanup();

function removeFromIndexes(cardMessageId: string): PendingPlanApproval | undefined {
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

export function addPendingPlanApproval(
  cardMessageId: string,
  payload: { intent: string; steps: PendingPlanStep[] },
  sessionKey: string,
): Promise<PlanApprovalAction> {
  const existing = removeFromIndexes(cardMessageId);
  if (existing) {
    existing.reject(new Error("Replaced by a new pending plan approval"));
  }

  return new Promise<PlanApprovalAction>((resolve, reject) => {
    pendingMap.set(cardMessageId, {
      resolve,
      reject,
      sessionKey,
      intent: payload.intent,
      steps: payload.steps,
      createdAt: Date.now(),
    });

    let sessionSet = sessionIndex.get(sessionKey);
    if (!sessionSet) {
      sessionSet = new Set();
      sessionIndex.set(sessionKey, sessionSet);
    }
    sessionSet.add(cardMessageId);
  });
}

export function resolvePendingPlanApproval(
  cardMessageId: string,
  decision: PlanApprovalAction,
): PendingPlanApproval | undefined {
  const entry = removeFromIndexes(cardMessageId);
  if (!entry) return undefined;

  entry.resolve(decision);
  return entry;
}

export function removePendingPlanApproval(
  cardMessageId: string,
  reason = "Plan approval cancelled",
): boolean {
  const entry = removeFromIndexes(cardMessageId);
  if (!entry) return false;

  entry.reject(new Error(reason));
  return true;
}

export function removeAllPlanApprovalsForSession(
  sessionKey: string,
  reason = "Session plan approval cancelled",
): number {
  const sessionSet = sessionIndex.get(sessionKey);
  if (!sessionSet || sessionSet.size === 0) return 0;

  let count = 0;
  for (const cardMsgId of [...sessionSet]) {
    const entry = pendingMap.get(cardMsgId);
    if (entry) {
      pendingMap.delete(cardMsgId);
      entry.reject(new Error(reason));
      count++;
    }
  }
  sessionIndex.delete(sessionKey);
  return count;
}

export function hasPendingPlanApproval(cardMessageId: string): boolean {
  return pendingMap.has(cardMessageId);
}

export function pendingPlanApprovalCount(): number {
  return pendingMap.size;
}

export function stopPlanApprovalCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
