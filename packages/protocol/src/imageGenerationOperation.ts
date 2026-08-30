import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const SERVER_IMAGE_GENERATION_PROVIDERS = [
  'novelai',
  'dalle',
  'stability',
  'fal',
  'imagen',
  'openai-compat',
  'wavespeed',
  'kei',
] as const

export const ServerImageGenerationProviderSchema = Type.Union(
  SERVER_IMAGE_GENERATION_PROVIDERS.map((provider) => Type.Literal(provider)),
)

export const ImageGenerationCredentialSchema = Type.Union([
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

const FalLoraSchema = Type.Object(
  {
    path: Type.String(),
    scale: Type.Number(),
  },
  { additionalProperties: false },
)

const WaveSpeedLoraSchema = Type.Object(
  {
    path: Type.String(),
    scale: Type.Number(),
  },
  { additionalProperties: false },
)

export const NovelAiImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('novelai'),
    credential: ImageGenerationCredentialSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)

export const DallEImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('dalle'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
    quality: Type.String(),
  },
  { additionalProperties: false },
)

export const StabilityImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('stability'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
    negativePrompt: Type.String(),
    model: Type.String(),
    style: Type.String(),
  },
  { additionalProperties: false },
)

export const FalImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('fal'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
    model: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
    lora: Type.Optional(FalLoraSchema),
  },
  { additionalProperties: false },
)

export const ImagenImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('imagen'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
    model: Type.String(),
    imageSize: Type.String(),
    aspectRatio: Type.String(),
    personGeneration: Type.String(),
  },
  { additionalProperties: false },
)

export const OpenAiCompatibleImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('openai-compat'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
  },
  { additionalProperties: false },
)

export const WaveSpeedImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('wavespeed'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
    model: Type.String(),
    images: Type.Optional(Type.Array(Type.String())),
    loras: Type.Optional(Type.Array(WaveSpeedLoraSchema)),
  },
  { additionalProperties: false },
)

export const KeiImageGenerationRequestSchema = Type.Object(
  {
    provider: Type.Literal('kei'),
    credential: ImageGenerationCredentialSchema,
    prompt: Type.String(),
  },
  { additionalProperties: false },
)

export const ImageGenerationRequestSchema = Type.Union([
  NovelAiImageGenerationRequestSchema,
  DallEImageGenerationRequestSchema,
  StabilityImageGenerationRequestSchema,
  FalImageGenerationRequestSchema,
  ImagenImageGenerationRequestSchema,
  OpenAiCompatibleImageGenerationRequestSchema,
  WaveSpeedImageGenerationRequestSchema,
  KeiImageGenerationRequestSchema,
])

export type ServerImageGenerationProvider = Static<typeof ServerImageGenerationProviderSchema>
export type ImageGenerationCredential = Static<typeof ImageGenerationCredentialSchema>
export type NovelAiImageGenerationRequest = Static<typeof NovelAiImageGenerationRequestSchema>
export type DallEImageGenerationRequest = Static<typeof DallEImageGenerationRequestSchema>
export type StabilityImageGenerationRequest = Static<typeof StabilityImageGenerationRequestSchema>
export type FalImageGenerationRequest = Static<typeof FalImageGenerationRequestSchema>
export type ImagenImageGenerationRequest = Static<typeof ImagenImageGenerationRequestSchema>
export type OpenAiCompatibleImageGenerationRequest = Static<typeof OpenAiCompatibleImageGenerationRequestSchema>
export type WaveSpeedImageGenerationRequest = Static<typeof WaveSpeedImageGenerationRequestSchema>
export type KeiImageGenerationRequest = Static<typeof KeiImageGenerationRequestSchema>
export type ImageGenerationRequest = Static<typeof ImageGenerationRequestSchema>

export function isServerImageGenerationProvider(value: unknown): value is ServerImageGenerationProvider {
  return Value.Check(ServerImageGenerationProviderSchema, value)
}

export function isImageGenerationRequest(value: unknown): value is ImageGenerationRequest {
  return Value.Check(ImageGenerationRequestSchema, value)
}
