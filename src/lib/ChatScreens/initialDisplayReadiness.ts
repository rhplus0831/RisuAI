export interface InitialDisplayReadiness {
  updateScope(scopeId: string | null, hasRows: boolean): void
  start(scopeId: string | null, registration: symbol): void
  settle(scopeId: string | null, registration: symbol): void
  destroy(): void
}

type ReadinessPhase = 'waiting' | 'collecting' | 'ready'

export const INITIAL_DISPLAY_MESSAGE_COUNT = 2

export function shouldAwaitInitialDisplayParse(messageIndex: number, messageCount: number): boolean {
  return (
    Number.isInteger(messageIndex) &&
    Number.isInteger(messageCount) &&
    messageCount > 0 &&
    messageIndex >= Math.max(0, messageCount - INITIAL_DISPLAY_MESSAGE_COUNT) &&
    messageIndex < messageCount
  )
}

/**
 * Holds the transcript loading surface over the tracked initial display parses
 * for one chat. Later row reparses are deliberately ignored after the scope is
 * ready because ChatBody keeps its last successful body visible for those.
 */
export function createInitialDisplayReadiness(
  setPending: (pending: boolean) => void,
  afterRender: () => PromiseLike<void>,
): InitialDisplayReadiness {
  let scopeId: string | null = null
  let phase: ReadinessPhase = 'waiting'
  let pending = false
  let checkVersion = 0
  let destroyed = false
  const registrations = new Set<symbol>()

  const publishPending = (next: boolean) => {
    if (pending === next) return
    pending = next
    setPending(next)
  }

  const scheduleReadyCheck = () => {
    const version = ++checkVersion
    void Promise.resolve(afterRender()).then(() => {
      if (destroyed || version !== checkVersion || phase !== 'collecting' || registrations.size > 0) {
        return
      }
      phase = 'ready'
      publishPending(false)
    })
  }

  return {
    updateScope(nextScopeId, hasRows) {
      if (destroyed) return

      if (nextScopeId !== scopeId) {
        scopeId = nextScopeId
        phase = nextScopeId && hasRows ? 'collecting' : 'waiting'
        registrations.clear()
        checkVersion += 1
        publishPending(phase === 'collecting')
        if (phase === 'collecting') scheduleReadyCheck()
        return
      }

      if (!nextScopeId || !hasRows) {
        if (phase === 'waiting') return
        phase = 'waiting'
        registrations.clear()
        checkVersion += 1
        publishPending(false)
        return
      }

      if (phase === 'waiting') {
        phase = 'collecting'
        publishPending(true)
        scheduleReadyCheck()
      }
    },

    start(registrationScopeId, registration) {
      if (destroyed || registrationScopeId !== scopeId || phase !== 'collecting') return
      registrations.add(registration)
      checkVersion += 1
      publishPending(true)
    },

    settle(registrationScopeId, registration) {
      if (destroyed || registrationScopeId !== scopeId || phase !== 'collecting') return
      if (!registrations.delete(registration)) return
      if (registrations.size === 0) scheduleReadyCheck()
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      registrations.clear()
      checkVersion += 1
      publishPending(false)
    },
  }
}
