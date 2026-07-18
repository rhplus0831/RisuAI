import { writable } from 'svelte/store'
import type { ScopedLorebookMutationOperation } from './lorebookBridge.svelte'

export type ScopedLorebookMutationUiStatus = 'pending' | 'queued' | 'failed'
export type ScopedLorebookMutationUiKind = 'collection' | 'local-activation'
export type ScopedLorebookMutationUiContext = 'default' | 'local-activation-cleanup'

export interface ScopedLorebookMutationUiState {
  key: string
  scopeKey: string
  displayScopeKey: string
  entryId?: string
  kind: ScopedLorebookMutationUiKind
  context: ScopedLorebookMutationUiContext
  operationToken: number
  status: ScopedLorebookMutationUiStatus
  error?: string
}

export interface TrackScopedLorebookMutationUiOperationOptions {
  operation: ScopedLorebookMutationOperation | null
  kind: ScopedLorebookMutationUiKind
  entryId?: string
  displayScopeKey?: string | null
  context?: ScopedLorebookMutationUiContext
  onQueued?: () => void
  onFailed?: (error: string) => void
}

const states = new Map<string, ScopedLorebookMutationUiState>()
let nextOperationToken = 0

export const scopedLorebookMutationUiStates = writable<readonly ScopedLorebookMutationUiState[]>([])

export function scopedLorebookCollectionMutationUiKey(scopeKey: string): string {
  return JSON.stringify(['collection', scopeKey])
}

export function scopedLorebookLocalActivationMutationUiKey(scopeKey: string, entryId: string): string {
  return JSON.stringify(['local-activation', scopeKey, entryId])
}

export function findScopedLorebookCollectionMutationUiState(
  snapshot: readonly ScopedLorebookMutationUiState[],
  scopeKey: string | null | undefined,
): ScopedLorebookMutationUiState | undefined {
  if (!scopeKey) return undefined
  const key = scopedLorebookCollectionMutationUiKey(scopeKey)
  return snapshot.find((state) => state.key === key)
}

export function findScopedLorebookLocalActivationMutationUiState(
  snapshot: readonly ScopedLorebookMutationUiState[],
  scopeKey: string | null | undefined,
  entryId: string | null | undefined,
): ScopedLorebookMutationUiState | undefined {
  if (!scopeKey || !entryId) return undefined
  const key = scopedLorebookLocalActivationMutationUiKey(scopeKey, entryId)
  return snapshot.find((state) => state.key === key)
}

export function scopedLorebookMutationUiStatesForDisplayScope(
  snapshot: readonly ScopedLorebookMutationUiState[],
  displayScopeKey: string | null | undefined,
): ScopedLorebookMutationUiState[] {
  if (!displayScopeKey) return []
  return snapshot.filter((state) => state.displayScopeKey === displayScopeKey)
}

export function trackScopedLorebookMutationUiOperation(
  options: TrackScopedLorebookMutationUiOperationOptions,
): number | null {
  const operation = options.operation
  if (!operation) return null
  if (options.kind === 'local-activation' && !options.entryId) return null

  const key =
    options.kind === 'collection'
      ? scopedLorebookCollectionMutationUiKey(operation.scopeKey)
      : scopedLorebookLocalActivationMutationUiKey(operation.scopeKey, options.entryId!)
  const operationToken = ++nextOperationToken
  states.set(key, {
    key,
    scopeKey: operation.scopeKey,
    displayScopeKey: options.displayScopeKey || operation.scopeKey,
    ...(options.entryId ? { entryId: options.entryId } : {}),
    kind: options.kind,
    context: options.context ?? 'default',
    operationToken,
    status: 'pending',
  })
  publishScopedLorebookMutationUiStates()

  void operation.settlement.then(
    (result) => {
      const current = states.get(key)
      if (current?.operationToken !== operationToken) return
      if (result.status === 'accepted') {
        states.delete(key)
        publishScopedLorebookMutationUiStates()
        return
      }

      states.set(key, {
        ...current,
        status: result.status,
        ...(result.status === 'failed' ? { error: result.error } : {}),
      })
      publishScopedLorebookMutationUiStates()
      if (result.status === 'queued') options.onQueued?.()
      else options.onFailed?.(result.error)
    },
    (error) => {
      const current = states.get(key)
      if (current?.operationToken !== operationToken) return
      const detail = error instanceof Error ? error.message : String(error)
      states.set(key, { ...current, status: 'failed', error: detail })
      publishScopedLorebookMutationUiStates()
      options.onFailed?.(detail)
    },
  )
  return operationToken
}

export function resetScopedLorebookMutationUiStateForTests(): void {
  states.clear()
  publishScopedLorebookMutationUiStates()
}

function publishScopedLorebookMutationUiStates(): void {
  scopedLorebookMutationUiStates.set(
    [...states.values()].sort((left, right) => left.operationToken - right.operationToken),
  )
}
