import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'
import type { CommandEvent } from './commands'
import { forceServerProjectionResync } from './projectionResync'

const BACKUPS_ENDPOINT = '/api/v1/backups'

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
  return isFastifyServer
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
