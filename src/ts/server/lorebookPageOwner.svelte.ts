import { fetchServerStandaloneSetting } from './resourceReads'
import {
  persistLorebookPageSelection,
  type LorebookPageSelectionFinalSettlement,
  type LorebookPageSelectionPersistenceReceipt,
} from './lorebookPageSelectionPersistence'

const RESOURCE = 'loreBookPage' as const

export type LorebookPageOwnerStatus = 'unloaded' | 'loading' | 'ready' | 'stale' | 'error'

export interface LorebookPageOwnerSnapshot {
  resource: typeof RESOURCE
  status: LorebookPageOwnerStatus
  revision: number | null
  state: { present: false } | { present: true; value: unknown }
  error: string | null
  mutation:
    | { status: 'idle' }
    | { status: 'pending'; attempt: number; index: number; lorebookId: string }
    | { status: 'queued'; attempt: number; index: number; lorebookId: string; mutationId: string }
    | { status: 'failed'; attempt: number; index: number; lorebookId: string; error: string }
}

export type LorebookPageOwnerRefreshResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }
  | { status: 'superseded' }

export type LorebookPageOwnerSelectionResult =
  | { status: 'accepted'; revision: number }
  | { status: 'failed'; error: string }
  | {
      status: 'queued'
      mutationId: string
      settlement: Promise<LorebookPageSelectionFinalSettlement>
    }

type StandaloneReadResult = Awaited<ReturnType<typeof fetchServerStandaloneSetting>>

export interface LorebookPageOwnerDependencies {
  read: (signal?: AbortSignal | null) => Promise<StandaloneReadResult>
  select: (lorebookId: string, signal?: AbortSignal | null) => Promise<LorebookPageSelectionPersistenceReceipt>
}

export interface LorebookPageOwner {
  readonly resource: typeof RESOURCE
  readonly drafts: 'not-applicable'
  snapshot(): LorebookPageOwnerSnapshot
  invalidate(minimumRevision?: number): void
  refresh(options?: { minimumRevision?: number; signal?: AbortSignal | null }): Promise<LorebookPageOwnerRefreshResult>
  retry(signal?: AbortSignal | null): Promise<LorebookPageOwnerRefreshResult>
  select(input: {
    lorebookId: string
    index: number
    signal?: AbortSignal | null
  }): Promise<LorebookPageOwnerSelectionResult>
  subscribe(listener: (snapshot: LorebookPageOwnerSnapshot) => void): () => void
}

