import { get } from 'svelte/store'
import { SvelteSet } from 'svelte/reactivity'
import { DBState, selectedCharID } from '../stores.svelte'
import {
  hydrateServerCharacterLorebook,
  hydrateServerChatMessages,
  isServerChatMessagePlaceholder,
  type Message,
} from '../storage/database.svelte'
import { seedRerollBufferFromAlternates } from '../process/rerollNavigation.svelte'
import { markCharacterLorebookHydrated } from './lorebookBridge.svelte'
import { peekCachedServerCommandRevision } from './commands'
import {
  canUseServerProjection,
  fetchServerBulkCharacterLorebooks,
  fetchServerBulkChatMessages,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
} from './projection'
import { beginHydrationRequest, recordBulkHydration, recordHydrationStaleDrop } from './protocolDiagnostics'
import { DEFAULT_CHAT_DISPLAY_TAIL_COUNT, normalizeChatDisplayTailCount } from '../chatDisplayTailCount'

export const BULK_HYDRATION_CONCURRENCY = 4
export const ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW = DEFAULT_CHAT_DISPLAY_TAIL_COUNT

// The bootstrap ships chat *stubs* (empty message[]). This bridge hydrates a
// chat's messages when it is opened and re-hydrates the open chat after a
// projection apply re-stubs it. Bulk readers that need every chat call
// `ensureAllChatsHydrated`.

// Chat ids whose messages this client has already hydrated this session, so
// re-opening a chat does not refetch. Cleared on a full re-stub (resync).
// Reactive so the chat UI can render a loading state until the open chat's
// messages arrive instead of flashing the greeting-only stub.
const hydratedChatIds = new SvelteSet<string>()
// Chat ids whose hydration attempt has *finished* this session (success OR
// failure). Lets the loading state clear after a failed/empty fetch so a chat
// that will never gain messages does not spin forever. Reactive; cleared on
// resync alongside `hydratedChatIds`.
const attemptedChatIds = new SvelteSet<string>()
const inFlight = new Map<string, Promise<void>>()
let chatHydrationGeneration = 0

// Character ids whose `globalLore` this client has hydrated this session (only
// when the EXPERIMENTAL `enableLorebookStubs` setting is on).
const hydratedCharLorebookIds = new Set<string>()
const charLorebookInFlight = new Map<string, Promise<void>>()
let charLorebookHydrationGeneration = 0

function activeChatId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = DBState.db?.characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.id
}

function activeChatMessageArray(): Message[] | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = DBState.db?.characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.message
}

type ChatHydrationRangeRequest =
  | { tail: number; start?: never; limit?: never }
  | { start: number; limit: number; tail?: never }

interface ChatHydrationRequest {
  force?: boolean
  range?: ChatHydrationRangeRequest
  seedReroll?: boolean
}

interface BulkHydrationOptions {
  strict?: boolean
}

function chatHydrationRequestKey(chatId: string, request: ChatHydrationRequest): string {
  if (!request.range) return `full:${chatId}`
  if (request.range.tail !== undefined) return `tail:${chatId}:${request.range.tail}`
  return `range:${chatId}:${request.range.start}:${request.range.limit}`
}

function isFullRange(start: number, total: number, returnedCount: number): boolean {
  return start === 0 && returnedCount >= total
}

function requestedTailSize(loadPages: number): number {
  if (!Number.isFinite(loadPages)) return Number.MAX_SAFE_INTEGER
  return Math.max(1, Math.ceil(loadPages))
}

function unloadedRangesForTail(
  messages: readonly Message[],
  loadPages: number,
): Array<{ start: number; limit: number }> {
  if (messages.length === 0) return []
  const tailSize = requestedTailSize(loadPages)
  const start = Math.max(0, messages.length - tailSize)
  const end = messages.length - 1
  const ranges: Array<{ start: number; limit: number }> = []
  let rangeStart = -1

  for (let index = start; index <= end; index += 1) {
    if (isServerChatMessagePlaceholder(messages[index])) {
      if (rangeStart === -1) rangeStart = index
    } else if (rangeStart !== -1) {
      ranges.push({ start: rangeStart, limit: index - rangeStart })
      rangeStart = -1
    }
  }

  if (rangeStart !== -1) {
    ranges.push({ start: rangeStart, limit: end - rangeStart + 1 })
  }
  return ranges
}

