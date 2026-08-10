import { get } from 'svelte/store'
import { SvelteSet } from 'svelte/reactivity'
import { selectedCharID } from '../stores.svelte'
import type { ActiveChatTarget } from '../chatCommands'
import {
  getDatabase,
  hydrateServerCharacterLorebook,
  hydrateServerChatMessages,
  isServerChatMessagePlaceholder,
  type Message,
  type MessageTranslation,
  withTrustedResourceWrite,
} from '../storage/database.svelte'
import { getRerollBuffer, getRerollId, seedRerollBufferFromAlternates } from '../process/rerollNavigation.svelte'
import {
  isCharacterLorebookHydrated,
  isCharacterLorebookMutationReady,
  markCharacterLorebookHydrated,
  recordCanonicalCharacterLorebookScopes,
} from './lorebookBridge.svelte'
import { peekCachedServerCommandRevision } from './commands'
import {
  fetchServerBulkCharacterLorebooks,
  fetchServerBulkChatMessages,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
} from './hydrationReads'
import { canUseServerResourceReads } from './resourceReads'
import { beginHydrationRequest, recordBulkHydration, recordHydrationStaleDrop } from './protocolDiagnostics'
import { DEFAULT_CHAT_LOAD_INITIAL_PAGES, getInitialChatLoadPages } from '../chatLoadPages'
import { setChatStructureHydrationHooks } from './chatStructureHydrationHooks'
import {
  captureCharacterLorebookBodyProjectionEpoch,
  hasCharacterLorebookBodyProjectionEpochChanged,
  markCharacterLorebookBodyResourceRevision,
  markCharacterLorebookProjectionApplied,
  markChatBodyProjectionApplied,
  markChatBodyResourceRevision,
} from './resourceState.svelte'
import { reapplyRetainedChatBodyProjections } from './chatRetainedProjection'
import { acknowledgeHydratedGenerationPersistences } from '../process/generationPersistenceState'

export const BULK_HYDRATION_BATCH_SIZE = 32
export const ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW = DEFAULT_CHAT_LOAD_INITIAL_PAGES

// The bootstrap ships chat *stubs* (empty message[]). This bridge hydrates a
// chat's messages when it is opened and re-hydrates the open chat after a
// resource apply re-stubs it. Bulk readers that need every chat call
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
// Failed empty stubs need a distinct terminal state from legitimately empty
// hydrated chats. The chat screen uses this to offer an explicit retry instead
// of silently revealing a greeting over missing history.
const failedChatIds = new SvelteSet<string>()
const inFlight = new Map<string, Promise<void>>()
let chatHydrationGeneration = 0

interface ChatHydrationFreshnessToken {
  projectionEpoch: number
  expectedChatState: string | null
  expectedRerollState: string | null
  trackRerollState: boolean
}

// Targeted message projections are authoritative writes and invalidate every
// hydration request that started before them, even when the projected payload
// happens to be byte-identical to the old local state.
const chatProjectionEpochs = new Map<string, number>()

// Local message edits are not routed through one single mutation primitive, so
// each request also snapshots the chat content it is about to hydrate. Whenever
// another hydration request writes a compatible range, all pending snapshots
// are advanced to that known-safe state. A targeted projection deliberately
// does not advance them; an optimistic/local write is not registered here at
// all. Both therefore make the older response stale without treating ordinary
// concurrent range hydration as a local edit.
const pendingChatHydrationFreshness = new Map<string, Set<ChatHydrationFreshnessToken>>()

// Character ids whose `globalLore` this client has hydrated this session (only
// when the EXPERIMENTAL `enableLorebookStubs` setting is on).
const hydratedCharLorebookIds = new SvelteSet<string>()
// Character-lorebook stubs need the same explicit terminal states as chat
// message stubs. Without them, a failed request is indistinguishable from a
// legitimately empty lorebook and the editor can expose non-persistable data.
const attemptedCharLorebookIds = new SvelteSet<string>()
const failedCharLorebookIds = new SvelteSet<string>()
const charLorebookInFlight = new Map<string, Promise<void>>()
let charLorebookHydrationGeneration = 0

function beginCharacterLorebookHydrationState(characterId: string): void {
  attemptedCharLorebookIds.delete(characterId)
  failedCharLorebookIds.delete(characterId)
}

