import { dispatchDurableMutationReplay } from './durableMutationDispatch'
import { dispatchGenerationOperationPendingReplay } from './generationOperations'
import { isGenerationOperationPendingIntent, listPendingMutations } from './pendingMutationOutbox'

export interface PendingMutationReplaySummary {
  attempted: number
  discarded: number
  retained: number
  succeeded: number
}

/**
 * Drain this writer/database's durable autosaves after authenticated bootstrap
 * or after an in-session event-stream reconnect. Bootstrap callers run this
 * before resource hydration; reconnect callers retain live optimistic overlays
 * until each replay publishes its final settlement. Transient and genuine
 * stale-writer failures stay encrypted for a later retry; conclusive request,
 * lineage, receipt-ID, and malformed permanent-status failures are explicitly
 * reported before disposal.
 */
export async function replayPendingMutations(): Promise<PendingMutationReplaySummary> {
  const entries = await listPendingMutations()
  const blockedKeys = new Set<string>()
  const summary: PendingMutationReplaySummary = {
    attempted: 0,
    discarded: 0,
    retained: 0,
    succeeded: 0,
  }

  for (const entry of entries) {
    if (
      blockedKeys.has(entry.handle.key) ||
      (entry.intent.dependencyKeys ?? []).some((dependencyKey) => blockedKeys.has(dependencyKey))
    ) {
      // Propagate the dependency failure into this mutation's own lane so its
      // later successors cannot overtake the skipped correction.
      blockedKeys.add(entry.handle.key)
      summary.retained += 1
      continue
    }
    summary.attempted += 1
    const outcome = isGenerationOperationPendingIntent(entry.intent)
      ? await dispatchGenerationOperationPendingReplay(entry.handle, entry.intent)
      : await dispatchDurableMutationReplay(entry.handle, entry.intent)
    if (outcome.disposition === 'succeeded') {
      summary.succeeded += 1
    } else if (outcome.disposition === 'retained') {
      summary.retained += 1
      blockedKeys.add(entry.handle.key)
      console.warn(`Pending server mutation replay failed for ${entry.handle.key}`, outcome.result)
    } else if (outcome.disposition === 'discarded') {
      summary.discarded += 1
      console.warn(`Pending server mutation was discarded for ${entry.handle.key}`, outcome.result)
    }
  }
  return summary
}
