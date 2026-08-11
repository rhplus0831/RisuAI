import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  acknowledgeLocalEffect: vi.fn(),
  appendOptimistic: vi.fn(),
  applyAcceptedJobs: vi.fn(),
  applyAcceptedOperation: vi.fn(),
  applyAcceptedBootstrap: vi.fn(),
  beginDispatch: vi.fn(),
  discard: vi.fn(),
  getBaseRevision: vi.fn(),
  peekRevision: vi.fn(),
  setRevision: vi.fn(),
  stage: vi.fn(),
}))

vi.mock('../chatCommands', () => ({
  appendOptimisticGenerationOperationUserMessage: operationMocks.appendOptimistic,
  toMessageSnapshot: (message: unknown) => structuredClone(message),
}))
vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => 'auth-a') }))
vi.mock('../process/acceptedSendRecoveryState', () => ({
  applyAcceptedSendActiveJobProjection: operationMocks.applyAcceptedJobs,
  applyAcceptedSendBootstrapProjection: operationMocks.applyAcceptedBootstrap,
  applyAcceptedSendOperationProjection: operationMocks.applyAcceptedOperation,
  clearAcceptedSendRecoveryProjection: vi.fn(),
}))
vi.mock('./activeWriterSession', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-a' }),
  handleActiveWriterStaleResponse: vi.fn(),
}))
vi.mock('./commands', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-a' }),
  getServerCommandBaseRevision: operationMocks.getBaseRevision,
  peekCachedServerCommandRevision: operationMocks.peekRevision,
  setCachedServerCommandRevision: operationMocks.setRevision,
  SERVER_DATABASE_LINEAGE_HEADER: 'risu-database-lineage',
}))
vi.mock('./chatMessageHydration.svelte', () => ({
  acknowledgeMessageMutationLocalEffect: operationMocks.acknowledgeLocalEffect,
}))
vi.mock('./pendingMutationOutbox', () => ({
  beginPendingMutationDispatch: operationMocks.beginDispatch,
  discardPendingMutation: operationMocks.discard,
  isGenerationOperationPendingIntent: (intent: { kind?: string }) =>
    intent.kind === 'generation-operation-submit' || intent.kind === 'generation-operation-retry',
  stagePendingMutation: operationMocks.stage,
}))
vi.mock('./bootstrap', () => ({
  parseGenerationOperations: (values: unknown[]) =>
    values.filter(
      (value): value is Record<string, unknown> =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).operationId === 'string',
    ),
}))

import {
  dispatchGenerationOperationPendingReplay,
  stageAcceptedSendGenerationOperation,
  submitStagedAcceptedSendOperation,
} from './generationOperations'

const operationId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'

function responseBody(state = 'owned_by_job') {
  return {
    operation: {
      operationId,
      protocolVersion: 1,
      requestOrigin: 'accepted_send',
      state,
      stateVersion: 2,
      projectionEpoch: 3,
      creatorWriterSessionId: 'writer-a',
      creatorWriterEpoch: 1,
      characterId: 'character-a',
      chatId: 'chat-a',
      mode: 'send',
      acceptedMessageId: messageId,
      acceptedRevision: 8,
      providerMayHaveRun: false,
      currentAttempt: {
        attemptNo: 1,
        retryRequestId: 'retry-a',
        jobId: 'job-a',
        status: 'running',
        serverInstanceId: 'server-a',
        actorWriterSessionId: 'writer-a',
        actorWriterEpoch: 1,
        launchRevision: 8,
      },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:01.000Z',
    },
    append: { disposition: 'accepted', messageId, revision: 8 },
    stream: {
      href: `/api/v1/generation-operations/${operationId}/stream?attemptNo=1&jobId=job-a&projectionEpoch=3`,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  let uuidIndex = 0
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => [operationId, messageId][uuidIndex++] ?? operationId),
  })
  operationMocks.peekRevision.mockReturnValue(7)
  operationMocks.getBaseRevision.mockResolvedValue(7)
  operationMocks.beginDispatch.mockResolvedValue('persisted')
  operationMocks.discard.mockResolvedValue('deleted')
  operationMocks.appendOptimistic.mockReturnValue({ status: 'ok', rollback: vi.fn() })
  operationMocks.stage.mockImplementation((key: string) => ({
    key,
    mutationId: 'mutation-a',
    sequence: 1,
    ownerWriterSessionId: 'writer-a',
    writerEpoch: 1,
    databaseLineage: 'database-a',
    phase: 'staged',
    ready: Promise.resolve('persisted'),
  }))
})

describe('generation operation client', () => {
  it('creates both UUIDs before durable staging and appends only after staging is ready', async () => {
    let releaseReady!: () => void
    const ready = new Promise<'persisted'>((resolve) => {
      releaseReady = () => resolve('persisted')
    })
    operationMocks.stage.mockImplementationOnce((key: string) => ({
      key,
      mutationId: 'mutation-a',
      sequence: 1,
      ownerWriterSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
      phase: 'staged',
      ready,
    }))

    const staging = stageAcceptedSendGenerationOperation({
      target: { selectedCharID: 0, chatPage: 0, characterId: 'character-a', chatId: 'chat-a' },
      message: 'hello',
      draftGeneration: { sequence: 4 },
      generation: {
        syntheticSayNothing: false,
        resetMessages: false,
        inlayAssetRefs: [],
        clientContext: {},
        clientCapabilities: {},
      },
    })

    expect(operationMocks.stage).toHaveBeenCalledWith(
      `generation-operation-submit:${operationId}`,
      expect.objectContaining({
        kind: 'generation-operation-submit',
        requests: [
          expect.objectContaining({
            path: '/generation-operations',
            body: expect.objectContaining({ operationId, acceptedMessageId: messageId }),
          }),
        ],
      }),
    )
    expect(operationMocks.appendOptimistic).not.toHaveBeenCalled()

    releaseReady()
    const staged = await staging
    expect('status' in staged).toBe(false)
    expect(operationMocks.appendOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a' }),
      expect.objectContaining({ chatId: messageId, data: 'hello' }),
    )
  })

  it('replays the exact staged operation after a lost response without appending twice', async () => {
    const staged = await stageAcceptedSendGenerationOperation({
      target: { selectedCharID: 0, chatPage: 0, characterId: 'character-a', chatId: 'chat-a' },
      message: 'hello',
      generation: {
        syntheticSayNothing: false,
        resetMessages: false,
        inlayAssetRefs: [],
        clientContext: {},
        clientCapabilities: {},
      },
    })
    if ('status' in staged) throw new Error(staged.error)

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost after write'))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitStagedAcceptedSendOperation(staged)).resolves.toMatchObject({ status: 'retained' })
    expect(operationMocks.discard).not.toHaveBeenCalled()

    await expect(dispatchGenerationOperationPendingReplay(staged.handle, staged.intent)).resolves.toMatchObject({
      disposition: 'succeeded',
      result: { status: 'accepted' },
    })
    expect(operationMocks.appendOptimistic).toHaveBeenCalledTimes(1)
    expect(operationMocks.discard).toHaveBeenCalledWith(staged.handle)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const replayBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(replayBody).toEqual(firstBody)
    expect(replayBody).toMatchObject({ operationId, acceptedMessageId: messageId })
  })
})
