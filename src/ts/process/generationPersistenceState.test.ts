import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Message } from '../storage/database.svelte'

interface TestPersistenceDatabase {
  characters: Array<{
    chats: Array<{ id: string; message: Message[] }>
    [key: string]: unknown
  }>
}

const persistenceStateMocks = vi.hoisted(() => ({
  database: { characters: [] } as TestPersistenceDatabase,
  fetchBootstrap: vi.fn(),
  applyGenerationOperationBootstrap: vi.fn(),
  setPendingRecoveredGenerationEffects: vi.fn(),
  reconcilePendingRecoveredGenerationEffects: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => persistenceStateMocks.database,
}))

vi.mock('../server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (run: () => void) => run(),
}))

vi.mock('../server/bootstrap', () => ({
  fetchServerBootstrapReadOnly: persistenceStateMocks.fetchBootstrap,
}))

vi.mock('../server/generationOperations', () => ({
  applyGenerationOperationBootstrap: persistenceStateMocks.applyGenerationOperationBootstrap,
}))

vi.mock('./recoveredGenerationEffects', () => ({
  setPendingRecoveredGenerationEffects: persistenceStateMocks.setPendingRecoveredGenerationEffects,
  reconcilePendingRecoveredGenerationEffects: persistenceStateMocks.reconcilePendingRecoveredGenerationEffects,
}))

import {
  acknowledgeHydratedGenerationPersistences,
  buildGenerationPersistenceStateLookup,
  clearGenerationPersistence,
  generationFinalizationPersistences,
  generationPersistenceStateForMessage,
  generationPersistenceStateFromLookup,
  getGenerationFinalizationPersistencesForChat,
  resetGenerationFinalizationPersistencesForTests,
  setGenerationFinalizationPersistences,
  startGenerationFinalizationPersistenceRefresh,
} from './generationPersistenceState'
import { clearRetainedChatProjections, reapplyRetainedChatBodyProjections } from '../server/chatRetainedProjection'
import { registerGenerationOperationsRuntime, registerRecoveredEffectsRuntime } from './generationRuntimeBridge'

function seedMessages(messages: Message[]): void {
  persistenceStateMocks.database = {
    characters: [
      {
        type: 'character',
        chaId: 'character-a',
        name: 'Ada',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: messages }],
      },
    ],
  }
}

function currentMessages(): Message[] {
  return persistenceStateMocks.database.characters[0].chats[0].message as Message[]
}

beforeEach(() => {
  registerGenerationOperationsRuntime({
    applyGenerationOperationBootstrap: persistenceStateMocks.applyGenerationOperationBootstrap,
  } as never)
  registerRecoveredEffectsRuntime({
    reconcilePendingRecoveredGenerationEffects: persistenceStateMocks.reconcilePendingRecoveredGenerationEffects,
    setPendingRecoveredGenerationEffects: persistenceStateMocks.setPendingRecoveredGenerationEffects,
  })
  vi.useFakeTimers()
  persistenceStateMocks.database = { characters: [] }
  persistenceStateMocks.fetchBootstrap.mockReset()
  persistenceStateMocks.applyGenerationOperationBootstrap.mockReset()
  persistenceStateMocks.setPendingRecoveredGenerationEffects.mockReset()
  persistenceStateMocks.reconcilePendingRecoveredGenerationEffects.mockReset()
  persistenceStateMocks.reconcilePendingRecoveredGenerationEffects.mockResolvedValue(undefined)
  clearRetainedChatProjections()
  resetGenerationFinalizationPersistencesForTests()
})

afterEach(() => {
  resetGenerationFinalizationPersistencesForTests()
  clearRetainedChatProjections()
  persistenceStateMocks.database = { characters: [] }
  vi.useRealTimers()
})

