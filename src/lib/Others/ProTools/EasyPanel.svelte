<script lang="ts">
  import { language } from 'src/lang'
  import ClaudeThinkingSeparateParams from 'src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import { easyPanelStore } from 'src/ts/stores.svelte'
  import Help from '../Help.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import AllSeperateParameters from '../AllSeperateParameters.svelte'
  import { XIcon } from '@lucide/svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import CustomModelsSettings from 'src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
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

  type AuxModelSettings = {
    memory: string
    translate: string
    emotion: string
    otherAx: string
  }
  type SeperateParametersBaseKey = keyof AuxModelSettings

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
    overrides: Record<string, SeparateParameters>
  }

  const seperateParametersBaseKeys = ['memory', 'translate', 'emotion', 'otherAx'] as const

  const seperateParametersEnabledDraft = createServerBackedSettingDraft<boolean>('seperateParametersEnabled', false)
  const doNotChangeSeperateModelsDraft = createServerBackedSettingDraft<boolean>('doNotChangeSeperateModels', false)
  const seperateModelsDraft = createServerBackedSettingDraft<AuxModelSettings>('seperateModels', {
    memory: '',
    translate: '',
    emotion: '',
    otherAx: '',
  })
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
    overrides: {},
  })
  const seperateParametersByModelDraft = createServerBackedSettingDraft<boolean>('seperateParametersByModel', false)

  let selectedOption = $state('models')
  let selectedParameterOption = $state('memory')
  let parameterModelSelection = $state('')

  let hasEPRequirements = $derived.by(() => {
    return (
      seperateParametersEnabledDraft.value &&
      doNotChangeSeperateModelsDraft.value &&
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
    seperateModelsDraft.value = {
      memory: '',
      translate: '',
      emotion: '',
      otherAx: '',
    }
    epEnabledDraft.value = true
    disableSeperateParameterChangeOnPresetChangeDraft.value = true
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
        <div class="col-span-1">
          <span class="text-textcolor">{language.longTermMemory}</span>
          <ModelList bind:value={seperateModelsDraft.value.memory} blankable excludesPrefix="plugin" />
        </div>
        <div class="col-span-1">
          <span class="text-textcolor">{language.translator}</span>
          <ModelList bind:value={seperateModelsDraft.value.translate} blankable excludesPrefix="plugin" />
        </div>
        <div class="col-span-1">
          <span class="text-textcolor">{language.emotionImage}</span>
          <ModelList bind:value={seperateModelsDraft.value.emotion} blankable excludesPrefix="plugin" />
        </div>

        <div class="col-span-1">
          <span class="text-textcolor">{language.others}</span>
          <ModelList bind:value={seperateModelsDraft.value.otherAx} blankable excludesPrefix="plugin" />
        </div>
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
            { label: language.longTermMemory, value: 'memory' },
            { label: language.translator, value: 'translate' },
            { label: language.emotionImage, value: 'emotion' },
            { label: language.others, value: 'otherAx' },
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
