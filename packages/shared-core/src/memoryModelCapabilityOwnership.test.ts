import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('memory-model-capability shared-core ownership', () => {
  it('keeps the browser facade and both Fastify consumers on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/memory-model-capability'
    expect(source('src/ts/model/memoryModelCapability.ts')).toContain(sharedSubpath)

    for (const consumer of [
      'server/fastify/src/commands/modelProfiles.ts',
      'server/fastify/src/memorySummaryModel.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/model/memoryModelCapability')
    }
  })
})
