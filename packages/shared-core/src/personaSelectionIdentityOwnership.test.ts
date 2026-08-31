import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('persona-selection-identity shared-core ownership', () => {
  it('publishes the browser/server-safe contract through its package subpath and root', () => {
    const manifest = JSON.parse(source('../package.json')) as { exports: Record<string, string> }
    expect(manifest.exports['./persona-selection-identity']).toBe('./src/personaSelectionIdentity.ts')
    expect(source('./index.ts')).toContain("export * from './personaSelectionIdentity.js'")
  })

  it('keeps boundary repair deterministic and dependency-free', () => {
    const implementation = source('./personaSelectionIdentity.ts')
    expect(implementation).toContain('mintDeterministicPersonaId')
    expect(implementation).not.toContain('randomUUID')
    expect(implementation).not.toMatch(/^import /m)
  })
})
