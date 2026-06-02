/**
 * Restore-and-analyze harness for the docs/plan protocol performance gates.
 *
 * Loads a real database snapshot into a throwaway temporary data directory and
 * reports the measurements that are fully derivable from a static database — the
 * "cost / shape" half of the remaining performance gates. It calls the same
 * server functions the routes call and times them directly, so the numbers match
 * the opt-in `RISU_PROTOCOL_METRICS` output without needing a running server.
 *
 * Reported here (static-DB-derivable):
 *   - Ordinary `.risu` export materialization: snapshot hydration vs encode cost
 *     and peak output bytes per envelope (Phase 5 gate).
 *   - Full-bootstrap / projection payload size: what one sprawling-resource
 *     full-bootstrap fallback ships (Phase 3 gate, cost half).
 *   - Asset inventory + per-character byte-fetch fanout (Phase 3 gate, cost half).
 *
 * NOT reported here (runtime-only): how OFTEN a fallback fires, browser cache hit
 * rate, and prompt-assembly stage timings under real sends. Get those by running
 * the real server with `RISU_PROTOCOL_METRICS=1`. See
 * docs/plan/active-risk-analysis.md.
 *
 * Inputs (auto-detected):
 *   - A `.risu` export file (richest single file — re-embeds chat messages).
 *   - A server `db.json` (note: message-free; messages live in SQLite).
 *   - A raw RisuAI database JSON object.
 *   - A `data/` directory (copied read-only; preserves messages + assets).
 *
 * Usage:
 *   pnpm analyze:db <path-to-.risu | db.json | database.json | data-dir> [--json]
 *   tsx util/analyze-database.ts <path> [--json]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { getSchemaState, openDatabase } from '../server/fastify/src/db.js'
import {
  loadPersisted,
  loadPersistedWithMessages,
  loadStubProjection,
  writePersistedWithMessages,
  type Persisted,
  type PersistedAsset,
} from '../server/fastify/src/repository.js'
import {
  buildRepositoryRisuSaveExportSnapshot,
  encodeRisuSaveBlockExportSnapshot,
  encodeRisuSaveLegacyExportSnapshot,
  type RisuSaveExportSnapshot,
} from '../server/fastify/src/risuSave/exportSnapshot.js'
import { decodeRisuSaveImportSnapshot } from '../server/fastify/src/risuSave/importSnapshot.js'
import { buildRepositoryRisuSaveAssetReport } from '../server/fastify/src/risuSave/assetReferences.js'
import { maskProviderSecrets } from '../server/fastify/src/providerSecrets.js'
import { jsonPayloadBytes } from '../server/fastify/src/protocolMetrics.js'

// The SQLite files a real `data/` dir carries alongside db.json.
const DB_SIDECARS = ['risu.db', 'risu.db-wal', 'risu.db-shm']

interface ExportEnvelopeResult {
  envelope: string
  encodeMs: number
  outputBytes: number
}

interface CharacterFanout {
  index: number
  name: string
  distinctAssets: number
}

export interface DatabaseAnalysis {
  source: string
  corpus: {
    characters: number
    chats: number
    messages: number
    storedAssets: number
  }
  export: {
    snapshotLoadMs: number
    envelopes: ExportEnvelopeResult[]
    peakOutputBytes: number
    peakEnvelope: string
  }
  bootstrap: {
    stubLoadMs: number
    payloadBytes: number
    revision: number
    schemaVersion: number
  }
  assets: {
    storedCount: number
    storedBytes: number
    referencedCount: number
    missingCount: number
    orphanedCount: number
    byContentType: Array<{ contentType: string; count: number; bytes: number }>
    largest: Array<{ id: string; contentType: string; bytes: number }>
    worstCharacterFanout: CharacterFanout[]
  }
}

function timeMs<T>(fn: () => T): [T, number] {
  const start = performance.now()
  const result = fn()
  return [result, Math.round((performance.now() - start) * 100) / 100]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Coerce a parsed JSON value into a `Persisted` snapshot. */
