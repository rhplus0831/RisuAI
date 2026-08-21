type PendingParse = () => void

let holdInitialParses = false
const pendingParses = new Set<PendingParse>()

export const defaultChatScreenTestChatController = {
  hold() {
    holdInitialParses = true
  },

  register(settle: PendingParse): () => void {
    if (holdInitialParses) {
      pendingParses.add(settle)
      return () => pendingParses.delete(settle)
    }

    queueMicrotask(settle)
    return () => undefined
  },

  pendingCount() {
    return pendingParses.size
  },

  releaseNext() {
    holdInitialParses = false
    const settle = pendingParses.values().next().value
    if (!settle) return false
    pendingParses.delete(settle)
    settle()
    return true
  },

  release() {
    holdInitialParses = false
    const pending = [...pendingParses]
    pendingParses.clear()
    for (const settle of pending) settle()
  },

  reset() {
    this.release()
  },
}
