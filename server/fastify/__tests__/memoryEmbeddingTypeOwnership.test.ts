import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('memory embedding server type ownership', () => {
  it('keeps production resolution and job consumers behind server-owned inputs', () => {
    const consumers = [
      'server/fastify/src/embeddingOperations.ts',
      'server/fastify/src/memoryEmbeddingModel.ts',
      'server/fastify/src/memoryEmbedJobHandler.ts',
    ]

    for (const consumer of consumers) {
      const contents = source(consumer)
      expect(contents).not.toContain('src/ts/storage/database.svelte')
      expect(contents).not.toContain('src/ts/process/memory/hypamemory')
    }

    const owner = source('server/fastify/src/memoryEmbeddingModel.ts')
    expect(owner).toContain('export type MemoryEmbeddingModel =')
    expect(owner).toContain('export interface MemoryEmbeddingSettings')
  })
})
