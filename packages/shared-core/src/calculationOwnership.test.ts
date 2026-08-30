import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('calculation shared-core ownership', () => {
  it('keeps browser and Fastify adapters on the injected shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/calculation'"
    for (const consumer of [
      'src/ts/process/infunctions.ts',
      'server/fastify/src/prompt/cbsAdapter.ts',
      'server/fastify/src/prompt/triggerDataEffects.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(source('server/fastify/src/prompt/cbsAdapter.ts')).not.toContain('src/ts/process/infunctions')
    expect(source('server/fastify/src/prompt/triggerDataEffects.ts')).not.toContain('src/ts/process/infunctions')
  })
})
