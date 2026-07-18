import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reloadMocks = vi.hoisted(() => ({ pendingMutationRecovery: vi.fn() }))

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-durable-token',
}))

vi.mock('./server/activeWriterSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./server/activeWriterSession')>()),
  schedulePendingMutationRecoveryReload: reloadMocks.pendingMutationRecovery,
}))

import { clearCachedServerCommandRevision, setServerCommandSuccessReconciler } from './server/commands'
import { dispatchDurableMutationReplay } from './server/durableMutationDispatch'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from './server/pendingMutationOutbox'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from './server/resourceState.svelte'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import type { Database } from './storage/database.svelte'
import {
  acceptedPluginRuntimeProjection,
  currentPluginStorageSnapshot,
  dispatchPutPluginStorage,
  mergePendingPluginCollectionResource,
  mergePendingPluginStorageResource,
  togglePluginEnabled,
} from './pluginCommands'
import type { RisuPlugin } from './plugins/plugins.svelte'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function plugin(name: string, enabled: boolean): RisuPlugin {
  return {
    name,
    script: `Risuai.log(${JSON.stringify(name)})`,
    arguments: {},
    realArg: {},
    version: '3.0',
    customLink: [],
    argMeta: {},
    enabled,
  }
}

function seedPlugins(): void {
  setDatabaseLite({
    currentPluginProvider: '',
    pluginCustomStorage: {},
    plugins: [plugin('plugin-a', true), plugin('plugin-b', false)],
  } as unknown as Database)
}

function commandSuccess(revision: number, type: string, resource: string, id: string): Response {
  return jsonResponse({
    revision,
    event: { type, revision, resource, id },
  })
}

async function expectOnlyPendingMutation(mutationId: string) {
  let pending = await listPendingMutations()
  await vi.waitFor(async () => {
    pending = await listPendingMutations()
    expect(pending).toHaveLength(1)
  })
  expect(pending[0].handle.mutationId).toBe(mutationId)
  return pending[0]
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  await preparePendingMutationOutbox({
    writerSessionId: 'writer-plugin-durable',
    writerEpoch: 4,
    databaseLineage: 'lineage-plugin-durable',
    requestedWriterWasActive: true,
  })
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
  reloadMocks.pendingMutationRecovery.mockClear()
  seedPlugins()
})

afterEach(async () => {
  await clearPendingMutationOutbox()
  resetPendingMutationOutboxForTests()
  setServerCommandSuccessReconciler(null)
  vi.unstubAllGlobals()
})

