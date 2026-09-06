import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('Lua runtime type ownership', () => {
  it('keeps simple-character input structural and browser-parser independent', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/prompt/luaRuntime.ts'), 'utf8')

    expect(source).not.toContain('src/ts/parser/parser.svelte')
    expect(source).toContain('type SimpleCharacterArgument = {')
    expect(source).toContain('char?: character | SimpleCharacterArgument')
    expect(source).toContain('char: character | SimpleCharacterArgument')
  })
})