async function hydrateChat(chatId: string, request: ChatHydrationRequest = {}): Promise<void> {
  if (!canUseServerProjection()) return
  const force = request.force ?? false
  const wantsFullHydration = !request.range
  if (!force && hydratedChatIds.has(chatId)) return
  const requestKey = chatHydrationRequestKey(chatId, request)
  const currentRequest = inFlight.get(requestKey)
  if (currentRequest) return currentRequest

  const generation = chatHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  let requestPromise: Promise<void>
  requestPromise = (async () => {
    try {
      const endRequest = beginHydrationRequest('chat')
      const result = await fetchServerChatMessages(chatId, request.range ?? {}).finally(endRequest)
      if (result.status !== 'ok') {
        hydrationWarning(`chat ${chatId}`, resultError(result, 'server projection unavailable'))
        return
      }
      if (result.chatId !== chatId) {
        hydrationWarning(`chat ${chatId}`, `response was for chat ${result.chatId}`)
        return
      }
      if (generation !== chatHydrationGeneration) {
        recordHydrationStaleDrop('chat', 'generation-reset')
        return
      }
      if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
        recordHydrationStaleDrop('chat', 'older-than-applied-revision')
        return
      }
      if (request.range && !force && hydratedChatIds.has(chatId)) {
        return
      }

      const range =
        typeof result.messageStart === 'number' && typeof result.messageTotal === 'number'
          ? { start: result.messageStart, total: result.messageTotal }
          : undefined
      const applied = hydrateServerChatMessages(chatId, result.message, result.hypaV3Data, range)
      if (!applied) return
      if (wantsFullHydration || !range || isFullRange(range.start, range.total, result.message.length)) {
        hydratedChatIds.add(chatId)
      }
      // Only the open chat's tail drives the swipe buffer; seed it from this
      // chat's persisted reroll candidates so rerolls survive a reload.
      if (request.seedReroll !== false && activeChatId() === chatId) {
        seedRerollBufferFromAlternates(result.message, result.alternates)
      }
    } finally {
      // Mark the attempt as settled (even on failure / stale-drop) so the
      // loading state can clear and fall back to the greeting render.
      attemptedChatIds.add(chatId)
      if (inFlight.get(requestKey) === requestPromise) {
        inFlight.delete(requestKey)
      }
    }
  })()
  inFlight.set(requestKey, requestPromise)
  return requestPromise
}

async function hydrateChatsBulk(chatIds: readonly string[], options: BulkHydrationOptions = {}): Promise<void> {
  if (!canUseServerProjection() || chatIds.length === 0) return

  const generation = chatHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const endRequest = beginHydrationRequest('chat')
  const result = await fetchServerBulkChatMessages(chatIds).finally(endRequest)
  if (result.status !== 'ok') {
    const message = resultError(result, 'server projection unavailable')
    hydrationWarning('bulk chat', message)
    if (options.strict) throw new Error(`Bulk chat hydration failed: ${message}`)
    return
  }
  if (generation !== chatHydrationGeneration) {
    recordHydrationStaleDrop('chat', 'generation-reset')
    if (options.strict) throw new Error('Bulk chat hydration result was stale after a reset')
    return
  }
  if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
    recordHydrationStaleDrop('chat', 'older-than-applied-revision')
    if (options.strict) throw new Error('Bulk chat hydration result was older than local state')
    return
  }

  const missing = new Set(result.missing)
  const missingIds: string[] = []
  for (const chatId of chatIds) {
    if (missing.has(chatId)) {
      missingIds.push(chatId)
      continue
    }
    const hydration = result.chats.find((chat) => chat.chatId === chatId)
    if (!hydration) {
      missingIds.push(chatId)
      continue
    }
    const applied = hydrateServerChatMessages(chatId, hydration.message, hydration.hypaV3Data)
    if (!applied) {
      missingIds.push(chatId)
      continue
    }
    hydratedChatIds.add(chatId)
  }
  if (options.strict && missingIds.length > 0) {
    throw new Error(`Bulk chat hydration did not return messages for: ${missingIds.join(', ')}`)
  }
}

function resultError(result: { status: string; error?: string }, fallback: string): string {
  return result.status === 'error' && result.error ? result.error : fallback
}

function hydrationWarning(scope: string, message: string): void {
  console.warn(`${scope} hydration failed: ${message}`)
}

