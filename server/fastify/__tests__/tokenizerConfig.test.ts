import { describe, expect, it } from 'vitest'
import type { FastifyDatabase as Database } from '../src/prompt/serverTypes.js'
import { LLMTokenizer } from '@risuai/shared-core/model-types'
import {
  serverTokenizerUnsupportedReason,
  tokenizerEncodingFromDb,
  tokenizerOptionsFromDb,
} from '../src/prompt/tokenizerConfig.js'
import type { TokenEncoding } from '../src/prompt/tokens.js'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-4o',
    customTokenizer: 'tik',
    googleClaudeTokenizing: false,
    ...overrides,
  } as Database
}

const EXPLICIT_TOKENIZER_CASES: Array<[string, TokenEncoding]> = [
  ['cl100k_base', 'cl100k_base'],
  ['tiktokenCl100kBase', 'cl100k_base'],
  ['1', 'cl100k_base'],
  ['o200k_base', 'o200k_base'],
  ['tiktokenO200Base', 'o200k_base'],
  ['2', 'o200k_base'],
  ['mistral', 'mistral'],
  ['Mistral', 'mistral'],
  ['3', 'mistral'],
  ['llama', 'llama'],
  ['Llama', 'llama'],
  ['4', 'llama'],
  ['novelai', 'novelai'],
  ['NovelAI', 'novelai'],
  ['5', 'novelai'],
  ['claude', 'claude'],
  ['Claude', 'claude'],
  ['6', 'claude'],
  ['novellist', 'novellist'],
  ['NovelList', 'novellist'],
  ['7', 'novellist'],
  ['llama3', 'llama3'],
  ['Llama3', 'llama3'],
  ['8', 'llama3'],
  ['gemma', 'gemma'],
  ['Gemma', 'gemma'],
  ['9', 'gemma'],
  ['cohere', 'cohere'],
  ['Cohere', 'cohere'],
  ['11', 'cohere'],
  ['deepseek', 'deepseek'],
  ['DeepSeek', 'deepseek'],
  ['13', 'deepseek'],
  ['deepseek-v4', 'deepseek-v4'],
  ['DeepSeekV4', 'deepseek-v4'],
  ['14', 'deepseek-v4'],
  ['glm4', 'glm4'],
  ['GLM4', 'glm4'],
  ['15', 'glm4'],
  ['glm5', 'glm5'],
  ['GLM5', 'glm5'],
  ['16', 'glm5'],
]

