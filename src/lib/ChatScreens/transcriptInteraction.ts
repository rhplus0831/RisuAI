export const TRANSCRIPT_INTERACTION_CONTEXT = Symbol('transcript-interaction')
export const MAX_TRANSCRIPT_INTERACTION_ROWS = 8

export interface TranscriptInteractionProvider {
  /** Reserve synchronously before creating row-owned state. Releases are idempotent. */
  reserve(messageId: string, owner: object): (() => void) | null
  /** Notify mounted consumers when capacity may have become available. */
  subscribeAvailable(listener: () => void): () => void
}

/** Shares one provider owner across a row's overlapping editors and async actions. */
export function createTranscriptInteractionScope(
  provider: TranscriptInteractionProvider | undefined,
  messageId: () => string | null | undefined,
  onLimit: () => void,
) {
  const owner = {}
  let held: { release: () => void; count: number } | null = null
  let disposed = false

  function acquire(notify = true): (() => void) | null {
    if (disposed) return null
    if (!held) {
      const id = messageId()
      // Greetings and Chat uses outside the transcript retain their existing behavior.
      const release = provider && id ? provider.reserve(id, owner) : () => {}
      if (!release) {
        if (notify) onLimit()
        return null
      }
      held = { release, count: 0 }
    }
    const reservation = held
    reservation.count += 1
    let released = false
    return () => {
      if (released) return
      released = true
      reservation.count -= 1
      if (reservation.count !== 0 || held !== reservation) return
      held = null
      reservation.release()
    }
  }

  return {
    acquire,
    async run<T>(operation: () => T | Promise<T>): Promise<T | undefined> {
      const release = acquire()
      if (!release) return undefined
      try {
        return await operation()
      } finally {
        release()
      }
    },
    dispose() {
      disposed = true
      const reservation = held
      held = null
      reservation?.release()
    },
  }
}
