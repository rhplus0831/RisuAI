import type { Database } from '../storage/database.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  composeResourceDatabaseSnapshot,
  isServerCollectionName,
  replaceResourceDatabase,
  settingsResourceState,
} from '../server/resourceState.svelte'

/** Test-only aggregate adapter. Production code must read explicit resource owners. */
export function getTestDatabase(options: { snapshot?: boolean } = {}): Database {
  return options.snapshot ? composeResourceDatabaseSnapshot() : testDatabaseProxy
}

/** Test-only mutation scope retained while suites migrate to direct owner fixtures. */
export function withTestDatabaseWrite<T>(callback: (database: Database) => T): T {
  return callback(testDatabaseProxy)
}

export const getDatabase = getTestDatabase
export const getResourceDatabase = getTestDatabase

const testDatabaseProxy = new Proxy({} as Database, {
  get(_target, property) {
    if (property === Symbol.toStringTag) return 'TestResourceDatabase'
    if (property === 'toJSON') return composeResourceDatabaseSnapshot
    if (typeof property !== 'string') return undefined
    return testDatabaseField(property)
  },
  has(_target, property) {
    return typeof property === 'string' && testDatabaseKeys().includes(property)
  },
  ownKeys() {
    return testDatabaseKeys()
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property !== 'string' || !testDatabaseKeys().includes(property)) return undefined
    return { configurable: true, enumerable: true, value: testDatabaseField(property), writable: true }
  },
  set(_target, property, value) {
    if (typeof property !== 'string') return false
    setTestDatabaseField(property, value)
    return true
  },
  deleteProperty(_target, property) {
    if (typeof property !== 'string') return false
    deleteTestDatabaseField(property)
    return true
  },
  defineProperty(_target, property, descriptor) {
    if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false
    setTestDatabaseField(property, descriptor.value)
    return true
  },
})

function testDatabaseField(property: string): unknown {
  if (property === 'characters') return charactersResourceState.characters
  if (property === 'characterOrder') return charactersResourceState.characterOrder
  if (property === 'currentChar') return charactersResourceState.currentChar
  if (isServerCollectionName(property)) return collectionsResourceState.values[property]
  return (settingsResourceState.value as Record<string, unknown>)[property]
}

function testDatabaseKeys(): string[] {
  return Array.from(
    new Set([
      ...Object.keys(settingsResourceState.value),
      ...Object.keys(collectionsResourceState.values),
      'characters',
      'characterOrder',
      'currentChar',
    ]),
  )
}

function setTestDatabaseField(property: string, value: unknown): void {
  if (property === 'characters') {
    charactersResourceState.characters = cloneTestValue(value) as Database['characters']
    charactersResourceState.status = 'ready'
    return
  }
  if (property === 'characterOrder') {
    charactersResourceState.characterOrder = cloneTestValue(value) as Database['characterOrder']
    return
  }
  if (property === 'currentChar') {
    charactersResourceState.currentChar = Number.isInteger(value) ? (value as number) : -1
    return
  }
  if (isServerCollectionName(property)) {
    collectionsResourceState.values[property] = cloneTestValue(value) as never
    collectionsResourceState.statuses[property] = 'ready'
    return
  }
  ;(settingsResourceState.value as Record<string, unknown>)[property] = cloneTestValue(value)
  settingsResourceState.status = 'ready'
}

function deleteTestDatabaseField(property: string): void {
  if (property === 'characters') {
    charactersResourceState.characters = []
    return
  }
  if (property === 'characterOrder') {
    charactersResourceState.characterOrder = []
    return
  }
  if (property === 'currentChar') {
    charactersResourceState.currentChar = -1
    return
  }
  if (isServerCollectionName(property)) {
    delete collectionsResourceState.values[property]
    return
  }
  delete (settingsResourceState.value as Record<string, unknown>)[property]
}

function cloneTestValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

/** Mutable test adapter for suites that need to replace the resource database wholesale. */
export const testDatabaseState = {
  get db(): Database {
    return getTestDatabase()
  },
  set db(value: Database | Record<string, unknown>) {
    replaceResourceDatabase(value as Database)
  },
}
