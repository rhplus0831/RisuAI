import type { DatabaseSync } from 'node:sqlite'
import {
  claimNextMemoryJob,
  completeMemoryJob,
  listPendingMemoryJobChatIds,
  pruneTerminalMemoryJobs,
  recoverRunningMemoryJobs,
  retryOrFailMemoryJob,
  type MemoryJob,
  type MemoryJobKind,
  type PruneTerminalMemoryJobsOptions,
  type MemoryJobRetryOptions,
} from './memoryRepository.js'
import { buildMemoryJobEvent, emitMemoryEventSafely, type MemoryEventSink } from './memoryEvents.js'

export const MEMORY_WORKER_DEFAULT_POLL_INTERVAL_MS = 1_000
export const MEMORY_WORKER_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * Cap on the jobs a single batch-handler invocation may drain (the first
 * claimed job plus `claimNext` calls). Bounds one chat's batch so a long
 * imported-chat backlog neither materializes into one huge provider request
 * (audit M7) nor holds the single-flight worker for the whole backlog while
 * other chats wait (audit L17).
 */
export const MEMORY_JOB_BATCH_MAX_JOBS = 32

export type MemoryJobHandler = (job: MemoryJob) => void | Promise<void>

export type MemoryJobHandlers = {
  [K in MemoryJobKind]: MemoryJobHandler
}

export interface MemoryJobBatchHandlerContext {
  claimNext: (filter: { chatId?: string; kind?: MemoryJobKind }) => MemoryJob | null
  complete: (jobId: string) => MemoryJob | null
  retryOrFail: (jobId: string, error: string) => MemoryJob | null
}

export type MemoryJobBatchHandler = (
  firstJob: MemoryJob,
  context: MemoryJobBatchHandlerContext,
) => void | Promise<void>

export type MemoryJobBatchHandlers = Partial<Record<MemoryJobKind, MemoryJobBatchHandler>>

export interface MemoryWorkerOptions {
  db: DatabaseSync
  pollIntervalMs?: number
  handlers?: Partial<MemoryJobHandlers>
  batchHandlers?: MemoryJobBatchHandlers
  onEvent?: MemoryEventSink
  onError?: (error: unknown) => void
  retry?: MemoryJobRetryOptions
  terminalRetention?: false | (PruneTerminalMemoryJobsOptions & { intervalMs?: number })
}

export class MemoryWorker {
  private readonly db: DatabaseSync
  private readonly pollIntervalMs: number
  private readonly handlers: MemoryJobHandlers
  private readonly batchHandlers: MemoryJobBatchHandlers
  private readonly onEvent: MemoryEventSink | null
  private readonly onError: (error: unknown) => void
  private readonly retry: MemoryJobRetryOptions
  private readonly terminalRetention:
    | (PruneTerminalMemoryJobsOptions & { intervalMs: number })
    | null
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<boolean> | null = null
  private active = false
  private lastRetentionSweepAtMs = 0
  /** Per-chat serve recency for the round-robin claim (audit L17). */
  private readonly chatLastServedAt = new Map<string, number>()
  private serveSequence = 0

  constructor(opts: MemoryWorkerOptions) {
    this.db = opts.db
    this.pollIntervalMs = normalizePollIntervalMs(opts.pollIntervalMs)
    this.handlers = {
      chunk: noopMemoryJobHandler,
      embed: noopMemoryJobHandler,
      summarize: noopMemoryJobHandler,
      ...opts.handlers,
    }
    this.batchHandlers = opts.batchHandlers ?? {}
    this.onEvent = opts.onEvent ?? null
    this.onError = opts.onError ?? defaultMemoryWorkerErrorHandler
    this.retry = opts.retry ?? {}
    const terminalRetentionOptions =
      opts.terminalRetention === false ? null : (opts.terminalRetention ?? {})
    this.terminalRetention =
      terminalRetentionOptions === null
        ? null
        : {
            ...terminalRetentionOptions,
            intervalMs: normalizeRetentionSweepIntervalMs(terminalRetentionOptions.intervalMs),
          }
  }

  get isRunning(): boolean {
    return this.active
  }

  get isProcessing(): boolean {
    return this.inFlight !== null
  }

  start(): void {
    if (this.active) return
    for (const job of recoverRunningMemoryJobs(this.db, this.retry)) {
      this.emitJob(job)
    }
    this.runRetentionSweep()
    this.active = true
    this.schedule(0)
  }

