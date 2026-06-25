import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { FastifyBaseLogger } from 'fastify'
import { protocolMetricsEnabled } from '../protocolMetrics.js'

export const DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES = 10 * 1024 * 1024

export interface GenerationTraceOptions {
  fullPrompt: boolean
  maxGzipBytes: number
}

export interface GenerationTraceContext {
  dataDir: string
  options: GenerationTraceOptions
  requestId?: string
  requestUid?: string
  generationId?: string
  durableJobId?: string
  logger?: FastifyBaseLogger
}

export interface GenerationTraceSidecarWrittenEntry {
  status: 'written'
  path: string
  bytes: number
  gzipBytes: number
  sha256: string
}

export interface GenerationTraceSidecarOmittedEntry {
  status: 'omitted'
  reason: string
  bytes?: number
  gzipBytes?: number
  maxGzipBytes?: number
}

export type GenerationTraceSidecarEntry = GenerationTraceSidecarWrittenEntry | GenerationTraceSidecarOmittedEntry

const gzipAsync = promisify(gzip)
const REDACTED = '[redacted]'
const MEDIA_REDACTED = '[redacted-media]'
const SECRET_KEY_PATTERN =
  /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|password|private[-_]?key|client[-_]?secret|secret|token)$/i
const PEM_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/
const DATA_URI_PATTERN = /^data:([^;,]+)?(?:;[^,]*)?,([\s\S]*)$/i
const LONG_BASE64_PATTERN = /^[a-z0-9+/]+={0,2}$/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function redactedMediaSummary(kind: string, value: string): Record<string, unknown> {
  return {
    redacted: MEDIA_REDACTED,
    kind,
    bytes: byteLength(value),
    sha256: sha256Hex(value),
  }
}

function redactUrlString(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.username = parsed.username ? REDACTED : ''
    parsed.password = parsed.password ? REDACTED : ''
    parsed.search = ''
    return parsed.toString()
  } catch {
    return value
  }
}

function redactString(value: string): unknown {
  if (PEM_PATTERN.test(value)) {
    return REDACTED
  }
  const dataUri = DATA_URI_PATTERN.exec(value)
  if (dataUri) {
    return redactedMediaSummary(`data-uri:${dataUri[1] ?? 'unknown'}`, value)
  }
  const compact = value.replace(/\s+/g, '')
  if (value.length >= 256 && compact.length >= 256 && LONG_BASE64_PATTERN.test(compact)) {
    return redactedMediaSummary('base64', value)
  }
  return redactUrlString(value)
}

function redactRecord(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const field = value[key]
    if (field === undefined) continue
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = REDACTED
      continue
    }
    if (
      (key === 'url' || key === 'uri') &&
      typeof field === 'string' &&
      (field.startsWith('data:') || field.includes(';base64,'))
    ) {
      out[key] = redactedMediaSummary('data-uri', field)
      continue
    }
    if (/^(data|base64|image|audio|video)$/i.test(key) && typeof field === 'string') {
      out[key] = redactedMediaSummary(key.toLowerCase(), field)
      continue
    }
    out[key] = redactGenerationTraceValue(field, seen)
  }
  return out
}

export function redactGenerationTraceValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return { type: 'undefined' }
  if (typeof value === 'symbol' || typeof value === 'function') return { type: typeof value }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof URL) return redactUrlString(value.toString())
  if (Array.isArray(value)) {
    if (seen.has(value)) return { type: 'circular' }
    seen.add(value)
    const out = value.map((item) => redactGenerationTraceValue(item, seen))
    seen.delete(value)
    return out
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return { type: 'circular' }
    seen.add(value)
    const out = isPlainObject(value) ? redactRecord(value, seen) : redactRecord({ ...value }, seen)
    seen.delete(value)
    return out
  }
  return String(value)
}

function safeSegment(value: string | undefined, fallback: string): string {
  const cleaned = value?.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned && cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
}

function sidecarRelativePath(kind: string, context: GenerationTraceContext, sha256: string): string {
  const id = safeSegment(context.generationId ?? context.requestUid ?? context.requestId, 'unknown')
  return path.posix.join('trace', 'generation', `${kind}-${id}-${sha256.slice(0, 16)}.json.gz`)
}

export async function writeGenerationTraceSidecar(args: {
  context?: GenerationTraceContext
  kind: string
  value: unknown
}): Promise<GenerationTraceSidecarEntry | undefined> {
  const context = args.context
  if (!protocolMetricsEnabled() || !context || !context.options.fullPrompt) return undefined

  let text: string
  try {
    text = JSON.stringify(redactGenerationTraceValue(args.value), null, 2)
  } catch (err) {
    return { status: 'omitted', reason: `serialize_failed:${err instanceof Error ? err.message : String(err)}` }
  }

  const bytes = byteLength(text)
  let zipped: Buffer
  try {
    zipped = await gzipAsync(text)
  } catch (err) {
    return { status: 'omitted', reason: `gzip_failed:${err instanceof Error ? err.message : String(err)}`, bytes }
  }

  const gzipBytes = zipped.byteLength
  const maxGzipBytes = context.options.maxGzipBytes
  if (gzipBytes > maxGzipBytes) {
    return { status: 'omitted', reason: 'max_gzip_bytes_exceeded', bytes, gzipBytes, maxGzipBytes }
  }

  const sha256 = sha256Hex(text)
  const relativePath = sidecarRelativePath(args.kind, context, sha256)
  try {
    const absolutePath = path.join(context.dataDir, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, zipped)
  } catch (err) {
    context.logger?.warn({ err, kind: args.kind }, 'failed to write generation trace sidecar')
    return {
      status: 'omitted',
      reason: `write_failed:${err instanceof Error ? err.message : String(err)}`,
      bytes,
      gzipBytes,
    }
  }

  return {
    status: 'written',
    path: relativePath,
    bytes,
    gzipBytes,
    sha256,
  }
}

export function generationTraceSidecarMetricField(
  field: string,
  entry: GenerationTraceSidecarEntry | undefined,
): Record<string, unknown> {
  return entry ? { [field]: entry } : {}
}
