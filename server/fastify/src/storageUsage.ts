import { lstat, opendir, realpath, statfs } from 'node:fs/promises'
import path from 'node:path'
import {
  STORAGE_USAGE_CATEGORIES,
  type StorageUsageCategory,
  type StorageUsageResponse,
} from '@risuai/protocol/storage-usage'

function categoryFor(name: string): StorageUsageCategory {
  if (name === 'risu.db') return 'database'
  if (name === 'risu.db-wal' || name === 'risu.db-shm' || name === 'risu.db-journal') return 'journal'
  if (name === 'assets') return 'assets'
  if (name === 'backups') return 'backups'
  if (name === 'save') return 'legacy'
  if (name === 'trace') return 'logs'
  return 'other'
}

/** Read file lengths without loading user content or blocking SQLite. This is
 * a live estimate, not an atomic snapshot or a measure of allocated blocks. */
export async function measureStorageUsage(dataDir: string, signal?: AbortSignal): Promise<StorageUsageResponse> {
  const categories: StorageUsageResponse['categories'] = {
    database: 0,
    journal: 0,
    assets: 0,
    backups: 0,
    legacy: 0,
    logs: 0,
    other: 0,
  }
  let partial = false
  // Only multiply-linked files need tracking; ordinary asset catalogs stay bounded.
  const linkedFiles = new Map<string, { category: StorageUsageCategory; bytes: number }>()
  const priority: StorageUsageCategory[] = ['database', 'journal', 'assets', 'legacy', 'logs', 'other', 'backups']

  async function visit(filePath: string, category?: StorageUsageCategory, depth = 0): Promise<void> {
    signal?.throwIfAborted()
    try {
      const stat = await lstat(filePath)
      if (stat.isSymbolicLink()) {
        // Never walk outside the configured tree or loop through directory links.
        partial = true
      } else if (stat.isDirectory()) {
        if (depth >= 64) {
          partial = true
          return
        }
        const directory = await opendir(filePath, { bufferSize: 32 })
        for await (const entry of directory) {
          await visit(path.join(filePath, entry.name), category ?? categoryFor(entry.name), depth + 1)
        }
      } else if (stat.isFile() && category) {
        if (stat.nlink > 1) {
          const key = `${stat.dev}:${stat.ino}`
          const existing = linkedFiles.get(key)
          if (existing) {
            // Directory enumeration order must not assign live data to backups.
            if (priority.indexOf(category) < priority.indexOf(existing.category)) {
              categories[existing.category] -= existing.bytes
              categories[category] += existing.bytes
              existing.category = category
            }
            return
          }
          linkedFiles.set(key, { category, bytes: stat.size })
        }
        categories[category] += stat.size
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (depth === 0) throw error
      // Includes files removed by backup/GC while scanning and unreadable trees.
      partial = true
    }
  }

  // The configured root itself may be a symlink to the intended data volume.
  const root = await realpath(dataDir)
  await visit(root)
  signal?.throwIfAborted()
  let disk: StorageUsageResponse['disk'] = null
  try {
    const stats = await statfs(root)
    const totalBytes = stats.blocks * stats.bsize
    const availableBytes = Math.max(0, stats.bavail * stats.bsize)
    if (Number.isSafeInteger(totalBytes) && totalBytes > 0 && Number.isSafeInteger(availableBytes)) {
      disk = { totalBytes, availableBytes: Math.min(totalBytes, availableBytes) }
    }
  } catch {
    // Some platforms/filesystems cannot report capacity; file totals still work.
  }
  return {
    measuredAt: Date.now(),
    totalBytes: STORAGE_USAGE_CATEGORIES.reduce((sum, key) => sum + categories[key], 0),
    categories,
    disk,
    partial,
  }
}
