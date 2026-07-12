import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { canUseServerResourceReads } from './resourceReads'

export async function fetchServerLegacyPreset(
  presetId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<
  | { status: 'ok'; revision: number; presetId: string; preset: Record<string, unknown> }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }
> {
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`/api/v1/legacy-presets/${encodeURIComponent(presetId)}`, {
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
    // Reported via HTTP status or response validation below.
  }
  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 'error', error: 'Invalid preset response' }
  }

  const record = body as Record<string, unknown>
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) {
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (!record.preset || typeof record.preset !== 'object' || Array.isArray(record.preset)) {
    return { status: 'error', error: 'Invalid preset response' }
  }
  const preset = record.preset as Record<string, unknown>
  return {
    status: 'ok',
    revision: record.revision as number,
    presetId: typeof preset.id === 'string' && preset.id.trim() !== '' ? preset.id : presetId,
    preset,
  }
}

export type ServerPromptPresetTemplateResult =
  | {
      status: 'ok'
      revision: number
      promptPresetId: string
      promptTemplate: unknown[] | null
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

/** Fetch the lazily stored template owned by one prompt preset. */
export async function fetchServerPromptPresetTemplate(
  promptPresetId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerPromptPresetTemplateResult> {
  if (!canUseServerResourceReads()) return { status: 'unavailable' }
  if (typeof promptPresetId !== 'string' || promptPresetId.trim() === '') {
    return { status: 'error', error: 'Prompt preset id is required' }
  }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`/api/v1/prompt-presets/${encodeURIComponent(promptPresetId)}/template`, {
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
    // Reported via HTTP status or response validation below.
  }
  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 'error', error: 'Invalid prompt preset template response' }
  }

  const record = body as Record<string, unknown>
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) {
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (
    record.promptPresetId !== promptPresetId ||
    (record.promptTemplate !== null && !Array.isArray(record.promptTemplate))
  ) {
    return { status: 'error', error: 'Invalid prompt preset template response' }
  }
  return {
    status: 'ok',
    revision: record.revision as number,
    promptPresetId,
    promptTemplate: record.promptTemplate as unknown[] | null,
  }
}

export type ServerChatMessagesResult =
  | {
      status: 'ok'
      revision: number
      chatId: string
      message: unknown[]
      hypaV3Data?: unknown
      messageStart?: number
      messageTotal?: number
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
      }>
      missing: string[]
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

/** Fetch full, tail, or ranged chat-message hydration from the server. */
export async function fetchServerChatMessages(
  chatId: string,
  options: { signal?: AbortSignal | null; start?: number; limit?: number; tail?: number } = {},
): Promise<ServerChatMessagesResult> {
  return fetchServerChatMessagesFromEndpoint(chatId, options)
}

/** Fetch the authoritative suffix changed by one generation-persisted event. */
export async function fetchServerGenerationChatMessages(
  chatId: string,
  generationMessageId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerChatMessagesResult> {
  if (!nonEmptyString(generationMessageId)) {
    return { status: 'error', error: 'Generation message id is required' }
  }
  return fetchServerChatMessagesFromEndpoint(chatId, { ...options, generationMessageId })
}

async function fetchServerChatMessagesFromEndpoint(
  chatId: string,
  options: {
    signal?: AbortSignal | null
    start?: number
    limit?: number
    tail?: number
    generationMessageId?: string
  },
): Promise<ServerChatMessagesResult> {
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const query = new URLSearchParams()
  if (nonEmptyString(options.generationMessageId)) {
    query.set('generationMessageId', options.generationMessageId)
  } else if (Number.isInteger(options.tail) && (options.tail as number) > 0) {
    query.set('tail', String(options.tail))
  } else if (
    Number.isInteger(options.start) &&
    (options.start as number) >= 0 &&
    Number.isInteger(options.limit) &&
    (options.limit as number) > 0
  ) {
    query.set('start', String(options.start))
    query.set('limit', String(options.limit))
  }
  const suffix = query.toString()
  const url = `/api/v1/chats/${encodeURIComponent(chatId)}/messages${suffix ? `?${suffix}` : ''}`
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
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (!Array.isArray(record.message)) {
    return { status: 'error', error: 'Invalid chat-messages response' }
  }
  if (
    (record.messageStart !== undefined || record.messageTotal !== undefined) &&
    (!Number.isInteger(record.messageStart) ||
      (record.messageStart as number) < 0 ||
      !Number.isInteger(record.messageTotal) ||
      (record.messageTotal as number) < 0 ||
      (record.messageStart as number) > (record.messageTotal as number))
  ) {
    return { status: 'error', error: 'Invalid chat-messages range' }
  }
  return {
    status: 'ok',
    revision: revision as number,
    chatId: typeof record.chatId === 'string' ? record.chatId : chatId,
    message: record.message as unknown[],
    hypaV3Data: record.hypaV3Data,
    ...(typeof record.messageStart === 'number' && typeof record.messageTotal === 'number'
      ? {
          messageStart: record.messageStart,
          messageTotal: record.messageTotal,
        }
      : {}),
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
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch('/api/v1/chats/messages/bulk', {
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
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (!Array.isArray(record.chats)) {
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
 * character metadata may carry a lorebook stub; this fetches the full
 * globalLore on character-open.
 */
export async function fetchServerCharacterLorebook(
  characterId: string,
  options: { signal?: AbortSignal | null } = {},
): Promise<ServerCharacterLorebookResult> {
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const url = `/api/v1/characters/${encodeURIComponent(characterId)}/lorebook`
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
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (!Array.isArray(record.globalLore)) {
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
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch('/api/v1/characters/lorebooks/bulk', {
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
    return { status: 'error', error: 'Invalid resource revision' }
  }
  if (!Array.isArray(record.characters)) {
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
