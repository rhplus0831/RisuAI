import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { Readable } from 'node:stream'
import { bufferToBodyInit, filterResponseHeaders, normalizeForwardHeaders } from './proxy.js'
import { STREAM_CLIENT_MAX_BUFFERED_BYTES } from './streamBackpressure.js'
import {
  SHARED_DEFAULT_REQUEST_TIMEOUT_MS,
  SHARED_MAX_REQUEST_TIMEOUT_MS,
} from './requestTimeouts.js'

export const PROXY_STREAM_DEFAULT_TIMEOUT_MS = SHARED_DEFAULT_REQUEST_TIMEOUT_MS
export const PROXY_STREAM_MAX_TIMEOUT_MS = SHARED_MAX_REQUEST_TIMEOUT_MS
export const PROXY_STREAM_DEFAULT_HEARTBEAT_SEC = 15
export const PROXY_STREAM_HEARTBEAT_MIN_SEC = 5
export const PROXY_STREAM_HEARTBEAT_MAX_SEC = 60
export const PROXY_STREAM_GC_INTERVAL_MS = 60_000
export const PROXY_STREAM_DONE_GRACE_MS = 30_000
export const PROXY_STREAM_MAX_ACTIVE_JOBS = 64
export const PROXY_STREAM_MAX_PENDING_EVENTS = 512
export const PROXY_STREAM_MAX_PENDING_BYTES = 2 * 1024 * 1024
export const PROXY_STREAM_MAX_BODY_BASE64_BYTES = 8 * 1024 * 1024

export type StreamJobEvent =
  | { type: 'job_accepted'; jobId: string }
  | {
      type: 'upstream_headers'
      status: number
      headers: Record<string, string>
    }
  | { type: 'chunk'; dataBase64: string }
  | { type: 'done' }
  | { type: 'error'; status: number; message: string }
  | { type: 'ping'; ts: number }

export interface JobClient {
  send(text: string): void
  close(): void
  readonly open: boolean
  readonly bufferedBytes?: number
}

export interface StreamJob {
  id: string
  createdAt: number
  updatedAt: number
  done: boolean
  cleanupAt: number
  clients: Set<JobClient>
  pendingEvents: string[]
  pendingBytes: number
  replayEvents?: string[]
  replayBytes?: number
  abortController: AbortController
  deadlineAt: number
  heartbeatSec: number
  timeoutMs: number
  slidingDeadline: boolean
  /**
   * Durable-generation extensions. Unused by the proxy stream job. `chatId` ties
   * the job to its chat for the one-job-per-chat submission lock and reload-resume
   * projection. `writerSessionId` records the active-writer identity present at
   * submission for diagnostics; completion does not re-check it because the job was
   * already authorized at submission.
   *
   * `mode` / `regenerateMessageId` ride the `activeGenerationJobs` projection so
   * a reloaded browser can reattach with the right generating mode.
   */
  chatId?: string
  writerSessionId?: string | null
  mode?: 'send' | 'continue' | 'regenerate'
  regenerateMessageId?: string
  /**
   * Set when no-viewer pending frames were dropped at the cap (audit L15). The
   * buffered prefix is gone, so a late viewer could never see a coherent
   * stream — the proxy runner aborts the upstream instead of draining the rest
   * of the response into a lossy window. Never set for durable jobs (their
   * replay buffer takes the no-client frames).
   */
  pendingOverflow?: boolean
}

const DURABLE_REPLAY_PROTECTED_EVENTS = new Set([
  'prompt',
  'info',
  'message_patch',
  'side_effect',
  'warning',
  'error',
  'done',
])

