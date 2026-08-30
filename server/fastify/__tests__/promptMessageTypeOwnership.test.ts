import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('prompt message server type ownership', () => {
  it('keeps rendering and budget consumers behind a Fastify-owned record', () => {
    const consumers = [
      'server/fastify/src/prompt/history.ts',
      'server/fastify/src/prompt/memory.ts',
      'server/fastify/src/prompt/budgetFinalize.ts',
      'server/fastify/src/prompt/preflight.ts',
      'server/fastify/src/prompt/templates.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toContain('src/ts/process/index.svelte')
    }

    const owner = source('server/fastify/src/prompt/promptMessage.ts')
    expect(owner).toContain('export interface PromptMessage')
    expect(owner).toContain('export interface PromptMultimodal')
  })
})
