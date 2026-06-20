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

describe('BotSettings model settings shell routing', () => {
  it('routes Settings -> Model to the profile-first shell while preserving prompt controls', () => {
    const source = botSettingsSource()

    expect(source).toContain("import ModelSettingsShell from './Model/ModelSettingsShell.svelte'")
    expect(source).toMatch(/\{#if settingsKind === 'model'\}\s*<ModelSettingsShell \/>/)
    expect(source).toContain('{:else}\n  <h2')
    expect(source).toContain("{#if settingsKind === 'prompt'}")
    expect(source).toContain("setPromptPresetModelOverrideEnabled('parameters', enabled)")
    expect(source).toContain('<SettingRenderer')
    expect(source).toContain("presetMirrorTarget={promptParameterOverrideMode ? 'promptModelOverrides' : 'auto'}")
  })
})

describe('BotSettings prompt preset launcher layout', () => {
  it('renders the prompt preset launcher with the selected preset name below the override toggle', () => {
    const source = botSettingsSource()
    const promptHeaderBlock = source.match(
      /\{#if settingsKind === 'prompt'\}([\s\S]*?)\n  \{\/if\}\n\n  \{#if showSubmenuSwitcher\}/,
    )?.[1]

    expect(source).toContain(
      'let selectedPromptPresetName = $derived(selectedPromptPreset?.name?.trim() || language.promptPresets)',
    )
    expect(promptHeaderBlock).toBeDefined()
    expect(promptHeaderBlock ?? '').toContain('name={language.overrideModelParameters}')
    expect(promptHeaderBlock ?? '').toContain('onclick={openPromptPresetList}')
    expect(promptHeaderBlock ?? '').toContain('{selectedPromptPresetName}')
  })

  it('keeps the tab-body prompt preset launcher legacy-only', () => {
    const source = botSettingsSource()

    expect(source).toContain("let showPromptPresetButton = $derived(settingsKind === 'legacy' && submenu === -1)")
    expect(source).not.toContain('className="mt-4">{language.promptPresets}</Button>')
  })
})

describe('BotSettings model-role provider visibility', () => {
  it('uses the profile UI adapter to reveal provider-specific settings', () => {
    const source = botSettingsSource()

    expect(source).toContain("import { resolveModelProfileUiState } from 'src/ts/model/modelProfileUiState'")
    expect(source).toContain('let modelProfileUiState = $derived.by(() =>')
    expect(source).toContain('resolveModelProfileUiState({')
    expect(source).toContain('database: DBState.db')
    expect(source).toContain('lookupModelInfo: (_database, id) => getModelInfo(id)')
    expect(source).toContain('let effectiveRoleApiKeyModels = $derived(modelProfileUiState.apiKeyModels)')
    expect(source).toContain('let usesGoogleCloudProvider = $derived(modelProfileUiState.usesGoogleCloudProvider)')
    expect(source).toContain('let usesReverseProxyModel = $derived(modelProfileUiState.usesReverseProxyModel)')
    expect(source).toContain('{#if usesNanoGPTModel}')
    expect(source).toContain('{#if usesOpenRouterModel}')
    expect(source).toContain('{#if usesOllamaLocal || usesOllamaCloud}')
    expect(source).toContain('{#if !usesOllamaCloud && usesStreamingModel}')
    expect(source).toContain('{#if usesOpenRouterModel || usesReverseProxyModel}')
    expect(source).not.toContain('resolveModelRoles')
    expect(source).not.toContain('let effectiveRoleModelIds')
    expect(source).not.toContain('let effectiveRoleModelInfos')
    expect(source).not.toContain('baseUsesOllamaCloud')
    expect(source).not.toContain("{#if DBState.db.aiModel === 'nanogpt' || DBState.db.subModel === 'nanogpt'}")
    expect(source).not.toContain("{#if DBState.db.aiModel === 'openrouter' || DBState.db.subModel === 'openrouter'}")
  })

  it('passes provider draft keys to dynamic model catalogs', () => {
    const source = botSettingsSource()

    expect(source).toContain('getNanoGPTModelCatalogs(nanogptKeyDraft.value)')
    expect(source).toMatch(/getNanoGPTModels\(\s*\{\s*apiKey\s*\}\s*\)/)
    expect(source).toContain('getNanoGPTSubscriptionModels(apiKey)')
    expect(source).toMatch(/getOpenRouterModels\(\s*\{\s*apiKey:\s*openrouterKeyDraft\.value,?\s*\},?\s*\)/)
    expect(source).toContain('<OpenrouterSettings apiKey={openrouterKeyDraft.value} />')
  })
})
