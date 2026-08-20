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
    currentPendingAgentPresetGeneratedProjectionLatch,
    isAgentPresetGeneratedProjectionResolved,
    type AgentPresetGeneratedProjectionLatch,
    type AgentPresetMutationOutcome,
  } from 'src/ts/agentPresets'
  import { createAgentPresetStatusSummary, planAgentPreset } from 'src/ts/agentPresetResolver'
  import {
    resolveAgentPresetSteps,
    type AgentPresetRecord,
    type AgentPresetStepRecord,
  } from 'src/ts/agentPresetRecords'
  import type { AgentPresetSnapshot } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import AgentPresetEditorDrawer from './AgentPresetEditorDrawer.svelte'
  import AgentSettingsSection from './AgentSettingsSection.svelte'

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
  const initialProjectionLatch = currentPendingAgentPresetGeneratedProjectionLatch()
  let mutationState = $state<'idle' | 'saving' | 'queued'>(initialProjectionLatch ? 'queued' : 'idle')
  let queuedProjectionLatch = $state<AgentPresetGeneratedProjectionLatch | null>(initialProjectionLatch)
  let resolveQueuedEditorProjection: (() => void) | null = null

  let presets = $derived(Array.isArray(getDatabase().agentPresets) ? getDatabase().agentPresets : [])
  let defaultPresetId = $derived(
    typeof getDatabase().agentPresetDefaultId === 'string' ? getDatabase().agentPresetDefaultId : '',
  )
  let editingPreset = $derived(editingPresetId ? presets.find((preset) => preset.id === editingPresetId) : undefined)
  let mutationLocked = $derived(busy || queuedProjectionLatch !== null)

  $effect(() => {
    const latch = queuedProjectionLatch
    if (!latch || !isAgentPresetGeneratedProjectionResolved(latch)) return
    queuedProjectionLatch = null
    mutationState = 'idle'
    const resolve = resolveQueuedEditorProjection
    resolveQueuedEditorProjection = null
    resolve?.()
  })

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
    if (!modeAtSave || mutationLocked) return
    commandError = ''
    busy = true
    mutationState = 'saving'
    const result =
      modeAtSave === 'create'
        ? await createAgentPreset(snapshot)
        : presetIdAtSave
          ? await updateAgentPreset(presetIdAtSave, snapshot)
          : ({
              status: 'failed',
              result: { status: 'error', error: language.agentPresets.editTargetMissing },
            } as AgentPresetMutationOutcome)
    busy = false
    if (handleResult(result)) closeEditor()
  }

  async function duplicatePreset(preset: AgentPresetRecord): Promise<void> {
    if (mutationLocked) return
    busy = true
    mutationState = 'saving'
    commandError = ''
    const result = await duplicateAgentPreset(preset.id, { name: language.agentPresets.copyName(preset.name) })
    busy = false
    handleResult(result)
  }

  async function deletePreset(preset: AgentPresetRecord): Promise<void> {
    if (mutationLocked) return
    if (!window.confirm(language.agentPresets.deletePresetConfirm(preset.name))) return
    busy = true
    mutationState = 'saving'
    commandError = ''
    const result = await deleteAgentPreset(preset.id)
    busy = false
    handleResult(result)
  }

  async function movePreset(preset: AgentPresetRecord, delta: -1 | 1): Promise<void> {
    if (mutationLocked) return
    const index = presets.findIndex((candidate) => candidate.id === preset.id)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= presets.length) return
    const nextIds = presets.map((candidate) => candidate.id)
    const [moved] = nextIds.splice(index, 1)
    nextIds.splice(nextIndex, 0, moved)
    busy = true
    mutationState = 'saving'
    commandError = ''
    const result = await reorderAgentPresets(nextIds)
    busy = false
    handleResult(result)
  }

  async function selectDefaultPreset(agentPresetId: string): Promise<void> {
    if (mutationLocked) return
    busy = true
    mutationState = 'saving'
    commandError = ''
    const result = await setAgentPresetDefault(agentPresetId || null)
    busy = false
    handleResult(result)
  }

  function handleResult(outcome: AgentPresetMutationOutcome<any>): boolean {
    if (outcome.status === 'accepted') {
      mutationState = 'idle'
      return true
    }
    if (outcome.status === 'queued') {
      mutationState = 'queued'
      if (outcome.projectionLatch) queuedProjectionLatch = outcome.projectionLatch
      return true
    }
    if (outcome.status === 'blocked') {
      mutationState = 'idle'
      commandError = language.agentPresets.commandBlocked
      return false
    }
    const result = outcome.result
    mutationState = 'idle'
    commandError =
      result.status === 'conflict'
        ? language.agentPresets.commandConflict
        : result.status === 'error'
          ? result.error
          : language.agentPresets.commandUnavailable
    return false
  }

  function latchQueuedProjection(latch: AgentPresetGeneratedProjectionLatch): Promise<void> {
    queuedProjectionLatch = latch
    mutationState = 'queued'
    return new Promise((resolve) => {
      resolveQueuedEditorProjection = resolve
    })
  }

  function enabledSteps(preset: AgentPresetRecord): AgentPresetStepRecord[] {
    return resolveAgentPresetSteps(preset, getDatabase().agents ?? []).filter((step) => step.enabled)
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
    if (tone === 'ready') return 'border border-green-600 text-green-500'
    if (tone === 'warning') return 'border border-yellow-600 text-yellow-500'
    if (tone === 'error') return 'border border-draculared text-draculared'
    return 'bg-white/10 text-textcolor2'
  }

  function phaseSummary(preset: AgentPresetRecord): string {
    const planning = planAgentPreset({ database: getDatabase(), preset })
    const summary = planning.plan
      ? createAgentPresetStatusSummary({
          status: planning.ready ? 'ready' : planning.incompleteIssues.length > 0 ? 'incomplete' : 'model_not_ready',
          preset,
          issues: [...planning.issues, ...planning.incompleteIssues],
          modelReadiness: planning.modelReadiness,
          agents: getDatabase().agents,
        })
      : createAgentPresetStatusSummary({
          status: 'invalid',
          preset,
          issues: planning.issues,
          modelReadiness: planning.modelReadiness,
          agents: getDatabase().agents,
        })
    return language.agentPresets.phaseSummary(summary.beforeMainStepCount, summary.afterMainStepCount)
  }
