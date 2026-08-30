import type { MessageTranslation } from '../storage/database.svelte'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { getChatMessageOwnerState } from '../server/chatMessageHydration.svelte'
import { beginActiveMessageTranslation, publishSettledMessageTranslation } from '../server/messageTranslationJobs'
import { consumeServerOwnedGeneratedMessageEligibility } from './generatedMessageTranslationEligibility'
import type { ServerChatPostGeneration } from '@risuai/protocol/generation-sse'

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function rawMessageTranslation(value: unknown): MessageTranslation | null {
  if (!value || typeof value !== 'object') return null
  const translation = value as Partial<MessageTranslation>
  return translation.source === 'raw' && typeof translation.text === 'string'
    ? (translation as MessageTranslation)
    : null
}

export function applyEmbeddedGeneratedMessageTranslation(
  chatId: string,
  messageId: string,
  translation: unknown,
): boolean {
  const parsed = rawMessageTranslation(translation)
  if (!parsed || !chatId || !messageId) return false
  let applied = false
  withTrustedResourceWrite(() => {
    const matches =
      getChatMessageOwnerState(chatId)?.messages.filter((candidate) => candidate.chatId === messageId) ?? []
    if (matches.length !== 1) return
    const message = matches[0]
    message.translation = { ...parsed }
    applied = true
  })
  return applied
}

/**
 * Consumes the generated row's client auto-trigger before generation settles,
 * mirrors an embedded success immediately, and seeds the shared job state used
 * by Chat.svelte for success/failure/running UI.
 */
export function handleServerGeneratedMessageTranslation(
  chatId: string,
  postGeneration: ServerChatPostGeneration | undefined,
): void {
  const messageId = postGeneration?.messageId?.trim() ?? ''
  if (!messageId) return
  consumeServerOwnedGeneratedMessageEligibility(messageId)

  const frame = postGeneration?.translation
  if (!frame || !nonEmptyString(frame.jobId) || !chatId) return
  const jobId = frame.jobId.trim()
  if (frame.status === 'running') {
    beginActiveMessageTranslation({ chatId, messageId, jobId, status: 'running' })
    return
  }
  if (frame.status === 'failed') {
    publishSettledMessageTranslation({
      chatId,
      messageId,
      jobId,
      status: 'failed',
      error: nonEmptyString(frame.error) ? frame.error : 'Message translation failed',
    })
    return
  }
  if (frame.status !== 'succeeded') return

  applyEmbeddedGeneratedMessageTranslation(chatId, messageId, frame.translation)
  publishSettledMessageTranslation({ chatId, messageId, jobId, status: 'succeeded' })
}
