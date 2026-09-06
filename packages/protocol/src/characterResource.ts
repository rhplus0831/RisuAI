import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/** Version of the targeted character read contracts; wire shapes are unchanged. */
export const SERVER_CHARACTER_RESOURCE_VERSION = 1 as const

const CharacterDetailSchema = Type.Intersect([
  Type.Object({ chaId: Type.String() }),
  Type.Record(Type.String(), Type.Unknown()),
])

export const ServerCharacterDetailResourceSchema = Type.Object(
  { revision: Type.Integer({ minimum: 0 }), character: CharacterDetailSchema },
  { additionalProperties: false },
)

export const ServerCharacterOrderFolderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String(),
    data: Type.Array(Type.String()),
    color: Type.String(),
    askBeforeOpening: Type.Optional(Type.Boolean()),
    imgFile: Type.Optional(Type.String()),
    img: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

export const ServerCharacterOrderResourceSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    characterOrder: Type.Array(Type.Union([Type.String(), ServerCharacterOrderFolderSchema])),
  },
  { additionalProperties: false },
)

export const ServerCharacterSelectionResourceSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    characterId: Type.String(),
    currentChar: Type.Integer({ minimum: 0 }),
    lastInteraction: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
)

export type ServerCharacterDetailResource = Static<typeof ServerCharacterDetailResourceSchema>
export type ServerCharacterOrderResource = Static<typeof ServerCharacterOrderResourceSchema>
export type ServerCharacterSelectionResource = Static<typeof ServerCharacterSelectionResourceSchema>

export function isServerCharacterDetailResource(value: unknown): value is ServerCharacterDetailResource {
  return Value.Check(ServerCharacterDetailResourceSchema, value) && value.character.chaId.trim() !== ''
}

export function isServerCharacterOrderResource(value: unknown): value is ServerCharacterOrderResource {
  return Value.Check(ServerCharacterOrderResourceSchema, value)
}

export function isServerCharacterSelectionResource(value: unknown): value is ServerCharacterSelectionResource {
  return (
    Value.Check(ServerCharacterSelectionResourceSchema, value) &&
    value.characterId.trim() !== '' &&
    (value.lastInteraction === undefined || Number.isFinite(value.lastInteraction))
  )
}
