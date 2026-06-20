import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('ModelRoleList source contract', () => {
  function readModelRoleSources(): { list: string; editor: string; combined: string } {
    const list = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')
    const editor = readSource('src/lib/Setting/Pages/Model/ModelRoleEditor.svelte')
    return { list, editor, combined: `${list}\n${editor}` }
  }

  it('owns every canonical model role in the compact role list', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    for (const role of [
      'chatMain',
      'chatAux',
      'translate',
      'memory',
      'emotion',
      'otherAx',
      'scriptMain',
      'scriptAux',
    ]) {
      expect(source).toContain(`role: '${role}'`)
    }
  })

  it('extracts the role editor drawer into the reusable editor component', () => {
    const { list, editor } = readModelRoleSources()

    expect(list).toContain("import ModelRoleEditor from './ModelRoleEditor.svelte'")
    expect(list).toContain('<ModelRoleEditor')
    expect(list).toContain('bind:roleModelMode')
    expect(list).toContain('{modelRolesDraft}')
    expect(list).toContain('{seperateParametersDraft}')
    expect(list).toContain('{fallbackModelsDraft}')
    expect(list).not.toContain('role="dialog"')
    expect(list).not.toContain('aria-modal="true"')
    expect(list).not.toContain('event.stopPropagation()')

    expect(editor).toContain('role="dialog"')
    expect(editor).toContain('aria-modal="true"')
    expect(editor).toContain('event.stopPropagation()')
    expect(editor).toContain("roleModelMode = $bindable('inherit')")
    expect(editor).toContain('<SegmentedControl')
    expect(editor).toContain('<AllSeperateParameters')
    expect(editor).toContain('<ModelList')
  })

  it('edits base roles through legacy fields and optional roles through modelRoles', () => {
    const { list, editor } = readModelRoleSources()

    expect(list).toContain("createServerBackedSettingDraft<string>('aiModel'")
    expect(list).toContain("createServerBackedSettingDraft<string>('subModel'")
    expect(list).toContain("createServerBackedSettingDraft<NormalizedModelRoleOverrides>('modelRoles'")
    expect(list).toContain('aiModelDraft.value = model')
    expect(list).toContain('subModelDraft.value = model')
    expect(list).toContain('[role]: model.trim()')
    expect(editor).toContain('setBaseRoleModel(role, model)')
    expect(editor).toContain('setRoleOverride(role, model)')
    expect(editor).not.toContain('aiModelDraft.value = model')
    expect(editor).not.toContain('subModelDraft.value = model')
  })

  it('resolves read-only profile summaries from DBState plus legacy drafts', () => {
    const { list, editor } = readModelRoleSources()

    expect(list).toContain("import { DBState } from 'src/ts/stores.svelte'")
    expect(list).toContain('import { resolveModelProfile, type ResolvedModelProfile }')
    expect(list).toContain('const resolverCompatibilityDatabase = $derived.by<Database>(() => ({')
    expect(list).toContain('...DBState.db')
    for (const draftOverlay of [
      'aiModel: aiModelDraft.value',
      'subModel: subModelDraft.value',
      'modelRoles: modelRolesDraft.value',
      'seperateModelsForAxModels: seperateModelsForAxModelsDraft.value',
      'seperateModels: seperateModelsDraft.value',
      'fallbackModels: fallbackModelsDraft.value',
      'seperateParametersEnabled: seperateParametersEnabledDraft.value',
      'seperateParametersByModel: seperateParametersByModelDraft.value',
      'seperateParameters: seperateParametersDraft.value',
    ]) {
      expect(list).toContain(draftOverlay)
    }
    expect(list).toContain('function resolvedProfileForRole(role: ModelRole): ResolvedModelProfile')
    expect(list).toContain('return resolveModelProfile({')
    expect(list).toContain('database: resolverCompatibilityDatabase')
    expect(list).toContain('lookupModelInfo: (_database, id) => getModelInfo(id)')
    expect(editor).not.toContain('resolveModelProfile')
    expect(editor).not.toContain('resolverCompatibilityDatabase')
  })

  it('backs effective role models with the resolved profile model id', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain('function effectiveModelForRole(role: ModelRole): string')
    expect(source).toContain('return resolvedProfileForRole(role).modelId')
    expect(source).not.toContain('return resolveModelForRole(')
  })

  it('keeps all role-related writes on legacy flat setting drafts', () => {
    const { list, editor } = readModelRoleSources()

    for (const draft of [
      "createServerBackedSettingDraft<string>('aiModel'",
      "createServerBackedSettingDraft<string>('subModel'",
      "createServerBackedSettingDraft<NormalizedModelRoleOverrides>('modelRoles'",
      "createServerBackedSettingDraft<boolean>('seperateModelsForAxModels'",
      "createServerBackedSettingDraft<boolean>('doNotChangeSeperateModels'",
      "createServerBackedSettingDraft<LegacySeperateModelMap>('seperateModels'",
      "createServerBackedSettingDraft<LegacyFallbackModelMap>('fallbackModels'",
      "createServerBackedSettingDraft<boolean>('fallbackWhenBlankResponse'",
      "createServerBackedSettingDraft<boolean>('doNotChangeFallbackModels'",
      "createServerBackedSettingDraft<boolean>('seperateParametersEnabled'",
      "createServerBackedSettingDraft<boolean>('seperateParametersByModel'",
      "createServerBackedSettingDraft<SeparateParameterSettings>('seperateParameters'",
    ]) {
      expect(list).toContain(draft)
      expect(editor).not.toContain(draft)
    }
  })

  it('keeps source-label and role mode write effects in the list', () => {
    const { list, editor } = readModelRoleSources()

    expect(list).toContain('function sourceLabelForRole(definition: RoleDefinition): string')
    expect(list).toContain('if (hasCanonicalOverride(role)) return language.modelRoles.sourceOverride')
    expect(list).toContain('if (legacyModelForRole(role)) return language.modelRoles.sourceLegacy')
    expect(list).toContain('let suppressRoleModelModeWrite = false')
    expect(list).toContain("if (mode === 'override')")
    expect(list).toContain('setRoleOverride(role, effectiveModelForRole(role))')
    expect(list).toContain("setRoleOverride(role, '')")

    expect(editor).not.toContain('function sourceLabelForRole')
    expect(editor).not.toContain('suppressRoleModelModeWrite')
    expect(editor).not.toContain('effectiveModelForRole(role)')
  })

  it('does not introduce durable profile storage drafts', () => {
    const { combined } = readModelRoleSources()

    expect(combined).not.toContain('modelProfiles')
    expect(combined).not.toContain('profileBindings')
    expect(combined).not.toContain("createServerBackedSettingDraft('modelProfiles")
    expect(combined).not.toContain("createServerBackedSettingDraft('profileBindings")
  })

  it('keeps role fallback slots aligned with supported request fallback keys', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain("chatMain: 'model'")
    expect(source).not.toContain("chatAux: 'submodel'")
    for (const key of ['memory', 'emotion', 'translate', 'otherAx', 'scriptMain', 'scriptAux']) {
      expect(source).toContain(`${key}: '${key}'`)
    }
  })

  it('replaces legacy aux selector entry points in settings pages', () => {
    const botSettings = readSource('src/lib/Setting/Pages/BotSettings.svelte')
    const promptSettings = readSource('src/lib/Setting/Pages/PromptSettings.svelte')

    expect(botSettings).toContain('<ModelRoleList />')
    expect(botSettings).not.toContain('AuxModelSelectors')
    expect(promptSettings).not.toContain('AuxModelSelectors')
  })

  it('keeps the legacy separate-model toggle visible while legacy fields remain supported', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain("createServerBackedSettingDraft<boolean>('seperateModelsForAxModels'")
    expect(source).toContain('language.modelRoles.legacySeparateModels')
  })
})

