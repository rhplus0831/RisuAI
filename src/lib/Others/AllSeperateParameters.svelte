<script lang="ts">
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import Help from './Help.svelte'
  import { language } from 'src/lang'
  import SliderInput from '../UI/GUI/SliderInput.svelte'
  import ClaudeThinkingSeparateParams from '../Setting/Pages/ClaudeThinkingSeparateParams.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { FileDownIcon, FileUpIcon } from '@lucide/svelte'
  import { selectSingleFile } from 'src/ts/filePicker'
  import { getModelInfo } from 'src/ts/model/modellist'
  import { normalizeModelRole, resolveModelForRole } from 'src/ts/model/modelRoles'
  import {
    parseSeperateParametersImport,
    type SeperateParametersImportOperation,
    type SeperateParametersImportTarget,
  } from 'src/ts/server/seperateParametersImport'

  interface GuardedSeperateParametersImport {
    captureTarget: () => SeperateParametersImportTarget | null
    beginImport: (target: SeperateParametersImportTarget) => SeperateParametersImportOperation
    isFreshImport: (operation: SeperateParametersImportOperation) => boolean
    applyImport: (operation: SeperateParametersImportOperation, imported: SeparateParameters) => void
    clearImport: (operation: SeperateParametersImportOperation) => void
  }

  let {
    value = $bindable(),
    withImportExport = false,
    paramKey,
    guardedImport,
  }: {
    value: SeparateParameters
    withImportExport?: boolean
    paramKey?: string
    guardedImport?: GuardedSeperateParametersImport
  } = $props()

  let effectiveModel = $derived.by(() => {
    if (!paramKey) return resolveModelForRole(getDatabase(), 'chatAux')
    const role = normalizeModelRole(paramKey)
    if (role) {
      return resolveModelForRole(getDatabase(), role)
    }
    return paramKey
  })
  let modelInfo = $derived(getModelInfo(effectiveModel))
  let hasTemperature = $derived(modelInfo.parameters.includes('temperature'))

  async function importParametersJson(): Promise<void> {
    const target = guardedImport?.captureTarget() ?? null
    if (guardedImport && !target) return

    let operation: SeperateParametersImportOperation | null = null
    const beginImport = () => {
      if (!guardedImport || !target) return
      operation ??= guardedImport.beginImport(target)
    }

    try {
      const file = await selectSingleFile(['json'], { onFileSelected: beginImport })
      if (!file) return

      beginImport()
      const imported = parseSeperateParametersImport(new TextDecoder().decode(file.data))
      if (imported === null) {
        if (!guardedImport || (operation && guardedImport.isFreshImport(operation))) {
          alert(language.noData)
        }
        return
      }

      if (guardedImport) {
        if (!operation) return
        guardedImport.applyImport(operation, imported)
        return
      }

      value = imported
    } finally {
      if (operation) {
        guardedImport?.clearImport(operation)
      }
    }
  }
</script>

{#if hasTemperature}
  <span class="text-textcolor">{language.temperature} <Help key="tempature" /></span>
  <SliderInput
    min={0}
    max={200}
    marginBottom
    bind:value={value.temperature}
    multiple={0.01}
    fixed={2}
    disableable
    ariaLabel={language.temperature} />
{/if}
<span class="text-textcolor">{language.modelProfiles.runtimeFields.topK}</span>
<SliderInput
  min={0}
  max={100}
  marginBottom
  step={1}
  bind:value={value.top_k}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.topK} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenalty}</span>
<SliderInput
  min={0}
  max={2}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.repetition_penalty}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.repetitionPenalty} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.minP}</span>
<SliderInput
  min={0}
  max={1}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.min_p}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.minP} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.topA}</span>
<SliderInput
  min={0}
  max={1}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.top_a}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.topA} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.topP}</span>
<SliderInput
  min={0}
  max={1}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.top_p}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.topP} />
<span class="text-textcolor">{language.frequencyPenalty}</span>
<SliderInput
  min={0}
  max={200}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.frequency_penalty}
  disableable
  ariaLabel={language.frequencyPenalty} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.presencePenalty}</span>
<SliderInput
  min={0}
  max={200}
  marginBottom
  step={0.01}
  fixed={2}
  bind:value={value.presence_penalty}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.presencePenalty} />
<ClaudeThinkingSeparateParams bind:value {paramKey} />
<span class="text-textcolor">{language.modelProfiles.runtimeFields.verbosity}</span>
<SliderInput
  min={0}
  max={2}
  marginBottom
  step={1}
  fixed={0}
  bind:value={value.verbosity}
  disableable
  ariaLabel={language.modelProfiles.runtimeFields.verbosity} />

{#if withImportExport}
  <div class="flex">
    <button
      aria-label={`${language.export}: ${language.parameters}`}
      class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      onclick={() => {
        const json = JSON.stringify(value, null, 2)
        downloadFile(`parameters-${Date.now()}.json`, json)
      }}>
      <FileDownIcon />
    </button>
    <button
      aria-label={`${language.import}: ${language.parameters}`}
      class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded ml-2"
      onclick={importParametersJson}>
      <FileUpIcon />
    </button>
  </div>
{/if}
