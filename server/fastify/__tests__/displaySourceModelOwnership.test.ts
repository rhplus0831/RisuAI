import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('display-source model ownership', () => {
  it('resolves one chatMain identity for Lua and trigger contexts', () => {
    const displaySource = source('server/fastify/src/displaySourceService.ts')

    expect(displaySource).toContain("resolvePromptModelId(scope.database, 'chatMain')")
    expect(displaySource.match(/\n\s+model,\n/g)).toHaveLength(2)
    expect(displaySource).not.toContain('model: scope.database.aiModel')
  })
})
