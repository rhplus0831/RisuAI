import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSubtitleSource() {
  return readFileSync(resolve(process.cwd(), 'src/lib/Playground/PlaygroundSubtitle.svelte'), 'utf8')
}

describe('PlaygroundSubtitle source language selector', () => {
  it('writes source language changes back to the transcription sourceLang state', () => {
    const source = readSubtitleSource()

    expect(source).toContain('value={sourceLang === null ?')
    expect(source).toContain("sourceLang = event.currentTarget.value === 'auto' ? null : event.currentTarget.value")
    expect(source).toContain('language: sourceLang')
  })

  it('routes subtitle generation through the translate role', () => {
    const source = readSubtitleSource()
    const requestModes = [...source.matchAll(/requestChatData\([\s\S]*?\n\s*'([^']+)',\s*\)/g)].map((match) => match[1])

    expect(source).toContain("import { resolveModelForRole } from 'src/ts/model/modelRoles'")
    expect(source).toContain("let modelInfo = $derived(getModelInfo(resolveModelForRole(DBState.db, 'translate')))")
    expect(requestModes).toEqual(['translate', 'translate'])
  })
})
