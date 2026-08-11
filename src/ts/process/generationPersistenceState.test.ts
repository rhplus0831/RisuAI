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

import {
  acknowledgeHydratedGenerationPersistences,
  generationFinalizationPersistences,
  generationPersistenceStateForMessage,
  resetGenerationFinalizationPersistencesForTests,
  setGenerationFinalizationPersistences,
  startGenerationFinalizationPersistenceRefresh,
} from './generationPersistenceState'
import { clearRetainedChatProjections, reapplyRetainedChatBodyProjections } from '../server/chatRetainedProjection'

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
  vi.useFakeTimers()
  persistenceStateMocks.database = { characters: [] }
  persistenceStateMocks.fetchBootstrap.mockReset()
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
