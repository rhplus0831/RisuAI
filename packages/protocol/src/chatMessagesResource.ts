import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const SERVER_CHAT_MESSAGES_RESOURCE_VERSION = 1 as const

const ChatMessagesFields = {
  revision: Type.Integer({ minimum: 0 }),
  chatId: Type.Optional(Type.String()),
  message: Type.Array(Type.Unknown()),
  hypaV3Data: Type.Optional(Type.Unknown()),
  alternates: Type.Optional(Type.Array(Type.Unknown())),
  messageStart: Type.Optional(Type.Integer({ minimum: 0 })),
  messageTotal: Type.Optional(Type.Integer({ minimum: 0 })),
} as const

export const ServerChatMessagesResourceSchema = Type.Object(ChatMessagesFields, { additionalProperties: false })
export const ServerBulkChatMessagesEntrySchema = Type.Object(
  {
    chatId: Type.String(),
    message: Type.Array(Type.Unknown()),
    hypaV3Data: Type.Optional(Type.Unknown()),
    alternates: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: false },
)
export const ServerBulkChatMessagesResourceSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    chats: Type.Array(ServerBulkChatMessagesEntrySchema),
    missing: Type.Array(Type.Unknown()),
  },
  { additionalProperties: false },
)

export type ServerChatMessagesResource = Static<typeof ServerChatMessagesResourceSchema>
export type ServerBulkChatMessagesEntry = Static<typeof ServerBulkChatMessagesEntrySchema>
export type ServerBulkChatMessagesResource = Static<typeof ServerBulkChatMessagesResourceSchema>

export function isServerChatMessagesResource(value: unknown): value is ServerChatMessagesResource {
  if (!Value.Check(ServerChatMessagesResourceSchema, value)) return false
  if (value.chatId !== undefined && value.chatId.trim() === '') return false
  if (value.messageStart !== undefined && value.messageTotal !== undefined && value.messageStart > value.messageTotal) {
    return false
  }
  return true
}

export function isServerBulkChatMessagesResource(value: unknown): value is ServerBulkChatMessagesResource {
  if (!Value.Check(ServerBulkChatMessagesResourceSchema, value)) return false
  const ids = new Set<string>()
  return (
    value.chats.every((chat) => chat.chatId.trim() !== '' && !ids.has(chat.chatId) && ids.add(chat.chatId)) &&
    value.missing.every((id) => typeof id !== 'string' || id.trim() !== '')
  )
}