const PRIVATE_BLOCKS = (() => {
  const list = new net.BlockList()
  list.addRange('10.0.0.0', '10.255.255.255', 'ipv4')
  list.addRange('127.0.0.0', '127.255.255.255', 'ipv4')
  list.addRange('172.16.0.0', '172.31.255.255', 'ipv4')
  list.addRange('192.168.0.0', '192.168.255.255', 'ipv4')
  list.addRange('169.254.0.0', '169.254.255.255', 'ipv4')
  list.addRange('0.0.0.0', '0.255.255.255', 'ipv4')
  list.addAddress('::1', 'ipv6')
  list.addRange('fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  list.addRange('fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  // IPv4-mapped IPv6 forms of the private ranges (covers both the
  // ::ffff:10.0.0.1 dotted and ::ffff:a00:1 hex canonical notations).
  list.addRange('::ffff:10.0.0.0', '::ffff:10.255.255.255', 'ipv6')
  list.addRange('::ffff:127.0.0.0', '::ffff:127.255.255.255', 'ipv6')
  list.addRange('::ffff:172.16.0.0', '::ffff:172.31.255.255', 'ipv6')
  list.addRange('::ffff:192.168.0.0', '::ffff:192.168.255.255', 'ipv6')
  list.addRange('::ffff:169.254.0.0', '::ffff:169.254.255.255', 'ipv6')
  list.addRange('::ffff:0.0.0.0', '::ffff:0.255.255.255', 'ipv6')
  return list
})()

function isLocalNetworkHost(hostname: string): boolean {
  if (typeof hostname !== 'string' || hostname.trim() === '') return false
  let normalized = hostname.toLowerCase().replace(/\.$/, '').split('%')[0]
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  if (normalized === 'localhost' || normalized.endsWith('.local')) {
    return true
  }
  const family = net.isIP(normalized)
  if (family === 4) return PRIVATE_BLOCKS.check(normalized, 'ipv4')
  if (family === 6) return PRIVATE_BLOCKS.check(normalized, 'ipv6')
  return false
}

export function sanitizeLocalTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!isLocalNetworkHost(parsed.hostname)) return null
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return null
  }
}

export function normalizeStreamTimeoutMs(raw: unknown): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return PROXY_STREAM_DEFAULT_TIMEOUT_MS
  const floored = Math.max(1, Math.floor(value))
  return Math.min(PROXY_STREAM_MAX_TIMEOUT_MS, floored)
}

export function normalizeHeartbeatSec(raw: unknown): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw)
  if (!Number.isFinite(value)) return PROXY_STREAM_DEFAULT_HEARTBEAT_SEC
  return Math.min(
    PROXY_STREAM_HEARTBEAT_MAX_SEC,
    Math.max(PROXY_STREAM_HEARTBEAT_MIN_SEC, Math.floor(value)),
  )
}

export interface CreateJobOptions {
  timeoutMs: unknown
  heartbeatSec: unknown
  slidingDeadline?: boolean
  now?: number
}

function serializedSseEventType(text: string): string | undefined {
  const firstLineEnd = text.search(/\r?\n/)
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  return firstLine.startsWith('event: ') ? firstLine.slice('event: '.length).trim() : undefined
}

function serializedSseData(text: string): unknown {
  const data = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n')
  if (data.length === 0) return undefined
  try {
    return JSON.parse(data) as unknown
  } catch {
    return undefined
  }
}

export function isStreamDeadlineActivityFrame(text: string): boolean {
  const type = serializedSseEventType(text)
  if (!type || type === 'done' || type === 'error') return false
  if (type !== 'token') return true
  const data = serializedSseData(text)
  if (!data || typeof data !== 'object') return false
  const content = (data as { content?: unknown }).content
  return typeof content === 'string' && content.length > 0
}

function removeReplayFrame(job: StreamJob, index: number): void {
  if (!job.replayEvents || job.replayBytes === undefined) return
  const [removed] = job.replayEvents.splice(index, 1)
  if (removed) job.replayBytes -= Buffer.byteLength(removed)
}

function appendDurableReplayFrame(job: StreamJob, text: string): void {
  if (!job.replayEvents || job.replayBytes === undefined) return
  const type = serializedSseEventType(text)
  if (type === 'info') {
    const existingInfoIndex = job.replayEvents.findIndex(
      (event) => serializedSseEventType(event) === 'info',
    )
    if (existingInfoIndex !== -1) removeReplayFrame(job, existingInfoIndex)
  }
  job.replayEvents.push(text)
  job.replayBytes += Buffer.byteLength(text)

  while (
    job.replayEvents.length > PROXY_STREAM_MAX_PENDING_EVENTS ||
    job.replayBytes > PROXY_STREAM_MAX_PENDING_BYTES
  ) {
    const droppableIndex = job.replayEvents.findIndex((event) => {
      const eventType = serializedSseEventType(event)
      return !eventType || !DURABLE_REPLAY_PROTECTED_EVENTS.has(eventType)
    })
    if (droppableIndex === -1) break
    removeReplayFrame(job, droppableIndex)
  }
}