function finishCharacterLorebookHydrationState(characterId: string, generation: number): void {
  // A reset represents a new projection generation. Do not let an older
  // request repopulate terminal state after that reset cleared it.
  if (generation !== charLorebookHydrationGeneration) return
  attemptedCharLorebookIds.add(characterId)
  if (hydratedCharLorebookIds.has(characterId) || isCharacterLorebookHydrated(characterId)) {
    failedCharLorebookIds.delete(characterId)
  } else {
    failedCharLorebookIds.add(characterId)
  }
}

function activeChatId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = getDatabase().characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.id
}

function activeChatMessageArray(): Message[] | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = getDatabase().characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.message
}

function rerollTargetForChatId(chatId: string): ActiveChatTarget | null {
  const characters = getDatabase().characters ?? []
  for (let selectedCharID = 0; selectedCharID < characters.length; selectedCharID += 1) {
    const character = characters[selectedCharID]
    const chatPage = character.chats?.findIndex((chat) => chat.id === chatId) ?? -1
    if (chatPage < 0) continue
    return {
      selectedCharID,
      chatPage,
      characterId: character.chaId,
      chatId,
    }
  }
  return null
}

function snapshotJson(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    // Projection data should be JSON-like. If a plugin temporarily installs a
    // non-serializable value, fail closed rather than let an old response erase
    // it.
    return null
  }
}

function chatStateSnapshot(chatId: string): string | null {
  for (const character of getDatabase().characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (!chat) continue
    return snapshotJson({
      message: chat.message ?? [],
      hasHypaV3Data: Object.prototype.hasOwnProperty.call(chat, 'hypaV3Data'),
      hypaV3Data: chat.hypaV3Data,
    })
  }
  return 'missing-chat'
}

function rerollStateSnapshot(chatId: string): string | null {
  const target = rerollTargetForChatId(chatId)
  return snapshotJson({ buffer: getRerollBuffer(target), id: getRerollId(target) })
}

function beginChatHydrationFreshness(
  chatId: string,
  options: { trackRerollState: boolean },
): ChatHydrationFreshnessToken {
  const trackRerollState = options.trackRerollState
  const token: ChatHydrationFreshnessToken = {
    projectionEpoch: chatProjectionEpochs.get(chatId) ?? 0,
    expectedChatState: chatStateSnapshot(chatId),
    expectedRerollState: trackRerollState ? rerollStateSnapshot(chatId) : null,
    trackRerollState,
  }
  const pending = pendingChatHydrationFreshness.get(chatId) ?? new Set<ChatHydrationFreshnessToken>()
  pending.add(token)
  pendingChatHydrationFreshness.set(chatId, pending)
  return token
}

function endChatHydrationFreshness(chatId: string, token: ChatHydrationFreshnessToken): void {
  const pending = pendingChatHydrationFreshness.get(chatId)
  if (!pending) return
  pending.delete(token)
  if (pending.size === 0) pendingChatHydrationFreshness.delete(chatId)
}

function chatHydrationStaleReason(chatId: string, token: ChatHydrationFreshnessToken): string | null {
  if ((chatProjectionEpochs.get(chatId) ?? 0) !== token.projectionEpoch) {
    return 'newer-targeted-chat-projection'
  }
  const currentChatState = chatStateSnapshot(chatId)
  if (token.expectedChatState === null || currentChatState === null || currentChatState !== token.expectedChatState) {
    return 'chat-state-changed'
  }
  // Reroll candidates are process-local rather than part of database resources.
  // Protect the target chat's entry separately whenever this response can seed it.
  if (token.trackRerollState) {
    const currentRerollState = rerollStateSnapshot(chatId)
    if (
      token.expectedRerollState === null ||
      currentRerollState === null ||
      currentRerollState !== token.expectedRerollState
    ) {
      return 'reroll-state-changed'
    }
  }
  return null
}

function refreshPendingFreshnessAfterHydration(chatId: string, completedToken: ChatHydrationFreshnessToken): void {
  const pending = pendingChatHydrationFreshness.get(chatId)
  if (!pending || [...pending].every((token) => token === completedToken)) return
  const expectedChatState = chatStateSnapshot(chatId)
  const expectedRerollState = rerollStateSnapshot(chatId)
  for (const token of pending) {
    if (token === completedToken) continue
    token.expectedChatState = expectedChatState
    if (token.trackRerollState) {
      token.expectedRerollState = expectedRerollState
    }
  }
}

