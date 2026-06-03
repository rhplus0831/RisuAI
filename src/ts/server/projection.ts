import type { Database } from '../storage/database.svelte'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'

const PROJECTION_ENDPOINT = '/api/v1/projection'

export type ServerProjectionResourceResult =
  | { status: 'ok'; revision: number; mode: 'fields'; fields: Partial<Database> }
  | {
      status: 'ok'
      revision: number
      mode: 'character-selection'
      characterId: string
      currentChar: number
      lastInteraction?: number
    }
  | {
      status: 'ok'
      revision: number
      mode: 'character-lorebook'
      characterId: string
      globalLore: unknown[]
    }
  | {
      status: 'ok'
      revision: number
      mode: 'character-row'
      characterId: string
      character: Record<string, unknown>
    }
  | {
      status: 'ok'
      revision: number
      mode: 'generation-chat'
      chatId: string
      message: unknown[]
      hypaV3Data?: unknown
      alternates: unknown[]
    }
  | { status: 'ok'; revision: number; mode: 'full' }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerProjection(): boolean {
  return true
}

/**
 * Targeted per-resource projection fetch.
 *
 * Returns the current server-projected value of the top-level `database` keys
 * owned by `resource`, so a foreign command event can refresh only that
 * resource. `mode: 'full'` means the server could not narrow the resource and
 * the caller should fall back to a full bootstrap. Entity hydration reuses the
 * same fetch primitive.
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

  if (record.mode === 'character-selection') {
    if (typeof record.characterId !== 'string' || record.characterId.trim() === '') {
      return { status: 'error', error: 'Invalid character-selection response' }
    }
    if (!Number.isInteger(record.currentChar) || (record.currentChar as number) < -1) {
      return { status: 'error', error: 'Invalid character-selection response' }
    }
    if (record.lastInteraction !== undefined && typeof record.lastInteraction !== 'number') {
      return { status: 'error', error: 'Invalid character-selection response' }
    }
    return {
      status: 'ok',
      revision: revision as number,
      mode: 'character-selection',
      characterId: record.characterId,
      currentChar: record.currentChar as number,
      ...(typeof record.lastInteraction === 'number'
        ? { lastInteraction: record.lastInteraction }
        : {}),
    }
  }

  if (record.mode === 'character-lorebook') {
    if (typeof record.characterId !== 'string' || record.characterId.trim() === '') {
      return { status: 'error', error: 'Invalid character-lorebook response' }
    }
    if (!Array.isArray(record.globalLore)) {
      return { status: 'error', error: 'Invalid character-lorebook response' }
    }
    return {
      status: 'ok',
      revision: revision as number,
      mode: 'character-lorebook',
      characterId: record.characterId,
      globalLore: record.globalLore as unknown[],
    }
  }

  if (record.mode === 'character-row') {
    if (typeof record.characterId !== 'string' || record.characterId.trim() === '') {
      return { status: 'error', error: 'Invalid character-row response' }
    }
    if (!record.character || typeof record.character !== 'object' || Array.isArray(record.character)) {
      return { status: 'error', error: 'Invalid character-row response' }
    }
    return {
      status: 'ok',
      revision: revision as number,
      mode: 'character-row',
      characterId: record.characterId,
      character: record.character as Record<string, unknown>,
    }
  }

  if (record.mode === 'generation-chat') {
    if (typeof record.chatId !== 'string' || record.chatId.trim() === '') {
      return { status: 'error', error: 'Invalid generation-chat response' }
    }
    if (!Array.isArray(record.message)) {
      return { status: 'error', error: 'Invalid generation-chat response' }
    }
    return {
      status: 'ok',
      revision: revision as number,
      mode: 'generation-chat',
      chatId: record.chatId,
      message: record.message as unknown[],
      hypaV3Data: record.hypaV3Data,
      alternates: Array.isArray(record.alternates) ? (record.alternates as unknown[]) : [],
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
      // Persisted reroll candidates for this chat's turn (the alternate rows).
      // Always present (empty array when none); the client seeds its swipe buffer
      // from these so rerolls survive a reload.
      alternates: unknown[]
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type ServerBulkChatMessagesResult =
  | {
      status: 'ok'
      revision: number
      chats: Array<{
        chatId: string
        message: unknown[]
        hypaV3Data?: unknown
        alternates: unknown[]
      }>
      missing: string[]
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

/**
 * Per-chat message hydration. The bootstrap ships chat stubs (empty `message[]`);
 * this fetches one chat's messages on open.
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

/**
 * Bulk chat message hydration for workflows that need every chat history. The
 * open chat still uses the single-chat path to keep active-chat dedupe narrow.
 */