</script>

<section class="flex flex-col gap-4" data-risu-agent-preset-settings>
  <div>
    <h2 class="mb-1 mt-2 text-2xl font-bold">{language.agentPresets.settingsTitle}</h2>
    <p class="text-sm text-textcolor2">{language.agentPresets.settingsDescription}</p>
  </div>

  <AgentSettingsSection />

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}
  <div class="mt-4 flex flex-col gap-2">
    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium">{language.agentPresets.globalDefault}</span>
      <span data-risu-agent-preset-default-select>
        <SelectInput
          value={defaultPresetId}
          className="w-full"
          disabled={mutationLocked}
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

  <div class="mt-4 flex flex-wrap items-start justify-between gap-3" data-risu-agent-presets-header>
    <div>
      <h3 class="text-lg font-semibold">{language.agentPresets.presetsSectionTitle}</h3>
      <p class="text-sm text-textcolor2">{language.agentPresets.presetsSectionDescription}</p>
    </div>
    <span data-risu-agent-preset-create>
      <Button size="sm" disabled={mutationLocked} onclick={openCreateEditor}>
        <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.agentPresets.createPreset}</span>
      </Button>
    </span>
  </div>

  {#if presets.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2" data-risu-agent-preset-empty>
      {language.agentPresets.emptyState}
    </div>
  {:else}
    <div class="flex flex-col gap-2" data-risu-agent-preset-list>
      {#each presets as preset, index (preset.id)}
        {@const status = statusForPreset(preset)}
        <article class="risu-card flex flex-col gap-2 text-sm" data-risu-agent-preset-row data-preset-id={preset.id}>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{preset.name}</span>
            <span class={`rounded-sm px-2 py-1 text-xs ${statusClass(status.tone)}`}>
              {status.label}
            </span>
            {#if defaultPresetId === preset.id}
              <span class="rounded-sm border border-selected px-2 py-1 text-xs text-selected">
                {language.agentPresets.defaultBadge}
              </span>
            {/if}
            <div class="ml-auto flex flex-wrap gap-2">
              <span data-risu-agent-preset-move-up>
                <Button
                  size="sm"
                  styled="outlined"
                  disabled={mutationLocked || index === 0}
                  onclick={() => movePreset(preset, -1)}>
                  <span class="inline-flex items-center gap-1"
                    ><ArrowUpIcon size={14} />{language.agentPresets.moveUp}</span>
                </Button>
              </span>
              <span data-risu-agent-preset-move-down>
                <Button
                  size="sm"
                  styled="outlined"
                  disabled={mutationLocked || index === presets.length - 1}
                  onclick={() => movePreset(preset, 1)}>
                  <span class="inline-flex items-center gap-1"
                    ><ArrowDownIcon size={14} />{language.agentPresets.moveDown}</span>
                </Button>
              </span>
              <span data-risu-agent-preset-edit>
                <Button size="sm" styled="outlined" disabled={mutationLocked} onclick={() => openEditEditor(preset)}>
                  <span class="inline-flex items-center gap-1"
                    ><PencilIcon size={14} />{language.agentPresets.edit}</span>
                </Button>
              </span>
              <span data-risu-agent-preset-duplicate>
                <Button size="sm" styled="outlined" disabled={mutationLocked} onclick={() => duplicatePreset(preset)}>
                  <span class="inline-flex items-center gap-1"
                    ><CopyIcon size={14} />{language.agentPresets.duplicate}</span>
                </Button>
              </span>
              <span data-risu-agent-preset-delete>
                <Button size="sm" styled="danger" disabled={mutationLocked} onclick={() => deletePreset(preset)}>
                  <span class="inline-flex items-center gap-1"
                    ><TrashIcon size={14} />{language.agentPresets.delete}</span>
                </Button>
              </span>
            </div>
          </div>
          <span class="break-all text-xs text-textcolor2">{preset.id}</span>
          {#if preset.description}
            <span class="text-xs text-textcolor2">{preset.description}</span>
          {/if}
          <span class="text-xs text-textcolor2">
            {language.agentPresets.stepCount(enabledSteps(preset).length)} · {phaseSummary(preset)}
          </span>
          <span class="text-xs text-textcolor2">
            {language.agentPresets.usageCount(usageCount(preset.id))} · {language.agentPresets.maxConcurrency}:
            {preset.maxConcurrency ?? language.agentPresets.unlimited}
          </span>
        </article>
      {/each}
    </div>
  {/if}

  {#if editorMode}
    {#key editorKey}
      <AgentPresetEditorDrawer
        mode={editorMode}
        preset={editingPreset}
        busy={mutationLocked}
        {commandError}
        onQueuedProjection={latchQueuedProjection}
        onSave={saveEditor}
        onCancel={closeEditor} />
    {/key}
  {/if}
</section>
