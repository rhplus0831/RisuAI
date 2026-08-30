import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('ChatML-row shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/chatml-rows'"
    for (const consumer of [
      'src/ts/parser/chatML.ts',
      'src/ts/agentPresetRecords.ts',
      'src/lib/Setting/Pages/AgentEditorDrawer.svelte',
      'server/fastify/src/prompt/templates.ts',
      'server/fastify/src/prompt/agentPresetExecution.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/parser/chatMLCore.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
