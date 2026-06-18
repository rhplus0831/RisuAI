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
