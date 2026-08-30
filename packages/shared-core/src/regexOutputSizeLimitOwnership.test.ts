import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('regex output-size shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = [
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/prompt/boundedRegex.ts',
      'server/fastify/src/prompt/scripts.ts',
      'server/fastify/src/routes/commands.ts',
      'src/ts/process/regexWorkerRuntime.ts',
      'src/ts/process/scripts.ts',
      'src/ts/setting/advancedSettingsData.ts',
      'src/ts/storage/database.svelte.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/regex-output-size-limit'")
    }
    expect(fs.existsSync(new URL('src/ts/regexOutputSizeLimit.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
