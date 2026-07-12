import type { Database, character } from '../storage/database.svelte'

export const SERVER_COLLECTION_NAMES = [
  'modules',
  'plugins',
  'modelPresets',
  'promptPresets',
  'botPresets',
  'promptTemplate',
  'personas',
  'loadouts',
  'loreBook',
  'translatorPresets',
  'hypaV3Presets',
  'pluginCustomStorage',
] as const

export type ServerCollectionName = (typeof SERVER_COLLECTION_NAMES)[number]
export type ServerCollectionValues = Pick<Database, ServerCollectionName>
export type ServerSettingsValues = Partial<
  Omit<Database, 'characters' | ServerCollectionName> & {
    currentChar: number
  }
>

export interface ServerSettingsResourcePayload {
  revision: number
  settings: ServerSettingsValues
}

export interface ServerCollectionsResourcePayload {
  revision: number
  collections: Partial<ServerCollectionValues>
}

export interface ServerCharactersResourcePayload {
  revision: number
  characters: character[]
  characterOrder: Database['characterOrder']
  currentChar: number
}

export interface ServerCharacterResourcePayload {
  revision: number
  character: character
}

export type ServerResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SettingsResourceState {
  value: ServerSettingsValues
  revision: number | null
  status: ServerResourceStatus
  error: string | null
}

export interface CollectionsResourceState {
  values: Partial<ServerCollectionValues>
  revision: number | null
  fullRevision: number | null
  revisions: Partial<Record<ServerCollectionName, number>>
  status: ServerResourceStatus
  statuses: Partial<Record<ServerCollectionName, ServerResourceStatus>>
  error: string | null
  errors: Partial<Record<ServerCollectionName, string>>
}

export interface CharactersResourceState {
  characters: character[]
  characterOrder: Database['characterOrder']
  currentChar: number
  revision: number | null
  listRevision: number | null
  rowRevisions: Record<string, number>
  status: ServerResourceStatus
  rowStatuses: Record<string, ServerResourceStatus>
  error: string | null
  rowErrors: Record<string, string>
}

export const settingsResourceState = $state<SettingsResourceState>({
  value: {},
  revision: null,
  status: 'idle',
  error: null,
})

export const collectionsResourceState = $state<CollectionsResourceState>({
  values: {},
  revision: null,
  fullRevision: null,
  revisions: {},
  status: 'idle',
  statuses: {},
  error: null,
  errors: {},
})

export const charactersResourceState = $state<CharactersResourceState>({
  characters: [],
  characterOrder: [],
  currentChar: -1,
  revision: null,
  listRevision: null,
  rowRevisions: {},
  status: 'idle',
  rowStatuses: {},
  error: null,
  rowErrors: {},
})

const collectionNameSet = new Set<string>(SERVER_COLLECTION_NAMES)
const guardedResourceValueMemo = new WeakMap<object, object>()
let resourceDatabaseWriteDepth = 0
let resourceDatabaseWriteGuardEnabled = false
let resourceDatabaseWriteChanged = false
let resourceDatabaseFacadeEpoch = $state(0)

export function setResourceDatabaseWriteGuardEnabled(enabled: boolean): void {
  resourceDatabaseWriteGuardEnabled = enabled
}

export function isResourceDatabaseWriteActive(): boolean {
  return resourceDatabaseWriteDepth > 0
}

export function getResourceDatabaseFacadeEpoch(): number {
  return resourceDatabaseFacadeEpoch
}

export function isServerCollectionName(value: string): value is ServerCollectionName {
  return collectionNameSet.has(value)
}

export function beginSettingsResourceLoad(): void {
  settingsResourceState.status = 'loading'
  settingsResourceState.error = null
}

export function failSettingsResourceLoad(error: string): void {
  settingsResourceState.status = 'error'
  settingsResourceState.error = error
}

