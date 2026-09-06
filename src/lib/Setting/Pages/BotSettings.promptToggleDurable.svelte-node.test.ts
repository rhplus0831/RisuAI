import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandApi = vi.hoisted(() => ({
  acknowledge: vi.fn(async () => true),
  inlineReplay: vi.fn(),
  replay: vi.fn(),
  withoutReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
  withReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
}))

vi.mock('src/ts/server/commands', () => ({
  acknowledgeServerMutationReceipts: commandApi.acknowledge,
  canUseServerCommands: () => true,
  patchPromptSettingsCommand: vi.fn(),
  peekCachedServerCommandRevision: () => 0,
  replayDurableMutationRequests: commandApi.replay,
  replayDurableMutationRequestsInline: commandApi.inlineReplay,
  runServerCommand: vi.fn(),
  runServerCommandWithoutMutationReceipt: commandApi.withoutReceipt,
  runServerCommandWithMutationReceipt: commandApi.withReceipt,
  updatePromptItemCommand: vi.fn(),
}))

import { dispatchDurableMutation } from 'src/ts/server/durableMutationDispatch'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
  type DurableMutationIntent,
} from 'src/ts/server/pendingMutationOutbox'
import type { ServerCommandResult, ServerCommandTransportOptions } from 'src/ts/server/commands'

const ownerId = 'prompt-toggle-owner'
const ownerKey = `prompt-template-owner:${ownerId}`
const rowIntent: DurableMutationIntent = {
  version: 1,
  requests: [
    {
      method: 'PATCH',
      path: '/prompt-items/row-a',
      body: { promptPresetId: ownerId, patch: { text: 'retained row edit' } },
    },
  ],
}
const toggleIntent: DurableMutationIntent = {
  version: 1,
  requests: [
    {
      method: 'POST',
      path: '/prompt-items/enable',
      body: { promptPresetId: ownerId, enabled: false },
    },
  ],
}

function wrappedDispatch(
  request: () => Promise<{ status: 'ok'; revision: number } | { status: 'error'; error: string }>,
): (options: ServerCommandTransportOptions) => Promise<ServerCommandResult> {
  return (options: ServerCommandTransportOptions) =>
    (options.executionWrapper
      ? options.executionWrapper(request as () => Promise<ServerCommandResult>)
      : request()) as Promise<ServerCommandResult>
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  commandApi.acknowledge.mockClear()
  commandApi.inlineReplay.mockReset()
  commandApi.replay.mockReset()
  commandApi.withoutReceipt.mockClear()
  commandApi.withReceipt.mockClear()
  await preparePendingMutationOutbox({
    writerSessionId: 'writer-prompt-toggle',
    writerEpoch: 3,
    databaseLineage: 'lineage-prompt-toggle',
    requestedWriterWasActive: true,
  })
})

afterEach(async () => {
  await clearPendingMutationOutbox()
  resetPendingMutationOutboxForTests()
  vi.unstubAllGlobals()
})

describe('BotSettings prompt-template toggle durability', () => {
  it('uses one durable owner sequence for legacy row and toggle requests', async () => {
    const legacyKey = 'prompt-template-owner:__legacy__'
    const legacyRow = stagePendingMutation(legacyKey, {
      version: 1,
      requests: [{ method: 'PATCH', path: '/prompt-items/legacy-row', body: { patch: { text: 'legacy edit' } } }],
    })
    const legacyToggle = stagePendingMutation(legacyKey, {
      version: 1,
      requests: [{ method: 'POST', path: '/prompt-items/enable', body: { enabled: false } }],
    })

    let entries: Awaited<ReturnType<typeof listPendingMutations>> = []
    await vi.waitFor(async () => {
      entries = await listPendingMutations()
      expect(entries).toHaveLength(2)
    })
    expect(entries.map((entry) => entry.handle.key)).toEqual([legacyKey, legacyKey])
    expect(entries.map((entry) => entry.handle.mutationId)).toEqual([legacyRow.mutationId, legacyToggle.mutationId])
    expect(entries.map((entry) => entry.intent.requests[0]?.path)).toEqual([
      '/prompt-items/legacy-row',
      '/prompt-items/enable',
    ])
  })

  it('blocks disable behind a failed row predecessor, then recovers without sending a late row', async () => {
    const order: string[] = []
    const row = stagePendingMutation(ownerKey, rowIntent)
    await expect(
      dispatchDurableMutation(
        row,
        rowIntent,
        wrappedDispatch(async () => {
          order.push('row-live-failed')
          return { status: 'error', error: 'offline' }
        }),
      ),
    ).resolves.toEqual({ status: 'error', error: 'offline' })

    const toggle = stagePendingMutation(ownerKey, toggleIntent)
    const toggleRequest = vi.fn(async () => {
      order.push('toggle')
      return { status: 'ok' as const, revision: 2 }
    })
    commandApi.inlineReplay.mockImplementationOnce(async () => {
      order.push('row-replay-blocked')
      return { status: 'error', error: 'still offline' }
    })

    await expect(dispatchDurableMutation(toggle, toggleIntent, wrappedDispatch(toggleRequest))).resolves.toEqual({
      status: 'unavailable',
    })
    expect(order).toEqual(['row-live-failed', 'row-replay-blocked'])
    expect(toggleRequest).not.toHaveBeenCalled()
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).toEqual([
      row.mutationId,
      toggle.mutationId,
    ])

    commandApi.inlineReplay.mockImplementationOnce(async () => {
      order.push('row-replay-recovered')
      return { status: 'ok' }
    })
    await expect(dispatchDurableMutation(toggle, toggleIntent, wrappedDispatch(toggleRequest))).resolves.toMatchObject({
      status: 'ok',
    })

    expect(order).toEqual(['row-live-failed', 'row-replay-blocked', 'row-replay-recovered', 'toggle'])
    expect(commandApi.inlineReplay).toHaveBeenCalledTimes(2)
    expect(commandApi.inlineReplay).toHaveBeenNthCalledWith(
      2,
      rowIntent.requests,
      row.mutationId,
      'lineage-prompt-toggle',
    )
    expect(await listPendingMutations()).toEqual([])
  })
})
