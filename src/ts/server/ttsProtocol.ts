export const TTS_SYNTHESIS_OPERATIONS = [
  'elevenlabs.synthesize',
  'fish.synthesize',
  'huggingface.synthesize',
  'novelai.synthesize',
  'openai.synthesize',
] as const

export type TtsSynthesisOperation = (typeof TTS_SYNTHESIS_OPERATIONS)[number]

export type TtsSynthesisCredential =
  | { source: 'none' }
  | { source: 'stored' }
  | { source: 'provided'; apiKey: string }
  | { source: 'stored-character'; characterId: string }

export interface ElevenLabsSynthesisInput {
  text: string
  voiceId: string
}

export interface FishSynthesisInput {
  text: string
  referenceId: string
  chunkLength: number
  normalize: boolean
}

export interface HuggingFaceSynthesisInput {
  text: string
  model: string
}

export interface NovelAiSynthesisInput {
  text: string
  seed: string
  version: 'v1' | 'v2'
}

export type OpenAiTtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'

export interface ProvidedOpenAiSynthesisConfig {
  baseUrl: string
  model: string
  voice: string
  format: OpenAiTtsFormat
}

export interface OpenAiSynthesisInput {
  text: string
  /**
   * Present only when the caller already owns the credential (or intentionally
   * uses an auth-free endpoint). Stored-character requests load their endpoint
   * and options together with the raw credential on the server.
   */
  config?: ProvidedOpenAiSynthesisConfig
}

export type TtsSynthesisRequest =
  | {
      operation: 'elevenlabs.synthesize'
      credential: TtsSynthesisCredential
      input: ElevenLabsSynthesisInput
    }
  | {
      operation: 'fish.synthesize'
      credential: TtsSynthesisCredential
      input: FishSynthesisInput
    }
  | {
      operation: 'huggingface.synthesize'
      credential: TtsSynthesisCredential
      input: HuggingFaceSynthesisInput
    }
  | {
      operation: 'novelai.synthesize'
      credential: TtsSynthesisCredential
      input: NovelAiSynthesisInput
    }
  | {
      operation: 'openai.synthesize'
      credential: TtsSynthesisCredential
      input: OpenAiSynthesisInput
    }

export function isTtsSynthesisOperation(value: unknown): value is TtsSynthesisOperation {
  return typeof value === 'string' && (TTS_SYNTHESIS_OPERATIONS as readonly string[]).includes(value)
}
