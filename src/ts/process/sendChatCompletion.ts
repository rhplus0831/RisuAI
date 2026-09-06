export interface SuccessfulSendChatOptions {
  sendSucceeded: boolean
  previousLength: number
  confirmBoundary: boolean
}

export interface SuccessfulSendChatEffects {
  clearRerollBuffer: () => void
  recordGeneratedReroll: (previousLength: number) => void
  markRerollChar: () => void
}

export function applySuccessfulSendChatEffects(
  options: SuccessfulSendChatOptions,
  effects: SuccessfulSendChatEffects,
): boolean {
  if (options.sendSucceeded !== true) {
    return false
  }

  if (options.confirmBoundary) {
    effects.clearRerollBuffer()
  }
  effects.recordGeneratedReroll(options.previousLength)
  effects.markRerollChar()

  return true
}
