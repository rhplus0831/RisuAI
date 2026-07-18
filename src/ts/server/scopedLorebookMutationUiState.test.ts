import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScopedLorebookMutationOperation, ScopedLorebookMutationSettlement } from './lorebookBridge.svelte'
import {
  findScopedLorebookCollectionMutationUiState,
  findScopedLorebookLocalActivationMutationUiState,
  resetScopedLorebookMutationUiStateForTests,
  scopedLorebookMutationUiStates,
  trackScopedLorebookMutationUiOperation,
} from './scopedLorebookMutationUiState'

function deferredOperation(scopeKey: string): {
  operation: ScopedLorebookMutationOperation
  resolve: (settlement: ScopedLorebookMutationSettlement) => void
} {
  let resolve!: (settlement: ScopedLorebookMutationSettlement) => void
  const settlement = new Promise<ScopedLorebookMutationSettlement>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { operation: { scopeKey, settlement }, resolve }
}

async function flushSettlements(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  resetScopedLorebookMutationUiStateForTests()
})

describe('scoped lorebook mutation UI state', () => {
  it('ignores a stale failed completion after a coalesced successor owns the scope', async () => {
    const first = deferredOperation('character:character-a')
    const second = deferredOperation('character:character-a')
    const firstFailed = vi.fn()
    const secondQueued = vi.fn()

    const firstToken = trackScopedLorebookMutationUiOperation({
      operation: first.operation,
      kind: 'collection',
      onFailed: firstFailed,
    })
    const secondToken = trackScopedLorebookMutationUiOperation({
      operation: second.operation,
      kind: 'collection',
      onQueued: secondQueued,
    })

    expect(secondToken).toBeGreaterThan(firstToken ?? 0)

    first.resolve({ status: 'failed', error: 'stale failed generation' })
    await flushSettlements()
    expect(firstFailed).not.toHaveBeenCalled()
    expect(
      findScopedLorebookCollectionMutationUiState(get(scopedLorebookMutationUiStates), 'character:character-a'),
    ).toMatchObject({ status: 'pending', operationToken: secondToken })

    second.resolve({ status: 'queued' })
    await flushSettlements()
    expect(secondQueued).toHaveBeenCalledTimes(1)
    expect(
      findScopedLorebookCollectionMutationUiState(get(scopedLorebookMutationUiStates), 'character:character-a'),
    ).toMatchObject({ status: 'queued', operationToken: secondToken })
  })

  it('keeps local activation outcomes precise by chat and stable entry id', async () => {
    const first = deferredOperation('chat:chat-a')
    const second = deferredOperation('chat:chat-a')
    trackScopedLorebookMutationUiOperation({
      operation: first.operation,
      kind: 'local-activation',
      entryId: 'entry-a',
      displayScopeKey: 'character:character-a',
    })
    trackScopedLorebookMutationUiOperation({
      operation: second.operation,
      kind: 'local-activation',
      entryId: 'entry-b',
      displayScopeKey: 'character:character-a',
    })

    first.resolve({ status: 'queued' })
    second.resolve({ status: 'failed', error: 'entry-b rejected' })
    await flushSettlements()

    expect(
      findScopedLorebookLocalActivationMutationUiState(get(scopedLorebookMutationUiStates), 'chat:chat-a', 'entry-a'),
    ).toMatchObject({ status: 'queued', entryId: 'entry-a' })
    expect(
      findScopedLorebookLocalActivationMutationUiState(get(scopedLorebookMutationUiStates), 'chat:chat-a', 'entry-b'),
    ).toMatchObject({ status: 'failed', entryId: 'entry-b', error: 'entry-b rejected' })
  })
})