describe('generation finalization persistence projection', () => {
  it('keeps chat-keyed subscribers isolated from another chat update', () => {
    setGenerationFinalizationPersistences([
      { chatId: 'chat-a', messageId: 'message-a', generationId: 'generation-a', state: 'queued' },
      { chatId: 'chat-b', messageId: 'message-b', generationId: 'generation-b', state: 'queued' },
    ])
    const chatAProjection = getGenerationFinalizationPersistencesForChat('chat-a')
    const chatBProjection = getGenerationFinalizationPersistencesForChat('chat-b')

    clearGenerationPersistence('chat-b', 'generation-b')

    expect(getGenerationFinalizationPersistencesForChat('chat-a')).toBe(chatAProjection)
    expect(getGenerationFinalizationPersistencesForChat('chat-b')).not.toBe(chatBProjection)
    expect(getGenerationFinalizationPersistencesForChat('chat-b')).toEqual([])
  })

  it('does not publish the flat or keyed projection for no-op clear and acknowledgement', () => {
    setGenerationFinalizationPersistences([
      { chatId: 'chat-a', messageId: 'message-a', generationId: 'generation-a', state: 'queued' },
    ])
    let flatPublishes = 0
    const unsubscribe = generationFinalizationPersistences.subscribe(() => {
      flatPublishes += 1
    })

    clearGenerationPersistence('chat-b', 'generation-b')
    acknowledgeHydratedGenerationPersistences('chat-b', [
      { role: 'char', data: 'other', chatId: 'message-b', generationInfo: { generationId: 'generation-b' } },
    ])

    expect(flatPublishes).toBe(1)
    expect(getGenerationFinalizationPersistencesForChat('chat-a')).toHaveLength(1)
    unsubscribe()
  })

  it('builds one ordered lookup for message and generation identifiers', () => {
    const lookup = buildGenerationPersistenceStateLookup([
      { chatId: 'chat-a', messageId: 'message-a', generationId: 'generation-a', state: 'stalled' },
      { chatId: 'chat-a', messageId: 'message-a', generationId: 'generation-b', state: 'terminal' },
    ])

    expect(generationPersistenceStateFromLookup(lookup, { role: 'char', data: '', chatId: 'message-a' })).toBe(
      'stalled',
    )
    expect(
      generationPersistenceStateFromLookup(lookup, {
        role: 'char',
        data: '',
        chatId: 'other',
        generationInfo: { generationId: 'generation-b' },
      }),
    ).toBe('terminal')
  })

  it('reconstructs a snapshot-fenced provisional send after authoritative hydration', () => {
    const tail: Message = { role: 'user', data: 'hello', chatId: 'user-a' }
    seedMessages([tail])

    setGenerationFinalizationPersistences([
      {
        generationId: 'generation-a',
        chatId: 'chat-a',
        messageId: 'generation-a',
        mode: 'send',
        state: 'queued',
        failureCount: 1,
        provisionalMessage: {
          role: 'char',
          data: 'reply awaiting persistence',
          chatId: 'generation-a',
          generationInfo: { generationId: 'generation-a' },
        },
        projectionFence: {
          mode: 'send',
          kind: 'tail',
          transcriptLength: 1,
          tail: { message: tail },
        },
      },
    ])

    reapplyRetainedChatBodyProjections('chat-a')

    expect(currentMessages()).toEqual([
      tail,
      expect.objectContaining({ chatId: 'generation-a', data: 'reply awaiting persistence' }),
    ])
    expect(
      generationPersistenceStateForMessage(get(generationFinalizationPersistences), 'chat-a', currentMessages()[1]),
    ).toBe('queued')
  })

  it('does not overwrite a target that changed after the bootstrap snapshot', () => {
    const original: Message = { role: 'char', data: 'original', chatId: 'message-a' }
    const newer: Message = { role: 'char', data: 'newer edit', chatId: 'message-a' }
    seedMessages([newer])

    setGenerationFinalizationPersistences([
      {
        generationId: 'generation-a',
        chatId: 'chat-a',
        messageId: 'message-a',
        mode: 'continue',
        state: 'stalled',
        failureCount: 3,
        provisionalMessage: {
          role: 'char',
          data: 'original plus generated text',
          chatId: 'message-a',
          generationInfo: { generationId: 'generation-a' },
        },
        projectionFence: {
          mode: 'continue',
          kind: 'target-tail',
          transcriptLength: 1,
          target: { message: original },
        },
      },
    ])

    reapplyRetainedChatBodyProjections('chat-a')

    expect(currentMessages()).toEqual([newer])
    expect(generationPersistenceStateForMessage(get(generationFinalizationPersistences), 'chat-a', newer)).toBe(
      'stalled',
    )
  })

  it('matches terminal legacy state only to its exact affected row', () => {
    const other: Message = { role: 'char', data: 'other', chatId: 'message-other' }
    const target: Message = { role: 'char', data: 'target', chatId: 'message-a' }
    seedMessages([other, target])
    generationFinalizationPersistences.set([
      {
        generationId: 'generation-a',
        chatId: 'chat-a',
        messageId: 'message-a',
        state: 'stalled_legacy',
      },
    ])

    expect(generationPersistenceStateForMessage(get(generationFinalizationPersistences), 'chat-a', other)).toBeNull()
    expect(generationPersistenceStateForMessage(get(generationFinalizationPersistences), 'chat-a', target)).toBe(
      'stalled_legacy',
    )
  })

  it('refreshes a queued row into the visible stalled state after the server threshold is reached', async () => {
    setGenerationFinalizationPersistences([
      {
        generationId: 'generation-a',
        chatId: 'chat-a',
        messageId: 'generation-a',
        mode: 'send',
        state: 'queued',
        failureCount: 1,
      },
    ])
    persistenceStateMocks.fetchBootstrap.mockResolvedValue({
      status: 'ok',
      bootstrap: {
        generationFinalizations: [
          {
            generationId: 'generation-a',
            chatId: 'chat-a',
            messageId: 'generation-a',
            mode: 'send',
            state: 'stalled',
            failureCount: 3,
          },
        ],
      },
    })

    startGenerationFinalizationPersistenceRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(get(generationFinalizationPersistences)).toEqual([
      expect.objectContaining({ generationId: 'generation-a', state: 'stalled', failureCount: 3 }),
    ])
  })

  it('reconciles the full bootstrap when a queued finalization commits without another stream event', async () => {
    setGenerationFinalizationPersistences([
      {
        generationId: 'generation-a',
        chatId: 'chat-a',
        messageId: 'generation-a',
        mode: 'send',
        state: 'queued',
        failureCount: 1,
      },
    ])
    const operation = {
      operationId: 'operation-a',
      protocolVersion: 1,
      requestOrigin: 'accepted_send',
      state: 'completed',
      stateVersion: 5,
      projectionEpoch: 9,
      creatorWriterSessionId: 'writer-a',
      creatorWriterEpoch: 1,
      chatId: 'chat-a',
      providerMayHaveRun: true,
    }
    const pendingEffect = {
      ledgerVersion: 1,
      databaseLineage: 'lineage-a',
      keyType: 'operation',
      keyId: 'operation-a',
      kind: 'igp',
      effectClass: 'durable',
      operationId: 'operation-a',
      generationId: 'generation-a',
      characterId: 'character-a',
      chatId: 'chat-a',
      messageId: 'generation-a',
      status: 'pending',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }
    const bootstrap = {
      initialized: true,
      revision: 4,
      generationOperationProtocol: { version: 1 },
      generationOperationProjectionEpoch: 9,
      generationOperations: [operation],
      activeGenerationJobs: [],
      generationFinalizations: [],
      pendingGenerationEffects: [pendingEffect],
    }
    persistenceStateMocks.fetchBootstrap.mockResolvedValue({ status: 'ok', bootstrap })

    startGenerationFinalizationPersistenceRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(persistenceStateMocks.applyGenerationOperationBootstrap).toHaveBeenCalledWith(bootstrap, 'bootstrap')
    expect(get(generationFinalizationPersistences)).toEqual([])
    expect(persistenceStateMocks.setPendingRecoveredGenerationEffects).toHaveBeenCalledWith([pendingEffect])
    expect(persistenceStateMocks.reconcilePendingRecoveredGenerationEffects).toHaveBeenCalledOnce()
  })

  it('retains the refresh trigger until recovered effects reconcile successfully', async () => {
    const queuedFinalization = {
      generationId: 'generation-a',
      chatId: 'chat-a',
      messageId: 'generation-a',
      mode: 'send' as const,
      state: 'queued' as const,
      failureCount: 1,
    }
    setGenerationFinalizationPersistences([queuedFinalization])
    persistenceStateMocks.fetchBootstrap.mockResolvedValue({
      status: 'ok',
      bootstrap: {
        generationFinalizations: [],
        pendingGenerationEffects: [],
      },
    })
    persistenceStateMocks.reconcilePendingRecoveredGenerationEffects.mockImplementationOnce(async () => {
      // Strict hydration inside effect recovery acknowledges the committed
      // assistant before the later effect work reports a transient failure.
      clearGenerationPersistence('chat-a', 'generation-a')
      throw new Error('effect runtime is not ready')
    })

    startGenerationFinalizationPersistenceRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(get(generationFinalizationPersistences)).toEqual([queuedFinalization])
    expect(persistenceStateMocks.reconcilePendingRecoveredGenerationEffects).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(get(generationFinalizationPersistences)).toEqual([])
    expect(persistenceStateMocks.reconcilePendingRecoveredGenerationEffects).toHaveBeenCalledTimes(2)
  })

  it('acknowledges persisted pending rows without silently clearing terminal history', () => {
    generationFinalizationPersistences.set([
      { chatId: 'chat-a', messageId: 'generation-a', generationId: 'generation-a', state: 'queued' },
      { chatId: 'chat-a', messageId: 'generation-b', generationId: 'generation-b', state: 'terminal' },
    ])

    acknowledgeHydratedGenerationPersistences('chat-a', [
      {
        role: 'char',
        data: 'persisted',
        chatId: 'generation-a',
        generationInfo: { generationId: 'generation-a' },
      },
      {
        role: 'char',
        data: 'unexpected terminal match',
        chatId: 'generation-b',
        generationInfo: { generationId: 'generation-b' },
      },
    ])

    expect(get(generationFinalizationPersistences)).toEqual([
      expect.objectContaining({ generationId: 'generation-b', state: 'terminal' }),
    ])
  })
})
