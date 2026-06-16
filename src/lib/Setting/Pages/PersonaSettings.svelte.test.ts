import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PersonaSettings persistence contracts', () => {
  it('flushes pending selected-persona edits when the page is destroyed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PersonaSettings.svelte'), 'utf8')

    expect(source).toContain('flushPendingSelectedPersonaUpdate')
    expect(source).toMatch(/onDestroy\(\(\) => \{\s*void flushPendingSelectedPersonaUpdate\(\)/)
  })
})
