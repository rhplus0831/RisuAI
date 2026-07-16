import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import {
  currentChatScopedSnapshot,
  dispatchReplaceTailMessagesScoped,
  dispatchTruncateMessagesScoped,
  dispatchUpdateMessageScoped,
  ensureMessageId,
} from '../chatCommands'
import { safeStructuredClone } from '../polyfill'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { createLatestOperationGuard } from '../server/staleStateGuards'
import { getDatabase, type Chat, type Message } from '../storage/database.svelte'
import { clearPrererolls, PreUnreroll, Prereroll } from './prereroll'

// Reroll *swipe* state machine, extracted out of `DefaultChatScreen.svelte` so it
// is unit-testable and so persisted reroll buffers (server alternate rows) can be
// reconstructed on chat-open (`seedRerollBufferFromAlternates`). Behaviour is
// preserved verbatim from the component; the swipe E2E is the safety net.
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
let lastChatKey: string | undefined
const rerollOperationGuard = createLatestOperationGuard<string>()

export interface RerollDeps {
  /** The component's send wrapper (owns the AbortController + send sound). */
  sendChatMain: (continued: boolean, regenerateMessageId?: string) => Promise<boolean>
  /** Close the chat input menu (component UI state). */
  closeMenu: () => void
}

export interface RerollCandidate {
  index: number
  active: boolean
  messages: readonly Message[]
}

type RerollOperation = {
  token: ReturnType<typeof rerollOperationGuard.issue>
}

type RerollRecovery = {
  selectedCharID: number
  characterId: string | undefined
  chatPage: number
  chatId: string | undefined
  keepLength: number
  afterMessageId: string | null
  removedTail: Message[]
}

function activeChatRecord(): Chat {
  const character = getDatabase().characters[get(selectedCharID)]
  return character.chats[character.chatPage]
}

function currentRerollScope(): { charId: number; chatKey: string | undefined } {
  const charId = get(selectedCharID)
  const character = getDatabase().characters?.[charId]
  if (!character) return { charId, chatKey: undefined }
  const chatPage = character?.chatPage ?? -1
  const chat = character?.chats?.[chatPage]
  return {
    charId,
    chatKey: typeof chat?.id === 'string' && chat.id ? chat.id : `index:${chatPage}`,
  }
}

function currentRerollScopeTarget(): string {
  const scope = currentRerollScope()
  return `char:${scope.charId}|chat:${scope.chatKey ?? 'missing'}`
}

function beginRerollOperation(): RerollOperation {
  return {
    token: rerollOperationGuard.issue(currentRerollScopeTarget()),
  }
}

function isCurrentRerollOperation(operation: RerollOperation): boolean {
  return rerollOperationGuard.isLatest(operation.token) && currentRerollScopeTarget() === operation.token.target
}

function markRerollScope(): void {
  const scope = currentRerollScope()
  lastCharId = scope.charId
  lastChatKey = scope.chatKey
}

function currentTailGenerationId(): string | undefined {
  return activeChatRecord()?.message.at(-1)?.generationInfo?.generationId
}

/** Reset the swipe history when the selected character/chat changed since last use. */
export function resetRerollOnCharChange(): void {
  const scope = currentRerollScope()
  if (lastCharId !== scope.charId || lastChatKey !== scope.chatKey) {
    rerolls = []
    rerollid = -1
    clearPrererolls()
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
    // Clone only the freshly generated tail. `message.slice(previousLength)` is a
    // cheap shallow array of the 1-2 new rows; deep-cloning that is O(tail) and
    // byte-identical to the former `safeStructuredClone(message).slice(...)`, which
    // deep-cloned the entire transcript just to keep its last rows.
    rerolls.push(safeStructuredClone(message.slice(previousLength)))
    rerollid = rerolls.length - 1
  }
}

/** Mark the character a generation finished on (gates the char-change reset). */
export function markRerollChar(): void {
  markRerollScope()
}

