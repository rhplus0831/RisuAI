import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('agent-preset output-reference shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = [
      'src/ts/agentPresetResolver.ts',
      'server/fastify/src/prompt/variables.ts',
      'server/fastify/src/prompt/agentPresetExecution.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/agent-preset-output-references'")
    }
    expect(fs.existsSync(new URL('src/ts/agentPresetReferences.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
