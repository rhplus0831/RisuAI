import { fetchServerStandaloneSetting } from './resourceReads'

const RESOURCE = 'loreBookPage' as const

export type LorebookPageOwnerStatus = 'unloaded' | 'loading' | 'ready' | 'stale' | 'error'

export interface LorebookPageOwnerSnapshot {
  resource: typeof RESOURCE
  status: LorebookPageOwnerStatus
  revision: number | null
  state: { present: false } | { present: true; value: unknown }
  error: string | null
}

export type LorebookPageOwnerRefreshResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }
  | { status: 'superseded' }

type StandaloneReadResult = Awaited<ReturnType<typeof fetchServerStandaloneSetting>>

export interface LorebookPageOwnerDependencies {
  read: (signal?: AbortSignal | null) => Promise<StandaloneReadResult>
}

export interface LorebookPageOwner {
  readonly resource: typeof RESOURCE
  snapshot(): LorebookPageOwnerSnapshot
  invalidate(minimumRevision?: number): void
  refresh(options?: { minimumRevision?: number; signal?: AbortSignal | null }): Promise<LorebookPageOwnerRefreshResult>
  retry(signal?: AbortSignal | null): Promise<LorebookPageOwnerRefreshResult>
  subscribe(listener: (snapshot: LorebookPageOwnerSnapshot) => void): () => void
}

export function createLorebookPageOwner(
  dependencies: LorebookPageOwnerDependencies = {
    read: (signal) => fetchServerStandaloneSetting(RESOURCE, signal),
  },
): LorebookPageOwner {
  let requestAttempt = 0
  let status: LorebookPageOwnerStatus = 'unloaded'
  let revision: number | null = null
  let state: LorebookPageOwnerSnapshot['state'] = { present: false }
  let error: string | null = null
  let stale = false
  let staleMinimumRevision: number | undefined
  const listeners = new Set<(snapshot: LorebookPageOwnerSnapshot) => void>()

  const snapshot = (): LorebookPageOwnerSnapshot => {
    return {
      resource: RESOURCE,
      status: stale && status === 'ready' ? 'stale' : status,
      revision,
      state: state.present ? { present: true, value: structuredClone(state.value) } : { present: false },
      error,
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
      result = await dependencies.read(options.signal)
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
    stale = false
    staleMinimumRevision = undefined
    publish()
    return { status: 'ok', revision: result.revision }
  }

  return {
    resource: RESOURCE,
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
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
  }
}

/** Stable owner identity for the standalone lorebook-page pointer. */
export const lorebookPageOwner = createLorebookPageOwner()