function advanceChatProjectionEpoch(chatId: string): void {
  chatProjectionEpochs.set(chatId, (chatProjectionEpochs.get(chatId) ?? 0) + 1)
  markChatBodyProjectionApplied(chatId)
}

/**
 * Invalidates hydration state for one structurally changed chat without
 * re-stubbing or refetching every other chat. Removing matching in-flight map
 * entries allows an immediate replacement request; the epoch makes any older
 * response stale, and the old request's identity check prevents its `finally`
 * block from deleting that replacement.
 */
export function invalidateChatHydration(chatId: string): void {
  if (!chatId) return
  hydratedChatIds.delete(chatId)
  attemptedChatIds.delete(chatId)
  failedChatIds.delete(chatId)
  advanceChatProjectionEpoch(chatId)
  pendingChatHydrationFreshness.delete(chatId)
  for (const requestKey of inFlight.keys()) {
    if (
      requestKey === `full:${chatId}` ||
      requestKey.startsWith(`tail:${chatId}:`) ||
      requestKey.startsWith(`range:${chatId}:`)
    ) {
      inFlight.delete(requestKey)
    }
  }
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
  force?: boolean
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
  if (!canUseServerResourceReads()) return
  const force = request.force ?? false
  const wantsFullHydration = !request.range
  if (!force && hydratedChatIds.has(chatId)) return
  const requestKey = chatHydrationRequestKey(chatId, request)
  const currentRequest = inFlight.get(requestKey)
  if (currentRequest) return currentRequest

  // A real replacement attempt immediately swaps the error state back to the
  // loading state. Do this only after the in-flight dedupe check so a duplicate
  // caller cannot erase a failure recorded by the shared request.
  attemptedChatIds.delete(chatId)
  failedChatIds.delete(chatId)

  const generation = chatHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const freshness = beginChatHydrationFreshness(chatId, {
    trackRerollState: request.seedReroll !== false,
  })
  let shouldMarkAttempted = true
  let requestPromise: Promise<void>
  requestPromise = (async () => {
    try {
      const endRequest = beginHydrationRequest('chat')
      const result = await fetchServerChatMessages(chatId, request.range ?? {}).finally(endRequest)
      if (generation !== chatHydrationGeneration) {
        shouldMarkAttempted = false
        recordHydrationStaleDrop('chat', 'generation-reset')
        return
      }
      if (result.status !== 'ok') {
        failedChatIds.add(chatId)
        hydrationWarning(`chat ${chatId}`, resultError(result, 'server projection unavailable'))
        return
      }
      if (result.chatId !== chatId) {
        failedChatIds.add(chatId)
        hydrationWarning(`chat ${chatId}`, `response was for chat ${result.chatId}`)
        return
      }
      if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
        shouldMarkAttempted = false
        recordHydrationStaleDrop('chat', 'older-than-applied-revision')
        return
      }
      const staleReason = chatHydrationStaleReason(chatId, freshness)
      if (staleReason) {
        shouldMarkAttempted = false
        recordHydrationStaleDrop('chat', staleReason)
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
      if (!applied) {
        failedChatIds.add(chatId)
        hydrationWarning(`chat ${chatId}`, 'response could not be applied')
        return
      }
      markChatBodyResourceRevision(chatId, result.revision)
      markChatBodyProjectionApplied(chatId)
      reapplyRetainedChatBodyProjections(chatId)
      acknowledgeHydratedGenerationPersistences(chatId, result.message as Message[])
      if (wantsFullHydration || !range || isFullRange(range.start, range.total, result.message.length)) {
        hydratedChatIds.add(chatId)
      }
      // Tail/full hydration owns this chat's durable reroll candidates even if
      // the user navigates before the response settles.
      if (request.seedReroll !== false) {
        seedRerollBufferFromAlternates(result.message, result.alternates, rerollTargetForChatId(chatId))
      }
      refreshPendingFreshnessAfterHydration(chatId, freshness)
    } catch (error) {
      if (generation !== chatHydrationGeneration) {
        shouldMarkAttempted = false
        recordHydrationStaleDrop('chat', 'generation-reset')
        return
      }
      failedChatIds.add(chatId)
      hydrationWarning(`chat ${chatId}`, error instanceof Error ? error.message : String(error))
    } finally {
      // Failed requests settle the loading state, but stale responses do not:
      // after an optimistic edit rolls back, the still-stubbed chat must remain
      // eligible for a fresh hydration attempt.
      if (shouldMarkAttempted) attemptedChatIds.add(chatId)
      if (inFlight.get(requestKey) === requestPromise) {
        inFlight.delete(requestKey)
      }
      endChatHydrationFreshness(chatId, freshness)
    }
  })()
  inFlight.set(requestKey, requestPromise)
  return requestPromise
}