/** Hydrate the currently-open chat's messages (no-op if already hydrated). */
export async function hydrateActiveChat(options: { force?: boolean; loadPages?: number } = {}): Promise<void> {
  await hydrateActiveChatWindow(options.loadPages ?? normalizeChatDisplayTailCount(DBState.db?.chatDisplayTailCount), {
    force: options.force,
  })
}

/**
 * Ensure the current visible tail window is resident. This is the fast active
 * chat path: first open fetches only the tail; later scroll/jump expansion fills
 * just the newly visible unloaded ranges.
 */
export async function hydrateActiveChatWindow(loadPages: number, options: { force?: boolean } = {}): Promise<void> {
  const chatId = activeChatId()
  if (!chatId) return
  if (!Number.isFinite(loadPages)) {
    await hydrateChat(chatId, { force: options.force, seedReroll: true })
    return
  }

  const messages = activeChatMessageArray()
  if (!messages || messages.length === 0 || options.force) {
    await hydrateChat(chatId, {
      force: options.force,
      range: { tail: requestedTailSize(loadPages) },
      seedReroll: true,
    })
    return
  }

  const ranges = unloadedRangesForTail(messages, loadPages)
  for (const range of ranges) {
    await hydrateChat(chatId, {
      range,
      seedReroll: range.start + range.limit >= messages.length,
    })
  }
}

/** Hydrate the currently-open chat's complete transcript. */
export async function hydrateActiveChatFully(options: { force?: boolean } = {}): Promise<void> {
  const chatId = activeChatId()
  if (chatId) await hydrateChat(chatId, { force: options.force, seedReroll: true })
}

/** Hydrate a specific chat's messages by id (for single-chat bulk reads). */
export async function hydrateChatMessages(chatId: string): Promise<void> {
  if (chatId) await hydrateChat(chatId, { seedReroll: activeChatId() === chatId })
}

/**
 * Apply an already-fetched chat message payload to a chat directly (no refetch).
 * Used by the foreign `generation.persisted` per-chat projection branch, which
 * ships the changed chat's messages inline. Marks the chat hydrated and seeds
 * the swipe buffer when it is the open chat, mirroring `hydrateChat`'s apply.
 */
export function applyServerChatMessagesProjection(
  chatId: string,
  message: unknown[],
  hypaV3Data: unknown,
  alternates: unknown[],
  range?: { start: number; total: number },
): boolean {
  if (!chatId) return false
  const applied = hydrateServerChatMessages(chatId, message, hypaV3Data, range)
  if (!applied) return false
  if (!range || isFullRange(range.start, range.total, message.length)) {
    hydratedChatIds.add(chatId)
  }
  attemptedChatIds.add(chatId)
  if (activeChatId() === chatId) {
    seedRerollBufferFromAlternates(message, alternates)
  }
  return true
}

/**
 * Reactive: is the given chat's message history still being hydrated from the
 * server (so the UI should show a loading state instead of the greeting-only
 * stub)? True only while the open chat is an un-hydrated, empty stub whose first
 * hydration attempt is pending. Reads reactive `SvelteSet`s, so a
 * `$derived`/`$effect` reading it re-runs when hydration settles.
 *
 * Returns false once messages arrive (so it never lingers over real content),
 * once the chat is hydrated (including a legitimately empty chat), and once the
 * fetch settles even on failure (so a chat the server can't supply does not spin
 * forever). Also false when server projection is off — nothing hydrates then.
 */
export function isChatMessageHydrationPending(chatId: string | undefined, messageCount: number): boolean {
  if (!canUseServerProjection()) return false
  if (!chatId) return false
  if (messageCount > 0) return false
  if (hydratedChatIds.has(chatId)) return false
  if (attemptedChatIds.has(chatId)) return false
  return true
}

// Character globalLore hydration (only when stubs are on).

function activeCharacterId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  return DBState.db?.characters?.[selId]?.chaId
}

