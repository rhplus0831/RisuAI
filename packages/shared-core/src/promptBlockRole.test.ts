import { describe, expect, it } from 'vitest'
import { applyDescriptionPromptRole, applyPromptBlockRole } from './promptBlockRole.js'

interface Row {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
}

function rows(): Row[] {
  return [
    { role: 'system', content: 'first' },
    { role: 'function', content: 'second' },
    { role: 'user', content: 'third' },
  ]
}

describe('prompt block role application', () => {
  it('mutates and returns the same rows while mapping bot aliases to assistant', () => {
    const target = rows()
    expect(applyPromptBlockRole(target, 'char')).toBe(target)
    expect(target.map((row) => row.role)).toEqual(['assistant', 'assistant', 'assistant'])
  })

  it('defaults invalid non-null roles to system and ignores nullish roles', () => {
    const invalid = rows()
    applyPromptBlockRole(invalid, 'invalid')
    expect(invalid.map((row) => row.role)).toEqual(['system', 'system', 'system'])

    const nullish = rows()
    expect(applyPromptBlockRole(nullish, undefined)).toBe(nullish)
    expect(applyPromptBlockRole(nullish, null)).toBe(nullish)
    expect(nullish).toEqual(rows())
  })

  it('changes only the selected base description row and defaults its index to zero', () => {
    const defaulted = rows()
    expect(applyDescriptionPromptRole(defaulted, 'user', undefined)).toBe(defaulted)
    expect(defaulted.map((row) => row.role)).toEqual(['user', 'function', 'user'])

    const selected = rows()
    applyDescriptionPromptRole(selected, 'bot', 1)
    expect(selected.map((row) => row.role)).toEqual(['system', 'assistant', 'user'])
  })

  it('leaves rows unchanged for nullish roles and out-of-range description indexes', () => {
    for (const [role, index] of [
      ['user', -1],
      ['user', 3],
      [undefined, 1],
      [null, 1],
    ] as const) {
      const target = rows()
      expect(applyDescriptionPromptRole(target, role, index)).toBe(target)
      expect(target).toEqual(rows())
    }
  })
})
