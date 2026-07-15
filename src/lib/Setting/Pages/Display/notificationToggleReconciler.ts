export interface NotificationToggleReconciler {
  reconcile(enabled: boolean): Promise<void>
}

export function createNotificationToggleReconciler(
  applyDesiredState: (enabled: boolean) => Promise<void>,
): NotificationToggleReconciler {
  let desiredState = false
  let desiredRevision = 0
  let appliedRevision = 0
  let running: Promise<void> | null = null

  async function drain(): Promise<void> {
    try {
      while (appliedRevision !== desiredRevision) {
        const revision = desiredRevision
        const enabled = desiredState
        await applyDesiredState(enabled)
        appliedRevision = revision
      }
    } finally {
      running = null
    }
  }

  return {
    reconcile(enabled: boolean): Promise<void> {
      desiredState = enabled
      desiredRevision += 1
      running ??= Promise.resolve().then(drain)
      return running
    },
  }
}
