import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerGenerationEffectLedgerRef } from './request/serverChatEvents'

const state = vi.hoisted(() => ({
  order: [] as string[],
  db: {
    igpPrompt: 'IGP prompt',
    emotionProcesser: 'embedding',
    characters: [
      {
        chaId: 'character-a',
        name: 'Character',
        viewScreen: 'emotion',
        inlayViewScreen: false,
        emotionImages: [['happy', 'happy.png']],
        chats: [
          {
            id: 'chat-a',
            message: [
              { role: 'user', data: 'hello', chatId: 'user-a' },
              {
                role: 'char',
                data: 'reply',
                chatId: 'message-a',
                generationInfo: { generationId: 'generation-a', databaseLineage: 'lineage-a' },
              },
            ],
          },
        ],
      },
    ],
  },
}))

vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.db }))
vi.mock('../plugins/chatOutputListeners', () => ({
  chatOutputListeners: new Set([vi.fn()]),
  runChatOutputListeners: vi.fn(async () => {
    state.order.push('plugin_output')
  }),
}))
vi.mock('../server/chatMessageHydration.svelte', () => ({ hydrateChatMessages: vi.fn() }))
vi.mock('./postGeneration/igp', () => ({
  evaluateIgp: vi.fn(async () => {
    state.order.push('igp')
    return true
  }),
}))
vi.mock('./postGeneration/charEmotionStore', () => ({
  loadAndTrimCharEmotion: () => ({ tempEmotion: [], charemotions: {} }),
}))
vi.mock('./postGeneration/emotionFallbackEmbedding', () => ({
  runEmotionEmbeddingFallback: vi.fn(async () => {
    state.order.push('emotion_image_state')
  }),
}))
vi.mock('./postGeneration/emotionFallbackLlm', () => ({ runEmotionLlmFallback: vi.fn() }))
vi.mock('./postGeneration/imggenStableDiff', () => ({ runImggenStableDiff: vi.fn() }))
vi.mock('./postGeneration/stableTarget', () => ({ stablePostGenerationMessageTarget: vi.fn() }))

const ledger = vi.hoisted(() => ({ calls: [] as string[], receipts: new Set<string>() }))
vi.mock('./generationEffectLedger', async (importOriginal) => {
  const original = await importOriginal<typeof import('./generationEffectLedger')>()
  return {
    ...original,
    runLedgeredGenerationEffect: vi.fn(async (_ref, kind, delivery, effect) => {
      ledger.calls.push(`${delivery}:${kind}`)
      if (kind === 'notification' || kind === 'tts' || kind === 'completion_sound') {
        return { executed: false, status: 'already_receipted' }
      }
      if (ledger.receipts.has(kind)) return { executed: false, status: 'already_receipted' }
      const result = await effect({ idempotencyKey: `test:${kind}`, reclaimed: false })
      ledger.receipts.add(kind)
      return { executed: true, status: result.status, value: result.value }
    }),
  }
})

import {
  reconcileAcceptedSendGenerationEffects,
  reconcileRecoveredGenerationEffects,
} from './recoveredGenerationEffects'

const ref: ServerGenerationEffectLedgerRef = {
  version: 1,
  databaseLineage: 'lineage-a',
  keyType: 'operation',
  keyId: 'operation-a',
  generationId: 'generation-a',
  characterId: 'character-a',
  chatId: 'chat-a',
  messageId: 'message-a',
}

beforeEach(() => {
  state.order = []
  ledger.calls = []
  ledger.receipts.clear()
})

describe('late recovered generation effects', () => {
  it('replays durable automation in live order, skips ephemerals, and recomputes emotion state', async () => {
    await expect(reconcileRecoveredGenerationEffects(ref)).resolves.toEqual({ durableEffectsReconciled: true })

    expect(state.order).toEqual(['plugin_output', 'igp', 'emotion_image_state'])
    expect(ledger.calls).toEqual(
      expect.arrayContaining([
        'late_recovery:notification',
        'late_recovery:tts',
        'late_recovery:completion_sound',
        'late_recovery:plugin_output',
        'late_recovery:igp',
        'late_recovery:emotion_image_state',
      ]),
    )

    await expect(reconcileRecoveredGenerationEffects(ref)).resolves.toEqual({ durableEffectsReconciled: true })
    expect(state.order).toEqual(['plugin_output', 'igp', 'emotion_image_state'])
  })

  it('runs only missing durable effects when one already has a receipt', async () => {
    ledger.receipts.add('igp')

    await expect(reconcileRecoveredGenerationEffects(ref)).resolves.toEqual({ durableEffectsReconciled: true })

    expect(state.order).toEqual(['plugin_output', 'emotion_image_state'])
  })

  it('derives a generation-keyed ledger reference for pre-ref compatibility transcripts', async () => {
    await expect(
      reconcileAcceptedSendGenerationEffects(
        { selectedCharID: 0, chatPage: 0, characterId: 'character-a', chatId: 'chat-a' },
        'user-a',
      ),
    ).resolves.toEqual({ durableEffectsReconciled: true })

    expect(state.order).toEqual(['plugin_output', 'igp', 'emotion_image_state'])
  })
})
