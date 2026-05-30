import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import {
  hydrateServerCharacterLorebook,
  hydrateServerChatMessages,
} from '../storage/database.svelte'
import { seedRerollBufferFromAlternates } from '../process/rerollNavigation.svelte'
import { markCharacterLorebookHydrated } from './lorebookBridge.svelte'
import {
  canUseServerProjection,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
} from './projection'

// The bootstrap ships chat *stubs* (empty message[]). This bridge hydrates a
// chat's messages when it is opened and re-hydrates the open chat after a
// projection apply re-stubs it. Bulk readers that need every chat call
// `ensureAllChatsHydrated`.

// Chat ids whose messages this client has already hydrated this session, so
// re-opening a chat does not refetch. Cleared on a full re-stub (resync).
const hydratedChatIds = new Set<string>()
const inFlight = new Set<string>()

// Character ids whose `globalLore` this client has hydrated this session (only
// when the EXPERIMENTAL `enableLorebookStubs` setting is on).
const hydratedCharLorebookIds = new Set<string>()
const charLorebookInFlight = new Set<string>()

function activeChatId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = DBState.db?.characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.id
}

async function hydrateChat(chatId: string, force: boolean): Promise<void> {
  if (!canUseServerProjection()) return
  if (!force && hydratedChatIds.has(chatId)) return
  if (inFlight.has(chatId)) return
  inFlight.add(chatId)
  try {
    const result = await fetchServerChatMessages(chatId)
    if (result.status === 'ok') {
      hydrateServerChatMessages(chatId, result.message, result.hypaV3Data)
      hydratedChatIds.add(chatId)
      // Only the open chat's tail drives the swipe buffer; seed it from this
      // chat's persisted reroll candidates so rerolls survive a reload.
      if (activeChatId() === chatId) {
        seedRerollBufferFromAlternates(result.message, result.alternates)
      }
    }
  } finally {
    inFlight.delete(chatId)
  }
}

/** Hydrate the currently-open chat's messages (no-op if already hydrated). */
export async function hydrateActiveChat(options: { force?: boolean } = {}): Promise<void> {
  const chatId = activeChatId()
  if (chatId) await hydrateChat(chatId, options.force ?? false)
}

/** Hydrate a specific chat's messages by id (for single-chat bulk reads). */
export async function hydrateChatMessages(chatId: string): Promise<void> {
  if (chatId) await hydrateChat(chatId, false)
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
  if (charLorebookInFlight.has(characterId)) return
  charLorebookInFlight.add(characterId)
  try {
    const result = await fetchServerCharacterLorebook(characterId)
    if (result.status === 'ok') {
      hydrateServerCharacterLorebook(characterId, result.globalLore)
      // Mark hydrated so the lorebook watcher tracks (and persists) edits to it.
      markCharacterLorebookHydrated(characterId)
      hydratedCharLorebookIds.add(characterId)
    }
  } finally {
    charLorebookInFlight.delete(characterId)
  }
}

/** Hydrate the open character's `globalLore` (no-op if already hydrated / stubs off). */
export async function hydrateActiveCharacterLorebook(
  options: { force?: boolean } = {},
): Promise<void> {
  const characterId = activeCharacterId()
  if (characterId) await hydrateCharacterLorebook(characterId, options.force ?? false)
}

/**
 * Hydrate EVERY character's `globalLore`. Bulk readers (export, tokenizer) that
 * walk all characters' lorebooks must await this first when stubs are on.
 */
export async function ensureAllCharacterLorebooksHydrated(): Promise<void> {
  if (!canUseServerProjection() || !DBState.db?.enableLorebookStubs) return
  const ids: string[] = []
  for (const character of DBState.db?.characters ?? []) {
    if (
      typeof character.chaId === 'string' &&
      character.chaId &&
      !hydratedCharLorebookIds.has(character.chaId)
    ) {
      ids.push(character.chaId)
    }
  }
  await Promise.all(ids.map((id) => hydrateCharacterLorebook(id, false)))
}

/**
 * Forget cached hydration (call after a full projection re-apply / resync that
 * re-stubs every chat), so the next `hydrateActiveChat` refetches.
 */
export function resetChatHydration(): void {
  hydratedChatIds.clear()
  inFlight.clear()
  // A re-stub also re-stubs character globalLore; forget these marks so the open
  // character re-hydrates (the lorebook registry is reset in bootstrap.ts).
  hydratedCharLorebookIds.clear()
  charLorebookInFlight.clear()
}

/**
 * Hydrate EVERY chat's messages. Bulk readers (export-all, cold storage) that
 * walk all chats' history must await this first, since non-open chats are stubs.
 */
export async function ensureAllChatsHydrated(): Promise<void> {
  if (!canUseServerProjection()) return
  const ids: string[] = []
  for (const character of DBState.db?.characters ?? []) {
    for (const chat of character.chats ?? []) {
      if (typeof chat.id === 'string' && chat.id && !hydratedChatIds.has(chat.id)) {
        ids.push(chat.id)
      }
    }
  }
  await Promise.all(ids.map((id) => hydrateChat(id, false)))
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
