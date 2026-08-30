import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('inlay-token shared-core ownership', () => {
  it('keeps both production consumers on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/inlay-tokens'"
    for (const consumer of ['src/ts/process/memory/hypav3.ts', 'server/fastify/src/memorySummaryPrompt.ts']) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    expect(fs.existsSync(new URL('src/ts/util/inlayTokens.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
