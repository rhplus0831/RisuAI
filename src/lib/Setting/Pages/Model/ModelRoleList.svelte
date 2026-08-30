<script lang="ts">
  import { PencilIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import {
    resolveModelProfileWithLegacyCompatibility,
    type ResolvedModelProfile,
  } from 'src/ts/model/modelProfileResolver'
  import { getModelInfo } from 'src/ts/model/modellist'
  import {
    type LegacyFallbackModelKey,
    type LegacyFallbackModelMap,
    type LegacySeperateModelMap,
    type ModelRole,
    type NormalizedModelRoleOverrides,
  } from '@risuai/shared-core/model-roles'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { getDatabase, type Database, type SeparateParameters } from 'src/ts/storage/database.svelte'
  import ModelRoleEditor from './ModelRoleEditor.svelte'

  type OptionalModelRole = Exclude<ModelRole, 'chatMain' | 'chatAux'>
  type RoleModelMode = 'inherit' | 'override'

  type SeparateParameterSettings = {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    scriptMain: SeparateParameters
    scriptAux: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }

  interface RoleDefinition {
    role: ModelRole
    inheritsFrom?: ModelRole
  }

  const roleDefinitions: RoleDefinition[] = [
    { role: 'chatMain' },
    { role: 'chatAux' },
    { role: 'translate', inheritsFrom: 'chatAux' },
    { role: 'memory', inheritsFrom: 'chatAux' },
    { role: 'emotion', inheritsFrom: 'chatAux' },
    { role: 'otherAx', inheritsFrom: 'chatAux' },
    { role: 'scriptMain', inheritsFrom: 'chatMain' },
    { role: 'scriptAux', inheritsFrom: 'chatAux' },
  ]

  const fallbackKeyByRole: Partial<Record<ModelRole, LegacyFallbackModelKey>> = {
    chatMain: 'model',
    memory: 'memory',
    emotion: 'emotion',
    translate: 'translate',
    otherAx: 'otherAx',
    scriptMain: 'scriptMain',
    scriptAux: 'scriptAux',
  }

  const parameterRoles = new Set<ModelRole>(['memory', 'emotion', 'translate', 'otherAx', 'scriptMain', 'scriptAux'])

  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')
  const subModelDraft = createServerBackedSettingDraft<string>('subModel', '')
  const modelRolesDraft = createServerBackedSettingDraft<NormalizedModelRoleOverrides>('modelRoles', {
    chatMain: '',
    chatAux: '',
    memory: '',
    emotion: '',
    translate: '',
    otherAx: '',
    scriptMain: '',
    scriptAux: '',
  })
  const seperateModelsForAxModelsDraft = createServerBackedSettingDraft<boolean>('seperateModelsForAxModels', false)
  const doNotChangeSeperateModelsDraft = createServerBackedSettingDraft<boolean>('doNotChangeSeperateModels', false)
  const seperateModelsDraft = createServerBackedSettingDraft<LegacySeperateModelMap>('seperateModels', {
    memory: '',
    emotion: '',
    translate: '',
    otherAx: '',
    scriptMain: '',
    scriptAux: '',
  })
  const fallbackModelsDraft = createServerBackedSettingDraft<LegacyFallbackModelMap>('fallbackModels', {
    model: [],
    memory: [],
    emotion: [],
    translate: [],
    otherAx: [],
    scriptMain: [],
    scriptAux: [],
  })
  const fallbackWhenBlankResponseDraft = createServerBackedSettingDraft<boolean>('fallbackWhenBlankResponse', false)
  const doNotChangeFallbackModelsDraft = createServerBackedSettingDraft<boolean>('doNotChangeFallbackModels', false)
  const seperateParametersEnabledDraft = createServerBackedSettingDraft<boolean>('seperateParametersEnabled', false)
  const seperateParametersByModelDraft = createServerBackedSettingDraft<boolean>('seperateParametersByModel', false)
  const seperateParametersDraft = createServerBackedSettingDraft<SeparateParameterSettings>('seperateParameters', {
    memory: {},
    emotion: {},
    translate: {},
    otherAx: {},
    scriptMain: {},
    scriptAux: {},
    overrides: {},
  })

  let selectedRole = $state<ModelRole | null>(null)
  let roleModelMode = $state<RoleModelMode>('inherit')
  let lastSyncedRole: ModelRole | null = null
  let lastSyncedRoleMode: RoleModelMode = 'inherit'
  let suppressRoleModelModeWrite = false

  let selectedDefinition = $derived(roleDefinitions.find((definition) => definition.role === selectedRole))
  let selectedFallbackKey = $derived(selectedRole ? fallbackKeyByRole[selectedRole] : undefined)
  let selectedSupportsParameters = $derived(selectedRole ? parameterRoles.has(selectedRole) : false)
  const resolverCompatibilityDatabase = $derived.by<Database>(() => ({
    ...getDatabase(),
    aiModel: aiModelDraft.value,
    subModel: subModelDraft.value,
    modelRoles: modelRolesDraft.value,
    seperateModelsForAxModels: seperateModelsForAxModelsDraft.value,
    doNotChangeSeperateModels: doNotChangeSeperateModelsDraft.value,
    seperateModels: seperateModelsDraft.value,
    fallbackModels: fallbackModelsDraft.value,
    fallbackWhenBlankResponse: fallbackWhenBlankResponseDraft.value,
    doNotChangeFallbackModels: doNotChangeFallbackModelsDraft.value,
    seperateParametersEnabled: seperateParametersEnabledDraft.value,
    seperateParametersByModel: seperateParametersByModelDraft.value,
    seperateParameters: seperateParametersDraft.value,
  }))

  $effect(() => {
    const role = selectedRole
    const draftMode = role && isOptionalRole(role) && hasCanonicalOverride(role) ? 'override' : 'inherit'
    if (role !== lastSyncedRole || draftMode !== lastSyncedRoleMode) {
      suppressRoleModelModeWrite = true
      roleModelMode = draftMode
      lastSyncedRole = role
      lastSyncedRoleMode = draftMode
      queueMicrotask(() => {
        suppressRoleModelModeWrite = false
      })
    }
  })

  $effect(() => {
    const role = selectedRole
    const mode = roleModelMode
    if (!role || !isOptionalRole(role) || suppressRoleModelModeWrite) return

    if (mode === 'override') {
      if (!hasCanonicalOverride(role)) {
        setRoleOverride(role, effectiveModelForRole(role))
      }
    } else if (hasCanonicalOverride(role)) {
      setRoleOverride(role, '')
    }
  })

  function labelForRole(role: ModelRole): string {
    return language.modelRoles.roles[role]
  }

  function descriptionForRole(role: ModelRole): string {
    return language.modelRoles.descriptions[role]
  }

  function isOptionalRole(role: ModelRole): role is OptionalModelRole {
    return role !== 'chatMain' && role !== 'chatAux'
  }

  function hasCanonicalOverride(role: ModelRole): boolean {
    return isOptionalRole(role) && modelRolesDraft.value[role].trim() !== ''
  }

  function resolvedProfileForRole(role: ModelRole): ResolvedModelProfile {
    return resolveModelProfileWithLegacyCompatibility({
      database: resolverCompatibilityDatabase,
      role,
      lookupModelInfo: (_database, id) => getModelInfo(id),
    })
  }

  function effectiveModelForRole(role: ModelRole): string {
    return resolvedProfileForRole(role).modelId
  }

  function modelName(model: string): string {
    return getModelInfo(model)?.fullName || model || language.none
  }

  function providerVerdictForRole(role: ModelRole): string {
    const profile = resolvedProfileForRole(role)
    if (profile.modelInfo.unsupportedReason) {
      return language.modelRoles.providerUnavailable(profile.modelInfo.unsupportedReason)
    }
    const capability = profile.providerCapability
    if (capability.routable === true) return capability.provider
    return language.modelRoles.providerUnavailable(capability.reason)
  }

  function requestModelForRole(role: ModelRole): string {
    const profile = resolvedProfileForRole(role)
    return profile.requestModel.trim() || profile.modelId || language.none
  }

  function fallbackCountForRole(role: ModelRole): string {
    return language.modelRoles.fallbackCount(resolvedProfileForRole(role).fallbacks.length)
  }

  function legacyModelForRole(role: ModelRole): string {
    if (!seperateModelsForAxModelsDraft.value) return ''
    if (role === 'memory' || role === 'emotion' || role === 'translate' || role === 'otherAx') {
      return seperateModelsDraft.value[role]?.trim() ?? ''
    }
    if (role === 'scriptMain') {
      return seperateModelsDraft.value.scriptMain?.trim() ?? ''
    }
    if (role === 'scriptAux') {
      return seperateModelsDraft.value.scriptAux?.trim() || seperateModelsDraft.value.otherAx?.trim() || ''
    }
    return ''
  }

  function sourceLabelForRole(definition: RoleDefinition): string {
    const { role, inheritsFrom } = definition
    if (role === 'chatMain' || role === 'chatAux') return language.modelRoles.sourceBase
    if (hasCanonicalOverride(role)) return language.modelRoles.sourceOverride
    if (legacyModelForRole(role)) return language.modelRoles.sourceLegacy
    return language.modelRoles.sourceInherited(labelForRole(inheritsFrom ?? 'chatAux'))
  }

  function setRoleOverride(role: ModelRole, model: string): void {
    if (!isOptionalRole(role)) return
    modelRolesDraft.value = {
      ...modelRolesDraft.value,
      [role]: model.trim(),
    }
  }

  function setBaseRoleModel(role: ModelRole, model: string): void {
    if (role === 'chatMain') {
      aiModelDraft.value = model
    } else if (role === 'chatAux') {
      subModelDraft.value = model
    }
  }

  function fallbackModelsFor(key: LegacyFallbackModelKey): string[] {
    return fallbackModelsDraft.value[key] ?? []
  }

  function setFallbackModel(key: LegacyFallbackModelKey, index: number, model: string): void {
    const next = [...fallbackModelsFor(key)]
    next[index] = model
    fallbackModelsDraft.value = {
      ...fallbackModelsDraft.value,
      [key]: next,
    }
  }

  function addFallbackModel(key: LegacyFallbackModelKey): void {
    fallbackModelsDraft.value = {
      ...fallbackModelsDraft.value,
      [key]: [...fallbackModelsFor(key), ''],
    }
  }

  function removeFallbackModel(key: LegacyFallbackModelKey, index: number): void {
    fallbackModelsDraft.value = {
      ...fallbackModelsDraft.value,
      [key]: fallbackModelsFor(key).filter((_, candidateIndex) => candidateIndex !== index),
    }
  }

  function closeEditor(): void {
    selectedRole = null
  }
</script>

<section class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <h3 class="text-lg font-semibold">{language.modelRoles.title}</h3>
    <span class="text-sm text-textcolor2">{language.modelRoles.globalProviderNotice}</span>
  </div>

  <div class="overflow-hidden rounded-md border border-darkborderc">
    {#each roleDefinitions as definition}
      <button
        type="button"
        class="grid w-full grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_2.5rem] items-center gap-3 border-b border-darkborderc px-3 py-2 text-left last:border-b-0 hover:bg-darkbutton"
        onclick={() => {
          selectedRole = definition.role
        }}>
        <span class="min-w-0">
          <span class="block truncate font-medium">{labelForRole(definition.role)}</span>
          <span class="block truncate text-xs text-textcolor2">{descriptionForRole(definition.role)}</span>
        </span>
        <span class="min-w-0 text-right">
          <span class="block truncate text-sm">{modelName(effectiveModelForRole(definition.role))}</span>
          <span class="block truncate text-xs text-textcolor2">{sourceLabelForRole(definition)}</span>
          <span class="mt-1 flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-[11px] text-textcolor2">
            <span class="truncate">{language.modelRoles.provider}: {providerVerdictForRole(definition.role)}</span>
            <span class="truncate">{language.modelRoles.requestModel}: {requestModelForRole(definition.role)}</span>
            <span class="truncate">{fallbackCountForRole(definition.role)}</span>
          </span>
        </span>
        <span class="flex h-8 w-8 items-center justify-center rounded-md text-textcolor2">
          <PencilIcon size={18} />
        </span>
      </button>
    {/each}
  </div>

  <div class="flex items-center">
    <CheckInput bind:check={seperateModelsForAxModelsDraft.value} name={language.modelRoles.legacySeparateModels} />
  </div>

  <div class="flex items-center">
    <CheckInput bind:check={doNotChangeSeperateModelsDraft.value} name={language.doNotChangeSeperateModels} />
  </div>
</section>

{#if selectedRole && selectedDefinition}
  <ModelRoleEditor
    role={selectedRole}
    roleLabel={labelForRole(selectedRole)}
    roleDescription={descriptionForRole(selectedRole)}
    sourceLabel={sourceLabelForRole(selectedDefinition)}
    providerVerdict={providerVerdictForRole(selectedRole)}
    requestModel={requestModelForRole(selectedRole)}
    fallbackCount={fallbackCountForRole(selectedRole)}
    effectiveModel={effectiveModelForRole(selectedRole)}
    supportsParameters={selectedSupportsParameters}
    fallbackKey={selectedFallbackKey}
    bind:roleModelMode
    {modelRolesDraft}
    {seperateParametersEnabledDraft}
    {seperateParametersByModelDraft}
    {seperateParametersDraft}
    {fallbackModelsDraft}
    {fallbackWhenBlankResponseDraft}
    {doNotChangeFallbackModelsDraft}
    {modelName}
    {setBaseRoleModel}
    {setRoleOverride}
    {setFallbackModel}
    {addFallbackModel}
    {removeFallbackModel}
    {closeEditor} />
{/if}
