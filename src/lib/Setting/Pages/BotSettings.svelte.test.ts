import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function botSettingsSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/BotSettings.svelte'), 'utf8')
}

describe('BotSettings prompt edit persistence contracts', () => {
  it('flushes pending prompt-field edits when the page is destroyed', () => {
    const source = botSettingsSource()

    expect(source).toContain('function flushPendingPromptFieldPatch()')
    expect(source).toMatch(/onDestroy\(\(\) => \{\s*flushPendingPromptFieldPatch\(\)\s*\}\)/)
    expect(source).not.toMatch(/onDestroy\(\(\) => \{\s*if \(pendingPromptFieldPatch\.timer\)/)
  })

  it('resolves prompt preset regex fields through the shared legacy alias helper', () => {
    const source = botSettingsSource()

    expect(source).toContain('resolvePromptPresetRegexField')
    expect(source).toContain('const regexField = resolvePromptPresetRegexField(preset)')
  })

  it('routes prompt preset icon uploads through the freshness guard helper', () => {
    const source = botSettingsSource()

    expect(source).toContain("from 'src/ts/server/promptPresetIconUpload'")
    expect(source).toContain('async function uploadSelectedPromptPresetIcon()')
    expect(source).toContain('onclick={uploadSelectedPromptPresetIcon}')
    expect(source).toContain('beginPromptPresetIconUpload(target)')
    expect(source).toContain('resolveFreshPromptPresetIconUploadIndex')
    expect(source).not.toContain('updatePromptPreset(DBState.db.promptPresetsId, { image: data })')
  })
})
