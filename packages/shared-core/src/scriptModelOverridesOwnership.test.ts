import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('script-model override shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/script-model-overrides'"
    for (const consumer of [
      'server/fastify/src/commands/characters.ts',
      'server/fastify/src/commands/modules.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/prompt/luaRuntime.ts',
      'src/lib/UI/ScriptModelOverrideSelectors.svelte',
      'src/ts/process/modules.ts',
      'src/ts/process/scriptings.ts',
      'src/ts/process/triggers.ts',
      'src/ts/server/characterBridge.svelte.ts',
      'src/ts/server/commands.ts',
      'src/ts/storage/database.svelte.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/model/scriptModelOverrides.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
