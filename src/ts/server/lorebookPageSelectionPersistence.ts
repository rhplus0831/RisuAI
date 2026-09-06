import { runServerCommand, selectGlobalLorebookCommand, type ServerCommandResult } from './commands'
import {
  dispatchDurableMutation,
  registerDurableMutationSettlementListener,
  type DurableMutationFinalSettlement,
} from './durableMutationDispatch'
import { GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY, globalLorebookOwnerMutationKey } from './lorebookMutationKeys'
import { stagePendingMutation, type DurableMutationIntent, type PendingMutationHandle } from './pendingMutationOutbox'
import type { ServerCommandTransportOptions } from './commands'

export type LorebookPageSelectionFinalSettlement = 'accepted' | 'failed'

export type LorebookPageSelectionPersistenceReceipt =
  | { status: 'accepted'; revision: number }
  | { status: 'failed'; error: string }
  | {
      status: 'queued'
      mutationId: string
      settlement: Promise<LorebookPageSelectionFinalSettlement>
      subscribeSettlement: (listener: (settlement: LorebookPageSelectionFinalSettlement) => void) => () => void
    }

type SelectionCommandResult = ServerCommandResult<{ selectedLorebookId: string }>

export interface LorebookPageSelectionPersistenceDependencies {
  stage: (key: string, intent: DurableMutationIntent) => PendingMutationHandle
  dispatch: (
    handle: PendingMutationHandle,
    intent: DurableMutationIntent,
    execute: (transport: ServerCommandTransportOptions) => Promise<SelectionCommandResult>,
  ) => Promise<SelectionCommandResult>
  execute: (
    lorebookId: string,
    signal: AbortSignal | null | undefined,
    transport: ServerCommandTransportOptions,
  ) => Promise<SelectionCommandResult>
  subscribeSettlement: (
    mutationId: string,
    listener: (settlement: DurableMutationFinalSettlement, details: { result?: unknown }) => void,
  ) => () => void
}

const defaultDependencies: LorebookPageSelectionPersistenceDependencies = {
  stage: stagePendingMutation,
  dispatch: (handle, intent, execute) => dispatchDurableMutation(handle, intent, execute),
  execute: (lorebookId, signal, transport) =>
    runServerCommand({
      command: (baseRevision) =>
        selectGlobalLorebookCommand({
          baseRevision,
          lorebookId,
          acknowledgeOptimistic: false,
        }),
      ...transport,
      signal,
    }),
  subscribeSettlement: (mutationId, listener) => registerDurableMutationSettlementListener(mutationId, listener),
}

export function lorebookPageSelectionIntent(lorebookId: string): DurableMutationIntent {
  return {
    version: 1,
    dependencyKeys: [globalLorebookOwnerMutationKey(lorebookId)],
    requests: [
      {
        method: 'POST',
        path: `/lorebooks/${encodeURIComponent(lorebookId)}/select`,
        body: {},
      },
    ],
  }
}

export function createLorebookPageSelectionPersistence(
  dependencies: LorebookPageSelectionPersistenceDependencies = defaultDependencies,
): (lorebookId: string, signal?: AbortSignal | null) => Promise<LorebookPageSelectionPersistenceReceipt> {
  return async (lorebookId, signal) => {
    if (!lorebookId.trim()) return { status: 'failed', error: 'Lorebook id is required' }

    const intent = lorebookPageSelectionIntent(lorebookId)
    let handle: PendingMutationHandle
    try {
      handle = dependencies.stage(GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY, intent)
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }

    let finalSettlement: LorebookPageSelectionFinalSettlement | null = null
    let resolveFinalSettlement!: (settlement: LorebookPageSelectionFinalSettlement) => void
    const settlement = new Promise<LorebookPageSelectionFinalSettlement>((resolve) => {
      resolveFinalSettlement = resolve
    })
    const listeners = new Set<(settlement: LorebookPageSelectionFinalSettlement) => void>()
    const publishFinalSettlement = (next: LorebookPageSelectionFinalSettlement): void => {
      if (finalSettlement) return
      finalSettlement = next
      resolveFinalSettlement(next)
      for (const listener of [...listeners]) listener(next)
      listeners.clear()
    }
    const cleanup = dependencies.subscribeSettlement(handle.mutationId, (replaySettlement) => {
      publishFinalSettlement(replaySettlement === 'accepted' ? 'accepted' : 'failed')
    })
    const queuedReceipt = (): LorebookPageSelectionPersistenceReceipt => ({
      status: 'queued',
      mutationId: handle.mutationId,
      settlement,
      subscribeSettlement(listener) {
        if (finalSettlement) {
          listener(finalSettlement)
          return () => {}
        }
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })

    let failureRollbackDisposition: ServerCommandTransportOptions['failureRollbackDisposition']
    try {
      const result = await dependencies.dispatch(handle, intent, (transport) => {
        failureRollbackDisposition = transport.failureRollbackDisposition
        return dependencies.execute(lorebookId, signal, transport)
      })
      if (result.status === 'ok') {
        cleanup()
        return { status: 'accepted', revision: result.revision }
      }
      if (failureRollbackDisposition?.(result) === 'retain') return queuedReceipt()
      cleanup()
      return { status: 'failed', error: commandFailureMessage(result) }
    } catch (error) {
      if (failureRollbackDisposition?.({ status: 'unavailable' }) === 'retain') return queuedReceipt()
      cleanup()
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export const persistLorebookPageSelection = createLorebookPageSelectionPersistence()

function commandFailureMessage(result: Exclude<SelectionCommandResult, { status: 'ok' }>): string {
  if (result.status === 'error') return result.error
  if (result.status === 'conflict') return `Lorebook selection conflicted at revision ${result.currentRevision}`
  return 'Lorebook selection is unavailable'
}