function closeJobClient(client: JobClient): void {
  try {
    client.close()
  } catch {
    // ignore
  }
}

function sendBoundedJobClient(client: JobClient, text: string): boolean {
  if (!client.open) return false
  const bufferedBytes =
    typeof client.bufferedBytes === 'number' ? Math.max(0, client.bufferedBytes) : 0
  if (bufferedBytes + Buffer.byteLength(text) > STREAM_CLIENT_MAX_BUFFERED_BYTES) {
    closeJobClient(client)
    return false
  }
  try {
    client.send(text)
  } catch {
    closeJobClient(client)
    return false
  }
  return client.open
}

export class JobRegistry {
  private readonly jobs = new Map<string, StreamJob>()

  size(): number {
    return this.jobs.size
  }

  has(id: string): boolean {
    return this.jobs.has(id)
  }

  get(id: string): StreamJob | undefined {
    return this.jobs.get(id)
  }

  list(): StreamJob[] {
    return Array.from(this.jobs.values())
  }

  create(opts: CreateJobOptions): StreamJob {
    const timeoutMs = normalizeStreamTimeoutMs(opts.timeoutMs)
    const heartbeatSec = normalizeHeartbeatSec(opts.heartbeatSec)
    const createdAt = opts.now ?? Date.now()
    const job: StreamJob = {
      id: randomUUID(),
      createdAt,
      updatedAt: createdAt,
      done: false,
      cleanupAt: 0,
      clients: new Set(),
      pendingEvents: [],
      pendingBytes: 0,
      abortController: new AbortController(),
      deadlineAt: createdAt + timeoutMs,
      heartbeatSec,
      timeoutMs,
      slidingDeadline: opts.slidingDeadline === true,
    }
    this.jobs.set(job.id, job)
    return job
  }

  refreshDeadline(job: StreamJob, now?: number): void {
    if (job.done || job.abortController.signal.aborted) return
    const t = now ?? Date.now()
    job.updatedAt = t
    job.deadlineAt = t + job.timeoutMs
  }

  enableReplay(job: StreamJob): void {
    job.replayEvents = []
    job.replayBytes = 0
  }

  /**
   * Buffer (no client attached) or fan out an **already-serialized** frame
   * string. Generalizes {@link pushEvent} so the durable-generation runner can
   * buffer pre-formatted SSE frames (`event: …\ndata: …\n\n`) and replay them on
   * reattach without re-encoding — preserving the locked `/generate/chat` event
   * vocabulary and the browser's SSE parser unchanged. The proxy keeps the
   * `pushEvent` (JSON.stringify) path.
   */
  pushRaw(job: StreamJob, text: string, now?: number): void {
    const t = now ?? Date.now()
    job.updatedAt = t
    if (job.slidingDeadline && isStreamDeadlineActivityFrame(text)) {
      this.refreshDeadline(job, t)
    }
    appendDurableReplayFrame(job, text)
    if (job.clients.size === 0) {
      if (job.replayEvents) return
      job.pendingEvents.push(text)
      job.pendingBytes += Buffer.byteLength(text)
      while (
        job.pendingEvents.length > PROXY_STREAM_MAX_PENDING_EVENTS ||
        job.pendingBytes > PROXY_STREAM_MAX_PENDING_BYTES
      ) {
        const removed = job.pendingEvents.shift()
        if (!removed) break
        job.pendingBytes -= Buffer.byteLength(removed)
        job.pendingOverflow = true
      }
      return
    }
    const staleClients: JobClient[] = []
    for (const client of job.clients) {
      if (!sendBoundedJobClient(client, text)) {
        staleClients.push(client)
      }
    }
    for (const client of staleClients) {
      this.detach(job.id, client)
    }
  }

  pushEvent(job: StreamJob, event: StreamJobEvent, now?: number): void {
    this.pushRaw(job, JSON.stringify(event), now)
  }

