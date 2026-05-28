// audit:bounded(size <= 2; evicted by request close)
export const pendingRequestState = new Map<string, unknown>()

export function rememberRequest(id: string, value: unknown): void {
  pendingRequestState.set(id, value)
  if (pendingRequestState.size > 2) {
    const oldest = pendingRequestState.keys().next().value
    if (oldest !== undefined) pendingRequestState.delete(oldest)
  }
}