async function hydrateCharacterLorebook(characterId: string, force: boolean): Promise<void> {
  if (!canUseServerProjection()) return
  // Off unless globalLore is actually stubbed (the EXPERIMENTAL setting). When off,
  // globalLore is already resident — no fetch needed and nothing to hydrate.
  if (!DBState.db?.enableLorebookStubs) return
  if (!force && hydratedCharLorebookIds.has(characterId)) return
  const currentRequest = charLorebookInFlight.get(characterId)
  if (currentRequest) return currentRequest

  const generation = charLorebookHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  let request: Promise<void>
  request = (async () => {
    try {
      const endRequest = beginHydrationRequest('characterLorebook')
      const result = await fetchServerCharacterLorebook(characterId).finally(endRequest)
      if (result.status !== 'ok') {
        hydrationWarning(`character lorebook ${characterId}`, resultError(result, 'server projection unavailable'))
        return
      }
      if (result.characterId !== characterId) {
        hydrationWarning(`character lorebook ${characterId}`, `response was for character ${result.characterId}`)
        return
      }
      if (generation !== charLorebookHydrationGeneration) {
        recordHydrationStaleDrop('characterLorebook', 'generation-reset')
        return
      }
      if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
        recordHydrationStaleDrop('characterLorebook', 'older-than-applied-revision')
        return
      }

      const applied = hydrateServerCharacterLorebook(characterId, result.globalLore)
      if (!applied) return
      // Mark hydrated so the lorebook watcher tracks (and persists) edits to it.
      markCharacterLorebookHydrated(characterId)
      hydratedCharLorebookIds.add(characterId)
    } finally {
      if (charLorebookInFlight.get(characterId) === request) {
        charLorebookInFlight.delete(characterId)
      }
    }
  })()
  charLorebookInFlight.set(characterId, request)
  return request
}

async function hydrateCharacterLorebooksBulk(
  characterIds: readonly string[],
  options: BulkHydrationOptions = {},
): Promise<void> {
  if (!canUseServerProjection() || !DBState.db?.enableLorebookStubs || characterIds.length === 0) {
    return
  }

  const generation = charLorebookHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const endRequest = beginHydrationRequest('characterLorebook')
  const result = await fetchServerBulkCharacterLorebooks(characterIds).finally(endRequest)
  if (result.status !== 'ok') {
    const message = resultError(result, 'server projection unavailable')
    hydrationWarning('bulk character lorebook', message)
    if (options.strict) throw new Error(`Bulk character lorebook hydration failed: ${message}`)
    return
  }
  if (generation !== charLorebookHydrationGeneration) {
    recordHydrationStaleDrop('characterLorebook', 'generation-reset')
    if (options.strict) {
      throw new Error('Bulk character lorebook hydration result was stale after a reset')
    }
    return
  }
  if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
    recordHydrationStaleDrop('characterLorebook', 'older-than-applied-revision')
    if (options.strict) {
      throw new Error('Bulk character lorebook hydration result was older than local state')
    }
    return
  }

  const missing = new Set(result.missing)
  const missingIds: string[] = []
  for (const characterId of characterIds) {
    if (missing.has(characterId)) {
      missingIds.push(characterId)
      continue
    }
    const hydration = result.characters.find((character) => character.characterId === characterId)
    if (!hydration) {
      missingIds.push(characterId)
      continue
    }
    const applied = hydrateServerCharacterLorebook(characterId, hydration.globalLore)
    if (!applied) {
      missingIds.push(characterId)
      continue
    }
    markCharacterLorebookHydrated(characterId)
    hydratedCharLorebookIds.add(characterId)
  }
  if (options.strict && missingIds.length > 0) {
    throw new Error(`Bulk character lorebook hydration did not return data for: ${missingIds.join(', ')}`)
  }
}

/** Hydrate the open character's `globalLore` (no-op if already hydrated / stubs off). */
export async function hydrateActiveCharacterLorebook(options: { force?: boolean } = {}): Promise<void> {
  const characterId = activeCharacterId()
  if (characterId) await hydrateCharacterLorebook(characterId, options.force ?? false)
}

/**
 * Hydrate EVERY character's `globalLore`. Bulk readers (export, tokenizer) that
 * walk all characters' lorebooks must await this first when stubs are on.
 */
export async function ensureAllCharacterLorebooksHydrated(options: BulkHydrationOptions = {}): Promise<void> {
  if (!canUseServerProjection() || !DBState.db?.enableLorebookStubs) return
  const ids: string[] = []
  const pendingRequests: Promise<void>[] = []
  for (const character of DBState.db?.characters ?? []) {
    if (typeof character.chaId !== 'string' || !character.chaId || hydratedCharLorebookIds.has(character.chaId)) {
      continue
    }
    const pending = charLorebookInFlight.get(character.chaId)
    if (pending) {
      pendingRequests.push(pending)
      continue
    }
    ids.push(character.chaId)
  }
  recordBulkHydration('characterLorebook', ids.length)
  await Promise.all([hydrateCharacterLorebooksBulk(ids, options), ...pendingRequests])
  if (options.strict) {
    const missing: string[] = []
    for (const character of DBState.db?.characters ?? []) {
      if (typeof character.chaId === 'string' && character.chaId && !hydratedCharLorebookIds.has(character.chaId)) {
        missing.push(character.chaId)
      }
    }
    if (missing.length > 0) {
      throw new Error(`Character lorebook hydration incomplete for: ${missing.join(', ')}`)
    }
  }
}

