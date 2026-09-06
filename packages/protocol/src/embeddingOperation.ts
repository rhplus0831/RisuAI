import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const REMOTE_EMBEDDING_MODELS = [
  'custom',
  'ada',
  'openai3small',
  'openai3large',
  'voyageContext3',
  'voyageContext4',
] as const
export const CONTEXTUAL_REMOTE_EMBEDDING_MODELS = ['voyageContext3', 'voyageContext4'] as const
export const NON_CONTEXTUAL_REMOTE_EMBEDDING_MODELS = ['custom', 'ada', 'openai3small', 'openai3large'] as const

export const RemoteEmbeddingModelSchema = Type.Union(REMOTE_EMBEDDING_MODELS.map((model) => Type.Literal(model)))
export const ContextualRemoteEmbeddingModelSchema = Type.Union(
  CONTEXTUAL_REMOTE_EMBEDDING_MODELS.map((model) => Type.Literal(model)),
)
export const NonContextualRemoteEmbeddingModelSchema = Type.Union(
  NON_CONTEXTUAL_REMOTE_EMBEDDING_MODELS.map((model) => Type.Literal(model)),
)
export const EmbeddingInputTypeSchema = Type.Union([Type.Literal('query'), Type.Literal('document')])

export const EmbeddingOperationCredentialSchema = Type.Union([
  Type.Object({ source: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object({ source: Type.Literal('stored') }, { additionalProperties: false }),
  Type.Object(
    {
      source: Type.Literal('provided'),
      apiKey: Type.String(),
    },
    { additionalProperties: false },
  ),
])

export const CustomEmbeddingConfigurationSchema = Type.Union([
  Type.Object({ source: Type.Literal('stored') }, { additionalProperties: false }),
  Type.Object(
    {
      source: Type.Literal('provided'),
      url: Type.String(),
      model: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
])

export const EmbeddingTextsOperationRequestSchema = Type.Object(
  {
    operation: Type.Literal('texts'),
    model: NonContextualRemoteEmbeddingModelSchema,
    inputType: EmbeddingInputTypeSchema,
    input: Type.Array(Type.String()),
    credential: EmbeddingOperationCredentialSchema,
    custom: Type.Optional(CustomEmbeddingConfigurationSchema),
  },
  { additionalProperties: false },
)

export const EmbeddingGroupsOperationRequestSchema = Type.Object(
  {
    operation: Type.Literal('groups'),
    model: ContextualRemoteEmbeddingModelSchema,
    inputType: EmbeddingInputTypeSchema,
    groups: Type.Array(Type.Array(Type.String())),
    credential: EmbeddingOperationCredentialSchema,
  },
  { additionalProperties: false },
)

export const EmbeddingOperationRequestSchema = Type.Union([
  EmbeddingTextsOperationRequestSchema,
  EmbeddingGroupsOperationRequestSchema,
])

const EmbeddingVectorSchema = Type.Array(Type.Number())

export const EmbeddingTextsOperationSuccessSchema = Type.Object(
  {
    operation: Type.Literal('texts'),
    model: Type.String(),
    dimension: Type.Integer({ minimum: 1 }),
    vectors: Type.Array(EmbeddingVectorSchema),
  },
  { additionalProperties: false },
)

export const EmbeddingGroupsOperationSuccessSchema = Type.Object(
  {
    operation: Type.Literal('groups'),
    model: Type.String(),
    dimension: Type.Integer({ minimum: 1 }),
    groups: Type.Array(Type.Array(EmbeddingVectorSchema)),
  },
  { additionalProperties: false },
)

export const EmbeddingOperationSuccessSchema = Type.Union([
  EmbeddingTextsOperationSuccessSchema,
  EmbeddingGroupsOperationSuccessSchema,
])

export type RemoteEmbeddingModel = Static<typeof RemoteEmbeddingModelSchema>
export type ContextualRemoteEmbeddingModel = Static<typeof ContextualRemoteEmbeddingModelSchema>
export type EmbeddingInputType = Static<typeof EmbeddingInputTypeSchema>
export type EmbeddingOperationCredential = Static<typeof EmbeddingOperationCredentialSchema>
export type CustomEmbeddingConfiguration = Static<typeof CustomEmbeddingConfigurationSchema>
export type EmbeddingTextsOperationRequest = Static<typeof EmbeddingTextsOperationRequestSchema>
export type EmbeddingGroupsOperationRequest = Static<typeof EmbeddingGroupsOperationRequestSchema>
export type EmbeddingOperationRequest = Static<typeof EmbeddingOperationRequestSchema>
export type EmbeddingTextsOperationSuccess = Static<typeof EmbeddingTextsOperationSuccessSchema>
export type EmbeddingGroupsOperationSuccess = Static<typeof EmbeddingGroupsOperationSuccessSchema>
export type EmbeddingOperationSuccess = Static<typeof EmbeddingOperationSuccessSchema>

export function isRemoteEmbeddingModel(value: unknown): value is RemoteEmbeddingModel {
  return Value.Check(RemoteEmbeddingModelSchema, value)
}

export function isContextualRemoteEmbeddingModel(value: unknown): value is ContextualRemoteEmbeddingModel {
  return Value.Check(ContextualRemoteEmbeddingModelSchema, value)
}

export function isEmbeddingOperationRequest(value: unknown): value is EmbeddingOperationRequest {
  if (!Value.Check(EmbeddingOperationRequestSchema, value)) return false
  if (value.operation === 'groups') return value.groups.length > 0 && value.groups.every((group) => group.length > 0)
  if (value.input.length === 0) return false
  return value.model === 'custom' ? value.custom !== undefined : value.custom === undefined
}

export function isEmbeddingOperationSuccess(value: unknown): value is EmbeddingOperationSuccess {
  if (!Value.Check(EmbeddingOperationSuccessSchema, value)) return false
  const vectors = value.operation === 'texts' ? value.vectors : value.groups.flat()
  return vectors.every((vector) => vector.length === value.dimension)
}
