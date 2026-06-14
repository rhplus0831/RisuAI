import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { RequestTraceMode } from '../src/config.js'
import { REQUEST_UID_HEADER } from '../src/requestTrace.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

interface TraceEntry {
  Method: string
  Url: string
  Route?: string
  Caller?: string
  'Request-Header': string
  'Response-Header': string
  'X-Request-UID': string
  Timing: {
    process: number
    send: number
  }
}

const uidHeaderName = REQUEST_UID_HEADER.toLowerCase()

async function startHarness(mode?: RequestTraceMode): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-trace-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      requestTrace: mode ? { mode } : undefined,
    },
    memoryWorker: false,
    assetGc: false,
    generationChat: { finalizationRetry: false },
  })
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

function tracePath(h: Harness, mode: RequestTraceMode): string {
  return path.join(h.dataDir, 'trace', `${mode}.jsonl`)
}

function readTraceEntries(h: Harness, mode: RequestTraceMode): TraceEntry[] {
  const contents = readFileSync(tracePath(h, mode), 'utf8').trim()
  if (!contents) return []
  return contents.split('\n').map((line) => JSON.parse(line) as TraceEntry)
}

async function waitForTraceEntries(h: Harness, mode: RequestTraceMode, count: number): Promise<TraceEntry[]> {
  const deadline = Date.now() + 1000
  let lastEntries: TraceEntry[] = []
  while (Date.now() < deadline) {
    if (existsSync(tracePath(h, mode))) {
      lastEntries = readTraceEntries(h, mode)
      if (lastEntries.length === count) return lastEntries
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(lastEntries).toHaveLength(count)
  return lastEntries
}

function expectTiming(value: unknown): void {
  expect(typeof value).toBe('number')
  expect(value).toBeGreaterThanOrEqual(0)
}

let harness: Harness

afterEach(async () => {
  if (harness) {
    await stopHarness(harness)
  }
})

describe('request trace', () => {
  it('does not add request UIDs or logs when tracing is disabled', async () => {
    harness = await startHarness()

    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(res.statusCode).toBe(200)
    expect(res.headers[uidHeaderName]).toBeUndefined()
    expect(existsSync(tracePath(harness, 'agent'))).toBe(false)
    expect(existsSync(tracePath(harness, 'human'))).toBe(false)
  })

  it('adds a UID response header to non-API requests without writing JSONL', async () => {
    harness = await startHarness('agent')

    const res = await harness.app.inject({ method: 'GET', url: '/character/123' })

    expect(res.statusCode).toBe(404)
    expect(res.headers[uidHeaderName]).toMatch(/^[a-f0-9]{64}$/)
    expect(existsSync(tracePath(harness, 'agent'))).toBe(false)
  })

  it('appends API request trace entries as JSONL', async () => {
    harness = await startHarness('agent')

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: {
        'risu-auth': 'secret-auth-token',
        'user-agent': '',
        'x-debug-test': 'trace-me',
      },
    })

    const responseUid = String(res.headers[uidHeaderName])
    expect(responseUid).toMatch(/^[a-f0-9]{64}$/)
    const [entry] = await waitForTraceEntries(harness, 'agent', 1)
    expect(entry.Method).toBe('GET')
    expect(entry.Url).toBe('/api/v1/health')
    expect(entry.Route).toBe('/api/v1/health')
    expect(entry.Caller).toBeUndefined()
    expect(entry['X-Request-UID']).toBe(responseUid)
    expectTiming(entry.Timing.process)
    expectTiming(entry.Timing.send)

    const requestHeaders = JSON.parse(entry['Request-Header']) as Record<string, string>
    const responseHeaders = JSON.parse(entry['Response-Header']) as Record<string, string>
    expect(requestHeaders['x-debug-test']).toBe('trace-me')
    expect(requestHeaders['risu-auth']).toBe('[redacted]')
    expect(requestHeaders[uidHeaderName]).toBe(responseUid)
    expect(responseHeaders[uidHeaderName]).toBe(responseUid)
  })

  it('records route metadata, explicit caller, and redacted query params', async () => {
    harness = await startHarness('agent')

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/chatMessages?id=chat-1&token=secret-token&api_key=secret-key&safe=visible',
      headers: {
        'x-risu-caller': 'client-bootstrap?access_token=secret-caller-token&view=main',
      },
    })

    expect(res.statusCode).toBe(401)
    const [entry] = await waitForTraceEntries(harness, 'agent', 1)
    expect(entry.Method).toBe('GET')
    expect(entry.Url).toBe('/api/v1/projection/chatMessages?id=chat-1&token=[redacted]&api_key=[redacted]&safe=visible')
    expect(entry.Route).toBe('/api/v1/projection/:resource')
    expect(entry.Caller).toBe('x-risu-caller=client-bootstrap?access_token=[redacted]&view=main')
  })

  it('falls back to referer, user-agent, and writer session caller details', async () => {
    harness = await startHarness('agent')

    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: {
        referer: 'http://localhost:6418/?token=secret-token&panel=chat',
        'user-agent': 'trace-test-agent',
        'risu-writer-session': 'writer-a',
      },
    })

    const [entry] = await waitForTraceEntries(harness, 'agent', 1)
    expect(entry.Caller).toBe(
      'referer=http://localhost:6418/?token=[redacted]&panel=chat; user-agent=trace-test-agent; risu-writer-session=writer-a',
    )
  })

  it('uses the selected trace mode file', async () => {
    harness = await startHarness('human')

    await harness.app.inject({ method: 'GET', url: '/api/v1/health' })
    await waitForTraceEntries(harness, 'human', 1)

    expect(existsSync(tracePath(harness, 'human'))).toBe(true)
    expect(existsSync(tracePath(harness, 'agent'))).toBe(false)
  })
})
