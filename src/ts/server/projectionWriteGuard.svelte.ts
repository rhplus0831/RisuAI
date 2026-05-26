import { isFastifyServer } from '../platform'
import { DBState } from '../stores.svelte'
import type { Database } from '../storage/database.svelte'

let serverProjectionWriteGuardEnabled = false
const frozenServerProjectionTargets = new WeakSet<object>()
let trustedServerProjectionWriteDepth = 0

export function setServerProjectionWriteGuardEnabled(enabled: boolean) {
  serverProjectionWriteGuardEnabled = enabled
  if (enabled && isFastifyServer && DBState.db && typeof DBState.db === 'object') {
    DBState.db = createReadOnlyServerProjection($state.snapshot(DBState.db) as Database)
  }
}

export function isServerProjectionWriteGuardEnabled() {
  return serverProjectionWriteGuardEnabled && isFastifyServer
}

export function withTrustedServerProjectionWrite<T>(callback: () => T): T {
  if (!serverProjectionWriteGuardEnabled || !isFastifyServer) {
    return callback()
  }

  trustedServerProjectionWriteDepth += 1
  if (trustedServerProjectionWriteDepth === 1) {
    DBState.db = $state.snapshot(DBState.db) as Database
  }

  try {
    return callback()
  } finally {
    trustedServerProjectionWriteDepth -= 1
    if (trustedServerProjectionWriteDepth === 0) {
      DBState.db = createReadOnlyServerProjection($state.snapshot(DBState.db) as Database)
    }
  }
}

export function createReadOnlyServerProjection<T extends object>(target: T): T {
  freezeServerProjectionTarget(target)
  return target
}

function freezeServerProjectionTarget(target: object) {
  if (frozenServerProjectionTargets.has(target)) return
  frozenServerProjectionTargets.add(target)

  for (const key of Reflect.ownKeys(target)) {
    const value = Reflect.get(target, key)
    if (value && typeof value === 'object') {
      freezeServerProjectionTarget(value)
    }
  }
  Object.freeze(target)
}
