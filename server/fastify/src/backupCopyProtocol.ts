export const BACKUP_COPY_CONCURRENCY = 2
export const BACKUP_COPY_BATCH_SIZE = 16
export const BACKUP_HASH_BUFFER_BYTES = 64 * 1024

export class BackupAssetError extends Error {
  readonly code = 'backup_asset_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'BackupAssetError'
  }
}

/** Paths and captured metadata only. File payloads stay inside each worker. */
export type BackupCopyEntry =
  | { kind: 'file'; from: string; to: string; symbolicLink: boolean }
  | { kind: 'asset'; from: string; to: string; id: string; size: number; required: boolean; fallback?: string }

export interface BackupCopyWorkerData {
  cancellation: SharedArrayBuffer
  batchSize: number
  hashBufferBytes: number
}

export interface BackupCopyFailure {
  name: string
  message: string
  code?: string
}

export type BackupCopyRequest = { kind: 'copy'; entries: readonly BackupCopyEntry[] } | { kind: 'close' }
export type BackupCopyResponse = { kind: 'ready' } | { kind: 'copied'; error?: BackupCopyFailure }
