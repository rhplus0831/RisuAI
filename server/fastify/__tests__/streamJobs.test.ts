import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JobRegistry,
  PROXY_STREAM_DEFAULT_HEARTBEAT_SEC,
  PROXY_STREAM_DEFAULT_TIMEOUT_MS,
  PROXY_STREAM_DONE_GRACE_MS,
  PROXY_STREAM_HEARTBEAT_MAX_SEC,
  PROXY_STREAM_HEARTBEAT_MIN_SEC,
  PROXY_STREAM_MAX_PENDING_BYTES,
  PROXY_STREAM_MAX_PENDING_EVENTS,
  PROXY_STREAM_MAX_TIMEOUT_MS,
  type JobClient,
  type StreamJobFrame,
  type StreamJob,
  isStreamDeadlineActivityFrame,
  normalizeHeartbeatSec,
  normalizeStreamTimeoutMs,
  runStreamJob,
  sanitizeLocalTargetUrl,
} from '../src/streamJobs.js'
import { STREAM_CLIENT_MAX_BUFFERED_BYTES } from '../src/streamBackpressure.js'

interface FakeClient extends JobClient {
  messages: StreamJobFrame[]
  closed: boolean
}

function fakeClient(opts: { bufferedBytes?: number } = {}): FakeClient {
  const messages: StreamJobFrame[] = []
  let openFlag = true
  return {
    messages,
    get bufferedBytes() {
      return opts.bufferedBytes ?? 0
    },
    get open() {
      return openFlag
    },
    get closed() {
      return !openFlag
    },
    send(frame) {
      if (openFlag) messages.push(frame)
    },
    close() {
      openFlag = false
    },
  }
}

function jsonMessages(client: FakeClient): unknown[] {
  return client.messages
    .filter((message): message is string => typeof message === 'string')
    .map((message) => JSON.parse(message) as unknown)
}

function binaryMessages(client: FakeClient): Buffer[] {
  return client.messages
    .filter((message): message is Buffer => Buffer.isBuffer(message))
    .map((message) => Buffer.from(message))
}

function lastJsonFrame(frames: readonly StreamJobFrame[]): string | undefined {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index]
    if (typeof frame === 'string') return frame
  }
  return undefined
}

interface EchoServer {
  url: string
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }[]
  setResponder(fn: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void | Promise<void>): void
  close(): Promise<void>
}

function startEcho(): Promise<EchoServer> {
  return new Promise((resolve) => {
    const requests: EchoServer['requests'] = []
    let responder: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void | Promise<void> = (
      _req,
      res,
    ) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    }
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        })
        void Promise.resolve(responder(req, res, body)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        setResponder(fn) {
          responder = fn
        },
        close() {
          return new Promise((r) => server.close(() => r()))
        },
      })
    })
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sanitizeLocalTargetUrl', () => {
  const allowed = [
    'http://127.0.0.1',
    'http://127.0.0.1:8080/path?q=1',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.0.1',
    'http://0.0.0.0',
    'http://localhost',
    'http://localhost:8000/',
    'http://my-printer.local',
    'http://LOCALHOST',
    'https://127.0.0.1:443',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fc00::1]',
    'http://[fd12::1]',
    'http://[fe80::1]',
  ]
  for (const url of allowed) {
    it(`accepts ${url}`, () => {
      expect(sanitizeLocalTargetUrl(url)).not.toBeNull()
    })
  }

  const rejected = [
    'http://1.1.1.1',
    'http://8.8.8.8',
    'https://example.com',
    'http://172.15.0.1',
    'http://172.32.0.1',
    'http://[2001:db8::1]',
    'http://[::ffff:1.1.1.1]',
    'ftp://127.0.0.1',
    'file:///etc/passwd',
    'http://',
    'not-a-url',
    '',
  ]
  for (const url of rejected) {
    it(`rejects ${url}`, () => {
      expect(sanitizeLocalTargetUrl(url)).toBeNull()
    })
  }

  it('strips userinfo from the returned URL', () => {
    expect(sanitizeLocalTargetUrl('http://user:pass@127.0.0.1/x')).toBe('http://127.0.0.1/x')
  })

  it('rejects non-string inputs', () => {
    expect(sanitizeLocalTargetUrl(undefined)).toBeNull()
    expect(sanitizeLocalTargetUrl(null)).toBeNull()
    expect(sanitizeLocalTargetUrl(42)).toBeNull()
    expect(sanitizeLocalTargetUrl({})).toBeNull()
  })
})

