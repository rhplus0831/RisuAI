import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const appSource = () => readFileSync(path.join(process.cwd(), 'src/App.svelte'), 'utf8')

describe('App route application effect', () => {
  it('keeps route application untracked so DB projection refreezes do not reset sidebar tabs', () => {
    const source = appSource()

    expect(source).toContain("import { untrack } from 'svelte'")
    expect(source).toMatch(
      /const route = \$currentRoute[\s\S]*?if \(consumeStateDrivenRouteUpdate\(\)\) return[\s\S]*?untrack\(\(\) => \{[\s\S]*?void applyRouteToStores\(route\)[\s\S]*?\}\)/,
    )
  })
})