export async function fetchServerBulkChatMessages(
  chatIds: readonly string[],
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerBulkChatMessagesResult> {
  if (!canUseServerProjection()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${PROJECTION_ENDPOINT}/chatMessages/bulk`, {
      method: 'POST',
      signal: options.signal ?? undefined,
      headers: { 'content-type': 'application/json', 'risu-auth': auth },
      body: JSON.stringify({ ids: chatIds }),
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
    return { status: 'error', error: 'Invalid bulk chat-messages response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid projection revision' }
  }
  if (record.mode !== 'chat-messages-bulk' || !Array.isArray(record.chats)) {
    return { status: 'error', error: 'Invalid bulk chat-messages response' }
  }

  const chats: Extract<ServerBulkChatMessagesResult, { status: 'ok' }>['chats'] = []
  for (const raw of record.chats) {
    if (!raw || typeof raw !== 'object') {
      return { status: 'error', error: 'Invalid bulk chat-messages entry' }
    }
    const chat = raw as Record<string, unknown>
    if (typeof chat.chatId !== 'string' || !Array.isArray(chat.message)) {
      return { status: 'error', error: 'Invalid bulk chat-messages entry' }
    }
    chats.push({
      chatId: chat.chatId,
      message: chat.message as unknown[],
      hypaV3Data: chat.hypaV3Data,
      alternates: Array.isArray(chat.alternates) ? (chat.alternates as unknown[]) : [],
    })
  }

  return {
    status: 'ok',
    revision: revision as number,
    chats,
    missing: Array.isArray(record.missing)
      ? record.missing.filter((value): value is string => typeof value === 'string')
      : [],
  }
}

export type ServerCharacterLorebookResult =
  | { status: 'ok'; revision: number; characterId: string; globalLore: unknown[] }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type ServerBulkCharacterLorebookResult =
  | {
      status: 'ok'
      revision: number
      characters: Array<{
        characterId: string
        globalLore: unknown[]
      }>
      missing: string[]
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

/**
 * Per-character `globalLore` hydration. When `enableLorebookStubs` is on, the
 * projection ships a character's globalLore as a stub; this fetches the full
 * globalLore on character-open.
 */
export async function fetchServerCharacterLorebook(
  characterId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerCharacterLorebookResult> {
  if (!canUseServerProjection()) return { status: 'unavailable' }

  const url = `${PROJECTION_ENDPOINT}/characterLorebook?id=${encodeURIComponent(characterId)}`
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
    return { status: 'error', error: 'Invalid character-lorebook response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid projection revision' }
  }
  if (record.mode !== 'character-lorebook' || !Array.isArray(record.globalLore)) {
    return { status: 'error', error: 'Invalid character-lorebook response' }
  }
  return {
    status: 'ok',
    revision: revision as number,
    characterId: typeof record.characterId === 'string' ? record.characterId : characterId,
    globalLore: record.globalLore as unknown[],
  }
}

/**
 * Bulk character `globalLore` hydration for workflows that need every
 * character lorebook. The open character still uses the single-character path.
 */
export async function fetchServerBulkCharacterLorebooks(
  characterIds: readonly string[],
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerBulkCharacterLorebookResult> {
  if (!canUseServerProjection()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${PROJECTION_ENDPOINT}/characterLorebooks/bulk`, {
      method: 'POST',
      signal: options.signal ?? undefined,
      headers: { 'content-type': 'application/json', 'risu-auth': auth },
      body: JSON.stringify({ ids: characterIds }),
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
    return { status: 'error', error: 'Invalid bulk character-lorebook response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid projection revision' }
  }
  if (record.mode !== 'character-lorebooks-bulk' || !Array.isArray(record.characters)) {
    return { status: 'error', error: 'Invalid bulk character-lorebook response' }
  }

  const characters: Extract<ServerBulkCharacterLorebookResult, { status: 'ok' }>['characters'] = []
  for (const raw of record.characters) {
    if (!raw || typeof raw !== 'object') {
      return { status: 'error', error: 'Invalid bulk character-lorebook entry' }
    }
    const character = raw as Record<string, unknown>
    if (typeof character.characterId !== 'string' || !Array.isArray(character.globalLore)) {
      return { status: 'error', error: 'Invalid bulk character-lorebook entry' }
    }
    characters.push({
      characterId: character.characterId,
      globalLore: character.globalLore as unknown[],
    })
  }

  return {
    status: 'ok',
    revision: revision as number,
    characters,
    missing: Array.isArray(record.missing)
      ? record.missing.filter((value): value is string => typeof value === 'string')
      : [],
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
