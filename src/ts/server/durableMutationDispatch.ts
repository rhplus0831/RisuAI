import {
  acknowledgeServerMutationReceipts,
  replayDurableMutationRequests,
  replayDurableMutationRequestsInline,
  runServerCommandWithoutMutationReceipt,
  type DurableMutationReplayResult,
  type ServerCommandExecutionWrapper,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './commands'
import {
  beginPendingMutationDispatch,
  completePendingMutation,
  deletePendingMutationReceiptAcknowledgement,
  discardPendingMutation,
  isPendingMutationCurrent,
  listPendingMutationPredecessors,
  listPendingMutationReceiptAcknowledgements,
  type DurableMutationIntent,
  type PendingMutationHandle,
  type PendingMutationReceiptAcknowledgement,
} from './pendingMutationOutbox'

const localMutationLockTails = new Map<string, Promise<void>>()

/**
 * Wait for the exact encrypted generation, acquire an origin-wide lock, then
 * start the network request. Page-exit callers rely on the already-staged row
 * and next-start replay if the asynchronous lock prevents a keepalive request.
 */
export function dispatchDurableMutation<T extends Record<string, unknown> = {}>(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
  dispatch: (options: ServerCommandTransportOptions) => Promise<ServerCommandResult<T>>,
): Promise<ServerCommandResult<T>> {
  if (!handle.databaseLineage) return dispatch({})
  // Freeze synchronously before the caller can stage a successor, and enqueue
  // the command synchronously so later structural actions cannot overtake it.
  const readiness = beginPendingMutationDispatch(handle)
  const executionWrapper: ServerCommandExecutionWrapper = (execute) =>
    withPendingMutationDispatchLocks(handle, async () => {
      const persistence = await readiness
      if (persistence === 'superseded') return { status: 'unavailable' }
      if (persistence === 'persisted' && !(await isPendingMutationCurrent(handle))) {
        return { status: 'unavailable' }
      }
      if (persistence === 'persisted' && !(await drainPendingMutationPredecessors(handle))) {
        return { status: 'unavailable' }
      }
      const result =
        persistence === 'unavailable' ? await runServerCommandWithoutMutationReceipt(execute) : await execute()
      await settleDurableMutation(handle, intent, result)
      return result
    })
  return dispatch({
    mutationId: handle.mutationId,
    databaseLineage: handle.databaseLineage,
    executionWrapper,
  })
}

export interface DurableMutationReplayOutcome {
  disposition: 'discarded' | 'retained' | 'skipped' | 'succeeded'
  result?: DurableMutationReplayResult
}

export async function dispatchDurableMutationReplay(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
): Promise<DurableMutationReplayOutcome> {
  if (!handle.databaseLineage) return { disposition: 'discarded' }
  return withPendingMutationDispatchLocks(handle, async () => {
    const persistence = await beginPendingMutationDispatch(handle)
    if (persistence !== 'persisted') return { disposition: 'skipped' }

    const result = await replayDurableMutationRequests(intent.requests, handle.mutationId, handle.databaseLineage!)
    if (result.status === 'ok') {
      const completed = await completePendingMutation(handle, intent.requests.length)
      if (completed !== 'deleted') return { disposition: 'skipped', result }
      await flushReceiptAcknowledgement({
        mutationId: handle.mutationId,
        requestCount: intent.requests.length,
        databaseLineage: handle.databaseLineage!,
        queuedAt: 0,
      })
      return { disposition: 'succeeded', result }
    }
    if (
      result.status === 'error' &&
      (result.reason === 'stale-writer' ||
        result.reason === 'database-lineage' ||
        result.reason === 'mutation-id-conflict')
    ) {
      await discardPendingMutation(handle)
      return { disposition: 'discarded', result }
    }
    return { disposition: 'retained', result }
  })
}

async function drainPendingMutationPredecessors(handle: PendingMutationHandle): Promise<boolean> {
  const predecessors = await listPendingMutationPredecessors(handle)
  if (predecessors.status !== 'ok') return false

  for (const predecessor of predecessors.entries) {
    const ready = await withPendingMutationLock(
      predecessor.handle.databaseLineage!,
      predecessor.handle.mutationId,
      async () => {
        const persistence = await beginPendingMutationDispatch(predecessor.handle)
        if (persistence === 'superseded') return true
        if (persistence !== 'persisted') return false

        const result = await replayDurableMutationRequestsInline(
          predecessor.intent.requests,
          predecessor.handle.mutationId,
          predecessor.handle.databaseLineage!,
        )
        if (result.status === 'ok') {
          const completed = await completePendingMutation(predecessor.handle, predecessor.intent.requests.length)
          if (completed === 'superseded') return true
          if (completed !== 'deleted') return false
          await flushReceiptAcknowledgement({
            mutationId: predecessor.handle.mutationId,
            requestCount: predecessor.intent.requests.length,
            databaseLineage: predecessor.handle.databaseLineage!,
            queuedAt: 0,
          })
          return true
        }
        if (
          result.status === 'error' &&
          (result.reason === 'stale-writer' ||
            result.reason === 'database-lineage' ||
            result.reason === 'mutation-id-conflict')
        ) {
          await discardPendingMutation(predecessor.handle)
          return result.reason === 'mutation-id-conflict'
        }
        return false
      },
    )
    if (!ready) return false
  }
  return true
}

/**
 * Accepted requests atomically become durable receipt-ACK work. Terminal
 * ownership/lineage/id collisions are discarded; transient failures remain for
 * replay against the same owner and database.
 */
export async function settleDurableMutation(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
  result: ServerCommandResult | null | undefined,
): Promise<boolean> {
  if (result?.status === 'ok') {
    const completed = await completePendingMutation(handle, intent.requests.length)
    if (completed !== 'deleted' || !handle.databaseLineage) return false
    await flushReceiptAcknowledgement({
      mutationId: handle.mutationId,
      requestCount: intent.requests.length,
      databaseLineage: handle.databaseLineage,
      queuedAt: 0,
    })
    return true
  }
  if (
    result?.status === 'error' &&
    (result.reason === 'stale-writer' ||
      result.reason === 'database-lineage' ||
      result.reason === 'mutation-id-conflict')
  ) {
    await discardPendingMutation(handle)
  }
  return false
}

/** Retry crash-safe receipt cleanup after authenticated bootstrap. */
export async function flushPendingMutationReceiptAcknowledgements(): Promise<void> {
  const acknowledgements = await listPendingMutationReceiptAcknowledgements()
  for (const acknowledgement of acknowledgements) {
    await withPendingMutationLock(acknowledgement.databaseLineage, acknowledgement.mutationId, () =>
      flushReceiptAcknowledgement(acknowledgement),
    )
  }
}

async function flushReceiptAcknowledgement(acknowledgement: PendingMutationReceiptAcknowledgement): Promise<void> {
  const accepted = await acknowledgeServerMutationReceipts(
    acknowledgement.mutationId,
    acknowledgement.requestCount,
    acknowledgement.databaseLineage,
  )
  if (accepted) await deletePendingMutationReceiptAcknowledgement(acknowledgement)
}

async function withPendingMutationLock<T>(
  databaseLineage: string,
  mutationId: string,
  task: () => Promise<T>,
): Promise<T> {
  return withNamedPendingMutationLock(`risu:durable-mutation:${databaseLineage}:${mutationId}`, task)
}

async function withLocalPendingMutationLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  // Web Locks are widely available, but keep same-tab correctness in older
  // engines. Server receipt tombstones remain the cross-tab fallback defense.
  const previous = localMutationLockTails.get(name) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  const queuedTail = previous.then(() => tail)
  localMutationLockTails.set(name, queuedTail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (localMutationLockTails.get(name) === queuedTail) localMutationLockTails.delete(name)
  }
}

function withPendingMutationDispatchLocks<T>(handle: PendingMutationHandle, task: () => Promise<T>): Promise<T> {
  return withNamedPendingMutationLock(`risu:durable-mutation-key:${handle.databaseLineage}:${handle.key}`, () =>
    withPendingMutationLock(handle.databaseLineage!, handle.mutationId, task),
  )
}

async function withNamedPendingMutationLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks
  if (lockManager) return lockManager.request(name, { mode: 'exclusive' }, task)
  return withLocalPendingMutationLock(name, task)
}
