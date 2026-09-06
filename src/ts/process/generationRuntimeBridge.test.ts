import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getChatHydrationRuntime,
  getGenerationOperationsRuntime,
  getGenerationProcessRuntime,
  getRecoveredEffectsRuntime,
  getServerChatRuntime,
  registerChatHydrationRuntime,
  registerGenerationOperationsRuntime,
  registerGenerationProcessRuntime,
  registerRecoveredEffectsRuntime,
  registerServerChatRuntime,
  resetGenerationRuntimeBridgeForTests,
} from './generationRuntimeBridge'

beforeEach(() => {
  resetGenerationRuntimeBridgeForTests()
})

describe('generation runtime bridge', () => {
  it('fails loudly before a runtime owner registers its capabilities', () => {
    expect(() => getGenerationOperationsRuntime()).toThrow('Generation operations runtime is not registered')
    expect(() => getChatHydrationRuntime()).toThrow('Chat hydration runtime is not registered')
    expect(() => getServerChatRuntime()).toThrow('Server chat runtime is not registered')
    expect(() => getGenerationProcessRuntime()).toThrow('Generation process runtime is not registered')
    expect(() => getRecoveredEffectsRuntime()).toThrow('Recovered effects runtime is not registered')
  })

  it('returns the capabilities registered by each statically owned runtime', () => {
    const generationOperations = { stopGenerationOperation: vi.fn() }
    const chatHydration = { stopChatMessageHydration: vi.fn() }
    const serverChat = { cancelServerChatGeneration: vi.fn() }
    const generationProcess = { sendChat: vi.fn() }
    const recoveredEffects = { reconcilePendingRecoveredGenerationEffects: vi.fn() }

    registerGenerationOperationsRuntime(generationOperations as never)
    registerChatHydrationRuntime(chatHydration as never)
    registerServerChatRuntime(serverChat as never)
    registerGenerationProcessRuntime(generationProcess as never)
    registerRecoveredEffectsRuntime(recoveredEffects as never)

    expect(getGenerationOperationsRuntime()).toBe(generationOperations)
    expect(getChatHydrationRuntime()).toBe(chatHydration)
    expect(getServerChatRuntime()).toBe(serverChat)
    expect(getGenerationProcessRuntime()).toBe(generationProcess)
    expect(getRecoveredEffectsRuntime()).toBe(recoveredEffects)
  })
})
