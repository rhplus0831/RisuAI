<script lang="ts" module>
  import type {
    customscript as ModuleCustomScript,
    loreBook as ModuleLoreBook,
    triggerscript as ModuleTriggerScript,
  } from 'src/ts/storage/database.svelte'
  import {
    type CCLorebook as ModuleCCLorebook,
    convertExternalLorebook as convertExternalModuleLorebook,
  } from 'src/ts/process/lorebook.svelte'
  import type { RisuModule as ImportTargetRisuModule } from 'src/ts/process/modules'
  import { replaceModuleLorebookCollectionDraft as replaceModuleLorebookImportDraft } from 'src/ts/server/lorebookBridge.svelte'
  import { getResourceDatabase as getModuleImportDatabase } from 'src/ts/server/resourceState.svelte'
  import { applyModuleScriptDefinitionDraft as applyModuleScriptDefinitionImportDraft } from 'src/ts/server/scriptDefinitionBridge.svelte'

  export interface SelectedModuleImportFile {
    data: Uint8Array
  }

  export function latestModuleForImport(
    moduleId: string,
    currentModule: ImportTargetRisuModule | null | undefined,
  ): ImportTargetRisuModule | null {
    return (
      getModuleImportDatabase().modules?.find((module) => module.id === moduleId) ??
      (currentModule?.id === moduleId ? currentModule : null)
    )
  }

  function latestModuleLorebook(
    moduleId: string,
    currentModule: ImportTargetRisuModule | null | undefined,
  ): ModuleLoreBook[] {
    const module = latestModuleForImport(moduleId, currentModule)
    return Array.isArray(module?.lorebook) ? module.lorebook : []
  }

  function latestModuleRegex(
    moduleId: string,
    currentModule: ImportTargetRisuModule | null | undefined,
  ): ModuleCustomScript[] {
    const module = latestModuleForImport(moduleId, currentModule)
    return Array.isArray(module?.regex) ? module.regex : []
  }

  function latestModuleTriggers(
    moduleId: string,
    currentModule: ImportTargetRisuModule | null | undefined,
  ): ModuleTriggerScript[] {
    const module = latestModuleForImport(moduleId, currentModule)
    return Array.isArray(module?.trigger) ? module.trigger : []
  }

  export function parseImportedLorebookRows(files: readonly SelectedModuleImportFile[]): ModuleLoreBook[] {
    const importedRows: ModuleLoreBook[] = []

    for (const file of files) {
      const importedLore = JSON.parse(Buffer.from(file.data).toString('utf-8'))
      if (importedLore.type === 'risu' && Array.isArray(importedLore.data)) {
        importedRows.push(...(importedLore.data as ModuleLoreBook[]))
      } else if (importedLore.entries) {
        const entries: { [key: string]: ModuleCCLorebook } = importedLore.entries
        importedRows.push(...convertExternalModuleLorebook(entries))
      }
    }

    return importedRows
  }

  export function applyImportedModuleLorebookRows(
    moduleId: string | null | undefined,
    currentModule: ImportTargetRisuModule | null | undefined,
    importedRows: ModuleLoreBook[] | null | undefined,
  ): boolean {
    if (!moduleId || currentModule?.id !== moduleId || !importedRows || importedRows.length === 0) return false

    const latestLorebook = latestModuleLorebook(moduleId, currentModule)
    return replaceModuleLorebookImportDraft(moduleId, currentModule, [...latestLorebook, ...importedRows])
  }

  export function applyImportedModuleRegexRows(
    moduleId: string | null | undefined,
    currentModule: ImportTargetRisuModule | null | undefined,
    importedRows: ModuleCustomScript[] | null | undefined,
  ): boolean {
    if (!moduleId || currentModule?.id !== moduleId || !importedRows || importedRows.length === 0) return false

    const regex = [...latestModuleRegex(moduleId, currentModule), ...importedRows]
    const trigger = latestModuleTriggers(moduleId, currentModule)
    return applyModuleScriptDefinitionImportDraft(moduleId, currentModule, regex, trigger)
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import type { customscript, loreBook, triggerscript } from 'src/ts/storage/database.svelte'
  import LoreBookList from 'src/lib/SideBars/LoreBook/LoreBookList.svelte'
  import type { RisuModule } from 'src/ts/process/modules'
  import { DownloadIcon, FolderPlusIcon, HardDriveUploadIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import TriggerList from 'src/lib/SideBars/Scripts/TriggerList.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { getFileSrc, saveAsset, downloadFile } from 'src/ts/globalApi.svelte'
  import { alertNormal, alertError } from 'src/ts/alert'
  import { exportRegex, importRegexRows } from 'src/ts/process/scripts'
  import { selectMultipleFile } from 'src/ts/util'

  import { v4 } from 'uuid'
  import { untrack } from 'svelte'
  import {
    applyLorebookEntryDraftEdit,
    flushPendingLorebookEntryDraftEdit,
    replaceModuleLorebookCollectionDraft,
    watchServerBackedLorebooks,
  } from 'src/ts/server/lorebookBridge.svelte'
  import {
    applyModuleScriptDefinitionDraft,
    watchServerBackedScriptDefinitions,
  } from 'src/ts/server/scriptDefinitionBridge.svelte'
  import {
    appendFreshModuleAssets,
    beginModuleAssetUpload,
    captureModuleAssetUploadTarget,
    clearModuleAssetUpload,
    isFreshModuleAssetUpload,
    type ModuleAssetEntry,
    type ModuleAssetUploadOperation,
  } from 'src/ts/server/moduleAssetUpload'
  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import { assetListRenderKey } from 'src/ts/media/assetList'

  const MODULE_ASSET_EXTENSIONS = [
    'png',
    'webp',
    'mp4',
    'mp3',
    'gif',
    'jpeg',
    'jpg',
    'ttf',
    'otf',
    'css',
    'webm',
    'woff',
    'woff2',
    'svg',
    'avif',
  ]

  type SelectedModuleAssetFile = NonNullable<Awaited<ReturnType<typeof selectMultipleFile>>>[number]

  let submenu = $state(0)
  interface Props {
    currentModule: RisuModule
  }

  let { currentModule = $bindable() }: Props = $props()
  let assetFileExtensions: Record<string, string | undefined> = $state({})
  let assetFilePath: Record<string, string | undefined> = $state({})
  let assetPreviewRun = 0
  let moduleScriptDraftModuleId = $state<string | null>(null)
  let moduleScriptDraftSnapshot = ''
  let suppressModuleScriptDraftDispatch = false

  $effect(() => {
    // This panel only edits the open module's lorebook, so scope change detection
    // to it. Reading currentModule.id here re-runs the effect (restarting the
    // watcher with a fresh baseline) when the user opens a different module.
    const moduleId = currentModule?.id ?? ''
    const stopLorebooks = watchServerBackedLorebooks({ scope: { kind: 'module', moduleId } })
    return () => stopLorebooks()
  })

  $effect(() => {
    // This panel only edits the open module's regex/trigger definitions, so
    // scope change detection to that one module. Reading currentModule.id here
    // re-runs the effect (restarting the watcher with a fresh baseline) when the
    // user opens a different module.
    const moduleId = currentModule?.id ?? ''
    const stopScripts = watchServerBackedScriptDefinitions({ scope: { kind: 'module', moduleId } })
    return () => stopScripts()
  })

  function snapshotModuleScriptDraft(moduleId = currentModule?.id ?? null): string {
    return JSON.stringify({
      moduleId,
      scripts: currentModule?.regex ?? [],
      triggers: currentModule?.trigger ?? [],
    })
  }

  $effect(() => {
    const moduleId = currentModule?.id ?? null
    if (moduleId !== moduleScriptDraftModuleId) {
      suppressModuleScriptDraftDispatch = true
      moduleScriptDraftModuleId = moduleId
      moduleScriptDraftSnapshot = snapshotModuleScriptDraft(moduleId)
      queueMicrotask(() => {
        suppressModuleScriptDraftDispatch = false
      })
    }
  })

  $effect(() => {
    const moduleId = currentModule?.id ?? null
    const snapshot = snapshotModuleScriptDraft(moduleId)
    if (suppressModuleScriptDraftDispatch || !moduleId || moduleId !== moduleScriptDraftModuleId) return
    if (snapshot === moduleScriptDraftSnapshot) return

    untrack(() => {
      if (
        applyModuleScriptDefinitionDraft(
          moduleId,
          currentModule,
          currentModule?.regex ?? [],
          currentModule?.trigger ?? [],
        )
      ) {
        moduleScriptDraftSnapshot = snapshotModuleScriptDraft(moduleId)
      }
    })
  })

  const moduleAssetSourceKey = $derived(
    getResourceDatabase().useAdditionalAssetsPreview
      ? (currentModule?.assets ?? []).map((asset) => `${asset[1]}:${asset[2] ?? ''}`).join('\n')
      : '',
  )

  $effect(() => {
    moduleAssetSourceKey
    const run = ++assetPreviewRun
    const nextExtensions: Record<string, string | undefined> = {}
    assetFilePath = {}
    if (getResourceDatabase().useAdditionalAssetsPreview) {
      for (const asset of currentModule?.assets ?? []) {
        const assetPath = asset[1]
        nextExtensions[assetPath] = asset.length > 2 && asset[2] ? asset[2] : assetPath.split('.').pop()
        getFileSrc(assetPath).then((filePath) => {
          if (run !== assetPreviewRun) return
          assetFilePath[assetPath] = filePath
        })
      }
    }
    assetFileExtensions = nextExtensions
  })

  function updateModuleLorebookValue(index: number, value: loreBook): void {
    const moduleId = currentModule?.id
    if (!moduleId) return
    applyLorebookEntryDraftEdit({ kind: 'module', moduleId }, index, value)
  }

  function flushModuleLorebookValue(): void {
    const moduleId = currentModule?.id
    if (!moduleId) return
    flushPendingLorebookEntryDraftEdit({ kind: 'module', moduleId })
  }

  function updateModuleLorebookCollection(entries: loreBook[]): void {
    const moduleId = currentModule?.id
    if (!moduleId) return
    replaceModuleLorebookCollectionDraft(moduleId, currentModule, entries)
  }

  function updateModuleScriptDefinitions(
    regex: customscript[] = currentModule?.regex ?? [],
    trigger: triggerscript[] = currentModule?.trigger ?? [],
  ) {
    const moduleId = currentModule?.id
    if (!moduleId) return false
    const applied = applyModuleScriptDefinitionDraft(moduleId, currentModule, regex, trigger)
    if (applied) {
      moduleScriptDraftSnapshot = snapshotModuleScriptDraft(moduleId)
    }
    return applied
  }

  function moduleAssetExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? ''
  }

  function currentModuleAssetUploadTarget() {
    return captureModuleAssetUploadTarget({
      moduleId: currentModule?.id,
      assets: currentModule?.assets,
    })
  }

  function moduleAssetUploadFreshness() {
    return {
      currentModuleId: currentModule?.id,
      assets: currentModule?.assets,
    }
  }

  function isCurrentModuleAssetUpload(operation: ModuleAssetUploadOperation): boolean {
    return isFreshModuleAssetUpload(operation, moduleAssetUploadFreshness())
  }

  async function uploadModuleAssetEntries(
    files: readonly SelectedModuleAssetFile[],
    operation: ModuleAssetUploadOperation,
  ): Promise<ModuleAssetEntry[] | null> {
    const entries: ModuleAssetEntry[] = []

    for (const file of files) {
      if (!isCurrentModuleAssetUpload(operation)) return null

      const extension = moduleAssetExtension(file.name)
      const assetPath = await saveAsset(file.data, '', extension)
      if (!isCurrentModuleAssetUpload(operation)) return null

      entries.push([file.name, assetPath, extension])
    }

    return entries
  }

  async function uploadModuleAssets(): Promise<void> {
    const target = currentModuleAssetUploadTarget()
    if (!target) return

    let operation: ModuleAssetUploadOperation | null = null
    try {
      const files = await selectMultipleFile(MODULE_ASSET_EXTENSIONS, {
        onFilesSelected: () => {
          operation = beginModuleAssetUpload(target)
        },
      })
      if (!files || files.length === 0 || !operation) return

      const activeOperation = operation
      const entries = await uploadModuleAssetEntries(files, activeOperation)
      if (!entries || entries.length === 0) return

      const nextAssets = appendFreshModuleAssets({
        operation: activeOperation,
        freshness: moduleAssetUploadFreshness(),
        entries,
      })
      if (!nextAssets) return

      currentModule.assets = nextAssets
    } finally {
      if (operation) {
        clearModuleAssetUpload(operation)
      }
    }
  }

  function addLorebook() {
    if (Array.isArray(currentModule.lorebook)) {
      updateModuleLorebookCollection([
        ...currentModule.lorebook,
        {
          key: '',
          comment: `New Lore`,
          content: '',
          mode: 'normal',
          insertorder: 100,
          alwaysActive: false,
          secondkey: '',
          selective: false,
        },
      ])
    }
  }

  function addLorebookFolder() {
    if (Array.isArray(currentModule.lorebook)) {
      const id = v4()
      updateModuleLorebookCollection([
        ...currentModule.lorebook,
        {
          key: '\uf000folder:' + id,
          comment: `New Folder`,
          content: '',
          mode: 'folder',
          insertorder: 100,
          alwaysActive: false,
          secondkey: '',
          selective: false,
        },
      ])
    }
  }

  async function exportLoreBook() {
    try {
      const lore = currentModule.lorebook
      const stringl = Buffer.from(
        JSON.stringify({
          type: 'risu',
          ver: 1,
          data: lore,
        }),
        'utf-8',
      )

      await downloadFile(`lorebook_export.json`, stringl)

      alertNormal(language.successExport)
    } catch (error) {
      alertError(`${error}`)
    }
  }

  async function importLoreBook() {
    const moduleId = currentModule?.id
    if (!moduleId) return

    const lorebook = await selectMultipleFile(['json', 'lorebook'])
    if (currentModule?.id !== moduleId || !lorebook || lorebook.length === 0) return

    try {
      const importedRows = parseImportedLorebookRows(lorebook)
      if (currentModule?.id !== moduleId || importedRows.length === 0) return

      applyImportedModuleLorebookRows(moduleId, currentModule, importedRows)
    } catch (error) {
      alertError(`${error}`)
    }
  }

  async function importModuleRegex() {
    const moduleId = currentModule?.id
    if (!moduleId) return

    const importedRows = await importRegexRows()
    if (currentModule?.id !== moduleId || !importedRows || importedRows.length === 0) return

    const applied = applyImportedModuleRegexRows(moduleId, currentModule, importedRows)
    if (applied) {
      moduleScriptDraftSnapshot = snapshotModuleScriptDraft(moduleId)
    }
  }

  function addRegex() {
    if (Array.isArray(currentModule.regex)) {
      const regex = [
        ...currentModule.regex,
        {
          comment: '',
          in: '',
          out: '',
          type: 'editinput',
        },
      ]
      if (!updateModuleScriptDefinitions(regex, currentModule.trigger ?? [])) currentModule.regex = regex
    }
  }

  function addTrigger() {
    if (Array.isArray(currentModule.trigger)) {
      const trigger: triggerscript[] = [
        ...currentModule.trigger,
        {
          conditions: [],
          type: 'start',
          comment: '',
          effect: [],
        },
      ]
      if (!updateModuleScriptDefinitions(currentModule.regex ?? [], trigger)) currentModule.trigger = trigger
    }
  }
</script>

<div class="flex w-full rounded-md border border-darkborderc mb-4 overflow-x-auto h-16 min-h-16 overflow-y-clip">
  <button
    onclick={() => {
      submenu = 0
    }}
    class="p-2 flex-1 border-r border-darkborderc"
    class:bg-darkbutton={submenu === 0}>
    <span>{language.basicInfo}</span>
  </button>
  <button
    onclick={() => {
      currentModule.lorebook ??= []
      submenu = 1
    }}
    class="p-2 flex-1 border-r border-darkborderc"
    class:bg-darkbutton={submenu === 1}>
    <span>{language.loreBook}</span>
  </button>
  <button
    onclick={() => {
      if (!Array.isArray(currentModule.regex)) {
        const regex: customscript[] = []
        if (!updateModuleScriptDefinitions(regex, currentModule.trigger ?? []) || !Array.isArray(currentModule.regex)) {
          currentModule.regex = regex
        }
      }
      submenu = 2
    }}
    class="p-2 flex-1 border-r border-darkborderc"
    class:bg-darkbutton={submenu === 2}>
    <span>{language.regexScript}</span>
  </button>
  <button
    onclick={() => {
      if (!Array.isArray(currentModule.trigger)) {
        const trigger: triggerscript[] = [
          {
            comment: '',
            type: 'manual',
            conditions: [],
            effect: [
              {
                type: 'v2Header',
                code: '',
                indent: 0,
              },
            ],
          },
          {
            comment: 'New Event',
            type: 'manual',
            conditions: [],
            effect: [],
          },
        ]
        if (
          !updateModuleScriptDefinitions(currentModule.regex ?? [], trigger) ||
          !Array.isArray(currentModule.trigger)
        ) {
          currentModule.trigger = trigger
        }
      }
      submenu = 3
    }}
    class="p-2 flex-1 border-r border-darkborderc"
    class:bg-darkbutton={submenu === 3}>
    <span>{language.triggerScript}</span>
  </button>
  <button
    onclick={() => {
      currentModule.assets ??= []
      submenu = 5
    }}
    class="p-2 flex-1"
    class:bg-darkbutton={submenu === 5}>
    <span>{language.additionalAssets}</span>
  </button>
</div>

{#if submenu === 0}
  <span>{language.name}</span>
  <TextInput bind:value={currentModule.name} className="mt-1" />
  <span class="mt-4">{language.description}</span>
  <TextInput bind:value={currentModule.description} className="mt-1" size="sm" />
  <span class="mt-4">{language.namespace} <Help key="namespace" /></span>
  <TextInput bind:value={currentModule.namespace} className="mt-1" size="sm" />
  <div class="flex items-center mt-4">
    <Check bind:check={currentModule.hideIcon} name={language.hideChatIcon} />
  </div>
  <span class="mt-4">{language.customPromptTemplateToggle} <Help key="customPromptTemplateToggle" /></span>
  <TextAreaInput bind:value={currentModule.customModuleToggle} />
{/if}
{#if submenu === 1 && Array.isArray(currentModule.lorebook)}
  <LoreBookList
    externalLoreBooks={currentModule.lorebook}
    entryDraftScopeKey={`module:${currentModule.id}`}
    onCollectionChange={updateModuleLorebookCollection}
    onEntryChange={updateModuleLorebookValue}
    onEntrySettled={flushModuleLorebookValue} />
  <div class="text-textcolor2 mt-2 flex">
    <button
      onclick={() => {
        addLorebook()
      }}
      class="hover:text-textcolor cursor-pointer ml-1">
      <PlusIcon />
    </button>
    <button
      onclick={() => {
        exportLoreBook()
      }}
      class="hover:text-textcolor cursor-pointer ml-2">
      <DownloadIcon />
    </button>
    <button
      onclick={() => {
        addLorebookFolder()
      }}
      class="hover:text-textcolor ml-2 cursor-pointer">
      <FolderPlusIcon />
    </button>
    <button
      data-risu-module-action="import-lorebook"
      onclick={() => {
        importLoreBook()
      }}
      class="hover:text-textcolor cursor-pointer ml-2">
      <HardDriveUploadIcon />
    </button>
  </div>
{/if}

{#if submenu === 2 && Array.isArray(currentModule.regex)}
  <TextAreaInput
    bind:value={currentModule.backgroundEmbedding}
    className="mt-2"
    placeholder={language.backgroundHTML}
    size="sm" />
  <RegexList bind:value={currentModule.regex} />
  <div class="text-textcolor2 mt-2 flex gap-2">
    <button
      class="font-medium cursor-pointer hover:text-green-500"
      onclick={() => {
        addRegex()
      }}><PlusIcon /></button>
    <button
      class="font-medium cursor-pointer hover:text-green-500"
      onclick={() => {
        exportRegex(currentModule.regex)
      }}><DownloadIcon /></button>
    <button
      data-risu-module-action="import-regex"
      class="font-medium cursor-pointer hover:text-green-500"
      onclick={importModuleRegex}><HardDriveUploadIcon /></button>
  </div>
{/if}

{#if submenu === 5 && Array.isArray(currentModule.assets)}
  <div class="w-full max-w-full border border-selected rounded-md p-2">
    <table class="contain w-full max-w-full tabler mt-2">
      <tbody>
        <tr>
          <th class="font-medium">{language.value}</th>
          <th class="font-medium cursor-pointer w-10">
            <button class="hover:text-green-500" onclick={uploadModuleAssets}>
              <PlusIcon />
            </button>
          </th>
        </tr>
        {#if !currentModule.assets || currentModule.assets.length === 0}
          <tr>
            <td colspan="3">{language.noData}</td>
          </tr>
        {:else}
          {#each currentModule.assets as assets, i (assetListRenderKey(assets, i))}
            <tr>
              <td class="font-medium truncate">
                {#if assetFilePath[assets[1]] && getResourceDatabase().useAdditionalAssetsPreview}
                  {#if assetFileExtensions[assets[1]] === 'mp4'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video controls class="mt-2 px-2 w-full m-1 rounded-md"
                      ><source src={assetFilePath[assets[1]]} type="video/mp4" /></video>
                  {:else if assetFileExtensions[assets[1]] === 'mp3'}
                    <audio controls class="mt-2 px-2 w-full h-16 m-1 rounded-md" loop
                      ><source src={assetFilePath[assets[1]]} type="audio/mpeg" /></audio>
                  {:else}
                    <img src={assetFilePath[assets[1]]} class="w-16 h-16 m-1 rounded-md" alt={assets[0]} />
                  {/if}
                {/if}
                <TextInput fullwidth size="sm" marginBottom bind:value={currentModule.assets[i][0]} placeholder="..." />
              </td>

              <th class="font-medium cursor-pointer w-10">
                <button
                  class="hover:text-green-500"
                  onclick={() => {
                    let additionalAssets = currentModule.assets
                    additionalAssets.splice(i, 1)
                    currentModule.assets = additionalAssets
                  }}>
                  <TrashIcon />
                </button>
              </th>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
{/if}

{#if submenu === 3 && Array.isArray(currentModule.trigger)}
  <TriggerList bind:value={currentModule.trigger} lowLevelAble={currentModule.lowLevelAccess} />

  <div class="flex items-center mt-4">
    <Check bind:check={currentModule.lowLevelAccess} name={language.lowLevelAccess} />
    <span> <Help key="lowLevelAccess" name={language.lowLevelAccess} /></span>
  </div>
{/if}
