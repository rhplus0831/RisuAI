import { writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import type { SendChatFailure } from './sendChatFailure'

export type AcceptedSendRecoveryCause = 'generation_failed' | SendChatFailure['cause']

export interface AcceptedSendRecovery {
  id: string
  target: ActiveChatTarget
  messageId: string
  syntheticSayNothing: boolean
  cause: AcceptedSendRecoveryCause
  retrying: boolean
}

export const acceptedSendRecoveries = writable<AcceptedSendRecovery[]>([])

function messageField(message: unknown, field: 'chatId' | 'role'): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  return (message as Record<string, unknown>)[field]
}

/**
 * A successful durable send appends its assistant row directly after the
 * accepted user row. Generation finalization rejects a changed transcript, so
 * adjacency is a stronger completion proof than merely finding a later bot
 * message that may belong to another send.
 */
export function transcriptHasReplyForAcceptedSend(messages: readonly unknown[], messageId: string): boolean {
  const acceptedIndex = messages.findIndex(
    (message) => messageField(message, 'chatId') === messageId && messageField(message, 'role') === 'user',
  )
  if (acceptedIndex < 0) return false
  return messageField(messages[acceptedIndex + 1], 'role') === 'char'
}

export function removeAcceptedSendRecovery(id: string): void {
  acceptedSendRecoveries.update((recoveries) => recoveries.filter((recovery) => recovery.id !== id))
}

export function recordAcceptedSendRecovery(
  recovery: Omit<AcceptedSendRecovery, 'cause' | 'retrying'>,
  cause: AcceptedSendRecoveryCause,
  retrying = false,
): void {
  acceptedSendRecoveries.update((recoveries) => [
    ...recoveries.filter((candidate) => candidate.id !== recovery.id),
    { ...recovery, cause, retrying },
  ])
}

export function setAcceptedSendRecoveryRetrying(id: string, retrying: boolean): void {
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.map((recovery) => (recovery.id === id ? { ...recovery, retrying } : recovery)),
  )
}

/** Clear stale retry banners only after an authoritative transcript contains the reply. */
export function acknowledgeHydratedAcceptedSendRecoveries(chatId: string, messages: readonly unknown[]): void {
  if (!chatId) return
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.filter(
      (recovery) =>
        recovery.target.chatId !== chatId || !transcriptHasReplyForAcceptedSend(messages, recovery.messageId),
    ),
  )
}
