import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getChatDefaultVariables, readChatVariable } from '../src/prompt/chatVarDefaults.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('chat variable defaults', () => {
  it('keeps character rows before template rows and resolves the first duplicate', () => {
    const defaults = getChatDefaultVariables(
      { defaultVariables: 'shared=character\ncharacterOnly=one' },
      { templateDefaultVariables: 'shared=template\ntemplateOnly=two' },
    )

    expect(defaults).toEqual([
      ['shared', 'character'],
      ['characterOnly', 'one'],
      ['shared', 'template'],
      ['templateOnly', 'two'],
    ])
    expect(readChatVariable({}, 'shared', defaults)).toBe('character')
  })

  it('treats nullish defaults as empty and preserves stored-value precedence', () => {
    const defaults = getChatDefaultVariables({ defaultVariables: null }, { templateDefaultVariables: null })

    expect(defaults).toEqual([])
    expect(readChatVariable({ $value: '' }, 'value', [['value', 'default']])).toBe('')
    expect(readChatVariable({ $value: null }, 'value', [['value', 'default']])).toBe('default')
    expect(readChatVariable({}, 'missing', [])).toBeUndefined()
  })

  it('owns its production inputs in Fastify', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/prompt/chatVarDefaults.ts'), 'utf8')

    expect(source).not.toContain('src/ts/storage/database.svelte')
    expect(source).toContain('export interface ChatDefaultCharacterInput')
    expect(source).toContain('export interface ChatDefaultDatabaseInput')
  })
})