export function applySettingsResource(payload: ServerSettingsResourcePayload): boolean {
  if (isOlderRevision(payload.revision, settingsResourceState.revision)) return false
  settingsResourceState.value = cloneJsonValue(payload.settings)
  settingsResourceState.revision = payload.revision
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

export function beginCollectionsResourceLoad(name?: ServerCollectionName): void {
  if (name) {
    collectionsResourceState.statuses[name] = 'loading'
    delete collectionsResourceState.errors[name]
    return
  }
  collectionsResourceState.status = 'loading'
  collectionsResourceState.error = null
}

export function failCollectionsResourceLoad(error: string, name?: ServerCollectionName): void {
  if (name) {
    collectionsResourceState.statuses[name] = 'error'
    collectionsResourceState.errors[name] = error
    return
  }
  collectionsResourceState.status = 'error'
  collectionsResourceState.error = error
}

export function applyCollectionsResource(
  payload: ServerCollectionsResourcePayload,
  requestedName?: ServerCollectionName,
): boolean {
  const names = requestedName
    ? [requestedName]
    : SERVER_COLLECTION_NAMES.filter((name) => Object.prototype.hasOwnProperty.call(payload.collections, name))
  if (requestedName && !Object.prototype.hasOwnProperty.call(payload.collections, requestedName)) return false

  let applied = false
  for (const name of names) {
    if (isOlderRevision(payload.revision, collectionsResourceState.revisions[name] ?? null)) continue
    collectionsResourceState.values[name] = cloneJsonValue(payload.collections[name]) as never
    collectionsResourceState.revisions[name] = payload.revision
    collectionsResourceState.statuses[name] = 'ready'
    delete collectionsResourceState.errors[name]
    applied = true
  }

  if (!requestedName && !isOlderRevision(payload.revision, collectionsResourceState.fullRevision)) {
    collectionsResourceState.fullRevision = payload.revision
    collectionsResourceState.status = 'ready'
    collectionsResourceState.error = null
  }
  if (applied) {
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    markResourceDatabaseChanged()
  }
  return applied
}

export function beginCharactersResourceLoad(characterId?: string): void {
  if (characterId) {
    charactersResourceState.rowStatuses[characterId] = 'loading'
    delete charactersResourceState.rowErrors[characterId]
    return
  }
  charactersResourceState.status = 'loading'
  charactersResourceState.error = null
}

export function failCharactersResourceLoad(error: string, characterId?: string): void {
  if (characterId) {
    charactersResourceState.rowStatuses[characterId] = 'error'
    charactersResourceState.rowErrors[characterId] = error
    return
  }
  charactersResourceState.status = 'error'
  charactersResourceState.error = error
}

export function applyCharactersResource(
  payload: ServerCharactersResourcePayload,
  options: { preserveResidentChatBodies?: boolean } = {},
): boolean {
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false
  if (Object.values(charactersResourceState.rowRevisions).some((revision) => revision > payload.revision)) return false

  const preserveResidentChatBodies = options.preserveResidentChatBodies ?? true
  const existingById = preserveResidentChatBodies
    ? new Map(
        charactersResourceState.characters
          .filter((candidate) => nonEmptyString(candidate?.chaId))
          .map((candidate) => [candidate.chaId, candidate]),
      )
    : null
  charactersResourceState.characters = payload.characters.map((candidate) => {
    const nextCharacter = cloneJsonValue(candidate)
    return existingById
      ? preserveResidentCharacterChatBodies(nextCharacter, existingById.get(candidate.chaId))
      : nextCharacter
  })
  charactersResourceState.characterOrder = cloneJsonValue(payload.characterOrder)
  charactersResourceState.currentChar = payload.currentChar
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  charactersResourceState.listRevision = payload.revision
  charactersResourceState.rowRevisions = Object.fromEntries(
    payload.characters
      .filter((candidate) => nonEmptyString(candidate?.chaId))
      .map((candidate) => [candidate.chaId, payload.revision]),
  )
  charactersResourceState.rowStatuses = Object.fromEntries(
    payload.characters
      .filter((candidate) => nonEmptyString(candidate?.chaId))
      .map((candidate) => [candidate.chaId, 'ready']),
  )
  charactersResourceState.rowErrors = {}
  charactersResourceState.status = 'ready'
  charactersResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

export function applyCharacterResource(payload: ServerCharacterResourcePayload): boolean {
  const characterId = payload.character?.chaId
  if (!nonEmptyString(characterId)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.rowRevisions[characterId] ?? null)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false

  const index = charactersResourceState.characters.findIndex((candidate) => candidate?.chaId === characterId)
  const nextCharacter = preserveResidentCharacterChatBodies(
    cloneJsonValue(payload.character),
    index >= 0 ? charactersResourceState.characters[index] : undefined,
  )
  if (index >= 0) {
    charactersResourceState.characters[index] = nextCharacter
  } else {
    charactersResourceState.characters.push(nextCharacter)
  }
  charactersResourceState.rowRevisions[characterId] = payload.revision
  charactersResourceState.rowStatuses[characterId] = 'ready'
  delete charactersResourceState.rowErrors[characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

export function resetServerResourceState(): void {
  settingsResourceState.value = {}
  settingsResourceState.revision = null
  settingsResourceState.status = 'idle'
  settingsResourceState.error = null

  collectionsResourceState.values = {}
  collectionsResourceState.revision = null
  collectionsResourceState.fullRevision = null
  collectionsResourceState.revisions = {}
  collectionsResourceState.status = 'idle'
  collectionsResourceState.statuses = {}
  collectionsResourceState.error = null
  collectionsResourceState.errors = {}

  charactersResourceState.characters = []
  charactersResourceState.characterOrder = []
  charactersResourceState.currentChar = -1
  charactersResourceState.revision = null
  charactersResourceState.listRevision = null
  charactersResourceState.rowRevisions = {}
  charactersResourceState.status = 'idle'
  charactersResourceState.rowStatuses = {}
  charactersResourceState.error = null
  charactersResourceState.rowErrors = {}
  markResourceDatabaseChanged()
}

export function replaceResourceDatabase(database: Database, revision?: number): void {
  const nextRevision = normalizeOptionalRevision(revision)
  const databaseRecord = cloneJsonValue(database) as unknown as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(databaseRecord)) {
    if (key === 'characters' || isServerCollectionName(key)) continue
    settings[key] = value
  }

  settingsResourceState.value = settings as ServerSettingsValues
  settingsResourceState.revision = nextRevision
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null

  const collections: Partial<ServerCollectionValues> = {}
  const collectionStatuses: Partial<Record<ServerCollectionName, ServerResourceStatus>> = {}
  const collectionRevisions: Partial<Record<ServerCollectionName, number>> = {}
  for (const name of SERVER_COLLECTION_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(databaseRecord, name)) continue
    collections[name] = databaseRecord[name] as never
    collectionStatuses[name] = 'ready'
    if (nextRevision !== null) collectionRevisions[name] = nextRevision
  }
  collectionsResourceState.values = collections
  collectionsResourceState.revision = nextRevision
  collectionsResourceState.fullRevision = nextRevision
  collectionsResourceState.revisions = collectionRevisions
  collectionsResourceState.status = 'ready'
  collectionsResourceState.statuses = collectionStatuses
  collectionsResourceState.error = null
  collectionsResourceState.errors = {}

  const characters = Array.isArray(databaseRecord.characters)
    ? (databaseRecord.characters as unknown as character[])
    : []
  charactersResourceState.characters = characters
  charactersResourceState.characterOrder = Array.isArray(databaseRecord.characterOrder)
    ? (databaseRecord.characterOrder as Database['characterOrder'])
    : []
  charactersResourceState.currentChar = Number.isInteger(databaseRecord.currentChar)
    ? (databaseRecord.currentChar as number)
    : -1
  charactersResourceState.revision = nextRevision
  charactersResourceState.listRevision = nextRevision
  charactersResourceState.rowRevisions =
    nextRevision === null
      ? {}
      : Object.fromEntries(
          characters
            .filter((candidate) => nonEmptyString(candidate?.chaId))
            .map((candidate) => [candidate.chaId, nextRevision]),
        )
  charactersResourceState.status = 'ready'
  charactersResourceState.rowStatuses = Object.fromEntries(
    characters.filter((candidate) => nonEmptyString(candidate?.chaId)).map((candidate) => [candidate.chaId, 'ready']),
  )
  charactersResourceState.error = null
  charactersResourceState.rowErrors = {}
  markResourceDatabaseChanged()
}

export function areServerDatabaseResourcesReady(): boolean {
  return (
    settingsResourceState.status === 'ready' &&
    collectionsResourceState.status === 'ready' &&
    charactersResourceState.status === 'ready'
  )
}

export function composeResourceDatabaseSnapshot(): Database {
  return cloneJsonValue(composeResourceDatabaseRecord()) as unknown as Database
}

export function getResourceDatabase(options: { snapshot?: boolean } = {}): Database {
  // A consumer that only retains the deprecated whole-database facade still
  // tracks resource-backed writes without requiring a new proxy identity.
  void resourceDatabaseFacadeEpoch
  return options.snapshot ? composeResourceDatabaseSnapshot() : resourceDatabaseCompatibilityProxy
}

export function withResourceDatabaseWrite<T>(callback: (database: Database) => T): T {
  const outermost = resourceDatabaseWriteDepth === 0
  if (outermost) resourceDatabaseWriteChanged = false
  resourceDatabaseWriteDepth += 1
  let finished = false
  const finish = () => {
    if (finished) return
    resourceDatabaseWriteDepth -= 1
    if (resourceDatabaseWriteDepth === 0 && resourceDatabaseWriteChanged) {
      resourceDatabaseFacadeEpoch += 1
      resourceDatabaseWriteChanged = false
    }
    finished = true
  }
  try {
    const result = callback(resourceDatabaseCompatibilityProxy)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(finish) as T
    }
    finish()
    return result
  } catch (error) {
    finish()
    throw error
  }
}

export const resourceDatabaseCompatibilityProxy = new Proxy({} as Database, {
  get(_target, property) {
    if (property === Symbol.toStringTag) return 'ResourceDatabase'
    if (property === 'toJSON') return composeResourceDatabaseSnapshot
    if (typeof property !== 'string') return undefined
    return guardResourceDatabaseValue(resourceDatabaseField(property))
  },
  has(_target, property) {
    return typeof property === 'string' && resourceDatabaseKeys().includes(property)
  },
  ownKeys() {
    return resourceDatabaseKeys()
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property !== 'string' || !resourceDatabaseKeys().includes(property)) return undefined
    return {
      configurable: true,
      enumerable: true,
      value: guardResourceDatabaseValue(resourceDatabaseField(property)),
      writable: true,
    }
  },
  set(_target, property, value) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string') return false
    setResourceDatabaseField(property, value)
    markResourceDatabaseChanged()
    return true
  },
  deleteProperty(_target, property) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string') return false
    deleteResourceDatabaseField(property)
    markResourceDatabaseChanged()
    return true
  },
  defineProperty(_target, property, descriptor) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false
    setResourceDatabaseField(property, descriptor.value)
    markResourceDatabaseChanged()
    return true
  },
})