  async stop(): Promise<void> {
    if (!this.active && this.timer === null && this.inFlight === null) return
    this.active = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inFlight) {
      await this.inFlight
    }
  }

  async tick(): Promise<boolean> {
    if (this.inFlight) return false
    this.maybeRunRetentionSweep()
    const task = this.processOne()
    this.inFlight = task
    try {
      return await task
    } finally {
      this.inFlight = null
    }
  }

  private schedule(delayMs: number): void {
    if (!this.active || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
        .catch((error) => {
          this.onError(error)
          return false
        })
        .finally(() => {
          this.schedule(this.pollIntervalMs)
        })
    }, delayMs)
    this.timer.unref()
  }

  /**
   * Round-robin claim across chats (audit L17): serve the pending chat that
   * was served least recently, so one chat's long embed/summarize backlog
   * cannot starve other chats' jobs. Never-served chats keep their FIFO order
   * (oldest pending job first), which preserves the single-chat behavior.
   */
  private claimNextJobFairly(): MemoryJob | null {
    const pendingChatIds = listPendingMemoryJobChatIds(
      this.db,
      this.retry.now === undefined ? {} : { now: this.retry.now },
    )
    if (pendingChatIds.length === 0) return null

    // Drop chats with nothing pending so the recency map stays bounded.
    const live = new Set(pendingChatIds)
    for (const chatId of [...this.chatLastServedAt.keys()]) {
      if (!live.has(chatId)) this.chatLastServedAt.delete(chatId)
    }

    let pick = pendingChatIds[0]
    let pickServedAt = this.chatLastServedAt.get(pick) ?? 0
    for (const chatId of pendingChatIds) {
      const servedAt = this.chatLastServedAt.get(chatId) ?? 0
      if (servedAt < pickServedAt) {
        pick = chatId
        pickServedAt = servedAt
      }
    }

    const job = claimNextMemoryJob(
      this.db,
      this.retry.now === undefined ? { chatId: pick } : { chatId: pick, now: this.retry.now },
    )
    if (job) this.chatLastServedAt.set(pick, ++this.serveSequence)
    return job
  }

  private async processOne(): Promise<boolean> {
    const job = this.claimNextJobFairly()
    if (!job) return false
    this.emitJob(job)

    try {
      const batchHandler = this.batchHandlers[job.kind]
      if (batchHandler) {
        await batchHandler(job, {
          claimNext: (filter) => {
            const claimed =
              this.retry.now === undefined
                ? claimNextMemoryJob(this.db, filter)
                : claimNextMemoryJob(this.db, { ...filter, now: this.retry.now })
            if (claimed) this.emitJob(claimed)
            return claimed
          },
          complete: (jobId) => {
            const completed = completeMemoryJob(this.db, jobId)
            if (completed) this.emitJob(completed)
            return completed
          },
          retryOrFail: (jobId, error) => {
            const failedOrRetried = retryOrFailMemoryJob(this.db, jobId, error, this.retry)
            if (failedOrRetried) this.emitJob(failedOrRetried)
            return failedOrRetried
          },
        })
        return true
      }

      await this.handlers[job.kind](job)
      const completed = completeMemoryJob(this.db, job.id)
      if (completed) {
        this.emitJob(completed)
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error)
      const failedOrRetried = retryOrFailMemoryJob(
        this.db,
        job.id,
        message || 'memory job handler failed',
        this.retry,
      )
      if (failedOrRetried) {
        this.emitJob(failedOrRetried)
      }
    }
    return true
  }

  private maybeRunRetentionSweep(): void {
    if (!this.terminalRetention) return
    const nowMs = Date.now()
    if (nowMs - this.lastRetentionSweepAtMs < this.terminalRetention.intervalMs) return
    this.runRetentionSweep(nowMs)
  }

  private runRetentionSweep(nowMs = Date.now()): void {
    if (!this.terminalRetention) return
    try {
      pruneTerminalMemoryJobs(this.db, this.terminalRetention)
      this.lastRetentionSweepAtMs = nowMs
    } catch (error) {
      this.onError(error)
    }
  }

  private emitJob(job: MemoryJob): void {
    if (!this.onEvent) return
    emitMemoryEventSafely(this.onEvent, buildMemoryJobEvent(job, { includeHypaV3Progress: true }))
  }
}

function normalizePollIntervalMs(value: number | undefined): number {
  if (value === undefined) return MEMORY_WORKER_DEFAULT_POLL_INTERVAL_MS
  if (!Number.isFinite(value) || value < 0) return MEMORY_WORKER_DEFAULT_POLL_INTERVAL_MS
  return Math.floor(value)
}

function normalizeRetentionSweepIntervalMs(value: number | undefined): number {
  if (value === undefined) return MEMORY_WORKER_RETENTION_SWEEP_INTERVAL_MS
  if (!Number.isFinite(value) || value < 0) return MEMORY_WORKER_RETENTION_SWEEP_INTERVAL_MS
  return Math.floor(value)
}

function noopMemoryJobHandler(): void {
  // Stub dispatch only; memory mutation is supplied by concrete handlers.
}

function defaultMemoryWorkerErrorHandler(error: unknown): void {
  console.error('memory worker failed', error)
}
