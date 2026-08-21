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
