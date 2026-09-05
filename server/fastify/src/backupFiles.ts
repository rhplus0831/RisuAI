import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { PersistedAsset } from './repository.js'

export const BACKUP_COPY_CONCURRENCY = 2
// At most 32 open directory levels, each buffering 64 Dirents: the traversal
// never retains a corpus-sized directory array or an unbounded directory stack.
export const BACKUP_DIRECTORY_BUFFER_SIZE = 64
export const BACKUP_DIRECTORY_DEPTH_LIMIT = 32
export const BACKUP_HASH_BUFFER_BYTES = 64 * 1024

export class BackupAssetError extends Error {
  readonly code = 'backup_asset_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'BackupAssetError'
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Two consumers, no corpus-sized promise/task queue. Settle every started
 * filesystem operation before the caller can clean the staging directory. */
async function consumeBounded<T>(
  entries: AsyncIterable<T> | Iterable<T>,
  signal: AbortSignal,
  consume: (entry: T, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const iterator = (async function* () {
    yield* entries
  })()
  let failure: unknown
  const worker = async () => {
    try {
      while (true) {
        combined.throwIfAborted()
        const next = await iterator.next()
        if (next.done) return
        await consume(next.value, combined)
      }
    } catch (error) {
      if (failure === undefined) failure = error
      controller.abort()
    }
  }
  await Promise.all(Array.from({ length: BACKUP_COPY_CONCURRENCY }, worker))
  await iterator.return?.(undefined)
  if (failure !== undefined) throw failure
}

async function verifyAsset(file: string, asset: PersistedAsset, signal: AbortSignal): Promise<void> {
  const stat = await fs.promises.stat(file)
  if (!stat.isFile() || stat.size !== asset.size) throw new BackupAssetError(`Backup asset size mismatch: ${asset.id}`)
  const hash = createHash('sha256')
  // The destination is private to this lease and no writer can change it.
  // Small verified-size files need one bounded buffer, avoiding stream/event
  // machinery for the common icon/inlay case. Large files stay streamed.
  if (stat.size <= BACKUP_HASH_BUFFER_BYTES) {
    hash.update(await fs.promises.readFile(file, { signal }))
  } else {
    for await (const chunk of fs.createReadStream(file, { highWaterMark: BACKUP_HASH_BUFFER_BYTES, signal })) {
      hash.update(chunk)
    }
  }
  if (hash.digest('hex') !== asset.id) throw new BackupAssetError(`Backup asset hash mismatch: ${asset.id}`)
}

interface CopyEntry {
  from: string
  to: string
  symbolicLink: boolean
}

async function* directoryEntries(
  from: string,
  to: string,
  signal: AbortSignal,
  skip: { has(name: string): boolean } = new Set(),
  depth = 0,
): AsyncGenerator<CopyEntry> {
  if (depth >= BACKUP_DIRECTORY_DEPTH_LIMIT) throw new Error('backup_directory_depth_exceeded')
  let directory: fs.Dir
  try {
    directory = await fs.promises.opendir(from, { bufferSize: BACKUP_DIRECTORY_BUFFER_SIZE })
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  try {
    await fs.promises.mkdir(to, { recursive: true })
    while (true) {
      signal.throwIfAborted()
      const entry = await directory.read()
      if (!entry) return
      if (skip.has(entry.name)) continue
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isDirectory()) {
        yield* directoryEntries(source, target, signal, new Set(), depth + 1)
      } else {
        yield { from: source, to: target, symbolicLink: entry.isSymbolicLink() }
      }
    }
  } finally {
    await directory.close()
  }
}

/** Preserve legacy directory extras and symlinks, without following symlinks
 * recursively. Concurrent immutable uploads may be observed as unindexed extras. */
export async function copyBackupDirectory(
  from: string,
  to: string,
  signal: AbortSignal,
  skip?: { has(name: string): boolean },
): Promise<void> {
  await consumeBounded(directoryEntries(from, to, signal, skip), signal, async (entry, copySignal) => {
    copySignal.throwIfAborted()
    if (entry.symbolicLink) {
      await fs.promises.symlink(await fs.promises.readlink(entry.from), entry.to)
    } else {
      await fs.promises.copyFile(entry.from, entry.to)
    }
    copySignal.throwIfAborted()
  })
}

/** Snapshot metadata is immutable. A missing required live file may be supplied
 * only by the pinned source of this restore's automatic safety snapshot; all
 * such fallback bytes must match the live snapshot's hash and declared size. */
export async function copyBackupAssets(options: {
  from: string
  to: string
  assets: AsyncIterable<PersistedAsset> | Iterable<PersistedAsset>
  requiredIds: { has(id: string): boolean }
  signal: AbortSignal
  restoreFallbackDir?: string
}): Promise<void> {
  const { from, to, assets, requiredIds, signal, restoreFallbackDir } = options
  await fs.promises.mkdir(to, { recursive: true })
  await consumeBounded(assets, signal, async (asset, copySignal) => {
    const name = `${asset.id}.${asset.ext}`
    const target = path.join(to, name)
    try {
      await fs.promises.copyFile(path.join(from, name), target)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (!requiredIds.has(asset.id)) return
      if (!restoreFallbackDir) throw new BackupAssetError(`Required backup asset is missing: ${asset.id}`)
      try {
        await fs.promises.copyFile(path.join(restoreFallbackDir, name), target)
      } catch (fallbackError) {
        if (!isMissing(fallbackError)) throw fallbackError
        throw new BackupAssetError(`Required backup asset is missing from live and restore source: ${asset.id}`)
      }
    }
    copySignal.throwIfAborted()
    // Existing orphan files are preserved verbatim, including pre-existing
    // damage. Referenced bytes must be recoverable before publication.
    if (requiredIds.has(asset.id)) await verifyAsset(target, asset, copySignal)
  })
  // Copied metadata-owned files already exist at the destination. Use their
  // presence instead of retaining a corpus-sized filename Set for the extras.
  await copyBackupDirectory(from, to, signal, { has: (name) => fs.existsSync(path.join(to, name)) })
}
