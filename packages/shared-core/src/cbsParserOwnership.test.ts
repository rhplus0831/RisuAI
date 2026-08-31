import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('CBS/parser shared-core ownership', () => {
  it('keeps the shared runtime free of browser application imports', () => {
    for (const consumer of [
      'packages/shared-core/src/cbsContracts.ts',
      'packages/shared-core/src/cbsRegistry.ts',
      'packages/shared-core/src/risuChatParserCore.ts',
    ]) {
      const text = source(consumer)
      expect(text, consumer).not.toContain('src/ts/')
      expect(text, consumer).not.toContain("from 'svelte")
      expect(text, consumer).not.toContain('from "svelte')
    }
  })

  it('keeps browser and Fastify facades on the shared owners', () => {
    expect(source('src/ts/cbs.ts')).toContain('@risuai/shared-core/cbs-registry')
    expect(source('src/ts/parser/risuChatParser.ts')).toContain('@risuai/shared-core/risuchat-parser')
    for (const consumer of [
      'server/fastify/src/prompt/cbsAdapter.ts',
      'server/fastify/src/prompt/promptVariablesBoot.ts',
      'server/fastify/src/prompt/variables.ts',
    ]) {
      const text = source(consumer)
      expect(text, consumer).toContain('@risuai/shared-core/')
      expect(text, consumer).not.toContain('src/ts/cbs')
      expect(text, consumer).not.toContain('src/ts/parser/risuChatParser')
    }
  })
})
