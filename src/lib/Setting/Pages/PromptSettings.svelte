<script lang="ts">
  import { ArrowLeft, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import PromptDataItem from 'src/lib/UI/PromptDataItem.svelte'
  import { tokenizePreset, type PromptItem } from 'src/ts/process/prompt'
  import { templateCheck } from 'src/ts/process/templates/templateCheck'

  import { DBState } from 'src/ts/stores.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { defaultAutoSuggestPrompt } from '../../../ts/storage/defaultPrompts'
  import AuxModelSelectors from './Model/AuxModelSelectors.svelte'
  import { normalizePromptTemplateIds } from 'src/ts/storage/database.svelte'
  import { watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'
  import {
    canUseServerCommands,
    createPromptItemCommand,
    deletePromptItemCommand,
    patchPromptSettingsCommand,
    reorderPromptItemsCommand,
    runServerCommand,
    updatePromptItemCommand,
    type PromptItemSnapshot,
    type SettingsPatch,
  } from 'src/ts/server/commands'

  const stopServerSettingsWatch = watchServerBackedSettings(['showUnrecommended'])
  onDestroy(stopServerSettingsWatch)

  let sorted = 0
  let warns: string[] = $state([])
  let tokens = $state(0)
  let extokens = $state(0)
  let draggedIndex = $state(-1)
  let dragOverIndex = $state(-1)
  let openedItemIndices = $state(new Set<number>())
  const pendingPromptItemUpdates = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingPromptSettingsPatch = {
    patch: {} as SettingsPatch,
    previous: {} as SettingsPatch,
    attempted: {} as SettingsPatch,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  const promptSettingsPreviousSnapshots = new Map<string, string>()
  const promptSettingsPreviousValues = new Map<string, unknown>()
  let promptSettingsWatcherInitialized = false
  let suppressPromptSettingsRollback = false
  executeTokenize(DBState.db.promptTemplate)
  interface Props {
    onGoBack?: () => void
    mode?: 'independent' | 'inline'
    subMenu?: number
  }

  let { onGoBack = () => {}, mode = 'independent', subMenu = $bindable(0) }: Props = $props()

  async function executeTokenize(prest: PromptItem[]) {
    tokens = await tokenizePreset(prest, true)
    extokens = await tokenizePreset(prest, false)
  }

  function promptItemId(item: PromptItem): string {
    normalizePromptTemplateIds(DBState.db)
    item.id ??= crypto.randomUUID()
    return item.id
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function currentPromptTemplateSnapshot(): PromptItem[] {
    return cloneJsonValue(DBState.db.promptTemplate ?? [])
  }

  function rollbackPromptTemplate(previous: PromptItem[], attempted: PromptItem[]): void {
    if (snapshotJson(DBState.db.promptTemplate ?? []) === snapshotJson(attempted)) {
      DBState.db.promptTemplate = cloneJsonValue(previous)
    }
  }

  function createPromptItem(): PromptItem {
    return {
      id: crypto.randomUUID(),
      type: 'plain',
      text: '',
      role: 'system',
      type2: 'normal',
    }
  }

  function dispatchCreatePromptItem(promptItem: PromptItem, previous: PromptItem[]): void {
    if (!canUseServerCommands()) return
    const attempted = currentPromptTemplateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        createPromptItemCommand({
          baseRevision,
          promptItem: cloneJsonValue(promptItem) as PromptItemSnapshot,
        }),
      rollback: () => rollbackPromptTemplate(previous, attempted),
    })
  }

  function dispatchDeletePromptItem(promptItem: PromptItem, previous: PromptItem[]): void {
    if (!canUseServerCommands()) return
    const itemId = promptItemId(promptItem)
    const attempted = currentPromptTemplateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        deletePromptItemCommand({
          baseRevision,
          itemId,
        }),
      rollback: () => rollbackPromptTemplate(previous, attempted),
    })
  }

  function dispatchReorderPromptItems(previous: PromptItem[]): void {
    if (!canUseServerCommands()) return
    normalizePromptTemplateIds(DBState.db)
    const attempted = currentPromptTemplateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        reorderPromptItemsCommand({
          baseRevision,
          itemIds: DBState.db.promptTemplate.map((item) => promptItemId(item)),
        }),
      rollback: () => rollbackPromptTemplate(previous, attempted),
    })
  }

  function queuePromptItemUpdate(promptItem: PromptItem, previousItem: PromptItem): void {
    if (!canUseServerCommands()) return
    const itemId = promptItemId(promptItem)
    if (pendingPromptItemUpdates.has(itemId)) {
      clearTimeout(pendingPromptItemUpdates.get(itemId))
    }
    const attemptedItem = cloneJsonValue(promptItem)
    pendingPromptItemUpdates.set(
      itemId,
      setTimeout(() => {
        pendingPromptItemUpdates.delete(itemId)
        void runServerCommand({
          command: (baseRevision) =>
            updatePromptItemCommand({
              baseRevision,
              itemId,
              patch: cloneJsonValue(attemptedItem) as PromptItemSnapshot,
            }),
          rollback: () => {
            const index = DBState.db.promptTemplate.findIndex((item) => item.id === itemId)
            if (index === -1) return
            if (snapshotJson(DBState.db.promptTemplate[index]) === snapshotJson(attemptedItem)) {
              DBState.db.promptTemplate[index] = cloneJsonValue(previousItem)
              DBState.db.promptTemplate = [...DBState.db.promptTemplate]
            }
          },
        })
      }, 250),
    )
  }

  function movePromptItem(originalIndex: number, nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= DBState.db.promptTemplate.length) return
    const previous = currentPromptTemplateSnapshot()
    const templates = [...DBState.db.promptTemplate]
    const temp = templates[originalIndex]
    templates[originalIndex] = templates[nextIndex]
    templates[nextIndex] = temp
    DBState.db.promptTemplate = templates
    dispatchReorderPromptItems(previous)
  }

  const promptSettingsKeys = [
    'promptSettings',
    'jsonSchemaEnabled',
    'jsonSchema',
    'strictJsonSchema',
    'extractJson',
    'customPromptTemplateToggle',
    'templateDefaultVariables',
    'OAIPrediction',
    'autoSuggestPrompt',
    'systemContentReplacement',
    'systemRoleReplacement',
    'outputImageModal',
    'fallbackModels',
    'fallbackWhenBlankResponse',
    'doNotChangeFallbackModels',
  ] as const

  function queuePromptSettingsPatch(patch: SettingsPatch, previous: SettingsPatch): void {
    if (!canUseServerCommands()) return
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in pendingPromptSettingsPatch.previous)) {
        pendingPromptSettingsPatch.previous[key] = previous[key]
      }
      pendingPromptSettingsPatch.patch[key] = value
      pendingPromptSettingsPatch.attempted[key] = value
    }

    if (pendingPromptSettingsPatch.timer) clearTimeout(pendingPromptSettingsPatch.timer)
    pendingPromptSettingsPatch.timer = setTimeout(() => {
      pendingPromptSettingsPatch.timer = null
      const commandPatch = pendingPromptSettingsPatch.patch
      const commandPrevious = pendingPromptSettingsPatch.previous
      const commandAttempted = pendingPromptSettingsPatch.attempted
      pendingPromptSettingsPatch.patch = {}
      pendingPromptSettingsPatch.previous = {}
      pendingPromptSettingsPatch.attempted = {}

      void runServerCommand({
        command: (baseRevision) =>
          patchPromptSettingsCommand({
            baseRevision,
            patch: commandPatch,
          }),
        rollback: () => {
          suppressPromptSettingsRollback = true
          try {
            const target = DBState.db as unknown as Record<string, unknown>
            for (const [key, previousValue] of Object.entries(commandPrevious)) {
              if (snapshotJson(target[key]) === snapshotJson(commandAttempted[key])) {
                target[key] = cloneJsonValue(previousValue)
              }
            }
          } finally {
            queueMicrotask(() => {
              suppressPromptSettingsRollback = false
            })
          }
        },
      })
    }, 250)
  }

  $effect.pre(() => {
    warns = templateCheck(DBState.db)
  })
  $effect.pre(() => {
    executeTokenize(DBState.db.promptTemplate)
  })
  $effect(() => {
    normalizePromptTemplateIds(DBState.db)
  })
  $effect(() => {
    if (!canUseServerCommands()) return
    const changed: SettingsPatch = {}
    const before: SettingsPatch = {}
    const target = DBState.db as unknown as Record<string, unknown>

    for (const key of promptSettingsKeys) {
      const value = target[key]
      const snapshot = snapshotJson(value)
      const previousSnapshot = promptSettingsPreviousSnapshots.get(key)

      if (promptSettingsWatcherInitialized && snapshot !== previousSnapshot) {
        changed[key] = cloneJsonValue(value)
        before[key] = cloneJsonValue(promptSettingsPreviousValues.get(key))
      }

      promptSettingsPreviousSnapshots.set(key, snapshot)
      promptSettingsPreviousValues.set(key, cloneJsonValue(value))
    }

    if (!promptSettingsWatcherInitialized) {
      promptSettingsWatcherInitialized = true
      return
    }
    if (suppressPromptSettingsRollback || Object.keys(changed).length === 0) return

    untrack(() => queuePromptSettingsPatch(changed, before))
  })

  function getDisplayTemplate() {
    return DBState.db.promptTemplate.map((item, i) => ({
      item,
      originalIndex: i,
      displayIndex: i,
    }))
  }

  function getReorderedTemplate() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return getDisplayTemplate()
    }

    const items = getDisplayTemplate()
    const [movedItem] = items.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    items.splice(adjustedDropIndex, 0, movedItem)

    return items.map((item, displayIndex) => ({
      ...item,
      displayIndex,
    }))
  }

  function handlePromptDrop() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return
    }

    const templates = [...DBState.db.promptTemplate]
    const previous = currentPromptTemplateSnapshot()
    const [movedItem] = templates.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    templates.splice(adjustedDropIndex, 0, movedItem)

    const newOpenedIndices = new Set<number>()
    openedItemIndices.forEach((index) => {
      if (index === draggedIndex) {
        newOpenedIndices.add(adjustedDropIndex)
      } else if (draggedIndex < adjustedDropIndex) {
        if (index > draggedIndex && index <= adjustedDropIndex) {
          newOpenedIndices.add(index - 1)
        } else {
          newOpenedIndices.add(index)
        }
      } else {
        if (index >= adjustedDropIndex && index < draggedIndex) {
          newOpenedIndices.add(index + 1)
        } else {
          newOpenedIndices.add(index)
        }
      }
    })
    openedItemIndices = newOpenedIndices

    DBState.db.promptTemplate = templates
    dispatchReorderPromptItems(previous)
    draggedIndex = -1
    dragOverIndex = -1
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.altKey && e.key === 'o') {
      if (openedItemIndices.size === DBState.db.promptTemplate.length) {
        openedItemIndices = new Set<number>()
      } else {
        openedItemIndices = new Set(DBState.db.promptTemplate.map((_, i) => i))
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown)
    for (const timer of pendingPromptItemUpdates.values()) {
      clearTimeout(timer)
    }
    if (pendingPromptSettingsPatch.timer) {
      clearTimeout(pendingPromptSettingsPatch.timer)
    }
  })