async function hydrateChatsBulk(chatIds: readonly string[], options: BulkHydrationOptions = {}): Promise<void> {
  if (!canUseServerResourceReads() || chatIds.length === 0) return

  const generation = chatHydrationGeneration
  const freshnessByChat = new Map(
    chatIds.map((chatId) => [chatId, beginChatHydrationFreshness(chatId, { trackRerollState: true })]),
  )
  try {
    for (const batch of bulkHydrationBatches(chatIds)) {
      const baselineRevision = peekCachedServerCommandRevision()
      const endRequest = beginHydrationRequest('chat')
      const result = await fetchServerBulkChatMessages(batch).finally(endRequest)
      if (result.status !== 'ok') {
        const message = resultError(result, 'server projection unavailable')
        hydrationWarning('bulk chat', message)
        if (options.strict) throw new Error(`Bulk chat hydration failed: ${message}`)
        continue
      }
      if (generation !== chatHydrationGeneration) {
        recordHydrationStaleDrop('chat', 'generation-reset')
        if (options.strict) throw new Error('Bulk chat hydration result was stale after a reset')
        return
      }
      if (isOlderThanBaselineRevision(result.revision, baselineRevision)) {
        recordHydrationStaleDrop('chat', 'older-than-applied-revision')
        if (options.strict) throw new Error('Bulk chat hydration result was older than local state')
        continue
      }

      const missing = new Set(result.missing)
      const missingIds: string[] = []
      for (const chatId of batch) {
        if (missing.has(chatId)) {
          missingIds.push(chatId)
          continue
        }
        const hydration = result.chats.find((chat) => chat.chatId === chatId)
        if (!hydration) {
          missingIds.push(chatId)
          continue
        }
        const freshness = freshnessByChat.get(chatId)
        const staleReason = freshness ? chatHydrationStaleReason(chatId, freshness) : 'missing-freshness-token'
        if (staleReason) {
          recordHydrationStaleDrop('chat', staleReason)
          missingIds.push(chatId)
          continue
        }
        const applied = hydrateServerChatMessages(chatId, hydration.message, hydration.hypaV3Data)
        if (!applied) {
          missingIds.push(chatId)
          continue
        }
        markChatBodyResourceRevision(chatId, result.revision)
        markChatBodyProjectionApplied(chatId)
        reapplyRetainedChatBodyProjections(chatId)
        acknowledgeHydratedGenerationPersistences(chatId, hydration.message as Message[])
        hydratedChatIds.add(chatId)
        seedRerollBufferFromAlternates(hydration.message, hydration.alternates, rerollTargetForChatId(chatId))
        refreshPendingFreshnessAfterHydration(chatId, freshness)
      }
      if (options.strict && missingIds.length > 0) {
        throw new Error(`Bulk chat hydration did not return messages for: ${missingIds.join(', ')}`)
      }
    }
  } finally {
    for (const [chatId, freshness] of freshnessByChat) {
      endChatHydrationFreshness(chatId, freshness)
    }
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
  await hydrateActiveChatWindow(options.loadPages ?? getInitialChatLoadPages(getDatabase()), {
    force: options.force,
  })
}

/**
 * Ensure the current visible tail window is resident. This is the fast active
 * chat path: first open fetches only the tail; later scroll/jump expansion fills
 * just the newly visible unloaded ranges.
 */
export async function hydrateActiveChatWindow(loadPages: number, options: { force?: boolean } = {}): Promise<boolean> {
  const chatId = activeChatId()
  if (!chatId) return false
  if (!Number.isFinite(loadPages)) {
    await hydrateChat(chatId, { force: options.force, seedReroll: true })
    return activeChatId() === chatId && hydratedChatIds.has(chatId)
  }

  const messages = activeChatMessageArray()
  if (!messages || messages.length === 0 || options.force) {
    await hydrateChat(chatId, {
      force: options.force,
      range: { tail: requestedTailSize(loadPages) },
      seedReroll: true,
    })
    const hydratedMessages = activeChatMessageArray()
    return (
      activeChatId() === chatId &&
      !failedChatIds.has(chatId) &&
      Boolean(hydratedMessages) &&
      (hydratedChatIds.has(chatId) || unloadedRangesForTail(hydratedMessages!, loadPages).length === 0)
    )
  }

  const ranges = unloadedRangesForTail(messages, loadPages)
  for (const range of ranges) {
    await hydrateChat(chatId, {
      range,
      seedReroll: range.start + range.limit >= messages.length,
    })
  }
  const hydratedMessages = activeChatMessageArray()
  return (
    activeChatId() === chatId &&
    !failedChatIds.has(chatId) &&
    Boolean(hydratedMessages) &&
    unloadedRangesForTail(hydratedMessages!, loadPages).length === 0
  )
}

/** Hydrate the currently-open chat's complete transcript. */
export async function hydrateActiveChatFully(options: { force?: boolean } = {}): Promise<void> {
  const chatId = activeChatId()
  if (chatId) await hydrateChat(chatId, { force: options.force, seedReroll: true })
}

/** Hydrate a specific chat's complete transcript by id. */
export async function hydrateChatMessages(chatId: string, options: BulkHydrationOptions = {}): Promise<void> {
  if (!chatId || !canUseServerResourceReads()) return
  await hydrateChat(chatId, { force: options.force, seedReroll: activeChatId() === chatId })
  if (options.strict && !hydratedChatIds.has(chatId)) {
    throw new Error(`Chat hydration incomplete for: ${chatId}`)
  }
}

/**
 * Apply an already-fetched chat message payload to a chat directly (no refetch).
 * Used by the foreign `generation.persisted` per-chat resource branch, which
 * ships the changed chat's messages inline. Marks the chat hydrated and seeds
 * the swipe buffer when it is the open chat, mirroring `hydrateChat`'s apply.
 */
export function applyServerChatMessagesResource(
  chatId: string,
  message: unknown[],
  hypaV3Data: unknown,
  alternates: unknown[],
  range?: { start: number; total: number },
): boolean {
  if (!chatId) return false
  const applied = hydrateServerChatMessages(
    chatId,
    message,
    hypaV3Data,
    range ? { ...range, preserveExistingOnGrowth: true } : undefined,
  )
  if (!applied) return false
  advanceChatProjectionEpoch(chatId)
  reapplyRetainedChatBodyProjections(chatId)
  acknowledgeHydratedGenerationPersistences(chatId, message as Message[])
  if (!range || isFullRange(range.start, range.total, message.length)) {
    hydratedChatIds.add(chatId)
  }
  attemptedChatIds.add(chatId)
  failedChatIds.delete(chatId)
  seedRerollBufferFromAlternates(message, alternates, rerollTargetForChatId(chatId))
  return true
}

/**
 * Apply the canonical translation returned by this client's accepted command
 * and invalidate older transcript hydration already in flight. The stable chat
 * and message ids keep navigation changes from writing into the wrong row.
 */
export function applyMessageTranslationLocalEffect(
  chatId: string,
  messageId: string,
  translation: MessageTranslation,
): boolean {
  if (!chatId || !messageId) return false
  let applied = false
  withTrustedResourceWrite(() => {
    const chat = getDatabase()
      .characters?.flatMap((character) => character.chats ?? [])
      .find((candidate) => candidate.id === chatId)
    if (!chat) return
    const matches = (chat.message ?? []).filter((message) => message.chatId === messageId)
    if (matches.length !== 1) return
    matches[0].translation = JSON.parse(JSON.stringify(translation)) as MessageTranslation
    applied = true
  })
  if (!applied) return false
  advanceChatProjectionEpoch(chatId)
  return true
}

/**
 * Acknowledge an accepted optimistic transcript mutation without downloading
 * the transcript again. The row contents were already applied by the caller;
 * advancing the epoch only prevents an older in-flight hydration from
 * replacing them.
 */
export function acknowledgeMessageMutationLocalEffect(chatId: string): boolean {
  if (!chatId) return false
  const matches = getDatabase()
    .characters?.flatMap((character) => character.chats ?? [])
    .filter((candidate) => candidate.id === chatId)
  if (matches?.length !== 1) return false
  advanceChatProjectionEpoch(chatId)
  return true
}

/**
 * Confirm that a create/fork request supplied the complete transcript already
 * resident in the new chat. Besides invalidating older reads, mark even an
 * empty transcript hydrated so opening a freshly-created chat does not issue a
 * byte-for-byte confirmation request.
 */
export function acknowledgeCreatedChatTranscriptLocalEffect(chatId: string): boolean {
  if (!chatId) return false
  const matches = getDatabase()
    .characters?.flatMap((character) => character.chats ?? [])
    .filter((candidate) => candidate.id === chatId)
  if (matches?.length !== 1 || !Array.isArray(matches[0].message)) return false

  advanceChatProjectionEpoch(chatId)
  hydratedChatIds.add(chatId)
  attemptedChatIds.add(chatId)
  failedChatIds.delete(chatId)
  return true
}

/** True only when this session has the complete transcript resident for the chat. */
export function isChatMessageTranscriptHydrated(chatId: string | undefined): boolean {
  return !!chatId && hydratedChatIds.has(chatId)
}

setChatStructureHydrationHooks({
  markCreatedTranscript: acknowledgeCreatedChatTranscriptLocalEffect,
  invalidateTranscript: invalidateChatHydration,
  isTranscriptHydrated: isChatMessageTranscriptHydrated,
})

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
  if (!canUseServerResourceReads()) return false
  if (!chatId) return false
  if (messageCount > 0) return false
  if (hydratedChatIds.has(chatId)) return false
  if (attemptedChatIds.has(chatId)) return false
  return true
}

