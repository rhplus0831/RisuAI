import type { CbsCallbackMemo, CbsCallbackMemoName } from '../../../../src/ts/cbs'

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
