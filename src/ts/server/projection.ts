import type { Database } from '../storage/database.svelte'
import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'

const PROJECTION_ENDPOINT = '/api/v1/projection'

export type ServerProjectionResourceResult =
  | { status: 'ok'; revision: number; mode: 'fields'; fields: Partial<Database> }
  | { status: 'ok'; revision: number; mode: 'full' }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerProjection(): boolean {
  return isFastifyServer
}

/**
 * Targeted per-resource projection fetch (lazy-projection Phase 2).
 *
 * Returns the current server-projected value of the top-level `database` keys
 * owned by `resource`, so a foreign command event can refresh only that
 * resource. `mode: 'full'` means the server could not narrow the resource and
 * the caller should fall back to a full bootstrap. This is the fetch half of
 * the primitive Phases 4–5 reuse for entity hydration.
 */
export async function fetchServerProjectionResource(
  resource: string,
  options: { id?: string; parentId?: string; signal?: AbortSignal | null } = {},
): Promise<ServerProjectionResourceResult> {
  if (!canUseServerProjection()) return { status: 'unavailable' }

  const query = new URLSearchParams()
  if (options.id) query.set('id', options.id)
  if (options.parentId) query.set('parentId', options.parentId)
  const suffix = query.toString()
  const url = `${PROJECTION_ENDPOINT}/${encodeURIComponent(resource)}${suffix ? `?${suffix}` : ''}`

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: options.signal ?? undefined,
      headers: { 'risu-auth': auth },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON failures are reported via HTTP status below.
  }

  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }

  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Invalid projection response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid projection revision' }
  }

  if (record.mode === 'full') {
    return { status: 'ok', revision: revision as number, mode: 'full' }
  }

  if (record.mode === 'fields') {
    const fields = record.fields
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { status: 'error', error: 'Invalid projection fields' }
    }
    return {
      status: 'ok',
      revision: revision as number,
      mode: 'fields',
      fields: fields as Partial<Database>,
    }
  }

  return { status: 'error', error: 'Invalid projection mode' }
}

export type ServerChatMessagesResult =
  | {
      status: 'ok'
      revision: number
      chatId: string
      message: unknown[]
      hypaV3Data?: unknown
      // Phase 6c: the persisted reroll candidates for this chat's turn (the
      // alternate rows). Always present (empty array when none); the client seeds
      // its swipe buffer from these so rerolls survive a reload.
      alternates: unknown[]
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

/**
 * Per-chat message hydration (lazy-projection Phase 4.3). The bootstrap ships
 * chat stubs (empty `message[]`); this fetches one chat's messages on open.
 */
export async function fetchServerChatMessages(
  chatId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerChatMessagesResult> {
  if (!canUseServerProjection()) return { status: 'unavailable' }

  const url = `${PROJECTION_ENDPOINT}/chatMessages?id=${encodeURIComponent(chatId)}`
  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: options.signal ?? undefined,
      headers: { 'risu-auth': auth },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Reported via HTTP status below.
  }

  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }
  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Invalid chat-messages response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid projection revision' }
  }
  if (record.mode !== 'chat-messages' || !Array.isArray(record.message)) {
    return { status: 'error', error: 'Invalid chat-messages response' }
  }
  return {
    status: 'ok',
    revision: revision as number,
    chatId: typeof record.chatId === 'string' ? record.chatId : chatId,
    message: record.message as unknown[],
    hypaV3Data: record.hypaV3Data,
    alternates: Array.isArray(record.alternates) ? (record.alternates as unknown[]) : [],
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
