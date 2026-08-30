import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('internal-reasoning shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = [
      'server/fastify/src/generation/stripCoT.ts',
      'server/fastify/src/prompt/agentPresetExecution.ts',
      'server/fastify/src/translation/rawMessageTranslation.ts',
      'src/ts/translator/pipeline.ts',
      'src/ts/translator/translator.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/internal-reasoning'")
    }
    expect(fs.existsSync(new URL('src/ts/process/internalReasoning.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
