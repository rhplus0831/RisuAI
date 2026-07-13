import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { SERVER_SETTINGS_KEYS_BY_GROUP, isSettingsGroup, type SettingsGroup } from './settingsGroups'
import {
  SERVER_COLLECTION_NAMES,
  isServerCollectionName,
  type ServerCharacterResourcePayload,
  type ServerCharacterOrderResourcePayload,
  type ServerCharacterSelectionResourcePayload,
  type ServerCharactersResourcePayload,
  type ServerCollectionName,
  type ServerCollectionsResourcePayload,
  type ServerCollectionValues,
  type ServerSettingsResourcePayload,
  type ServerSettingsGroupResourcePayload,
  type ServerSettingsValues,
} from './resourceState.svelte'

const SETTINGS_ENDPOINT = '/api/v1/settings'
const COLLECTIONS_ENDPOINT = '/api/v1/collections'
const CHARACTERS_ENDPOINT = '/api/v1/characters'
const CHARACTER_ORDER_ENDPOINT = `${CHARACTERS_ENDPOINT}/order`

export type ServerResourceReadResult<T extends { revision: number }> =
  | ({ status: 'ok' } & T)
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerResourceReads(): boolean {
  return true
}

export async function fetchServerSettings(
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerSettingsResourcePayload>> {
  const result = await requestServerResourceJson(SETTINGS_ENDPOINT, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (!record || !isPlainRecord(record.settings)) {
    return { status: 'error', error: 'Invalid settings response' }
  }
  if (containsNonSettingResource(record.settings)) {
    return { status: 'error', error: 'Settings response contained non-setting resources' }
  }
  return {
    status: 'ok',
    revision: record.revision,
    settings: record.settings as ServerSettingsValues,
  }
}

export async function fetchServerSettingsGroup(
  group: SettingsGroup,
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerSettingsGroupResourcePayload>> {
  if (!isSettingsGroup(group)) return { status: 'error', error: 'Unknown settings group' }
  const result = await requestServerResourceJson(`${SETTINGS_ENDPOINT}/${encodeURIComponent(group)}`, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (!record || record.group !== group || !isPlainRecord(record.settings)) {
    return { status: 'error', error: 'Invalid settings group response' }
  }
  if (
    containsNonSettingResource(record.settings) ||
    Object.keys(record.settings).some(
      (key) => key === 'hypaV3Presets' || !SERVER_SETTINGS_KEYS_BY_GROUP[group].includes(key),
    )
  ) {
    return { status: 'error', error: `Invalid ${group} settings response` }
  }
  return {
    status: 'ok',
    revision: record.revision,
    group,
    settings: record.settings as ServerSettingsValues,
  }
}

export async function fetchServerCollections(
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCollectionsResourcePayload>> {
  return fetchServerCollectionsFromEndpoint(COLLECTIONS_ENDPOINT, undefined, signal)
}

export async function fetchServerCollection(
  name: ServerCollectionName,
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCollectionsResourcePayload>> {
  return fetchServerCollectionsFromEndpoint(`${COLLECTIONS_ENDPOINT}/${encodeURIComponent(name)}`, name, signal)
}

export async function fetchServerCharacters(
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCharactersResourcePayload>> {
  const result = await requestServerResourceJson(CHARACTERS_ENDPOINT, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (
    !record ||
    !Array.isArray(record.characters) ||
    !record.characters.every(isMessageFreeCharacter) ||
    !Array.isArray(record.characterOrder) ||
    !Number.isInteger(record.currentChar)
  ) {
    return { status: 'error', error: 'Invalid characters response' }
  }
  return {
    status: 'ok',
    revision: record.revision,
    characters: record.characters as unknown as ServerCharactersResourcePayload['characters'],
    characterOrder: record.characterOrder as ServerCharactersResourcePayload['characterOrder'],
    currentChar: record.currentChar as number,
  }
}

export async function fetchServerCharacter(
  characterId: string,
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCharacterResourcePayload>> {
  if (!nonEmptyString(characterId)) {
    return { status: 'error', error: 'Character id is required' }
  }
  const result = await requestServerResourceJson(`${CHARACTERS_ENDPOINT}/${encodeURIComponent(characterId)}`, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (!record || !isMessageFreeCharacter(record.character) || record.character.chaId !== characterId) {
    return { status: 'error', error: 'Invalid character response' }
  }
  return {
    status: 'ok',
    revision: record.revision,
    character: record.character as unknown as ServerCharacterResourcePayload['character'],
  }
}

export async function fetchServerCharacterOrder(
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCharacterOrderResourcePayload>> {
  const result = await requestServerResourceJson(CHARACTER_ORDER_ENDPOINT, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (!record || !Array.isArray(record.characterOrder)) {
    return { status: 'error', error: 'Invalid character order response' }
  }
  return {
    status: 'ok',
    revision: record.revision,
    characterOrder: record.characterOrder as ServerCharacterOrderResourcePayload['characterOrder'],
  }
}

export async function fetchServerCharacterSelection(
  characterId: string,
  signal?: AbortSignal | null,
): Promise<ServerResourceReadResult<ServerCharacterSelectionResourcePayload>> {
  if (!nonEmptyString(characterId)) {
    return { status: 'error', error: 'Character id is required' }
  }
  const result = await requestServerResourceJson(
    `${CHARACTERS_ENDPOINT}/${encodeURIComponent(characterId)}/selection`,
    signal,
  )
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (
    !record ||
    record.characterId !== characterId ||
    !Number.isInteger(record.currentChar) ||
    (record.currentChar as number) < 0 ||
    (record.lastInteraction !== undefined &&
      (typeof record.lastInteraction !== 'number' || !Number.isFinite(record.lastInteraction)))
  ) {
    return { status: 'error', error: 'Invalid character selection response' }
  }
  return {
    status: 'ok',
    revision: record.revision,
    characterId,
    currentChar: record.currentChar as number,
    ...(typeof record.lastInteraction === 'number' ? { lastInteraction: record.lastInteraction } : {}),
  }
}

async function fetchServerCollectionsFromEndpoint(
  endpoint: string,
  requestedName: ServerCollectionName | undefined,
  signal: AbortSignal | null | undefined,
): Promise<ServerResourceReadResult<ServerCollectionsResourcePayload>> {
  const result = await requestServerResourceJson(endpoint, signal)
  if (result.status !== 'ok') return result

  const record = readRevisionEnvelope(result.body)
  if (!record || !isPlainRecord(record.collections)) {
    return { status: 'error', error: 'Invalid collections response' }
  }
  const names = Object.keys(record.collections)
  if (
    names.some((name) => !isServerCollectionName(name)) ||
    (requestedName ? names.length !== 1 || names[0] !== requestedName : !hasEveryServerCollection(names))
  ) {
    return { status: 'error', error: 'Invalid collections response' }
  }

  const collections: Partial<ServerCollectionValues> = {}
  for (const name of names) {
    if (!isServerCollectionName(name)) continue
    const value = record.collections[name]
    if (!isValidCollectionValue(name, value)) {
      return { status: 'error', error: `Invalid ${name} collection response` }
    }
    collections[name] = value as never
  }
  return {
    status: 'ok',
    revision: record.revision,
    collections,
  }
}

async function requestServerResourceJson(
  endpoint: string,
  signal?: AbortSignal | null,
): Promise<{ status: 'ok'; body: unknown } | { status: 'error'; error: string } | { status: 'unavailable' }> {
  if (!canUseServerResourceReads()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      signal: signal ?? undefined,
      headers: { 'risu-auth': auth },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // HTTP handling below reports non-JSON failures. Successful non-JSON
    // responses fail the resource-specific envelope validation.
  }
  if (!response.ok) {
    return { status: 'error', error: errorMessageFromBody(body, `HTTP ${response.status}`) }
  }
  return { status: 'ok', body }
}

function readRevisionEnvelope(body: unknown): (Record<string, unknown> & { revision: number }) | null {
  if (!isPlainRecord(body) || !Number.isInteger(body.revision) || (body.revision as number) < 0) return null
  return body as Record<string, unknown> & { revision: number }
}

function containsNonSettingResource(settings: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(settings, 'characters')) return true
  return SERVER_COLLECTION_NAMES.some((name) => Object.prototype.hasOwnProperty.call(settings, name))
}

function hasEveryServerCollection(names: readonly string[]): boolean {
  return (
    names.length === SERVER_COLLECTION_NAMES.length && SERVER_COLLECTION_NAMES.every((name) => names.includes(name))
  )
}

function isValidCollectionValue(name: ServerCollectionName, value: unknown): boolean {
  return name === 'pluginCustomStorage' ? isPlainRecord(value) : Array.isArray(value)
}

function isMessageFreeCharacter(value: unknown): value is Record<string, unknown> & { chaId: string } {
  if (!isPlainRecord(value) || !nonEmptyString(value.chaId)) return false
  if (value.chats === undefined) return true
  if (!Array.isArray(value.chats)) return false
  return value.chats.every((chat) => {
    if (!isPlainRecord(chat)) return false
    return chat.message === undefined || (Array.isArray(chat.message) && chat.message.length === 0)
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (isPlainRecord(body)) {
    if (typeof body.reason === 'string' && body.reason.trim() !== '') return body.reason
    if (typeof body.error === 'string' && body.error.trim() !== '') return body.error
  }
  return fallback
}