function coercePersisted(parsed: unknown): Persisted {
  const record = readRecord(parsed)
  if (record && 'database' in record) {
    return {
      _version: typeof record._version === 'number' ? record._version : 1,
      database: record.database ?? null,
      assets: Array.isArray(record.assets) ? (record.assets as PersistedAsset[]) : [],
    }
  }
  // A raw database object (welcome screen export, dev fixture, etc.).
  return { _version: 1, database: parsed ?? null, assets: [] }
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Resolve the CLI input into a temp data dir that the server functions can read.
 * Returns the temp dir, an open db handle, and a human-readable source label.
 */
function prepareDataDir(inputPath: string): { dataDir: string; source: string; cleanup: boolean } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-analyze-'))
  const stat = fs.statSync(inputPath)

  if (stat.isDirectory()) {
    const dbJson = path.join(inputPath, 'db.json')
    if (!fs.existsSync(dbJson)) {
      throw new Error(`Directory has no db.json: ${inputPath}`)
    }
    // Copy db.json + the SQLite sidecars so messages, revision, and asset
    // metadata are all preserved and the original directory is never touched.
    fs.copyFileSync(dbJson, path.join(tmpDir, 'db.json'))
    for (const sidecar of DB_SIDECARS) {
      const from = path.join(inputPath, sidecar)
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(tmpDir, sidecar))
    }
    return { dataDir: tmpDir, source: `data dir (${inputPath})`, cleanup: true }
  }

  const raw = fs.readFileSync(inputPath)
  const asText = raw.toString('utf8')
  const parsed = tryParseJson(asText)
  if (parsed !== undefined) {
    const persisted = coercePersisted(parsed)
    // `writePersistedWithMessages` splits chat messages into SQLite and mutates
    // its argument in place, so measure embedded messages before seeding.
    const hasDatabase = readRecord(persisted.database) !== null
    const embeddedMessages = countMessages(persisted.database)
    const db = openDatabase(tmpDir)
    try {
      writePersistedWithMessages(db, tmpDir, persisted)
    } finally {
      db.close()
    }
    const messageFree = hasDatabase && embeddedMessages === 0 ? ' (message-free)' : ''
    return { dataDir: tmpDir, source: `json file${messageFree}`, cleanup: true }
  }

  // Binary `.risu` export.
  const snapshot = decodeRisuSaveImportSnapshot(new Uint8Array(raw))
  const db = openDatabase(tmpDir)
  try {
    writePersistedWithMessages(db, tmpDir, { _version: 1, database: snapshot.database, assets: [] })
  } finally {
    db.close()
  }
  return { dataDir: tmpDir, source: `.risu export (${snapshot.envelope})`, cleanup: true }
}

function countMessages(database: unknown): number {
  let total = 0
  for (const character of readArray(readRecord(database)?.characters)) {
    for (const chat of readArray(readRecord(character)?.chats)) {
      total += readArray(readRecord(chat)?.message).length
    }
  }
  return total
}

function countCharactersAndChats(database: unknown): { characters: number; chats: number } {
  const characters = readArray(readRecord(database)?.characters)
  let chats = 0
  for (const character of characters) {
    chats += readArray(readRecord(character)?.chats).length
  }
  return { characters: characters.length, chats }
}

function characterNames(database: unknown): string[] {
  return readArray(readRecord(database)?.characters).map((character, index) => {
    const name = readRecord(character)?.name
    return typeof name === 'string' && name.trim() !== '' ? name : `character[${index}]`
  })
}

/** Distinct referenced asset ids grouped by `database.characters[N]`. */
function characterAssetFanout(
  referenced: Array<{ id: string; paths: string[] }>,
  names: string[],
): CharacterFanout[] {
  const perCharacter = new Map<number, Set<string>>()
  for (const reference of referenced) {
    for (const refPath of reference.paths) {
      const match = /^database\.characters\[(\d+)\]/.exec(refPath)
      if (!match) continue
      const index = Number(match[1])
      const set = perCharacter.get(index) ?? new Set<string>()
      set.add(reference.id)
      perCharacter.set(index, set)
    }
  }
  return [...perCharacter.entries()]
    .map(([index, ids]) => ({
      index,
      name: names[index] ?? `character[${index}]`,
      distinctAssets: ids.size,
    }))
    .sort((a, b) => b.distinctAssets - a.distinctAssets)
}

