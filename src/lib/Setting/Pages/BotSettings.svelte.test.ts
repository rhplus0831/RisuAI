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

  it('routes bias JSON imports through the freshness guard helper', () => {
    const source = botSettingsSource()

    expect(source).toContain("from 'src/ts/server/biasImport'")
    expect(source).toContain('async function importBiasJson()')
    expect(source).toContain("selectSingleFile(['json'], { onFileSelected: beginImport })")
    expect(source).toContain('const importedBias = parseBiasImport')
    expect(source).toContain('resolveFreshBiasImportValue')
    expect(source).toContain('if (isFreshBiasImport(operation, currentBiasImportFreshness()))')
    expect(source).toContain('onclick={importBiasJson}')
    expect(source).not.toContain('JSON.parse(utf8)')
  })
})

describe('BotSettings model-role provider visibility', () => {
  it('uses effective model roles to reveal provider-specific settings', () => {
    const source = botSettingsSource()

    expect(source).toContain("import { resolveModelRoles } from 'src/ts/model/modelRoles'")
    expect(source).toContain('let effectiveRoleModelIds = $derived.by(() =>')
    expect(source).toContain('modelRoles: DBState.db.modelRoles')
    expect(source).toContain('seperateModelsForAxModels: DBState.db.seperateModelsForAxModels')
    expect(source).toContain('{#if usesNanoGPTModel}')
    expect(source).toContain('{#if usesOpenRouterModel}')
    expect(source).toContain('{#if usesOllamaLocal || usesOllamaCloud}')
    expect(source).toContain('{#if !usesOllamaCloud && usesStreamingModel}')
    expect(source).toContain('{#if usesOpenRouterModel || usesReverseProxyModel}')
    expect(source).not.toContain('baseUsesOllamaCloud')
    expect(source).not.toContain("{#if DBState.db.aiModel === 'nanogpt' || DBState.db.subModel === 'nanogpt'}")
    expect(source).not.toContain("{#if DBState.db.aiModel === 'openrouter' || DBState.db.subModel === 'openrouter'}")
  })
})
