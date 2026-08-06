import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver.js'
import type { CompletionStreamFrame } from './generation/frames.js'

export const DEFAULT_REQUEST_HISTORY_LIMIT = 20
export const MAX_REQUEST_HISTORY_LIMIT = 10_000

const KIB = 1024
const MIB = 1024 * KIB

// Request history is diagnostic data stored beside the primary application
// database. Keep useful prompt/response artifacts while ensuring one capture
// cannot consume the volume needed for user-authored state.
export const REQUEST_HISTORY_PROMPT_MAX_BYTES = 2 * MIB
export const REQUEST_HISTORY_RESPONSE_MAX_BYTES = 4 * MIB
export const REQUEST_HISTORY_METADATA_MAX_BYTES = 256 * KIB
export const REQUEST_HISTORY_API_METADATA_MAX_BYTES = 256 * KIB
export const REQUEST_HISTORY_ERROR_MAX_BYTES = 64 * KIB
export const REQUEST_HISTORY_AUXILIARY_JSON_MAX_BYTES = 64 * KIB
export const REQUEST_HISTORY_SOURCE_MAX_BYTES = 4 * KIB
export const REQUEST_HISTORY_TOTAL_MAX_BYTES = 64 * MIB

const REQUEST_HISTORY_METADATA_TRUNCATION_RESERVE_BYTES = 16 * KIB
const REQUEST_HISTORY_TRUNCATION_METADATA_KEY = 'requestHistoryTruncation'

type RequestHistoryTruncatedField =
  | 'source'
  | 'profile'
  | 'prompt'
  | 'context'
  | 'toggles'
  | 'response'
  | 'metadata'
  | 'apiMetadata'
  | 'error'

export interface RequestHistoryFieldTruncation {
  originalBytes: number
  storedBytes: number
  truncatedBytes: number
}

export type RequestHistoryTruncation = Partial<Record<RequestHistoryTruncatedField, RequestHistoryFieldTruncation>>

export type RequestHistoryStatus = 'pending' | 'success' | 'error' | 'cancelled'

export interface RequestHistoryProfileSnapshot {
  id: string
  name?: string
  role: string
  sourceKind: string
  provider?: string
  modelId: string
  requestModel: string
}

export interface RequestHistoryContext {
  characterId?: string
  characterName?: string
  chatId?: string
  chatName?: string
  messageId?: string
  generationId?: string
}

export interface RequestHistoryRecordSummary {
  id: string
  startedAt: number
  completedAt?: number
  status: RequestHistoryStatus
  source: string
  profile: RequestHistoryProfileSnapshot
  context?: RequestHistoryContext
  responsePreview: string
  error?: string
}

export interface RequestHistoryRecord extends RequestHistoryRecordSummary {
  prompt: unknown
  toggles?: Record<string, string>
  response: string
  metadata: Record<string, unknown>
  apiMetadata: Record<string, unknown>
}

export interface BeginRequestHistoryInput {
  db: DatabaseSync
  limit: unknown
  source: string
  profile: RequestHistoryProfileSnapshot
  prompt: unknown
  context?: RequestHistoryContext
  toggles?: Record<string, string>
  metadata?: Record<string, unknown>
  id?: string
  startedAt?: number
}

export interface RequestHistoryHandle {
  db: DatabaseSync
  id: string
  startedAt: number
  limit: number
  metadata: Record<string, unknown>
  truncation: RequestHistoryTruncation
}

export interface RequestHistoryCapturedResponse {
  response: string
  responseCharacters: number
  truncatedBytes: number
}

export interface RequestHistoryResponseCapture {
  append(value: string): void
  snapshot(): RequestHistoryCapturedResponse
}

interface RequestHistoryRow {
  id: string
  started_at: number
  completed_at: number | null
  status: string
  source: string
  profile_json: string
  prompt_json: string
  context_json: string | null
  toggles_json: string | null
  response_text: string | null
  metadata_json: string
  api_metadata_json: string
  error_text: string | null
}