/**
 * Forget cached hydration (call after a full projection re-apply / resync that
 * re-stubs every chat), so the next `hydrateActiveChat` refetches.
 */
export function resetChatHydration(): void {
  hydratedChatIds.clear()
  attemptedChatIds.clear()
  chatHydrationGeneration += 1
  inFlight.clear()
  // A re-stub also re-stubs character globalLore; forget these marks so the open
  // character re-hydrates (the lorebook registry is reset in bootstrap.ts).
  hydratedCharLorebookIds.clear()
  charLorebookHydrationGeneration += 1
  charLorebookInFlight.clear()
}

// A hydration response is stale only when it is older than the revision this
// client had ALREADY applied at the moment the request was issued. Comparing
// against the *current* cached revision is wrong: an unrelated command — most
// commonly the `character.selected` command that `changeChar` fires alongside
// chat-open — can advance the cached revision while the (large, slow) hydration
// fetch is still in flight. That would falsely drop a perfectly current message
// payload (the select command never touched the messages), leaving the chat
// stuck on stubs. Capture the baseline at request start and compare against it.
function isOlderThanBaselineRevision(revision: number, baselineRevision: number | null): boolean {
  return baselineRevision !== null && revision < baselineRevision
}

/**
 * Hydrate EVERY chat's messages. Bulk readers (export-all, cold storage) that
 * walk all chats' history must await this first, since non-open chats are stubs.
 */
export async function ensureAllChatsHydrated(options: BulkHydrationOptions = {}): Promise<void> {
  if (!canUseServerProjection()) return
  const ids: string[] = []
  const pendingRequests: Promise<void>[] = []
  for (const character of DBState.db?.characters ?? []) {
    for (const chat of character.chats ?? []) {
      if (typeof chat.id !== 'string' || !chat.id || hydratedChatIds.has(chat.id)) {
        continue
      }
      const pending = inFlight.get(chatHydrationRequestKey(chat.id, {}))
      if (pending) {
        pendingRequests.push(pending)
        continue
      }
      ids.push(chat.id)
    }
  }
  recordBulkHydration('chat', ids.length)
  await Promise.all([hydrateChatsBulk(ids, options), ...pendingRequests])
  if (options.strict) {
    const missing: string[] = []
    for (const character of DBState.db?.characters ?? []) {
      for (const chat of character.chats ?? []) {
        if (typeof chat.id === 'string' && chat.id && !hydratedChatIds.has(chat.id)) {
          missing.push(chat.id)
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`Chat hydration incomplete for: ${missing.join(', ')}`)
    }
  }
}

let wired = false
// Reactive mirror of the selected character index. `selectedCharID` is a store
// (not $state), so the hydration effect can't track it directly; this mirror is
// updated by a store subscription and read inside the effect, so the effect
// re-runs — and re-tracks the *new* character's chatPage — on a character switch.
let selectedCharMirror = $state(-1)

/**
 * Wire the hydration trigger: a reactive effect on the active chat id. It re-runs
 * on a character switch (via the `selectedCharMirror` $state) and on a chat
 * switch within a character (via `DBState`'s chats/chatPage $state). It reads the
 * chat's id only — not `message` — so writing the hydrated messages does not
 * re-trigger it. Idempotent.
 */
export function startChatMessageHydration(): void {
  if (wired || !canUseServerProjection()) return
  wired = true
  selectedCharID.subscribe((value) => {
    selectedCharMirror = value
  })
  $effect.root(() => {
    $effect(() => {
      if (selectedCharMirror < 0) return
      const character = DBState.db?.characters?.[selectedCharMirror]
      const chatId = character?.chats?.[character?.chatPage ?? 0]?.id
      if (chatId) void hydrateActiveChat()
      // Hydrate the open character's globalLore. This reads chaId only, so
      // writing the hydrated entries does not re-trigger the effect.
      if (character?.chaId) void hydrateActiveCharacterLorebook()
    })
  })
}