  attach(jobId: string, client: JobClient): StreamJob | null {
    const job = this.jobs.get(jobId)
    if (!job) return null
    job.clients.add(client)
    const replayEvents = job.replayEvents ?? job.pendingEvents
    let clientOpen = true
    for (const text of replayEvents) {
      if (!sendBoundedJobClient(client, text)) {
        clientOpen = false
        break
      }
    }
    if (!clientOpen) {
      this.detach(job.id, client)
      return job
    }
    if (!job.replayEvents) {
      job.pendingEvents = []
      job.pendingBytes = 0
    }
    return job
  }

  detach(jobId: string, client: JobClient): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.clients.delete(client)
    if (job.done && job.clients.size === 0) {
      this.cleanup(jobId)
    }
  }

  markDone(job: StreamJob, now?: number): void {
    if (job.done) return
    job.done = true
    job.cleanupAt = (now ?? Date.now()) + PROXY_STREAM_DONE_GRACE_MS
  }

  cleanup(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    for (const client of job.clients) {
      try {
        client.close()
      } catch {
        // ignore
      }
    }
    this.jobs.delete(jobId)
  }

  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    job.abortController.abort()
    this.markDone(job)
    this.cleanup(jobId)
    return true
  }

  tickGc(now?: number): void {
    const t = now ?? Date.now()
    for (const [jobId, job] of this.jobs.entries()) {
      if (!job.done && t >= job.deadlineAt && !job.abortController.signal.aborted) {
        job.abortController.abort()
      }
      if (job.done && job.clients.size === 0 && job.cleanupAt > 0 && t >= job.cleanupAt) {
        this.cleanup(jobId)
        continue
      }
      if (
        !job.done &&
        t - job.updatedAt >
          Math.max(PROXY_STREAM_DEFAULT_TIMEOUT_MS, job.timeoutMs * 2)
      ) {
        this.cleanup(jobId)
      }
    }
  }
}

export interface RunStreamJobArg {
  targetUrl: string
  method: string
  headers: Record<string, string>
  bodyBuffer?: Buffer
  clientIp: string
}

export async function runStreamJob(
  registry: JobRegistry,
  job: StreamJob,
  arg: RunStreamJobArg,
): Promise<void> {
  const targetUrl = sanitizeLocalTargetUrl(arg.targetUrl)
  if (!targetUrl) {
    registry.pushEvent(job, {
      type: 'error',
      status: 400,
      message: 'Blocked non-local target URL',
    })
    registry.markDone(job)
    return
  }

  const headers = normalizeForwardHeaders(arg.headers)
  if (!headers['x-forwarded-for']) {
    headers['x-forwarded-for'] = arg.clientIp
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: arg.method,
      headers,
      body: arg.bodyBuffer ? bufferToBodyInit(arg.bodyBuffer) : undefined,
      signal: job.abortController.signal,
    })

    registry.pushEvent(job, {
      type: 'upstream_headers',
      status: upstream.status,
      headers: filterResponseHeaders(upstream.headers),
    })

    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0],
      )
      for await (const value of stream) {
        if (job.abortController.signal.aborted) break
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
        if (chunk.length > 0) {
          registry.pushEvent(job, {
            type: 'chunk',
            dataBase64: chunk.toString('base64'),
          })
        }
        // No-viewer buffer overflow (audit L15): the pending window already
        // dropped frames, so any future viewer would see a corrupt stream.
        // Stop consuming the upstream instead of pulling the whole response
        // through a lossy 2 MB window until the deadline.
        if (job.pendingOverflow && job.clients.size === 0) {
          job.abortController.abort()
          registry.pushEvent(job, {
            type: 'error',
            status: 503,
            message: 'Proxy stream buffer overflowed with no attached viewer',
          })
          registry.markDone(job)
          return
        }
      }
    }

    registry.pushEvent(job, { type: 'done' })
    registry.markDone(job)
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    const message =
      name === 'AbortError' ? 'Proxy stream job aborted' : `${err}`
    registry.pushEvent(job, { type: 'error', status: 504, message })
    registry.markDone(job)
  }
}