export function createRequestHistoryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_history (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error', 'cancelled')),
      source TEXT NOT NULL,
      profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
      prompt_json TEXT NOT NULL CHECK (json_valid(prompt_json)),
      context_json TEXT CHECK (context_json IS NULL OR json_valid(context_json)),
      toggles_json TEXT CHECK (toggles_json IS NULL OR json_valid(toggles_json)),
      response_text TEXT,
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
      api_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(api_metadata_json)),
      error_text TEXT
    );
    CREATE INDEX IF NOT EXISTS request_history_started_at_idx
      ON request_history(started_at DESC);
  `)
  const columns = db.prepare('PRAGMA table_info(request_history)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'api_metadata_json')) {
    db.exec(
      "ALTER TABLE request_history ADD COLUMN api_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(api_metadata_json))",
    )
  }
}

export function normalizeRequestHistoryLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REQUEST_HISTORY_LIMIT
  return Math.max(0, Math.min(MAX_REQUEST_HISTORY_LIMIT, Math.trunc(value)))
}

export function requestHistoryProfileSnapshot(profile: ResolvedModelProfile): RequestHistoryProfileSnapshot {
  const capability = profile.providerCapability as { routable?: boolean; provider?: unknown }
  const provider =
    profile.status.providerId ??
    (capability.routable === true && typeof capability.provider === 'string' ? capability.provider : undefined)
  return {
    id: profile.profileId,
    ...(profile.source.profileName ? { name: profile.source.profileName } : {}),
    role: profile.role,
    sourceKind: profile.source.kind,
    ...(provider ? { provider } : {}),
    modelId: profile.modelId,
    requestModel: profile.requestModel,
  }
}

export function beginRequestHistory(input: BeginRequestHistoryInput): RequestHistoryHandle | null {
  const limit = normalizeRequestHistoryLimit(input.limit)
  if (limit === 0) return null

  const id = input.id ?? randomUUID()
  const startedAt = input.startedAt ?? Date.now()
  const truncation: RequestHistoryTruncation = {}
  const source = boundedText(input.source, REQUEST_HISTORY_SOURCE_MAX_BYTES)
  recordTruncation(truncation, 'source', source)
  const profile = boundedProfile(input.profile)
  recordTruncation(truncation, 'profile', profile)
  const prompt = boundedJson(input.prompt, REQUEST_HISTORY_PROMPT_MAX_BYTES)
  recordTruncation(truncation, 'prompt', prompt)
  const context = input.context ? boundedContext(input.context) : null
  if (context) recordTruncation(truncation, 'context', context)
  const toggles = input.toggles ? boundedJson(input.toggles, REQUEST_HISTORY_AUXILIARY_JSON_MAX_BYTES, true) : null
  if (toggles) recordTruncation(truncation, 'toggles', toggles)
  const metadata = boundedMetadata(input.metadata ?? {})
  recordTruncation(truncation, 'metadata', metadata)
  input.db
    .prepare(
      `INSERT INTO request_history (
        id, started_at, completed_at, status, source, profile_json, prompt_json,
        context_json, toggles_json, response_text, metadata_json, error_text
      ) VALUES (?, ?, NULL, 'pending', ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    )
    .run(
      id,
      startedAt,
      source.value,
      profile.json,
      prompt.json,
      context?.json ?? null,
      toggles?.json ?? null,
      metadataJson(metadata.value, truncation),
    )
  pruneRequestHistory(input.db, limit)
  return { db: input.db, id, startedAt, limit, metadata: metadata.value, truncation }
}

export function tryBeginRequestHistory(input: BeginRequestHistoryInput): RequestHistoryHandle | null {
  try {
    return beginRequestHistory(input)
  } catch {
    // Request-history persistence must not turn an otherwise valid provider
    // request into a generation failure. Schema/storage failures remain visible
    // through the history surface being unavailable or incomplete.
    return null
  }
}

export function completeRequestHistory(
  handle: RequestHistoryHandle | null,
  input: {
    status: Exclude<RequestHistoryStatus, 'pending'>
    response?: string
    error?: string
    metadata?: Record<string, unknown>
    apiMetadata?: Record<string, unknown>
    completedAt?: number
    responseTruncatedBytes?: number
  },
): void {
  if (!handle) return
  const completedAt = input.completedAt ?? Date.now()
  const response = boundedText(input.response ?? '', REQUEST_HISTORY_RESPONSE_MAX_BYTES)
  const responseTruncatedBytes = Math.max(0, Math.trunc(input.responseTruncatedBytes ?? 0))
  if (responseTruncatedBytes > 0) {
    response.originalBytes += responseTruncatedBytes
    response.truncatedBytes += responseTruncatedBytes
  }
  const error = input.error === undefined ? null : boundedText(input.error, REQUEST_HISTORY_ERROR_MAX_BYTES)
  const apiMetadata = boundedJson(input.apiMetadata ?? {}, REQUEST_HISTORY_API_METADATA_MAX_BYTES)
  const completionMetadata = boundedMetadata(input.metadata ?? {})
  const metadata = boundedMetadata({
    ...handle.metadata,
    ...completionMetadata.value,
    durationMs: Math.max(0, completedAt - handle.startedAt),
  })
  const truncation = { ...handle.truncation }
  recordTruncation(truncation, 'response', response)
  if (error) recordTruncation(truncation, 'error', error)
  recordTruncation(truncation, 'apiMetadata', apiMetadata)
  recordTruncation(truncation, 'metadata', completionMetadata)
  recordTruncation(truncation, 'metadata', metadata)
  try {
    handle.db
      .prepare(
        `UPDATE request_history
         SET completed_at = ?, status = ?, response_text = ?, metadata_json = ?, api_metadata_json = ?, error_text = ?
         WHERE id = ?`,
      )
      .run(
        completedAt,
        input.status,
        response.value,
        metadataJson(metadata.value, truncation),
        apiMetadata.json,
        error?.value ?? null,
        handle.id,
      )
    pruneRequestHistory(handle.db, handle.limit)
  } catch {
    // See tryBeginRequestHistory: diagnostics must remain non-fatal.
  }
}

