import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Hypa-V3-preset-selection-identity shared-core ownership', () => {
  it('publishes the browser/server-safe contract through its package subpath and root', () => {
    const manifest = JSON.parse(source('../package.json')) as { exports: Record<string, string> }
    expect(manifest.exports['./hypa-v3-preset-selection-identity']).toBe('./src/hypaV3PresetSelectionIdentity.ts')
    expect(source('./index.ts')).toContain("export * from './hypaV3PresetSelectionIdentity.js'")
  })

  it('keeps boundary repair deterministic and dependency-free', () => {
    const implementation = source('./hypaV3PresetSelectionIdentity.ts')
    expect(implementation).toContain('mintDeterministicHypaV3PresetId')
    expect(implementation).not.toContain('randomUUID')
    expect(implementation).not.toMatch(/^import /m)
  })
})
