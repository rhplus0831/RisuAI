export const PERSISTENCE_ACTIVITY_LINGER_MS = 500

export const persistenceSavingState = $state({
  state: false,
})

let inFlightMutationCount = 0
let pendingMutationOutboxActive = false
let lingerTimeout: ReturnType<typeof setTimeout> | null = null

/** Track one queued/in-flight server mutation until its returned disposer runs. */
export function beginPersistenceActivity(): () => void {
  inFlightMutationCount += 1
  updatePersistenceSavingState()

  let finished = false
  return () => {
    if (finished) return
    finished = true
    inFlightMutationCount = Math.max(0, inFlightMutationCount - 1)
    updatePersistenceSavingState()
  }
}

/** Keep persistence feedback active while this writer has durable, unacknowledged intents. */
export function setPendingMutationOutboxActive(active: boolean): void {
  pendingMutationOutboxActive = active
  updatePersistenceSavingState()
}

export function resetPersistenceActivityForTests(): void {
  if (lingerTimeout !== null) clearTimeout(lingerTimeout)
  lingerTimeout = null
  inFlightMutationCount = 0
  pendingMutationOutboxActive = false
  persistenceSavingState.state = false
}

function updatePersistenceSavingState(): void {
  if (inFlightMutationCount > 0 || pendingMutationOutboxActive) {
    if (lingerTimeout !== null) clearTimeout(lingerTimeout)
    lingerTimeout = null
    persistenceSavingState.state = true
    return
  }

  if (!persistenceSavingState.state || lingerTimeout !== null) return
  lingerTimeout = setTimeout(() => {
    lingerTimeout = null
    if (inFlightMutationCount === 0 && !pendingMutationOutboxActive) {
      persistenceSavingState.state = false
    }
  }, PERSISTENCE_ACTIVITY_LINGER_MS)
}
