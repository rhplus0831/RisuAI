import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('ModelRoleList source contract', () => {
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

  it('edits base roles through legacy fields and optional roles through modelRoles', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain("createServerBackedSettingDraft<string>('aiModel'")
    expect(source).toContain("createServerBackedSettingDraft<string>('subModel'")
    expect(source).toContain("createServerBackedSettingDraft<NormalizedModelRoleOverrides>('modelRoles'")
    expect(source).toContain('aiModelDraft.value = model')
    expect(source).toContain('subModelDraft.value = model')
    expect(source).toContain('[role]: model.trim()')
  })

  it('resolves read-only profile summaries from DBState plus legacy drafts', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain("import { DBState } from 'src/ts/stores.svelte'")
    expect(source).toContain('import { resolveModelProfile, type ResolvedModelProfile }')
    expect(source).toContain('const resolverCompatibilityDatabase = $derived.by<Database>(() => ({')
    expect(source).toContain('...DBState.db')
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
      expect(source).toContain(draftOverlay)
    }
    expect(source).toContain('function resolvedProfileForRole(role: ModelRole): ResolvedModelProfile')
    expect(source).toContain('return resolveModelProfile({')
    expect(source).toContain('database: resolverCompatibilityDatabase')
    expect(source).toContain('lookupModelInfo: (_database, id) => getModelInfo(id)')
  })

  it('backs effective role models with the resolved profile model id', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).toContain('function effectiveModelForRole(role: ModelRole): string')
    expect(source).toContain('return resolvedProfileForRole(role).modelId')
    expect(source).not.toContain('return resolveModelForRole(')
  })

  it('keeps all role-related writes on legacy flat setting drafts', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

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
      expect(source).toContain(draft)
    }
  })

  it('does not introduce durable profile storage drafts', () => {
    const source = readSource('src/lib/Setting/Pages/Model/ModelRoleList.svelte')

    expect(source).not.toContain('modelProfiles')
    expect(source).not.toContain('profileBindings')
    expect(source).not.toContain("createServerBackedSettingDraft('modelProfiles")
    expect(source).not.toContain("createServerBackedSettingDraft('profileBindings")
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
