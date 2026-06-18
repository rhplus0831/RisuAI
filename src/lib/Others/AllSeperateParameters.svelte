<script lang="ts">
  import { DBState } from 'src/ts/stores.svelte'
  import Help from './Help.svelte'
  import { language } from 'src/lang'
  import SliderInput from '../UI/GUI/SliderInput.svelte'
  import ClaudeThinkingSeparateParams from '../Setting/Pages/ClaudeThinkingSeparateParams.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { FileDownIcon, FileUpIcon } from '@lucide/svelte'
  import { selectSingleFile } from 'src/ts/util'
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
    if (!paramKey) return DBState.db.subModel
    const role = normalizeModelRole(paramKey)
    if (role) {
      return resolveModelForRole(DBState.db, role)
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
  <SliderInput min={0} max={200} marginBottom bind:value={value.temperature} multiple={0.01} fixed={2} disableable />
{/if}
<span class="text-textcolor">Top K</span>
<SliderInput min={0} max={100} marginBottom step={1} bind:value={value.top_k} disableable />
<span class="text-textcolor">{'Repetition Penalty'}</span>
<SliderInput min={0} max={2} marginBottom step={0.01} fixed={2} bind:value={value.repetition_penalty} disableable />
<span class="text-textcolor">Min P</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.min_p} disableable />
<span class="text-textcolor">Top A</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.top_a} disableable />
<span class="text-textcolor">Top P</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.top_p} disableable />
<span class="text-textcolor">{language.frequencyPenalty}</span>
<SliderInput min={0} max={200} marginBottom step={0.01} fixed={2} bind:value={value.frequency_penalty} disableable />
<span class="text-textcolor">{language.presensePenalty}</span>
<SliderInput min={0} max={200} marginBottom step={0.01} fixed={2} bind:value={value.presence_penalty} disableable />
<ClaudeThinkingSeparateParams bind:value {paramKey} />
<span class="text-textcolor">{'Verbosity'}</span>
<SliderInput min={0} max={2} marginBottom step={1} fixed={0} bind:value={value.verbosity} disableable />

{#if withImportExport}
  <div class="flex">
    <button
      class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      onclick={() => {
        const json = JSON.stringify(value, null, 2)
        downloadFile(`parameters-${Date.now()}.json`, json)
      }}>
      <FileDownIcon />
    </button>
    <button
      class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded ml-2"
      onclick={importParametersJson}>
      <FileUpIcon />
    </button>
  </div>
{/if}
