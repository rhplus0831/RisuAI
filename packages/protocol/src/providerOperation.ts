import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const PROVIDER_OPERATIONS = [
  'nanogpt.balance',
  'nanogpt.subscription',
  'nanogpt.model-providers',
  'nanogpt.models',
  'nanogpt.subscription-models',
  'openrouter.models',
  'openrouter.providers',
  'llmgateway.models',
  'neuralwatt.models',
  'ollama.cloud-models',
  'wavespeed.models',
  'google.models',
  'google.count-tokens',
  'anthropic.models',
  'deepl.translate',
  'deeplx.translate',
  'elevenlabs.voices',
  'fish.models',
] as const

export const ProviderOperationSchema = Type.Union(PROVIDER_OPERATIONS.map((operation) => Type.Literal(operation)))

export const ProviderOperationCredentialSchema = Type.Union([
  Type.Object({ source: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object({ source: Type.Literal('stored') }, { additionalProperties: false }),
  Type.Object(
    {
      source: Type.Literal('model-profile'),
      profileId: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal('provided'),
      apiKey: Type.String(),
    },
    { additionalProperties: false },
  ),
])

export const ProviderModelOperationInputSchema = Type.Object(
  {
    modelId: Type.String(),
  },
  { additionalProperties: false },
)

export const ProviderModelTextOperationInputSchema = Type.Object(
  {
    modelId: Type.String(),
    text: Type.String(),
  },
  { additionalProperties: false },
)

export const ProviderTranslationOperationInputSchema = Type.Object(
  {
    text: Type.String(),
    sourceLanguage: Type.String(),
    targetLanguage: Type.String(),
  },
  { additionalProperties: false },
)

export const ProviderOperationInputSchema = Type.Union([
  ProviderModelOperationInputSchema,
  ProviderModelTextOperationInputSchema,
  ProviderTranslationOperationInputSchema,
])

/**
 * Transport envelope shared by the browser caller and Fastify parser. Fastify
 * remains responsible for correlating each operation with its allowed input,
 * applying length limits, and resolving credentials.
 */
export const ProviderOperationRequestSchema = Type.Object(
  {
    operation: ProviderOperationSchema,
    credential: ProviderOperationCredentialSchema,
    input: Type.Optional(ProviderOperationInputSchema),
  },
  { additionalProperties: false },
)

/** Provider results are additive so future metadata does not break old clients. */
export const ProviderOperationSuccessSchema = Type.Object({
  operation: ProviderOperationSchema,
  data: Type.Unknown(),
})

export type ProviderOperation = Static<typeof ProviderOperationSchema>
export type ProviderOperationCredential = Static<typeof ProviderOperationCredentialSchema>
export type ProviderOperationInput = Static<typeof ProviderOperationInputSchema>
export type ProviderOperationRequest = Static<typeof ProviderOperationRequestSchema>
export type ProviderOperationSuccess = Static<typeof ProviderOperationSuccessSchema>

export function isProviderOperation(value: unknown): value is ProviderOperation {
  return Value.Check(ProviderOperationSchema, value)
}

export function isProviderOperationRequest(value: unknown): value is ProviderOperationRequest {
  return Value.Check(ProviderOperationRequestSchema, value)
}

export function isProviderOperationSuccess(value: unknown): value is ProviderOperationSuccess {
  return Value.Check(ProviderOperationSuccessSchema, value)
}