function composeResourceDatabaseRecord(): Record<string, unknown> {
  const record: Record<string, unknown> = {
    ...(settingsResourceState.value as Record<string, unknown>),
    ...(collectionsResourceState.values as Record<string, unknown>),
    characters: charactersResourceState.characters,
  }
  if (shouldUseCharacterPointerResource()) {
    record.characterOrder = charactersResourceState.characterOrder
    record.currentChar = charactersResourceState.currentChar
  }
  return record
}

function resourceDatabaseField(property: string): unknown {
  if (property === 'characters') return charactersResourceState.characters
  if (property === 'characterOrder' || property === 'currentChar') {
    if (shouldUseCharacterPointerResource()) {
      return property === 'characterOrder'
        ? charactersResourceState.characterOrder
        : charactersResourceState.currentChar
    }
  }
  if (isServerCollectionName(property)) {
    return collectionsResourceState.values[property]
  }
  return (settingsResourceState.value as Record<string, unknown>)[property]
}

function resourceDatabaseKeys(): string[] {
  const keys = new Set<string>([
    ...Object.keys(settingsResourceState.value),
    ...Object.keys(collectionsResourceState.values),
    'characters',
  ])
  if (shouldUseCharacterPointerResource()) {
    keys.add('characterOrder')
    keys.add('currentChar')
  }
  return Array.from(keys)
}

