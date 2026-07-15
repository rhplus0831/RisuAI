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

export type ServerImageGenerationProvider = (typeof SERVER_IMAGE_GENERATION_PROVIDERS)[number]

export type ImageGenerationCredential =
  | { source: 'none' }
  | { source: 'stored' }
  | { source: 'provided'; apiKey: string }

interface ImageGenerationRequestBase {
  credential: ImageGenerationCredential
}

export interface NovelAiImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'novelai'
  payload: Record<string, unknown>
}

export interface DallEImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'dalle'
  prompt: string
  quality: string
}

export interface StabilityImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'stability'
  prompt: string
  negativePrompt: string
  model: string
  style: string
}

export interface FalImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'fal'
  prompt: string
  model: string
  width: number
  height: number
  lora?: {
    path: string
    scale: number
  }
}

export interface ImagenImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'imagen'
  prompt: string
  model: string
  imageSize: string
  aspectRatio: string
  personGeneration: string
}

export interface OpenAiCompatibleImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'openai-compat'
  prompt: string
}

export interface WaveSpeedImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'wavespeed'
  prompt: string
  model: string
  images?: string[]
  loras?: Array<{
    path: string
    scale: number
  }>
}

export interface KeiImageGenerationRequest extends ImageGenerationRequestBase {
  provider: 'kei'
  prompt: string
}

export type ImageGenerationRequest =
  | NovelAiImageGenerationRequest
  | DallEImageGenerationRequest
  | StabilityImageGenerationRequest
  | FalImageGenerationRequest
  | ImagenImageGenerationRequest
  | OpenAiCompatibleImageGenerationRequest
  | WaveSpeedImageGenerationRequest
  | KeiImageGenerationRequest

export function isServerImageGenerationProvider(value: unknown): value is ServerImageGenerationProvider {
  return typeof value === 'string' && (SERVER_IMAGE_GENERATION_PROVIDERS as readonly string[]).includes(value)
}