export function wrapRequestHistoryFrames(
  frames: AsyncIterable<CompletionStreamFrame>,
  handle: RequestHistoryHandle | null,
  signal: AbortSignal,
): AsyncIterable<CompletionStreamFrame> {
  if (!handle) return frames

  return (async function* () {
    const response = createRequestHistoryResponseCapture()
    let status: Exclude<RequestHistoryStatus, 'pending'> | null = null
    let error: string | undefined
    let responseMetadata: Record<string, unknown> = {}
    let apiMetadata: Record<string, unknown> = {}
    let completed = false
    const complete = (): void => {
      if (completed) return
      completed = true
      const finalStatus = status ?? 'cancelled'
      const captured = response.snapshot()
      completeRequestHistory(handle, {
        status: finalStatus,
        response: captured.response,
        responseTruncatedBytes: captured.truncatedBytes,
        ...(error ? { error } : {}),
        apiMetadata,
        metadata: {
          ...responseMetadata,
          responseCharacters: captured.responseCharacters,
          ...(status === null ? { incomplete: true } : {}),
        },
      })
    }
    try {
      for await (const frame of frames) {
        if (frame.kind === 'token') response.append(frame.content ?? '')
        if (frame.kind === 'done') {
          status = 'success'
          apiMetadata = frame.apiMetadata ?? {}
          responseMetadata = {
            ...(frame.finishReason ? { finishReason: frame.finishReason } : {}),
            ...(frame.alternates ? { alternates: frame.alternates } : {}),
            ...(frame.toolCalls ? { toolCalls: frame.toolCalls } : {}),
          }
          // Persist before yielding: the consumer may hold this provider terminal
          // frame while it awaits unrelated post-generation work.
          complete()
        }
        if (frame.kind === 'error') {
          status = signal.aborted ? 'cancelled' : 'error'
          error = frame.error ?? 'Provider request failed'
          apiMetadata = frame.apiMetadata ?? {}
          responseMetadata = {
            ...(frame.status !== undefined ? { providerStatus: frame.status } : {}),
            ...(frame.statusText ? { providerStatusText: frame.statusText } : {}),
            ...(frame.code ? { providerCode: frame.code } : {}),
            ...(frame.reason ? { providerReason: frame.reason } : {}),
          }
          complete()
        }
        yield frame
      }
    } catch (caught) {
      status = signal.aborted ? 'cancelled' : 'error'
      error = caught instanceof Error ? caught.message : String(caught)
      throw caught
    } finally {
      complete()
    }
  })()
}