</script>

{#if mode === 'independent'}
  <h2 class="mb-2 text-2xl font-bold mt-2 items-center flex">
    <button class="mr-2 text-textcolor2 hover:text-textcolor" onclick={onGoBack}>
      <ArrowLeft />
    </button>
    {language.promptTemplate}
  </h2>

  <div class="flex w-full rounded-md border border-selected">
    <button
      onclick={() => {
        subMenu = 0
      }}
      class="p-2 flex-1"
      class:bg-selected={subMenu === 0}
    >
      <span>{language.template}</span>
    </button>
    <button
      onclick={() => {
        subMenu = 1
      }}
      class="p-2 flex-1"
      class:bg-selected={subMenu === 1}
    >
      <span>{language.settings}</span>
    </button>
  </div>
{/if}
{#if warns.length > 0 && subMenu === 0}
  <div class="text-red-500 flex flex-col items-start p-2 rounded-md border-red-500 border mt-4">
    <h2 class="text-xl font-bold">Warning</h2>
    <div class="border-b border-b-red-500 mt-1 mb-2 w-full"></div>
    {#each warns as warn}
      <span class="ml-4">{warn}</span>
    {/each}
  </div>
{/if}

{#if subMenu === 0}
  <div class="contain w-full max-w-full mt-4 flex flex-col p-3 rounded-md">
    {#if DBState.db.promptTemplate.length === 0}
      <div class="text-textcolor2">No Format</div>
    {/if}
    {#key sorted}
      {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex }}
        <PromptDataItem
          bind:promptItem={DBState.db.promptTemplate[originalIndex]}
          isDragging={draggedIndex === originalIndex}
          isOpened={openedItemIndices.has(originalIndex)}
          bind:draggedIndex
          bind:dragOverIndex
          bind:openedItemIndices
          currentIndex={originalIndex}
          {displayIndex}
          onUpdate={queuePromptItemUpdate}
          onDrop={handlePromptDrop}
          onRemove={() => {
            const previous = currentPromptTemplateSnapshot()
            const removed = DBState.db.promptTemplate[originalIndex]
            let templates = [...DBState.db.promptTemplate]
            templates.splice(originalIndex, 1)
            DBState.db.promptTemplate = templates

            const newOpenedIndices = new Set<number>()
            openedItemIndices.forEach((index) => {
              if (index === originalIndex) {
                return
              } else if (index > originalIndex) {
                newOpenedIndices.add(index - 1)
              } else {
                newOpenedIndices.add(index)
              }
            })
            openedItemIndices = newOpenedIndices

            draggedIndex = -1
            dragOverIndex = -1
            dispatchDeletePromptItem(removed, previous)
          }}
          moveDown={() => {
            if (originalIndex === DBState.db.promptTemplate.length - 1) {
              return
            }
            movePromptItem(originalIndex, originalIndex + 1)

            const newOpenedIndices = new Set<number>()
            openedItemIndices.forEach((index) => {
              if (index === originalIndex) {
                newOpenedIndices.add(originalIndex + 1)
              } else if (index === originalIndex + 1) {
                newOpenedIndices.add(originalIndex)
              } else {
                newOpenedIndices.add(index)
              }
            })
            openedItemIndices = newOpenedIndices
          }}
          moveUp={() => {
            if (originalIndex === 0) {
              return
            }
            movePromptItem(originalIndex, originalIndex - 1)

            const newOpenedIndices = new Set<number>()
            openedItemIndices.forEach((index) => {
              if (index === originalIndex) {
                newOpenedIndices.add(originalIndex - 1)
              } else if (index === originalIndex - 1) {
                newOpenedIndices.add(originalIndex)
              } else {
                newOpenedIndices.add(index)
              }
            })
            openedItemIndices = newOpenedIndices
          }}
        />
      {/each}
    {/key}
  </div>

  <button
    class="font-medium cursor-pointer hover:text-green-500"
    onclick={() => {
      const previous = currentPromptTemplateSnapshot()
      const promptItem = createPromptItem()
      DBState.db.promptTemplate = [...(DBState.db.promptTemplate ?? []), promptItem]
      dispatchCreatePromptItem(promptItem, previous)
    }}><PlusIcon /></button
  >

  <span class="text-textcolor2 text-sm mt-2">{tokens} {language.fixedTokens}</span>
  <span class="text-textcolor2 mb-6 text-sm mt-2">{extokens} {language.exactTokens}</span>
{:else}
  <span class="text-textcolor mt-4">{language.postEndInnerFormat}</span>
  <TextInput bind:value={DBState.db.promptSettings.postEndInnerFormat} />

  <Check
    bind:check={DBState.db.promptSettings.sendChatAsSystem}
    name={language.sendChatAsSystem}
    className="mt-4"
  />
  <Check
    bind:check={DBState.db.promptSettings.sendName}
    name={language.formatGroupInSingle}
    className="mt-4"
  />
  <Check
    bind:check={DBState.db.promptSettings.trimStartNewChat}
    name={language.trimStartNewChat}
    className="mt-4"
  />
  <Check
    bind:check={DBState.db.promptSettings.utilOverride}
    name={language.utilOverride}
    className="mt-4"
  />
  <Check
    bind:check={DBState.db.jsonSchemaEnabled}
    name={language.enableJsonSchema}
    className="mt-4"
  />
  <Check
    bind:check={DBState.db.outputImageModal}
    name={language.outputImageModal}
    className="mt-4"
  />

  <Check
    bind:check={DBState.db.strictJsonSchema}
    name={language.strictJsonSchema}
    className="mt-4"
  />

  {#if DBState.db.showUnrecommended}
    <Check
      bind:check={DBState.db.promptSettings.customChainOfThought}
      name={language.customChainOfThought}
      className="mt-4"
    >
      <Help unrecommended key="customChainOfThought" />
    </Check>
  {/if}
  <span class="text-textcolor mt-4">{language.maxThoughtTagDepth}</span>
  <NumberInput bind:value={DBState.db.promptSettings.maxThoughtTagDepth} />
  <span class="text-textcolor mt-4"
    >{language.customPromptTemplateToggle} <Help key="customPromptTemplateToggle" /></span
  >
  <TextAreaInput bind:value={DBState.db.customPromptTemplateToggle} />
  <span class="text-textcolor mt-4"
    >{language.defaultVariables} <Help key="defaultVariables" /></span
  >
  <TextAreaInput bind:value={DBState.db.templateDefaultVariables} />
  <span class="text-textcolor mt-4">{language.predictedOutput}</span>
  <TextAreaInput bind:value={DBState.db.OAIPrediction} />
  <span class="text-textcolor mt-4">{language.autoSuggest} <Help key="autoSuggest" /></span>
  <TextAreaInput bind:value={DBState.db.autoSuggestPrompt} placeholder={defaultAutoSuggestPrompt} />
  <span class="text-textcolor mt-4"
    >{language.systemContentReplacement} <Help key="systemContentReplacement" /></span
  >
  <TextAreaInput bind:value={DBState.db.systemContentReplacement} />
  <span class="text-textcolor mt-4"
    >{language.systemRoleReplacement} <Help key="systemRoleReplacement" /></span
  >
  <SelectInput bind:value={DBState.db.systemRoleReplacement}>
    <OptionInput value="user">User</OptionInput>
    <OptionInput value="assistant">assistant</OptionInput>
  </SelectInput>
  {#if DBState.db.jsonSchemaEnabled}
    <span class="text-textcolor mt-4">{language.jsonSchema} <Help key="jsonSchema" /></span>
    <TextAreaInput bind:value={DBState.db.jsonSchema} />
    <span class="text-textcolor mt-4">{language.extractJson} <Help key="extractJson" /></span>
    <TextInput bind:value={DBState.db.extractJson} />
  {/if}

  {#if !DBState.db.auxModelUnderModelSettings}
    <AuxModelSelectors />
  {/if}

  {#snippet fallbackModelList(arg: 'model' | 'memory' | 'translate' | 'emotion' | 'otherAx')}
    {#each DBState.db.fallbackModels[arg] as model, i}
      <span class="text-textcolor mt-4">
        {language.model}
        {i + 1}
      </span>
      <ModelList bind:value={DBState.db.fallbackModels[arg][i]} blankable />
    {/each}
    <div class="flex gap-2">
      <button
        class="bg-selected text-textcolor p-2 rounded-md"
        onclick={() => {
          let value = DBState.db.fallbackModels[arg] ?? []
          value.push('')
          DBState.db.fallbackModels[arg] = value
        }}><PlusIcon /></button
      >
      <button
        class="bg-red-500 text-white p-2 rounded-md"
        onclick={() => {
          let value = DBState.db.fallbackModels[arg] ?? []
          value.pop()
          DBState.db.fallbackModels[arg] = value
        }}><TrashIcon /></button
      >
    </div>
  {/snippet}

  <Accordion name={language.fallbackModel} styled>
    <Check
      bind:check={DBState.db.fallbackWhenBlankResponse}
      name={language.fallbackWhenBlankResponse}
      className="mt-4"
    />
    <Check
      bind:check={DBState.db.doNotChangeFallbackModels}
      name={language.doNotChangeFallbackModels}
      className="mt-4"
    />

    <Accordion name={language.model} styled>
      {@render fallbackModelList('model')}
    </Accordion>
    <Accordion name={'Memory'} styled>
      {@render fallbackModelList('memory')}
    </Accordion>
    <Accordion name={'Translations'} styled>
      {@render fallbackModelList('translate')}
    </Accordion>
    <Accordion name={'Emotion'} styled>
      {@render fallbackModelList('emotion')}
    </Accordion>
    <Accordion name={'OtherAx'} styled>
      {@render fallbackModelList('otherAx')}
    </Accordion>
  </Accordion>
{/if}
