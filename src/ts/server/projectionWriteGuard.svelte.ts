import { isFastifyServer } from '../platform'
import { DBState } from '../stores.svelte'
import type { Database } from '../storage/database.svelte'

let serverProjectionWriteGuardEnabled = false
const readOnlyServerProjectionTargets = new WeakMap<object, object>()
const readOnlyServerProjectionSources = new WeakMap<object, object>()
let trustedServerProjectionWriteDepth = 0
let readOnlyServerProjection = $state.raw<Database>({} as Database)
const readOnlyServerProjectionPrototype = {}

export function setServerProjectionWriteGuardEnabled(enabled: boolean) {
  serverProjectionWriteGuardEnabled = enabled
  if (enabled && isFastifyServer && DBState.db && typeof DBState.db === 'object') {
    DBState.db = createReadOnlyServerProjection(snapshotServerProjectionValue(DBState.db))
  }
}

export function isServerProjectionWriteGuardEnabled() {
  return (
    serverProjectionWriteGuardEnabled && isFastifyServer && trustedServerProjectionWriteDepth === 0
  )
}

export function withTrustedServerProjectionWrite<T>(callback: () => T): T {
  if (!serverProjectionWriteGuardEnabled || !isFastifyServer) {
    return callback()
  }

  let shouldRefreeze = false
  const refreeze = () => {
    if (!shouldRefreeze) return
    trustedServerProjectionWriteDepth -= 1
    if (trustedServerProjectionWriteDepth === 0) {
      DBState.db = createReadOnlyServerProjection(snapshotServerProjectionValue(DBState.db))
    }
    shouldRefreeze = false
  }

  trustedServerProjectionWriteDepth += 1
  shouldRefreeze = true
  if (trustedServerProjectionWriteDepth === 1) {
    DBState.db = snapshotServerProjectionValue(DBState.db)
  }

  try {
    const result = callback()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(refreeze) as T
    }
    refreeze()
    return result
  } catch (error) {
    refreeze()
    throw error
  }
}

export function createReadOnlyServerProjection<T extends object>(target: T): T {
  readOnlyServerProjection = createReadOnlyServerProjectionProxy(target) as Database
  return readOnlyServerProjection as T
}

function createReadOnlyServerProjectionProxy(target: object): object {
  const existing = readOnlyServerProjectionTargets.get(target)
  if (existing) return existing

  const proxy = new Proxy(target, {
    deleteProperty() {
      throw new TypeError('Cannot mutate read-only server projection')
    },
    defineProperty() {
      throw new TypeError('Cannot mutate read-only server projection')
    },
    get(currentTarget, key, receiver) {
      const value = Reflect.get(currentTarget, key, receiver)
      if (value && typeof value === 'object') {
        return createReadOnlyServerProjectionProxy(value)
      }
      return value
    },
    getPrototypeOf() {
      return readOnlyServerProjectionPrototype
    },
    preventExtensions() {
      throw new TypeError('Cannot mutate read-only server projection')
    },
    set() {
      throw new TypeError('Cannot mutate read-only server projection')
    },
    setPrototypeOf() {
      throw new TypeError('Cannot mutate read-only server projection')
    },
  })
  readOnlyServerProjectionTargets.set(target, proxy)
  readOnlyServerProjectionSources.set(proxy, target)
  return proxy
}

function snapshotServerProjectionValue(value: Database): Database {
  if (value && typeof value === 'object') {
    const source = readOnlyServerProjectionSources.get(value)
    if (source) {
      return structuredClone(source) as Database
    }
  }
  return $state.snapshot(value) as Database
}
