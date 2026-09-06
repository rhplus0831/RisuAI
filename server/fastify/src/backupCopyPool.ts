import { Worker } from 'node:worker_threads'
import {
  BACKUP_COPY_BATCH_SIZE,
  BACKUP_COPY_CONCURRENCY,
  BACKUP_HASH_BUFFER_BYTES,
  BackupAssetError,
  type BackupCopyEntry,
  type BackupCopyFailure,
  type BackupCopyRequest,
  type BackupCopyResponse,
  type BackupCopyWorkerData,
} from './backupCopyProtocol.js'

function deserializeFailure(failure: BackupCopyFailure): Error {
  if (failure.code === 'backup_asset_invalid') return new BackupAssetError(failure.message)
  if (failure.name === 'AbortError') return new DOMException(failure.message, 'AbortError')
  return Object.assign(new Error(failure.message), { name: failure.name, code: failure.code })
}

interface WorkerSlot {
  worker: Worker
  ready: Promise<void>
  exited: Promise<void>
  didExit: boolean
  busy: boolean
  active?: Promise<void>
  settle?: { resolve(): void; reject(error: unknown): void }
}

/** One backup owns two native workers, each with at most one 16-file batch.
 * Admission never queues. close() waits for acknowledgements and actual exits;
 * workers are never terminated while a native filesystem call could be active. */
export class BackupCopyPool {
  private readonly slots: WorkerSlot[] = []
  private readonly cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  private failure: unknown
  private closing?: Promise<void>
  private readonly onAbort = () => this.abort()

  constructor(private readonly signal: AbortSignal) {
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.abort()
    try {
      for (let index = 0; index < BACKUP_COPY_CONCURRENCY; index++) this.slots.push(this.startWorker())
    } catch (error) {
      // Preserve a partially started pool so its owner can still await close.
      this.fail(error)
    }
  }

  private startWorker(): WorkerSlot {
    const worker = new Worker(new URL('./backupCopyWorker.ts', import.meta.url), {
      // Node >=24 executes this erasable TS entry directly. Inheriting tsx or
      // Vitest process flags would unnecessarily load application transforms.
      execArgv: [],
      workerData: {
        cancellation: this.cancellation.buffer,
        batchSize: BACKUP_COPY_BATCH_SIZE,
        hashBufferBytes: BACKUP_HASH_BUFFER_BYTES,
      } satisfies BackupCopyWorkerData,
    })
    let ready!: () => void
    let exited!: () => void
    const slot: WorkerSlot = {
      worker,
      ready: new Promise<void>((resolve) => (ready = resolve)),
      exited: new Promise<void>((resolve) => (exited = resolve)),
      didExit: false,
      busy: false,
    }
    worker.on('message', (response: BackupCopyResponse) => {
      if (response.kind === 'ready') ready()
      else if (response.error) slot.settle?.reject(deserializeFailure(response.error))
      else slot.settle?.resolve()
    })
    worker.on('error', (error) => {
      this.fail(error)
      ready()
      slot.settle?.reject(error)
    })
    worker.on('exit', (code) => {
      slot.didExit = true
      if (!this.closing || code !== 0) this.fail(new Error(`Backup copy worker exited unexpectedly (${code})`))
      ready()
      slot.settle?.reject(this.failure ?? new Error('Backup copy worker closed before acknowledging its batch'))
      exited()
    })
    return slot
  }

  private fail(error: unknown): void {
    this.failure ??= error
    this.abort()
  }

  abort(): void {
    Atomics.store(this.cancellation, 0, 1)
  }

  throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure
    this.signal.throwIfAborted()
  }

  async runBatch(entries: readonly BackupCopyEntry[]): Promise<void> {
    if (this.closing) throw new Error('backup_copy_pool_closed')
    if (entries.length > BACKUP_COPY_BATCH_SIZE) throw new Error('backup_copy_batch_limit_exceeded')
    if (this.failure !== undefined) throw this.failure
    this.signal.throwIfAborted()
    const slot = this.slots.find((candidate) => !candidate.busy && !candidate.didExit)
    if (!slot) throw new Error('backup_copy_pool_busy')
    slot.busy = true
    const operation = (async () => {
      await slot.ready
      if (this.failure !== undefined) throw this.failure
      this.signal.throwIfAborted()
      if (Atomics.load(this.cancellation, 0)) throw new DOMException('Backup copy cancelled', 'AbortError')
      await new Promise<void>((resolve, reject) => {
        slot.settle = { resolve, reject }
        slot.worker.postMessage({ kind: 'copy', entries } satisfies BackupCopyRequest)
      })
      this.signal.throwIfAborted()
    })()
    slot.active = operation.catch(() => undefined)
    try {
      await operation
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      slot.settle = undefined
      slot.busy = false
      slot.active = undefined
    }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.abort()
      this.closing = (async () => {
        await Promise.all(
          this.slots.map(async (slot) => {
            await slot.active
            if (!slot.didExit) slot.worker.postMessage({ kind: 'close' } satisfies BackupCopyRequest)
            await slot.exited
          }),
        )
        this.signal.removeEventListener('abort', this.onAbort)
      })()
    }
    return this.closing
  }
}
