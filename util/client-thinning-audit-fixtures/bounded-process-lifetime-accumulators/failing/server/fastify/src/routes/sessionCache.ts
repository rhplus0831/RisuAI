export const pendingRequestState = new Map<string, unknown>()

export function rememberRequest(id: string, value: unknown): void {
  pendingRequestState.set(id, value)
}
