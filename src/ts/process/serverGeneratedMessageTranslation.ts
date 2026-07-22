import { getDatabase, type MessageTranslation } from '../storage/database.svelte'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { beginActiveMessageTranslation, publishSettledMessageTranslation } from '../server/messageTranslationJobs'
import { consumeServerOwnedGeneratedMessageEligibility } from './generatedMessageTranslationEligibility'
import type { ServerChatPostGeneration } from './request/serverChatEvents'

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
    for (const character of getDatabase().characters ?? []) {
      const chat = character.chats?.find((candidate) => candidate.id === chatId)
      if (!chat) continue
      const message = chat.message?.find((candidate) => candidate.chatId === messageId)
      if (!message) continue
      message.translation = { ...parsed }
      applied = true
      return
    }
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
