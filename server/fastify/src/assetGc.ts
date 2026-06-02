import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  assetPath,
  assetsDir,
  deleteAssetMetadataByIds,
  getAllAssetMetadata,
  isValidAssetId,
  loadPersisted,
  loadPersistedWithMessages,
} from './repository.js'
import { buildRisuSaveAssetReport } from './risuSave/assetReferences.js'

// How often the periodic sweep runs. Asset GC is cheap but reads + (when it
// reclaims) rewrites db.json, so it runs well outside the request hot path.
export const ASSET_GC_INTERVAL_MS = 15 * 60_000

// An unreferenced asset must have been on disk (by file mtime) for at least this
// long before it is eligible for deletion. This closes the upload→reference
// race: an asset is uploaded by one request and referenced by a later mutation,
// so a sweep that runs in between must not reclaim the freshly-written bytes.
export const ASSET_GC_GRACE_MS = 60 * 60_000

export interface AssetGcOptions {
  /** SQLite connection used to hydrate chat-message references. */
  db?: DatabaseSync
  /** Minimum age (by file mtime) before an unreferenced asset may be deleted. */
  graceMs?: number
  /** Injectable clock (ms epoch) for tests. */
  now?: () => number
}

export interface AssetGcResult {
  /** sha256 ids whose metadata entry (and file, if present) were removed. */
  deletedAssetIds: string[]
  /** stray asset files (no metadata entry, unreferenced) that were removed. */
  deletedStrayFiles: string[]
  /** orphaned/stray candidates skipped because they are within the grace window. */
  skippedByGrace: number
  /** total orphaned metadata entries considered this run. */
  scannedOrphans: number
}

function fileAgeMs(file: string, now: number): number | null {
  try {
    const stat = fs.statSync(file)
    return now - stat.mtimeMs
  } catch {
    // File missing or unreadable.
    return null
  }
}

/**
 * Reference-counted, server-side asset garbage collection.
 *
 * Walks the in-memory persisted `Database` to compute the referenced asset set
 * (via the same walker `risuSave` uses for its orphan report), then deletes
 * content-addressed assets that nothing references — reference-counting across
 * the whole corpus, so a `sha256`-shared asset is only reclaimed at zero
 * references. A grace window (by file mtime) protects just-uploaded bytes.
 *
 * The metadata read-modify-write is fully synchronous (no `await`), so it is
 * atomic with respect to every other request handler in this single-threaded
 * process — the same property the command mutation path relies on. No revision
 * bump and no command event: an orphaned asset is by definition unreferenced by
 * the projected `Database`, so no client-visible state changes.
 */
export function runAssetGc(dataDir: string, opts: AssetGcOptions = {}): AssetGcResult {
  const graceMs = opts.graceMs ?? ASSET_GC_GRACE_MS
  const now = opts.now ? opts.now() : Date.now()

  const result: AssetGcResult = {
    deletedAssetIds: [],
    deletedStrayFiles: [],
    skippedByGrace: 0,
    scannedOrphans: 0,
  }

  if (!opts.db) return result

  const persisted = loadPersistedWithMessages(opts.db, dataDir)
  const assets = getAllAssetMetadata(opts.db)
  const report = buildRisuSaveAssetReport(persisted.database, assets)
  result.scannedOrphans = report.orphaned.length

  const referencedIds = new Set(report.referenced.map((reference) => reference.id))
  const deletedIds = new Set<string>()
  const filesToDelete: string[] = []

  for (const orphan of report.orphaned) {
    const file = assetPath(dataDir, orphan)
    const age = fileAgeMs(file, now)
    if (age === null) {
      deletedIds.add(orphan.id)
      result.deletedAssetIds.push(orphan.id)
      continue
    }
    if (age < graceMs) {
      result.skippedByGrace++
      continue
    }
    deletedIds.add(orphan.id)
    result.deletedAssetIds.push(orphan.id)
    filesToDelete.push(file)
  }

  if (deletedIds.size > 0) {
    deleteAssetMetadataByIds(opts.db, [...deletedIds])
  }

  for (const file of filesToDelete) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // ignore
    }
  }

  const storedIds = new Set(assets.map((asset) => asset.id))
  const dir = assetsDir(dataDir)
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    const id = name.replace(/\.[^.]+$/, '')
    if (!isValidAssetId(id)) continue
    if (storedIds.has(id) || referencedIds.has(id) || deletedIds.has(id)) continue
    const file = path.join(dir, name)
    const age = fileAgeMs(file, now)
    if (age === null) continue
    if (age < graceMs) {
      result.skippedByGrace++
      continue
    }
    try {
      fs.rmSync(file, { force: true })
      result.deletedStrayFiles.push(name)
    } catch {
      // ignore
    }
  }

  return result
}