export function analyzeDataDir(dataDir: string, source: string): DatabaseAnalysis {
  const db = openDatabase(dataDir)
  try {
    const hydrated = loadPersistedWithMessages(db, dataDir).database
    const { characters, chats } = countCharactersAndChats(hydrated)
    const messages = countMessages(hydrated)

    // --- Export materialization (Phase 5 gate) ---
    const [snapshot, snapshotLoadMs] = timeMs<RisuSaveExportSnapshot>(() =>
      buildRepositoryRisuSaveExportSnapshot(db, dataDir),
    )
    const envelopeRunners: Array<{ envelope: string; run: () => Uint8Array }> = [
      { envelope: 'risusave-blocks', run: () => encodeRisuSaveBlockExportSnapshot(snapshot, {}) },
      {
        envelope: 'risusave-blocks+gzip',
        run: () => encodeRisuSaveBlockExportSnapshot(snapshot, { compression: true }),
      },
      {
        envelope: 'legacy-raw',
        run: () => encodeRisuSaveLegacyExportSnapshot(snapshot, 'legacy-raw'),
      },
      {
        envelope: 'legacy-compressed',
        run: () => encodeRisuSaveLegacyExportSnapshot(snapshot, 'legacy-compressed'),
      },
    ]
    const envelopes: ExportEnvelopeResult[] = envelopeRunners.map(({ envelope, run }) => {
      const [bytes, encodeMs] = timeMs(run)
      return { envelope, encodeMs, outputBytes: bytes.byteLength }
    })
    const peak = envelopes.reduce((max, row) => (row.outputBytes > max.outputBytes ? row : max))

    // --- Full-bootstrap / projection payload (Phase 3 sprawling-resource gate) ---
    const [stub, stubLoadMs] = timeMs(() => loadStubProjection(db, dataDir))
    const { version, revision } = getSchemaState(db)
    const bootstrapResponse = {
      revision,
      schemaVersion: version,
      database: maskProviderSecrets(stub.database),
      assetBaseUrl: '/api/v1/assets',
      activeGenerationJobs: [],
    }
    const bootstrapBytes = jsonPayloadBytes(bootstrapResponse) ?? 0

    // --- Asset inventory + fanout (Phase 3 asset-byte gate) ---
    const persisted = loadPersisted(dataDir)
    const storedAssets = persisted.assets
    const storedBytes = storedAssets.reduce((sum, asset) => sum + (asset.size ?? 0), 0)
    const byTypeMap = new Map<string, { count: number; bytes: number }>()
    for (const asset of storedAssets) {
      const entry = byTypeMap.get(asset.contentType) ?? { count: 0, bytes: 0 }
      entry.count += 1
      entry.bytes += asset.size ?? 0
      byTypeMap.set(asset.contentType, entry)
    }
    const report = buildRepositoryRisuSaveAssetReport(dataDir, db)
    const names = characterNames(hydrated)
    const largest = [...storedAssets]
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 5)
      .map((asset) => ({ id: asset.id, contentType: asset.contentType, bytes: asset.size ?? 0 }))

    return {
      source,
      corpus: { characters, chats, messages, storedAssets: storedAssets.length },
      export: {
        snapshotLoadMs,
        envelopes,
        peakOutputBytes: peak.outputBytes,
        peakEnvelope: peak.envelope,
      },
      bootstrap: { stubLoadMs, payloadBytes: bootstrapBytes, revision, schemaVersion: version },
      assets: {
        storedCount: storedAssets.length,
        storedBytes,
        referencedCount: report.referencedCount,
        missingCount: report.missingCount,
        orphanedCount: report.orphanedCount,
        byContentType: [...byTypeMap.entries()]
          .map(([contentType, value]) => ({ contentType, ...value }))
          .sort((a, b) => b.bytes - a.bytes),
        largest,
        worstCharacterFanout: characterAssetFanout(report.referenced, names).slice(0, 5),
      },
    }
  } finally {
    db.close()
  }
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]} (${bytes.toLocaleString('en-US')} B)`
}

function printReport(analysis: DatabaseAnalysis): void {
  const lines: string[] = []
  lines.push('RisuAI database analysis')
  lines.push(`source: ${analysis.source}`)
  lines.push(
    `corpus: ${analysis.corpus.characters} characters, ${analysis.corpus.chats} chats, ` +
      `${analysis.corpus.messages.toLocaleString('en-US')} messages, ` +
      `${analysis.corpus.storedAssets} stored assets`,
  )

  lines.push('')
  lines.push('== Export materialization (Phase 5 gate) ==')
  lines.push(`snapshot hydration: ${analysis.export.snapshotLoadMs} ms`)
  lines.push('  envelope               output            encode')
  for (const row of analysis.export.envelopes) {
    lines.push(
      `  ${row.envelope.padEnd(22)} ${humanBytes(row.outputBytes).padEnd(26)} ${row.encodeMs} ms`,
    )
  }
  lines.push(
    `peak materialized buffer: ${humanBytes(analysis.export.peakOutputBytes)} ` +
      `(${analysis.export.peakEnvelope})`,
  )
  lines.push(
    '  interpretation: a streaming `.risu` writer only pays off when this peak is large ' +
      'enough\n  to be real memory pressure (tens of MB+); below that the materialized buffer is fine.',
  )

  lines.push('')
  lines.push('== Full-bootstrap / projection payload (Phase 3 sprawling-resource gate) ==')
  lines.push(`stub projection load: ${analysis.bootstrap.stubLoadMs} ms`)
  lines.push(
    `full-bootstrap payload: ${humanBytes(analysis.bootstrap.payloadBytes)} ` +
      `(revision ${analysis.bootstrap.revision}, schema v${analysis.bootstrap.schemaVersion})`,
  )
  lines.push(
    '  interpretation: this is the message-light payload one sprawling-resource fallback ' +
      'ships.\n  Multiply by how often `settings`/`state`/`pluginStorage` events actually fire ' +
      '(a runtime\n  signal) to judge whether a targeted-resource projection is worth it.',
  )

  lines.push('')
  lines.push('== Asset inventory + fanout (Phase 3 asset-byte gate) ==')
  lines.push(
    `stored: ${analysis.assets.storedCount} assets, ${humanBytes(analysis.assets.storedBytes)}`,
  )
  lines.push(
    `references: ${analysis.assets.referencedCount} referenced, ` +
      `${analysis.assets.missingCount} missing, ${analysis.assets.orphanedCount} orphaned`,
  )
  if (analysis.assets.byContentType.length > 0) {
    lines.push('  by content-type:')
    for (const row of analysis.assets.byContentType) {
      lines.push(`    ${row.contentType.padEnd(22)} ${row.count} × ${humanBytes(row.bytes)}`)
    }
  }
  if (analysis.assets.worstCharacterFanout.length > 0) {
    lines.push('  worst-case open fanout (distinct assets a character references):')
    for (const row of analysis.assets.worstCharacterFanout) {
      lines.push(`    ${row.name.padEnd(28)} ${row.distinctAssets} assets`)
    }
  }
  lines.push(
    '  interpretation: each distinct asset is one `GET /api/v1/assets/:id`. The route sets ' +
      '`immutable`\n  cache headers, so repeated opens are browser-cache hits; a bulk-byte ' +
      'route only pays off if a\n  real session shows high uncached repeated reads (a runtime signal).',
  )

  lines.push('')
  lines.push('== Not covered here (runtime-only) ==')
  lines.push(
    '  - fallback FREQUENCY, browser cache hit rate, and prompt-assembly stage timings under',
  )
  lines.push('    real sends are session signals a static database cannot reconstruct.')
  lines.push(
    '  - capture them by running the real server with RISU_PROTOCOL_METRICS=1 during normal use;',
  )
  lines.push(
    '    the projection_response / asset_byte_read / risusave_export lines land in the log.',
  )
  lines.push('  - see docs/plan/active-risk-analysis.md and docs/plan/next-steps.md.')

  console.log(lines.join('\n'))
}

function main(): void {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const inputPath = args.find((arg) => !arg.startsWith('--'))
  if (!inputPath) {
    console.error(
      'Usage: pnpm analyze:db <path-to-.risu | db.json | database.json | data-dir> [--json]',
    )
    process.exit(2)
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`)
    process.exit(2)
  }

  let prepared: { dataDir: string; source: string; cleanup: boolean } | null = null
  try {
    prepared = prepareDataDir(inputPath)
    const analysis = analyzeDataDir(prepared.dataDir, prepared.source)
    if (asJson) {
      console.log(JSON.stringify(analysis, null, 2))
    } else {
      printReport(analysis)
    }
  } catch (err) {
    console.error(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    if (prepared?.cleanup) {
      fs.rmSync(prepared.dataDir, { recursive: true, force: true })
    }
  }
}

// Only run the CLI when executed directly, so tests can import `analyzeDataDir`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
