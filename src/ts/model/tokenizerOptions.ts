import { LLMTokenizer, type LLMTokenizer as LLMTokenizerValue } from './types'

export type FastifyTokenizerLabelKey =
  | 'automatic'
  | 'tiktokenCl100kBase'
  | 'tiktokenO200kBase'
  | 'mistral'
  | 'llama'
  | 'novelAI'
  | 'claude'
  | 'novelList'
  | 'llama3'
  | 'gemma'
  | 'cohere'
  | 'deepSeek'
  | 'deepSeekV4'
  | 'glm4'
  | 'glm5'

export interface FastifyTokenizerOption {
  value: string
  labelKey: FastifyTokenizerLabelKey
  modelTokenizer: LLMTokenizerValue
}

/** Tokenizers that can run inside Fastify's server-owned prompt budget pipeline. */
export const FASTIFY_TOKENIZER_OPTIONS = [
  { value: 'tik', labelKey: 'automatic', modelTokenizer: LLMTokenizer.Unknown },
  { value: 'cl100k_base', labelKey: 'tiktokenCl100kBase', modelTokenizer: LLMTokenizer.tiktokenCl100kBase },
  { value: 'o200k_base', labelKey: 'tiktokenO200kBase', modelTokenizer: LLMTokenizer.tiktokenO200Base },
  { value: 'mistral', labelKey: 'mistral', modelTokenizer: LLMTokenizer.Mistral },
  { value: 'llama', labelKey: 'llama', modelTokenizer: LLMTokenizer.Llama },
  { value: 'novelai', labelKey: 'novelAI', modelTokenizer: LLMTokenizer.NovelAI },
  { value: 'claude', labelKey: 'claude', modelTokenizer: LLMTokenizer.Claude },
  { value: 'novellist', labelKey: 'novelList', modelTokenizer: LLMTokenizer.NovelList },
  { value: 'llama3', labelKey: 'llama3', modelTokenizer: LLMTokenizer.Llama3 },
  { value: 'gemma', labelKey: 'gemma', modelTokenizer: LLMTokenizer.Gemma },
  { value: 'cohere', labelKey: 'cohere', modelTokenizer: LLMTokenizer.Cohere },
  { value: 'deepseek', labelKey: 'deepSeek', modelTokenizer: LLMTokenizer.DeepSeek },
  { value: 'deepseek-v4', labelKey: 'deepSeekV4', modelTokenizer: LLMTokenizer.DeepSeekV4 },
  { value: 'glm4', labelKey: 'glm4', modelTokenizer: LLMTokenizer.GLM4 },
  { value: 'glm5', labelKey: 'glm5', modelTokenizer: LLMTokenizer.GLM5 },
] as const satisfies readonly FastifyTokenizerOption[]
