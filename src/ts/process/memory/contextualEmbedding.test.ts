import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: { voyageApiKey: '__RISU_SECRET_MASKED__' },
  settingsResourceState: {
    value: { voyageApiKey: '__RISU_SECRET_MASKED__' } as Record<string, unknown>,
    groupStatuses: { memory: 'ready' } as Record<string, string>,
    status: 'ready',
  },
  requestGroups: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => state.db,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: state.settingsResourceState,
}))

vi.mock('src/ts/server/embeddingOperations', () => ({
  embeddingOperationCredential: (value: unknown) => {
    if (value === '__RISU_SECRET_MASKED__') return { source: 'stored' }
    return typeof value === 'string' && value.trim() ? { source: 'provided', apiKey: value } : { source: 'none' }
  },
  requestRemoteEmbeddingGroups: state.requestGroups,
}))

vi.mock('./hypamemory', () => ({
  contextHash: (texts: string[]) => texts.join('-'),
}))

import { getContextProvider } from './contextualEmbedding'

beforeEach(() => {
  state.db.voyageApiKey = '__RISU_SECRET_MASKED__'
  state.settingsResourceState.value = { voyageApiKey: '__RISU_SECRET_MASKED__' }
  state.settingsResourceState.groupStatuses.memory = 'ready'
  state.settingsResourceState.status = 'ready'
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

  it('does not use credentials while the memory owner is loading', async () => {
    state.settingsResourceState.value = { voyageApiKey: 'stale-owner-key' }
    state.settingsResourceState.groupStatuses.memory = 'loading'

    await getContextProvider('voyageContext3')!.embedQueries(['query'])

    expect(state.requestGroups).toHaveBeenCalledWith(expect.objectContaining({ credential: { source: 'none' } }))
  })

  it('fails closed without reusing aggregate credentials after an owner error', async () => {
    state.settingsResourceState.groupStatuses.memory = 'error'

    await getContextProvider('voyageContext3')!.embedQueries(['query'])

    expect(state.requestGroups).toHaveBeenCalledWith(expect.objectContaining({ credential: { source: 'none' } }))
  })
})
