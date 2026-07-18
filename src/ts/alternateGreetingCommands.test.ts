import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutationMocks = vi.hoisted(() => ({
  order: [] as string[],
  stagedKey: '',
  stagedIntent: undefined as unknown,
  commandInput: undefined as unknown,
  result: { status: 'ok', revision: 2, event: { revision: 2 } } as Record<string, unknown>,
  retainFailure: false,
  rejectCommand: false,
  rejectStaging: false,
  settlementListener: undefined as ((settlement: 'accepted' | 'discarded') => void) | undefined,
  settlementCleanup: vi.fn(),
}))

vi.mock('./server/pendingMutationOutbox', () => ({
  stagePendingMutation: (key: string, intent: unknown) => {
    mutationMocks.order.push('stage')
    if (mutationMocks.rejectStaging) throw new Error('outbox unavailable')
    mutationMocks.stagedKey = key
    mutationMocks.stagedIntent = intent
    return {
      key,
      mutationId: 'mutation-a',
      sequence: 1,
      ownerWriterSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'lineage-a',
      ready: Promise.resolve('persisted'),
      phase: 'staged',
    }
  },
}))

vi.mock('./server/resourceOwnerMutationKeys', () => ({
  characterOwnerMutationKey: (characterId: string) => `character-owner:${characterId}`,
}))

vi.mock('./server/durableMutationDispatch', () => ({
  registerDurableMutationSettlementListener: (
    _mutationId: string,
    listener: (settlement: 'accepted' | 'discarded') => void,
  ) => {
    mutationMocks.settlementListener = listener
    return mutationMocks.settlementCleanup
  },
  dispatchDurableMutation: async (
    _handle: unknown,
    _intent: unknown,
    dispatch: (transport: {
      failureRollbackDisposition: () => 'retain' | 'rollback'
    }) => Promise<Record<string, unknown>>,
  ) => {
    mutationMocks.order.push('dispatch')
    return dispatch({
      failureRollbackDisposition: () => (mutationMocks.retainFailure ? 'retain' : 'rollback'),
    })
  },
}))

vi.mock('./server/commands', () => ({
  mutateAlternateGreetingsCommand: async (input: unknown) => {
    mutationMocks.commandInput = input
    if (mutationMocks.rejectCommand) throw new Error('network disconnected')
    return mutationMocks.result
  },
  runServerCommand: async (input: {
    command: (baseRevision: number) => Promise<Record<string, unknown>>
    rollback?: () => void
    failureRollbackDisposition?: (result: Record<string, unknown>) => 'retain' | 'rollback'
  }) => {
    const result = await input.command(1)
    if (result.status !== 'ok' && input.failureRollbackDisposition?.(result) !== 'retain') input.rollback?.()
    return result
  },
}))

import { dispatchDurableAlternateGreetingMutation } from './alternateGreetingCommands'

function dispatchMutation(
  callbacks: {
    applyOptimistic?: () => void
    rollback?: () => void
    onFinalSettlement?: (settlement: 'accepted' | 'discarded') => void
  } = {},
) {
  return dispatchDurableAlternateGreetingMutation({
    characterId: 'character a',
    alternateGreetings: ['Second', 'First'],
    operation: { type: 'swap', firstIndex: 0, secondIndex: 1 },
    chatGreetingIndices: [{ chatId: 'chat-a', fmIndex: 1 }],
    applyOptimistic: callbacks.applyOptimistic ?? vi.fn(),
    rollback: callbacks.rollback ?? vi.fn(),
    onFinalSettlement: callbacks.onFinalSettlement,
  })
}

describe('durable alternate greeting mutations', () => {
  beforeEach(() => {
    mutationMocks.order.length = 0
    mutationMocks.stagedKey = ''
    mutationMocks.stagedIntent = undefined
    mutationMocks.commandInput = undefined
    mutationMocks.result = { status: 'ok', revision: 2, event: { revision: 2 } }
    mutationMocks.retainFailure = false
    mutationMocks.rejectCommand = false
    mutationMocks.rejectStaging = false
    mutationMocks.settlementListener = undefined
    mutationMocks.settlementCleanup.mockReset()
  })

  it('stages the frozen atomic route before painting and dispatches the certificate expectation', async () => {
    const applyOptimistic = vi.fn(() => mutationMocks.order.push('paint'))

    await expect(dispatchMutation({ applyOptimistic })).resolves.toBe('accepted')

    expect(mutationMocks.order).toEqual(['stage', 'paint', 'dispatch'])
    expect(mutationMocks.stagedKey).toBe('character-owner:character a')
    expect(mutationMocks.stagedIntent).toEqual({
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: '/characters/character%20a/alternate-greetings',
          body: {
            alternateGreetings: ['Second', 'First'],
            operation: { type: 'swap', firstIndex: 0, secondIndex: 1 },
          },
        },
      ],
    })
    const body = (mutationMocks.stagedIntent as { requests: Array<{ body: Record<string, unknown> }> }).requests[0]
      ?.body
    expect(Object.isFrozen(body)).toBe(true)
    expect(Object.isFrozen(body?.alternateGreetings)).toBe(true)
    expect(Object.isFrozen(body?.operation)).toBe(true)
    expect(mutationMocks.commandInput).toMatchObject({
      baseRevision: 1,
      characterId: 'character a',
      chatGreetingIndices: [{ chatId: 'chat-a', fmIndex: 1 }],
    })
  })

  it('retains retryable failures without rolling back the optimistic cascade', async () => {
    mutationMocks.result = { status: 'conflict', currentRevision: 3 }
    mutationMocks.retainFailure = true
    const rollback = vi.fn()

    await expect(dispatchMutation({ rollback })).resolves.toBe('queued')

    expect(rollback).not.toHaveBeenCalled()
    expect(mutationMocks.settlementCleanup).not.toHaveBeenCalled()
  })

  it('rolls back terminal failures and reports a failed outcome', async () => {
    mutationMocks.result = { status: 'error', error: 'invalid', reason: 'invalid-request' }
    const rollback = vi.fn()

    await expect(dispatchMutation({ rollback })).resolves.toBe('failed')

    expect(rollback).toHaveBeenCalledOnce()
    expect(mutationMocks.settlementCleanup).toHaveBeenCalledOnce()
  })

  it('rolls a retained projection back if replay later discards it', async () => {
    mutationMocks.result = { status: 'unavailable' }
    mutationMocks.retainFailure = true
    const rollback = vi.fn()
    const onFinalSettlement = vi.fn()
    await expect(dispatchMutation({ rollback, onFinalSettlement })).resolves.toBe('queued')

    mutationMocks.settlementListener?.('discarded')

    expect(rollback).toHaveBeenCalledOnce()
    expect(onFinalSettlement).toHaveBeenCalledWith('discarded')
    expect(mutationMocks.settlementCleanup).toHaveBeenCalledOnce()
  })

  it('does not paint when durable staging rejects the request', async () => {
    mutationMocks.rejectStaging = true
    const applyOptimistic = vi.fn()

    await expect(dispatchMutation({ applyOptimistic })).resolves.toBe('failed')

    expect(applyOptimistic).not.toHaveBeenCalled()
  })
})
