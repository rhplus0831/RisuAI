import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'
import {
  getServerCommandBaseRevision,
  setCachedServerCommandRevision,
  type CommandEvent,
} from './commands'

const REALM_IMPORT_ENDPOINT = '/api/v1/import/realm-character'

export type ServerRealmImportResult =
  | { status: 'ok'; revision: number; event: CommandEvent; characterId: string }
  | { status: 'low-level-access' }
  | { status: 'unsupported'; error: string }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export async function importRealmCharacterFromServer(
  id: string,
  options: { allowLowLevelAccess?: boolean; signal?: AbortSignal | null } = {},
): Promise<ServerRealmImportResult> {
  if (!isFastifyServer) return { status: 'unavailable' }

  const baseRevision = await getServerCommandBaseRevision(options.signal)
  if (baseRevision === null) {
    return { status: 'error', error: 'Unable to read server command revision' }
  }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(REALM_IMPORT_ENDPOINT, {
      method: 'POST',
      signal: options.signal ?? undefined,
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
        ...activeWriterSessionHeader(),
      },
      body: JSON.stringify({
        id,
        baseRevision,
        allowLowLevelAccess: options.allowLowLevelAccess === true,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON errors are surfaced by HTTP status handling below.
  }

  if (response.status === 409) {
    if (readBodyCode(body) === 'low_level_access_confirmation_required') {
      return { status: 'low-level-access' }
    }
    const currentRevision = readCurrentRevision(body)
    if (currentRevision !== null) setCachedServerCommandRevision(currentRevision)
    return currentRevision === null
      ? { status: 'error', error: errorMessageFromBody(body, 'HTTP 409') }
      : { status: 'conflict', currentRevision }
  }

  if (response.status === 415) {
    return { status: 'unsupported', error: errorMessageFromBody(body, 'Unsupported Realm download') }
  }

  if (handleActiveWriterStaleResponse(response)) {
    return { status: 'error', error: errorMessageFromBody(body, 'HTTP 423') }
  }

  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }

  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Invalid Realm import response' }
  }
  const record = body as Record<string, unknown>
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) {
    return { status: 'error', error: 'Invalid Realm import revision' }
  }
  if (!record.event || typeof record.event !== 'object') {
    return { status: 'error', error: 'Invalid Realm import event' }
  }
  if (typeof record.characterId !== 'string') {
    return { status: 'error', error: 'Invalid Realm import character id' }
  }

  const revision = record.revision as number
  setCachedServerCommandRevision(revision)
  return {
    status: 'ok',
    revision,
    event: record.event as CommandEvent,
    characterId: record.characterId,
  }
}

function readCurrentRevision(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const revision = (body as { currentRevision?: unknown }).currentRevision
  return Number.isInteger(revision) && (revision as number) >= 0 ? (revision as number) : null
}

function readBodyCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
