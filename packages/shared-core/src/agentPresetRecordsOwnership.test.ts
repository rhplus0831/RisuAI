import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('agent-preset-records shared-core ownership', () => {
  it('keeps the browser facade and every Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/agent-preset-records'
    expect(source('src/ts/agentPresetRecords.ts')).toContain(sharedSubpath)

    for (const consumer of [
      'server/fastify/src/commands/agentPresets.ts',
      'server/fastify/src/commands/presets.ts',
      'server/fastify/src/prompt/agentPresetExecution.ts',
      'server/fastify/src/prompt/assemble.ts',
      'server/fastify/src/prompt/agentPresetErrors.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/routes/commands.ts',
      'server/fastify/__tests__/agentPresetExecution.test.ts',
      'server/fastify/__tests__/assemble.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/agentPresetRecords')
    }
  })
})
