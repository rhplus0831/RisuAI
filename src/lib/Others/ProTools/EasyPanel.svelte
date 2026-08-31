<script lang="ts">
  import { language } from 'src/lang'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import { easyPanelStore } from 'src/ts/stores.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import AllSeperateParameters from '../AllSeperateParameters.svelte'
  import { XIcon } from '@lucide/svelte'
  import CustomModelsSettings from 'src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte'
  import {
    createDefaultLegacySeperateModels,
    createDefaultModelRoleOverrides,
    type LegacySeperateModelMap,
    type ModelRole,
    type NormalizedModelRoleOverrides,
  } from '@risuai/shared-core/model-roles'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsOwner.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'
  import {
    beginSeperateParametersImport,
    captureSeperateParametersImportTarget,
    clearSeperateParametersImport,
    isFreshSeperateParametersImport,
    resolveFreshSeperateParametersImportValue,
    type SeperateParametersImportFreshness,
    type SeperateParametersImportOperation,
    type SeperateParametersImportSlotKind,
    type SeperateParametersImportTarget,
  } from 'src/ts/server/seperateParametersImport'

  type OptionalModelRole = Exclude<ModelRole, 'chatMain' | 'chatAux'>
  type SeperateParametersBaseKey = OptionalModelRole

  interface GuardedSeperateParametersImport {
    captureTarget: () => SeperateParametersImportTarget | null
    beginImport: (target: SeperateParametersImportTarget) => SeperateParametersImportOperation
    isFreshImport: (operation: SeperateParametersImportOperation) => boolean
    applyImport: (operation: SeperateParametersImportOperation, imported: SeparateParameters) => void
    clearImport: (operation: SeperateParametersImportOperation) => void
  }

  type SeparateParameterSettings = {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    scriptMain: SeparateParameters
    scriptAux: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }

  const optionalModelRoles = ['memory', 'translate', 'emotion', 'otherAx', 'scriptMain', 'scriptAux'] as const
  const seperateParametersBaseKeys = optionalModelRoles

  const seperateParametersEnabledDraft = createServerBackedSettingDraft<boolean>('seperateParametersEnabled', false)
  const doNotChangeSeperateModelsDraft = createServerBackedSettingDraft<boolean>('doNotChangeSeperateModels', false)
  const modelRolesDraft = createServerBackedSettingDraft<NormalizedModelRoleOverrides>(
    'modelRoles',
    createDefaultModelRoleOverrides(),
  )
  const seperateModelsDraft = createServerBackedSettingDraft<LegacySeperateModelMap>(
    'seperateModels',
    createDefaultLegacySeperateModels(),
  )
  const epEnabledDraft = createServerBackedSettingDraft<boolean>('epEnabled', false)
  const disableSeperateParameterChangeOnPresetChangeDraft = createServerBackedSettingDraft<boolean>(
    'disableSeperateParameterChangeOnPresetChange',
    false,
  )
  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')
  const subModelDraft = createServerBackedSettingDraft<string>('subModel', '')
  const seperateParametersDraft = createServerBackedSettingDraft<SeparateParameterSettings>('seperateParameters', {
    memory: {},
    emotion: {},
    translate: {},
    otherAx: {},
    scriptMain: {},
    scriptAux: {},
    overrides: {},
  })
  const seperateParametersByModelDraft = createServerBackedSettingDraft<boolean>('seperateParametersByModel', false)

  let selectedOption = $state('models')
  let selectedParameterOption = $state<SeperateParametersBaseKey>('memory')
  let parameterModelSelection = $state('')

  let hasEPRequirements = $derived.by(() => {
    return (
      seperateParametersEnabledDraft.value &&
      doNotChangeSeperateModelsDraft.value &&
      modelRolesDraft.value &&
      seperateModelsDraft.value &&
      epEnabledDraft.value &&
      disableSeperateParameterChangeOnPresetChangeDraft.value
    )
  })

  const onClose = () => {
    easyPanelStore.open = false
  }

  function enableEasyPanelRequirements(): void {
    seperateParametersEnabledDraft.value = true
    doNotChangeSeperateModelsDraft.value = true
    modelRolesDraft.value = { ...createDefaultModelRoleOverrides(), ...(modelRolesDraft.value ?? {}) }
    seperateModelsDraft.value = { ...createDefaultLegacySeperateModels(), ...(seperateModelsDraft.value ?? {}) }
    epEnabledDraft.value = true
    disableSeperateParameterChangeOnPresetChangeDraft.value = true
  }

  function labelForModelRole(role: OptionalModelRole): string {
    return language.modelRoles.roles[role]
  }

  function canonicalModelRoleOverride(role: OptionalModelRole): string {
    return modelRolesDraft.value[role]?.trim() ?? ''
  }

  function legacySeperateModelForRole(role: OptionalModelRole): string {
    return seperateModelsDraft.value[role]?.trim() ?? ''
  }

  function modelRoleSelectionValue(role: OptionalModelRole): string {
    return canonicalModelRoleOverride(role) || legacySeperateModelForRole(role)
  }

  function setOptionalRoleModel(role: OptionalModelRole, model: string): void {
    const normalized = model.trim()
    modelRolesDraft.value = {
      ...modelRolesDraft.value,
      [role]: normalized,
    }
    seperateModelsDraft.value = {
      ...seperateModelsDraft.value,
      [role]: normalized,
    }
  }

  function ensureParameterOverride(model: string): void {
    if (!model) return
    if (seperateParametersDraft.value.overrides?.[model]) return
    seperateParametersDraft.value = {
      ...seperateParametersDraft.value,
      overrides: {
        ...(seperateParametersDraft.value.overrides ?? {}),
        [model]: {},
      },
    }
  }

  function isSeperateParametersBaseKey(value: string): value is SeperateParametersBaseKey {
    return (seperateParametersBaseKeys as readonly string[]).includes(value)
  }

  function getSeperateParametersImportTargetSlot(
    slotKind: SeperateParametersImportSlotKind,
    targetKey: string,
  ): SeparateParameters | undefined {
    if (slotKind === 'base') {
      return isSeperateParametersBaseKey(targetKey) ? seperateParametersDraft.value[targetKey] : undefined
    }

    return seperateParametersDraft.value.overrides?.[targetKey]
  }

  function currentSeperateParametersImportFreshness(
    slotKind: SeperateParametersImportSlotKind,
    targetKey: string,
  ): SeperateParametersImportFreshness {
    const byModel = seperateParametersByModelDraft.value

    return {
      slotKind,
      targetKey,
      selectedOptionIsParameters: selectedOption === 'parameters',
      byModel,
      activeSelector: byModel ? parameterModelSelection : selectedParameterOption,
      targetSlot: getSeperateParametersImportTargetSlot(slotKind, targetKey),
    }
  }

  function captureBaseSeperateParametersImportTarget(
    baseKey: SeperateParametersBaseKey,
  ): SeperateParametersImportTarget | null {
    return captureSeperateParametersImportTarget(currentSeperateParametersImportFreshness('base', baseKey))
  }

  function captureOverrideSeperateParametersImportTarget(model: string): SeperateParametersImportTarget | null {
    return captureSeperateParametersImportTarget(currentSeperateParametersImportFreshness('override', model))
  }

  function isCurrentSeperateParametersImport(operation: SeperateParametersImportOperation): boolean {
    return isFreshSeperateParametersImport(
      operation,
      currentSeperateParametersImportFreshness(operation.slotKind, operation.targetKey),
    )
  }

  function applySeperateParametersImport(
    operation: SeperateParametersImportOperation,
    imported: SeparateParameters,
  ): void {
    const freshValue = resolveFreshSeperateParametersImportValue({
      operation,
      freshness: currentSeperateParametersImportFreshness(operation.slotKind, operation.targetKey),
      imported,
    })
    if (freshValue === null) return

    if (operation.slotKind === 'base') {
      if (!isSeperateParametersBaseKey(operation.targetKey)) return
      const baseKey = operation.targetKey
      seperateParametersDraft.value = { ...seperateParametersDraft.value, [baseKey]: freshValue }
      return
    }

    const overrides = { ...(seperateParametersDraft.value.overrides ?? {}) }
    overrides[operation.targetKey] = freshValue
    seperateParametersDraft.value = { ...seperateParametersDraft.value, overrides }
  }

  function createBaseSeperateParametersImportGuards(
    baseKey: SeperateParametersBaseKey,
  ): GuardedSeperateParametersImport {
    return {
      captureTarget: () => captureBaseSeperateParametersImportTarget(baseKey),
      beginImport: beginSeperateParametersImport,
      isFreshImport: isCurrentSeperateParametersImport,
      applyImport: applySeperateParametersImport,
      clearImport: clearSeperateParametersImport,
    }
  }

  function createOverrideSeperateParametersImportGuards(model: string): GuardedSeperateParametersImport {
    return {
      captureTarget: () => captureOverrideSeperateParametersImportTarget(model),
      beginImport: beginSeperateParametersImport,
      isFreshImport: isCurrentSeperateParametersImport,
      applyImport: applySeperateParametersImport,
      clearImport: clearSeperateParametersImport,
    }
  }
