import {
  isResourceDatabaseWriteActive,
  setResourceDatabaseWriteGuardEnabled,
  withResourceDatabaseWrite,
} from './resourceState.svelte'

let serverResourceWriteGuardEnabled = false
let localCharacterProjectionMutationEpoch = $state(0)

/**
 * @deprecated The client is migrating away from aggregate database state. This
 * compatibility switch now controls the resource database facade's scoped
 * write policy instead of wrapping or swapping a whole Database object.
 */
export function setResourceWriteGuardEnabled(enabled: boolean): void {
  serverResourceWriteGuardEnabled = enabled
  setResourceDatabaseWriteGuardEnabled(enabled)
}

export function isResourceWriteGuardEnabled(): boolean {
  return serverResourceWriteGuardEnabled && !isResourceDatabaseWriteActive()
}

/**
 * Transitional trusted-write API used by optimistic commands and bridge code.
 * The callback writes directly to the owning settings, collections, or
 * characters resource slice through the resource database compatibility view.
 */
export function withTrustedResourceWrite<T>(callback: () => T): T {
  return withResourceDatabaseWrite(() => callback())
}

export function markLocalCharacterProjectionMutation(): void {
  localCharacterProjectionMutationEpoch += 1
}

export function getLocalCharacterProjectionMutationEpoch(): number {
  return localCharacterProjectionMutationEpoch
}
