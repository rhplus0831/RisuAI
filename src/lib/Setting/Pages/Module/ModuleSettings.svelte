<script lang="ts" module>
  import type { RisuModule as ModuleSettingsRisuModule } from 'src/ts/process/modules'

  export interface ModuleSettingsModuleRow {
    rmodule: ModuleSettingsRisuModule
    index: number
    normalizedName: string
  }

  export function normalizeModuleSearch(search: string) {
    return search.toLowerCase()
  }

  export function sortModuleSettingsRows(
    modules: readonly ModuleSettingsRisuModule[],
    normalizedSearch: string,
  ): ModuleSettingsModuleRow[] {
    const rows: ModuleSettingsModuleRow[] = []

    for (let index = 0; index < modules.length; index++) {
      const rmodule = modules[index]
      const normalizedName = normalizeModuleSearch(rmodule.name)
      if (normalizedSearch !== '' && !normalizedName.includes(normalizedSearch)) {
        continue
      }

      rows.push({ rmodule, index, normalizedName })
    }

    return rows.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName))
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'

  import Button from 'src/lib/UI/GUI/Button.svelte'
  import ModuleMenu from 'src/lib/Setting/Pages/Module/ModuleMenu.svelte'
  import { exportModule, importModule, refreshModules, type RisuModule } from 'src/ts/process/modules'
  import { SquarePen, TrashIcon, Globe, Share2Icon, PlusIcon, HardDriveUpload, Waypoints } from '@lucide/svelte'
  import { v4 } from 'uuid'
  import { tooltip } from 'src/ts/gui/tooltip'
  import { alertConfirm, alertError, alertNormal } from 'src/ts/alert'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { onDestroy, onMount } from 'svelte'
  import { importMCPModule } from 'src/ts/process/mcp/mcp'
  import {
    createGlobalModuleWithOutcome,
    deleteGlobalModule,
    rebaseModuleEditorDraftOntoLatest,
    saveGlobalModuleDraftWithOutcome,
    setGlobalModuleEnabled,
    type ModuleMutationOutcome,
    type ModuleEditorSaveOutcome,
  } from 'src/ts/moduleCommands'
  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import { resolveActiveModuleStates, type ModuleActivationSource } from 'src/ts/moduleActivation'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import {
    deleteModuleEditorDraft,
    isModuleEditorDraftGenerationCurrent,
    readLatestModuleEditorDraft,
    registerModuleEditorDraftStorageFailureListener,
    writeModuleEditorDraft,
    type ModuleEditorDraftGeneration,
    type ModuleEditorDraftInput,
  } from 'src/ts/server/moduleEditorDraftStore'

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  let tempModule: RisuModule = $state({
    name: '',
    description: '',
    id: v4(),
  })
  let editBaseline: RisuModule | null = null
  let mode = $state(0)
  let mutationPending = $state(false)
  let mcpImportPending = $state(false)
  let mutationError = $state('')
  let draftStorageError = $state('')
  let rowMutationPending = $state<Record<string, 'toggle' | 'delete'>>({})
  let rowMutationErrors = $state<Record<string, string>>({})
  let moduleSearch = $state('')
  let normalizedModuleSearch = $derived(normalizeModuleSearch(moduleSearch))
  let sortedModuleRows = $derived(sortModuleSettingsRows(getResourceDatabase().modules ?? [], normalizedModuleSearch))
  let activeModuleStates = $derived.by(() => {
    const database = getResourceDatabase()
    const character = database.characters[$selectedCharID]
    const chat = character?.chats?.[character.chatPage]
    return new Map(resolveActiveModuleStates(database, character, chat).map((state) => [state.module.id, state]))
  })
  let activeDraftGeneration: ModuleEditorDraftGeneration | null = null
  let lastCapturedDraftFingerprint = ''
  let restoreAttempt = 0
  let saveAttempt = 0
  let componentMounted = false
  let mutationErrorAlerted = false
  let draftStorageErrorAlerted = false
  let editorFieldset: HTMLFieldSetElement | null = $state(null)

  function reportDraftStorageFailure(): void {
    draftStorageError = language.moduleSave.draftStorageFailed
    if (draftStorageErrorAlerted) return
    draftStorageErrorAlerted = true
    alertError(draftStorageError)
  }

  const unregisterDraftStorageFailure = registerModuleEditorDraftStorageFailureListener(reportDraftStorageFailure)

  function reportModuleSaveFailure(message: string): void {
    mutationError = message
    if (mutationErrorAlerted) return
    mutationErrorAlerted = true
    alertError(message)
  }

  function beginModuleSaveAttempt(): number {
    mutationError = ''
    mutationErrorAlerted = false
    saveAttempt += 1
    return saveAttempt
  }

  function editorDraftInput(): ModuleEditorDraftInput | null {
    if (mode !== 1 && mode !== 2) return null
    return {
      mode: mode === 1 ? 'create' : 'edit',
      moduleId: tempModule.id,
      editBaseline: mode === 2 && editBaseline ? cloneJsonValue(editBaseline) : null,
      tempModule: cloneJsonValue(tempModule),
    }
  }

  function captureModuleEditorDraft(input: ModuleEditorDraftInput): ModuleEditorDraftGeneration | null {
    const fingerprint = JSON.stringify(input)
    if (fingerprint === lastCapturedDraftFingerprint && activeDraftGeneration) return activeDraftGeneration
    const handle = writeModuleEditorDraft(input)
    activeDraftGeneration = handle.generation
    lastCapturedDraftFingerprint = fingerprint
    void handle.ready.then((status) => {
      if (status === 'unavailable') reportDraftStorageFailure()
    })
    return handle.generation
  }

  function captureCurrentModuleEditorDraft(): ModuleEditorDraftGeneration | null {
    const input = editorDraftInput()
    return input ? captureModuleEditorDraft(input) : null
  }

  function resetEditorDraftRuntime(): void {
    activeDraftGeneration = null
    lastCapturedDraftFingerprint = ''
  }

  function beginEditorInteraction(): void {
    restoreAttempt += 1
    mutationError = ''
    mutationErrorAlerted = false
    resetEditorDraftRuntime()
  }

  async function closeAcceptedModuleEditor(generation: ModuleEditorDraftGeneration | null): Promise<void> {
    if (generation) await deleteModuleEditorDraft(generation)
    if (!componentMounted) return
    editBaseline = null
    mode = 0
    resetEditorDraftRuntime()
  }

  function retainQueuedModuleSave(
    outcome: Extract<ModuleEditorSaveOutcome, { status: 'queued' }>,
    generation: ModuleEditorDraftGeneration | null,
    attempt: number,
  ): void {
    void outcome.settlement.then(async (settlement) => {
      if (settlement.status === 'failed') {
        if (!componentMounted || attempt !== saveAttempt) return
        reportModuleSaveFailure(moduleMutationError(settlement.result))
        return
      }
      if (!generation || !(await isModuleEditorDraftGenerationCurrent(generation))) return
      await deleteModuleEditorDraft(generation)
      if (
        componentMounted &&
        attempt === saveAttempt &&
        activeDraftGeneration?.key === generation.key &&
        activeDraftGeneration.sequence === generation.sequence
      ) {
        editBaseline = null
        mode = 0
        resetEditorDraftRuntime()
      }
    })
  }

  async function discardActiveModuleDraft(): Promise<void> {
    restoreAttempt += 1
    saveAttempt += 1
    const generation = activeDraftGeneration
    mode = 0
    editBaseline = null
    resetEditorDraftRuntime()
    if (generation) await deleteModuleEditorDraft(generation)
  }

  async function restoreLatestModuleEditorDraft(attempt: number): Promise<void> {
    const recovered = await readLatestModuleEditorDraft()
    if (!recovered || !componentMounted || attempt !== restoreAttempt || mode !== 0) return
    activeDraftGeneration = recovered.generation
    lastCapturedDraftFingerprint = ''
    mutationError = ''

    if (recovered.mode === 'create') {
      const canonical = getResourceDatabase().modules.find((candidate) => candidate.id === recovered.moduleId)
      if (canonical && JSON.stringify(canonical) === JSON.stringify(recovered.tempModule)) {
        await deleteModuleEditorDraft(recovered.generation)
        resetEditorDraftRuntime()
        return
      }
      tempModule = cloneJsonValue(recovered.tempModule)
      editBaseline = null
      mode = 1
      return
    }

    const latest = getResourceDatabase().modules.find((candidate) => candidate.id === recovered.moduleId)
    if (!latest || !recovered.editBaseline) {
      tempModule = cloneJsonValue(recovered.tempModule)
      editBaseline = recovered.editBaseline ? cloneJsonValue(recovered.editBaseline) : null
      mutationError = language.moduleSave.editTargetMissing
      mode = 3
      return
    }
    const latestSnapshot = cloneJsonValue(latest)
    const rebased = rebaseModuleEditorDraftOntoLatest(recovered.editBaseline, recovered.tempModule, latestSnapshot)
    if (JSON.stringify(rebased) === JSON.stringify(latestSnapshot)) {
      await deleteModuleEditorDraft(recovered.generation)
      resetEditorDraftRuntime()
      return
    }
    tempModule = rebased
    editBaseline = latestSnapshot
    mode = 2
  }

  function copyRecoveredModuleDraft(): void {
    void globalThis.navigator?.clipboard
      ?.writeText(JSON.stringify(tempModule, null, 2))
      .then(() => alertNormal(language.moduleSave.draftCopied))
      .catch((error) => alertError(error))
  }

  $effect(() => {
    const currentMode = mode
    const moduleSnapshot = cloneJsonValue(tempModule)
    const baselineSnapshot = editBaseline ? cloneJsonValue(editBaseline) : null
    if (currentMode !== 1 && currentMode !== 2) return
    captureModuleEditorDraft({
      mode: currentMode === 1 ? 'create' : 'edit',
      moduleId: moduleSnapshot.id,
      editBaseline: currentMode === 2 ? baselineSnapshot : null,
      tempModule: moduleSnapshot,
    })
  })

  $effect(() => {
    const fieldset = editorFieldset
    const disabled = mutationPending
    if (!fieldset) return
    for (const element of fieldset.querySelectorAll<HTMLElement>('[contenteditable]')) {
      element.setAttribute('contenteditable', disabled ? 'false' : 'true')
      element.setAttribute('aria-disabled', disabled ? 'true' : 'false')
    }
  })

  function isModuleEnabled(moduleId: string) {
    return getResourceDatabase().enabledModules.includes(moduleId)
  }

  function hasActivationSource(moduleId: string, source: ModuleActivationSource) {
    return activeModuleStates.get(moduleId)?.sources.includes(source) ?? false
  }

  function isModuleIntegrated(moduleId: string) {
    return (
      hasActivationSource(moduleId, 'promptPresetIntegration') ||
      hasActivationSource(moduleId, 'agentPresetIntegration') ||
      hasActivationSource(moduleId, 'legacyIntegration')
    )
  }

  function moduleIntegrationState(rmodule: RisuModule) {
    if (isModuleIntegrated(rmodule.id)) return 'integrated'
    return rmodule.namespace ? 'unmatched' : 'none'
  }

  function moduleMutationError(result: ServerCommandResult): string {
    if (result.status === 'conflict') return language.moduleSave.commandConflict
    if (result.status === 'unavailable') return language.moduleSave.commandUnavailable
    if (result.status === 'error') return language.moduleSave.commandError(result.error)
    return ''
  }

  function thrownMutationError(error: unknown): string {
    return language.moduleSave.commandError(error instanceof Error ? error.message : String(error))
  }

  function isRowMutationPending(moduleId: string): boolean {
    return rowMutationPending[moduleId] !== undefined
  }

  function beginRowMutation(moduleId: string, action: 'toggle' | 'delete'): boolean {
    if (isRowMutationPending(moduleId)) return false
    rowMutationPending[moduleId] = action
    const nextErrors = { ...rowMutationErrors }
    delete nextErrors[moduleId]
    rowMutationErrors = nextErrors
    return true
  }

  function finishRowMutation(moduleId: string): void {
    delete rowMutationPending[moduleId]
  }

  function reconcileRowMutation(moduleId: string, outcome: ModuleMutationOutcome): void {
    if (outcome.status === 'queued') {
      alertNormal(language.moduleSave.queued)
      return
    }
    if (outcome.status === 'failed') {
      rowMutationErrors = { ...rowMutationErrors, [moduleId]: moduleMutationError(outcome.result) }
    }
  }

  async function toggleGlobalModule(moduleId: string): Promise<void> {
    if (!beginRowMutation(moduleId, 'toggle')) return
    try {
      const enabled = !getResourceDatabase().enabledModules.includes(moduleId)
      reconcileRowMutation(moduleId, await setGlobalModuleEnabled(moduleId, enabled))
    } catch (error) {
      rowMutationErrors = { ...rowMutationErrors, [moduleId]: thrownMutationError(error) }
    } finally {
      finishRowMutation(moduleId)
    }
  }

  async function removeGlobalModule(moduleId: string, moduleName: string): Promise<void> {
    if (!beginRowMutation(moduleId, 'delete')) return
    try {
      const confirmed = await alertConfirm(`${language.removeConfirm}${moduleName}`)
      if (!confirmed) return
      reconcileRowMutation(moduleId, await deleteGlobalModule(moduleId))
    } catch (error) {
      rowMutationErrors = { ...rowMutationErrors, [moduleId]: thrownMutationError(error) }
    } finally {
      finishRowMutation(moduleId)
    }
  }

  async function createModuleFromDraft() {
    if (mutationPending) return
    if (tempModule.name.trim() === '') {
      alertError(language.errors.emptyText)
      return
    }

    const draft = cloneJsonValue(tempModule)
    const generation = captureCurrentModuleEditorDraft()
    const attempt = beginModuleSaveAttempt()
    mutationPending = true
    try {
      const outcome = await createGlobalModuleWithOutcome(draft)
      if (outcome.status === 'accepted') {
        await closeAcceptedModuleEditor(generation)
        return
      }
      if (outcome.status === 'queued') {
        retainQueuedModuleSave(outcome, generation, attempt)
        return
      }
      reportModuleSaveFailure(moduleMutationError(outcome.result))
    } catch (error) {
      reportModuleSaveFailure(thrownMutationError(error))
    } finally {
      mutationPending = false
    }
  }

  async function updateModuleFromDraft() {
    if (mutationPending) return

    const draft = cloneJsonValue(tempModule)
    const generation = captureCurrentModuleEditorDraft()
    const attempt = beginModuleSaveAttempt()
    const latest = getResourceDatabase().modules.find((candidate) => candidate.id === draft.id)
    if (!latest || editBaseline?.id !== draft.id) {
      reportModuleSaveFailure(language.moduleSave.editTargetMissing)
      return
    }
    const rebasedDraft = rebaseModuleEditorDraftOntoLatest(editBaseline, draft, cloneJsonValue(latest))

    mutationPending = true
    try {
      const outcome = await saveGlobalModuleDraftWithOutcome(draft.id, rebasedDraft)
      if (outcome.status === 'accepted') {
        await closeAcceptedModuleEditor(generation)
        return
      }
      if (outcome.status === 'queued') {
        retainQueuedModuleSave(outcome, generation, attempt)
        return
      }
      reportModuleSaveFailure(moduleMutationError(outcome.result))
    } catch (error) {
      reportModuleSaveFailure(thrownMutationError(error))
    } finally {
      mutationPending = false
    }
  }

  onMount(() => {
    componentMounted = true
    const attempt = restoreAttempt
    void restoreLatestModuleEditorDraft(attempt)
  })

  onDestroy(() => {
    componentMounted = false
    restoreAttempt += 1
    saveAttempt += 1
    unregisterDraftStorageFailure()
    refreshModules()
  })
