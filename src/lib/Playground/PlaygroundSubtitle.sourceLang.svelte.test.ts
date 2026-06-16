import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PlaygroundSubtitle source language selector', () => {
  it('writes source language changes back to the transcription sourceLang state', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Playground/PlaygroundSubtitle.svelte'), 'utf8')

    expect(source).toContain('value={sourceLang === null ?')
    expect(source).toContain("sourceLang = event.currentTarget.value === 'auto' ? null : event.currentTarget.value")
    expect(source).toContain('language: sourceLang')
  })
})
