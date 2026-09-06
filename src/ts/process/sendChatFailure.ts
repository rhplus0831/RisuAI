export const GENERATION_IN_PROGRESS_FAILURE_CAUSE = 'generation_in_progress' as const

export interface SendChatFailure {
  cause: typeof GENERATION_IN_PROGRESS_FAILURE_CAUSE
}

export function sendChatFailureFromServerCode(code: string | undefined): SendChatFailure | undefined {
  return code === GENERATION_IN_PROGRESS_FAILURE_CAUSE ? { cause: GENERATION_IN_PROGRESS_FAILURE_CAUSE } : undefined
}