</script>

<div class="fixed z-50 w-dvw h-dvh top-0 left-0 pointer-events-none flex justify-stretch items-stretch">
  <div
    class="m-4 p-4 bg-bgcolor/80 backdrop-blur-sm rounded-lg shadow-lg pointer-events-auto flex-1 flex flex-col overflow-y-auto">
    <h2 class="text-lg font-bold mb-2 flex items-center">
      {language.easyPanel}
      <div class="ml-2 bg-blue-800 p-1 rounded text-sm">Beta</div>
      <button
        type="button"
        aria-label={language.close}
        title={language.close}
        class="ml-auto p-1 rounded hover:bg-selected"
        onclick={() => {
          onClose()
        }}>
        <XIcon size={28} class="ml-auto hover:bg-selected rounded"></XIcon>
      </button>
    </h2>
    <SegmentedControl
      options={[
        { label: language.model, value: 'models' },
        { label: language.parameters, value: 'parameters' },
        { label: language.customModels, value: 'customModels' },
        { label: language.settings, value: 'settings' },
      ]}
      bind:value={selectedOption}
      size="md" />

    {#if !hasEPRequirements}
      <div class="mt-4 p-4 bg-yellow-100 text-yellow-800 rounded">
        {language.epRequirementsNotMet}
      </div>

      <Button
        className="mt-4"
        onclick={() => {
          enableEasyPanelRequirements()
        }}>
        {language.run}
      </Button>
    {:else if selectedOption === 'models'}
      <div class="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 justify-center items-center">
        <div class="col-span-1">
          <span class="text-textcolor">{language.mainModel}</span>
          <ModelList bind:value={aiModelDraft.value} blankable excludesPrefix="plugin" />
        </div>
        <div class="col-span-1">
          <span class="text-textcolor">{language.submodel}</span>
          <ModelList bind:value={subModelDraft.value} blankable excludesPrefix="plugin" />
        </div>
        {#each optionalModelRoles as role}
          <div class="col-span-1">
            <span class="text-textcolor">{labelForModelRole(role)}</span>
            <ModelList
              value={modelRoleSelectionValue(role)}
              blankable
              excludesPrefix="plugin"
              onChange={(model) => {
                setOptionalRoleModel(role, model)
              }} />
          </div>
        {/each}
      </div>
    {/if}
    {#if selectedOption === 'parameters'}
      {#if seperateParametersByModelDraft.value}
        <ModelList
          bind:value={parameterModelSelection}
          blankable
          excludesPrefix="plugin"
          onChange={(v) => {
            ensureParameterOverride(v)
          }} />

        {#if parameterModelSelection !== '' && seperateParametersDraft.value.overrides[parameterModelSelection]}
          <AllSeperateParameters
            bind:value={seperateParametersDraft.value.overrides[parameterModelSelection]}
            withImportExport
            guardedImport={createOverrideSeperateParametersImportGuards(parameterModelSelection)}
            paramKey={parameterModelSelection} />
        {/if}
      {:else}
        <SegmentedControl
          options={[
            { label: labelForModelRole('memory'), value: 'memory' },
            { label: labelForModelRole('translate'), value: 'translate' },
            { label: labelForModelRole('emotion'), value: 'emotion' },
            { label: labelForModelRole('otherAx'), value: 'otherAx' },
            { label: labelForModelRole('scriptMain'), value: 'scriptMain' },
            { label: labelForModelRole('scriptAux'), value: 'scriptAux' },
          ]}
          bind:value={selectedParameterOption}
          size="md" />
        <div class="w-full mt-4 flex flex-col">
          {#if selectedParameterOption === 'memory'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.memory}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('memory')}
              paramKey="memory" />
          {:else if selectedParameterOption === 'translate'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.translate}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('translate')}
              paramKey="translate" />
          {:else if selectedParameterOption === 'emotion'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.emotion}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('emotion')}
              paramKey="emotion" />
          {:else if selectedParameterOption === 'otherAx'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.otherAx}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('otherAx')}
              paramKey="otherAx" />
          {:else if selectedParameterOption === 'scriptMain'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.scriptMain}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('scriptMain')}
              paramKey="scriptMain" />
          {:else if selectedParameterOption === 'scriptAux'}
            <AllSeperateParameters
              bind:value={seperateParametersDraft.value.scriptAux}
              withImportExport
              guardedImport={createBaseSeperateParametersImportGuards('scriptAux')}
              paramKey="scriptAux" />
          {/if}
        </div>
      {/if}
    {:else if selectedOption === 'customModels'}
      <CustomModelsSettings noAccordion />
    {:else if selectedOption === 'settings'}
      <CheckInput name={language.seperateParametersByModel} bind:check={seperateParametersByModelDraft.value} />
    {/if}
  </div>
</div>
