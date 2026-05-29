import { JobRegistry, type StreamJob } from './streamJobs.js'

/**
 * Durable-generation job registry (Milestone 1 — survive client disconnect).
 *
 * Wraps the proxy's reconnectable {@link JobRegistry} with the two primitives
 * durable generation adds:
 *
 * 1. a transient **`chatId → jobId` index** for the *running* job per chat — the
 *    submission lock ("one running job per chat"), cleared at completion/cancel
 *    (not at GC) so the user's next send isn't blocked during the 30s reattach
 *    grace; and
 * 2. an **`activeGenerationJobs` projection** surfaced by bootstrap so a returning
 *    client — even after a full reload — discovers and reattaches to a running
 *    generation.
 *
 * In-memory only (no `db.json`): a chat generation is short-lived, so surviving a
 * server *restart* is deferred to Milestone 2. Separate from the proxy's registry
 * instance — generation jobs and proxy stream jobs never share state.
 */
export class GenerationJobRegistry {
  readonly registry = new JobRegistry()
  private readonly runningByChat = new Map<string, string>()

  /**
   * The currently *running* (not done) job for a chat, if any. A done-but-not-yet
   * GC'd job does not count — the submission lock releases at completion so the
   * next send is accepted during the reattach grace.
   */
  runningJobForChat(chatId: string): StreamJob | undefined {
    const jobId = this.runningByChat.get(chatId)
    if (!jobId) return undefined
    const job = this.registry.get(jobId)
    if (!job || job.done) {
      // Stale index entry (job GC'd, or done and not yet cleared): prune + report free.
      this.runningByChat.delete(chatId)
      return undefined
    }
    return job
  }

  hasRunningJob(chatId: string): boolean {
    return this.runningJobForChat(chatId) !== undefined
  }

  /** Claim the submission lock for `chatId` with the freshly created job. */
  register(chatId: string, jobId: string): void {
    this.runningByChat.set(chatId, jobId)
  }

  /**
   * Release the submission lock at completion/cancel. Guarded on the jobId so a
   * stale clear (from a job that already lost the slot to a newer one) is a no-op.
   */
  clearRunning(chatId: string, jobId: string): void {
    if (this.runningByChat.get(chatId) === jobId) {
      this.runningByChat.delete(chatId)
    }
  }

  /**
   * The transient projection for bootstrap: the chats with a *running* job. Shaped
   * `{ chatId, jobId }` so the wire shape is explicit and does not collide with
   * persisted `database` fields. Done / GC'd jobs are filtered out.
   */
  activeJobs(): Array<{ chatId: string; jobId: string }> {
    const out: Array<{ chatId: string; jobId: string }> = []
    for (const [chatId, jobId] of this.runningByChat.entries()) {
      const job = this.registry.get(jobId)
      if (job && !job.done) out.push({ chatId, jobId })
    }
    return out
  }

  /** Tick the underlying GC and prune index entries whose job is done / gone. */
  tickGc(now?: number): void {
    this.registry.tickGc(now)
    for (const [chatId, jobId] of this.runningByChat.entries()) {
      const job = this.registry.get(jobId)
      if (!job || job.done) this.runningByChat.delete(chatId)
    }
  }
}
