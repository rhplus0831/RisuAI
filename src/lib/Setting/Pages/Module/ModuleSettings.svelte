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

  import { DBState } from 'src/ts/stores.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import ModuleMenu from 'src/lib/Setting/Pages/Module/ModuleMenu.svelte'
  import {
    exportModule,
    importModule,
    refreshModules,
    type RisuModule,
  } from 'src/ts/process/modules'
  import {
    SquarePen,
    TrashIcon,
    Globe,
    Share2Icon,
    PlusIcon,
    HardDriveUpload,
    Waypoints,
  } from '@lucide/svelte'
  import { v4 } from 'uuid'
  import { tooltip } from 'src/ts/gui/tooltip'
  import { alertConfirm } from 'src/ts/alert'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { onDestroy } from 'svelte'
  import { importMCPModule } from 'src/ts/process/mcp/mcp'
  import {
    createGlobalModule,
    deleteGlobalModule,
    setGlobalModuleEnabled,
    updateGlobalModule,
  } from 'src/ts/moduleCommands'

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  let tempModule: RisuModule = $state({
    name: '',
    description: '',
    id: v4(),
  })
  let mode = $state(0)
  let editModuleIndex = $state(-1)
  let moduleSearch = $state('')
  let normalizedModuleSearch = $derived(normalizeModuleSearch(moduleSearch))
  let sortedModuleRows = $derived(
    sortModuleSettingsRows(DBState.db.modules ?? [], normalizedModuleSearch),
  )
  let moduleIntegrationNamespaces = $derived(
    parseModuleIntegrationNamespaces(DBState.db.moduleIntergration),
  )

  onDestroy(() => {
    refreshModules()
  })
</script>

{#if mode === 0}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.modules}</h2>

  <TextInput className="mt-4" placeholder={language.search} bind:value={moduleSearch} />

  <div
    class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md flex-1 overflow-y-auto"
  >
    {#if DBState.db.modules.length === 0}
      <div class="text-textcolor2 p-3">{language.noModules}</div>
    {:else}
      {#each sortedModuleRows as moduleRow, i (moduleRow.rmodule.id)}
        {@const rmodule = moduleRow.rmodule}
        {#if i !== 0}
          <div class="border-t-1 border-selected"></div>
        {/if}

        <div class="pl-3 pt-3 text-left flex items-center">
          {#if rmodule.mcp}
            <Waypoints size={18} class="mr-2" />
          {/if}
          <span class="text-lg">{rmodule.name}</span>
          <div class="grow flex justify-end">
            <button
              class={DBState.db.enabledModules.includes(rmodule.id)
                ? 'mr-2 cursor-pointer text-blue-500'
                : rmodule.namespace &&
                    moduleIntegrationNamespaces.has(rmodule.namespace)
                  ? 'text-amber-500 hover:text-green-500 mr-2 cursor-pointer'
                  : 'text-textcolor2 hover:text-green-500 mr-2 cursor-pointer'}
              use:tooltip={language.enableGlobal}
              onclick={async (e) => {
                e.stopPropagation()
                const enabled = !DBState.db.enabledModules.includes(rmodule.id)
                setGlobalModuleEnabled(rmodule.id, enabled)
              }}
            >
              <Globe size={18} />
            </button>
            {#if !rmodule.mcp}
              <button
                class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                use:tooltip={language.download}
                onclick={async (e) => {
                  e.stopPropagation()
                  exportModule(rmodule)
                }}
              >
                <Share2Icon size={18} />
              </button>
              <button
                class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                use:tooltip={language.edit}
                onclick={async (e) => {
                  e.stopPropagation()
                  tempModule = cloneJsonValue(rmodule)
                  editModuleIndex = moduleRow.index
                  mode = 2
                }}
              >
                <SquarePen size={18} />
              </button>
            {:else}
              <button class="text-textcolor2 mr-2 cursor-not-allowed">
                <Share2Icon size={18} />
              </button>
              <button class="text-textcolor2 mr-2 cursor-not-allowed">
                <SquarePen size={18} />
              </button>
            {/if}
            <button
              class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
              use:tooltip={language.remove}
              onclick={async (e) => {
                e.stopPropagation()
                const d = await alertConfirm(`${language.removeConfirm}` + rmodule.name)
                if (d) {
                  deleteGlobalModule(rmodule.id)
                }
              }}
            >
              <TrashIcon size={18} />
            </button>
          </div>
        </div>
        <div class="mt-1 mb-3 pl-3">
          <span class="text-sm text-textcolor2"
            >{rmodule.description || 'No description provided'}</span
          >
        </div>
      {/each}
    {/if}
  </div>

  <div class="flex mr-2 mt-4">
    <button
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        tempModule = {
          name: '',
          description: '',
          id: v4(),
        }
        mode = 1
      }}
    >
      <PlusIcon />
    </button>
    <button
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        importMCPModule()
      }}
    >
      <Waypoints />
    </button>
    <button
      class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer"
      onclick={async () => {
        importModule()
      }}
    >
      <HardDriveUpload />
    </button>
  </div>
{:else if mode === 1}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.createModule}</h2>
  <ModuleMenu bind:currentModule={tempModule} />
  <Button
    className="mt-6"
    onclick={() => {
      createGlobalModule(cloneJsonValue(tempModule))
      mode = 0
    }}>{language.createModule}</Button
  >
{:else if mode === 2}
  <h2 class="mb-2 text-2xl font-bold mt-2">{language.editModule}</h2>
  <ModuleMenu bind:currentModule={tempModule} />
  {#if tempModule.name !== ''}
    <Button
      className="mt-6"
      onclick={() => {
        updateGlobalModule(tempModule.id, cloneJsonValue(tempModule))
        mode = 0
      }}>{language.editModule}</Button
    >
  {/if}
{/if}
