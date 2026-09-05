import fs from 'node:fs'
import path from 'node:path'
import type { PersistedAsset } from './repository.js'
import { BackupCopyPool } from './backupCopyPool.js'
import { BACKUP_COPY_BATCH_SIZE, BACKUP_COPY_CONCURRENCY, type BackupCopyEntry } from './backupCopyProtocol.js'

export {
  BackupAssetError,
  BACKUP_COPY_CONCURRENCY,
  BACKUP_COPY_BATCH_SIZE,
  BACKUP_HASH_BUFFER_BYTES,
} from './backupCopyProtocol.js'
// At most 32 open directory levels, each buffering 64 Dirents: the traversal
// never retains a corpus-sized directory array or an unbounded directory stack.
export const BACKUP_DIRECTORY_BUFFER_SIZE = 64
export const BACKUP_DIRECTORY_DEPTH_LIMIT = 32

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Each consumer builds only its next batch. On failure, stop discovery and
 * settle both started batches before returning ownership to the caller. */
async function consumeBounded(
  entries: AsyncIterable<BackupCopyEntry>,
  signal: AbortSignal,
  pool: BackupCopyPool,
): Promise<void> {
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const iterator = entries[Symbol.asyncIterator]()
  let failure: unknown
  const consume = async () => {
    try {
      while (true) {
        const batch: BackupCopyEntry[] = []
        while (batch.length < BACKUP_COPY_BATCH_SIZE) {
          combined.throwIfAborted()
          const next = await iterator.next()
          if (next.done) break
          batch.push(next.value)
        }
        if (!batch.length) return
        combined.throwIfAborted()
        await pool.runBatch(batch)
      }
    } catch (error) {
      if (failure === undefined) failure = error
      controller.abort()
      pool.abort()
    }
  }
  await Promise.all(Array.from({ length: BACKUP_COPY_CONCURRENCY }, consume))
  await iterator.return?.()
  if (failure !== undefined) throw failure
}

async function* directoryEntries(
  from: string,
  to: string,
  signal: AbortSignal,
  skip: { has(name: string): boolean } = new Set(),
  depth = 0,
): AsyncGenerator<BackupCopyEntry> {
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
        yield { kind: 'file', from: source, to: target, symbolicLink: entry.isSymbolicLink() }
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
  pool: BackupCopyPool,
  skip?: { has(name: string): boolean },
): Promise<void> {
  await consumeBounded(directoryEntries(from, to, signal, skip), signal, pool)
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
  pool: BackupCopyPool
  restoreFallbackDir?: string
}): Promise<void> {
  const { from, to, assets, requiredIds, signal, pool, restoreFallbackDir } = options
  await fs.promises.mkdir(to, { recursive: true })
  async function* entries(): AsyncGenerator<BackupCopyEntry> {
    for await (const asset of assets) {
      signal.throwIfAborted()
      const name = `${asset.id}.${asset.ext}`
      yield {
        kind: 'asset',
        from: path.join(from, name),
        to: path.join(to, name),
        id: asset.id,
        size: asset.size,
        required: requiredIds.has(asset.id),
        ...(restoreFallbackDir ? { fallback: path.join(restoreFallbackDir, name) } : {}),
      }
    }
  }
  await consumeBounded(entries(), signal, pool)
  // Copied metadata-owned files already exist at the destination. Use their
  // presence instead of retaining a corpus-sized filename Set for the extras.
  await copyBackupDirectory(from, to, signal, pool, { has: (name) => fs.existsSync(path.join(to, name)) })
}
