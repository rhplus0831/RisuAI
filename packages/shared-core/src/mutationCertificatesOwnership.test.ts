import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('mutation certificate shared-core ownership', () => {
  it('keeps browser facades and Fastify consumers on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/mutation-certificates'"
    for (const consumer of [
      'src/ts/personaMutationCertificate.ts',
      'src/ts/server/scriptDefinitionMutations.ts',
      'server/fastify/src/commands/personas.ts',
      'server/fastify/src/commands/scriptDefinitions.ts',
      'server/fastify/__tests__/commands.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(source('server/fastify/src/commands/personas.ts')).not.toContain('src/ts/personaMutationCertificate')
    expect(source('server/fastify/src/commands/scriptDefinitions.ts')).not.toContain(
      'src/ts/server/scriptDefinitionMutations',
    )
  })
})
