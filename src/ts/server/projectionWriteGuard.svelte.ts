import {
  isResourceDatabaseWriteActive,
  setResourceDatabaseWriteGuardEnabled,
  withResourceDatabaseWrite,
} from './resourceState.svelte'

let serverProjectionWriteGuardEnabled = false
let serverProjectionApplyEpoch = $state(0)

/**
 * @deprecated The client is migrating away from projection-backed state. This
 * compatibility switch now controls the resource database facade's scoped
 * write policy instead of wrapping or swapping a whole Database object.
 */
export function setServerProjectionWriteGuardEnabled(enabled: boolean): void {
  serverProjectionWriteGuardEnabled = enabled
  setResourceDatabaseWriteGuardEnabled(enabled)
}

export function isServerProjectionWriteGuardEnabled(): boolean {
  return serverProjectionWriteGuardEnabled && !isResourceDatabaseWriteActive()
}

/**
 * Transitional trusted-write API used by optimistic commands and bridge code.
 * The callback writes directly to the owning settings, collections, or
 * characters resource slice through the deprecated DBState.db facade.
 */
export function withTrustedServerProjectionWrite<T>(callback: () => T): T {
  return withResourceDatabaseWrite(() => callback())
}

export function withServerProjectionApply<T>(callback: () => T): T {
  const result = withTrustedServerProjectionWrite(callback)
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    return Promise.resolve(result).finally(() => {
      serverProjectionApplyEpoch += 1
    }) as T
  }
  serverProjectionApplyEpoch += 1
  return result
}

export function getServerProjectionApplyEpoch(): number {
  return serverProjectionApplyEpoch
}
