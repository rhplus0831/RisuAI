import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('lore-hash shared-core ownership', () => {
  it('keeps browser and Fastify consumers on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/lore-hash'"
    for (const consumer of [
      'src/ts/util.ts',
      'server/fastify/src/prompt/cbsAdapter.ts',
      'server/fastify/src/prompt/lorebook.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }

    const cbsAdapter = source('server/fastify/src/prompt/cbsAdapter.ts')
    expect(cbsAdapter).not.toContain('function sfc32')
    expect(cbsAdapter).not.toContain('function pickHashRand')
    expect(fs.existsSync(new URL('src/ts/util/loreHash.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
