import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('memory summary message server type ownership', () => {
  it('keeps all memory summary consumers behind a Fastify-owned record', () => {
    const consumers = [
      'server/fastify/src/memoryPlanner.ts',
      'server/fastify/src/memoryChunkPlanner.ts',
      'server/fastify/src/memorySummaryPrompt.ts',
      'server/fastify/src/memorySummaryAdapter.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toContain('src/ts/process/index.svelte')
    }

    const owner = source('server/fastify/src/memorySummaryMessage.ts')
    expect(owner).toContain('export interface MemorySummaryMessage')
    expect(owner).toContain('export interface MemorySummaryMultimodal')
  })
})
