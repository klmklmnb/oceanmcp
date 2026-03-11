/**
 * Pending user-selection store for Wave interactive cards.
 *
 * When the LLM calls `userSelect`, we send an interactive card (buttons or
 * dropdown) and store a pending entry keyed by the card's message ID.  When
 * the user clicks an option, Wave fires an `EventMsgCardReaction` whose
 * `open_msg_id` lets us look up and resolve the corresponding Promise so
 * the tool's `execute()` can return the selected value to the LLM.
 *
 * Robustness features:
 *   - Session reverse index: enables bulk cleanup when a user sends a new
 *     message (aborting the old stream) or when a session expires.
 *   - Safety-net timeout: pending entries older than SELECTION_TIMEOUT_MS
 *     are automatically rejected so leaked resources are freed.
 */

export interface PendingSelectionOption {
  value: string;
  label?: string;
}

export interface PendingSelection {
  /** Resolves the tool execute() Promise with the selected value. */
  resolve: (value: string) => void;
  /** Rejects the tool execute() Promise (e.g. card deleted). */
  reject: (reason: Error) => void;
  /** The options presented to the user — for label lookup. */
  options: PendingSelectionOption[];
  /** Session key — for reverse lookup and logging. */
  sessionKey: string;
  /** Timestamp when the selection was created. */
  createdAt: number;
}

// ── Primary index: cardMessageId → PendingSelection ──────────────────────────

const pendingMap = new Map<string, PendingSelection>();

// ── Reverse index: sessionKey → Set<cardMessageId> ──────────────────────────

const sessionIndex = new Map<string, Set<string>>();

// ── Safety-net timeout ──────────────────────────────────────────────────────

/** Pending selections older than this are auto-rejected. */
const SELECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** How often to sweep for stale entries. */
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [cardMsgId, entry] of pendingMap) {
      if (now - entry.createdAt > SELECTION_TIMEOUT_MS) {
        // Remove from both indexes
        pendingMap.delete(cardMsgId);
        const sessionSet = sessionIndex.get(entry.sessionKey);
        if (sessionSet) {
          sessionSet.delete(cardMsgId);
          if (sessionSet.size === 0) sessionIndex.delete(entry.sessionKey);
        }
        // Reject the Promise
        entry.reject(
          new Error("Selection timed out (10 minute safety limit)"),
        );
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent process exit
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

// Start cleanup sweep on module load
startCleanup();

// ── Helper: remove a single entry from both indexes ─────────────────────────

function removeFromIndexes(cardMessageId: string): PendingSelection | undefined {
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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a pending selection for a card message.
 *
 * @returns A Promise that resolves with the selected `value` string
 *          when the user clicks a button / dropdown option.
 */
export function addPendingSelection(
  cardMessageId: string,
  options: PendingSelectionOption[],
  sessionKey: string,
): Promise<string> {
  // If there was already a pending entry for this card (shouldn't happen),
  // reject the old one first.
  const existing = removeFromIndexes(cardMessageId);
  if (existing) {
    existing.reject(new Error("Replaced by a new pending selection"));
  }

  return new Promise<string>((resolve, reject) => {
    pendingMap.set(cardMessageId, {
      resolve,
      reject,
      options,
      sessionKey,
      createdAt: Date.now(),
    });

    // Add to session reverse index
    let sessionSet = sessionIndex.get(sessionKey);
    if (!sessionSet) {
      sessionSet = new Set();
      sessionIndex.set(sessionKey, sessionSet);
    }
    sessionSet.add(cardMessageId);
  });
}

/**
 * Resolve a pending selection when the card reaction callback arrives.
 *
 * @param cardMessageId - The `open_msg_id` from `EventMsgCardReaction`.
 * @param selectedValue - The first value from `action.values`.
 * @returns The pending entry (for logging / card update), or `undefined`
 *          if no pending selection was found for this card.
 */
export function resolvePendingSelection(
  cardMessageId: string,
  selectedValue: string,
): PendingSelection | undefined {
  const entry = removeFromIndexes(cardMessageId);
  if (!entry) return undefined;

  entry.resolve(selectedValue);
  return entry;
}

/**
 * Remove and reject a pending selection (e.g. when the session is cleared).
 */
export function removePendingSelection(
  cardMessageId: string,
  reason = "Selection cancelled",
): boolean {
  const entry = removeFromIndexes(cardMessageId);
  if (!entry) return false;

  entry.reject(new Error(reason));
  return true;
}

/**
 * Remove and reject ALL pending selections for a given session.
 *
 * Called when the user sends a new message (aborting the old stream)
 * or when a session is cleared/expired.
 *
 * @returns The number of pending selections that were removed.
 */
export function removeAllForSession(
  sessionKey: string,
  reason = "Session selection cancelled",
): number {
  const sessionSet = sessionIndex.get(sessionKey);
  if (!sessionSet || sessionSet.size === 0) return 0;

  let count = 0;
  // Copy to array to avoid mutation during iteration
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

/**
 * Check whether a card message has a pending selection.
 */
export function hasPendingSelection(cardMessageId: string): boolean {
  return pendingMap.has(cardMessageId);
}

/**
 * Get the current number of pending selections (for debugging).
 */
export function pendingSelectionCount(): number {
  return pendingMap.size;
}

/**
 * Stop the cleanup timer (for tests / shutdown).
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
