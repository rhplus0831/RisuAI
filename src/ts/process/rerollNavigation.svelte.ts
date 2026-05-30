import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import {
  currentChatStateSnapshot,
  dispatchReplaceMessages,
  dispatchUpdateMessage,
  ensureMessageId,
} from '../chatCommands'
import { safeStructuredClone } from '../polyfill'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
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

// ── guard-safe optimistic mutations ─────────────────────────────────────────────
// In Fastify web mode `DBState.db` is a deep read-only projection proxy; a direct
// `message.data = …` / `record.message = …` throws. The optimistic local edit must
// run inside `withTrustedServerProjectionWrite` and RE-READ the record there (the
// wrapper swaps `DBState.db` for a mutable snapshot for the duration), then persist
// via the dispatch command. Off Fastify the wrapper is a pass-through, so behaviour
// is identical. (See the `phase9-guard-optimistic-write-gap` precedent.)

/** Swap just the active tail message's `data` (prefetch reroll), then persist. */
function applyTailDataSwap(data: string): void {
  const previous = currentChatStateSnapshot()
  const messageId = withTrustedServerProjectionWrite(() => {
    const record = activeChatRecord()
    const message = record.message[record.message.length - 1]
    const id = ensureMessageId(message)
    message.data = data
    return id
  })
  dispatchUpdateMessage(messageId, { data }, previous)
}

/** Overwrite the last `slice.length` messages with a saved candidate, then persist. */
function applyTailSlice(slice: Message[]): void {
  const previous = currentChatStateSnapshot()
  withTrustedServerProjectionWrite(() => {
    const msgs = activeChatRecord().message
    for (let i = 0; i < slice.length; i++) {
      msgs[msgs.length - slice.length + i] = slice[i]
    }
  })
  const record = activeChatRecord()
  if (record.id) {
    dispatchReplaceMessages(record.id, safeStructuredClone(record.message), previous)
  }
}

/** Replace the whole active transcript (regenerate prep: the popped tail), then persist. */
function applyTranscript(messages: Message[]): void {
  const previous = currentChatStateSnapshot()
  withTrustedServerProjectionWrite(() => {
    activeChatRecord().message = messages
  })
  const record = activeChatRecord()
  if (record.id) {
    dispatchReplaceMessages(record.id, messages, previous)
  }
}

// Concurrency contract: callers MUST NOT invoke reroll/unReroll while a generation
// is in flight (the component wrappers gate on `$doingChat`). A swipe's
// dispatchReplaceMessages would otherwise race an in-flight regenerate's persist —
// the swap could remove the regenerate's target row before the server commits it.
// The one-job-per-chat lock + the `$doingChat` gate keep these mutually exclusive.
export async function reroll(deps: RerollDeps): Promise<void> {
  resetRerollOnCharChange()
  const genId = currentTailGenerationId()
  if (genId) {
    const r = Prereroll(genId)
    if (r) {
      applyTailDataSwap(r)
      return
    }
  }
  if (rerollid < rerolls.length - 1) {
    if (Array.isArray(rerolls[rerollid + 1])) {
      rerollid += 1
      applyTailSlice(safeStructuredClone(rerolls[rerollid]))
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
  applyTranscript(cha)
  await deps.sendChatMain(false, regenerateMessageId)
}

export async function unReroll(): Promise<void> {
  resetRerollOnCharChange()
  const genId = currentTailGenerationId()
  if (genId) {
    const r = PreUnreroll(genId)
    if (r) {
      applyTailDataSwap(r)
      return
    }
  }
  if (rerollid <= 0) {
    return
  }
  if (Array.isArray(rerolls[rerollid - 1])) {
    rerollid -= 1
    applyTailSlice(safeStructuredClone(rerolls[rerollid]))
  }
}

/** The per-message id (stored, by historical misnomer, on `Message.chatId`). */
function candidateUid(message: Message | undefined): string | undefined {
  const uid = message?.chatId
  return typeof uid === 'string' && uid.trim() ? uid : undefined
}

/**
 * Lazy-projection Phase 6c (client): rebuild the swipe buffer from the chat's
 * persisted reroll candidates (server alternate rows) so rerolls survive a
 * *reload*, not just a disconnect. Called on active-chat hydration.
 *
 * The server buffers EVERY candidate of the live turn (Option X / the design
 * doc's "insert the new candidate as an alternate row and flip the active tail"),
 * so the active transcript tail is itself one of the candidates — matched back
 * here by `uid` and positioned as `rerollid`. A swipe then only repositions the
 * active tail (already durable as the persisted transcript); the buffer is never
 * rewritten by navigation. Order is informational only (the guarantee is "not
 * lost"); the server ships newest-added first, so we reverse for oldest-first.
 *
 * Reconciliation: when there are no persisted candidates we leave the live buffer
 * untouched (a fresh / already-cleared turn — a send/continue clears both sides at
 * the confirm boundary, so an empty `alternates` can never resurrect a buffer the
 * client just cleared).
 */
export function seedRerollBufferFromAlternates(activeMessages: unknown[], alternates: unknown[]): void {
  if (!Array.isArray(alternates) || alternates.length === 0) return
  const activeTail = (activeMessages as Message[]).at(-1)
  if (!activeTail || activeTail.role === 'user') return

  const seen = new Set<string>()
  const candidates: Message[] = []
  // Server ships newest-added first → reverse to oldest-first for a natural swipe
  // order; dedup by uid (the buffer holds the active candidate too).
  for (const candidate of (alternates as Message[]).slice().reverse()) {
    const uid = candidateUid(candidate)
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    candidates.push(candidate)
  }
  if (candidates.length === 0) return

  // Position the active tail. It is normally already among the candidates (the
  // server buffers it) — swap in the live message (freshest content); otherwise
  // (legacy displaced-only rows) append it as the newest.
  const activeUid = candidateUid(activeTail)
  let activeIdx = activeUid ? candidates.findIndex((c) => candidateUid(c) === activeUid) : -1
  if (activeIdx === -1) {
    candidates.push(activeTail)
    activeIdx = candidates.length - 1
  } else {
    candidates[activeIdx] = activeTail
  }

  rerolls = candidates.map((candidate) => [safeStructuredClone(candidate)])
  rerollid = activeIdx
  // The buffer now belongs to the selected character — keep the char-change guard
  // from wiping the freshly-seeded buffer on the next reroll/unReroll.
  lastCharId = get(selectedCharID)
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
