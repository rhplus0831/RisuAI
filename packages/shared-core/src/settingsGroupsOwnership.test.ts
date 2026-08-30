import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('settings-groups shared-core ownership', () => {
  it('keeps the browser compatibility facade and every Fastify consumer on shared core', () => {
    const sharedSubpath = '@risuai/shared-core/settings-groups'
    expect(source('src/ts/server/settingsGroups.ts')).toContain(sharedSubpath)

    for (const consumer of [
      'server/fastify/src/risuSave/importSnapshot.ts',
      'server/fastify/__tests__/phase3CompatibilityStructure.test.ts',
      'server/fastify/__tests__/phase5CompatibilityStructure.test.ts',
      'server/fastify/__tests__/settingsGroupParity.test.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedSubpath)
      expect(source(consumer), consumer).not.toContain('src/ts/server/settingsGroups')
    }
  })
})
