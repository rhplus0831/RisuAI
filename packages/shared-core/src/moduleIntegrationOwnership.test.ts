import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('module-integration shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/module-integration'"
    for (const consumer of [
      'server/fastify/src/prompt/effectiveGenerationConfig.ts',
      'src/ts/chatGenerationSettings.ts',
      'src/ts/moduleActivation.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/moduleIntegration.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
