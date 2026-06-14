import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ACTIVE_WRITER_SESSION_HEADER, readActiveWriterSessionId } from './activeWriter.js'
import type { RequestTraceMode } from './config.js'

export const REQUEST_UID_HEADER = 'X-Request-UID'
const CALLER_HEADER = 'x-risu-caller'

interface RegisterRequestTraceOptions {
  dataDir: string
  mode: RequestTraceMode
}

interface RequestTraceState {
  uid: string
  startedAtMs: number
  sendStartedAtMs?: number
  processMs?: number
  logApiRequest: boolean
}

interface RequestTraceEntry {
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

type HeaderRecord = Record<string, string | number | string[] | undefined>

const REDACTED_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'risu-auth',
  'set-cookie',
  'x-api-key',
  'xi-api-key',
])

const SENSITIVE_QUERY_PARAM_NAMES = new Set([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'code',
  'id_token',
  'key',
  'password',
  'passwd',
  'refresh_token',
  'risu-auth',
  'secret',
  'session',
  'session_token',
  'sig',
  'signature',
  'token',
  'x-api-key',
  'xi-api-key',
])

export function registerRequestTrace(app: FastifyInstance, opts: RegisterRequestTraceOptions): void {
  const traceFilePath = path.join(opts.dataDir, 'trace', `${opts.mode}.jsonl`)
  const traceStates = new WeakMap<FastifyRequest, RequestTraceState>()
  const pendingWrites = new Set<Promise<void>>()

  app.addHook('onRequest', async (request, reply) => {
    const state: RequestTraceState = {
      uid: generateRequestUid(),
      startedAtMs: performance.now(),
      logApiRequest: isApiRequest(request.raw.url ?? request.url),
    }
    traceStates.set(request, state)

    request.headers[REQUEST_UID_HEADER.toLowerCase()] = state.uid
    reply.header(REQUEST_UID_HEADER, state.uid)
    reply.raw.setHeader(REQUEST_UID_HEADER, state.uid)
    installWriteHeadProbe(reply.raw, () => markSendStarted(state))
  })

  app.addHook('onSend', async (request, _reply, payload) => {
    const state = traceStates.get(request)
    if (state) markSendStarted(state)
    return payload
  })

  app.addHook('onResponse', async (request, reply) => {
    const state = traceStates.get(request)
    if (!state?.logApiRequest) return

    const finishedAtMs = performance.now()
    const sendStartedAtMs = state.sendStartedAtMs ?? finishedAtMs
    const processMs = state.processMs ?? sendStartedAtMs - state.startedAtMs
    const responseHeaders: HeaderRecord = {
      ...reply.getHeaders(),
      ...reply.raw.getHeaders(),
    }
    if (!hasHeader(responseHeaders, REQUEST_UID_HEADER)) {
      responseHeaders[REQUEST_UID_HEADER] = state.uid
    }

    const caller = resolveCaller(request)
    const route = resolveRoutePattern(request)
    const entry: RequestTraceEntry = {
      Method: request.method.toUpperCase(),
      Url: redactSensitiveQueryParams(request.raw.url ?? request.url),
      ...(route ? { Route: route } : {}),
      ...(caller ? { Caller: caller } : {}),
      'Request-Header': serializeHeaders(request.headers),
      'Response-Header': serializeHeaders(responseHeaders),
      'X-Request-UID': state.uid,
      Timing: {
        process: roundMs(processMs),
        send: roundMs(Math.max(0, finishedAtMs - sendStartedAtMs)),
      },
    }

    const write = appendTraceEntry(traceFilePath, entry, request)
    pendingWrites.add(write)
    try {
      await write
    } finally {
      pendingWrites.delete(write)
    }
  })

  app.addHook('onClose', async () => {
    await Promise.allSettled(pendingWrites)
  })
}

function generateRequestUid(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex')
}

function isApiRequest(url: string): boolean {
  const path = url.split('?', 1)[0] ?? url
  return path === '/api' || path.startsWith('/api/')
}

function markSendStarted(state: RequestTraceState): void {
  if (state.sendStartedAtMs !== undefined) return
  const now = performance.now()
  state.sendStartedAtMs = now
  state.processMs = now - state.startedAtMs
}

