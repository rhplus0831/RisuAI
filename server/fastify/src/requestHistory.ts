import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver.js'
import type { CompletionStreamFrame } from './generation/frames.js'

export const DEFAULT_REQUEST_HISTORY_LIMIT = 20
export const MAX_REQUEST_HISTORY_LIMIT = 10_000

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
  metadata: Record<string, unknown>
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
      error_text TEXT
    );
    CREATE INDEX IF NOT EXISTS request_history_started_at_idx
      ON request_history(started_at DESC);
  `)
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
  const metadata = structuredClone(input.metadata ?? {})
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
      input.source,
      JSON.stringify(input.profile),
      JSON.stringify(input.prompt),
      input.context ? JSON.stringify(input.context) : null,
      input.toggles ? JSON.stringify(input.toggles) : null,
      JSON.stringify(metadata),
    )
  pruneRequestHistory(input.db, limit)
  return { db: input.db, id, startedAt, metadata }
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
    completedAt?: number
  },
): void {
  if (!handle) return
  const completedAt = input.completedAt ?? Date.now()
  const metadata = {
    ...handle.metadata,
    ...(input.metadata ?? {}),
    durationMs: Math.max(0, completedAt - handle.startedAt),
  }
  try {
    handle.db
      .prepare(
        `UPDATE request_history
         SET completed_at = ?, status = ?, response_text = ?, metadata_json = ?, error_text = ?
         WHERE id = ?`,
      )
      .run(completedAt, input.status, input.response ?? '', JSON.stringify(metadata), input.error ?? null, handle.id)
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
    let response = ''
    let status: Exclude<RequestHistoryStatus, 'pending'> | null = null
    let error: string | undefined
    let responseMetadata: Record<string, unknown> = {}
    try {
      for await (const frame of frames) {
        if (frame.kind === 'token') response += frame.content ?? ''
        if (frame.kind === 'done') {
          status = 'success'
          responseMetadata = {
            ...(frame.finishReason ? { finishReason: frame.finishReason } : {}),
            ...(frame.alternates ? { alternates: frame.alternates } : {}),
            ...(frame.toolCalls ? { toolCalls: frame.toolCalls } : {}),
          }
        }
        if (frame.kind === 'error') {
          status = signal.aborted ? 'cancelled' : 'error'
          error = frame.error ?? 'Provider request failed'
          responseMetadata = {
            ...(frame.status !== undefined ? { providerStatus: frame.status } : {}),
            ...(frame.statusText ? { providerStatusText: frame.statusText } : {}),
            ...(frame.code ? { providerCode: frame.code } : {}),
            ...(frame.reason ? { providerReason: frame.reason } : {}),
          }
        }
        yield frame
      }
    } catch (caught) {
      status = signal.aborted ? 'cancelled' : 'error'
      error = caught instanceof Error ? caught.message : String(caught)
      throw caught
    } finally {
      const finalStatus = status ?? 'cancelled'
      completeRequestHistory(handle, {
        status: finalStatus,
        response,
        ...(error ? { error } : {}),
        metadata: {
          ...responseMetadata,
          responseCharacters: response.length,
          ...(status === null ? { incomplete: true } : {}),
        },
      })
    }
  })()
}

export function pruneRequestHistory(db: DatabaseSync, limitValue: unknown): number {
  const limit = normalizeRequestHistoryLimit(limitValue)
  if (limit === 0) {
    return Number(db.prepare('DELETE FROM request_history').run().changes)
  }
  return Number(
    db
      .prepare(
        `DELETE FROM request_history
         WHERE id IN (
           SELECT id FROM request_history
           ORDER BY started_at DESC, rowid DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(limit).changes,
  )
}

export function listRequestHistory(db: DatabaseSync, limitValue: unknown): RequestHistoryRecordSummary[] {
  const limit = normalizeRequestHistoryLimit(limitValue)
  pruneRequestHistory(db, limit)
  if (limit === 0) return []
  const rows = db
    .prepare(
      `SELECT id, started_at, completed_at, status, source, profile_json, prompt_json,
              context_json, toggles_json, response_text, metadata_json, error_text
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
              context_json, toggles_json, response_text, metadata_json, error_text
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
