import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('prompt memory query server type ownership', () => {
  it('keeps query source projection behind Fastify-owned records', () => {
    const owner = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/promptMemoryQuery.ts'), 'utf8')

    expect(owner).not.toContain('src/ts/storage/database.svelte')
    expect(owner).toContain('export interface PromptMemoryQueryMessage')
    expect(owner).toContain('export interface PromptMemoryQueryDatabase')
    expect(owner).toContain('extends MemoryEmbeddingSettings')
  })
})
