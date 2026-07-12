<script lang="ts">
  import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import {
    createAgentPreset,
    deleteAgentPreset,
    duplicateAgentPreset,
    reorderAgentPresets,
    setAgentPresetDefault,
    updateAgentPreset,
  } from 'src/ts/agentPresets'
  import { createAgentPresetStatusSummary, planAgentPreset } from 'src/ts/agentPresetResolver'
  import type { AgentPresetRecord, AgentPresetStepRecord } from 'src/ts/agentPresetRecords'
  import type { AgentPresetSnapshot, ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import AgentPresetEditorDrawer from './AgentPresetEditorDrawer.svelte'

  type EditorMode = 'create' | 'edit' | null

  interface StatusPresentation {
    label: string
    tone: 'ready' | 'muted' | 'warning' | 'error'
  }

  let editorMode = $state<EditorMode>(null)
  let editingPresetId = $state<string | null>(null)
  let editorKey = $state(0)
  let busy = $state(false)
  let commandError = $state('')

  let presets = $derived(Array.isArray(getDatabase().agentPresets) ? getDatabase().agentPresets : [])
  let defaultPresetId = $derived(
    typeof getDatabase().agentPresetDefaultId === 'string' ? getDatabase().agentPresetDefaultId : '',
  )
  let editingPreset = $derived(editingPresetId ? presets.find((preset) => preset.id === editingPresetId) : undefined)

  function openCreateEditor(): void {
    editorMode = 'create'
    editingPresetId = null
    editorKey += 1
    commandError = ''
  }

  function openEditEditor(preset: AgentPresetRecord): void {
    editorMode = 'edit'
    editingPresetId = preset.id
    editorKey += 1
    commandError = ''
  }

  function closeEditor(): void {
    editorMode = null
    editingPresetId = null
    commandError = ''
  }

  async function saveEditor(snapshot: AgentPresetSnapshot): Promise<void> {
    const modeAtSave = editorMode
    const presetIdAtSave = editingPresetId
    if (!modeAtSave || busy) return
    commandError = ''
    busy = true
    const result =
      modeAtSave === 'create'
        ? await createAgentPreset(snapshot)
        : presetIdAtSave
          ? await updateAgentPreset(presetIdAtSave, snapshot)
          : ({ status: 'error', error: language.agentPresets.editTargetMissing } as ServerCommandResult)
    busy = false
    if (handleResult(result)) closeEditor()
  }

  async function duplicatePreset(preset: AgentPresetRecord): Promise<void> {
    if (busy) return
    busy = true
    commandError = ''
    const result = await duplicateAgentPreset(preset.id, { name: language.agentPresets.copyName(preset.name) })
    busy = false
    handleResult(result)
  }

  async function deletePreset(preset: AgentPresetRecord): Promise<void> {
    if (busy) return
    if (!window.confirm(language.agentPresets.deletePresetConfirm(preset.name))) return
    busy = true
    commandError = ''
    const result = await deleteAgentPreset(preset.id)
    busy = false
    handleResult(result)
  }

  async function movePreset(preset: AgentPresetRecord, delta: -1 | 1): Promise<void> {
    if (busy) return
    const index = presets.findIndex((candidate) => candidate.id === preset.id)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= presets.length) return
    const nextIds = presets.map((candidate) => candidate.id)
    const [moved] = nextIds.splice(index, 1)
    nextIds.splice(nextIndex, 0, moved)
    busy = true
    commandError = ''
    const result = await reorderAgentPresets(nextIds)
    busy = false
    handleResult(result)
  }

  async function selectDefaultPreset(agentPresetId: string): Promise<void> {
    if (busy) return
    busy = true
    commandError = ''
    const result = await setAgentPresetDefault(agentPresetId || null)
    busy = false
    handleResult(result)
  }

  function handleResult(result: ServerCommandResult<any>): boolean {
    if (result.status === 'ok') return true
    commandError =
      result.status === 'conflict'
        ? language.agentPresets.commandConflict
        : result.status === 'error'
          ? result.error
          : language.agentPresets.commandUnavailable
    return false
  }

  function enabledSteps(preset: AgentPresetRecord): AgentPresetStepRecord[] {
    return preset.steps.filter((step) => step.enabled)
  }

  function usageCount(presetId: string): number {
    let count = defaultPresetId === presetId ? 1 : 0
    const database = getDatabase()
    for (const character of database.characters ?? []) {
      for (const chat of character?.chats ?? []) {
        if (chat?.generationSettings?.agentPresetId === presetId) count += 1
      }
    }
    for (const loadout of database.loadouts ?? []) {
      if (loadout?.agentPresetId === presetId) count += 1
    }
    return count
  }

  function statusForPreset(preset: AgentPresetRecord): StatusPresentation {
    if (!preset.enabled) return { label: language.agentPresets.statusDisabled, tone: 'muted' }
    const planning = planAgentPreset({ database: getDatabase(), preset })
    if (!planning.plan) return { label: language.agentPresets.statusInvalid, tone: 'error' }
    if (planning.incompleteIssues.length > 0) return { label: language.agentPresets.statusIncomplete, tone: 'warning' }
    if (!planning.ready) return { label: language.agentPresets.statusModelNotReady, tone: 'warning' }
    return { label: language.agentPresets.statusReady, tone: 'ready' }
  }

  function statusClass(tone: StatusPresentation['tone']): string {
    if (tone === 'ready') return 'border-green-600 text-green-500'
    if (tone === 'warning') return 'border-yellow-600 text-yellow-500'
    if (tone === 'error') return 'border-draculared text-draculared'
    return 'border-darkborderc text-textcolor2'
  }

  function phaseSummary(preset: AgentPresetRecord): string {
    const planning = planAgentPreset({ database: getDatabase(), preset })
    const summary = planning.plan
      ? createAgentPresetStatusSummary({
          status: planning.ready ? 'ready' : planning.incompleteIssues.length > 0 ? 'incomplete' : 'model_not_ready',
          preset,
          issues: [...planning.issues, ...planning.incompleteIssues],
          modelReadiness: planning.modelReadiness,
        })
      : createAgentPresetStatusSummary({
          status: 'invalid',
          preset,
          issues: planning.issues,
          modelReadiness: planning.modelReadiness,
        })
    return language.agentPresets.phaseSummary(summary.beforeMainStepCount, summary.afterMainStepCount)
  }
