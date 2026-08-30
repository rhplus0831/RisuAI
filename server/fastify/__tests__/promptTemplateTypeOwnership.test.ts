import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('prompt template server type ownership', () => {
  it('keeps prompt-template consumers behind a closed Fastify-owned union', () => {
    const consumers = [
      'server/fastify/src/prompt/assemble.ts',
      'server/fastify/src/prompt/memory.ts',
      'server/fastify/src/prompt/preflight.ts',
      'server/fastify/src/prompt/templates.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toContain("from '../../../../src/ts/process/prompt'")
    }

    const owner = source('server/fastify/src/prompt/promptTemplate.ts')
    expect(owner).toContain('export type PromptTemplateCard =')
    for (const type of [
      'plain',
      'jailbreak',
      'cot',
      'chatML',
      'persona',
      'description',
      'lorebook',
      'postEverything',
      'memory',
      'authornote',
      'chat',
      'cache',
    ]) {
      expect(owner).toContain(`'${type}'`)
    }
    expect(owner).toContain("rangeEnd: number | 'end'")
    expect(owner).toContain("role: 'user' | 'assistant' | 'system' | 'all'")
  })
})
