import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('punctuation shared-core ownership', () => {
  it('keeps browser compatibility and Fastify consumers on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/punctuation'"
    for (const consumer of [
      'src/ts/util.ts',
      'server/fastify/src/prompt/assemble.ts',
      'server/fastify/src/routes/generationChat.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/util/punctuation.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
