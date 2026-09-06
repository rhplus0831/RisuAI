import { describe, expect, it } from 'vitest'
import {
  isPromptRoleValue,
  normalizeCacheRole,
  normalizePromptBlockRoleForType,
  normalizePromptRole,
  normalizePromptTemplate,
} from './promptTemplateNormalization.js'

describe('prompt template role normalization', () => {
  it('normalizes canonical roles, compatibility aliases, and fallbacks', () => {
    for (const role of ['user', 'bot', 'system', 'assistant']) expect(isPromptRoleValue(role)).toBe(true)
    expect(isPromptRoleValue('char')).toBe(false)
    expect(normalizePromptRole('user')).toBe('user')
    expect(normalizePromptRole('assistant')).toBe('bot')
    expect(normalizePromptRole('char')).toBe('bot')
    expect(normalizePromptRole('invalid')).toBeNull()
    expect(normalizeCacheRole('bot')).toBe('assistant')
    expect(normalizeCacheRole('char')).toBe('assistant')
    expect(normalizeCacheRole('invalid')).toBe('all')
  })

  it('clones before selectively normalizing role and role2 fields', () => {
    const source = [
      { type: 'plain', role: 'assistant', metadata: { nested: true } },
      { type: 'jailbreak' },
      { type: 'cot', role: 'invalid' },
      { type: 'persona', role2: 'char' },
      { type: 'description', role2: 'invalid' },
      { type: 'authornote', role2: 'assistant' },
      { type: 'memory', role2: 'user' },
      { type: 'memory', role2: null },
      { type: 'lorebook', role2: 'char' },
      { type: 'cache', role: 'bot' },
    ]

    const normalized = normalizePromptTemplate(source)

    expect(normalized).toEqual([
      { type: 'plain', role: 'bot', metadata: { nested: true } },
      { type: 'jailbreak', role: 'system' },
      { type: 'cot', role: 'system' },
      { type: 'persona', role2: 'bot' },
      { type: 'description', role2: 'system' },
      { type: 'authornote', role2: 'bot' },
      { type: 'memory', role2: 'user' },
      { type: 'memory', role2: null },
      { type: 'lorebook', role2: 'char' },
      { type: 'cache', role: 'assistant' },
    ])
    expect(normalized).not.toBe(source)
    expect(normalized[0]).not.toBe(source[0])
    expect(normalized[0].metadata).not.toBe(source[0].metadata)
    expect(source[0].role).toBe('assistant')
  })

  it('preserves malformed entries and the null-versus-empty template distinction', () => {
    const nestedArray = [{ type: 'plain', role: 'assistant' }]
    expect(normalizePromptTemplate([null, 'legacy', nestedArray])).toEqual([null, 'legacy', nestedArray])
    expect(normalizePromptTemplate(null)).toBeNull()
    expect(normalizePromptTemplate(undefined)).toBeNull()
    expect(normalizePromptTemplate([])).toEqual([])
  })

  it('retains unsupported leaf values while cloning their surrounding records', () => {
    const callback = () => 'kept'
    const metadata = { callback, nested: { enabled: true } }
    const normalized = normalizePromptTemplate([{ type: 'plain', role: 'user', metadata }])

    expect(normalized[0].metadata).toEqual(metadata)
    expect(normalized[0].metadata).not.toBe(metadata)
    expect(normalized[0].metadata.nested).not.toBe(metadata.nested)
    expect(normalized[0].metadata.callback).toBe(callback)
  })

  it('mutates defaults only for supported prompt block types', () => {
    const invalid = { type: 'memory', role2: 'invalid' }
    expect(normalizePromptBlockRoleForType(invalid)).toBeUndefined()
    expect(invalid.role2).toBe('system')

    const compatible = { type: 'persona', role2: 'assistant' }
    normalizePromptBlockRoleForType(compatible)
    expect(compatible.role2).toBe('assistant')

    const unrelated = { type: 'lorebook', role2: 'invalid' }
    normalizePromptBlockRoleForType(unrelated)
    expect(unrelated.role2).toBe('invalid')
  })
})
