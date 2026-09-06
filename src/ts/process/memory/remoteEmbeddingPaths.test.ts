import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  masked: '__RISU_SECRET_MASKED__',
  db: {
    hypaModel: 'openai3small',
    hypaV3Key: '__RISU_SECRET_MASKED__',
    hypaCustomSettings: {
      url: 'https://stored.example.test/v1',
      key: '__RISU_SECRET_MASKED__',
      model: 'stored-model',
    },
  } as Record<string, any>,
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  requestTexts: vi.fn(),
  settingsResourceState: {
    value: {} as Record<string, any>,
    status: 'ready',
    groupStatuses: { memory: 'ready' } as Record<string, string>,
  },
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: state.getItem,
      setItem: state.setItem,
    }),
  },
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: state.settingsResourceState,
}))

vi.mock('src/ts/server/embeddingOperations', () => ({
  embeddingOperationCredential: (value: unknown) => {
    if (value === state.masked) return { source: 'stored' }
    if (typeof value === 'string' && value.trim()) return { source: 'provided', apiKey: value }
    return { source: 'none' }
  },
  requestRemoteEmbeddingTexts: state.requestTexts,
}))

vi.mock('./contextualEmbedding', () => ({
  isContextModel: () => false,
  getContextProvider: () => null,
}))

vi.mock('../transformers', () => ({
  runEmbedding: vi.fn(),
}))

import { HypaProcesser } from './hypamemory'
import { HypaProcessorV2 } from './hypamemoryv2'

beforeEach(() => {
  state.getItem.mockClear()
  state.setItem.mockClear()
  state.requestTexts.mockReset()
  state.requestTexts.mockResolvedValue([[1, 0]])
  state.db.hypaModel = 'openai3small'
  state.db.hypaV3Key = state.masked
  state.db.hypaCustomSettings = {
    url: 'https://stored.example.test/v1',
    key: state.masked,
    model: 'stored-model',
  }
  state.settingsResourceState.value = state.db
  state.settingsResourceState.status = 'ready'
  state.settingsResourceState.groupStatuses.memory = 'ready'
})

describe('remote Hypa embedding paths', () => {
  it('routes persisted OpenAI masks through the authenticated server operation', async () => {
    const processor = new HypaProcesser('openai3small')

    await expect(processor.getEmbeds(['hello'], 'query')).resolves.toEqual([[1, 0]])
    expect(state.requestTexts).toHaveBeenCalledWith({
      model: 'openai3small',
      inputType: 'query',
      input: ['hello'],
      credential: { source: 'stored' },
      signal: expect.any(AbortSignal),
    })
  })

  it('keeps Playground custom drafts one-shot and abortable', async () => {
    let capturedSignal: AbortSignal | undefined
    state.requestTexts.mockImplementation(async (options: { signal: AbortSignal }) => {
      capturedSignal = options.signal
      return [[1, 0]]
    })
    const processor = new HypaProcesser('custom', 'https://draft.example.test/v1', {
      customKey: 'draft-key',
      customModel: 'draft-model',
    })

    await processor.getEmbeds('hello', 'document')
    expect(state.requestTexts).toHaveBeenCalledWith({
      model: 'custom',
      inputType: 'document',
      input: ['hello'],
      credential: { source: 'provided', apiKey: 'draft-key' },
      custom: {
        source: 'provided',
        url: 'https://draft.example.test/v1',
        model: 'draft-model',
      },
      signal: expect.any(AbortSignal),
    })
    processor.abort()
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('preserves document/query semantics through HypaProcessorV2', async () => {
    const processor = new HypaProcessorV2({ model: 'openai3small' })

    await processor.addTexts([{ id: 'document', content: 'stored text' }])
    await processor.similaritySearchScored('search text')

    expect(state.requestTexts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'openai3small',
        inputType: 'document',
        input: ['stored text'],
        credential: { source: 'stored' },
      }),
    )
    expect(state.requestTexts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: 'openai3small',
        inputType: 'query',
        input: ['search text'],
        credential: { source: 'stored' },
      }),
    )
  })

  it('fails closed instead of reading aggregate credentials before the memory owner is ready', async () => {
    state.settingsResourceState.groupStatuses.memory = 'loading'

    const legacyProcessor = new HypaProcesser('openai3small')
    const currentProcessor = new HypaProcessorV2({ model: 'openai3small' })

    await legacyProcessor.getEmbeds(['legacy'], 'query')
    await currentProcessor.similaritySearchScored('current')

    expect(state.requestTexts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ credential: { source: 'none' }, input: ['legacy'] }),
    )
    expect(state.requestTexts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ credential: { source: 'none' }, input: ['current'] }),
    )
  })
})