/** Reactive: did the latest hydration of this still-empty chat fail? */
export function hasChatMessageHydrationFailed(chatId: string | undefined, messageCount: number): boolean {
  if (!canUseServerResourceReads()) return false
  if (!chatId || messageCount > 0) return false
  if (hydratedChatIds.has(chatId)) return false
  return failedChatIds.has(chatId)
}

// Character globalLore hydration (only when stubs are on).

function activeCharacterId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  return getDatabase().characters?.[selId]?.chaId
}

/** Reactive: is this character's stubbed global lorebook waiting for hydration? */
export function isCharacterLorebookHydrationPending(characterId: string | undefined): boolean {
  if (!characterId || !canUseServerResourceReads()) return false
  if (hydratedCharLorebookIds.has(characterId) || isCharacterLorebookMutationReady(characterId)) return false
  return !attemptedCharLorebookIds.has(characterId)
}

/** Reactive: did the latest hydration of this character's global lorebook fail? */
export function hasCharacterLorebookHydrationFailed(characterId: string | undefined): boolean {
  if (!characterId) return false
  if (hydratedCharLorebookIds.has(characterId) || isCharacterLorebookMutationReady(characterId)) return false
  return !canUseServerResourceReads() || failedCharLorebookIds.has(characterId)
}

async function hydrateCharacterLorebook(characterId: string, force: boolean): Promise<void> {
  if (!canUseServerResourceReads()) return
  // Readiness follows the projection that is actually resident. A setting
  // transition can leave an older stub in memory even after stub mode is off.
  if (!force && (hydratedCharLorebookIds.has(characterId) || isCharacterLorebookMutationReady(characterId))) return
  const currentRequest = charLorebookInFlight.get(characterId)
  if (currentRequest) return currentRequest

  beginCharacterLorebookHydrationState(characterId)
  const generation = charLorebookHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const projectionEpoch = captureCharacterLorebookBodyProjectionEpoch(characterId)
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
      if (hasCharacterLorebookBodyProjectionEpochChanged(characterId, projectionEpoch)) {
        recordHydrationStaleDrop('characterLorebook', 'newer-character-lorebook-body-projection')
        return
      }

      const applied = hydrateServerCharacterLorebook(characterId, result.globalLore)
      if (!applied) return
      recordCanonicalCharacterLorebookScopes([{ chaId: characterId, globalLore: result.globalLore }])
      markCharacterLorebookBodyResourceRevision(characterId, result.revision)
      markCharacterLorebookProjectionApplied(characterId)
      // Mark hydrated so the lorebook watcher tracks (and persists) edits to it.
      markCharacterLorebookHydrated(characterId)
      hydratedCharLorebookIds.add(characterId)
    } catch (error) {
      hydrationWarning(`character lorebook ${characterId}`, error instanceof Error ? error.message : String(error))
    } finally {
      finishCharacterLorebookHydrationState(characterId, generation)
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
  if (!canUseServerResourceReads() || characterIds.length === 0) {
    return
  }

  const generation = charLorebookHydrationGeneration
  for (const characterId of characterIds) {
    beginCharacterLorebookHydrationState(characterId)
  }
  const projectionEpochs = new Map(
    characterIds.map((characterId) => [characterId, captureCharacterLorebookBodyProjectionEpoch(characterId)]),
  )
  for (const batch of bulkHydrationBatches(characterIds)) {
    const baselineRevision = peekCachedServerCommandRevision()
    const endRequest = beginHydrationRequest('characterLorebook')
    const result = await fetchServerBulkCharacterLorebooks(batch).finally(endRequest)
    if (result.status !== 'ok') {
      const message = resultError(result, 'server projection unavailable')
      hydrationWarning('bulk character lorebook', message)
      for (const characterId of batch) {
        finishCharacterLorebookHydrationState(characterId, generation)
      }
      if (options.strict) throw new Error(`Bulk character lorebook hydration failed: ${message}`)
      continue
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
      for (const characterId of batch) {
        finishCharacterLorebookHydrationState(characterId, generation)
      }
      if (options.strict) {
        throw new Error('Bulk character lorebook hydration result was older than local state')
      }
      continue
    }

    const missing = new Set(result.missing)
    const missingIds: string[] = []
    for (const characterId of batch) {
      if (missing.has(characterId)) {
        missingIds.push(characterId)
        finishCharacterLorebookHydrationState(characterId, generation)
        continue
      }
      const hydration = result.characters.find((character) => character.characterId === characterId)
      if (!hydration) {
        missingIds.push(characterId)
        finishCharacterLorebookHydrationState(characterId, generation)
        continue
      }
      const projectionEpoch = projectionEpochs.get(characterId)
      if (
        projectionEpoch === undefined ||
        hasCharacterLorebookBodyProjectionEpochChanged(characterId, projectionEpoch)
      ) {
        recordHydrationStaleDrop('characterLorebook', 'newer-character-lorebook-body-projection')
        finishCharacterLorebookHydrationState(characterId, generation)
        continue
      }
      const applied = hydrateServerCharacterLorebook(characterId, hydration.globalLore)
      if (!applied) {
        missingIds.push(characterId)
        finishCharacterLorebookHydrationState(characterId, generation)
        continue
      }
      recordCanonicalCharacterLorebookScopes([{ chaId: characterId, globalLore: hydration.globalLore }])
      markCharacterLorebookBodyResourceRevision(characterId, result.revision)
      markCharacterLorebookProjectionApplied(characterId)
      markCharacterLorebookHydrated(characterId)
      hydratedCharLorebookIds.add(characterId)
      finishCharacterLorebookHydrationState(characterId, generation)
    }
    if (options.strict && missingIds.length > 0) {
      throw new Error(`Bulk character lorebook hydration did not return data for: ${missingIds.join(', ')}`)
    }
  }
}

function bulkHydrationBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = []
  for (let offset = 0; offset < ids.length; offset += BULK_HYDRATION_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + BULK_HYDRATION_BATCH_SIZE))
  }
  return batches
}

/** Hydrate the open character's `globalLore` when its resident projection is a stub. */
export async function hydrateActiveCharacterLorebook(options: { force?: boolean } = {}): Promise<void> {
  const characterId = activeCharacterId()
  if (characterId) await hydrateCharacterLorebook(characterId, options.force ?? false)
}

/** Ensure one stable character id has real lorebook data before a bulk read/export. */
export async function ensureCharacterLorebookHydrated(
  characterId: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (!characterId) return false
  if (hydratedCharLorebookIds.has(characterId) || isCharacterLorebookMutationReady(characterId)) return true
  // A resident projection is recorded in the authoritative bridge registry at
  // bootstrap/refresh. If it is not recorded, fail closed even when reads are
  // unavailable or the stub setting just changed; exporting `[]` would create a
  // plausible-looking but incomplete file.
  if (!canUseServerResourceReads()) return false
  await hydrateCharacterLorebook(characterId, options.force ?? false)
  return hydratedCharLorebookIds.has(characterId) || isCharacterLorebookHydrated(characterId)
}

/**
 * Hydrate EVERY character's `globalLore`. Bulk readers (export, tokenizer) that
 * walk all characters' lorebooks must await this first when stubs are on.
 */
