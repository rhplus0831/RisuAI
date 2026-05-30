import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import { hydrateServerChatMessages } from '../storage/database.svelte'
import { canUseServerProjection, fetchServerChatMessages } from './projection'

// Lazy-projection Phase 4.3: the bootstrap ships chat *stubs* (empty message[]).
// This bridge hydrates a chat's messages from the server when it is opened, and
// re-hydrates the open chat after a projection apply re-stubs it. Chats other
// than the open one stay stubbed until opened (the lazy win); bulk readers that
// need every chat call `ensureAllChatsHydrated`.

// Chat ids whose messages this client has already hydrated this session, so
// re-opening a chat does not refetch. Cleared on a full re-stub (resync).
const hydratedChatIds = new Set<string>()
const inFlight = new Set<string>()

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
      hydrateServerChatMessages(chatId, result.message)
      hydratedChatIds.add(chatId)
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

/**
 * Forget cached hydration (call after a full projection re-apply / resync that
 * re-stubs every chat), so the next `hydrateActiveChat` refetches.
 */
export function resetChatHydration(): void {
  hydratedChatIds.clear()
  inFlight.clear()
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
    })
  })
}
