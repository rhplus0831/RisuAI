import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('standalone icon action names', () => {
  it('names parameter import and export actions', () => {
    const component = source('src/lib/Others/AllSeperateParameters.svelte')
    expect(component).toContain('aria-label={`${language.export}: ${language.parameters}`}')
    expect(component).toContain('aria-label={`${language.import}: ${language.parameters}`}')
  })

  it('names color scheme import and export actions', () => {
    const component = source('src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte')
    expect(component).toContain('aria-label={`${language.export}: ${language.colorScheme}`}')
    expect(component).toContain('aria-label={`${language.import}: ${language.colorScheme}`}')
  })

  it('names the prompt diff close action', () => {
    expect(source('src/lib/Others/PromptDiffModal.svelte')).toContain('aria-label={language.close}')
  })

  it('names every utility-link icon', () => {
    const component = source('src/lib/Others/GithubStars.svelte')
    expect(component).toContain('aria-label={language.home}')
    expect(component).toContain('aria-label="Patreon"')
    expect(component).toContain('aria-label="risuai@proton.me"')
    expect(component).toContain('aria-label={language.fullscreen}')
  })
})