describe('normalizeStreamTimeoutMs / normalizeHeartbeatSec', () => {
  it('defaults the timeout on garbage input', () => {
    expect(normalizeStreamTimeoutMs(undefined)).toBe(PROXY_STREAM_DEFAULT_TIMEOUT_MS)
    expect(normalizeStreamTimeoutMs('not-a-number')).toBe(PROXY_STREAM_DEFAULT_TIMEOUT_MS)
    expect(normalizeStreamTimeoutMs(0)).toBe(PROXY_STREAM_DEFAULT_TIMEOUT_MS)
    expect(normalizeStreamTimeoutMs(-5)).toBe(PROXY_STREAM_DEFAULT_TIMEOUT_MS)
  })

  it('clamps the timeout to MAX_TIMEOUT_MS', () => {
    expect(normalizeStreamTimeoutMs(PROXY_STREAM_MAX_TIMEOUT_MS + 1)).toBe(PROXY_STREAM_MAX_TIMEOUT_MS)
    expect(normalizeStreamTimeoutMs(`${PROXY_STREAM_MAX_TIMEOUT_MS + 123_456}`)).toBe(PROXY_STREAM_MAX_TIMEOUT_MS)
  })

  it('floors positive fractional timeouts to at least 1 ms', () => {
    expect(normalizeStreamTimeoutMs(0.5)).toBe(1)
    expect(normalizeStreamTimeoutMs(1.9)).toBe(1)
  })

  it('clamps heartbeats into [MIN, MAX]', () => {
    expect(normalizeHeartbeatSec(undefined)).toBe(PROXY_STREAM_DEFAULT_HEARTBEAT_SEC)
    expect(normalizeHeartbeatSec(0)).toBe(PROXY_STREAM_HEARTBEAT_MIN_SEC)
    expect(normalizeHeartbeatSec(120)).toBe(PROXY_STREAM_HEARTBEAT_MAX_SEC)
    expect(normalizeHeartbeatSec(20)).toBe(20)
  })
})

