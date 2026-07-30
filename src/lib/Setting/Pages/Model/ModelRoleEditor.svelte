<script lang="ts">
  import { PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import AllSeperateParameters from 'src/lib/Others/AllSeperateParameters.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import type { ServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'
  import type {
    LegacyFallbackModelKey,
    LegacyFallbackModelMap,
    ModelRole,
    NormalizedModelRoleOverrides,
  } from 'src/ts/model/modelRoles'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'

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

  interface Props {
    role: ModelRole
    roleLabel: string
    roleDescription: string
    sourceLabel: string
    providerVerdict: string
    requestModel: string
    fallbackCount: string
    effectiveModel: string
    supportsParameters: boolean
    fallbackKey?: LegacyFallbackModelKey
    roleModelMode: RoleModelMode
    modelRolesDraft: ServerBackedSettingDraft<NormalizedModelRoleOverrides>
    seperateParametersEnabledDraft: ServerBackedSettingDraft<boolean>
    seperateParametersByModelDraft: ServerBackedSettingDraft<boolean>
    seperateParametersDraft: ServerBackedSettingDraft<SeparateParameterSettings>
    fallbackModelsDraft: ServerBackedSettingDraft<LegacyFallbackModelMap>
    fallbackWhenBlankResponseDraft: ServerBackedSettingDraft<boolean>
    doNotChangeFallbackModelsDraft: ServerBackedSettingDraft<boolean>
    modelName: (model: string) => string
    setBaseRoleModel: (role: ModelRole, model: string) => void
    setRoleOverride: (role: ModelRole, model: string) => void
    setFallbackModel: (key: LegacyFallbackModelKey, index: number, model: string) => void
    addFallbackModel: (key: LegacyFallbackModelKey) => void
    removeFallbackModel: (key: LegacyFallbackModelKey, index: number) => void
    closeEditor: () => void
  }

  let {
    role,
    roleLabel,
    roleDescription,
    sourceLabel,
    providerVerdict,
    requestModel,
    fallbackCount,
    effectiveModel,
    supportsParameters,
    fallbackKey,
    roleModelMode = $bindable('inherit'),
    modelRolesDraft,
    seperateParametersEnabledDraft,
    seperateParametersByModelDraft,
    seperateParametersDraft,
    fallbackModelsDraft,
    fallbackWhenBlankResponseDraft,
    doNotChangeFallbackModelsDraft,
    modelName,
    setBaseRoleModel,
    setRoleOverride,
    setFallbackModel,
    addFallbackModel,
    removeFallbackModel,
    closeEditor,
  }: Props = $props()

  function isOptionalRole(candidate: ModelRole): candidate is OptionalModelRole {
    return candidate !== 'chatMain' && candidate !== 'chatAux'
  }

  let fallbackModels = $derived(fallbackKey ? (fallbackModelsDraft.value[fallbackKey] ?? []) : [])

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeEditor()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div use:modalBackdropDismiss={closeEditor} data-modal-root class="fixed inset-0 z-50 flex justify-end bg-black/50">
  <div
    use:modalFocusTrap
    class="flex h-full w-full max-w-2xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label={language.modelRoles.editRole(roleLabel)}
    tabindex="-1"
    onkeydown={handleDialogKeydown}
    onclick={(event) => {
      event.stopPropagation()
    }}>
    <div class="flex items-start justify-between gap-3 border-b border-darkborderc p-4">
      <div class="min-w-0">
        <h3 class="truncate text-xl font-semibold">{roleLabel}</h3>
        <span class="text-sm text-textcolor2">{roleDescription}</span>
      </div>
      <button
        type="button"
        data-modal-initial-focus
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-darkbutton"
        aria-label={language.modelRoles.close}
        onclick={closeEditor}>
        <XIcon size={20} />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div class="rounded-md border border-darkborderc p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium">{language.modelRoles.resolvedProfile}</span>
          <span class="text-xs text-textcolor2">{sourceLabel}</span>
        </div>
        <div class="grid gap-2 text-sm sm:grid-cols-3">
          <div class="min-w-0">
            <span class="block text-xs text-textcolor2">{language.modelRoles.provider}</span>
            <span class="block truncate">{providerVerdict}</span>
          </div>
          <div class="min-w-0">
            <span class="block text-xs text-textcolor2">{language.modelRoles.requestModel}</span>
            <span class="block truncate">{requestModel}</span>
          </div>
          <div class="min-w-0">
            <span class="block text-xs text-textcolor2">{language.modelRoles.fallbackModels}</span>
            <span class="block truncate">{fallbackCount}</span>
          </div>
        </div>
      </div>

      <div class="rounded-md border border-darkborderc p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium">{language.modelRoles.modelSelection}</span>
          <span class="text-xs text-textcolor2">{sourceLabel}</span>
        </div>

        {#if role === 'chatMain' || role === 'chatAux'}
          <ModelList
            value={effectiveModel}
            onChange={(model) => {
              setBaseRoleModel(role, model)
            }}
            noMargin />
        {:else if isOptionalRole(role)}
          <SegmentedControl
            bind:value={roleModelMode}
            options={[
              { value: 'inherit', label: language.modelRoles.inherit },
              { value: 'override', label: language.modelRoles.override },
            ]}
            size="sm" />

          {#if roleModelMode === 'override'}
            <ModelList
              value={modelRolesDraft.value[role]}
              onChange={(model) => {
                setRoleOverride(role, model)
              }}
              noMargin />
          {:else}
            <div class="rounded-md bg-darkbg px-3 py-2 text-sm text-textcolor2">
              {language.modelRoles.inheritedModel}: {modelName(effectiveModel)}
            </div>
          {/if}
        {/if}
      </div>

      {#if supportsParameters}
        <Accordion name={language.modelRoles.roleParameters} styled>
          <div class="flex flex-col gap-3">
            <CheckInput bind:check={seperateParametersEnabledDraft.value} name={language.seperateParametersEnabled} />
            {#if seperateParametersByModelDraft.value}
              <span class="text-sm text-textcolor2">{language.modelRoles.parametersByModelNotice}</span>
            {:else if !seperateParametersEnabledDraft.value}
              <span class="text-sm text-textcolor2">{language.modelRoles.parametersDisabledNotice}</span>
            {:else if role === 'memory'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.memory} paramKey="memory" />
            {:else if role === 'translate'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.translate} paramKey="translate" />
            {:else if role === 'emotion'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.emotion} paramKey="emotion" />
            {:else if role === 'otherAx'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.otherAx} paramKey="otherAx" />
            {:else if role === 'scriptMain'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.scriptMain} paramKey="scriptMain" />
            {:else if role === 'scriptAux'}
              <AllSeperateParameters bind:value={seperateParametersDraft.value.scriptAux} paramKey="scriptAux" />
            {/if}
          </div>
        </Accordion>
      {/if}

      <Accordion name={language.modelRoles.fallbackModels} styled>
        {#if fallbackKey}
          <div class="flex flex-col gap-3">
            <CheckInput bind:check={fallbackWhenBlankResponseDraft.value} name={language.fallbackWhenBlankResponse} />
            <CheckInput bind:check={doNotChangeFallbackModelsDraft.value} name={language.doNotChangeFallbackModels} />

            {#each fallbackModels as model, index}
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <ModelList
                    value={model}
                    blankable
                    noMargin
                    onChange={(nextModel) => {
                      setFallbackModel(fallbackKey, index, nextModel)
                    }} />
                </div>
                <button
                  type="button"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600"
                  aria-label={language.remove}
                  onclick={() => {
                    if (!confirmSettingsItemRemoval()) return
                    removeFallbackModel(fallbackKey, index)
                  }}>
                  <TrashIcon size={18} />
                </button>
              </div>
            {/each}

            {#if fallbackModels.length === 0}
              <span class="text-sm text-textcolor2">{language.modelRoles.noFallbackModels}</span>
            {/if}

            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-md bg-selected text-textcolor hover:bg-darkbutton"
              aria-label={language.add}
              onclick={() => {
                addFallbackModel(fallbackKey)
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