// ── guard-safe optimistic mutations ─────────────────────────────────────────────
// In the live Fastify runtime the resource database is guarded against direct writes;
// a `message.data = …` / `record.message = …` outside a trusted scope throws. The
// optimistic local edit must run inside `withTrustedResourceWrite` and
// re-read the record there, then persist via the dispatch command. Before the guard
// is enabled (startup and focused tests), the wrapper is a pass-through.

/** Swap just the active tail message's `data` (prefetch reroll), then persist. */
function applyTailDataSwap(data: string, operation: RerollOperation): boolean {
  if (!isCurrentRerollOperation(operation)) return false
  const previous = currentChatScopedSnapshot()
  const messageId = withTrustedResourceWrite(() => {
    const record = activeChatRecord()
    const message = record.message[record.message.length - 1]
    const id = ensureMessageId(message)
    message.data = data
    return id
  })
  dispatchUpdateMessageScoped(messageId, { data }, previous, { optimisticPatchAlreadyApplied: true })
  return true
}

/** Overwrite the last `slice.length` messages with a saved candidate, then persist. */
function applyTailSlice(slice: Message[], operation: RerollOperation): boolean {
  if (!isCurrentRerollOperation(operation)) return false
  const previous = currentChatScopedSnapshot()
  const tail = withTrustedResourceWrite(() => {
    const msgs = activeChatRecord().message
    const start = msgs.length - slice.length
    const afterMessageId = start > 0 ? ensureMessageId(msgs[start - 1]) : null
    for (let i = 0; i < slice.length; i++) {
      msgs[start + i] = slice[i]
    }
    // Mint ids while the projection is writable so the by-reference dispatch
    // below never has to mutate a refrozen read-only message row.
    for (const message of msgs.slice(start)) {
      ensureMessageId(message)
    }
    return { afterMessageId, messages: msgs.slice(start) }
  })
  const record = activeChatRecord()
  if (record.id) {
    dispatchReplaceTailMessagesScoped(record.id, tail.afterMessageId, tail.messages, previous)
  }
  return true
}

/**
 * Reshape the trailing assistant group (regenerate prep) by truncating the live
 * transcript in place to `keepLength`, then persist the surviving rows. Truncating
 * keeps the existing rows by reference (no whole-transcript clone) and is
 * guard-safe: the surviving rows are the projection's own rows, never re-installed
 * proxies. The dispatch sends only the last retained message id, so the persisted
 * payload stays bounded to the truncate point.
 */
async function applyRerollTruncate(keepLength: number, operation: RerollOperation): Promise<RerollRecovery | null> {
  if (!isCurrentRerollOperation(operation)) return null
  const previous = currentChatScopedSnapshot()
  const character = getDatabase().characters[get(selectedCharID)]
  const record = character.chats[character.chatPage]
  const recovery: RerollRecovery = {
    selectedCharID: get(selectedCharID),
    characterId: character.chaId,
    chatPage: character.chatPage,
    chatId: record.id,
    keepLength,
    afterMessageId: null,
    removedTail: safeStructuredClone((previous.chat?.message ?? record.message).slice(keepLength)),
  }
  const afterMessageId = withTrustedResourceWrite(() => {
    const msgs = activeChatRecord().message
    msgs.length = keepLength
    return msgs.length > 0 ? ensureMessageId(msgs[msgs.length - 1]) : null
  })
  recovery.afterMessageId = afterMessageId
  if (afterMessageId && previous.chat?.message[keepLength - 1] && !previous.chat.message[keepLength - 1].chatId) {
    previous.chat.message[keepLength - 1].chatId = afterMessageId
  }
  if (recovery.chatId) {
    const result = await dispatchTruncateMessagesScoped(recovery.chatId, afterMessageId, previous, {
      preserveRemovedAsAlternates: true,
    })
    return result === null || result.status === 'ok' || result.status === 'unavailable' ? recovery : null
  }
  return recovery
}

