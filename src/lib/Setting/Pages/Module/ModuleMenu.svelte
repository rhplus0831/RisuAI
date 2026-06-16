<script lang="ts">
  import { language } from 'src/lang'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import type { customscript, loreBook, triggerscript } from 'src/ts/storage/database.svelte'
  import LoreBookList from 'src/lib/SideBars/LoreBook/LoreBookList.svelte'
  import { type CCLorebook, convertExternalLorebook } from 'src/ts/process/lorebook.svelte'
  import type { RisuModule } from 'src/ts/process/modules'
  import { DownloadIcon, FolderPlusIcon, HardDriveUploadIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import TriggerList from 'src/lib/SideBars/Scripts/TriggerList.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { getFileSrc, saveAsset, downloadFile } from 'src/ts/globalApi.svelte'
  import { alertNormal, alertError } from 'src/ts/alert'
  import { exportRegex, importRegex } from 'src/ts/process/scripts'
  import { selectMultipleFile } from 'src/ts/util'

  import { DBState } from 'src/ts/stores.svelte'
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
    DBState.db.useAdditionalAssetsPreview
      ? (currentModule?.assets ?? []).map((asset) => `${asset[1]}:${asset[2] ?? ''}`).join('\n')
      : '',
  )

  $effect(() => {
    moduleAssetSourceKey
    const run = ++assetPreviewRun
    const nextExtensions: Record<string, string | undefined> = {}
    assetFilePath = {}
    if (DBState.db.useAdditionalAssetsPreview) {
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
    let lore = [...(currentModule.lorebook ?? [])]
    const lorebook = await selectMultipleFile(['json', 'lorebook'])
    if (!lorebook) {
      return
    }
    try {
      for (const f of lorebook) {
        const importedlore = JSON.parse(Buffer.from(f.data).toString('utf-8'))
        if (importedlore.type === 'risu' && importedlore.data) {
          const datas: loreBook[] = importedlore.data
          for (const data of datas) {
            lore.push(data)
          }
        } else if (importedlore.entries) {
          const entries: { [key: string]: CCLorebook } = importedlore.entries
          lore.push(...convertExternalLorebook(entries))
        }
      }
      updateModuleLorebookCollection(lore)
    } catch (error) {
      alertError(`${error}`)
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
    class="p2 flex-1 border-r border-darkborderc"
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
      class="font-medium cursor-pointer hover:text-green-500"
      onclick={async () => {
        const regex = await importRegex(currentModule.regex)
        if (!updateModuleScriptDefinitions(regex, currentModule.trigger ?? [])) currentModule.regex = regex
      }}><HardDriveUploadIcon /></button>
  </div>
{/if}

{#if submenu === 5 && Array.isArray(currentModule.assets)}
  <div class="w-full max-w-full border border-selected rounded-md p-2">
    <table class="contain w-full max-w-full tabler mt-2">
      <tbody>
        <tr>
          <th class="font-medium">{language.value}</th>
          <th class="font-medium cursor-pointer w-10">
            <button
              class="hover:text-green-500"
              onclick={async () => {
                const da = await selectMultipleFile([
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
                ])
                currentModule.assets = currentModule.assets ?? []
                if (!da) {
                  return
                }
                for (const f of da) {
                  const img = f.data
                  const name = f.name
                  const extension = name.split('.').pop().toLowerCase()
                  const imgp = await saveAsset(img, '', extension)
                  currentModule.assets.push([name, imgp, extension])
                  currentModule.assets = currentModule.assets
                }
              }}>
              <PlusIcon />
            </button>
          </th>
        </tr>
        {#if !currentModule.assets || currentModule.assets.length === 0}
          <tr>
            <td colspan="3">{language.noData}</td>
          </tr>
        {:else}
          {#each currentModule.assets as assets, i (assets[1])}
            <tr>
              <td class="font-medium truncate">
                {#if assetFilePath[assets[1]] && DBState.db.useAdditionalAssetsPreview}
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
