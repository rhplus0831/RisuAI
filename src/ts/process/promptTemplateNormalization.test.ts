import { describe, expect, it } from 'vitest'
import {
  normalizeCacheRole,
  normalizePromptBlockRoleForType,
  normalizePromptRole,
  normalizePromptTemplate,
} from './promptTemplateNormalization'

describe('prompt template role normalization', () => {
  it('normalizes legacy prompt and cache role aliases', () => {
    expect(normalizePromptRole('assistant')).toBe('bot')
    expect(normalizePromptRole('char')).toBe('bot')
    expect(normalizePromptRole('invalid')).toBeNull()
    expect(normalizeCacheRole('bot')).toBe('assistant')
    expect(normalizeCacheRole('char')).toBe('assistant')
    expect(normalizeCacheRole('invalid')).toBe('all')
  })

  it('normalizes role for plain cards and role2 only for supported blocks', () => {
    expect(
      normalizePromptTemplate([
        { type: 'plain', role: 'assistant', text: '', type2: 'normal' },
        { type: 'persona', role2: 'char' },
        { type: 'description', role2: 'invalid' },
        { type: 'authornote', role2: 'assistant' },
        { type: 'memory', role2: 'user' },
        { type: 'lorebook', role2: 'char' },
        { type: 'cache', role: 'bot', name: '', depth: 1 },
      ]),
    ).toEqual([
      { type: 'plain', role: 'bot', text: '', type2: 'normal' },
      { type: 'persona', role2: 'bot' },
      { type: 'description', role2: 'system' },
      { type: 'authornote', role2: 'bot' },
      { type: 'memory', role2: 'user' },
      { type: 'lorebook', role2: 'char' },
      { type: 'cache', role: 'assistant', name: '', depth: 1 },
    ])
  })

  it('preserves the null-versus-empty template distinction', () => {
    expect(normalizePromptTemplate(null)).toBeNull()
    expect(normalizePromptTemplate(undefined)).toBeNull()
    expect(normalizePromptTemplate([])).toEqual([])
  })

  it('defaults invalid block roles on type switch while accepting assistant compatibility values', () => {
    const invalid = { type: 'memory', role2: 'invalid' } as unknown as import('./prompt').PromptItem
    normalizePromptBlockRoleForType(invalid)
    expect((invalid as unknown as Record<string, unknown>).role2).toBe('system')

    const compatible = { type: 'persona', role2: 'assistant' } as unknown as import('./prompt').PromptItem
    normalizePromptBlockRoleForType(compatible)
    expect((compatible as unknown as Record<string, unknown>).role2).toBe('assistant')
  })
})
