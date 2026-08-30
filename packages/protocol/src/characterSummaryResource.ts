import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

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

const NullableNumberSchema = Type.Union([Type.Number(), Type.Null()])
const NullableStringSchema = Type.Union([Type.String(), Type.Null()])

export const ServerCharacterPinnedChatSummarySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
  },
  { additionalProperties: false },
)

export const ServerCharacterSummarySchema = Type.Object(
  {
    [SERVER_CHARACTER_SHELL_MARKER]: Type.Literal(true),
    chaId: Type.String(),
    type: Type.Literal('character'),
    name: Type.String(),
    displayName: Type.String(),
    image: Type.String(),
    creatorNotes: Type.String(),
    trashTime: NullableNumberSchema,
    creation_date: NullableNumberSchema,
    modification_date: NullableNumberSchema,
    lastInteraction: NullableNumberSchema,
    chatCount: Type.Integer({ minimum: 0 }),
    activeChatId: NullableStringSchema,
    chatIds: Type.Array(Type.String()),
    pinnedChats: Type.Array(ServerCharacterPinnedChatSummarySchema),
  },
  { additionalProperties: false },
)

export const ServerCharactersSummaryPayloadSchema = Type.Object(
  {
    version: Type.Literal(SERVER_CHARACTER_SUMMARY_VERSION),
    revision: Type.Integer({ minimum: 0 }),
    characters: Type.Array(ServerCharacterSummarySchema),
    characterOrder: Type.Array(Type.Unknown()),
    currentChar: Type.Integer({ minimum: -1 }),
  },
  { additionalProperties: false },
)

export type ServerCharacterPinnedChatSummary = Static<typeof ServerCharacterPinnedChatSummarySchema>
export type ServerCharacterSummary = Static<typeof ServerCharacterSummarySchema>
export type ServerCharactersSummaryPayload = Static<typeof ServerCharactersSummaryPayloadSchema>

export function isServerCharacterSummary(value: unknown): value is ServerCharacterSummary {
  if (!Value.Check(ServerCharacterSummarySchema, value)) return false
  if (!nonEmptyString(value.chaId)) return false
  if (!isUniqueNonEmptyStringArray(value.chatIds)) return false
  if (value.chatCount !== value.chatIds.length) return false
  if (
    value.activeChatId !== null &&
    (!nonEmptyString(value.activeChatId) || !value.chatIds.includes(value.activeChatId))
  ) {
    return false
  }

  const pinnedChatIds = value.pinnedChats.map((chat) => chat.id)
  return (
    value.pinnedChats.every((chat) => nonEmptyString(chat.id)) &&
    new Set(pinnedChatIds).size === pinnedChatIds.length &&
    pinnedChatIds.every((id) => value.chatIds.includes(id))
  )
}

export function isServerCharactersSummaryPayload(value: unknown): value is ServerCharactersSummaryPayload {
  if (!Value.Check(ServerCharactersSummaryPayloadSchema, value)) return false
  if (!value.characters.every(isServerCharacterSummary)) return false
  if (value.currentChar >= value.characters.length) return false
  if (value.characters.length === 0 && value.currentChar !== -1) return false

  const characterIds = value.characters.map((character) => character.chaId)
  return new Set(characterIds).size === characterIds.length
}

function nonEmptyString(value: string): boolean {
  return value.trim() !== ''
}

function isUniqueNonEmptyStringArray(value: string[]): boolean {
  return value.every(nonEmptyString) && new Set(value).size === value.length
}