describe('Fastify tokenizer configuration', () => {
  it.each(EXPLICIT_TOKENIZER_CASES)('accepts and routes explicit tokenizer %s', (configured, encoding) => {
    const db = database({ customTokenizer: configured })
    expect(serverTokenizerUnsupportedReason(db)).toBeUndefined()
    expect(tokenizerEncodingFromDb(db)).toBe(encoding)
  })

  it('routes automatic tokenizer families through the server-safe model resolver', () => {
    const cases: Array<[string, TokenEncoding]> = [
      ['gpt-4o', 'o200k_base'],
      ['gpt-4', 'cl100k_base'],
      ['claude-3-5-sonnet-latest', 'claude'],
      ['mistral-large-latest', 'mistral'],
      ['cohere-command-r', 'cohere'],
      ['deepseek-chat', 'deepseek'],
      ['deepseek-v4-preview', 'deepseek-v4'],
      ['novelai', 'novelai'],
      ['novellist', 'novellist'],
      ['gemini-2.5-pro', 'gemma'],
      ['totally-unknown-dynamic-model', 'cl100k_base'],
    ]
    for (const [aiModel, encoding] of cases) {
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'tik' })), aiModel).toBe(encoding)
    }
  })

  it('covers every automatic LLMTokenizer enum family through persisted custom-model metadata', () => {
    const cases: Array<[number, TokenEncoding]> = [
      [LLMTokenizer.Unknown, 'cl100k_base'],
      [LLMTokenizer.tiktokenCl100kBase, 'cl100k_base'],
      [LLMTokenizer.tiktokenO200Base, 'o200k_base'],
      [LLMTokenizer.Mistral, 'mistral'],
      [LLMTokenizer.Llama, 'llama'],
      [LLMTokenizer.NovelAI, 'novelai'],
      [LLMTokenizer.Claude, 'claude'],
      [LLMTokenizer.NovelList, 'novellist'],
      [LLMTokenizer.Llama3, 'llama3'],
      [LLMTokenizer.Gemma, 'gemma'],
      [LLMTokenizer.GoogleCloud, 'gemma'],
      [LLMTokenizer.Cohere, 'cohere'],
      [LLMTokenizer.Local, 'cl100k_base'],
      [LLMTokenizer.DeepSeek, 'deepseek'],
      [LLMTokenizer.DeepSeekV4, 'deepseek-v4'],
      [LLMTokenizer.GLM4, 'glm4'],
      [LLMTokenizer.GLM5, 'glm5'],
    ]

    for (const [tokenizer, encoding] of cases) {
      const aiModel = `xcustom:::tokenizer-${tokenizer}`
      const db = database({
        aiModel,
        customTokenizer: 'tik',
        customModels: [{ id: aiModel, tokenizer }] as Database['customModels'],
      })
      expect(tokenizerEncodingFromDb(db), String(tokenizer)).toBe(encoding)
    }
  })

  it('treats Unknown enum aliases as automatic selection', () => {
    expect(tokenizerEncodingFromDb(database({ aiModel: 'claude-3-5-sonnet-latest', customTokenizer: 'Unknown' }))).toBe(
      'claude',
    )
    expect(tokenizerEncodingFromDb(database({ aiModel: 'gemini-2.5-pro', customTokenizer: '0' }))).toBe('gemma')
  })

  it('keeps openrouter and reverse-proxy routing quirks', () => {
    for (const aiModel of ['openrouter', 'reverse_proxy']) {
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'tik' }))).toBe('o200k_base')
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'Unknown' }))).toBe('o200k_base')
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'claude' }))).toBe('claude')
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'llama3' }))).toBe('llama')
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: 'Llama3' }))).toBe('llama')
      expect(tokenizerEncodingFromDb(database({ aiModel, customTokenizer: '8' }))).toBe('llama')
    }
  })

  it('keeps automatic Local models on the conservative cl100k fallback', () => {
    expect(tokenizerEncodingFromDb(database({ aiModel: 'hf:::local-model', customTokenizer: 'tik' }))).toBe(
      'cl100k_base',
    )
  })

  it('keeps per-message overhead selection and carries multimodal billing config', () => {
    expect(tokenizerOptionsFromDb(database({ aiModel: 'gpt4o' })).options).toEqual({
      chatAdditionalTokens: 5,
      useName: 'noName',
      supportsInlayImage: true,
      visionQuality: 'low',
    })
    expect(tokenizerOptionsFromDb(database({ aiModel: 'claude-3-5-sonnet-latest' })).options).toEqual({
      chatAdditionalTokens: 3,
      useName: 'name',
      supportsInlayImage: true,
      visionQuality: 'low',
    })
  })

  it('rejects Google Cloud network counting while flag-off automatic routing uses Gemma', () => {
    expect(
      tokenizerEncodingFromDb(
        database({ aiModel: 'gemini-2.5-pro', customTokenizer: 'tik', googleClaudeTokenizing: false }),
      ),
    ).toBe('gemma')
    const db = database({ aiModel: 'gemini-2.5-pro', googleClaudeTokenizing: true })
    expect(serverTokenizerUnsupportedReason(db)).toContain('Google Cloud tokenization is not supported')
    expect(() => tokenizerEncodingFromDb(db)).toThrow('Google Cloud tokenization is not supported')
  })

  it.each(['local', 'Local', '12'])('rejects explicit Local tokenizer %s with a GGUF-specific reason', (value) => {
    const reason = serverTokenizerUnsupportedReason(database({ customTokenizer: value }))
    expect(reason).toContain('Local tokenization requires a GGUF tokenizer model')
  })

  it.each(['googlecloud', 'GoogleCloud', 'google-cloud', '10'])(
    'rejects explicit Google Cloud tokenizer %s with a network-counting reason',
    (value) => {
      const reason = serverTokenizerUnsupportedReason(database({ customTokenizer: value }))
      expect(reason).toContain('Google Cloud network token counting')
    },
  )

  it('keeps plugin-model tokenizers unsupported while retaining tiktoken selections', () => {
    expect(serverTokenizerUnsupportedReason(database({ aiModel: 'custom', customTokenizer: 'claude' }))).toContain(
      'not supported for plugin models',
    )
    expect(serverTokenizerUnsupportedReason(database({ aiModel: 'custom', customTokenizer: 'custom' }))).toContain(
      'Plugin-provided tokenizers',
    )
    expect(tokenizerEncodingFromDb(database({ aiModel: 'custom', customTokenizer: 'tik' }))).toBe('cl100k_base')
    expect(tokenizerEncodingFromDb(database({ aiModel: 'custom', customTokenizer: 'o200k_base' }))).toBe('o200k_base')
  })

  it('rejects unknown imported tokenizer hooks instead of falling back silently', () => {
    const db = database({ customTokenizer: 'some-plugin-tokenizer' })
    expect(serverTokenizerUnsupportedReason(db)).toContain('Tokenizer "some-plugin-tokenizer" is not supported')
    expect(() => tokenizerOptionsFromDb(db)).toThrow('Select Automatic or a portable built-in tokenizer')
  })
})
