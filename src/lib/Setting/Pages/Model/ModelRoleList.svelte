<script lang="ts">
  import { PencilIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import AllSeperateParameters from 'src/lib/Others/AllSeperateParameters.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import { getModelInfo } from 'src/ts/model/modellist'
  import {
    resolveModelForRole,
    type LegacyFallbackModelKey,
    type LegacyFallbackModelMap,
    type LegacySeperateModelMap,
    type ModelRole,
    type NormalizedModelRoleOverrides,
  } from 'src/ts/model/modelRoles'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'

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

  function roleResolutionSource() {
    return {
      aiModel: aiModelDraft.value,
      subModel: subModelDraft.value,
      modelRoles: modelRolesDraft.value,
      seperateModelsForAxModels: seperateModelsForAxModelsDraft.value,
      seperateModels: seperateModelsDraft.value,
    }
  }

  function effectiveModelForRole(role: ModelRole): string {
    return resolveModelForRole(roleResolutionSource(), role)
  }

  function modelName(model: string): string {
    return getModelInfo(model)?.fullName || model || language.none
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
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="fixed inset-0 z-50 flex justify-end bg-black/50" role="button" tabindex="0" onclick={closeEditor}>
    <div
      class="flex h-full w-full max-w-2xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-label={language.modelRoles.editRole(labelForRole(selectedRole))}
      tabindex="-1"
      onclick={(event) => {
        event.stopPropagation()
      }}>
      <div class="flex items-start justify-between gap-3 border-b border-darkborderc p-4">
        <div class="min-w-0">
          <h3 class="truncate text-xl font-semibold">{labelForRole(selectedRole)}</h3>
          <span class="text-sm text-textcolor2">{descriptionForRole(selectedRole)}</span>
        </div>
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-darkbutton"
          aria-label={language.modelRoles.close}
          onclick={closeEditor}>
          <XIcon size={20} />
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-darkborderc p-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">{language.modelRoles.modelSelection}</span>
            <span class="text-xs text-textcolor2">{sourceLabelForRole(selectedDefinition)}</span>
          </div>

          {#if selectedRole === 'chatMain' || selectedRole === 'chatAux'}
            <ModelList
              value={effectiveModelForRole(selectedRole)}
              onChange={(model) => {
                setBaseRoleModel(selectedRole, model)
              }}
              noMargin />
          {:else if isOptionalRole(selectedRole)}
            <SegmentedControl
              bind:value={roleModelMode}
              options={[
                { value: 'inherit', label: language.modelRoles.inherit },
                { value: 'override', label: language.modelRoles.override },
              ]}
              size="sm" />

            {#if roleModelMode === 'override'}
              <ModelList
                value={modelRolesDraft.value[selectedRole]}
                onChange={(model) => {
                  setRoleOverride(selectedRole, model)
                }}
                noMargin />
            {:else}
              <div class="rounded-md bg-darkbg px-3 py-2 text-sm text-textcolor2">
                {language.modelRoles.inheritedModel}: {modelName(effectiveModelForRole(selectedRole))}
              </div>
            {/if}
          {/if}
        </div>

        {#if selectedSupportsParameters}
          <Accordion name={language.modelRoles.roleParameters} styled>
            <div class="flex flex-col gap-3">
              <CheckInput bind:check={seperateParametersEnabledDraft.value} name={language.seperateParametersEnabled} />
              {#if seperateParametersByModelDraft.value}
                <span class="text-sm text-textcolor2">{language.modelRoles.parametersByModelNotice}</span>
              {:else if !seperateParametersEnabledDraft.value}
                <span class="text-sm text-textcolor2">{language.modelRoles.parametersDisabledNotice}</span>
              {:else if selectedRole === 'memory'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.memory} paramKey="memory" />
              {:else if selectedRole === 'translate'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.translate} paramKey="translate" />
              {:else if selectedRole === 'emotion'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.emotion} paramKey="emotion" />
              {:else if selectedRole === 'otherAx'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.otherAx} paramKey="otherAx" />
              {:else if selectedRole === 'scriptMain'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.scriptMain} paramKey="scriptMain" />
              {:else if selectedRole === 'scriptAux'}
                <AllSeperateParameters bind:value={seperateParametersDraft.value.scriptAux} paramKey="scriptAux" />
              {/if}
            </div>
          </Accordion>
        {/if}

        <Accordion name={language.modelRoles.fallbackModels} styled>
          {#if selectedFallbackKey}
            <div class="flex flex-col gap-3">
              <CheckInput bind:check={fallbackWhenBlankResponseDraft.value} name={language.fallbackWhenBlankResponse} />
              <CheckInput bind:check={doNotChangeFallbackModelsDraft.value} name={language.doNotChangeFallbackModels} />

              {#each fallbackModelsFor(selectedFallbackKey) as model, index}
                <div class="flex items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <ModelList
                      value={model}
                      blankable
                      noMargin
                      onChange={(nextModel) => {
                        setFallbackModel(selectedFallbackKey, index, nextModel)
                      }} />
                  </div>
                  <button
                    type="button"
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600"
                    aria-label={language.remove}
                    onclick={() => {
                      removeFallbackModel(selectedFallbackKey, index)
                    }}>
                    <TrashIcon size={18} />
                  </button>
                </div>
              {/each}

              {#if fallbackModelsFor(selectedFallbackKey).length === 0}
                <span class="text-sm text-textcolor2">{language.modelRoles.noFallbackModels}</span>
              {/if}

              <button
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-md bg-selected text-textcolor hover:bg-darkbutton"
                aria-label={language.add}
                onclick={() => {
                  addFallbackModel(selectedFallbackKey)
                }}>
                <PlusIcon size={18} />
              </button>
            </div>
          {:else}
            <span class="text-sm text-textcolor2">{language.modelRoles.fallbackUnsupported}</span>
          {/if}
        </Accordion>
      </div>
    </div>
  </div>
{/if}
