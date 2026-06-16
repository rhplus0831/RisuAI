import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SeparateParametersSection row rendering contract', () => {
  it('renders only base separate-parameter rows and not the overrides map', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/Setting/Pages/SeparateParametersSection.svelte'),
      'utf8',
    )

    expect(source).toContain('baseSeparateParameterKeys')
    expect(source).not.toContain('Object.keys(seperateParametersDraft.value)')
  })
})
