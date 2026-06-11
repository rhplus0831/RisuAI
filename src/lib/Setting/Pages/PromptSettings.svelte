<script lang="ts">
  import { ArrowLeft, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import PromptDataItem from 'src/lib/UI/PromptDataItem.svelte'
  import {
    createPromptTokenizeDebouncer,
    promptTemplateTokenizeSignature,
    type PromptItem,
  } from 'src/ts/process/prompt'
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
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import {
    flushPendingPromptTemplatePatches,
    queuePromptItemProjectionUpdate,
    queuePromptSettingsProjectionPatch,
    reconcilePromptTemplateDraft,
    type PromptTemplateDraftBinding,
  } from 'src/ts/server/promptTemplateBridge.svelte'
  import {
    canUseServerCommands,
    createPromptItemCommand,
    deletePromptItemCommand,
    peekCachedServerCommandRevision,
    reorderPromptItemsCommand,
    runServerCommand,
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
  type FallbackModelKey = 'model' | 'memory' | 'translate' | 'emotion' | 'otherAx'
  type FallbackModelsDraft = Record<FallbackModelKey, string[]>
  const promptTokenizeDebouncer = createPromptTokenizeDebouncer({
    debounceMs: 300,
    onResult: (totals) => {
      tokens = totals.tokens
      extokens = totals.extokens
    },
  })
  const promptTemplateDraft = $state<{ value: PromptItem[] }>({
    value: cloneJsonValue(DBState.db.promptTemplate ?? []),
  })
  const promptTemplateDraftBinding: PromptTemplateDraftBinding = {
    getItems: () => promptTemplateDraft.value,
    setItems: (items) => {
      promptTemplateDraft.value = items
    },
  }
  let previousPromptTemplateRevision = peekCachedServerCommandRevision()
  const promptSettingsDraft = createPromptSettingsDraft<Record<string, any>>('promptSettings', {})
  const jsonSchemaEnabledDraft = createPromptSettingsDraft<boolean>('jsonSchemaEnabled', false)
  const outputImageModalDraft = createPromptSettingsDraft<boolean>('outputImageModal', false)
  const strictJsonSchemaDraft = createPromptSettingsDraft<boolean>('strictJsonSchema', false)
  const customPromptTemplateToggleDraft = createPromptSettingsDraft<string>(
    'customPromptTemplateToggle',
    '',
  )
  const templateDefaultVariablesDraft = createPromptSettingsDraft<string>(
    'templateDefaultVariables',
    '',
  )
  const OAIPredictionDraft = createPromptSettingsDraft<string>('OAIPrediction', '')
  const autoSuggestPromptDraft = createPromptSettingsDraft<string>('autoSuggestPrompt', '')
  const systemContentReplacementDraft = createPromptSettingsDraft<string>(
    'systemContentReplacement',
    '',
  )
  const systemRoleReplacementDraft = createPromptSettingsDraft<string>(
    'systemRoleReplacement',
    'user',
  )
  const jsonSchemaDraft = createPromptSettingsDraft<string>('jsonSchema', '')
  const extractJsonDraft = createPromptSettingsDraft<string>('extractJson', '')
  const fallbackModelsDraft = createPromptSettingsDraft<FallbackModelsDraft>('fallbackModels', {
    model: [],
    memory: [],
    translate: [],
    emotion: [],
    otherAx: [],
  })
  const fallbackWhenBlankResponseDraft = createPromptSettingsDraft<boolean>(
    'fallbackWhenBlankResponse',
    false,
  )
  const doNotChangeFallbackModelsDraft = createPromptSettingsDraft<boolean>(
    'doNotChangeFallbackModels',
    false,
  )
  interface Props {
    onGoBack?: () => void
    mode?: 'independent' | 'inline'
    subMenu?: number
  }

  let { onGoBack = () => {}, mode = 'independent', subMenu = $bindable(0) }: Props = $props()

  function promptItemId(item: PromptItem): string {
    withTrustedServerProjectionWrite(() => {
      normalizePromptTemplateIds(DBState.db)
    })
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
    return cloneJsonValue(promptTemplateDraft.value ?? [])
  }

  function rollbackPromptTemplate(previous: PromptItem[], attempted: PromptItem[]): void {
    if (snapshotJson(promptTemplateDraft.value ?? []) === snapshotJson(attempted)) {
      promptTemplateDraft.value = cloneJsonValue(previous)
      withTrustedServerProjectionWrite(() => {
        DBState.db.promptTemplate = cloneJsonValue(previous)
      })
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
    withTrustedServerProjectionWrite(() => {
      normalizePromptTemplateIds(DBState.db)
    })
    const attempted = currentPromptTemplateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        reorderPromptItemsCommand({
          baseRevision,
          itemIds: promptTemplateDraft.value.map((item) => promptItemId(item)),
        }),
      rollback: () => rollbackPromptTemplate(previous, attempted),
    })
  }

  function queuePromptItemUpdate(promptItem: PromptItem, previousItem: PromptItem): void {
    const itemId = promptItemId(promptItem)
    queuePromptItemProjectionUpdate(promptTemplateDraftBinding, itemId, previousItem)
  }

  function movePromptItem(originalIndex: number, nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= promptTemplateDraft.value.length) return
    const previous = currentPromptTemplateSnapshot()
    const templates = [...promptTemplateDraft.value]
    const temp = templates[originalIndex]
    templates[originalIndex] = templates[nextIndex]
    templates[nextIndex] = temp
    promptTemplateDraft.value = templates
    withTrustedServerProjectionWrite(() => {
      DBState.db.promptTemplate = cloneJsonValue(templates)
    })
    dispatchReorderPromptItems(previous)
  }

  function applyPromptTemplateDraft(templates: PromptItem[]): void {
    promptTemplateDraft.value = cloneJsonValue(templates)
    withTrustedServerProjectionWrite(() => {
      DBState.db.promptTemplate = cloneJsonValue(templates)
    })
  }

  function queuePromptSettingsPatch(patch: SettingsPatch, previous: SettingsPatch): void {
    queuePromptSettingsProjectionPatch(patch, previous)
  }

  function createPromptSettingsDraft<T>(key: string, fallback: T): { value: T } {
    const initialValue = currentPromptSettingValue(key, fallback)
    const draft = $state<{ value: T }>({ value: cloneJsonValue(initialValue) })
    let initialized = false
    let suppressDraftDispatch = false
    let previousServerSnapshot = snapshotJson(initialValue)

    $effect(() => {
      const serverValue = currentPromptSettingValue(key, fallback)
      const serverSnapshot = snapshotJson(serverValue)
      const draftSnapshot = snapshotJson(draft.value)

      if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        draft.value = cloneJsonValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }

      previousServerSnapshot = serverSnapshot
    })

    $effect(() => {
      const snapshot = snapshotJson(draft.value)
      if (!initialized) {
        initialized = true
        return
      }
      if (suppressDraftDispatch) return

      untrack(() => {
        const attempted = cloneJsonValue(draft.value)
        const previous = cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[key])
        withTrustedServerProjectionWrite(() => {
          // Re-read inside the trusted write to get the mutable projection.
          const target = DBState.db as unknown as Record<string, unknown>
          target[key] = attempted
        })
        queuePromptSettingsPatch({ [key]: attempted }, { [key]: previous })
        previousServerSnapshot = snapshot
      })
    })

    return draft
  }

  function currentPromptSettingValue<T>(key: string, fallback: T): T {
    const target = DBState.db as unknown as Record<string, unknown> | undefined
    const value = target?.[key]
    return value === undefined ? fallback : (value as T)
  }

  $effect.pre(() => {
    warns = templateCheck(DBState.db)
  })
  $effect.pre(() => {
    promptTemplateTokenizeSignature(promptTemplateDraft.value)
    untrack(() => {
      promptTokenizeDebouncer.schedule(promptTemplateDraft.value)
    })
  })
  $effect(() => {
    // Reconcile the draft from the projection only when the cached server command
    // revision advances (a real server push / command response), not on every
    // keystroke. `reconcilePromptTemplateDraft` reads `DBState.db.promptTemplate`
    // so this effect still re-runs on a projection change; the whole-template
    // stringify now happens only on a revision advance, never per keystroke.
    const { revision, nextDraft } = reconcilePromptTemplateDraft(
      promptTemplateDraft.value,
      previousPromptTemplateRevision,
    )
    previousPromptTemplateRevision = revision
    if (nextDraft) {
      promptTemplateDraft.value = nextDraft
    }
  })
  $effect(() => {
    withTrustedServerProjectionWrite(() => {
      normalizePromptTemplateIds(DBState.db)
    })
  })

  function getDisplayTemplate() {
    return promptTemplateDraft.value.map((item, i) => ({
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

    const templates = [...promptTemplateDraft.value]
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

    applyPromptTemplateDraft(templates)
    dispatchReorderPromptItems(previous)
    draggedIndex = -1
    dragOverIndex = -1
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.altKey && e.key === 'o') {
      if (openedItemIndices.size === promptTemplateDraft.value.length) {
        openedItemIndices = new Set<number>()
      } else {
        openedItemIndices = new Set(promptTemplateDraft.value.map((_, i) => i))
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown)
    flushPendingPromptTemplatePatches()
    promptTokenizeDebouncer.cancel()
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
    {#if promptTemplateDraft.value.length === 0}
      <div class="text-textcolor2">No Format</div>
    {/if}
    {#key sorted}
      {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex }}
        <PromptDataItem
          bind:promptItem={promptTemplateDraft.value[originalIndex]}
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
            const removed = promptTemplateDraft.value[originalIndex]
            let templates = [...promptTemplateDraft.value]
            templates.splice(originalIndex, 1)
            applyPromptTemplateDraft(templates)

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
            if (originalIndex === promptTemplateDraft.value.length - 1) {
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
      applyPromptTemplateDraft([...(promptTemplateDraft.value ?? []), promptItem])
      dispatchCreatePromptItem(promptItem, previous)
    }}><PlusIcon /></button
  >

  <span class="text-textcolor2 text-sm mt-2">{tokens} {language.fixedTokens}</span>
  <span class="text-textcolor2 mb-6 text-sm mt-2">{extokens} {language.exactTokens}</span>
{:else}
  <span class="text-textcolor mt-4">{language.postEndInnerFormat}</span>
  <TextInput bind:value={promptSettingsDraft.value.postEndInnerFormat} />

  <Check
    bind:check={promptSettingsDraft.value.sendChatAsSystem}
    name={language.sendChatAsSystem}
    className="mt-4"
  />
  <Check
    bind:check={promptSettingsDraft.value.sendName}
    name={language.formatGroupInSingle}
    className="mt-4"
  />
  <Check
    bind:check={promptSettingsDraft.value.trimStartNewChat}
    name={language.trimStartNewChat}
    className="mt-4"
  />
  <Check
    bind:check={promptSettingsDraft.value.utilOverride}
    name={language.utilOverride}
    className="mt-4"
  />
  <Check
    bind:check={jsonSchemaEnabledDraft.value}
    name={language.enableJsonSchema}
    className="mt-4"
  />
  <Check
    bind:check={outputImageModalDraft.value}
    name={language.outputImageModal}
    className="mt-4"
  />

  <Check
    bind:check={strictJsonSchemaDraft.value}
    name={language.strictJsonSchema}
    className="mt-4"
  />

  {#if DBState.db.showUnrecommended}
    <Check
      bind:check={promptSettingsDraft.value.customChainOfThought}
      name={language.customChainOfThought}
      className="mt-4"
    >
      <Help unrecommended key="customChainOfThought" />
    </Check>
  {/if}
  <span class="text-textcolor mt-4">{language.maxThoughtTagDepth}</span>
  <NumberInput bind:value={promptSettingsDraft.value.maxThoughtTagDepth} />
  <span class="text-textcolor mt-4"
    >{language.customPromptTemplateToggle} <Help key="customPromptTemplateToggle" /></span
  >
  <TextAreaInput bind:value={customPromptTemplateToggleDraft.value} />
  <span class="text-textcolor mt-4"
    >{language.defaultVariables} <Help key="defaultVariables" /></span
  >
  <TextAreaInput bind:value={templateDefaultVariablesDraft.value} />
  <span class="text-textcolor mt-4">{language.predictedOutput}</span>
  <TextAreaInput bind:value={OAIPredictionDraft.value} />
  <span class="text-textcolor mt-4">{language.autoSuggest} <Help key="autoSuggest" /></span>
  <TextAreaInput bind:value={autoSuggestPromptDraft.value} placeholder={defaultAutoSuggestPrompt} />
  <span class="text-textcolor mt-4"
    >{language.systemContentReplacement} <Help key="systemContentReplacement" /></span
  >
  <TextAreaInput bind:value={systemContentReplacementDraft.value} />
  <span class="text-textcolor mt-4"
    >{language.systemRoleReplacement} <Help key="systemRoleReplacement" /></span
  >
  <SelectInput bind:value={systemRoleReplacementDraft.value}>
    <OptionInput value="user">User</OptionInput>
    <OptionInput value="assistant">assistant</OptionInput>
  </SelectInput>
  {#if jsonSchemaEnabledDraft.value}
    <span class="text-textcolor mt-4">{language.jsonSchema} <Help key="jsonSchema" /></span>
    <TextAreaInput bind:value={jsonSchemaDraft.value} />
    <span class="text-textcolor mt-4">{language.extractJson} <Help key="extractJson" /></span>
    <TextInput bind:value={extractJsonDraft.value} />
  {/if}

  {#if !DBState.db.auxModelUnderModelSettings}
    <AuxModelSelectors />
  {/if}

  {#snippet fallbackModelList(arg: FallbackModelKey)}
    {#each fallbackModelsDraft.value[arg] as model, i}
      <span class="text-textcolor mt-4">
        {language.model}
        {i + 1}
      </span>
      <ModelList bind:value={fallbackModelsDraft.value[arg][i]} blankable />
    {/each}
    <div class="flex gap-2">
      <button
        class="bg-selected text-textcolor p-2 rounded-md"
        onclick={() => {
          const value = fallbackModelsDraft.value[arg] ?? []
          fallbackModelsDraft.value[arg] = [...value, '']
        }}><PlusIcon /></button
      >
      <button
        class="bg-red-500 text-white p-2 rounded-md"
        onclick={() => {
          const value = fallbackModelsDraft.value[arg] ?? []
          fallbackModelsDraft.value[arg] = value.slice(0, -1)
        }}><TrashIcon /></button
      >
    </div>
  {/snippet}

  <Accordion name={language.fallbackModel} styled>
    <Check
      bind:check={fallbackWhenBlankResponseDraft.value}
      name={language.fallbackWhenBlankResponse}
      className="mt-4"
    />
    <Check
      bind:check={doNotChangeFallbackModelsDraft.value}
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
