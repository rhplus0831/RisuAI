import type { DatabaseSync } from 'node:sqlite'
import {
  claimNextMemoryJob,
  completeMemoryJob,
  recoverRunningMemoryJobs,
  retryOrFailMemoryJob,
  type MemoryJob,
  type MemoryJobKind,
  type MemoryJobRetryOptions,
} from './memoryRepository.js'
import { buildMemoryJobEvent, emitMemoryEventSafely, type MemoryEventSink } from './memoryEvents.js'

export const MEMORY_WORKER_DEFAULT_POLL_INTERVAL_MS = 1_000

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
}

export class MemoryWorker {
  private readonly db: DatabaseSync
  private readonly pollIntervalMs: number
  private readonly handlers: MemoryJobHandlers
  private readonly batchHandlers: MemoryJobBatchHandlers
  private readonly onEvent: MemoryEventSink | null
  private readonly onError: (error: unknown) => void
  private readonly retry: MemoryJobRetryOptions
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<boolean> | null = null
  private active = false

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

  private async processOne(): Promise<boolean> {
    const job =
      this.retry.now === undefined
        ? claimNextMemoryJob(this.db)
        : claimNextMemoryJob(this.db, { now: this.retry.now })
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

function noopMemoryJobHandler(): void {
  // Stub dispatch only; memory mutation is supplied by concrete handlers.
}

function defaultMemoryWorkerErrorHandler(error: unknown): void {
  console.error('memory worker failed', error)
}
