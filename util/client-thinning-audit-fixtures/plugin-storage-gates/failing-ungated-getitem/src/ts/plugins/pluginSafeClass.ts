// EC2 fixture: device-local plugin storage is gated by Plugin Compatibility
// Mode in Fastify mode. Every guarded storage method and every SafeIdbFactory
// member asserts the gate before touching device-local storage.

declare function getDatabase(): { pluginCompatibilityMode?: boolean }

function assertDeviceLocalPluginStorageEnabled(): void {
  if (getDatabase().pluginCompatibilityMode === true) return
  throw new Error('Plugin Compatibility Mode is disabled')
}

export class SafeLocalStorage {
  getItem(key: string): string | null {
    // Anti-pattern: touches device-local storage without asserting Plugin
    // Compatibility Mode first.
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