export async function ensureAllCharacterLorebooksHydrated(options: BulkHydrationOptions = {}): Promise<void> {
  if (!canUseServerResourceReads()) return
  const ids: string[] = []
  const pendingRequests: Promise<void>[] = []
  for (const character of getDatabase().characters ?? []) {
    if (
      typeof character.chaId !== 'string' ||
      !character.chaId ||
      hydratedCharLorebookIds.has(character.chaId) ||
      isCharacterLorebookMutationReady(character.chaId)
    ) {
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
    for (const character of getDatabase().characters ?? []) {
      if (
        typeof character.chaId === 'string' &&
        character.chaId &&
        !hydratedCharLorebookIds.has(character.chaId) &&
        !isCharacterLorebookMutationReady(character.chaId)
      ) {
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
  failedChatIds.clear()
  chatHydrationGeneration += 1
  inFlight.clear()
  chatProjectionEpochs.clear()
  pendingChatHydrationFreshness.clear()
  // A re-stub also re-stubs character globalLore; forget these marks so the open
  // character re-hydrates (the lorebook registry is reset in bootstrap.ts).
  hydratedCharLorebookIds.clear()
  attemptedCharLorebookIds.clear()
  failedCharLorebookIds.clear()
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
  if (!canUseServerResourceReads()) return
  const ids: string[] = []
  const pendingRequests: Promise<void>[] = []
  for (const character of getDatabase().characters ?? []) {
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
    for (const character of getDatabase().characters ?? []) {
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
let stopChatHydrationWiring: (() => void) | null = null
// Reactive mirror of the selected character index. `selectedCharID` is a store
// (not $state), so the hydration effect can't track it directly; this mirror is
// updated by a store subscription and read inside the effect, so the effect
// re-runs — and re-tracks the *new* character's chatPage — on a character switch.
let selectedCharMirror = $state(-1)

/**
 * Wire the hydration trigger: a reactive effect on the active chat id. It re-runs
 * on a character switch (via the `selectedCharMirror` $state) and on a chat
 * switch within a character (via the resource database's chats/chatPage state). It reads the
 * chat's id only — not `message` — so writing the hydrated messages does not
 * re-trigger it. Idempotent.
 */
export function startChatMessageHydration(): void {
  if (wired || !canUseServerResourceReads()) return
  wired = true
  const stopSelectedCharacterSubscription = selectedCharID.subscribe((value) => {
    selectedCharMirror = value
  })
  const stopHydrationEffect = $effect.root(() => {
    $effect(() => {
      if (selectedCharMirror < 0) return
      const character = getDatabase().characters?.[selectedCharMirror]
      const chatId = character?.chats?.[character?.chatPage ?? 0]?.id
      if (chatId) void hydrateActiveChat()
      // Hydrate the open character's globalLore. This reads chaId only, so
      // writing the hydrated entries does not re-trigger the effect.
      if (character?.chaId) void hydrateActiveCharacterLorebook()
    })
  })
  stopChatHydrationWiring = () => {
    stopSelectedCharacterSubscription()
    stopHydrationEffect()
  }
}

export function stopChatMessageHydration(): void {
  if (!wired) return
  wired = false
  stopChatHydrationWiring?.()
  stopChatHydrationWiring = null
  chatHydrationGeneration += 1
  charLorebookHydrationGeneration += 1
  inFlight.clear()
  charLorebookInFlight.clear()
  pendingChatHydrationFreshness.clear()
}
