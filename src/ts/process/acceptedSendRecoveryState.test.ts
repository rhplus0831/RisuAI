import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationOperationProjection } from '../server/bootstrap'
import {
  clearDefaultChatComposerDrafts,
  readDefaultChatComposerDraft,
  writeDefaultChatComposerDraft,
} from '../../lib/ChatScreens/DefaultChatScreen.composerDrafts'
import { initializeDraftRecoveryScope, resetDraftRecoveryScopeForTests } from '../server/draftRecoveryScope'
import {
  acceptedSendRecoveries,
  acknowledgeHydratedAcceptedSendRecoveries,
  applyAcceptedSendBootstrapProjection,
  applyAcceptedSendOperationProjection,
  recordAcceptedSendRecovery,
  resetAcceptedSendRecoveryStateForTests,
  transcriptHasReplyForAcceptedSend,
} from './acceptedSendRecoveryState'

const target = {
  selectedCharID: 0,
  chatPage: 0,
  characterId: 'character-a',
  chatId: 'chat-a',
}

beforeEach(() => {
  resetAcceptedSendRecoveryStateForTests()
  resetDraftRecoveryScopeForTests()
  clearDefaultChatComposerDrafts()
  initializeDraftRecoveryScope({ databaseLineage: 'database-a', writerSessionId: 'writer-a' })
})

