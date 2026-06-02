import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'
import type { CommandEvent } from './commands'
import { forceServerProjectionResync } from './projectionResync'

const BACKUPS_ENDPOINT = '/api/v1/backups'
const BUNDLE_EXPORT_ENDPOINT = '/api/v1/export/bundle'
const BUNDLE_IMPORT_ENDPOINT = '/api/v1/import/bundle'
const DEFAULT_BUNDLE_FILENAME = 'database.risu.zip'

export interface ServerBackupManifest {
  _version: number
  id: string
  label: string | null
  createdAt: string
  revision: number
  assetCount: number
}

export type ServerBackupResult<T> =
  | ({ status: 'ok' } & T)
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerBackups(): boolean {
  return true
}

export async function createServerBackup(
  input: {
    label?: string | null
    signal?: AbortSignal | null
  } = {},
): Promise<ServerBackupResult<{ backup: ServerBackupManifest }>> {
  return requestServerBackupJson('', {
    method: 'POST',
    body: { label: input.label ?? null },
    signal: input.signal,
    validate: readBackupManifest,
    map: (backup) => ({ backup }),
  })
}

export async function listServerBackups(
  signal?: AbortSignal | null,
): Promise<ServerBackupResult<{ backups: ServerBackupManifest[] }>> {
  return requestServerBackupJson('', {
    method: 'GET',
    signal,
    validate: (body) => {
      if (!body || typeof body !== 'object') return null
      const backups = (body as { backups?: unknown }).backups
      if (!Array.isArray(backups)) return null
      const parsed = backups.map(readBackupManifest)
      return parsed.every((backup): backup is ServerBackupManifest => backup !== null)
        ? parsed
        : null
    },
    map: (backups) => ({ backups }),
  })
}

export async function restoreServerBackup(input: {
  id: string
  signal?: AbortSignal | null
}): Promise<ServerBackupResult<{ revision: number; event?: CommandEvent }>> {
  const restored = await requestServerBackupJson(`/${encodeURIComponent(input.id)}/restore`, {
    method: 'POST',
    signal: input.signal,
    validate: (body) => {
      if (!body || typeof body !== 'object') return null
      const record = body as { revision?: unknown; event?: unknown }
      if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
      if (record.event !== undefined && !isCommandEvent(record.event)) return null
      return {
        revision: record.revision as number,
        ...(isCommandEvent(record.event) ? { event: record.event } : {}),
      }
    },
    map: (result) => result,
  })
  if (restored.status !== 'ok') return restored

  const resync = await forceServerProjectionResync('backup-restore')
  if (resync.status !== 'ok') {
    return {
      status: 'error',
      error:
        resync.status === 'unavailable'
          ? 'Backup restored, but server bootstrap is unavailable; reload to refresh projection state.'
          : `Backup restored, but projection refresh failed: ${resync.error}`,
    }
  }

  return restored
}

export async function deleteServerBackup(input: {
  id: string
  signal?: AbortSignal | null
}): Promise<ServerBackupResult<{ id: string }>> {
  return requestServerBackupJson(`/${encodeURIComponent(input.id)}`, {
    method: 'DELETE',
    signal: input.signal,
    validate: (body) => {
      if (!body || typeof body !== 'object') return null
      const id = (body as { id?: unknown }).id
      return typeof id === 'string' ? { id } : null
    },
    map: (result) => result,
  })
}

/**
 * Download the server's full `.risu.zip` bundle (database + referenced asset
 * files) so the caller can save it to the user's device. This is the server-
 * backed replacement for the original "Save Backup Locally" feature: the bytes
 * are produced by the server's bundle export and never read from browser-local
 * persistence.
 */
