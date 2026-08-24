export const SERVER_CHARACTER_SUMMARY_VERSION = 1 as const
export const SERVER_CHARACTER_SHELL_MARKER = '__serverCharacterShell' as const

export const SERVER_CHARACTER_PINNED_CHAT_SUMMARY_KEYS = ['id', 'name'] as const

export const SERVER_CHARACTER_SUMMARY_KEYS = [
  SERVER_CHARACTER_SHELL_MARKER,
  'chaId',
  'type',
  'name',
  'displayName',
  'image',
  'creatorNotes',
  'trashTime',
  'creation_date',
  'modification_date',
  'lastInteraction',
  'chatCount',
  'activeChatId',
  'chatIds',
  'pinnedChats',
] as const

export const SERVER_CHARACTERS_SUMMARY_PAYLOAD_KEYS = [
  'version',
  'revision',
  'characters',
  'characterOrder',
  'currentChar',
] as const

export interface ServerCharacterPinnedChatSummary {
  id: string
  name: string
}

/**
 * Exact list-safe character projection. Nullable fields are emitted as null so
 * the wire shape and cache hash cannot drift with incidental serializer changes.
 */
export interface ServerCharacterSummary {
  [SERVER_CHARACTER_SHELL_MARKER]: true
  chaId: string
  type: 'character'
  name: string
  displayName: string
  image: string
  creatorNotes: string
  trashTime: number | null
  creation_date: number | null
  modification_date: number | null
  lastInteraction: number | null
  chatCount: number
  activeChatId: string | null
  chatIds: string[]
  pinnedChats: ServerCharacterPinnedChatSummary[]
}

export interface ServerCharactersSummaryPayload {
  version: typeof SERVER_CHARACTER_SUMMARY_VERSION
  revision: number
  characters: ServerCharacterSummary[]
  characterOrder: unknown[]
  currentChar: number
}

export function isServerCharacterSummary(value: unknown): value is ServerCharacterSummary {
  if (!isPlainRecord(value) || !hasExactKeys(value, SERVER_CHARACTER_SUMMARY_KEYS)) return false
  if (value[SERVER_CHARACTER_SHELL_MARKER] !== true) return false
  if (!nonEmptyString(value.chaId) || value.type !== 'character' || typeof value.name !== 'string') return false
  if (typeof value.displayName !== 'string' || typeof value.image !== 'string') return false
  if (typeof value.creatorNotes !== 'string') return false
  if (!nullableFiniteNumber(value.trashTime)) return false
  if (!nullableFiniteNumber(value.creation_date) || !nullableFiniteNumber(value.modification_date)) return false
  if (!nullableFiniteNumber(value.lastInteraction)) return false
  const chatIds = value.chatIds
  if (!nonNegativeInteger(value.chatCount) || !isUniqueStringArray(chatIds)) return false
  if (value.chatCount !== chatIds.length) return false
  if (value.activeChatId !== null && (!nonEmptyString(value.activeChatId) || !chatIds.includes(value.activeChatId))) {
    return false
  }
  if (!Array.isArray(value.pinnedChats) || !value.pinnedChats.every(isServerCharacterPinnedChatSummary)) return false

  const pinnedChatIds = value.pinnedChats.map((chat) => chat.id)
  return new Set(pinnedChatIds).size === pinnedChatIds.length && pinnedChatIds.every((id) => chatIds.includes(id))
}

export function isServerCharactersSummaryPayload(value: unknown): value is ServerCharactersSummaryPayload {
  if (!isPlainRecord(value) || !hasExactKeys(value, SERVER_CHARACTERS_SUMMARY_PAYLOAD_KEYS)) return false
  if (value.version !== SERVER_CHARACTER_SUMMARY_VERSION || !nonNegativeInteger(value.revision)) return false
  if (!Array.isArray(value.characters) || !value.characters.every(isServerCharacterSummary)) return false
  const currentChar = value.currentChar
  if (!Array.isArray(value.characterOrder) || !integer(currentChar)) return false
  if (currentChar < -1 || currentChar >= value.characters.length) return false
  if (value.characters.length === 0 && currentChar !== -1) return false

  const characterIds = value.characters.map((character) => character.chaId)
  return new Set(characterIds).size === characterIds.length
}

function isServerCharacterPinnedChatSummary(value: unknown): value is ServerCharacterPinnedChatSummary {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, SERVER_CHARACTER_PINNED_CHAT_SUMMARY_KEYS) &&
    nonEmptyString(value.id) &&
    typeof value.name === 'string'
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length
}
