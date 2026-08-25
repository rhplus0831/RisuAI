const ENABLED_VALUE = 'TRUE'
const SMOKE_OVERRIDE_STORAGE_KEY = 'risu:fast-bootstrap-observer-shell'

let testOverride: boolean | null = null

function readSmokeOverride(): boolean | null {
  if (import.meta.env.VITE_FASTIFY_BROWSER_SMOKE !== ENABLED_VALUE) return null
  try {
    const value = globalThis.sessionStorage?.getItem(SMOKE_OVERRIDE_STORAGE_KEY)
    if (value === 'enabled') return true
    if (value === 'disabled') return false
  } catch {
    // A blocked storage API must preserve the build-time default.
  }
  return null
}

/** Temporary Phase 6 rollout flag. Production remains conservative by default. */
export function isPreWriterObserverShellEnabled(): boolean {
  return testOverride ?? readSmokeOverride() ?? import.meta.env.VITE_FAST_BOOTSTRAP_OBSERVER === ENABLED_VALUE
}

export const __observerShellFlagTestHooks = {
  smokeOverrideStorageKey: SMOKE_OVERRIDE_STORAGE_KEY,
  setOverride(value: boolean | null): void {
    testOverride = value
  },
}
