import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const LoreTokenCountsSchema = Type.Object({
  characterId: Type.String(),
  chatId: Type.String(),
  character: Type.Integer({ minimum: 0 }),
  module: Type.Integer({ minimum: 0 }),
  chat: Type.Integer({ minimum: 0 }),
  hasRandomActivation: Type.Boolean(),
})

export const LoreTokenCountsErrorSchema = Type.Object({ error: Type.String() }, { additionalProperties: true })

export type LoreTokenCounts = Static<typeof LoreTokenCountsSchema>

export function isLoreTokenCounts(value: unknown): value is LoreTokenCounts {
  return Value.Check(LoreTokenCountsSchema, value)
}
