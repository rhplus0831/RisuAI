<script lang="ts">
  import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    createAgentPresetStep,
    deleteAgentPresetStep,
    duplicateAgentPresetStep,
    reorderAgentPresetSteps,
    updateAgentPresetStep,
  } from 'src/ts/agentPresets'
  import {
    AGENT_PRESET_MAX_CONCURRENCY_MAX,
    AGENT_PRESET_MAX_CONCURRENCY_MIN,
    AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX,
    AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN,
    AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX,
    AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN,
    AGENT_PRESET_RUNTIME_TEMPERATURE_MAX,
    AGENT_PRESET_RUNTIME_TEMPERATURE_MIN,
    AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX,
    AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN,
    AGENT_PRESET_STEP_INPUT_SCOPES,
    isValidAgentPresetOutputKey,
    type AgentPresetRecord,
    type AgentPresetStepDestination,
    type AgentPresetStepFailurePolicy,
    type AgentPresetStepInputScope,
    type AgentPresetStepModelSelection,
    type AgentPresetStepOutputFormat,
    type AgentPresetStepPhase,
    type AgentPresetStepRecord,
  } from 'src/ts/agentPresetRecords'
  import type { AgentPresetSnapshot, AgentPresetStepSnapshot, ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import AgentPresetDiagnosticsPanel from './AgentPresetDiagnosticsPanel.svelte'
  import { sparseAgentPresetStepPatch } from './agentPresetStepPatch'

  interface Props {
    mode: 'create' | 'edit'
    preset?: AgentPresetRecord
    busy?: boolean
    commandError?: string
    onSave: (preset: AgentPresetSnapshot) => void | Promise<void>
    onCancel: () => void
  }

  type StepEditorMode = 'new' | 'edit' | null
  type StepFailurePolicyMode = AgentPresetStepFailurePolicy['mode']
  type StepModelMode = AgentPresetStepModelSelection['mode']
  type AgentPresetMetadataField = 'name' | 'description' | 'enabled' | 'maxConcurrency'

  const DEFAULT_STEP_TIMEOUT_MS = 30_000
  const DEFAULT_STEP_MAX_INPUT_CHARS = 24_000
  const DEFAULT_STEP_MAX_OUTPUT_CHARS = 1_200
  const DEFAULT_STEP_TEMPERATURE = 100
  const AGENT_PRESET_METADATA_FIELDS: readonly AgentPresetMetadataField[] = [
    'name',
    'description',
    'enabled',
    'maxConcurrency',
  ]

  let { mode, preset, busy = false, commandError = '', onSave, onCancel }: Props = $props()

  // svelte-ignore state_referenced_locally
  const initialPreset = preset
  const initialPresetId = initialPreset?.id ?? ''
  let draftName = $state(initialPreset?.name ?? language.agentPresets.newPresetName)
  let draftDescription = $state(initialPreset?.description ?? '')
  let draftEnabled = $state(initialPreset?.enabled ?? true)
  let limitConcurrency = $state(initialPreset?.maxConcurrency !== undefined)
  let draftMaxConcurrency = $state(initialPreset?.maxConcurrency ?? 4)
  let initialMetadataSnapshot = $state<AgentPresetSnapshot | null>(null)

  let stepEditorMode = $state<StepEditorMode>(null)
  let editingStepId = $state<string | null>(null)
  let stepInitialSnapshot = $state<AgentPresetStepSnapshot | null>(null)
  let stepInitialSnapshotJson = $state('')
  let stepBusy = $state(false)
  let stepCommandError = $state('')
  let draftStepName = $state('')
  let draftStepEnabled = $state(true)
  let draftStepPhase = $state<AgentPresetStepPhase>('beforeMain')
  let draftStepInstruction = $state('')
  let draftStepModelMode = $state<StepModelMode>('inheritMain')
  let draftStepModelProfileId = $state('')
  let draftStepDependencies = $state<string[]>([])
  let draftStepOutputKey = $state('')
  let draftStepOutputFormat = $state<AgentPresetStepOutputFormat>('text')
  let draftStepDestination = $state<AgentPresetStepDestination>('promptOutput')
  let draftStepFailurePolicyMode = $state<StepFailurePolicyMode>('required')
  let draftStepFallbackText = $state('')
  let draftStepTimeoutMs = $state(DEFAULT_STEP_TIMEOUT_MS)
  let draftStepMaxInputChars = $state(DEFAULT_STEP_MAX_INPUT_CHARS)
  let draftStepMaxOutputChars = $state(DEFAULT_STEP_MAX_OUTPUT_CHARS)
  let draftStepTemperature = $state(DEFAULT_STEP_TEMPERATURE)
  let draftStepInputScopes = $state<AgentPresetStepInputScope[]>([])

  let drawerTitle = $derived(mode === 'create' ? language.agentPresets.createPreset : language.agentPresets.editPreset)
  let livePreset = $derived(
    initialPresetId && Array.isArray(getDatabase().agentPresets)
      ? (getDatabase().agentPresets.find((candidate) => candidate.id === initialPresetId) ?? initialPreset)
      : initialPreset,
  )
  let presetSteps = $derived(livePreset?.steps ?? [])
  let beforeMainSteps = $derived(stepsForPhase(presetSteps, 'beforeMain'))
  let afterMainSteps = $derived(stepsForPhase(presetSteps, 'afterMain'))
  let modelProfiles = $derived(Array.isArray(getDatabase().modelProfiles) ? getDatabase().modelProfiles : [])
  let activeStep = $derived(editingStepId ? presetSteps.find((step) => step.id === editingStepId) : undefined)
  let metadataPatch = $derived(
    initialMetadataSnapshot ? sparseAgentPresetMetadataPatch(initialMetadataSnapshot, snapshotForSave()) : {},
  )
  let metadataDirty = $derived(Object.keys(metadataPatch).length > 0)
  let stepDirty = $derived(
    stepInitialSnapshotJson !== '' && stepInitialSnapshotJson !== snapshot(stepSnapshotForSave()),
  )
  let isDirty = $derived(metadataDirty || stepDirty)
  let controlsLocked = $derived(busy || stepBusy)
  let outputKeyValid = $derived(isValidAgentPresetOutputKey(draftStepOutputKey.trim()))
  let canSave = $derived(draftName.trim().length > 0 && !controlsLocked && (mode === 'create' || metadataDirty))
  let canSaveStep = $derived(
    mode === 'edit' &&
      !!initialPresetId &&
      !!stepEditorMode &&
      !controlsLocked &&
      draftStepName.trim().length > 0 &&
      outputKeyValid &&
      (draftStepModelMode === 'inheritMain' || draftStepModelProfileId.trim().length > 0),
  )
  let validDependencyOptions = $derived(dependencyOptions())
  let visibleInputScopes = $derived(inputScopesForPhase(draftStepPhase))
  let stepFormTitle = $derived(
    stepEditorMode === 'new' ? language.agentPresets.createStep : language.agentPresets.editStep,
  )

  $effect(() => {
    const draft = snapshotForSave()
    const projection = mode === 'edit' && livePreset ? metadataSnapshotFromPreset(livePreset) : null
    if (!initialMetadataSnapshot) {
      initialMetadataSnapshot = projection ?? draft
      return
    }
    if (!projection) return

    const initialJson = snapshot(initialMetadataSnapshot)
    const draftJson = snapshot(draft)
    const projectionJson = snapshot(projection)
    // The command helper applies an optimistic row before its response has
    // passed the local-effect or authoritative-projection fences. Keep the
    // draft dirty until that command promise settles; a failed rollback then
    // remains a retryable edit instead of becoming the new baseline.
    if (busy) return
    if (draftJson === projectionJson) {
      if (initialJson !== projectionJson) initialMetadataSnapshot = projection
      return
    }
    if (draftJson === initialJson) {
      applyMetadataProjectionToDraft(projection)
      initialMetadataSnapshot = projection
    }
  })

  function snapshot(value: unknown): string {
    return JSON.stringify(value ?? {})
  }

  function snapshotValue(value: unknown): string {
    const valueSnapshot = JSON.stringify(value)
    return valueSnapshot === undefined ? '__undefined__' : valueSnapshot
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function setStepInitialSnapshot(value: AgentPresetStepSnapshot | null): void {
    stepInitialSnapshot = value
    stepInitialSnapshotJson = value ? snapshot(value) : ''
  }

  function stepsForPhase(
    steps: readonly AgentPresetStepRecord[],
    phase: AgentPresetStepPhase,
  ): AgentPresetStepRecord[] {
    return steps.filter((step) => step.phase === phase)
  }

  function clampedMaxConcurrency(): number {
    return clampInteger(draftMaxConcurrency, AGENT_PRESET_MAX_CONCURRENCY_MIN, AGENT_PRESET_MAX_CONCURRENCY_MAX)
  }

  function clampedTimeoutMs(): number {
    return clampInteger(draftStepTimeoutMs, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX)
  }

  function clampedMaxInputChars(): number {
    return clampInteger(
      draftStepMaxInputChars,
      AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN,
      AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX,
    )
  }

  function clampedMaxOutputChars(): number {
    return clampInteger(
      draftStepMaxOutputChars,
      AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN,
      AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX,
    )
  }

  function clampedTemperature(): number {
    const numeric = Number(draftStepTemperature)
    if (!Number.isFinite(numeric)) return DEFAULT_STEP_TEMPERATURE
    return Math.max(AGENT_PRESET_RUNTIME_TEMPERATURE_MIN, Math.min(AGENT_PRESET_RUNTIME_TEMPERATURE_MAX, numeric))
  }

  function clampInteger(value: unknown, min: number, max: number): number {
    const rounded = Math.round(Number(value))
    if (!Number.isFinite(rounded)) return min
    return Math.max(min, Math.min(max, rounded))
  }

  function snapshotForSave(): AgentPresetSnapshot {
    const next: AgentPresetSnapshot = {
      name: draftName.trim(),
      enabled: draftEnabled,
    }
    const description = draftDescription.trim()
    if (description) {
      next.description = description
    } else if (mode === 'edit') {
      next.description = null
    }

    if (limitConcurrency) {
      next.maxConcurrency = clampedMaxConcurrency()
    } else if (mode === 'edit') {
      next.maxConcurrency = null
    }

    return next
  }

  function metadataSnapshotFromPreset(source: AgentPresetRecord): AgentPresetSnapshot {
    const next: AgentPresetSnapshot = {
      name: source.name.trim(),
      enabled: source.enabled,
      description: source.description?.trim() || null,
      maxConcurrency:
        typeof source.maxConcurrency === 'number'
          ? clampInteger(source.maxConcurrency, AGENT_PRESET_MAX_CONCURRENCY_MIN, AGENT_PRESET_MAX_CONCURRENCY_MAX)
          : null,
    }
    return next
  }

  function sparseAgentPresetMetadataPatch(
    previous: AgentPresetSnapshot,
    attempted: AgentPresetSnapshot,
  ): AgentPresetSnapshot {
    const patch: AgentPresetSnapshot = {}
    const previousRecord = previous as Record<string, unknown>
    const attemptedRecord = attempted as Record<string, unknown>
    const patchRecord = patch as Record<string, unknown>
    for (const field of AGENT_PRESET_METADATA_FIELDS) {
      if (snapshotValue(previousRecord[field]) === snapshotValue(attemptedRecord[field])) continue
      patchRecord[field] = cloneJsonValue(attemptedRecord[field])
    }
    return patch
  }

  function applyMetadataProjectionToDraft(projection: AgentPresetSnapshot): void {
    draftName = typeof projection.name === 'string' ? projection.name : ''
    draftDescription = typeof projection.description === 'string' ? projection.description : ''
    draftEnabled = projection.enabled !== false
    if (typeof projection.maxConcurrency === 'number') {
      limitConcurrency = true
      draftMaxConcurrency = projection.maxConcurrency
    } else {
      limitConcurrency = false
    }
  }

  function stepSnapshotForSave(): AgentPresetStepSnapshot {
    const runtime: AgentPresetStepRecord['runtime'] = {
      timeoutMs: clampedTimeoutMs(),
      maxInputChars: clampedMaxInputChars(),
      maxOutputChars: clampedMaxOutputChars(),
      temperature: clampedTemperature(),
    }
    const model: AgentPresetStepModelSelection =
      draftStepModelMode === 'modelProfile'
        ? { mode: 'modelProfile', profileId: draftStepModelProfileId.trim() }
        : { mode: 'inheritMain' }
    const failurePolicy: AgentPresetStepFailurePolicy =
      draftStepFailurePolicyMode === 'fallbackText'
        ? { mode: 'fallbackText', text: draftStepFallbackText }
        : { mode: draftStepFailurePolicyMode }

    return {
      name: draftStepName.trim(),
      enabled: draftStepEnabled,
      phase: draftStepPhase,
      dependencies: draftStepDependencies.filter((dependencyId) =>
        validDependencyOptions.some((option) => option.id === dependencyId),
      ),
      instruction: draftStepInstruction,
      model,
      runtime,
      inputScopes: draftStepInputScopes.filter((scope) => inputScopesForPhase(draftStepPhase).includes(scope)),
      outputKey: draftStepOutputKey.trim(),
      outputFormat: draftStepOutputFormat,
      destination:
        draftStepPhase === 'beforeMain' && draftStepDestination === 'finalOutput'
          ? 'promptOutput'
          : draftStepPhase === 'afterMain' && draftStepDestination === 'userInput'
            ? 'intermediate'
            : draftStepDestination,
      failurePolicy,
    }
  }

  function defaultStepDraft(): AgentPresetStepSnapshot {
    const nextNumber = presetSteps.length + 1
    return {
      name: language.agentPresets.defaultStepName(nextNumber),
      enabled: true,
      phase: 'beforeMain',
      dependencies: [],
      instruction: '',
      model: { mode: 'inheritMain' },
      runtime: {
        timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
        maxInputChars: DEFAULT_STEP_MAX_INPUT_CHARS,
        maxOutputChars: DEFAULT_STEP_MAX_OUTPUT_CHARS,
        temperature: DEFAULT_STEP_TEMPERATURE,
      },
      inputScopes: ['currentUserMessage'],
      outputKey: `step_${nextNumber}`,
      outputFormat: 'text',
      destination: 'promptOutput',
      failurePolicy: { mode: 'required' },
    }
  }

  function loadStepDraft(step: Partial<AgentPresetStepRecord>): void {
    draftStepName = typeof step.name === 'string' ? step.name : ''
    draftStepEnabled = step.enabled !== false
    draftStepPhase = step.phase === 'afterMain' ? 'afterMain' : 'beforeMain'
    draftStepInstruction = typeof step.instruction === 'string' ? step.instruction : ''
    draftStepModelMode = step.model?.mode === 'modelProfile' ? 'modelProfile' : 'inheritMain'
    draftStepModelProfileId = step.model?.mode === 'modelProfile' ? step.model.profileId : ''
    draftStepDependencies = Array.isArray(step.dependencies) ? [...step.dependencies] : []
    draftStepOutputKey = typeof step.outputKey === 'string' ? step.outputKey : ''
    draftStepOutputFormat = step.outputFormat === 'jsonObject' ? 'jsonObject' : 'text'
    draftStepDestination =
      step.destination === 'finalOutput' ||
      step.destination === 'userInput' ||
      step.destination === 'intermediate' ||
      step.destination === 'promptOutput'
        ? step.destination
        : draftStepPhase === 'beforeMain'
          ? 'promptOutput'
          : 'intermediate'
    draftStepFailurePolicyMode =
      step.failurePolicy?.mode === 'optional' ||
      step.failurePolicy?.mode === 'fallbackText' ||
      step.failurePolicy?.mode === 'stopGeneration'
        ? step.failurePolicy.mode
        : 'required'
    draftStepFallbackText = step.failurePolicy?.mode === 'fallbackText' ? step.failurePolicy.text : ''
    draftStepTimeoutMs = step.runtime?.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
    draftStepMaxInputChars = step.runtime?.maxInputChars ?? DEFAULT_STEP_MAX_INPUT_CHARS
    draftStepMaxOutputChars = step.runtime?.maxOutputChars ?? DEFAULT_STEP_MAX_OUTPUT_CHARS
    draftStepTemperature = step.runtime?.temperature ?? DEFAULT_STEP_TEMPERATURE
    draftStepInputScopes = Array.isArray(step.inputScopes) ? [...step.inputScopes] : []
    normalizeStepDraftForPhase()
  }

  function beginCreateStep(): void {
    if (mode !== 'edit') return
    stepEditorMode = 'new'
    editingStepId = null
    stepCommandError = ''
    loadStepDraft(defaultStepDraft())
    setStepInitialSnapshot(stepSnapshotForSave())
  }

  function beginEditStep(step: AgentPresetStepRecord): void {
    stepEditorMode = 'edit'
    editingStepId = step.id
    stepCommandError = ''
    loadStepDraft(step)
    setStepInitialSnapshot(stepSnapshotForSave())
  }

  function cancelStepEdit(): void {
    if (stepDirty && !window.confirm(language.agentPresets.discardStepChangesConfirm)) return
    clearStepEditor()
  }

  function clearStepEditor(): void {
    stepEditorMode = null
    editingStepId = null
    setStepInitialSnapshot(null)
    stepCommandError = ''
  }

  function setDraftStepPhase(phase: AgentPresetStepPhase): void {
    draftStepPhase = phase
    normalizeStepDraftForPhase()
  }

  function normalizeStepDraftForPhase(): void {
    if (draftStepPhase === 'beforeMain' && draftStepDestination === 'finalOutput') {
      draftStepDestination = 'promptOutput'
    }
    if (draftStepPhase === 'afterMain' && draftStepDestination === 'userInput') {
      draftStepDestination = 'intermediate'
    }
    draftStepDependencies = draftStepDependencies.filter((dependencyId) =>
      dependencyOptions().some((option) => option.id === dependencyId),
    )
    draftStepInputScopes = draftStepInputScopes.filter((scope) => inputScopesForPhase(draftStepPhase).includes(scope))
  }

  function setDraftDestination(destination: AgentPresetStepDestination): void {
    if (draftStepPhase === 'beforeMain' && destination === 'finalOutput') {
      draftStepDestination = 'promptOutput'
      return
    }
    if (draftStepPhase === 'afterMain' && destination === 'userInput') {
      draftStepDestination = 'intermediate'
      return
    }
    draftStepDestination = destination
  }

  function setDraftModelMode(mode: StepModelMode): void {
    draftStepModelMode = mode
    if (mode === 'modelProfile' && !draftStepModelProfileId && modelProfiles[0]?.id) {
      draftStepModelProfileId = String(modelProfiles[0].id)
    }
  }

  function toggleDependency(stepId: string, enabled: boolean): void {
    if (enabled) {
      if (!draftStepDependencies.includes(stepId)) draftStepDependencies = [...draftStepDependencies, stepId]
    } else {
      draftStepDependencies = draftStepDependencies.filter((dependencyId) => dependencyId !== stepId)
    }
  }

  function toggleInputScope(scope: AgentPresetStepInputScope, enabled: boolean): void {
    if (!inputScopesForPhase(draftStepPhase).includes(scope)) {
      draftStepInputScopes = draftStepInputScopes.filter((candidate) => candidate !== scope)
      return
    }
    if (enabled) {
      if (!draftStepInputScopes.includes(scope)) draftStepInputScopes = [...draftStepInputScopes, scope]
    } else {
      draftStepInputScopes = draftStepInputScopes.filter((candidate) => candidate !== scope)
    }
  }

  function dependencyOptions(): AgentPresetStepRecord[] {
    const currentIndex = editingStepId ? presetSteps.findIndex((step) => step.id === editingStepId) : presetSteps.length
    const maxIndex = currentIndex < 0 ? presetSteps.length : currentIndex
    return presetSteps.filter(
      (step, index) => step.enabled && step.phase === draftStepPhase && step.id !== editingStepId && index < maxIndex,
    )
  }

  function inputScopesForPhase(phase: AgentPresetStepPhase): AgentPresetStepInputScope[] {
    return AGENT_PRESET_STEP_INPUT_SCOPES.filter((scope) => phase === 'afterMain' || scope !== 'mainDraft')
  }

  async function savePreset(): Promise<void> {
    if (!canSave) return
    if (mode === 'edit') {
      if (Object.keys(metadataPatch).length === 0) return
      await onSave(metadataPatch)
      return
    }
    await onSave(snapshotForSave())
  }

  async function saveStep(): Promise<void> {
    if (!canSaveStep || !initialPresetId || !stepEditorMode) return
    const finalSnapshot = stepSnapshotForSave()
    const patch = stepInitialSnapshot ? sparseAgentPresetStepPatch(stepInitialSnapshot, finalSnapshot) : finalSnapshot
    if (stepEditorMode === 'edit' && editingStepId && Object.keys(patch).length === 0) {
      clearStepEditor()
      return
    }
    stepBusy = true
    stepCommandError = ''
    const result =
      stepEditorMode === 'new'
        ? await createAgentPresetStep(initialPresetId, finalSnapshot)
        : editingStepId
          ? await updateAgentPresetStep(initialPresetId, editingStepId, patch)
          : ({ status: 'error', error: language.agentPresets.editStepTargetMissing } as ServerCommandResult)
    stepBusy = false
    if (handleStepResult(result)) clearStepEditor()
  }

  async function duplicateStep(step: AgentPresetStepRecord): Promise<void> {
    if (!initialPresetId || stepBusy) return
    stepBusy = true
    stepCommandError = ''
    const result = await duplicateAgentPresetStep(initialPresetId, step.id, {
      name: language.agentPresets.copyName(step.name),
    })
    stepBusy = false
    handleStepResult(result)
  }

  async function deleteStep(step: AgentPresetStepRecord): Promise<void> {
    if (!initialPresetId || stepBusy) return
    if (!window.confirm(language.agentPresets.deleteStepConfirm(step.name))) return
    stepBusy = true
    stepCommandError = ''
    const result = await deleteAgentPresetStep(initialPresetId, step.id)
    stepBusy = false
    if (handleStepResult(result) && editingStepId === step.id) clearStepEditor()
  }

  async function moveStep(step: AgentPresetStepRecord, delta: -1 | 1): Promise<void> {
    if (!initialPresetId || stepBusy) return
    const phaseSteps = stepsForPhase(presetSteps, step.phase)
    const phaseIndex = phaseSteps.findIndex((candidate) => candidate.id === step.id)
    const nextPhaseIndex = phaseIndex + delta
    if (phaseIndex < 0 || nextPhaseIndex < 0 || nextPhaseIndex >= phaseSteps.length) return
    const nextPhaseIds = phaseSteps.map((candidate) => candidate.id)
    const [moved] = nextPhaseIds.splice(phaseIndex, 1)
    nextPhaseIds.splice(nextPhaseIndex, 0, moved)
    let phaseCursor = 0
    const nextIds = presetSteps.map((candidate) =>
      candidate.phase === step.phase ? (nextPhaseIds[phaseCursor++] ?? candidate.id) : candidate.id,
    )
    stepBusy = true
    stepCommandError = ''
    const result = await reorderAgentPresetSteps(initialPresetId, nextIds)
    stepBusy = false
    handleStepResult(result)
  }

  function handleStepResult(result: ServerCommandResult<any>): boolean {
    if (result.status === 'ok') return true
    stepCommandError =
      result.status === 'conflict'
        ? language.agentPresets.commandConflict
        : result.status === 'error'
          ? result.error
          : language.agentPresets.commandUnavailable
    return false
  }

  function requestClose(): void {
    if (controlsLocked) return
    if (isDirty && !window.confirm(language.agentPresets.discardChangesConfirm)) return
    onCancel()
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    requestClose()
  }

  function stepPhaseLabel(phase: AgentPresetStepPhase): string {
    return phase === 'beforeMain' ? language.agentPresets.beforeMain : language.agentPresets.afterMain
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-modal-root class="fixed inset-0 z-50 flex justify-end bg-black/50" onclick={requestClose}>
  <div
    use:modalFocusTrap
    class="flex h-full w-full max-w-4xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-busy={controlsLocked}
    aria-label={drawerTitle}
    tabindex="-1"
    data-risu-agent-preset-editor
    onclick={(event) => {
      event.stopPropagation()
    }}
    onkeydown={handleDialogKeydown}>
    <div class="flex items-start justify-between gap-3 border-b border-darkborderc p-4">
      <div class="min-w-0">
        <h3 class="truncate text-xl font-semibold">{drawerTitle}</h3>
        <span class="text-sm text-textcolor2">{language.agentPresets.editorNotice}</span>
      </div>
      <button
        type="button"
        data-modal-initial-focus
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-darkbutton"
        aria-label={language.modelRoles.close}
        disabled={controlsLocked}
        onclick={requestClose}>
        <XIcon size={20} />
      </button>
    </div>

    <fieldset
      class="m-0 flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-0 p-4"
      disabled={controlsLocked}
      data-risu-agent-preset-controls>
      {#if commandError}
        <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
      {/if}

      <section class="rounded-md border border-darkborderc p-3">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{language.agentPresets.nameLabel}</span>
            <span data-risu-agent-preset-name-input>
              <TextInput bind:value={draftName} fullwidth placeholder={language.agentPresets.newPresetName} />
            </span>
          </label>
          <div class="flex flex-col gap-3">
            <CheckInput
              bind:check={draftEnabled}
              name={language.agentPresets.enabledLabel}
              onChange={(value) => {
                draftEnabled = value
              }} />
            <CheckInput
              bind:check={limitConcurrency}
              name={language.agentPresets.limitConcurrency}
              onChange={(value) => {
                limitConcurrency = value
              }} />
          </div>
        </div>
        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.descriptionLabel}</span>
          <textarea
            class="min-h-20 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm text-textcolor shadow-xs focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            bind:value={draftDescription}
            placeholder={language.agentPresets.descriptionPlaceholder}
            data-risu-agent-preset-description-input></textarea>
        </label>
        <label class="mt-3 flex max-w-xs flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.maxConcurrency}</span>
          <NumberInput
            bind:value={draftMaxConcurrency}
            min={AGENT_PRESET_MAX_CONCURRENCY_MIN}
            max={AGENT_PRESET_MAX_CONCURRENCY_MAX}
            step={1}
            fullwidth
            disabled={!limitConcurrency} />
        </label>
      </section>

      <section class="rounded-md border border-darkborderc p-3" data-risu-agent-preset-step-editor>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-base font-semibold">{language.agentPresets.stepsTitle}</h4>
          <Button size="sm" disabled={mode !== 'edit' || stepBusy || busy} onclick={beginCreateStep}>
            <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.agentPresets.createStep}</span>
          </Button>
        </div>

        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-md border border-darkborderc p-3">
            <h5 class="text-sm font-semibold">{language.agentPresets.beforeMain}</h5>
            {#if beforeMainSteps.length === 0}
              <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.noStepsInPhase}</p>
            {:else}
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                {#each beforeMainSteps as step, phaseIndex (step.id)}
                  <li class="rounded-sm border border-darkborderc p-2" data-risu-agent-preset-step-row>
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        class="min-w-0 text-left"
                        onclick={() => beginEditStep(step)}
                        data-risu-agent-preset-step-edit>
                        <span class="block truncate font-medium">{step.name}</span>
                        <span class="text-xs text-textcolor2">{language.agentPresets.outputKey}: {step.outputKey}</span>
                      </button>
                      <div class="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          styled="outlined"
                          disabled={stepBusy || phaseIndex <= 0}
                          onclick={() => moveStep(step, -1)}>
                          <ArrowUpIcon size={14} />
                        </Button>
                        <Button
                          size="sm"
                          styled="outlined"
                          disabled={stepBusy || phaseIndex >= beforeMainSteps.length - 1}
                          onclick={() => moveStep(step, 1)}>
                          <ArrowDownIcon size={14} />
                        </Button>
                        <Button size="sm" styled="outlined" disabled={stepBusy} onclick={() => duplicateStep(step)}>
                          <CopyIcon size={14} />
                        </Button>
                        <Button size="sm" styled="danger" disabled={stepBusy} onclick={() => deleteStep(step)}>
                          <TrashIcon size={14} />
                        </Button>
                      </div>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div class="rounded-md border border-darkborderc p-3">
            <h5 class="text-sm font-semibold">{language.agentPresets.afterMain}</h5>
            {#if afterMainSteps.length === 0}
              <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.noStepsInPhase}</p>
            {:else}
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                {#each afterMainSteps as step, phaseIndex (step.id)}
                  <li class="rounded-sm border border-darkborderc p-2" data-risu-agent-preset-step-row>
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        class="min-w-0 text-left"
                        onclick={() => beginEditStep(step)}
                        data-risu-agent-preset-step-edit>
                        <span class="block truncate font-medium">{step.name}</span>
                        <span class="text-xs text-textcolor2">{language.agentPresets.outputKey}: {step.outputKey}</span>
                      </button>
                      <div class="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          styled="outlined"
                          disabled={stepBusy || phaseIndex <= 0}
                          onclick={() => moveStep(step, -1)}>
                          <ArrowUpIcon size={14} />
                        </Button>
                        <Button
                          size="sm"
                          styled="outlined"
                          disabled={stepBusy || phaseIndex >= afterMainSteps.length - 1}
                          onclick={() => moveStep(step, 1)}>
                          <ArrowDownIcon size={14} />
                        </Button>
                        <Button size="sm" styled="outlined" disabled={stepBusy} onclick={() => duplicateStep(step)}>
                          <CopyIcon size={14} />
                        </Button>
                        <Button size="sm" styled="danger" disabled={stepBusy} onclick={() => deleteStep(step)}>
                          <TrashIcon size={14} />
                        </Button>
                      </div>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>

        {#if stepCommandError}
          <div class="mt-3 rounded-md border border-draculared p-3 text-sm text-draculared">{stepCommandError}</div>
        {/if}

        {#if stepEditorMode}
          <div class="mt-3 rounded-md border border-darkborderc p-3" data-risu-agent-preset-step-form>
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h5 class="text-sm font-semibold">{stepFormTitle}</h5>
                {#if activeStep}
                  <span class="text-xs text-textcolor2">{activeStep.id}</span>
                {/if}
              </div>
              <span data-risu-agent-preset-step-cancel>
                <Button size="sm" styled="outlined" disabled={stepBusy} onclick={cancelStepEdit}>
                  {language.agentPresets.cancelStep}
                </Button>
              </span>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.stepNameLabel}</span>
                <TextInput bind:value={draftStepName} size="sm" fullwidth />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.stepPhaseLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepPhase}
                  onchange={(event) => setDraftStepPhase(event.currentTarget.value as AgentPresetStepPhase)}>
                  <option value="beforeMain">{language.agentPresets.beforeMain}</option>
                  <option value="afterMain">{language.agentPresets.afterMain}</option>
                </SelectInput>
              </label>
              <div class="flex items-end">
                <CheckInput
                  bind:check={draftStepEnabled}
                  name={language.agentPresets.stepEnabledLabel}
                  onChange={(value) => {
                    draftStepEnabled = value
                  }} />
              </div>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.outputKey}</span>
                <TextInput bind:value={draftStepOutputKey} size="sm" fullwidth />
                {#if draftStepOutputKey.trim() && !outputKeyValid}
                  <span class="text-xs text-draculared">{language.agentPresets.invalidOutputKey}</span>
                {/if}
              </label>
            </div>

            <label class="mt-3 flex flex-col gap-1">
              <span class="text-sm font-medium">{language.agentPresets.instructionLabel}</span>
              <textarea
                class="min-h-28 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm text-textcolor shadow-xs focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                bind:value={draftStepInstruction}></textarea>
            </label>

            <div class="mt-3 grid gap-3 md:grid-cols-3">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.modelModeLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepModelMode}
                  onchange={(event) => setDraftModelMode(event.currentTarget.value as StepModelMode)}>
                  <option value="inheritMain">{language.agentPresets.inheritMainModel}</option>
                  <option value="modelProfile">{language.agentPresets.selectedModelProfile}</option>
                </SelectInput>
              </label>
              <label class="flex flex-col gap-1 md:col-span-2">
                <span class="text-sm font-medium">{language.agentPresets.modelProfileLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepModelProfileId}
                  onchange={(event) => {
                    draftStepModelProfileId = event.currentTarget.value
                  }}>
                  <option value="">{language.agentPresets.noModelProfiles}</option>
                  {#each modelProfiles as profile (profile.id)}
                    <option value={profile.id}>{profile.name ?? profile.id}</option>
                  {/each}
                </SelectInput>
              </label>
            </div>

            <div class="mt-3 grid gap-3 md:grid-cols-3">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.outputFormatLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepOutputFormat}
                  onchange={(event) => {
                    draftStepOutputFormat = event.currentTarget.value as AgentPresetStepOutputFormat
                  }}>
                  <option value="text">{language.agentPresets.outputFormatText}</option>
                  <option value="jsonObject">{language.agentPresets.outputFormatJsonObject}</option>
                </SelectInput>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.destinationLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepDestination}
                  onchange={(event) => setDraftDestination(event.currentTarget.value as AgentPresetStepDestination)}>
                  <option value="promptOutput">{language.agentPresets.destinationPromptOutput}</option>
                  <option value="intermediate">{language.agentPresets.destinationIntermediate}</option>
                  {#if draftStepPhase === 'beforeMain'}
                    <option value="userInput">{language.agentPresets.destinationUserInput}</option>
                  {:else}
                    <option value="finalOutput">{language.agentPresets.destinationFinalOutput}</option>
                  {/if}
                </SelectInput>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.failurePolicyLabel}</span>
                <SelectInput
                  size="sm"
                  className="w-full"
                  value={draftStepFailurePolicyMode}
                  onchange={(event) => {
                    draftStepFailurePolicyMode = event.currentTarget.value as StepFailurePolicyMode
                  }}>
                  <option value="required">{language.agentPresets.failurePolicyRequired}</option>
                  <option value="optional">{language.agentPresets.failurePolicyOptional}</option>
                  <option value="fallbackText">{language.agentPresets.failurePolicyFallbackText}</option>
                  <option value="stopGeneration">{language.agentPresets.failurePolicyStopGeneration}</option>
                </SelectInput>
              </label>
            </div>

            {#if draftStepFailurePolicyMode === 'fallbackText'}
              <label class="mt-3 flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.fallbackTextLabel}</span>
                <textarea
                  class="min-h-20 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm text-textcolor shadow-xs focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                  bind:value={draftStepFallbackText}></textarea>
              </label>
            {/if}

            <div class="mt-3 grid gap-3 md:grid-cols-4">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.timeoutMsLabel}</span>
                <NumberInput
                  bind:value={draftStepTimeoutMs}
                  min={AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN}
                  max={AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX}
                  step={250}
                  fullwidth />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.maxInputCharsLabel}</span>
                <NumberInput
                  bind:value={draftStepMaxInputChars}
                  min={AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN}
                  max={AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX}
                  step={100}
                  fullwidth />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.maxOutputCharsLabel}</span>
                <NumberInput
                  bind:value={draftStepMaxOutputChars}
                  min={AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN}
                  max={AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX}
                  step={100}
                  fullwidth />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">{language.agentPresets.temperatureLabel}</span>
                <NumberInput
                  bind:value={draftStepTemperature}
                  min={AGENT_PRESET_RUNTIME_TEMPERATURE_MIN}
                  max={AGENT_PRESET_RUNTIME_TEMPERATURE_MAX}
                  step={1}
                  fullwidth />
              </label>
            </div>

            <div class="mt-3 flex flex-col gap-3">
              <div class="rounded-md border border-darkborderc p-3">
                <h6 class="text-sm font-semibold">{language.agentPresets.dependenciesLabel}</h6>
                {#if validDependencyOptions.length === 0}
                  <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.noDependencyOptions}</p>
                {:else}
                  <div class="mt-2 flex flex-col gap-2">
                    {#each validDependencyOptions as dependency (dependency.id)}
                      <CheckInput
                        check={draftStepDependencies.includes(dependency.id)}
                        name={`${dependency.name} (${stepPhaseLabel(dependency.phase)})`}
                        onChange={(value) => toggleDependency(dependency.id, value)} />
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="rounded-md border border-darkborderc p-3">
                <h6
                  class="inline-flex items-center gap-1 text-sm font-semibold"
                  data-risu-agent-preset-prepared-inputs-heading>
                  {language.agentPresets.preparedInputScopesLabel}
                  <Help key="agentPresetPreparedInputs" name={language.agentPresets.preparedInputScopesLabel} />
                </h6>
                <p class="mt-1 text-xs text-textcolor2">{language.agentPresets.preparedInputScopesDescription}</p>
                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                  {#each visibleInputScopes as scope (scope)}
                    <div
                      class="flex flex-col gap-1 rounded-md border border-darkborderc p-2.5"
                      class:bg-darkbutton={draftStepInputScopes.includes(scope)}
                      data-risu-agent-preset-input-scope={scope}>
                      <CheckInput
                        check={draftStepInputScopes.includes(scope)}
                        name={language.agentPresets.inputScopeLabels[scope]}
                        onChange={(value) => toggleInputScope(scope, value)} />
                      <p
                        class="pl-7 text-xs leading-relaxed text-textcolor2"
                        data-risu-agent-preset-input-scope-description>
                        {language.agentPresets.inputScopeDescriptions[scope]}
                      </p>
                      <span class="mt-1 pl-7 text-xs text-textcolor2" data-risu-agent-preset-input-scope-cbs>
                        {language.agentPresets.preparedInputCbsNameLabel}:
                        <code class="rounded-sm bg-darkbg px-1 py-0.5 font-mono text-[0.7rem] text-textcolor">
                          {`{{${scope}}}`}
                        </code>
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>

            <div class="mt-3 flex justify-end">
              <span data-risu-agent-preset-step-save>
                <Button size="sm" disabled={!canSaveStep} onclick={saveStep}>
                  <span class="inline-flex items-center gap-2"
                    ><SaveIcon size={16} />{stepBusy
                      ? language.agentPresets.saving
                      : language.agentPresets.saveStep}</span>
                </Button>
              </span>
            </div>
          </div>
        {:else if mode === 'create'}
          <div class="mt-3 rounded-md border border-darkborderc p-3 text-sm text-textcolor2">
            {language.agentPresets.savePresetBeforeSteps}
          </div>
        {/if}
      </section>

      <AgentPresetDiagnosticsPanel presetId={mode === 'edit' ? initialPresetId : ''} />
    </fieldset>

    <div class="flex justify-end gap-2 border-t border-darkborderc p-4">
      <span data-risu-agent-preset-cancel>
        <Button size="sm" styled="outlined" disabled={controlsLocked} onclick={requestClose}>
          {language.agentPresets.cancel}
        </Button>
      </span>
      {#if !stepEditorMode}
        <span data-risu-agent-preset-save>
          <Button size="sm" disabled={!canSave} onclick={savePreset}>
            <span class="inline-flex items-center gap-2"><SaveIcon size={16} />{language.agentPresets.save}</span>
          </Button>
        </span>
      {/if}
    </div>
  </div>
</div>