describe('Model profile-first role shell source contract', () => {
  it('uses the canonical MODEL_ROLES order for the profile-first roles tab', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte')

    expect(source).toContain('import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole }')
    expect(source).toContain('{#each MODEL_ROLES as role (role)}')
    expect(source).not.toContain("role: 'chatMain'")
    expect(source).not.toContain("role: 'chatAux'")
  })

  it('applies role binding drafts through the Phase 2 command wrapper', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte')

    expect(source).toContain('let draftBindings = $state<ModelRoleProfileMap>')
    expect(source).toContain('let changedBindings = $derived.by(() => collectChangedBindings())')
    expect(source).toContain('function resetDraft()')
    expect(source).toContain('async function applyDraft()')
    expect(source).toContain('runServerCommand({')
    expect(source).toContain('command: (baseRevision) =>')
    expect(source).toContain('updateModelRoleProfilesCommand({')
    expect(source).toContain('baseRevision,')
    expect(source).toContain('bindings,')
    expect(source).toContain('{language.modelProfiles.cancel}')
    expect(source).toContain('{applying ? language.modelProfiles.applying : language.modelProfiles.apply}')
  })

  it('does not write legacy flat fields in the profile-first roles tab', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte')

    for (const legacyWrite of [
      "createServerBackedSettingDraft<string>('aiModel'",
      "createServerBackedSettingDraft<string>('subModel'",
      "createServerBackedSettingDraft<NormalizedModelRoleOverrides>('modelRoles'",
      "createServerBackedSettingDraft<boolean>('seperateModelsForAxModels'",
      'aiModelDraft.value = model',
      'subModelDraft.value = model',
      '[role]: model.trim()',
      'setRoleOverride(',
      'setBaseRoleModel(',
    ]) {
      expect(source).not.toContain(legacyWrite)
    }
  })

  it('renders the required profile-first role summary columns', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte')

    for (const column of [
      'language.modelProfiles.roleColumn',
      'language.modelProfiles.bindingModeColumn',
      'language.modelProfiles.inheritedSourceColumn',
      'language.modelProfiles.effectiveProfileColumn',
      'language.modelProfiles.providerModelColumn',
      'language.modelProfiles.statusColumn',
      'language.modelProfiles.fallbackColumn',
    ]) {
      expect(source).toContain(column)
    }

    expect(source).toContain('function effectiveProfileName(role: ModelRole): string')
    expect(source).toContain('function providerModelSummary(role: ModelRole): string')
    expect(source).toContain('function statusLabel(role: ModelRole): string')
    expect(source).toContain('function fallbackCount(role: ModelRole): string')
  })
})

