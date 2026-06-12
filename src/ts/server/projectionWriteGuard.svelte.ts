import { DBState } from '../stores.svelte'
import type { Database } from '../storage/database.svelte'

let serverProjectionWriteGuardEnabled = false
// Maps a top-level read-only projection proxy back to its plain source.
const readOnlyServerProjectionSources = new WeakMap<object, object>()
// Maps a writable copy-on-write working proxy back to its plain mutable source.
const trustedServerProjectionWorkingCopies = new WeakMap<object, object>()
let trustedServerProjectionWriteDepth = 0
let serverProjectionApplyEpoch = $state(0)
let readOnlyServerProjection = $state.raw<Database>({} as Database)
const readOnlyServerProjectionPrototype = {}

export function setServerProjectionWriteGuardEnabled(enabled: boolean) {
  serverProjectionWriteGuardEnabled = enabled
  if (enabled && DBState.db && typeof DBState.db === 'object') {
    // One-time on enable: DBState.db is still a raw reactive object, so resolve a
    // plain source for it and wrap that in the read-only projection.
    DBState.db = createReadOnlyServerProjection(resolveServerProjectionSource(DBState.db))
  }
}

export function isServerProjectionWriteGuardEnabled() {
  return serverProjectionWriteGuardEnabled && trustedServerProjectionWriteDepth === 0
}

export function withTrustedServerProjectionWrite<T>(callback: () => T): T {
  if (!serverProjectionWriteGuardEnabled) {
    return callback()
  }

  let shouldRefreeze = false
  const refreeze = () => {
    if (!shouldRefreeze) return
    trustedServerProjectionWriteDepth -= 1
    if (trustedServerProjectionWriteDepth === 0) {
      // Copy-on-write refreeze: re-wrap the same mutated source in a FRESH
      // read-only proxy. createReadOnlyServerProjection always mints a new proxy
      // tree (per-wrap memo), so DBState.db and every nested proxy get a new
      // identity and dependent $derived chains re-run — with no data clone.
      DBState.db = createReadOnlyServerProjection(resolveServerProjectionSource(DBState.db))
    }
    shouldRefreeze = false
  }

  trustedServerProjectionWriteDepth += 1
  shouldRefreeze = true
  if (trustedServerProjectionWriteDepth === 1) {
    // Copy-on-write entry: hand the callback a writable pass-through working copy
    // of the projection source — no clone.
    DBState.db = createTrustedServerProjectionWorkingCopy(resolveServerProjectionSource(DBState.db))
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

export function createReadOnlyServerProjection<T extends object>(target: T): T {
  // A fresh nested-proxy memo per top-level wrap. Each guarded write thus mints a
  // brand-new proxy tree (new identities top-to-bottom) so dependent $derived
  // chains re-run exactly as they did when the old guard deep-cloned the tree —
  // but the underlying data is never cloned. The memo still dedupes shared refs
  // and breaks cycles within a single wrap.
  const memo = new WeakMap<object, object>()
  const proxy = createReadOnlyServerProjectionProxy(target, memo)
  readOnlyServerProjectionSources.set(proxy, target)
  readOnlyServerProjection = proxy as Database
  return proxy as T
}

function createReadOnlyServerProjectionProxy(target: object, memo: WeakMap<object, object>): object {
  const existing = memo.get(target)
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
        return createReadOnlyServerProjectionProxy(value, memo)
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
  memo.set(target, proxy)
  return proxy
}

// A guarded write hands the callback this writable working copy: a pass-through
// proxy over the plain projection source. Its only non-default trap is
// getPrototypeOf, which reports a non-Object/Array prototype so Svelte's `$state`
// does NOT deep-proxy it on assignment. That preserves the source's plain
// identity (so refreeze can re-wrap it with no clone) and lets the callback's
// mutations write straight through to the source.
function createTrustedServerProjectionWorkingCopy(source: Database): Database {
  const working = new Proxy(source as object, {
    getPrototypeOf() {
      return readOnlyServerProjectionPrototype
    },
  })
  trustedServerProjectionWorkingCopies.set(working, source as object)
  return working as Database
}

// Resolve the plain mutable source behind whatever DBState.db currently holds:
// a copy-on-write working proxy (entry/refreeze), a read-only proxy (between
// writes, or after a callback re-applied a full projection), or a foreign/raw
// object a callback assigned directly. Only the last case clones — `$state.snapshot`
// unwraps Svelte's reactive proxy back to a plain object, matching the old
// refreeze behavior on that rare full-replacement path.
function resolveServerProjectionSource(value: Database): Database {
  if (value && typeof value === 'object') {
    const working = trustedServerProjectionWorkingCopies.get(value)
    if (working) return working as Database
    const readOnlySource = readOnlyServerProjectionSources.get(value)
    if (readOnlySource) return readOnlySource as Database
  }
  return $state.snapshot(value) as Database
}
