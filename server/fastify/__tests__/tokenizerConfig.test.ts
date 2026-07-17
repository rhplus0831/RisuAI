import { describe, expect, it } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import {
  serverTokenizerUnsupportedReason,
  tokenizerEncodingFromDb,
  tokenizerOptionsFromDb,
} from '../src/prompt/tokenizerConfig.js'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-4o',
    customTokenizer: 'tik',
    googleClaudeTokenizing: false,
    ...overrides,
  } as Database
}

describe('Fastify tokenizer configuration', () => {
  it('honors explicit cl100k and o200k selections', () => {
    expect(tokenizerEncodingFromDb(database({ customTokenizer: 'cl100k_base' }))).toBe('cl100k_base')
    expect(tokenizerEncodingFromDb(database({ customTokenizer: 'o200k_base' }))).toBe('o200k_base')
    expect(tokenizerEncodingFromDb(database({ customTokenizer: '1' }))).toBe('cl100k_base')
    expect(tokenizerEncodingFromDb(database({ customTokenizer: '2' }))).toBe('o200k_base')
  })

  it('keeps automatic model routing and legacy proxy routing deterministic', () => {
    expect(tokenizerOptionsFromDb(database({ aiModel: 'gpt-4o', customTokenizer: 'tik' })).encoding).toBe('o200k_base')
    expect(tokenizerOptionsFromDb(database({ aiModel: 'gpt-4', customTokenizer: 'tik' })).encoding).toBe('cl100k_base')
    expect(tokenizerOptionsFromDb(database({ aiModel: 'reverse_proxy', customTokenizer: 'tik' })).encoding).toBe(
      'o200k_base',
    )
  })

  it('rejects unsupported imported tokenizer hooks instead of falling back silently', () => {
    const db = database({ customTokenizer: 'claude' })
    expect(serverTokenizerUnsupportedReason(db)).toContain('Tokenizer "claude" is not supported')
    expect(() => tokenizerOptionsFromDb(db)).toThrow('Select Automatic, cl100k_base, or o200k_base')
  })

  it('rejects Google Cloud token counting for Google models', () => {
    const db = database({ aiModel: 'gemini-2.5-pro', googleClaudeTokenizing: true })
    expect(serverTokenizerUnsupportedReason(db)).toContain('Google Cloud tokenization is not supported')
  })
})