describe('Model profile-first profiles tab source contract', () => {
  it('renders fallback counts from each durable profile record', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileList.svelte')

    expect(source).toContain('language.modelProfiles.fallbackColumn')
    expect(source).toContain('function fallbackCount(profile: ModelProfileRecord): string')
    expect(source).toContain('return language.modelRoles.fallbackCount(profile.fallbacks?.length ?? 0)')
    expect(source).toContain('{fallbackCount(profile)}')
  })

  it('opens the full profile editor drawer and runtime defaults editor', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelProfileList.svelte')

    expect(source).toContain("import ModelProfileEditorDrawer from './ModelProfileEditorDrawer.svelte'")
    expect(source).toContain("import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'")
    expect(source).toContain('<ModelRuntimeDefaultsEditor />')
    expect(source).toContain('<ModelProfileEditorDrawer')
    expect(source).toContain('createModelProfileCommand({')
    expect(source).toContain('updateModelProfileCommand({')
    expect(source).toContain('duplicateModelProfileCommand({')
    expect(source).toContain('deleteModelProfileCommand({')
    expect(source).not.toContain("createServerBackedSettingDraft('modelProfiles")
    expect(source).not.toContain('SettingRenderer')
  })

  it('keeps provider, runtime, and fallback editing in isolated drawer components', () => {
    const drawer = readSource('src/lib/Setting/Pages/Model/ModelProfileEditorDrawer.svelte')
    const provider = readSource('src/lib/Setting/Pages/Model/ModelProviderPanel.svelte')
    const runtime = readSource('src/lib/Setting/Pages/Model/ModelRuntimeOptionsEditor.svelte')
    const defaults = readSource('src/lib/Setting/Pages/Model/ModelRuntimeDefaultsEditor.svelte')

    expect(drawer).toContain("import ModelProviderPanel from './ModelProviderPanel.svelte'")
    expect(drawer).toContain("import ModelRuntimeOptionsEditor from './ModelRuntimeOptionsEditor.svelte'")
    expect(drawer).toContain("import ModelFallbackEditor from './ModelFallbackEditor.svelte'")
    expect(drawer).toContain('modelProfileSecretValueForSave')
    expect(drawer).toContain('fixedModelProviderIds.has(nextProviderId) ? nextProviderId : modelId.trim()')
    expect(drawer).toContain('if (!canEditProviderFields || !providerIsFirstClass)')
    expect(drawer).toContain('window.confirm(language.modelProfiles.discardProfileChangesConfirm)')

    for (const providerId of ['openai', 'anthropic', 'google', 'vertex', 'custom-api', 'debug-echo']) {
      expect(provider).toContain(`providerId === '${providerId}'`)
    }
    expect(provider).toContain("baseUrl.toLowerCase().includes('/chat/completions')")
    expect(provider).toContain('<KeyValueRowsEditor')
    expect(provider).not.toContain('<ModelList')

    expect(runtime).toContain('normalizeModelProfileRuntimeOptions')
    expect(runtime).toContain('delete next[key]')
    expect(runtime).toContain('runtimeFields.maxContext')
    expect(runtime).toContain('runtimeFields.enableCustomFlags')

    expect(defaults).toContain('updateModelRuntimeDefaultsCommand({')
    expect(defaults).toContain('<ModelRuntimeOptionsEditor bind:value={draft} />')
  })
})

describe('Model profile-first presets tab source contract', () => {
  it('routes Settings -> Model through a dedicated model presets tab', () => {
    const shell = readSource('src/lib/Setting/Pages/Model/ModelSettingsShell.svelte')

    expect(shell).toContain("import ModelPresetList from './ModelPresetList.svelte'")
    expect(shell).toContain("type ModelSettingsTab = 'roles' | 'profiles' | 'presets'")
    expect(shell).toContain("{ value: 'presets', label: language.modelProfiles.presetsTab }")
    expect(shell).toContain('<ModelPresetList />')
  })

  it('creates profile-aware model presets from durable role bindings only', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelPresetList.svelte')

    expect(source).toContain("import { createModelRoleBindingPresetSnapshot } from 'src/ts/model/modelPresetSnapshots'")
    expect(source).toContain('createModelPreset(createModelRoleBindingPresetSnapshot(DBState.db, name))')
    expect(source).toContain('updateModelPreset(index, { modelRoleProfiles: snapshot.modelRoleProfiles })')
    expect(source).toContain('selectModelPreset(index)')
    expect(source).toContain('reorderModelPresets(index, index + 2)')
    expect(source).toContain("hasPresetField(selectedPromptPreset, 'modelRoleProfiles')")
    expect(source).toContain('language.modelProfiles.promptPresetRoleOverrideNotice(selectedPromptPresetName())')
    expect(source).not.toContain('prebuiltPresets.OAI2')
  })
})
