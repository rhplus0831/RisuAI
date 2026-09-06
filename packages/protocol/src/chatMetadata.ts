import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/** Version of the chat-list metadata projection; transcript bodies are excluded. */
export const SERVER_CHAT_METADATA_RESOURCE_VERSION = 1 as const

const ChatMetadataSchema = Type.Intersect([
  Type.Object({ id: Type.String(), name: Type.String() }),
  Type.Record(Type.String(), Type.Unknown()),
])

const ChatFolderMetadataSchema = Type.Intersect([
  Type.Object({ id: Type.String() }),
  Type.Record(Type.String(), Type.Unknown()),
])

const CharacterChatMetadataSchema = Type.Intersect([
  Type.Object({ chaId: Type.String() }),
  Type.Record(Type.String(), Type.Unknown()),
])

export const ServerChatMetadataResourceSchema = Type.Object(
  { revision: Type.Integer({ minimum: 0 }), character: CharacterChatMetadataSchema },
  { additionalProperties: false },
)

export type ServerChatMetadata = Static<typeof ChatMetadataSchema>
export type ServerChatFolderMetadata = Static<typeof ChatFolderMetadataSchema>
export type ServerCharacterChatMetadata = Static<typeof CharacterChatMetadataSchema>
export type ServerChatMetadataResource = Static<typeof ServerChatMetadataResourceSchema>

const TRANSCRIPT_FIELDS = new Set(['hypaV3Data', 'alternatives', 'alternateMessages'])

export function isServerChatMetadataResource(value: unknown): value is ServerChatMetadataResource {
  if (!Value.Check(ServerChatMetadataResourceSchema, value) || value.character.chaId.trim() === '') return false
  const character = value.character
  if (character.chats !== undefined) {
    if (!Array.isArray(character.chats) || !validChatRows(character.chats)) return false
  }
  if (character.chatFolders !== undefined) {
    if (!Array.isArray(character.chatFolders) || !validFolderRows(character.chatFolders)) return false
  }
  return true
}

function validChatRows(rows: unknown[]): rows is ServerChatMetadata[] {
  const ids = new Set<string>()
  return rows.every((row) => {
    if (!Value.Check(ChatMetadataSchema, row) || row.id.trim() === '' || ids.has(row.id)) return false
    if ([...TRANSCRIPT_FIELDS].some((field) => Object.prototype.hasOwnProperty.call(row, field))) return false
    if (
      Object.prototype.hasOwnProperty.call(row, 'message') &&
      (!Array.isArray(row.message) || row.message.length > 0)
    ) {
      return false
    }
    ids.add(row.id)
    return (
      row.folderId === undefined || row.folderId === null || (typeof row.folderId === 'string' && row.folderId !== '')
    )
  })
}

function validFolderRows(rows: unknown[]): rows is ServerChatFolderMetadata[] {
  const ids = new Set<string>()
  return rows.every((row) => {
    if (!Value.Check(ChatFolderMetadataSchema, row) || row.id.trim() === '' || ids.has(row.id)) return false
    ids.add(row.id)
    return true
  })
}