function locateRerollRecoveryChat(recovery: RerollRecovery): Chat | undefined {
  const character = recovery.characterId
    ? getDatabase().characters?.find((candidate) => candidate.chaId === recovery.characterId)
    : getDatabase().characters?.[recovery.selectedCharID]
  if (!character) return undefined
  return recovery.chatId
    ? character.chats?.find((candidate) => candidate.id === recovery.chatId)
    : character.chats?.[recovery.chatPage]
}

function messageListsMatch(left: readonly Message[], right: readonly Message[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Restore the displaced assistant tail when regenerate never produces a replacement. */
function restoreFailedReroll(recovery: RerollRecovery): void {
  const record = locateRerollRecoveryChat(recovery)
  if (!record) return

  const removedTail = recovery.removedTail
  const liveMessages = record.message ?? []
  if (removedTail.length === 0) return
  const liveKeepLength =
    recovery.afterMessageId === null
      ? 0
      : liveMessages.findIndex((message) => message.chatId === recovery.afterMessageId) + 1
  if (recovery.afterMessageId !== null && liveKeepLength === 0) return
  if (messageListsMatch(liveMessages.slice(liveKeepLength), removedTail)) return
  // A failed regenerate may leave an assistant placeholder/partial after the
  // anchor, but must never erase a user row appended by another client.
  if (liveMessages.slice(liveKeepLength).some((message) => message.role === 'user')) return

  const previous = {
    selectedCharID: recovery.selectedCharID,
    characterId: recovery.characterId,
    chatId: recovery.chatId,
    chat: safeStructuredClone(record),
  }
  withTrustedResourceWrite(() => {
    const liveRecord = locateRerollRecoveryChat(recovery)
    if (!liveRecord) return
    liveRecord.message = liveRecord.message.slice(0, liveKeepLength).concat(safeStructuredClone(removedTail))
  })
  if (recovery.chatId) {
    dispatchReplaceTailMessagesScoped(
      recovery.chatId,
      recovery.afterMessageId,
      safeStructuredClone(removedTail),
      previous,
    )
  }
}

async function regenerateFromCurrentTail(deps: RerollDeps, operation: RerollOperation): Promise<void> {
  if (!isCurrentRerollOperation(operation)) {
    return
  }
  if (rerolls.length === 0) {
    rerolls.push(safeStructuredClone([activeChatRecord().message.at(-1)]) as Message[])
    rerollid = rerolls.length - 1
  }
  // `cha` is a shallow copy (shared row refs) used only to locate the truncation
  // point and the regenerate target — never installed — so the whole transcript is
  // no longer deep-cloned here. The regenerate id is minted on a throwaway copy of
  // the tail (so it never mutates the read-only projection row), and the live
  // transcript is truncated in place by `applyRerollTruncate`.
  const cha = activeChatRecord().message.slice()
  if (cha.length === 0) {
    return
  }
  const regenerateMessageId =
    cha[cha.length - 1].role === 'user' ? undefined : ensureMessageId({ ...cha[cha.length - 1] })
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
  const recovery = await applyRerollTruncate(cha.length, operation)
  if (!recovery) {
    return
  }
  if (!isCurrentRerollOperation(operation)) {
    // A newer operation in this same chat owns the tail now. A navigation to a
    // different chat has no such owner, so repair the original chat by id.
    if (currentRerollScopeTarget() !== operation.token.target) restoreFailedReroll(recovery)
    return
  }

  let generated = false
  try {
    generated = await deps.sendChatMain(false, regenerateMessageId)
  } finally {
    if (!generated) restoreFailedReroll(recovery)
  }
}

function applyNextPrefetchedReroll(operation: RerollOperation): boolean {
  if (!isCurrentRerollOperation(operation)) return false
  const genId = currentTailGenerationId()
  if (!genId) return false
  const r = Prereroll(genId)
  if (!r) return false
  return applyTailDataSwap(r, operation)
}

// Concurrency contract: callers MUST NOT invoke reroll/unReroll while a generation
// is in flight (the component wrappers gate on `$doingChat`). A swipe's
// dispatchReplaceMessages would otherwise race an in-flight regenerate's persist —
// the swap could remove the regenerate's target row before the server commits it.
// The one-job-per-chat lock + the `$doingChat` gate keep these mutually exclusive.
export async function reroll(deps: RerollDeps): Promise<void> {
  const operation = beginRerollOperation()
  try {
    resetRerollOnCharChange()
    if (!isCurrentRerollOperation(operation)) return
    if (applyNextPrefetchedReroll(operation)) return
    if (rerollid < rerolls.length - 1) {
      if (Array.isArray(rerolls[rerollid + 1])) {
        if (!isCurrentRerollOperation(operation)) return
        rerollid += 1
        applyTailSlice(safeStructuredClone(rerolls[rerollid]), operation)
      }
      return
    }
    await regenerateFromCurrentTail(deps, operation)
  } finally {
    rerollOperationGuard.clear(operation.token)
  }
}

/** Generate a fresh reroll candidate from the currently selected tail. */
export async function newReroll(deps: RerollDeps): Promise<void> {
  const operation = beginRerollOperation()
  try {
    resetRerollOnCharChange()
    if (!isCurrentRerollOperation(operation)) return
    if (applyNextPrefetchedReroll(operation)) return
    await regenerateFromCurrentTail(deps, operation)
  } finally {
    rerollOperationGuard.clear(operation.token)
  }
}

export async function unReroll(): Promise<void> {
  const operation = beginRerollOperation()
  try {
    resetRerollOnCharChange()
    if (!isCurrentRerollOperation(operation)) return
    const genId = currentTailGenerationId()
    if (genId) {
      const r = PreUnreroll(genId)
      if (r) {
        applyTailDataSwap(r, operation)
        return
      }
    }
    if (rerollid <= 0) {
      return
    }
    if (Array.isArray(rerolls[rerollid - 1])) {
      if (!isCurrentRerollOperation(operation)) return
      rerollid -= 1
      applyTailSlice(safeStructuredClone(rerolls[rerollid]), operation)
    }
  } finally {
    rerollOperationGuard.clear(operation.token)
  }
}

/** Select an existing candidate from the reroll list by absolute buffer index. */
export async function selectRerollCandidate(index: number): Promise<void> {
  const operation = beginRerollOperation()
  try {
    resetRerollOnCharChange()
    if (!Number.isInteger(index) || index < 0 || index >= rerolls.length) return
    if (index === rerollid) return
    if (!isCurrentRerollOperation(operation)) return
    rerollid = index
    applyTailSlice(safeStructuredClone(rerolls[rerollid]), operation)
  } finally {
    rerollOperationGuard.clear(operation.token)
  }
}

/** The per-message id (stored, by historical misnomer, on `Message.chatId`). */
function candidateUid(message: Message | undefined): string | undefined {
  const uid = message?.chatId
  return typeof uid === 'string' && uid.trim() ? uid : undefined
}

/**
 * Rebuild the swipe buffer from the chat's persisted reroll candidates (server
 * alternate rows) so rerolls survive a *reload*, not just a disconnect. Called on
 * active-chat hydration.
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
  markRerollScope()
}

// ── test/observability accessors ────────────────────────────────────────────────
export function getRerollBuffer(): Message[][] {
  return rerolls
}
export function getRerollId(): number {
  return rerollid
}
export function getRerollCandidates(): RerollCandidate[] {
  return rerolls.map((messages, index) => ({
    index,
    active: index === rerollid,
    messages,
  }))
}
export function resetRerollNavigation(): void {
  rerolls = []
  rerollid = -1
  lastCharId = -1
  lastChatKey = undefined
  clearPrererolls()
}
