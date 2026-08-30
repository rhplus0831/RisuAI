import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('RisuChat parser-helper shared-core ownership', () => {
  it('keeps the browser facade and every Fastify consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/risuchat-parser-helpers'"
    for (const consumer of [
      'src/ts/parser/risuChatParserHelpers.ts',
      'server/fastify/src/displaySourceService.ts',
      'server/fastify/src/prompt/scripts.ts',
      'server/fastify/src/prompt/cbsAdapter.ts',
      'server/fastify/src/prompt/variables.ts',
      'server/fastify/src/routes/generationChat.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
  })
})