</script>

<section class="flex flex-col gap-4" data-risu-agent-preset-settings>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="mb-1 mt-2 text-2xl font-bold">{language.agentPresets.settingsTitle}</h2>
      <p class="text-sm text-textcolor2">{language.agentPresets.settingsDescription}</p>
    </div>
    <span data-risu-agent-preset-create>
      <Button size="sm" disabled={busy} onclick={openCreateEditor}>
        <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.agentPresets.createPreset}</span>
      </Button>
    </span>
  </div>

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}

  <div class="flex flex-wrap items-center gap-3 rounded-md border border-darkborderc p-3">
    <label class="flex min-w-64 flex-1 flex-col gap-1">
      <span class="text-sm font-medium">{language.agentPresets.globalDefault}</span>
      <span data-risu-agent-preset-default-select>
        <SelectInput
          value={defaultPresetId}
          className="w-full"
          onchange={(event) => {
            void selectDefaultPreset(event.currentTarget.value)
          }}>
          <option value="">{language.agentPresets.noDefault}</option>
          {#each presets as preset (preset.id)}
            <option value={preset.id}>{preset.name}</option>
          {/each}
        </SelectInput>
      </span>
    </label>
    <span class="text-sm text-textcolor2">{language.agentPresets.globalDefaultHelp}</span>
  </div>

  {#if presets.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2" data-risu-agent-preset-empty>
      {language.agentPresets.emptyState}
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border border-darkborderc">
      <table class="w-full min-w-[58rem] text-sm">
        <thead class="bg-darkbg text-left text-xs uppercase text-textcolor2">
          <tr>
            <th class="px-3 py-2 font-medium">{language.agentPresets.nameColumn}</th>
            <th class="px-3 py-2 font-medium">{language.agentPresets.statusColumn}</th>
            <th class="px-3 py-2 font-medium">{language.agentPresets.stepsColumn}</th>
            <th class="px-3 py-2 font-medium">{language.agentPresets.usageColumn}</th>
            <th class="px-3 py-2 font-medium">{language.agentPresets.maxConcurrency}</th>
            <th class="px-3 py-2 font-medium">{language.agentPresets.actionsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {#each presets as preset, index (preset.id)}
            {@const status = statusForPreset(preset)}
            <tr class="border-t border-darkborderc align-top" data-risu-agent-preset-row data-preset-id={preset.id}>
              <td class="px-3 py-3">
                <span class="block font-medium">{preset.name}</span>
                <span class="block text-xs text-textcolor2">{preset.id}</span>
                {#if defaultPresetId === preset.id}
                  <span class="mt-1 inline-block rounded-sm border border-selected px-1.5 py-0.5 text-xs text-selected">
                    {language.agentPresets.defaultBadge}
                  </span>
                {/if}
              </td>
              <td class="px-3 py-3">
                <span class={`inline-block rounded-sm border px-2 py-1 text-xs ${statusClass(status.tone)}`}>
                  {status.label}
                </span>
              </td>
              <td class="px-3 py-3">
                <span class="block">{language.agentPresets.stepCount(enabledSteps(preset).length)}</span>
                <span class="block text-xs text-textcolor2">{phaseSummary(preset)}</span>
              </td>
              <td class="px-3 py-3 text-textcolor2">{language.agentPresets.usageCount(usageCount(preset.id))}</td>
              <td class="px-3 py-3 text-textcolor2">{preset.maxConcurrency ?? language.agentPresets.unlimited}</td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-2">
                  <span data-risu-agent-preset-move-up>
                    <Button
                      size="sm"
                      styled="outlined"
                      disabled={busy || index === 0}
                      onclick={() => movePreset(preset, -1)}>
                      <span class="inline-flex items-center gap-1"
                        ><ArrowUpIcon size={14} />{language.agentPresets.moveUp}</span>
                    </Button>
                  </span>
                  <span data-risu-agent-preset-move-down>
                    <Button
                      size="sm"
                      styled="outlined"
                      disabled={busy || index === presets.length - 1}
                      onclick={() => movePreset(preset, 1)}>
                      <span class="inline-flex items-center gap-1"
                        ><ArrowDownIcon size={14} />{language.agentPresets.moveDown}</span>
                    </Button>
                  </span>
                  <span data-risu-agent-preset-edit>
                    <Button size="sm" styled="outlined" disabled={busy} onclick={() => openEditEditor(preset)}>
                      <span class="inline-flex items-center gap-1"
                        ><PencilIcon size={14} />{language.agentPresets.edit}</span>
                    </Button>
                  </span>
                  <span data-risu-agent-preset-duplicate>
                    <Button size="sm" styled="outlined" disabled={busy} onclick={() => duplicatePreset(preset)}>
                      <span class="inline-flex items-center gap-1"
                        ><CopyIcon size={14} />{language.agentPresets.duplicate}</span>
                    </Button>
                  </span>
                  <span data-risu-agent-preset-delete>
                    <Button size="sm" styled="danger" disabled={busy} onclick={() => deletePreset(preset)}>
                      <span class="inline-flex items-center gap-1"
                        ><TrashIcon size={14} />{language.agentPresets.delete}</span>
                    </Button>
                  </span>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if editorMode}
    {#key editorKey}
      <AgentPresetEditorDrawer
        mode={editorMode}
        preset={editingPreset}
        {busy}
        {commandError}
        onSave={saveEditor}
        onCancel={closeEditor} />
    {/key}
  {/if}
</section>
