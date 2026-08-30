import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('generation finalization retry type ownership', () => {
  it('keeps the retained message envelope Fastify-owned', () => {
    const owner = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/generationFinalizationRetry.ts'), 'utf8')

    expect(owner).not.toContain('src/ts/storage/database.svelte')
    expect(owner).toContain('export interface GenerationFinalizationMessage')
    expect(owner).toContain("role: 'user' | 'char'")
    expect(owner).toContain('generationId?: string')
  })
})
