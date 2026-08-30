import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('Fastify chat variable backend ownership', () => {
  it('keeps prompt runtime consumers on the server-local registry', () => {
    for (const consumer of [
      'server/fastify/src/prompt/cbsAdapter.ts',
      'server/fastify/src/prompt/promptVariablesBoot.ts',
      'server/fastify/src/prompt/promptScope.ts',
    ]) {
      expect(source(consumer), consumer).toContain("from './chatVarBackend.js'")
      expect(source(consumer), consumer).not.toContain('src/ts/parser/chatVarBackend')
    }
  })
})