describe('JobRegistry buffering and lifecycle', () => {
  it('L1: identifies non-terminal chat SSE activity for sliding generation deadlines', () => {
    expect(isStreamDeadlineActivityFrame('event: token\ndata: {"content":"hello"}\n\n')).toBe(true)
    expect(isStreamDeadlineActivityFrame('event: token\ndata: {"content":""}\n\n')).toBe(false)
    expect(isStreamDeadlineActivityFrame('event: done\ndata: {}\n\n')).toBe(false)
    expect(isStreamDeadlineActivityFrame(': heartbeat\n\n')).toBe(false)
    expect(isStreamDeadlineActivityFrame(JSON.stringify({ type: 'upstream_headers', status: 200, headers: {} }))).toBe(
      true,
    )
    expect(isStreamDeadlineActivityFrame(JSON.stringify({ type: 'ping', ts: 1 }))).toBe(false)
    expect(isStreamDeadlineActivityFrame(JSON.stringify({ type: 'done' }))).toBe(false)
    expect(isStreamDeadlineActivityFrame(JSON.stringify({ type: 'error', status: 504, message: 'nope' }))).toBe(false)
  })

  it('buffers events when no client is attached, then flushes on attach', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    reg.pushBinary(job, Buffer.from('AAAA'))
    reg.pushBinary(job, Buffer.from('BBBB'))
    expect(job.pendingEvents).toHaveLength(2)

    const client = fakeClient()
    expect(reg.attach(job.id, client)).toBe(job)
    expect(client.messages).toHaveLength(2)
    expect(binaryMessages(client).map((message) => message.toString('utf8'))).toEqual(['AAAA', 'BBBB'])
    expect(job.pendingEvents).toHaveLength(0)
    expect(job.pendingBytes).toBe(0)
  })

  it('broadcasts to attached clients without buffering', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    const a = fakeClient()
    const b = fakeClient()
    reg.attach(job.id, a)
    reg.attach(job.id, b)
    reg.pushEvent(job, { type: 'done' })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(1)
    expect(job.pendingEvents).toHaveLength(0)
  })

  it('keeps only the latest Agent Preset progress snapshot for durable replay', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    reg.enableReplay(job)
    reg.pushRaw(job, 'event: stage\ndata: {"stage":"prompt","status":"start"}\n\n')
    reg.pushRaw(
      job,
      'event: agent_preset_progress\ndata: {"chatId":"chat-1","phase":"beforeMain","completedSteps":0}\n\n',
    )
    reg.pushRaw(
      job,
      'event: agent_preset_progress\ndata: {"chatId":"chat-1","phase":"beforeMain","completedSteps":1}\n\n',
    )

    const progressFrames = job.replayEvents?.filter((frame) => frame.startsWith('event: agent_preset_progress'))
    expect(progressFrames).toHaveLength(1)
    expect(progressFrames?.[0]).toContain('"completedSteps":1')

    const client = fakeClient()
    reg.attach(job.id, client)
    expect(client.messages.filter((frame) => String(frame).startsWith('event: agent_preset_progress'))).toEqual(
      progressFrames,
    )
  })

  it('detaches attached clients that exceed the fanout buffer cap', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    const slow = fakeClient({ bufferedBytes: STREAM_CLIENT_MAX_BUFFERED_BYTES })
    reg.attach(job.id, slow)

    reg.pushBinary(job, Buffer.from('AAAA'))

    expect(slow.closed).toBe(true)
    expect(job.clients.has(slow)).toBe(false)
    expect(job.pendingEvents).toHaveLength(0)
  })

  it('keeps pending events when an attaching client exceeds the buffer cap', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    reg.pushBinary(job, Buffer.from('AAAA'))
    const slow = fakeClient({ bufferedBytes: STREAM_CLIENT_MAX_BUFFERED_BYTES })

    expect(reg.attach(job.id, slow)).toBe(job)

    expect(slow.closed).toBe(true)
    expect(job.clients.has(slow)).toBe(false)
    expect(job.pendingEvents).toHaveLength(1)
    expect(job.pendingBytes).toBeGreaterThan(0)
  })

  it('caps the pending buffer at MAX_PENDING_EVENTS', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    for (let i = 0; i < PROXY_STREAM_MAX_PENDING_EVENTS + 5; i += 1) {
      reg.pushBinary(job, Buffer.from(`x${i}`))
    }
    expect(job.pendingEvents.length).toBeLessThanOrEqual(PROXY_STREAM_MAX_PENDING_EVENTS)
    expect(job.pendingBytes).toBeLessThanOrEqual(PROXY_STREAM_MAX_PENDING_BYTES)
    expect(Buffer.from(job.pendingEvents[0] as Buffer).toString('utf8')).not.toBe('x0')
  })

  it('caps the pending buffer at MAX_PENDING_BYTES', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    const big = Buffer.alloc(256 * 1024, 'x')
    for (let i = 0; i < 10; i += 1) {
      reg.pushBinary(job, big)
    }
    expect(job.pendingBytes).toBeLessThanOrEqual(PROXY_STREAM_MAX_PENDING_BYTES)
  })

  it('detach cleans the job up once it is done and the last client leaves', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    const client = fakeClient()
    reg.attach(job.id, client)
    reg.markDone(job)
    expect(reg.has(job.id)).toBe(true)
    reg.detach(job.id, client)
    expect(reg.has(job.id)).toBe(false)
  })

  it('deleteJob aborts the controller and removes the job', () => {
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 60_000, heartbeatSec: 10 })
    const client = fakeClient()
    reg.attach(job.id, client)
    expect(reg.deleteJob(job.id)).toBe(true)
    expect(reg.has(job.id)).toBe(false)
    expect(job.abortController.signal.aborted).toBe(true)
    expect(client.closed).toBe(true)
  })

  it('tickGc aborts past-deadline jobs and cleans up done jobs past the grace', () => {
    const reg = new JobRegistry()
    const now0 = 1_000_000
    const job = reg.create({ timeoutMs: 1_000, heartbeatSec: 10, now: now0 })
    reg.tickGc(now0 + 1_500)
    expect(job.abortController.signal.aborted).toBe(true)

    reg.markDone(job, now0 + 1_500)
    reg.tickGc(now0 + 1_500 + PROXY_STREAM_DONE_GRACE_MS + 1)
    expect(reg.has(job.id)).toBe(false)
  })

  it('L1: sliding durable generation jobs survive past the original deadline while active', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const reg = new JobRegistry()
    const job = reg.create({
      timeoutMs: 1_000,
      heartbeatSec: 10,
      slidingDeadline: true,
    })
    expect(job.deadlineAt).toBe(1_001_000)

    vi.advanceTimersByTime(900)
    reg.pushRaw(job, 'event: token\ndata: {"content":"a"}\n\n')
    expect(job.deadlineAt).toBe(1_001_900)

    vi.advanceTimersByTime(900)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(false)

    vi.advanceTimersByTime(101)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(true)
  })

  it('L1: silent sliding durable generation jobs still die within the bounded deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    const reg = new JobRegistry()
    const job = reg.create({
      timeoutMs: 1_000,
      heartbeatSec: 10,
      slidingDeadline: true,
    })

    vi.advanceTimersByTime(1_001)
    reg.tickGc()

    expect(job.abortController.signal.aborted).toBe(true)
  })

  it('leaves fixed-deadline proxy jobs on their original wall-clock timeout', () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000_000)
    const reg = new JobRegistry()
    const job = reg.create({ timeoutMs: 1_000, heartbeatSec: 10 })

    vi.advanceTimersByTime(900)
    reg.pushBinary(job, Buffer.from('AAAA'))
    expect(job.deadlineAt).toBe(3_001_000)

    vi.advanceTimersByTime(101)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(true)
  })

  it('L5: active proxy stream jobs extend deadlineAt on JSON activity', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4_000_000)
    const reg = new JobRegistry()
    const job = reg.create({
      timeoutMs: 1_000,
      heartbeatSec: 10,
      slidingDeadline: true,
    })
    expect(job.deadlineAt).toBe(4_001_000)

    vi.advanceTimersByTime(900)
    reg.pushEvent(job, { type: 'upstream_headers', status: 200, headers: {} })
    expect(job.deadlineAt).toBe(4_001_900)

    vi.advanceTimersByTime(900)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(false)
    reg.pushBinary(job, Buffer.from('AAAA'))
    expect(job.deadlineAt).toBe(4_002_800)

    const refreshedDeadline = job.deadlineAt
    reg.pushEvent(job, { type: 'ping', ts: Date.now() })
    reg.pushEvent(job, { type: 'done' })
    reg.pushEvent(job, { type: 'error', status: 504, message: 'late failure' })
    expect(job.deadlineAt).toBe(refreshedDeadline)

    vi.advanceTimersByTime(999)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    reg.tickGc()
    expect(job.abortController.signal.aborted).toBe(true)
  })

  it('L5: silent proxy stream jobs abort at the bounded deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000_000)
    const reg = new JobRegistry()
    const job = reg.create({
      timeoutMs: 1_000,
      heartbeatSec: 10,
      slidingDeadline: true,
    })

    vi.advanceTimersByTime(1_001)
    reg.tickGc()

    expect(job.abortController.signal.aborted).toBe(true)
  })

  it('tickGc cleans up stale jobs that have not been updated within 2x timeout', () => {
    const reg = new JobRegistry()
    const now0 = 1_000_000
    const job = reg.create({ timeoutMs: 1_000, heartbeatSec: 10, now: now0 })
    // 2x default timeout is the floor; advance past it.
    reg.tickGc(now0 + PROXY_STREAM_DEFAULT_TIMEOUT_MS * 2 + 1)
    expect(reg.has(job.id)).toBe(false)
  })
})

