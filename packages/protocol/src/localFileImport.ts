import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const LocalCharacterImportProgressSchema = Type.Object({
  phase: Type.Union([Type.Literal('read'), Type.Literal('assets'), Type.Literal('convert'), Type.Literal('commit')]),
  completedBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  totalBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  completedAssets: Type.Optional(Type.Integer({ minimum: 0 })),
})

export type LocalCharacterImportProgress = Static<typeof LocalCharacterImportProgressSchema>

export function isLocalCharacterImportProgress(value: unknown): value is LocalCharacterImportProgress {
  return Value.Check(LocalCharacterImportProgressSchema, value)
}

// Preserve ordinary HTTP result semantics inside the opt-in SSE response.
export const LocalFileImportResultFrameSchema = Type.Object({
  statusCode: Type.Integer({ minimum: 200, maximum: 599 }),
  body: Type.Unknown(),
})

export type LocalFileImportResultFrame = Static<typeof LocalFileImportResultFrameSchema>

export function isLocalFileImportResultFrame(value: unknown): value is LocalFileImportResultFrame {
  return Value.Check(LocalFileImportResultFrameSchema, value)
}
