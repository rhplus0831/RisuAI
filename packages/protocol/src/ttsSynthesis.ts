import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const TTS_SYNTHESIS_OPERATIONS = [
  'elevenlabs.synthesize',
  'fish.synthesize',
  'huggingface.synthesize',
  'novelai.synthesize',
  'openai.synthesize',
] as const

export const TtsSynthesisOperationSchema = Type.Union(
  TTS_SYNTHESIS_OPERATIONS.map((operation) => Type.Literal(operation)),
)

export const TtsSynthesisCredentialSchema = Type.Union([
  Type.Object({ source: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object({ source: Type.Literal('stored') }, { additionalProperties: false }),
  Type.Object(
    {
      source: Type.Literal('provided'),
      apiKey: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal('stored-character'),
      characterId: Type.String(),
    },
    { additionalProperties: false },
  ),
])

export const ElevenLabsSynthesisInputSchema = Type.Object(
  {
    text: Type.String(),
    voiceId: Type.String(),
  },
  { additionalProperties: false },
)

export const FishSynthesisInputSchema = Type.Object(
  {
    text: Type.String(),
    referenceId: Type.String(),
    chunkLength: Type.Number(),
    normalize: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const HuggingFaceSynthesisInputSchema = Type.Object(
  {
    text: Type.String(),
    model: Type.String(),
  },
  { additionalProperties: false },
)

export const NovelAiSynthesisInputSchema = Type.Object(
  {
    text: Type.String(),
    seed: Type.String(),
    version: Type.Union([Type.Literal('v1'), Type.Literal('v2')]),
  },
  { additionalProperties: false },
)

export const OPENAI_TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const
export const OpenAiTtsFormatSchema = Type.Union(OPENAI_TTS_FORMATS.map((format) => Type.Literal(format)))

export const ProvidedOpenAiSynthesisConfigSchema = Type.Object(
  {
    baseUrl: Type.String(),
    model: Type.String(),
    voice: Type.String(),
    format: OpenAiTtsFormatSchema,
  },
  { additionalProperties: false },
)

export const OpenAiSynthesisInputSchema = Type.Object(
  {
    text: Type.String(),
    /**
     * Present only when the caller owns the credential or intentionally uses
     * an auth-free endpoint. Fastify resolves stored-character configuration.
     */
    config: Type.Optional(ProvidedOpenAiSynthesisConfigSchema),
  },
  { additionalProperties: false },
)

export const ElevenLabsSynthesisRequestSchema = Type.Object(
  {
    operation: Type.Literal('elevenlabs.synthesize'),
    credential: TtsSynthesisCredentialSchema,
    input: ElevenLabsSynthesisInputSchema,
  },
  { additionalProperties: false },
)

export const FishSynthesisRequestSchema = Type.Object(
  {
    operation: Type.Literal('fish.synthesize'),
    credential: TtsSynthesisCredentialSchema,
    input: FishSynthesisInputSchema,
  },
  { additionalProperties: false },
)

export const HuggingFaceSynthesisRequestSchema = Type.Object(
  {
    operation: Type.Literal('huggingface.synthesize'),
    credential: TtsSynthesisCredentialSchema,
    input: HuggingFaceSynthesisInputSchema,
  },
  { additionalProperties: false },
)

export const NovelAiSynthesisRequestSchema = Type.Object(
  {
    operation: Type.Literal('novelai.synthesize'),
    credential: TtsSynthesisCredentialSchema,
    input: NovelAiSynthesisInputSchema,
  },
  { additionalProperties: false },
)

export const OpenAiSynthesisRequestSchema = Type.Object(
  {
    operation: Type.Literal('openai.synthesize'),
    credential: TtsSynthesisCredentialSchema,
    input: OpenAiSynthesisInputSchema,
  },
  { additionalProperties: false },
)

export const TtsSynthesisRequestSchema = Type.Union([
  ElevenLabsSynthesisRequestSchema,
  FishSynthesisRequestSchema,
  HuggingFaceSynthesisRequestSchema,
  NovelAiSynthesisRequestSchema,
  OpenAiSynthesisRequestSchema,
])

export type TtsSynthesisOperation = Static<typeof TtsSynthesisOperationSchema>
export type TtsSynthesisCredential = Static<typeof TtsSynthesisCredentialSchema>
export type ElevenLabsSynthesisInput = Static<typeof ElevenLabsSynthesisInputSchema>
export type FishSynthesisInput = Static<typeof FishSynthesisInputSchema>
export type HuggingFaceSynthesisInput = Static<typeof HuggingFaceSynthesisInputSchema>
export type NovelAiSynthesisInput = Static<typeof NovelAiSynthesisInputSchema>
export type OpenAiTtsFormat = Static<typeof OpenAiTtsFormatSchema>
export type ProvidedOpenAiSynthesisConfig = Static<typeof ProvidedOpenAiSynthesisConfigSchema>
export type OpenAiSynthesisInput = Static<typeof OpenAiSynthesisInputSchema>
export type TtsSynthesisRequest = Static<typeof TtsSynthesisRequestSchema>

export function isTtsSynthesisOperation(value: unknown): value is TtsSynthesisOperation {
  return Value.Check(TtsSynthesisOperationSchema, value)
}

export function isTtsSynthesisRequest(value: unknown): value is TtsSynthesisRequest {
  return Value.Check(TtsSynthesisRequestSchema, value)
}