describe('runStreamJob', () => {
  let echo: EchoServer
  beforeEach(async () => {
    echo = await startEcho()
  })
  afterEach(async () => {
    await echo.close()
  })

  async function runWith(
    overrides: Partial<{
      url: string
      method: string
      headers: Record<string, string>
      body: Buffer
    }>,
  ): Promise<{ registry: JobRegistry; job: StreamJob; client: FakeClient; events: StreamJobEventLike[] }> {
    const registry = new JobRegistry()
    const job = registry.create({ timeoutMs: 30_000, heartbeatSec: 10 })
    const client = fakeClient()
    registry.attach(job.id, client)
    await runStreamJob(registry, job, {
      targetUrl: overrides.url ?? echo.url,
      method: overrides.method ?? 'POST',
      headers: overrides.headers ?? {},
      bodyBuffer: overrides.body,
      clientIp: '127.0.0.1',
    })
    return {
      registry,
      job,
      client,
      events: jsonMessages(client) as StreamJobEventLike[],
    }
  }

  it('emits upstream_headers, chunk, and done for a successful upstream call', async () => {
    echo.setResponder((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'x-keep-me': 'yes',
        'cache-control': 'no-store',
        'content-encoding': 'identity',
        'content-security-policy': "default-src 'none'",
        'content-security-policy-report-only': 'whatever',
        'clear-site-data': '"cache"',
      })
      res.end('hello world')
    })

    const { client, events } = await runWith({})
    const types = events.map((e) => e.type)
    expect(types).toEqual(['upstream_headers', 'done'])
    const head = events[0] as { type: 'upstream_headers'; status: number; headers: Record<string, string> }
    expect(head.status).toBe(200)
    expect(head.headers['content-type']).toBe('text/plain')
    expect(head.headers['x-keep-me']).toBe('yes')
    expect(head.headers['cache-control']).toBeUndefined()
    expect(head.headers['content-encoding']).toBeUndefined()
    expect(head.headers['content-security-policy']).toBeUndefined()
    expect(head.headers['content-security-policy-report-only']).toBeUndefined()
    expect(head.headers['clear-site-data']).toBeUndefined()
    expect(binaryMessages(client).map((message) => message.toString('utf8'))).toEqual(['hello world'])
  })

  it('emits an error event when the target URL is not local-network', async () => {
    const { events } = await runWith({ url: 'http://1.1.1.1' })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'error',
      status: 400,
      message: 'Blocked non-local target URL',
    })
  })

  it('forwards the POST body bytes upstream and adds x-forwarded-for', async () => {
    const payload = Buffer.from(JSON.stringify({ hello: 'world' }))
    await runWith({ body: payload, headers: { 'content-type': 'application/json' } })
    expect(echo.requests).toHaveLength(1)
    expect(echo.requests[0].method).toBe('POST')
    expect(Buffer.compare(echo.requests[0].body, payload)).toBe(0)
    expect(echo.requests[0].headers['content-type']).toBe('application/json')
    expect(echo.requests[0].headers['x-forwarded-for']).toBe('127.0.0.1')
  })

  it('emits an error event when the job is aborted mid-stream', async () => {
    let writes = 0
    echo.setResponder((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      const interval = setInterval(() => {
        writes += 1
        if (writes > 50) {
          clearInterval(interval)
          res.end()
          return
        }
        res.write('x')
      }, 5)
      res.on('close', () => clearInterval(interval))
    })

    const registry = new JobRegistry()
    const job = registry.create({ timeoutMs: 30_000, heartbeatSec: 10 })
    const client = fakeClient()
    registry.attach(job.id, client)
    const run = runStreamJob(registry, job, {
      targetUrl: echo.url,
      method: 'POST',
      headers: {},
      clientIp: '127.0.0.1',
    })
    setTimeout(() => job.abortController.abort(), 25)
    await run
    const events = jsonMessages(client) as StreamJobEventLike[]
    expect(events.at(-1)).toMatchObject({ type: 'error', status: 504 })
  })

  it('stops consuming the upstream once the no-viewer buffer overflows (L15)', async () => {
    // Stream far more than the pending-buffer byte cap with NO viewer attached.
    // Once the drop-oldest window overflows, no late viewer can ever see a
    // coherent stream, so the job must abort the upstream instead of draining
    // the whole response through the lossy window.
    const totalBytes = 4 * PROXY_STREAM_MAX_PENDING_BYTES
    const writeSize = 64 * 1024
    let written = 0
    let upstreamClosed = false
    echo.setResponder((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.on('close', () => {
        upstreamClosed = true
      })
      res.on('error', () => {
        // The aborted connection may surface as a late write error; ignore.
      })
      const writeMore = (): void => {
        while (written < totalBytes) {
          written += writeSize
          if (!res.write(Buffer.alloc(writeSize, 1))) {
            res.once('drain', writeMore)
            return
          }
        }
        res.end()
      }
      writeMore()
    })

    const registry = new JobRegistry()
    const job = registry.create({ timeoutMs: 30_000, heartbeatSec: 10 })
    await runStreamJob(registry, job, {
      targetUrl: echo.url,
      method: 'POST',
      headers: {},
      clientIp: '127.0.0.1',
    })

    expect(job.done).toBe(true)
    expect(job.abortController.signal.aborted).toBe(true)
    expect(JSON.parse(lastJsonFrame(job.pendingEvents) ?? '{}')).toMatchObject({
      type: 'error',
      status: 503,
      message: expect.stringContaining('overflowed') as unknown as string,
    })
    // The upstream connection tears down (abort propagation is async) well
    // before the full response was produced.
    const deadline = Date.now() + 2_000
    while (!upstreamClosed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(upstreamClosed).toBe(true)
    expect(written).toBeLessThan(totalBytes)
  })
})

type StreamJobEventLike =
  | { type: 'upstream_headers'; status: number; headers: Record<string, string> }
  | { type: 'done' }
  | { type: 'error'; status: number; message: string }