export function pruneRequestHistory(
  db: DatabaseSync,
  limitValue: unknown,
  byteBudget = REQUEST_HISTORY_TOTAL_MAX_BYTES,
): number {
  const limit = normalizeRequestHistoryLimit(limitValue)
  if (limit === 0) {
    return Number(db.prepare('DELETE FROM request_history').run().changes)
  }
  const normalizedByteBudget = Math.max(0, Math.trunc(byteBudget))
  return Number(
    db
      .prepare(
        `WITH request_history_sizes AS (
           SELECT
             rowid,
             id,
             started_at,
             length(CAST(id AS BLOB)) +
             length(CAST(source AS BLOB)) +
             length(CAST(profile_json AS BLOB)) +
             length(CAST(prompt_json AS BLOB)) +
             length(CAST(COALESCE(context_json, '') AS BLOB)) +
             length(CAST(COALESCE(toggles_json, '') AS BLOB)) +
             length(CAST(COALESCE(response_text, '') AS BLOB)) +
             length(CAST(metadata_json AS BLOB)) +
             length(CAST(api_metadata_json AS BLOB)) +
             length(CAST(COALESCE(error_text, '') AS BLOB)) AS row_bytes
           FROM request_history
         ), retained_prefix AS (
           SELECT
             id,
             row_number() OVER (ORDER BY started_at DESC, rowid DESC) AS retained_count,
             sum(row_bytes) OVER (
               ORDER BY started_at DESC, rowid DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS retained_bytes
           FROM request_history_sizes
         )
         DELETE FROM request_history
         WHERE id IN (
           SELECT id FROM retained_prefix
           WHERE retained_count > ? OR retained_bytes > ?
         )`,
      )
      .run(limit, normalizedByteBudget).changes,
  )
}

export function createRequestHistoryResponseCapture(): RequestHistoryResponseCapture {
  let response = ''
  let responseBytes = 0
  let responseCharacters = 0
  let truncatedBytes = 0
  return {
    append(value) {
      responseCharacters += value.length
      if (value.length === 0) return
      const bounded = boundedText(value, REQUEST_HISTORY_RESPONSE_MAX_BYTES - responseBytes)
      response += bounded.value
      responseBytes += bounded.storedBytes
      truncatedBytes += bounded.truncatedBytes
    },
    snapshot() {
      return { response, responseCharacters, truncatedBytes }
    },
  }
}

