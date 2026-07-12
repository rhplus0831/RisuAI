// Adversarial EC2 fixture: every method on the OLD hardcoded allowlist
// (getItem/setItem/removeItem/keys/key/clear) is correctly gated, but a freshly
// added device-local method — `getAll`, outside that list — reaches
// `localStorage` directly with no `assertDeviceLocalPluginStorageEnabled()`
// call. A fixed method-name allowlist never inspects it; the hardened
// sink-driven rule must flag it.

declare function getDatabase(): { pluginCompatibilityMode?: boolean }

function assertDeviceLocalPluginStorageEnabled(): void {
  if (getDatabase().pluginCompatibilityMode === true) return
  throw new Error('Plugin Compatibility Mode is disabled')
}

export class SafeLocalStorage {
  getItem(key: string): string | null {
    assertDeviceLocalPluginStorageEnabled()
    return globalThis.localStorage.getItem(key)
  }
  setItem(key: string, value: string): void {
    assertDeviceLocalPluginStorageEnabled()
    globalThis.localStorage.setItem(key, value)
  }
  removeItem(key: string): void {
    assertDeviceLocalPluginStorageEnabled()
    globalThis.localStorage.removeItem(key)
  }
  keys(): string[] {
    assertDeviceLocalPluginStorageEnabled()
    return Object.keys(globalThis.localStorage)
  }
  key(index: number): string | null {
    assertDeviceLocalPluginStorageEnabled()
    return globalThis.localStorage.key(index)
  }
  clear(): void {
    assertDeviceLocalPluginStorageEnabled()
    globalThis.localStorage.clear()
  }
  // New method, no gate, touches device-local storage directly.
  getAll(): Record<string, string> {
    const out: Record<string, string> = {}
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const key = globalThis.localStorage.key(i)
      if (key) out[key] = globalThis.localStorage.getItem(key) ?? ''
    }
    return out
  }
}

export class SafeLocalPluginStorage {
  getItem(_key: string): string | null {
    assertDeviceLocalPluginStorageEnabled()
    return null
  }
  setItem(_key: string, _value: string): void {
    assertDeviceLocalPluginStorageEnabled()
  }
  removeItem(_key: string): void {
    assertDeviceLocalPluginStorageEnabled()
  }
  keys(): string[] {
    assertDeviceLocalPluginStorageEnabled()
    return []
  }
  key(_index: number): string | null {
    assertDeviceLocalPluginStorageEnabled()
    return null
  }
  clear(): void {
    assertDeviceLocalPluginStorageEnabled()
  }
}

export const SafeIdbFactory = {
  open: (name: string) => {
    assertDeviceLocalPluginStorageEnabled()
    return globalThis.indexedDB.open(name)
  },
  deleteDatabase: (name: string) => {
    assertDeviceLocalPluginStorageEnabled()
    return globalThis.indexedDB.deleteDatabase(name)
  },
}