export async function exportServerBundle(
  signal?: AbortSignal | null,
): Promise<ServerBackupResult<{ blob: Blob; filename: string }>> {
  if (!canUseServerBackups()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(BUNDLE_EXPORT_ENDPOINT, {
      method: 'GET',
      signal: signal ?? undefined,
      headers: { 'risu-auth': auth },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Fall back to the status code below for non-JSON failures.
    }
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }

  // Read as a Blob (not an ArrayBuffer) so the browser can back large backups
  // by disk instead of holding the whole bundle in a single buffer.
  const blob = await response.blob()
  return {
    status: 'ok',
    blob,
    filename:
      filenameFromContentDisposition(response.headers.get('content-disposition')) ??
      DEFAULT_BUNDLE_FILENAME,
  }
}

/**
 * Upload a `.risu.zip` bundle the user selected from their device and restore it
 * on the server (registers bundled assets, replaces the database), then refresh
 * the local projection. This is the server-backed replacement for the original
 * "Load Backup Locally" feature.
 */
export async function importServerBundle(input: {
  file: Blob
  filename?: string
  signal?: AbortSignal | null
}): Promise<ServerBackupResult<{ revision: number; event?: CommandEvent }>> {
  if (!canUseServerBackups()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  const form = new FormData()
  form.append('file', input.file, input.filename ?? DEFAULT_BUNDLE_FILENAME)

  let response: Response
  try {
    // Let the browser set the multipart content-type (with boundary) for the
    // FormData body; an explicit content-type header would break the upload.
    response = await fetch(BUNDLE_IMPORT_ENDPOINT, {
      method: 'POST',
      signal: input.signal ?? undefined,
      headers: { 'risu-auth': auth, ...activeWriterSessionHeader() },
      body: form,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // HTTP status handling below reports non-JSON failures.
  }

  if (!response.ok) {
    handleActiveWriterStaleResponse(response)
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }

  const imported = readBundleImportResult(body)
  if (imported === null) {
    return { status: 'error', error: 'Invalid bundle import response' }
  }

  const resync = await forceServerProjectionResync('bundle-restore')
  if (resync.status !== 'ok') {
    return {
      status: 'error',
      error:
        resync.status === 'unavailable'
          ? 'Backup imported, but server bootstrap is unavailable; reload to refresh projection state.'
          : `Backup imported, but projection refresh failed: ${resync.error}`,
    }
  }

  return { status: 'ok', ...imported }
}

function readBundleImportResult(body: unknown): { revision: number; event?: CommandEvent } | null {
  if (!body || typeof body !== 'object') return null
  const record = body as { revision?: unknown; event?: unknown }
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
  return {
    revision: record.revision as number,
    ...(isCommandEvent(record.event) ? { event: record.event } : {}),
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const match = /filename="?([^"]+)"?/i.exec(header)
  return match ? match[1] : null
}

async function requestServerBackupJson<T, R extends Record<string, unknown>>(
  path: string,
  init: {
    method: string
    body?: unknown
    signal?: AbortSignal | null
    validate: (body: unknown) => T | null
    map: (value: T) => R
  },
): Promise<ServerBackupResult<R>> {
  if (!canUseServerBackups()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${BACKUPS_ENDPOINT}${path}`, {
      method: init.method,
      signal: init.signal ?? undefined,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        'risu-auth': auth,
        ...activeWriterSessionHeader(),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // HTTP status handling below reports non-JSON failures.
  }

  if (!response.ok) {
    handleActiveWriterStaleResponse(response)
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }

  const parsed = init.validate(body)
  if (parsed === null) {
    return { status: 'error', error: 'Invalid backup response' }
  }

  return { status: 'ok', ...init.map(parsed) }
}

function readBackupManifest(value: unknown): ServerBackupManifest | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record._version !== 1) return null
  if (typeof record.id !== 'string') return null
  if (record.label !== null && typeof record.label !== 'string') return null
  if (typeof record.createdAt !== 'string') return null
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
  if (!Number.isInteger(record.assetCount) || (record.assetCount as number) < 0) return null
  return record as unknown as ServerBackupManifest
}

function isCommandEvent(value: unknown): value is CommandEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.type === 'string' &&
    Number.isInteger(record.revision) &&
    (record.revision as number) >= 0 &&
    typeof record.resource === 'string' &&
    (record.id === undefined || typeof record.id === 'string') &&
    (record.parentId === undefined || typeof record.parentId === 'string')
  )
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
