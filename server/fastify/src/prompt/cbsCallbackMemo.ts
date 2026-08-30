/** Names of the assembly-scoped CBS callbacks that are memoized. */
export type CbsCallbackMemoName = 'charhistory' | 'userhistory' | 'lorebook'

/**
 * Fastify-owned callback memo contract.
 *
 * The parser only observes this small cache surface; it does not need the
 * browser's aggregate CBS registration or database declarations. The memo is
 * intentionally created per assembly by this module, never shared globally.
 */
export interface CbsCallbackMemo {
  entries: Map<string, string>
  historyGeneration: number
  loreGeneration?: number
  recordMiss?: (name: CbsCallbackMemoName, key: string) => void
}

export interface AssemblyCbsCallbackMemoInstrumentation {
  callbackMisses: Record<CbsCallbackMemoName, number>
}

const emptyMisses = (): Record<CbsCallbackMemoName, number> => ({
  charhistory: 0,
  userhistory: 0,
  lorebook: 0,
})

const instrumentation: AssemblyCbsCallbackMemoInstrumentation = {
  callbackMisses: emptyMisses(),
}

export function resetAssemblyCbsCallbackMemoInstrumentation(): void {
  instrumentation.callbackMisses = emptyMisses()
}

export function getAssemblyCbsCallbackMemoInstrumentation(): AssemblyCbsCallbackMemoInstrumentation {
  return {
    callbackMisses: { ...instrumentation.callbackMisses },
  }
}

export function createAssemblyCbsCallbackMemo(): CbsCallbackMemo {
  return {
    entries: new Map(),
    historyGeneration: 0,
    loreGeneration: 0,
    recordMiss: (name) => {
      instrumentation.callbackMisses[name]++
    },
  }
}

export function bumpAssemblyCbsHistoryGeneration(memo: CbsCallbackMemo | undefined): void {
  if (!memo) return
  memo.historyGeneration++
  for (const key of Array.from(memo.entries.keys())) {
    if (key.startsWith('history:')) {
      memo.entries.delete(key)
    }
  }
}

export function bumpAssemblyCbsLoreGeneration(memo: CbsCallbackMemo | undefined): void {
  if (!memo) return
  memo.loreGeneration = (memo.loreGeneration ?? 0) + 1
  for (const key of Array.from(memo.entries.keys())) {
    if (key.startsWith('lorebook:')) {
      memo.entries.delete(key)
    }
  }
}
