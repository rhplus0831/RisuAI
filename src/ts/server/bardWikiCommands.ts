import type { BardWikiDocument, BardWikiJobSummary, BardWikiReceiptSummary } from '@risuai/protocol'
import {
  createBardWikiDocumentCommand,
  confirmBardWikiAssistantCommand,
  deleteBardWikiDocumentCommand,
  patchBardWikiChatSettingsCommand,
  runServerCommand,
  updateBardWikiDocumentCommand,
  type BardWikiChatSettingsPatch,
  type BardWikiDocumentCommandFields,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './commands'
import { dispatchDurableMutation, registerDurableMutationSettlementListener } from './durableMutationDispatch'
import { stagePendingMutation, type DurableMutationIntent } from './pendingMutationOutbox'

export type BardWikiMutationFailure = Exclude<ServerCommandResult, { status: 'ok' }>
export type BardWikiMutationFinalOutcome =
  | { status: 'accepted' }
  | { status: 'failed'; result: BardWikiMutationFailure }

export type BardWikiMutationOutcome<T extends Record<string, unknown> = {}> =
  | { status: 'accepted'; result: Extract<ServerCommandResult<T>, { status: 'ok' }> }
  | {
      status: 'queued'
      result: BardWikiMutationFailure
      mutationId: string
      settlement: Promise<BardWikiMutationFinalOutcome>
    }
  | { status: 'conflict'; result: BardWikiMutationFailure }
  | { status: 'failed'; result: BardWikiMutationFailure }

interface DurableBardWikiMutationInput<T extends Record<string, unknown>> {
  key: string
  intent: DurableMutationIntent
  command: (baseRevision: number, signal?: AbortSignal | null) => Promise<ServerCommandResult<T>>
}

function isBardWikiConflict(result: BardWikiMutationFailure): boolean {
  return (
    result.status === 'conflict' ||
    (result.status === 'error' && result.error.startsWith('bardwiki_') && result.error.endsWith('_conflict'))
  )
}

function replayFailure(
  result: { status: string; currentRevision?: number; error?: string } | undefined,
): BardWikiMutationFailure {
  if (result?.status === 'conflict') return { status: 'conflict', currentRevision: result.currentRevision ?? 0 }
  if (result?.status === 'error') return { status: 'error', error: result.error ?? 'BardWiki mutation failed' }
  return { status: 'unavailable' }
}

async function dispatchBardWikiMutation<T extends Record<string, unknown>>(
  input: DurableBardWikiMutationInput<T>,
): Promise<BardWikiMutationOutcome<T>> {
  const outbox = stagePendingMutation(input.key, input.intent)
  let resolveSettlement!: (outcome: BardWikiMutationFinalOutcome) => void
  const settlement = new Promise<BardWikiMutationFinalOutcome>((resolve) => {
    resolveSettlement = resolve
  })
  const settlementCleanup = registerDurableMutationSettlementListener(outbox.mutationId, (final, details) => {
    resolveSettlement(
      final === 'accepted' ? { status: 'accepted' } : { status: 'failed', result: replayFailure(details.result) },
    )
  })
  let failureRollbackDisposition: ServerCommandTransportOptions['failureRollbackDisposition']
  let result: ServerCommandResult<T>
  try {
    result = await dispatchDurableMutation(outbox, input.intent, (transport) => {
      failureRollbackDisposition = transport.failureRollbackDisposition
      return runServerCommand({
        command: (baseRevision) => input.command(baseRevision, transport.signal),
        mutationId: transport.mutationId,
        databaseLineage: transport.databaseLineage,
        executionWrapper: transport.executionWrapper,
        failureRollbackDisposition: transport.failureRollbackDisposition,
      })
    })
  } catch (error) {
    result = {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (result.status === 'ok') {
    settlementCleanup()
    return { status: 'accepted', result }
  }
  if (failureRollbackDisposition?.(result) === 'retain') {
    return { status: 'queued', result, mutationId: outbox.mutationId, settlement }
  }
  settlementCleanup()
  if (isBardWikiConflict(result)) return { status: 'conflict', result }
  return { status: 'failed', result }
}

export function saveBardWikiChatSettings(
  chatId: string,
  patch: BardWikiChatSettingsPatch,
): Promise<BardWikiMutationOutcome<{ settings: Record<string, unknown> }>> {
  const path = `/bardwiki/chats/${encodeURIComponent(chatId)}/settings`
  const intent: DurableMutationIntent = { version: 1, requests: [{ method: 'PATCH', path, body: { patch } }] }
  return dispatchBardWikiMutation({
    key: `bardwiki-chat-settings:${chatId}`,
    intent,
    command: (baseRevision, signal) => patchBardWikiChatSettingsCommand({ baseRevision, chatId, patch }, signal),
  })
}

export function createBardWikiDocument(
  chatId: string,
  document: Required<Pick<BardWikiDocumentCommandFields, 'kind' | 'title' | 'logicalPath' | 'markdown'>> &
    BardWikiDocumentCommandFields,
): Promise<BardWikiMutationOutcome<{ document: BardWikiDocument }>> {
  const path = `/bardwiki/chats/${encodeURIComponent(chatId)}/documents`
  const intent: DurableMutationIntent = { version: 1, requests: [{ method: 'POST', path, body: { document } }] }
  return dispatchBardWikiMutation({
    key: `bardwiki-document-create:${chatId}`,
    intent,
    command: (baseRevision, signal) => createBardWikiDocumentCommand({ baseRevision, chatId, document }, signal),
  })
}

export function updateBardWikiDocument(
  chatId: string,
  documentId: string,
  fence: { expectedVersion: number; expectedContentHash: string },
  patch: BardWikiDocumentCommandFields,
): Promise<BardWikiMutationOutcome<{ document: BardWikiDocument }>> {
  const path = `/bardwiki/chats/${encodeURIComponent(chatId)}/documents/${encodeURIComponent(documentId)}`
  const body = { ...fence, patch }
  const intent: DurableMutationIntent = { version: 1, requests: [{ method: 'PATCH', path, body }] }
  return dispatchBardWikiMutation({
    key: `bardwiki-document:${chatId}:${documentId}`,
    intent,
    command: (baseRevision, signal) =>
      updateBardWikiDocumentCommand({ baseRevision, chatId, documentId, ...fence, patch }, signal),
  })
}

export function deleteBardWikiDocument(
  chatId: string,
  documentId: string,
  fence: { expectedVersion: number; expectedContentHash: string },
): Promise<BardWikiMutationOutcome<{ document: BardWikiDocument }>> {
  const path = `/bardwiki/chats/${encodeURIComponent(chatId)}/documents/${encodeURIComponent(documentId)}`
  const intent: DurableMutationIntent = { version: 1, requests: [{ method: 'DELETE', path, body: fence }] }
  return dispatchBardWikiMutation({
    key: `bardwiki-document:${chatId}:${documentId}`,
    intent,
    command: (baseRevision, signal) =>
      deleteBardWikiDocumentCommand({ baseRevision, chatId, documentId, ...fence }, signal),
  })
}

export function confirmBardWikiAssistant(
  chatId: string,
  source: {
    userMessageId: string
    userContentHash: string
    assistantMessageId: string
    assistantContentHash: string
  },
): Promise<BardWikiMutationOutcome<{ receipt: BardWikiReceiptSummary; job: BardWikiJobSummary; created: boolean }>> {
  const path = `/bardwiki/chats/${encodeURIComponent(chatId)}/confirmations`
  const intent: DurableMutationIntent = { version: 1, requests: [{ method: 'POST', path, body: source }] }
  return dispatchBardWikiMutation({
    key: `bardwiki-confirmation:${chatId}:${source.assistantMessageId}:${source.assistantContentHash}`,
    intent,
    command: (baseRevision, signal) => confirmBardWikiAssistantCommand({ baseRevision, chatId, ...source }, signal),
  })
}
