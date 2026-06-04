import { StatementSync } from 'node:sqlite'

/**
 * Server load-count harness (test-only).
 *
 * The stability/performance remediation plan (Phase 0,
 * `docs/plan/phases/slices/phase-0-baseline-foundations/measurement-baseline-harness.md`)
 * narrows server hot paths that today rebuild a broad in-memory `Database` from
 * SQLite (`loadPersisted` / `loadPersistedWithMessages` /
 * `loadCollectionsFromSqlite` / `getAllChatMessagesGrouped`). This module is
 * the server analog of the client's `cloneCostHarness.ts`: where that harness
 * spies the clone primitives (`JSON.stringify`, `structuredClone`), this one
 * spies the SQLite execution primitive (`StatementSync.prototype.all/get/
 * iterate`) and classifies each executed statement, so a test can assert a
 * scoped path performs zero whole-corpus payload reads.
 *
 * A statement counts as a whole-corpus load when it SELECTs a payload column
 * (`json` / `data_json` / `value_json`, or the assets metadata columns) from a
 * corpus table without a row-scoping predicate on that table's key column.
 * `SELECT chat_id, json FROM messages WHERE alternate = 0` counts;
 * `... WHERE chat_id IN (?, ?)` and id-only scans (`SELECT DISTINCT chat_id
 * FROM messages`) do not. The SQL text is the durable anchor — the loaders
 * prepare their statements per call, and counting at execution time also
 * covers any statement reuse.
 *
 * Test-only; never ship a runtime instrumentation hook. The spy is process
 * global while active, so keep background DB writers (asset GC, the memory
 * worker) disabled in the harness app and do not run instrumented sections
 * concurrently.
 */

interface CorpusTableSpec {
  /** Columns whose unscoped read means row payloads were materialized. */
  payloadColumns: readonly string[]
  /** Predicate columns that make a read row-scoped. */
  scopeColumns: readonly string[]
}

const COLLECTION_TABLES = [
  'modules',
  'plugins',
  'bot_presets',
  'prompt_templates',
  'personas',
  'loadouts',
  'lore_books',
  'translator_presets',
  'hypa_v3_presets',
] as const

export const CORPUS_TABLES: Readonly<Record<string, CorpusTableSpec>> = {
  // `uid` is the per-message id (indexed); a `WHERE uid = ?` lookup is a
  // single-row read, not a corpus scan.
  messages: { payloadColumns: ['json'], scopeColumns: ['chat_id', 'uid'] },
  chat_hypa_v3: { payloadColumns: ['json'], scopeColumns: ['chat_id'] },
  characters: { payloadColumns: ['data_json'], scopeColumns: ['id'] },
  chats: { payloadColumns: ['data_json'], scopeColumns: ['id', 'character_id'] },
  plugin_custom_storage: { payloadColumns: ['value_json'], scopeColumns: ['key'] },
  // Metadata-only, but the L5 finding is the unscoped full scan on every
  // command mutation, so an unscoped read of the metadata columns counts.
  assets: { payloadColumns: ['ext', 'size', 'content_type'], scopeColumns: ['id'] },
  ...Object.fromEntries(
    COLLECTION_TABLES.map((table) => [
      table,
      { payloadColumns: ['data_json'], scopeColumns: ['position'] },
    ]),
  ),
}

export interface CorpusLoadObservation {
  table: string
  method: 'all' | 'get' | 'iterate'
  sql: string
}

export interface ServerLoadInstrumentationResult<T> {
  result: T
  /** Every whole-corpus payload read executed inside `fn`, in order. */
  corpusLoads: CorpusLoadObservation[]
  corpusLoadCount: number
  loadCountByTable: Record<string, number>
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Classify one SQL statement. Returns the corpus table it whole-corpus-reads,
 * or `null` for writes, non-corpus tables, id-only scans, and row-scoped reads.
 */
export function classifyCorpusStatement(sql: string): { table: string } | null {
  const normalized = normalizeSql(sql)
  if (!normalized.startsWith('select')) return null
  const fromMatch = /\bfrom\s+([a-z0-9_]+)/.exec(normalized)
  if (!fromMatch) return null
  const table = fromMatch[1]
  const spec = CORPUS_TABLES[table]
  if (!spec) return null

  // Payload column must appear in the select list (before FROM); id-only
  // existence/count scans stay cheap and do not count.
  const selectList = normalized.slice(0, fromMatch.index)
  const readsPayload = spec.payloadColumns.some((column) =>
    new RegExp(`\\b${column}\\b`).test(selectList),
  )
  if (!readsPayload) return null

  // Any row-scoping predicate on a key column makes the read scoped.
  const scoped = spec.scopeColumns.some((column) =>
    new RegExp(`\\b${column}\\s*(=|in\\s*\\()`).test(normalized.slice(fromMatch.index)),
  )
  if (scoped) return null

  return { table }
}

type ExecMethod = 'all' | 'get' | 'iterate'
const EXEC_METHODS: readonly ExecMethod[] = ['all', 'get', 'iterate']

/**
 * Run `fn` (sync or async) while spying SQLite statement execution, returning
 * every whole-corpus payload read it performed. Restores the primitives in a
 * `finally`, so a throwing `fn` cannot leak the spy.
 */
export async function withServerLoadInstrumentation<T>(
  fn: () => T | Promise<T>,
): Promise<ServerLoadInstrumentationResult<T>> {
  const corpusLoads: CorpusLoadObservation[] = []
  const proto = StatementSync.prototype as unknown as Record<
    ExecMethod,
    (...args: unknown[]) => unknown
  >
  const originals = {
    all: proto.all,
    get: proto.get,
    iterate: proto.iterate,
  }

  for (const method of EXEC_METHODS) {
    const original = originals[method]
    proto[method] = function tracked(this: StatementSync, ...args: unknown[]) {
      const classified = classifyCorpusStatement(this.sourceSQL)
      if (classified) corpusLoads.push({ table: classified.table, method, sql: this.sourceSQL })
      return original.apply(this, args)
    }
  }

  try {
    const result = await fn()
    const loadCountByTable: Record<string, number> = {}
    for (const load of corpusLoads) {
      loadCountByTable[load.table] = (loadCountByTable[load.table] ?? 0) + 1
    }
    return { result, corpusLoads, corpusLoadCount: corpusLoads.length, loadCountByTable }
  } finally {
    for (const method of EXEC_METHODS) proto[method] = originals[method]
  }
}

export interface ScopedLoadOptions {
  /**
   * Corpus tables a path may legitimately read whole. Use sparingly and only
   * with a reason at the call site — the default is zero whole-corpus reads.
   */
  allowTables?: readonly string[]
}

/**
 * Assert `fn` is scoped: it performs zero whole-corpus payload reads (outside
 * `allowTables`). Throws with the offending SQL so the failing loader is
 * directly identifiable. Returns `fn`'s result.
 */
export async function assertScopedLoadOnHotPath<T>(
  fn: () => T | Promise<T>,
  options: ScopedLoadOptions = {},
): Promise<T> {
  const allowed = new Set(options.allowTables ?? [])
  const { result, corpusLoads } = await withServerLoadInstrumentation(fn)
  const offending = corpusLoads.filter((load) => !allowed.has(load.table))
  if (offending.length > 0) {
    const detail = offending
      .map((load) => `  - [${load.table}] ${load.method}: ${normalizeSql(load.sql)}`)
      .join('\n')
    throw new Error(
      `expected a scoped load but observed ${offending.length} whole-corpus payload read(s):\n${detail}`,
    )
  }
  return result
}