export function createLorebookPageOwner(dependencies: Partial<LorebookPageOwnerDependencies> = {}): LorebookPageOwner {
  const read = dependencies.read ?? ((signal) => fetchServerStandaloneSetting(RESOURCE, signal))
  const persistSelection = dependencies.select ?? persistLorebookPageSelection
  let requestAttempt = 0
  let mutationAttempt = 0
  let projectionEpoch = 0
  let status: LorebookPageOwnerStatus = 'unloaded'
  let revision: number | null = null
  let state: LorebookPageOwnerSnapshot['state'] = { present: false }
  let error: string | null = null
  let stale = false
  let staleMinimumRevision: number | undefined
  let mutation: LorebookPageOwnerSnapshot['mutation'] = { status: 'idle' }
  const listeners = new Set<(snapshot: LorebookPageOwnerSnapshot) => void>()

  const snapshot = (): LorebookPageOwnerSnapshot => {
    return {
      resource: RESOURCE,
      status: stale && status === 'ready' ? 'stale' : status,
      revision,
      state: state.present ? { present: true, value: structuredClone(state.value) } : { present: false },
      error,
      mutation: structuredClone(mutation),
    }
  }

  const publish = (): void => {
    const current = snapshot()
    for (const listener of [...listeners]) listener(current)
  }

  const fail = (errorMessage: string): LorebookPageOwnerRefreshResult => {
    status = 'error'
    stale = false
    error = errorMessage
    publish()
    return { status: 'error', error: errorMessage }
  }

  const refresh: LorebookPageOwner['refresh'] = async (options = {}) => {
    const attempt = ++requestAttempt
    const minimumRevision = Math.max(options.minimumRevision ?? -1, staleMinimumRevision ?? -1)
    status = 'loading'
    error = null
    publish()

    let result: StandaloneReadResult
    try {
      result = await read(options.signal)
    } catch (readError) {
      if (attempt !== requestAttempt) return { status: 'superseded' }
      return fail(readError instanceof Error ? readError.message : String(readError))
    }
    if (attempt !== requestAttempt) return { status: 'superseded' }
    if (options.signal?.aborted) return fail('Lorebook page refresh was cancelled')
    if (result.status === 'unavailable') {
      status = 'error'
      stale = false
      error = 'Server resource APIs are unavailable'
      publish()
      return { status: 'unavailable' }
    }
    if (result.status === 'error') return fail(result.error)
    if (result.revision < minimumRevision) {
      return fail(`Lorebook page response revision ${result.revision} is older than ${minimumRevision}`)
    }

    if (revision !== null && revision > result.revision) {
      status = 'ready'
      stale = false
      staleMinimumRevision = undefined
      publish()
      return { status: 'ok', revision }
    }

    status = 'ready'
    revision = result.revision
    state = result.state.present ? { present: true, value: structuredClone(result.state.value) } : { present: false }
    error = null
    projectionEpoch += 1
    stale = false
    staleMinimumRevision = undefined
    publish()
    return { status: 'ok', revision: result.revision }
  }

  const select: LorebookPageOwner['select'] = async (input) => {
    const lorebookId = input.lorebookId.trim()
    if (!lorebookId || !Number.isInteger(input.index) || input.index < 0) {
      return { status: 'failed', error: 'Lorebook selection requires a stable id and non-negative index' }
    }

    const attempt = ++mutationAttempt
    const previous = {
      status,
      revision,
      state: state.present
        ? ({ present: true, value: structuredClone(state.value) } as const)
        : ({ present: false } as const),
      error,
      stale,
      staleMinimumRevision,
    }
    projectionEpoch += 1
    const optimisticProjectionEpoch = projectionEpoch
    status = 'ready'
    state = { present: true, value: input.index }
    error = null
    stale = false
    mutation = { status: 'pending', attempt, index: input.index, lorebookId }
    publish()

    const rollback = (failure: string): void => {
      if (attempt !== mutationAttempt) return
      if (projectionEpoch === optimisticProjectionEpoch) {
        status = previous.status
        revision = previous.revision
        state = previous.state
        error = previous.error
        stale = previous.stale
        staleMinimumRevision = previous.staleMinimumRevision
        projectionEpoch += 1
      }
      mutation = { status: 'failed', attempt, index: input.index, lorebookId, error: failure }
      publish()
    }

    let receipt: LorebookPageSelectionPersistenceReceipt
    try {
      receipt = await persistSelection(lorebookId, input.signal)
    } catch (selectionError) {
      const failure = selectionError instanceof Error ? selectionError.message : String(selectionError)
      rollback(failure)
      return { status: 'failed', error: failure }
    }
    if (attempt !== mutationAttempt) {
      if (receipt.status === 'queued') {
        return { status: 'queued', mutationId: receipt.mutationId, settlement: receipt.settlement }
      }
      return receipt
    }
    if (receipt.status === 'accepted') {
      revision = revision === null ? receipt.revision : Math.max(revision, receipt.revision)
      mutation = { status: 'idle' }
      if (projectionEpoch !== optimisticProjectionEpoch) stale = true
      publish()
      return receipt
    }
    if (receipt.status === 'failed') {
      rollback(receipt.error)
      return receipt
    }

    mutation = {
      status: 'queued',
      attempt,
      index: input.index,
      lorebookId,
      mutationId: receipt.mutationId,
    }
    publish()
    const settlement = receipt.settlement.then(
      (finalSettlement) => {
        if (attempt !== mutationAttempt) return finalSettlement
        if (finalSettlement === 'accepted') {
          mutation = { status: 'idle' }
          if (projectionEpoch === optimisticProjectionEpoch) stale = true
          publish()
          return finalSettlement
        }
        rollback('Queued lorebook selection failed')
        return finalSettlement
      },
      (settlementError) => {
        rollback(settlementError instanceof Error ? settlementError.message : String(settlementError))
        return 'failed' as const
      },
    )
    return { status: 'queued', mutationId: receipt.mutationId, settlement }
  }

  return {
    resource: RESOURCE,
    drafts: 'not-applicable',
    snapshot,
    invalidate(minimumRevision) {
      stale = true
      if (minimumRevision !== undefined) {
        staleMinimumRevision = Math.max(staleMinimumRevision ?? -1, minimumRevision)
      }
      publish()
    },
    refresh,
    retry: (signal) => refresh({ signal }),
    select,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
  }
}

/** Stable owner identity for the standalone lorebook-page pointer. */
export const lorebookPageOwner = createLorebookPageOwner()