function installWriteHeadProbe(raw: FastifyReply['raw'], onWriteHead: () => void): void {
  const originalWriteHead = raw.writeHead
  raw.writeHead = function writeHeadWithTrace(
    this: FastifyReply['raw'],
    statusCode: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): FastifyReply['raw'] {
    onWriteHead()
    const args =
      headers !== undefined
        ? [statusCode, statusMessageOrHeaders, headers]
        : statusMessageOrHeaders !== undefined
          ? [statusCode, statusMessageOrHeaders]
          : [statusCode]
    return Reflect.apply(originalWriteHead, this, args) as FastifyReply['raw']
  } as typeof raw.writeHead
}

function serializeHeaders(headers: HeaderRecord): string {
  const normalized: Record<string, string | number | string[]> = {}
  for (const name of Object.keys(headers).sort((a, b) => a.localeCompare(b))) {
    const value = headers[name]
    if (value === undefined) continue
    normalized[name] = REDACTED_HEADER_NAMES.has(name.toLowerCase()) ? '[redacted]' : value
  }
  return JSON.stringify(normalized)
}

function resolveRoutePattern(request: FastifyRequest): string | undefined {
  const route = request.routeOptions.url
  return typeof route === 'string' && route.trim() !== '' ? route : undefined
}

function resolveCaller(request: FastifyRequest): string | undefined {
  const explicit = readHeaderString(request.headers[CALLER_HEADER])
  if (explicit) {
    return `${CALLER_HEADER}=${redactSensitiveQueryParams(explicit)}`
  }

  const parts: string[] = []
  const referer = readHeaderString(request.headers.referer) ?? readHeaderString(request.headers.referrer)
  if (referer) {
    parts.push(`referer=${redactSensitiveQueryParams(referer)}`)
  }

  const userAgent = readHeaderString(request.headers['user-agent'])
  if (userAgent) {
    parts.push(`user-agent=${userAgent}`)
  }

  const writerSession = readActiveWriterSessionId(request)
  if (writerSession) {
    parts.push(`${ACTIVE_WRITER_SESSION_HEADER}=${writerSession}`)
  }

  return parts.length > 0 ? parts.join('; ') : undefined
}

function readHeaderString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value.find((entry) => entry.trim() !== '') : value
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function redactSensitiveQueryParams(rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?')
  if (queryStart === -1) return rawUrl
  const hashStart = rawUrl.indexOf('#', queryStart + 1)
  const queryEnd = hashStart === -1 ? rawUrl.length : hashStart
  const query = rawUrl.slice(queryStart + 1, queryEnd)
  if (query === '') return rawUrl

  const redactedQuery = query
    .split('&')
    .map((part) => redactQueryParam(part))
    .join('&')
  return `${rawUrl.slice(0, queryStart + 1)}${redactedQuery}${rawUrl.slice(queryEnd)}`
}

function redactQueryParam(part: string): string {
  if (part === '') return part
  const separatorIndex = part.indexOf('=')
  const rawName = separatorIndex === -1 ? part : part.slice(0, separatorIndex)
  if (!isSensitiveQueryParamName(rawName)) return part
  return `${rawName}=[redacted]`
}

function isSensitiveQueryParamName(rawName: string): boolean {
  const normalized = decodeQueryComponent(rawName).trim().toLowerCase()
  if (SENSITIVE_QUERY_PARAM_NAMES.has(normalized)) return true

  const compact = normalized.replace(/[-_]/g, '')
  return (
    compact.includes('token') ||
    compact.includes('secret') ||
    compact.includes('password') ||
    compact === 'apikey' ||
    compact === 'authorization' ||
    compact === 'risuauth'
  )
}

function decodeQueryComponent(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

function hasHeader(headers: HeaderRecord, name: string): boolean {
  const normalizedName = name.toLowerCase()
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === normalizedName)
}

async function appendTraceEntry(
  traceFilePath: string,
  entry: RequestTraceEntry,
  request: FastifyRequest,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(traceFilePath), { recursive: true })
    await fs.appendFile(traceFilePath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    request.log.warn({ err, traceFilePath }, 'failed to append request trace entry')
  }
}

function roundMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 1000) / 1000
}
