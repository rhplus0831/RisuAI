import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import {
  currentChatStateSnapshot,
  dispatchReplaceMessages,
  dispatchUpdateMessage,
  ensureMessageId,
} from '../chatCommands'
import { safeStructuredClone } from '../polyfill'
import type { Chat, Message } from '../storage/database.svelte'
import { PreUnreroll, Prereroll } from './prereroll'

// Lazy-projection Phase 6c (client): the reroll *swipe* state machine, extracted
// out of `DefaultChatScreen.svelte` so it is unit-testable and so the persisted
// reroll buffer (server alternate rows) can be reconstructed into it on chat-open
// (`seedRerollBufferFromAlternates`). Behaviour is preserved verbatim from the
// component — the swipe E2E is the safety net.
//
// `rerolls` is the swipe history: each entry is the message *tail slice* a swipe
// restores (the last assistant message group); `rerollid` is the active position.
// The active transcript tail is itself `rerolls[rerollid]`, so the active
// selection is durable for free (it is the persisted tail) and a swipe only
// repositions it — it never has to write the buffer (the buffer rows are owned by
// the server, written at generation time and matched back here by `uid`).

let rerolls: Message[][] = []
let rerollid = -1
let lastCharId = -1

export interface RerollDeps {
  /** The component's send wrapper (owns the AbortController + send sound). */
  sendChatMain: (continued: boolean, regenerateMessageId?: string) => Promise<void>
  /** Close the chat input menu (component UI state). */
  closeMenu: () => void
}

function activeChatRecord(): Chat {
  const character = DBState.db.characters[get(selectedCharID)]
  return character.chats[character.chatPage]
}

function currentTailGenerationId(): string | undefined {
  return activeChatRecord()?.message.at(-1)?.generationInfo?.generationId
}

/** Reset the swipe history when the selected character changed since last use. */
export function resetRerollOnCharChange(): void {
  if (lastCharId !== get(selectedCharID)) {
    rerolls = []
    rerollid = -1
  }
}

/** Drop the swipe history — the send/continue confirm boundary. */
export function clearRerollBuffer(): void {
  rerolls = []
}

/** Record the just-generated tail as the newest swipe candidate (post-send). */
export function recordGeneratedReroll(previousLength: number): void {
  const message = activeChatRecord().message
  if (previousLength < message.length) {
    rerolls.push(safeStructuredClone(message).slice(previousLength))
    rerollid = rerolls.length - 1
  }
}

/** Mark the character a generation finished on (gates the char-change reset). */
export function markRerollChar(): void {
  lastCharId = get(selectedCharID)
}

export async function reroll(deps: RerollDeps): Promise<void> {
  resetRerollOnCharChange()
  const genId = currentTailGenerationId()
  if (genId) {
    const r = Prereroll(genId)
    if (r) {
      const previous = currentChatStateSnapshot()
      const currentChatRecord = activeChatRecord()
      const message = currentChatRecord.message[currentChatRecord.message.length - 1]
      const messageId = ensureMessageId(message)
      message.data = r
      dispatchUpdateMessage(messageId, { data: r }, previous)
      return
    }
  }
  if (rerollid < rerolls.length - 1) {
    if (Array.isArray(rerolls[rerollid + 1])) {
      rerollid += 1
      const rerollData = safeStructuredClone(rerolls[rerollid])
      const msgs = activeChatRecord().message
      for (let i = 0; i < rerollData.length; i++) {
        msgs[msgs.length - rerollData.length + i] = rerollData[i]
      }
      const previous = currentChatStateSnapshot()
      const currentChatRecord = activeChatRecord()
      currentChatRecord.message = msgs
      if (currentChatRecord.id) {
        dispatchReplaceMessages(currentChatRecord.id, msgs, previous)
      }
    }
    return
  }
  if (rerolls.length === 0) {
    rerolls.push(safeStructuredClone([activeChatRecord().message.at(-1)]) as Message[])
    rerollid = rerolls.length - 1
  }
  const cha = safeStructuredClone(activeChatRecord().message)
  if (cha.length === 0) {
    return
  }
  const regenerateMessageId =
    cha[cha.length - 1].role === 'user' ? undefined : ensureMessageId(cha[cha.length - 1])
  deps.closeMenu()
  const saying = cha[cha.length - 1].saying
  let sayingQu = 2
  while (cha[cha.length - 1].role !== 'user') {
    if (cha[cha.length - 1].saying === saying) {
      sayingQu -= 1
      if (sayingQu === 0) {
        break
      }
    }
    const msg = cha.pop()
    if (!msg) {
      return
    }
  }
  const previous = currentChatStateSnapshot()
  const currentChatRecord = activeChatRecord()
  currentChatRecord.message = cha
  if (currentChatRecord.id) {
    dispatchReplaceMessages(currentChatRecord.id, cha, previous)
  }
  await deps.sendChatMain(false, regenerateMessageId)
}

export async function unReroll(): Promise<void> {
  resetRerollOnCharChange()
  const genId = currentTailGenerationId()
  if (genId) {
    const r = PreUnreroll(genId)
    if (r) {
      const previous = currentChatStateSnapshot()
      const currentChatRecord = activeChatRecord()
      const message = currentChatRecord.message[currentChatRecord.message.length - 1]
      const messageId = ensureMessageId(message)
      message.data = r
      dispatchUpdateMessage(messageId, { data: r }, previous)
      return
    }
  }
  if (rerollid <= 0) {
    return
  }
  if (Array.isArray(rerolls[rerollid - 1])) {
    rerollid -= 1
    const rerollData = safeStructuredClone(rerolls[rerollid])
    const msgs = activeChatRecord().message
    for (let i = 0; i < rerollData.length; i++) {
      msgs[msgs.length - rerollData.length + i] = rerollData[i]
    }
    const previous = currentChatStateSnapshot()
    const currentChatRecord = activeChatRecord()
    currentChatRecord.message = msgs
    if (currentChatRecord.id) {
      dispatchReplaceMessages(currentChatRecord.id, msgs, previous)
    }
  }
}

// ── test/observability accessors ────────────────────────────────────────────────
export function getRerollBuffer(): Message[][] {
  return rerolls
}
export function getRerollId(): number {
  return rerollid
}
export function resetRerollNavigation(): void {
  rerolls = []
  rerollid = -1
  lastCharId = -1
}
