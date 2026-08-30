import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const SERVER_STANDALONE_SETTING_NAMES = [
  'selectedPersona',
  'botPresetsId',
  'modelPresetsId',
  'promptPresetsId',
  'loreBookPage',
  'personaPrompt',
  'userIcon',
  'userNote',
] as const

export const ServerStandaloneSettingNameSchema = Type.Union(
  SERVER_STANDALONE_SETTING_NAMES.map((name) => Type.Literal(name)),
)

export const ServerStandaloneSettingStateSchema = Type.Union([
  Type.Object({ present: Type.Literal(false) }, { additionalProperties: false }),
  Type.Object(
    {
      present: Type.Literal(true),
      value: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
])

/** The outer payload stays additive; only its nested state discriminator is exact. */
export const ServerStandaloneSettingPayloadSchema = Type.Object({
  revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  setting: ServerStandaloneSettingNameSchema,
  state: ServerStandaloneSettingStateSchema,
})

export type ServerStandaloneSettingName = Static<typeof ServerStandaloneSettingNameSchema>
export type ServerStandaloneSettingState = Static<typeof ServerStandaloneSettingStateSchema>
export type ServerStandaloneSettingPayload = Static<typeof ServerStandaloneSettingPayloadSchema>

export function isServerStandaloneSettingName(value: string): value is ServerStandaloneSettingName {
  return Value.Check(ServerStandaloneSettingNameSchema, value)
}

export function isServerStandaloneSettingPayload(value: unknown): value is ServerStandaloneSettingPayload {
  return Value.Check(ServerStandaloneSettingPayloadSchema, value)
}
