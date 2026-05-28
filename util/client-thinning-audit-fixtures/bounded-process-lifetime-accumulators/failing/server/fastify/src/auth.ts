export interface AuthState {
  knownKeyHashes: Set<string>
}

export function trimKnownKeys(state: AuthState): void {
  if (state.knownKeyHashes.size > 2) {
    const oldest = state.knownKeyHashes.values().next().value
    if (oldest !== undefined) state.knownKeyHashes.delete(oldest)
  }
}
