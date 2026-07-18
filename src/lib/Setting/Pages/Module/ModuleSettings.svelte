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

  export function parseModuleIntegrationNamespaces(moduleIntergration?: string | null) {
    const namespaces = new Set<string>()
    for (const namespace of moduleIntergration?.split(',') ?? []) {
      const normalizedNamespace = namespace.trim()
      if (normalizedNamespace) namespaces.add(normalizedNamespace)
    }
    return namespaces
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
  import { onDestroy } from 'svelte'
  import { importMCPModule } from 'src/ts/process/mcp/mcp'
  import {
    createGlobalModule,
    deleteGlobalModule,
    rebaseModuleEditorDraftOntoLatest,
    saveGlobalModuleDraft,
    setGlobalModuleEnabled,
    type ModuleMutationOutcome,
  } from 'src/ts/moduleCommands'
  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import type { ServerCommandResult } from 'src/ts/server/commands'

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
  let rowMutationPending = $state<Record<string, 'toggle' | 'delete'>>({})
  let rowMutationErrors = $state<Record<string, string>>({})
  let moduleSearch = $state('')
  let normalizedModuleSearch = $derived(normalizeModuleSearch(moduleSearch))
  let sortedModuleRows = $derived(sortModuleSettingsRows(getResourceDatabase().modules ?? [], normalizedModuleSearch))
  let moduleIntegrationNamespaces = $derived(parseModuleIntegrationNamespaces(getResourceDatabase().moduleIntergration))

  function isModuleEnabled(moduleId: string) {
    return getResourceDatabase().enabledModules.includes(moduleId)
  }

  function moduleIntegrationState(rmodule: RisuModule) {
    if (!rmodule.namespace) return 'none'
    return moduleIntegrationNamespaces.has(rmodule.namespace) ? 'integrated' : 'unmatched'
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
    mutationPending = true
    mutationError = ''
    try {
      const result = await createGlobalModule(draft)
      if (result === null || result.status === 'ok') {
        mode = 0
        return
      }
      mutationError = moduleMutationError(result)
    } catch (error) {
      mutationError = thrownMutationError(error)
    } finally {
      mutationPending = false
    }
  }

  async function updateModuleFromDraft() {
    if (mutationPending) return

    const draft = cloneJsonValue(tempModule)
    mutationError = ''
    const latest = getResourceDatabase().modules.find((candidate) => candidate.id === draft.id)
    if (!latest || editBaseline?.id !== draft.id) {
      mutationError = language.moduleSave.editTargetMissing
      return
    }
    const rebasedDraft = rebaseModuleEditorDraftOntoLatest(editBaseline, draft, cloneJsonValue(latest))

    mutationPending = true
    try {
      const result = await saveGlobalModuleDraft(draft.id, rebasedDraft)
      if (result === null || result.status === 'ok') {
        editBaseline = null
        mode = 0
        return
      }
      mutationError = moduleMutationError(result)
    } catch (error) {
      mutationError = thrownMutationError(error)
    } finally {
      mutationPending = false
    }
  }

  onDestroy(() => {
    refreshModules()
  })
</script>

{#if mode === 0}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.modules}</h2>

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
                : rmodule.namespace && moduleIntegrationNamespaces.has(rmodule.namespace)
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
  {#if mutationError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {mutationError}
    </div>
  {/if}
  <fieldset class="contents" disabled={mutationPending} aria-busy={mutationPending}>
    <ModuleMenu bind:currentModule={tempModule} draftOnly />
    <div class="contents" data-risu-module-action="submit-create">
      <Button className="mt-6" disabled={mutationPending} onclick={createModuleFromDraft}>
        {mutationPending ? language.moduleSave.saving : language.createModule}
      </Button>
    </div>
  </fieldset>
{:else if mode === 2}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.editModule}</h2>
  {#if mutationError}
    <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
      {mutationError}
    </div>
  {/if}
  <fieldset class="contents" disabled={mutationPending} aria-busy={mutationPending}>
    <ModuleMenu bind:currentModule={tempModule} draftOnly />
    {#if tempModule.name !== ''}
      <div class="contents" data-risu-module-action="submit-edit">
        <Button className="mt-6" disabled={mutationPending} onclick={updateModuleFromDraft}>
          {mutationPending ? language.moduleSave.saving : language.editModule}
        </Button>
      </div>
    {/if}
  </fieldset>
{/if}