function operation(
  operationId: string,
  acceptedMessageId: string,
  state: GenerationOperationProjection['state'],
  overrides: Partial<GenerationOperationProjection> = {},
): GenerationOperationProjection {
  return {
    operationId,
    protocolVersion: 1,
    requestOrigin: 'accepted_send',
    state,
    stateVersion: 1,
    projectionEpoch: 1,
    creatorWriterSessionId: 'writer-a',
    creatorWriterEpoch: 1,
    characterId: 'character-a',
    chatId: 'chat-a',
    mode: 'send',
    acceptedMessageId,
    acceptedRevision: 2,
    providerMayHaveRun: false,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('accepted send recovery state', () => {
  it('recognizes only an adjacent assistant reply for the accepted user row', () => {
    expect(
      transcriptHasReplyForAcceptedSend(
        [
          { role: 'user', chatId: 'message-a' },
          { role: 'char', chatId: 'generation-a' },
        ],
        'message-a',
      ),
    ).toBe(true)
    expect(
      transcriptHasReplyForAcceptedSend(
        [
          { role: 'user', chatId: 'message-a' },
          { role: 'user', chatId: 'message-b' },
          { role: 'char', chatId: 'generation-b' },
        ],
        'message-a',
      ),
    ).toBe(false)
  })

  it('clears a stale recovery when authoritative hydration contains its reply', () => {
    recordAcceptedSendRecovery(
      {
        id: 'chat-a:message:message-a',
        target,
        messageId: 'message-a',
        syntheticSayNothing: false,
      },
      'generation_failed',
    )
    recordAcceptedSendRecovery(
      {
        id: 'chat-b:message:message-b',
        target: { ...target, chatId: 'chat-b' },
        messageId: 'message-b',
        syntheticSayNothing: false,
      },
      'generation_failed',
    )

    acknowledgeHydratedAcceptedSendRecoveries('chat-a', [
      { role: 'user', chatId: 'message-a' },
      { role: 'char', chatId: 'generation-a' },
    ])

    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({
        id: 'chat-b:message:message-b',
        target: expect.objectContaining({ chatId: 'chat-b' }),
      }),
    ])
  })

  it('restores distinct retryable, owned, and completed operations from bootstrap', () => {
    applyAcceptedSendBootstrapProjection(
      [
        operation('operation-retryable', 'message-retryable', 'retryable'),
        operation('operation-owned', 'message-owned', 'owned_by_job', {
          currentAttempt: {
            attemptNo: 1,
            retryRequestId: 'retry-owned',
            jobId: 'job-owned',
            status: 'running',
            serverInstanceId: 'server-a',
            actorWriterSessionId: 'writer-a',
            actorWriterEpoch: 1,
            launchRevision: 2,
          },
        }),
        operation('operation-completed', 'message-completed', 'completed', {
          resultMessageId: 'reply-completed',
        }),
      ],
      [],
      1,
    )

    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({ operationId: 'operation-completed', phase: 'completed' }),
      expect.objectContaining({ operationId: 'operation-owned', phase: 'owned_by_job', jobId: 'job-owned' }),
      expect.objectContaining({ operationId: 'operation-retryable', phase: 'retryable' }),
    ])

    acknowledgeHydratedAcceptedSendRecoveries('chat-a', [
      { role: 'user', chatId: 'message-completed' },
      {
        role: 'char',
        chatId: 'reply-completed',
        generationInfo: { operationId: 'another-operation' },
      },
    ])
    expect(get(acceptedSendRecoveries)).toHaveLength(3)

    acknowledgeHydratedAcceptedSendRecoveries('chat-a', [
      { role: 'user', chatId: 'message-completed' },
      {
        role: 'char',
        chatId: 'reply-completed',
        generationInfo: { operationId: 'operation-completed' },
      },
    ])
    expect(get(acceptedSendRecoveries).map((recovery) => recovery.operationId)).toEqual([
      'operation-owned',
      'operation-retryable',
    ])
  })

  it('suppresses Retry only for exact job lineage and retains unrelated same-chat warnings', () => {
    applyAcceptedSendBootstrapProjection(
      [operation('operation-a', 'message-a', 'retryable'), operation('operation-b', 'message-b', 'retryable')],
      [
        {
          chatId: 'chat-a',
          jobId: 'job-a',
          operationId: 'operation-a',
          acceptedMessageId: 'message-a',
        },
      ],
      1,
    )

    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({
        operationId: 'operation-a',
        phase: 'owned_by_job',
        jobId: 'job-a',
        unrelatedSameChatJob: false,
      }),
      expect.objectContaining({
        operationId: 'operation-b',
        phase: 'retryable',
        cause: 'generation_in_progress',
        unrelatedSameChatJob: true,
      }),
    ])
  })

  it('retains a newer retry authority when an older same-operation projection arrives late', () => {
    applyAcceptedSendOperationProjection(
      operation('operation-a', 'message-a', 'owned_by_job', {
        stateVersion: 6,
        projectionEpoch: 41,
        currentAttempt: {
          attemptNo: 2,
          retryRequestId: 'retry-current',
          jobId: 'job-current',
          status: 'running',
          serverInstanceId: 'server-a',
          actorWriterSessionId: 'writer-a',
          actorWriterEpoch: 1,
          launchRevision: 2,
        },
      }),
    )

    applyAcceptedSendOperationProjection(
      operation('operation-a', 'message-a', 'retryable', {
        stateVersion: 5,
        projectionEpoch: 40,
      }),
    )

    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({
        operationId: 'operation-a',
        phase: 'owned_by_job',
        stateVersion: 6,
        projectionEpoch: 41,
        jobId: 'job-current',
      }),
    ])
  })

  it('clears only the exact accepted composer generation, never a same-text resend', () => {
    const draft = {
      messageInput: 'duplicate text',
      messageInputTranslate: '',
      fileInput: [],
      draftText: '',
      btwText: '',
    }
    const firstGeneration = writeDefaultChatComposerDraft('chat-a', draft)
    expect(firstGeneration).not.toBeNull()

    writeDefaultChatComposerDraft('chat-a', { ...draft, messageInput: 'intermediate edit' })
    const resentGeneration = writeDefaultChatComposerDraft('chat-a', draft)
    expect(resentGeneration?.sequence).not.toBe(firstGeneration?.sequence)

    applyAcceptedSendOperationProjection(
      operation('operation-first', 'message-first', 'owned_by_job', {
        clientDraftGeneration: firstGeneration,
      }),
    )
    expect(readDefaultChatComposerDraft('chat-a')?.messageInput).toBe('duplicate text')

    applyAcceptedSendOperationProjection(
      operation('operation-resent', 'message-resent', 'owned_by_job', {
        projectionEpoch: 2,
        clientDraftGeneration: resentGeneration,
      }),
    )
    expect(readDefaultChatComposerDraft('chat-a')).toBeUndefined()
  })
})