function setResourceDatabaseField(property: string, value: unknown): void {
  if (property === 'characters') {
    charactersResourceState.characters = value as character[]
    charactersResourceState.status = 'ready'
    return
  }
  if (isServerCollectionName(property)) {
    collectionsResourceState.values[property] = value as never
    collectionsResourceState.statuses[property] = 'ready'
    return
  }
  ;(settingsResourceState.value as Record<string, unknown>)[property] = value
  settingsResourceState.status = 'ready'
  mirrorCharacterPointerField(property, value)
}

function deleteResourceDatabaseField(property: string): void {
  if (property === 'characters') {
    charactersResourceState.characters = []
    charactersResourceState.rowRevisions = {}
    charactersResourceState.rowStatuses = {}
    charactersResourceState.rowErrors = {}
    return
  }
  if (isServerCollectionName(property)) {
    delete collectionsResourceState.values[property]
    delete collectionsResourceState.revisions[property]
    delete collectionsResourceState.statuses[property]
    delete collectionsResourceState.errors[property]
    return
  }
  delete (settingsResourceState.value as Record<string, unknown>)[property]
  if (property === 'characterOrder') charactersResourceState.characterOrder = []
  if (property === 'currentChar') charactersResourceState.currentChar = -1
}

function mirrorCharacterPointerField(property: string, value: unknown): void {
  if (property === 'characterOrder' && Array.isArray(value)) {
    charactersResourceState.characterOrder = value as Database['characterOrder']
  }
  if (property === 'currentChar' && Number.isInteger(value)) {
    charactersResourceState.currentChar = value as number
  }
}

function guardResourceDatabaseValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const existing = guardedResourceValueMemo.get(value)
  if (existing) return existing as T

  const guarded = new Proxy(value as object, {
    get(target, property, receiver) {
      return guardResourceDatabaseValue(Reflect.get(target, property, receiver))
    },
    set(target, property, nextValue, receiver) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.set(target, property, nextValue, receiver)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
    deleteProperty(target, property) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.deleteProperty(target, property)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
    defineProperty(target, property, descriptor) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.defineProperty(target, property, descriptor)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
  })
  guardedResourceValueMemo.set(value, guarded)
  return guarded as T
}

function assertResourceDatabaseWriteAllowed(): void {
  if (resourceDatabaseWriteGuardEnabled && resourceDatabaseWriteDepth === 0) {
    throw new TypeError('The resource database compatibility view is read-only outside withResourceDatabaseWrite')
  }
}

function markResourceDatabaseChanged(): void {
  if (resourceDatabaseWriteDepth > 0) {
    resourceDatabaseWriteChanged = true
    return
  }
  resourceDatabaseFacadeEpoch += 1
}

function preserveResidentCharacterChatBodies(incoming: character, existing: character | undefined): character {
  if (!existing || !Array.isArray(incoming.chats) || !Array.isArray(existing.chats)) return incoming
  const existingChatsById = new Map(
    existing.chats.filter((chat) => nonEmptyString(chat?.id)).map((chat) => [chat.id, chat]),
  )
  for (const chat of incoming.chats) {
    if (!nonEmptyString(chat?.id)) continue
    const resident = existingChatsById.get(chat.id)
    if (!resident) continue
    if (Array.isArray(resident.message)) chat.message = resident.message
    if (Object.prototype.hasOwnProperty.call(resident, 'hypaV3Data')) {
      chat.hypaV3Data = resident.hypaV3Data
    }
  }
  return incoming
}

function shouldUseCharacterPointerResource(): boolean {
  if (charactersResourceState.listRevision === null) return false
  return (
    settingsResourceState.revision === null || charactersResourceState.listRevision >= settingsResourceState.revision
  )
}

function isOlderRevision(revision: number, current: number | null): boolean {
  return current !== null && revision < current
}

function maxRevision(current: number | null, next: number): number {
  return current === null ? next : Math.max(current, next)
}

function normalizeOptionalRevision(revision: number | undefined): number | null {
  if (revision === undefined) return null
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError('Resource database revision must be a non-negative integer')
  }
  return revision
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
