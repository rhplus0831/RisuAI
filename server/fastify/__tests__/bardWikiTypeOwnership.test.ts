import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('BardWiki server type ownership', () => {
  it('keeps BardWiki production consumers behind Fastify-owned inputs', () => {
    const consumers = [
      'server/fastify/src/bardWikiApplyTurnHandler.ts',
      'server/fastify/src/bardWikiCanonicalModel.ts',
      'server/fastify/src/bardWikiEventModel.ts',
      'server/fastify/src/bardWikiRebuildHandler.ts',
      'server/fastify/src/prompt/bardWiki.ts',
    ]

    for (const consumer of consumers) {
      const contents = source(consumer)
      expect(contents).not.toContain('src/ts/storage/database.svelte')
      expect(contents).not.toContain('src/ts/process/index.svelte')
    }

    expect(source('server/fastify/src/bardWikiTypes.ts')).toContain(
      "import type { ChatDispatchDatabase } from './prompt/chatDispatch.js'",
    )
  })
})