export function listRequestHistory(db: DatabaseSync, limitValue: unknown): RequestHistoryRecordSummary[] {
  const limit = normalizeRequestHistoryLimit(limitValue)
  pruneRequestHistory(db, limit)
  if (limit === 0) return []
  const rows = db
    .prepare(
      `SELECT id, started_at, completed_at, status, source, profile_json, prompt_json,
              context_json, toggles_json, response_text, metadata_json, api_metadata_json, error_text
       FROM request_history
       ORDER BY started_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as RequestHistoryRow[]
  return rows.map(toSummary)
}

export function getRequestHistoryRecord(db: DatabaseSync, id: string): RequestHistoryRecord | null {
  const row = db
    .prepare(
      `SELECT id, started_at, completed_at, status, source, profile_json, prompt_json,
              context_json, toggles_json, response_text, metadata_json, api_metadata_json, error_text
       FROM request_history WHERE id = ?`,
    )
    .get(id) as unknown as RequestHistoryRow | undefined
  if (!row) return null
  return {
    ...toSummary(row),
    prompt: parseJson(row.prompt_json, null),
    ...(row.toggles_json ? { toggles: parseJson(row.toggles_json, {}) as Record<string, string> } : {}),
    response: row.response_text ?? '',
    metadata: parseJson(row.metadata_json, {}) as Record<string, unknown>,
    apiMetadata: parseJson(row.api_metadata_json, {}) as Record<string, unknown>,
  }
}

export function deleteRequestHistoryRecord(db: DatabaseSync, id: string): boolean {
  return db.prepare('DELETE FROM request_history WHERE id = ?').run(id).changes === 1
}

function toSummary(row: RequestHistoryRow): RequestHistoryRecordSummary {
  const response = row.response_text ?? ''
  return {
    id: row.id,
    startedAt: row.started_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    status: requestHistoryStatus(row.status),
    source: row.source,
    profile: parseJson(row.profile_json, {
      id: '',
      role: '',
      sourceKind: '',
      modelId: '',
      requestModel: '',
    }) as RequestHistoryProfileSnapshot,
    ...(row.context_json ? { context: parseJson(row.context_json, {}) as RequestHistoryContext } : {}),
    responsePreview: response.length > 240 ? `${response.slice(0, 240)}…` : response,
    ...(row.error_text ? { error: row.error_text } : {}),
  }
}

function requestHistoryStatus(value: string): RequestHistoryStatus {
  return value === 'success' || value === 'error' || value === 'cancelled' ? value : 'pending'
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

interface BoundedText {
  value: string
  originalBytes: number
  storedBytes: number
  truncatedBytes: number
}

interface BoundedJson<T> extends RequestHistoryFieldTruncation {
  json: string
  value: T
}

function boundedText(value: string, maxBytes: number): BoundedText {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.byteLength <= maxBytes) {
    return {
      value,
      originalBytes: buffer.byteLength,
      storedBytes: buffer.byteLength,
      truncatedBytes: 0,
    }
  }
  let end = Math.max(0, maxBytes)
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  const stored = buffer.subarray(0, end).toString('utf8')
  return {
    value: stored,
    originalBytes: buffer.byteLength,
    storedBytes: end,
    truncatedBytes: buffer.byteLength - end,
  }
}

function boundedJson<T>(value: T, maxBytes: number, stringRecordPlaceholder = false): BoundedJson<T> {
  const json = stringifyJson(value)
  const originalBytes = Buffer.byteLength(json, 'utf8')
  if (originalBytes <= maxBytes) {
    return { json, value: JSON.parse(json) as T, originalBytes, storedBytes: originalBytes, truncatedBytes: 0 }
  }

  const placeholder = boundedJsonPlaceholder(json, originalBytes, maxBytes, stringRecordPlaceholder)
  return {
    json: placeholder.json,
    value: placeholder.value as T,
    originalBytes,
    storedBytes: Buffer.byteLength(placeholder.json, 'utf8'),
    truncatedBytes: originalBytes - Buffer.byteLength(placeholder.json, 'utf8'),
  }
}

function boundedJsonPlaceholder(
  json: string,
  originalBytes: number,
  maxBytes: number,
  stringRecord: boolean,
): { json: string; value: Record<string, unknown> } {
  const build = (prefix: string): Record<string, unknown> =>
    stringRecord
      ? {
          requestHistoryTruncated: 'true',
          originalBytes: String(originalBytes),
          retainedJsonPrefix: prefix,
        }
      : { requestHistoryTruncated: true, originalBytes, retainedJsonPrefix: prefix }
  let low = 0
  let high = json.length
  let best = build('')
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = build(json.slice(0, middle))
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= maxBytes) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return { json: JSON.stringify(best), value: best }
}

function boundedProfile(value: RequestHistoryProfileSnapshot): BoundedJson<RequestHistoryProfileSnapshot> {
  return boundedStringRecord(value, ['id', 'name', 'role', 'sourceKind', 'provider', 'modelId', 'requestModel'])
}

function boundedContext(value: RequestHistoryContext): BoundedJson<RequestHistoryContext> {
  return boundedStringRecord(value, ['characterId', 'characterName', 'chatId', 'chatName', 'messageId', 'generationId'])
}

function boundedStringRecord<T extends object>(value: T, keys: readonly (keyof T)[]): BoundedJson<T> {
  const originalJson = stringifyJson(value)
  const capped = { ...value }
  const perValueMaxBytes = Math.floor(REQUEST_HISTORY_AUXILIARY_JSON_MAX_BYTES / keys.length) - 64
  for (const key of keys) {
    if (typeof capped[key] === 'string') {
      capped[key] = boundedText(capped[key] as string, perValueMaxBytes).value as T[keyof T]
    }
  }
  const json = stringifyJson(capped)
  const originalBytes = Buffer.byteLength(originalJson, 'utf8')
  const storedBytes = Buffer.byteLength(json, 'utf8')
  return {
    json,
    value: JSON.parse(json) as T,
    originalBytes,
    storedBytes,
    truncatedBytes: Math.max(0, originalBytes - storedBytes),
  }
}

function boundedMetadata(value: Record<string, unknown>): BoundedJson<Record<string, unknown>> {
  return boundedJson(value, REQUEST_HISTORY_METADATA_MAX_BYTES - REQUEST_HISTORY_METADATA_TRUNCATION_RESERVE_BYTES)
}

function metadataJson(value: Record<string, unknown>, truncation: RequestHistoryTruncation): string {
  return JSON.stringify(
    Object.keys(truncation).length > 0 ? { ...value, [REQUEST_HISTORY_TRUNCATION_METADATA_KEY]: truncation } : value,
  )
}

function recordTruncation(
  target: RequestHistoryTruncation,
  field: RequestHistoryTruncatedField,
  bounded: RequestHistoryFieldTruncation,
): void {
  if (bounded.truncatedBytes <= 0) return
  const existing = target[field]
  target[field] = existing
    ? {
        originalBytes: bounded.storedBytes + existing.truncatedBytes + bounded.truncatedBytes,
        storedBytes: bounded.storedBytes,
        truncatedBytes: existing.truncatedBytes + bounded.truncatedBytes,
      }
    : {
        originalBytes: bounded.originalBytes,
        storedBytes: bounded.storedBytes,
        truncatedBytes: bounded.truncatedBytes,
      }
}

function stringifyJson(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError('request history value must be JSON-serializable')
  return json
}
