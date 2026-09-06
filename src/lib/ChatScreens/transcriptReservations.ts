import { MAX_TRANSCRIPT_INTERACTION_ROWS, type TranscriptInteractionProvider } from './transcriptInteraction'

export function createTranscriptReservations(onChange: () => void): TranscriptInteractionProvider & {
  ids(): string[]
  reset(): void
} {
  const reservations = new Map<string, Map<object, () => void>>()
  const listeners = new Set<() => void>()
  let notificationPending = false
  function changed() {
    onChange()
    if (notificationPending) return
    notificationPending = true
    // Teardown/effects can release reservations. Retry after their update has
    // finished, and iterate a snapshot because a retry may unsubscribe itself.
    queueMicrotask(() => {
      notificationPending = false
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener()
      }
    })
  }
  return {
    reserve(id, owner) {
      let owners = reservations.get(id)
      if (!owners) {
        if (reservations.size >= MAX_TRANSCRIPT_INTERACTION_ROWS) return null
        owners = new Map()
        reservations.set(id, owners)
      }
      const existing = owners.get(owner)
      if (existing) return existing
      const capturedOwners = owners
      let released = false
      const release = () => {
        if (released) return
        released = true
        if (reservations.get(id) !== capturedOwners) return
        capturedOwners.delete(owner)
        if (capturedOwners.size === 0) reservations.delete(id)
        changed()
      }
      owners.set(owner, release)
      // Acquisition changes the pin set but is not an availability signal.
      onChange()
      return release
    },
    subscribeAvailable(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ids: () => [...reservations.keys()],
    reset() {
      reservations.clear()
      changed()
    },
  }
}
