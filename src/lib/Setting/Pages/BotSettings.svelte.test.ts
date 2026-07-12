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

  it('does not dispatch prompt-field drafts after accepting selected-preset projection changes', () => {
    const source = botSettingsSource()

    expect(source).toContain('let previousDraftDispatchSnapshot = snapshotJson(initialValue)')
    expect(source).toContain('previousDraftDispatchSnapshot = serverSnapshot')
    expect(source).toContain('if (snapshot === previousDraftDispatchSnapshot) return')
    expect(source).toContain('if (snapshotJson(value) === snapshotJson(pendingPromptFieldPatch.previous[key]))')
  })

  it('preserves dirty prompt-field drafts across stale projection applies', () => {
    const source = botSettingsSource()

    expect(source).toContain('let previousResourceApplyEpoch = getServerResourceApplyEpoch()')
    expect(source).toContain('let previousOwnerSignature = promptFieldOwnerSignature()')
    expect(source).toContain('if (resourceApplyChanged && dirty)')
    expect(source).toContain('reassertDirtyPromptFieldDraftValue(key, draft.value)')
    expect(source).toContain("return selectedId ? `preset:${selectedId}` : 'root'")
    expect(source).toContain('if (ownerSignature !== previousOwnerSignature)')
  })

  it('gates prompt template UI on selected prompt preset ownership instead of stale top-level projection', () => {
    const source = botSettingsSource()

    expect(source).toContain(
      'let selectedPromptPresetOwnsPromptTemplate = $derived(selectedPromptPresetHasOwnPromptTemplate())',
    )
    expect(source).toContain('{:else if selectedPromptPresetOwnsPromptTemplate}')
    expect(source).toContain('{:else if !selectedPromptPresetOwnsPromptTemplate}')
    expect(source).toContain('{#if promptTemplateHydrated && selectedPromptPresetOwnsPromptTemplate && submenu === -1}')
    expect(source).not.toContain('{:else if getDatabase().promptTemplate}')
    expect(source).not.toContain('{:else if !getDatabase().promptTemplate}')
  })

  it('enables prompt templates on the selected prompt preset with a scoped command', () => {
    const source = botSettingsSource()

    expect(source).toContain('async function setSelectedPromptTemplateEnabled(enabled: boolean)')
    expect(source).toContain('ensurePromptTemplateHydrated({ promptPresetId: ownerId })')
    expect(source).toContain('preset.promptTemplate = cloneJsonValue(Array.isArray(template) ? template : [])')
    expect(source).toContain('getDatabase().promptTemplate = cloneJsonValue(Array.isArray(template) ? template : [])')
    expect(source).toContain('enablePromptItemsCommand({')
    expect(source).toContain('promptPresetId: promptTemplateOwnerCommandId(ownerId)')
    expect(source).toContain('enabled,')
  })

  it('hydrates prompt-template ownership when the selected prompt preset changes', () => {
    const source = botSettingsSource()

    expect(source).toContain(
      'let previousPromptTemplateOwnerHydrationSelection = promptTemplatePresetSelectionSignature()',
    )
    expect(source).toContain('function promptTemplatePresetSelectionSignature(): string')
    expect(source).toContain('const ownerId = currentPromptTemplateOwnerId()')
    expect(source).toContain('void ensurePromptTemplateHydrated({ promptPresetId: ownerId })')
    expect(source).toContain('void ensurePromptTemplateHydrated({ promptPresetId: currentPromptTemplateOwnerId() })')
  })

  it('disables prompt templates by removing selected preset ownership and clearing compatibility projection', () => {
    const source = botSettingsSource()

    expect(source).toContain('delete preset.promptTemplate')
    expect(source).toContain('delete (getDatabase() as unknown as Record<string, unknown>).promptTemplate')
    expect(source).toContain('rollback: () =>')
    expect(source).toContain('runPromptTemplateOwnerRollback(ownerId, () =>')
    expect(source).toContain('restoreSelectedPromptPresetTemplateProjection(previous)')
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
    expect(source).toContain('database: getDatabase()')
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
    expect(source).not.toContain("{#if getDatabase().aiModel === 'nanogpt' || getDatabase().subModel === 'nanogpt'}")
    expect(source).not.toContain(
      "{#if getDatabase().aiModel === 'openrouter' || getDatabase().subModel === 'openrouter'}",
    )
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