</script>

{#if mode === 0}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.modules}</h2>

  {#if draftStorageError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {draftStorageError}
    </div>
  {/if}

  <TextInput className="mt-4" placeholder={language.search} bind:value={moduleSearch} />

  <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md flex-1 overflow-y-auto">
    {#if getResourceDatabase().modules.length === 0}
      <div class="text-textcolor2 p-3">{language.noModules}</div>
    {:else}
      {#each sortedModuleRows as moduleRow, i (moduleRow.rmodule.id)}
        {@const rmodule = moduleRow.rmodule}
        {@const moduleName = rmodule.name}
        {#if i !== 0}
          <div class="border-t-1 border-selected"></div>
        {/if}

        <div
          class="pl-3 pt-3 text-left flex items-center"
          data-risu-module-row
          data-risu-row-id={rmodule.id}
          data-risu-row-index={moduleRow.index}
          aria-busy={isRowMutationPending(rmodule.id)}
          data-risu-enabled={isModuleEnabled(rmodule.id) ? 'true' : 'false'}
          data-risu-integration-state={moduleIntegrationState(rmodule)}>
          {#if rmodule.mcp}
            <Waypoints size={18} class="mr-2" />
          {/if}
          <span class="text-lg" data-risu-module-name>{moduleName}</span>
          <div class="grow flex justify-end">
            <button
              data-risu-module-action="toggle-enabled"
              aria-label={`${language.enableGlobal}: ${moduleName}`}
              aria-pressed={isModuleEnabled(rmodule.id)}
              disabled={isRowMutationPending(rmodule.id)}
              class={isModuleEnabled(rmodule.id)
                ? 'mr-2 cursor-pointer text-blue-500'
                : isModuleIntegrated(rmodule.id)
                  ? 'text-amber-500 hover:text-green-500 mr-2 cursor-pointer'
                  : 'text-textcolor2 hover:text-green-500 mr-2 cursor-pointer'}
              use:tooltip={language.enableGlobal}
              onclick={async (e) => {
                e.stopPropagation()
                await toggleGlobalModule(rmodule.id)
              }}>
              <Globe size={18} />
            </button>
            {#if !rmodule.mcp}
              <button
                data-risu-module-action="export"
                aria-label={`${language.download}: ${moduleName}`}
                class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                use:tooltip={language.download}
                onclick={async (e) => {
                  e.stopPropagation()
                  exportModule(rmodule)
                }}>
                <Share2Icon size={18} />
              </button>
              <button
                data-risu-module-action="edit"
                aria-label={`${language.edit}: ${moduleName}`}
                disabled={isRowMutationPending(rmodule.id)}
                class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                use:tooltip={language.edit}
                onclick={async (e) => {
                  e.stopPropagation()
                  beginEditorInteraction()
                  const baseline = cloneJsonValue(rmodule)
                  tempModule = cloneJsonValue(baseline)
                  editBaseline = baseline
                  mutationError = ''
                  mode = 2
                }}>
                <SquarePen size={18} />
              </button>
            {:else}
              <button
                data-risu-module-action="export"
                data-risu-action-state="disabled"
                aria-label={`${language.download}: ${moduleName}`}
                aria-disabled="true"
                disabled
                class="text-textcolor2 mr-2 cursor-not-allowed">
                <Share2Icon size={18} />
              </button>
              <button
                data-risu-module-action="edit"
                data-risu-action-state="disabled"
                aria-label={`${language.edit}: ${moduleName}`}
                aria-disabled="true"
                disabled
                class="text-textcolor2 mr-2 cursor-not-allowed">
                <SquarePen size={18} />
              </button>
            {/if}
            <button
              data-risu-module-action="delete"
              aria-label={`${language.remove}: ${moduleName}`}
              disabled={isRowMutationPending(rmodule.id)}
              class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
              use:tooltip={language.remove}
              onclick={async (e) => {
                e.stopPropagation()
                await removeGlobalModule(rmodule.id, moduleName)
              }}>
              <TrashIcon size={18} />
            </button>
          </div>
        </div>
        <div class="mt-1 mb-3 pl-3">
          <span class="text-sm text-textcolor2">{rmodule.description || language.noModuleDescription}</span>
          {#if rowMutationErrors[rmodule.id]}
            <div
              class="mt-1 text-sm text-draculared"
              role="alert"
              data-risu-module-mutation-error
              data-risu-row-id={rmodule.id}>
              {rowMutationErrors[rmodule.id]}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="flex mr-2 mt-4">
    <button
      data-risu-module-action="create"
      aria-label={language.createModule}
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        beginEditorInteraction()
        tempModule = {
          name: '',
          description: '',
          id: v4(),
        }
        editBaseline = null
        mutationError = ''
        mode = 1
      }}>
      <PlusIcon />
    </button>
    <button
      data-risu-module-action="import-mcp"
      aria-label={`${language.import}: MCP`}
      aria-busy={mcpImportPending}
      disabled={mcpImportPending}
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        if (mcpImportPending) return
        mcpImportPending = true
        try {
          await importMCPModule()
        } finally {
          mcpImportPending = false
        }
      }}>
      <Waypoints />
    </button>
    <button
      data-risu-module-action="import"
      aria-label={`${language.import}: ${language.module}`}
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        await importModule()
      }}>
      <HardDriveUpload />
    </button>
  </div>
{:else if mode === 1}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.createModule}</h2>
  {#if mutationError || draftStorageError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {#if mutationError}<div>{mutationError}</div>{/if}
      {#if draftStorageError}<div>{draftStorageError}</div>{/if}
    </div>
  {/if}
  <fieldset bind:this={editorFieldset} class="contents" disabled={mutationPending} aria-busy={mutationPending}>
    <ModuleMenu bind:currentModule={tempModule} draftOnly />
    <div class="mt-6 flex gap-2">
      <div class="contents" data-risu-module-action="submit-create">
        <Button disabled={mutationPending} onclick={createModuleFromDraft}>{language.createModule}</Button>
      </div>
      <div class="contents" data-risu-module-action="discard-draft">
        <Button disabled={mutationPending} onclick={discardActiveModuleDraft}
          >{language.moduleSave.discardDraft}</Button>
      </div>
    </div>
  </fieldset>
{:else if mode === 2}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.editModule}</h2>
  {#if mutationError || draftStorageError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {#if mutationError}<div>{mutationError}</div>{/if}
      {#if draftStorageError}<div>{draftStorageError}</div>{/if}
    </div>
  {/if}
  <fieldset bind:this={editorFieldset} class="contents" disabled={mutationPending} aria-busy={mutationPending}>
    <ModuleMenu bind:currentModule={tempModule} draftOnly />
    <div class="mt-6 flex gap-2">
      {#if tempModule.name !== ''}
        <div class="contents" data-risu-module-action="submit-edit">
          <Button disabled={mutationPending} onclick={updateModuleFromDraft}>{language.editModule}</Button>
        </div>
      {/if}
      <div class="contents" data-risu-module-action="discard-draft">
        <Button disabled={mutationPending} onclick={discardActiveModuleDraft}
          >{language.moduleSave.discardDraft}</Button>
      </div>
    </div>
  </fieldset>
{:else if mode === 3}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.moduleSave.recoveredDraft}</h2>
  <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
    {mutationError || language.moduleSave.editTargetMissing}
  </div>
  {#if draftStorageError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {draftStorageError}
    </div>
  {/if}
  <pre
    class="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-darkborderc p-3 text-sm text-textcolor"
    data-risu-recovered-module-draft>{JSON.stringify(tempModule, null, 2)}</pre>
  <div class="mt-4 flex flex-wrap gap-2">
    <div class="contents" data-risu-module-action="copy-recovered-draft">
      <Button onclick={copyRecoveredModuleDraft}>{language.moduleSave.copyDraft}</Button>
    </div>
    <div class="contents" data-risu-module-action="export-recovered-draft">
      <Button onclick={() => exportModule(cloneJsonValue(tempModule))}>{language.moduleSave.exportDraft}</Button>
    </div>
    <div class="contents" data-risu-module-action="discard-draft">
      <Button onclick={discardActiveModuleDraft}>{language.moduleSave.discardDraft}</Button>
    </div>
  </div>
{/if}