describe('plugin durable replay settlement', () => {
  it('retires an accepted predecessor while leaving only its queued successor overlaid', async () => {
    const callsByUrl = new Map<string, number>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const count = (callsByUrl.get(url) ?? 0) + 1
        callsByUrl.set(url, count)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/plugins/plugin-a/enable') {
          return count === 1
            ? jsonResponse({ error: 'retry plugin A' }, 500)
            : commandSuccess(11, 'plugin.enabled', 'plugin', 'plugin-a')
        }
        if (url === '/api/v1/commands/plugins/plugin-b/enable') {
          return count === 1
            ? jsonResponse({ error: 'retry plugin B' }, 500)
            : commandSuccess(12, 'plugin.enabled', 'plugin', 'plugin-b')
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const first = await togglePluginEnabled('plugin-a')!
    expect(first).toMatchObject({ status: 'queued', mutationId: expect.any(String) })
    if (first.status !== 'queued') throw new Error('Expected plugin A to remain queued')

    const second = await togglePluginEnabled('plugin-b')!
    expect(second).toMatchObject({ status: 'queued', mutationId: expect.any(String) })
    if (second.status !== 'queued') throw new Error('Expected plugin B to remain queued')
    await expect(first.settlement).resolves.toEqual({ status: 'accepted' })

    expect(
      mergePendingPluginCollectionResource([plugin('plugin-a', false), plugin('plugin-b', false)]).map(
        ({ name, enabled }) => ({ name, enabled }),
      ),
    ).toEqual([
      { name: 'plugin-a', enabled: false },
      { name: 'plugin-b', enabled: true },
    ])
    expect(
      acceptedPluginRuntimeProjection(getDatabase().plugins).map(({ name, enabled }) => ({ name, enabled })),
    ).toEqual([
      { name: 'plugin-a', enabled: false },
      { name: 'plugin-b', enabled: false },
    ])

    const pendingSecond = await expectOnlyPendingMutation(second.mutationId)
    await expect(dispatchDurableMutationReplay(pendingSecond.handle, pendingSecond.intent)).resolves.toMatchObject({
      disposition: 'succeeded',
    })
    await expect(second.settlement).resolves.toEqual({ status: 'accepted' })
    expect(await listPendingMutations()).toEqual([])
  })

  it('guardedly rolls back a discarded predecessor without removing the newer queued edit', async () => {
    const callsByUrl = new Map<string, number>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const count = (callsByUrl.get(url) ?? 0) + 1
        callsByUrl.set(url, count)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/plugins/plugin-a/enable') {
          return count === 1
            ? jsonResponse({ error: 'retry plugin A' }, 500)
            : jsonResponse({ error: 'plugin A no longer exists' }, 400)
        }
        if (url === '/api/v1/commands/plugins/plugin-b/enable') {
          return commandSuccess(11, 'plugin.enabled', 'plugin', 'plugin-b')
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const first = await togglePluginEnabled('plugin-a')!
    if (first.status !== 'queued') throw new Error('Expected plugin A to remain queued')
    const second = await togglePluginEnabled('plugin-b')!
    if (second.status !== 'queued') throw new Error('Expected plugin B to remain queued')

    await expect(first.settlement).resolves.toEqual({ status: 'failed' })
    expect(reloadMocks.pendingMutationRecovery).toHaveBeenCalledTimes(1)
    expect(getDatabase().plugins.map(({ name, enabled }) => ({ name, enabled }))).toEqual([
      { name: 'plugin-a', enabled: true },
      { name: 'plugin-b', enabled: true },
    ])
    expect(
      mergePendingPluginCollectionResource([plugin('plugin-a', true), plugin('plugin-b', false)]).map(
        ({ name, enabled }) => ({ name, enabled }),
      ),
    ).toEqual([
      { name: 'plugin-a', enabled: true },
      { name: 'plugin-b', enabled: true },
    ])

    const pendingSecond = await expectOnlyPendingMutation(second.mutationId)
    await expect(dispatchDurableMutationReplay(pendingSecond.handle, pendingSecond.intent)).resolves.toMatchObject({
      disposition: 'succeeded',
    })
    await expect(second.settlement).resolves.toEqual({ status: 'accepted' })
  })

  it('settles replayed plugin storage per exact queued mutation', async () => {
    const callsByUrl = new Map<string, number>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const count = (callsByUrl.get(url) ?? 0) + 1
        callsByUrl.set(url, count)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 20 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/plugin-storage/key-a') {
          return count === 1
            ? jsonResponse({ error: 'retry storage A' }, 500)
            : commandSuccess(21, 'pluginStorage.updated', 'pluginStorage', 'key-a')
        }
        if (url === '/api/v1/commands/plugin-storage/key-b') {
          return count === 1
            ? jsonResponse({ error: 'retry storage B' }, 500)
            : commandSuccess(22, 'pluginStorage.updated', 'pluginStorage', 'key-b')
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage = { 'key-a': 'old-a', 'key-b': 'old-b' }
    })

    const previousA = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage['key-a'] = 'accepted-a'
    })
    const first = await dispatchPutPluginStorage('key-a', 'accepted-a', previousA)!
    if (first.status !== 'queued') throw new Error('Expected storage A to remain queued')

    const previousB = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage['key-b'] = 'queued-b'
    })
    const second = await dispatchPutPluginStorage('key-b', 'queued-b', previousB)!
    if (second.status !== 'queued') throw new Error('Expected storage B to remain queued')
    await expect(first.settlement).resolves.toEqual({ status: 'accepted' })
    expect(mergePendingPluginStorageResource({ 'key-a': 'accepted-a', 'key-b': 'old-b' })).toEqual({
      'key-a': 'accepted-a',
      'key-b': 'queued-b',
    })

    const pendingSecond = await expectOnlyPendingMutation(second.mutationId)
    await expect(dispatchDurableMutationReplay(pendingSecond.handle, pendingSecond.intent)).resolves.toMatchObject({
      disposition: 'succeeded',
    })
    await expect(second.settlement).resolves.toEqual({ status: 'accepted' })
  })
})
