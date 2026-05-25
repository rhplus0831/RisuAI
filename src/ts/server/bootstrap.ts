import type { Database } from '../storage/database.svelte'
import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'
import { setCachedServerCommandRevision } from './commands'

const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'

export interface ServerBootstrapProjection {
  revision: number
  schemaVersion?: number
  database: Database | null
  assetBaseUrl?: string
}

export type ServerBootstrapResult =
  | { status: 'ok'; projection: ServerBootstrapProjection }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerBootstrap(): boolean {
  return isFastifyServer
}

export async function fetchServerBootstrapProjection(
  signal?: AbortSignal | null,
): Promise<ServerBootstrapResult> {
  if (!canUseServerBootstrap()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: 'GET',
      signal: signal ?? undefined,
      headers: {
        'risu-auth': auth,
      },
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
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Invalid bootstrap response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid bootstrap revision' }
  }

  const database = record.database
  if (database !== null && (typeof database !== 'object' || Array.isArray(database))) {
    return { status: 'error', error: 'Invalid bootstrap database' }
  }

  setCachedServerCommandRevision(revision as number)

  return {
    status: 'ok',
    projection: {
      revision: revision as number,
      schemaVersion: Number.isInteger(record.schemaVersion)
        ? (record.schemaVersion as number)
        : undefined,
      database: database as Database | null,
      assetBaseUrl: typeof record.assetBaseUrl === 'string' ? record.assetBaseUrl : undefined,
    },
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
