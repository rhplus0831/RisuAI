import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('agent-only lorebook shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/agent-only-lorebook'"
    for (const consumer of [
      'server/fastify/src/prompt/lorebook.ts',
      'src/lib/SideBars/LoreBook/LoreBookData.svelte',
      'src/ts/agentLorebookInputs.ts',
      'src/ts/process/lorebook.svelte.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
  })
})
