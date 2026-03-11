/**
 * Per-request tool retry tracker.
 *
 * Tracks how many times each distinct `functionId` has failed during a
 * single chat turn (one `streamText` agentic loop). The counter is
 * created inside `handleChatRequest` and passed by reference to every
 * tool factory, so all tools share the same request-scoped state.
 *
 * The tracker is per-function-ID: if tool-A exhausts its retries,
 * tool-B still has its full budget.
 */
export class ToolRetryTracker {
  private counts = new Map<string, number>();

  /**
   * @param maxRetries - Maximum number of retry attempts allowed per
   *   function ID.  `0` means no retries (first failure is final).
   *   Default from the SDK mount params is `2`.
   */
  constructor(private readonly maxRetries: number) {}

  /**
   * Record a failure for `functionId`.
   *
   * @returns `true` if the function still has retries remaining after
   *   this failure, `false` if the retry budget is now exhausted.
   */
  recordFailure(functionId: string): boolean {
    const current = this.counts.get(functionId) ?? 0;
    const next = current + 1;
    this.counts.set(functionId, next);
    return next < this.maxRetries;
  }

  /**
   * The next attempt number (1-indexed) for display purposes.
   *
   * Before any failure → `1` (first attempt).
   * After one recorded failure → `2` (second attempt), etc.
   */
  getAttempt(functionId: string): number {
    return (this.counts.get(functionId) ?? 0) + 1;
  }

  /** The configured maximum number of retries. */
  get max(): number {
    return this.maxRetries;
  }
}
