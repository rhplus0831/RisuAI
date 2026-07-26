import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: { voyageApiKey: '__RISU_SECRET_MASKED__' },
  requestGroups: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => state.db,
}))

vi.mock('src/ts/server/embeddingOperations', () => ({
  embeddingOperationCredential: (value: unknown) =>
    value === '__RISU_SECRET_MASKED__' ? { source: 'stored' } : { source: 'provided', apiKey: value },
  requestRemoteEmbeddingGroups: state.requestGroups,
}))

vi.mock('./hypamemory', () => ({
  contextHash: (texts: string[]) => texts.join('-'),
}))

import { getContextProvider } from './contextualEmbedding'

beforeEach(() => {
  state.requestGroups.mockReset()
  state.requestGroups.mockImplementation(async ({ groups }: { groups: string[][] }) =>
    groups.map((group) => group.map((_text, index) => [index + 1])),
  )
})

describe('Voyage contextual embedding bridge', () => {
  it('routes document groups through stored server credentials', async () => {
    const provider = getContextProvider('voyageContext4')!
    const controller = new AbortController()

    await expect(provider.embedDocumentGroups([['first', 'second']], controller.signal)).resolves.toEqual([[[1], [2]]])
    expect(provider.modelId).toBe('voyage-context-4')
    expect(provider.getCacheKeySuffix(['first', 'second'])).toBe('|voyageContext4|ctx:first-second')
    expect(state.requestGroups).toHaveBeenCalledWith({
      model: 'voyageContext4',
      inputType: 'document',
      groups: [['first', 'second']],
      credential: { source: 'stored' },
      signal: controller.signal,
    })
  })

  it('batches query groups within the browser/server response bounds', async () => {
    const provider = getContextProvider('voyageContext3')!
    const queries = Array.from({ length: 257 }, (_, index) => `query-${index}`)

    const result = await provider.embedQueries(queries)

    expect(result).toHaveLength(257)
    expect(state.requestGroups).toHaveBeenCalledTimes(2)
    expect(state.requestGroups.mock.calls[0][0].groups).toHaveLength(256)
    expect(state.requestGroups.mock.calls[1][0].groups).toHaveLength(1)
    expect(state.requestGroups.mock.calls[0][0]).toMatchObject({
      model: 'voyageContext3',
      inputType: 'query',
      credential: { source: 'stored' },
    })
  })
})
