<script lang="ts">
  import 'src/ts/stores.svelte'
  import { ArrowLeft, PlusIcon, RefreshCcwIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import PromptDataItem from 'src/lib/UI/PromptDataItem.svelte'
  import {
    createPromptTokenizeDebouncer,
    promptTemplateTokenizeSignature,
    type PromptItem,
  } from 'src/ts/process/prompt'
  import { templateCheck } from 'src/ts/process/templates/templateCheck'

  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
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
  import { normalizePromptTemplateIds, promptTemplateIdsNeedNormalization } from 'src/ts/storage/database.svelte'
  import { watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'
  import { getServerResourceApplyEpoch, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import {
    dropPendingPromptSettingsProjectionPatchKeys,
    capturePromptItemOptimisticAcknowledgement,
    capturePromptTemplateOwnerMutationFence,
    flushPendingPromptTemplatePatches,
    queuePromptItemProjectionUpdate,
    queuePromptSettingsProjectionPatch,
    reconcilePromptTemplateDraft,
    resetPromptTemplateSelectionDirtyState,
    promptTemplateOwnerCommandId,
    replacePendingPromptSettingsProjectionPatchValue,
    rollbackFailedPromptTemplateItemCreate,
    rollbackFailedPromptTemplateItemDelete,
    rollbackFailedPromptTemplateItemReorder,
    runPromptTemplateOwnerCommand,
    type PromptTemplateDraftBinding,
    type PromptTemplateOwnerMutationFence,
  } from 'src/ts/server/promptTemplateBridge.svelte'
  import { mergeProjectionIntoDirtyDraft } from 'src/ts/server/staleStateGuards'
  import {
    currentPromptTemplateOwnerId,
    ensurePromptTemplateHydrated,
    isPromptTemplateHydrated,
    markPromptTemplateOwnerAcknowledgementTainted,
    promptTemplateHydratedStore,
  } from 'src/ts/server/promptTemplateHydration'
  import {
    canUseServerCommands,
    createPromptItemCommand,
    deletePromptItemCommand,
    peekCachedServerCommandRevision,
    reorderPromptItemsCommand,
    runServerCommand,
    updatePromptPresetCommand,
    type PromptItemSnapshot,
    type PromptPresetSnapshot,
    type SettingsPatch,
  } from 'src/ts/server/commands'
  import { mirrorTopLevelPresetField } from 'src/ts/presetFieldMirror'
  import {
    currentPromptPresetModelOverrideValue,
    mirrorPromptPresetModelOverrideField,
  } from 'src/ts/promptPresetModelOverrides.svelte'
  import {
    modelPresetFieldForDatabaseKey,
    PROMPT_PRESET_FIELDS,
    promptPresetModelOverrideFieldForDatabaseKey,
  } from 'src/ts/presetSplit'

  const stopServerSettingsWatch = watchServerBackedSettings(['showUnrecommended'])
  onDestroy(stopServerSettingsWatch)

  let sorted = 0
  let warns: string[] = $state([])
  let tokens = $state(0)
  let extokens = $state(0)
  let draggedIndex = $state(-1)
  let dragOverIndex = $state(-1)
  let openedItemIndices = $state(new Set<number>())
  type FallbackModelKey = 'model' | 'memory' | 'translate' | 'emotion' | 'otherAx' | 'scriptMain' | 'scriptAux'
  type FallbackModelsDraft = Record<FallbackModelKey, string[]>
  type PromptSettingOwnerContext =
    | { kind: 'top-level'; key: string }
    | { kind: 'prompt-preset'; key: string; presetField: string; presetId: string }
    | { kind: 'model-preset'; key: string; presetField: string; presetId: string }
  interface PromptSettingDirtyState<T> {
    owner: PromptSettingOwnerContext
    attempted: T
    dirtyFields: Set<string> | null
  }
  interface Props {
    onGoBack?: () => void
    mode?: 'independent' | 'inline'
    subMenu?: number
    promptPresetModelOverrideMode?: boolean
    showPromptModelOverrideFields?: boolean
  }

  const promptPresetFieldSet = new Set<string>(PROMPT_PRESET_FIELDS)
  const promptPresetTemplateIdsPendingServerSync = new Set<string>()
  interface PromptPresetTemplateIdServerSync {
    completion: Promise<boolean>
    itemSnapshots: ReadonlyMap<string, string>
  }
  const promptPresetTemplateIdSyncInFlight = new Map<string, PromptPresetTemplateIdServerSync>()

  let {
    onGoBack = () => {},
    mode = 'independent',
    subMenu = $bindable(0),
    promptPresetModelOverrideMode = false,
    showPromptModelOverrideFields = true,
  }: Props = $props()

  const promptTokenizeDebouncer = createPromptTokenizeDebouncer({
    debounceMs: 300,
    onResult: (totals) => {
      tokens = totals.tokens
      extokens = totals.extokens
    },
  })

  function fallbackModelLabel(key: FallbackModelKey): string {
    switch (key) {
      case 'model':
        return language.model
      case 'memory':
        return language.modelRoles.roles.memory
      case 'translate':
        return language.modelRoles.roles.translate
      case 'emotion':
        return language.modelRoles.roles.emotion
      case 'otherAx':
        return language.modelRoles.roles.otherAx
      case 'scriptMain':
        return language.modelRoles.roles.scriptMain
      case 'scriptAux':
        return language.modelRoles.roles.scriptAux
    }
  }
  const promptTemplateDraft = $state<{ value: PromptItem[] }>({
    value: isPromptTemplateHydrated() ? cloneSelectedPromptPresetTemplate() : [],
  })
  let promptTemplateDraftRenderEpoch = $state(0)
  const promptTemplateDraftBinding: PromptTemplateDraftBinding = {
    getItems: () => promptTemplateDraft.value,
    setItems: (items) => {
      promptTemplateDraft.value = items
    },
  }
  let previousPromptTemplateRevision = peekCachedServerCommandRevision()
  let previousPromptTemplatePresetSelection = promptTemplatePresetSelectionSignature()
  let promptTemplateHydrated = $derived($promptTemplateHydratedStore && isPromptTemplateHydrated())
  let promptTemplateHydrationPending = $state(!isPromptTemplateHydrated())
  let promptTemplateHydrationFailed = $state(false)
  let promptTemplateHydrationRequestId = 0
  const promptSettingsDraft = createPromptSettingsDraft<Record<string, any>>('promptSettings', {})
  const jsonSchemaEnabledDraft = createPromptSettingsDraft<boolean>('jsonSchemaEnabled', false)
  const outputImageModalDraft = createPromptSettingsDraft<boolean>('outputImageModal', false)
  const strictJsonSchemaDraft = createPromptSettingsDraft<boolean>('strictJsonSchema', false)
  const customPromptTemplateToggleDraft = createPromptSettingsDraft<string>('customPromptTemplateToggle', '')
  const templateDefaultVariablesDraft = createPromptSettingsDraft<string>('templateDefaultVariables', '')
  const OAIPredictionDraft = createPromptSettingsDraft<string>('OAIPrediction', '')
  const autoSuggestPromptDraft = createPromptSettingsDraft<string>('autoSuggestPrompt', '')
  const systemContentReplacementDraft = createPromptSettingsDraft<string>('systemContentReplacement', '')
  const systemRoleReplacementDraft = createPromptSettingsDraft<string>('systemRoleReplacement', 'user')
  const jsonSchemaDraft = createPromptSettingsDraft<string>('jsonSchema', '')
  const extractJsonDraft = createPromptSettingsDraft<string>('extractJson', '')
  const fallbackModelsDraft = createPromptSettingsDraft<FallbackModelsDraft>('fallbackModels', {
    model: [],
    memory: [],
    translate: [],
    emotion: [],
    otherAx: [],
    scriptMain: [],
    scriptAux: [],
  })
  const fallbackWhenBlankResponseDraft = createPromptSettingsDraft<boolean>('fallbackWhenBlankResponse', false)
  const doNotChangeFallbackModelsDraft = createPromptSettingsDraft<boolean>('doNotChangeFallbackModels', false)

  function promptItemId(item: PromptItem, ownerId: string | null = currentPromptTemplateOwnerId()): string {
    if (typeof item.id !== 'string' || item.id.length === 0) {
      item.id = crypto.randomUUID()
      markPromptPresetTemplateIdsPendingServerSync(ownerId)
    }
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

  function isJsonRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function selectedPromptPresetIndex(): number {
    const selectedIndex = getResourceDatabase().promptPresetsId
    return Number.isInteger(selectedIndex) && selectedIndex >= 0 ? selectedIndex : -1
  }

  function selectedModelPresetIndex(): number {
    const selectedIndex = getResourceDatabase().modelPresetsId
    return Number.isInteger(selectedIndex) && selectedIndex >= 0 ? selectedIndex : -1
  }

  function selectedPromptPresetId(): string | null {
    const selectedIndex = selectedPromptPresetIndex()
    const selectedId =
      selectedIndex >= 0 ? (getResourceDatabase().promptPresets?.[selectedIndex]?.id as unknown) : undefined
    return typeof selectedId === 'string' && selectedId.length > 0 ? selectedId : null
  }

  function selectedModelPresetId(): string | null {
    const selectedIndex = selectedModelPresetIndex()
    const selectedId =
      selectedIndex >= 0 ? (getResourceDatabase().modelPresets?.[selectedIndex]?.id as unknown) : undefined
    return typeof selectedId === 'string' && selectedId.length > 0 ? selectedId : null
  }

  function selectedPromptPreset(): Record<string, unknown> | undefined {
    const selectedIndex = selectedPromptPresetIndex()
    return selectedIndex >= 0
      ? (getResourceDatabase().promptPresets?.[selectedIndex] as Record<string, unknown> | undefined)
      : undefined
  }

  function selectedPromptPresetHasOwnPromptTemplate(): boolean {
    const preset = selectedPromptPreset()
    return !!preset && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
  }

  function cloneSelectedPromptPresetTemplate(): PromptItem[] {
    const preset = selectedPromptPreset()
    if (preset) {
      return cloneJsonValue(Array.isArray(preset.promptTemplate) ? (preset.promptTemplate as PromptItem[]) : [])
    }
    return cloneJsonValue(getResourceDatabase().promptTemplate ?? [])
  }

  function syncSelectedPromptPresetTemplateProjection(templates: PromptItem[]): void {
    const nextTemplate = cloneJsonValue(templates)
    withTrustedResourceWrite(() => {
      const selectedIndex = selectedPromptPresetIndex()
      const preset =
        selectedIndex >= 0 ? (getResourceDatabase().promptPresets?.[selectedIndex] as Record<string, unknown>) : null
      if (preset) {
        preset.promptTemplate = cloneJsonValue(nextTemplate)
      }
      getResourceDatabase().promptTemplate = cloneJsonValue(nextTemplate)
    })
  }

  function syncSelectedPromptPresetItemProjection(itemId: string, promptItem: PromptItem): void {
    withTrustedResourceWrite(() => {
      const preset = selectedPromptPreset()
      if (!preset || !Array.isArray(preset.promptTemplate)) return
      const template = preset.promptTemplate as PromptItem[]
      const index = template.findIndex((item) => item.id === itemId)
      if (index === -1) {
        preset.promptTemplate = cloneJsonValue(promptTemplateDraft.value ?? [])
        return
      }
      template[index] = cloneJsonValue(promptItem)
    })
  }

  function alignCompatibilityProjectionFromSelectedPromptPreset(): void {
    const preset = selectedPromptPreset()
    if (!preset) return
    withTrustedResourceWrite(() => {
      if (Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')) {
        getResourceDatabase().promptTemplate = cloneJsonValue(
          Array.isArray(preset.promptTemplate) ? (preset.promptTemplate as PromptItem[]) : [],
        )
      } else {
        delete (getResourceDatabase() as unknown as Record<string, unknown>).promptTemplate
      }
    })
  }

  function currentPromptTemplateSnapshot(): PromptItem[] {
    ensurePromptTemplateDraftIds(currentPromptTemplateOwnerId())
    return cloneJsonValue(promptTemplateDraft.value ?? [])
  }

  function promptTemplatePresetSelectionSignature(): string {
    const selectedIndex = getResourceDatabase().promptPresetsId
    const selectedId =
      Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? getResourceDatabase().promptPresets?.[selectedIndex]?.id
        : null
    return `${selectedIndex}:${selectedId ?? ''}`
  }

  function resetPromptTemplateDraftFromProjection(): void {
    resetPromptTemplateSelectionDirtyState()
    adoptPromptTemplateDraftFromProjection()
  }

  function adoptPromptTemplateDraftFromProjection(): void {
    promptTemplateDraft.value = cloneSelectedPromptPresetTemplate()
    alignCompatibilityProjectionFromSelectedPromptPreset()
    promptTemplateDraftRenderEpoch += 1
    previousPromptTemplateRevision = peekCachedServerCommandRevision()
  }

  async function hydrateCurrentPromptTemplateOwner(
    options: {
      force?: boolean
      resetSelectionDirtyState?: boolean
    } = {},
  ): Promise<void> {
    const ownerId = currentPromptTemplateOwnerId()
    const requestId = ++promptTemplateHydrationRequestId
    promptTemplateHydrationPending = !isPromptTemplateHydrated(ownerId) || options.force === true
    promptTemplateHydrationFailed = false

    let hydrated = false
    try {
      hydrated = await ensurePromptTemplateHydrated({
        promptPresetId: ownerId,
        ...(options.force ? { force: true } : {}),
      })
    } catch {
      hydrated = false
    }

    if (requestId !== promptTemplateHydrationRequestId || ownerId !== currentPromptTemplateOwnerId()) return
    promptTemplateHydrationPending = false
    promptTemplateHydrationFailed = !hydrated
    if (!hydrated) return

    if (options.resetSelectionDirtyState) {
      resetPromptTemplateDraftFromProjection()
    } else {
      adoptPromptTemplateDraftFromProjection()
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

  function promptTemplateItemIds(items: PromptItem[]): string[] | null {
    const itemIds: string[] = []
    const seen = new Set<string>()

    for (const item of items) {
      const itemId = item.id
      if (typeof itemId !== 'string' || itemId.length === 0 || seen.has(itemId)) return null
      seen.add(itemId)
      itemIds.push(itemId)
    }

    return itemIds
  }

  function dispatchCreatePromptItem(
    ownerId: string | null,
    promptItem: PromptItem,
    projectionFence: PromptTemplateOwnerMutationFence,
  ): void {
    if (!promptTemplateHydrated) return
    if (!canUseServerCommands()) return
    if (projectionFence.ownerId !== ownerId) return
    const itemId = promptItemId(promptItem)
    const attemptedItem = cloneJsonValue(promptItem)
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    void runServerCommand({
      command: (baseRevision) =>
        runPromptTemplateOwnerCommand(ownerId, () =>
          createPromptItemCommand({
            baseRevision,
            promptPresetId: promptTemplateOwnerCommandId(ownerId),
            promptItem: cloneJsonValue(attemptedItem) as PromptItemSnapshot,
            optimisticAcknowledgement,
          }),
        ),
      rollback: () =>
        rollbackFailedPromptTemplateItemCreate({
          ownerId,
          binding: promptTemplateDraftBinding,
          itemId,
          attemptedItem,
          projectionFence,
        }),
    })
  }

  function dispatchDeletePromptItem(
    ownerId: string | null,
    promptItem: PromptItem,
    previous: PromptItem[],
    projectionFence: PromptTemplateOwnerMutationFence,
  ): void {
    if (!promptTemplateHydrated) return
    if (!canUseServerCommands()) return
    if (projectionFence.ownerId !== ownerId) return
    const itemId = promptItemId(promptItem)
    const previousIndex = previous.findIndex((item) => item.id === itemId)
    const previousItem = previousIndex === -1 ? cloneJsonValue(promptItem) : previous[previousIndex]
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    void runServerCommand({
      command: (baseRevision) =>
        runPromptTemplateOwnerCommand(ownerId, () =>
          deletePromptItemCommand({
            baseRevision,
            promptPresetId: promptTemplateOwnerCommandId(ownerId),
            itemId,
            optimisticAcknowledgement,
          }),
        ),
      rollback: () =>
        rollbackFailedPromptTemplateItemDelete({
          ownerId,
          binding: promptTemplateDraftBinding,
          itemId,
          previousIndex,
          previousItem,
          projectionFence,
        }),
    })
  }

  function dispatchReorderPromptItems(
    ownerId: string | null,
    previous: PromptItem[],
    projectionFence: PromptTemplateOwnerMutationFence,
  ): void {
    if (!promptTemplateHydrated) return
    if (!canUseServerCommands()) return
    if (projectionFence.ownerId !== ownerId) return
    ensurePromptTemplateDraftIds(ownerId)
    const itemIds = promptTemplateItemIds(promptTemplateDraft.value)
    const previousItemIds = promptTemplateItemIds(previous)
    if (!itemIds || !previousItemIds) return
    const attemptedItemIds = [...itemIds]
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    void runServerCommand({
      command: (baseRevision) =>
        runPromptTemplateOwnerCommand(ownerId, () =>
          reorderPromptItemsCommand({
            baseRevision,
            promptPresetId: promptTemplateOwnerCommandId(ownerId),
            itemIds,
            optimisticAcknowledgement,
          }),
        ),
      rollback: () =>
        rollbackFailedPromptTemplateItemReorder({
          ownerId,
          binding: promptTemplateDraftBinding,
          previousItemIds,
          attemptedItemIds,
          projectionFence,
        }),
    })
  }

  function queuePromptItemUpdate(promptItem: PromptItem, previousItem: PromptItem, originalIndex: number): void {
    if (!promptTemplateHydrated) return
    const ownerId = currentPromptTemplateOwnerId()
    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    const itemId = ensurePromptItemDraftId(promptItem, previousItem, originalIndex, ownerId)
    syncSelectedPromptPresetItemProjection(itemId, promptItem)
    const queueRowPatch = (writeFence = projectionFence) =>
      queuePromptItemProjectionUpdate(promptTemplateDraftBinding, itemId, previousItem, 250, ownerId, writeFence)
    const attemptedItemSnapshot = snapshotJson(promptItem)
    const templateIdSync = queuePromptPresetTemplateIdServerSync(ownerId)
    if (!templateIdSync) {
      queueRowPatch()
      return
    }
    void templateIdSync.completion.then((synced) => {
      if (synced && templateIdSync.itemSnapshots.get(itemId) !== attemptedItemSnapshot) {
        const currentItem = promptTemplateDraft.value.find((item) => item.id === itemId)
        if (currentItem) syncSelectedPromptPresetItemProjection(itemId, currentItem)
        queueRowPatch(capturePromptTemplateOwnerMutationFence(ownerId))
      }
    })
  }

  function ensurePromptItemDraftId(
    promptItem: PromptItem,
    previousItem: PromptItem,
    originalIndex: number,
    ownerId: string | null,
  ): string {
    ensurePromptTemplateDraftIds(ownerId)
    const draftItem = promptTemplateDraft.value[originalIndex]
    if (draftItem && (typeof draftItem.id !== 'string' || draftItem.id.length === 0)) {
      draftItem.id = crypto.randomUUID()
      markPromptPresetTemplateIdsPendingServerSync(ownerId)
    }
    const itemId = draftItem?.id ?? promptItemId(promptItem, ownerId)
    promptItem.id = itemId
    previousItem.id ??= itemId
    if (draftItem && draftItem.id !== itemId) {
      draftItem.id = itemId
      markPromptPresetTemplateIdsPendingServerSync(ownerId)
    }
    syncSelectedPromptPresetTemplateProjection(promptTemplateDraft.value)
    return itemId
  }

  function ensurePromptTemplateDraftIds(ownerId: string | null): void {
    const seen = new Set<string>()
    let changed = false

    for (const item of promptTemplateDraft.value ?? []) {
      const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : ''
      if (!id || seen.has(id)) {
        item.id = crypto.randomUUID()
        changed = true
      }
      seen.add(item.id)
    }

    if (!changed) return
    markPromptPresetTemplateIdsPendingServerSync(ownerId)
    syncSelectedPromptPresetTemplateProjection(promptTemplateDraft.value)
  }

  function markPromptPresetTemplateIdsPendingServerSync(ownerId: string | null): void {
    markPromptTemplateOwnerAcknowledgementTainted(ownerId)
    if (ownerId) promptPresetTemplateIdsPendingServerSync.add(ownerId)
  }

  function queuePromptPresetTemplateIdServerSync(ownerId: string | null): PromptPresetTemplateIdServerSync | null {
    if (!ownerId || !promptPresetTemplateIdsPendingServerSync.has(ownerId) || !canUseServerCommands()) return null
    const existing = promptPresetTemplateIdSyncInFlight.get(ownerId)
    if (existing) return existing

    const promptPresetId = ownerId
    const promptTemplate = cloneJsonValue(promptTemplateDraft.value ?? [])
    const itemSnapshots = new Map(
      promptTemplate
        .filter((item): item is PromptItem & { id: string } => typeof item.id === 'string' && item.id.length > 0)
        .map((item) => [item.id, snapshotJson(item)]),
    )
    const patch = { promptTemplate }
    const completion = runServerCommand({
      command: (baseRevision) =>
        runPromptTemplateOwnerCommand(ownerId, () =>
          updatePromptPresetCommand({
            baseRevision,
            promptPresetId,
            patch: cloneJsonValue({ ...patch, id: promptPresetId }) as PromptPresetSnapshot,
          }),
        ),
    })
      .then((result) => {
        if (result.status === 'ok') {
          promptPresetTemplateIdsPendingServerSync.delete(ownerId)
          return true
        }
        markPromptTemplateOwnerAcknowledgementTainted(ownerId)
        return false
      })
      .finally(() => {
        promptPresetTemplateIdSyncInFlight.delete(ownerId)
      })

    const sync = { completion, itemSnapshots }
    promptPresetTemplateIdSyncInFlight.set(ownerId, sync)
    return sync
  }

  function movePromptItem(originalIndex: number, nextIndex: number): void {
    if (!promptTemplateHydrated) return
    if (nextIndex < 0 || nextIndex >= promptTemplateDraft.value.length) return
    const previous = currentPromptTemplateSnapshot()
    const templates = [...promptTemplateDraft.value]
    const temp = templates[originalIndex]
    templates[originalIndex] = templates[nextIndex]
    templates[nextIndex] = temp
    const ownerId = currentPromptTemplateOwnerId()
    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    promptTemplateDraft.value = templates
    syncSelectedPromptPresetTemplateProjection(templates)
    dispatchReorderPromptItems(ownerId, previous, projectionFence)
  }

  function applyPromptTemplateDraft(templates: PromptItem[]): string | null {
    if (!promptTemplateHydrated) return null
    const ownerId = currentPromptTemplateOwnerId()
    promptTemplateDraft.value = cloneJsonValue(templates)
    syncSelectedPromptPresetTemplateProjection(templates)
    return ownerId
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
    let previousResourceApplyEpoch = getServerResourceApplyEpoch()
    let previousDraftDispatchSnapshot = snapshotJson(initialValue)
    const dirtyStates = new Map<string, PromptSettingDirtyState<T>>()

    $effect(() => {
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
      let serverValue = currentPromptSettingValue(key, fallback)
      let serverSnapshot = snapshotJson(serverValue)
      const draftSnapshot = snapshotJson(draft.value)
      const currentOwnerKey = promptSettingOwnerStateKey(resolvePromptSettingOwnerForEdit(key))

      if (resourceApplyChanged && dirtyStates.size > 0) {
        suppressDraftDispatch = true
        reconcileDirtyPromptSettingProjection(key, fallback, dirtyStates)

        serverValue = currentPromptSettingValue(key, fallback)
        serverSnapshot = snapshotJson(serverValue)

        const currentDirty = dirtyStates.get(currentOwnerKey)
        const nextDraft = currentDirty ? cloneJsonValue(currentDirty.attempted) : cloneJsonValue(serverValue)
        const nextDraftSnapshot = snapshotJson(nextDraft)
        previousDraftDispatchSnapshot = nextDraftSnapshot
        if (nextDraftSnapshot !== draftSnapshot) {
          draft.value = nextDraft
        }
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
        previousResourceApplyEpoch = resourceApplyEpoch
        previousServerSnapshot = currentDirty ? snapshotJson(currentDirty.attempted) : serverSnapshot
        return
      }

      if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        dirtyStates.delete(currentOwnerKey)
        previousDraftDispatchSnapshot = serverSnapshot
        draft.value = cloneJsonValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }

      previousResourceApplyEpoch = resourceApplyEpoch
      previousServerSnapshot = serverSnapshot
    })

    $effect(() => {
      const snapshot = snapshotJson(draft.value)
      if (!initialized) {
        initialized = true
        previousDraftDispatchSnapshot = snapshot
        return
      }
      if (suppressDraftDispatch) {
        previousDraftDispatchSnapshot = snapshot
        return
      }
      if (snapshot === previousDraftDispatchSnapshot) return
      previousDraftDispatchSnapshot = snapshot

      untrack(() => {
        const attempted = cloneJsonValue(draft.value)
        const previousSetting = cloneJsonValue(currentPromptSettingValue(key, fallback))
        const previousProjection = cloneJsonValue((getResourceDatabase() as unknown as Record<string, unknown>)[key])
        const owner = resolvePromptSettingOwnerForEdit(key)
        dirtyStates.set(promptSettingOwnerStateKey(owner), {
          owner,
          attempted,
          dirtyFields: dirtyPromptSettingObjectFields(previousSetting, attempted),
        })
        withTrustedResourceWrite(() => {
          // Re-read inside the trusted write to get the mutable projection.
          const target = getResourceDatabase() as unknown as Record<string, unknown>
          target[key] = attempted
        })
        const mirroredToPreset = usePromptPresetModelOverrideForKey(key)
          ? mirrorPromptPresetModelOverrideField(key, attempted)
          : mirrorTopLevelPresetField(key, attempted)
        if (!mirroredToPreset) {
          queuePromptSettingsPatch({ [key]: attempted }, { [key]: previousProjection })
        }
        previousServerSnapshot = snapshot
      })
    })

    return draft
  }

  function reconcileDirtyPromptSettingProjection<T>(
    key: string,
    fallback: T,
    dirtyStates: Map<string, PromptSettingDirtyState<T>>,
  ): void {
    for (const [dirtyKey, dirtyState] of Array.from(dirtyStates.entries())) {
      const ownerProjection = readPromptSettingOwnerValue<T>(dirtyState.owner, key, fallback)
      if (!ownerProjection.exists) {
        dirtyStates.delete(dirtyKey)
        continue
      }

      if (snapshotJson(ownerProjection.value) === snapshotJson(dirtyState.attempted)) {
        dirtyStates.delete(dirtyKey)
        if (dirtyState.owner.kind === 'top-level') {
          dropPendingPromptSettingsProjectionPatchKeys([key])
        }
        continue
      }

      dirtyState.attempted = mergePromptSettingProjectionValue(ownerProjection.value, dirtyState)
      if (!reassertPromptSettingOwnerValue(key, dirtyState.attempted, dirtyState.owner)) {
        dirtyStates.delete(dirtyKey)
      } else if (dirtyState.owner.kind === 'top-level') {
        replacePendingPromptSettingsProjectionPatchValue(key, dirtyState.attempted)
      }
    }
  }

  function mergePromptSettingProjectionValue<T>(projectionValue: T, dirtyState: PromptSettingDirtyState<T>): T {
    if (dirtyState.dirtyFields && isJsonRecord(dirtyState.attempted) && isJsonRecord(projectionValue)) {
      return mergeProjectionIntoDirtyDraft({
        draft: cloneJsonValue(dirtyState.attempted),
        projection: projectionValue,
        dirtyFields: dirtyState.dirtyFields,
      }) as T
    }
    return cloneJsonValue(dirtyState.attempted)
  }

  function dirtyPromptSettingObjectFields(previous: unknown, attempted: unknown): Set<string> | null {
    if (!isJsonRecord(previous) || !isJsonRecord(attempted)) return null

    const dirtyFields = new Set<string>()
    const keys = new Set([...Object.keys(previous), ...Object.keys(attempted)])
    for (const field of keys) {
      if (snapshotJson(previous[field]) !== snapshotJson(attempted[field])) {
        dirtyFields.add(field)
      }
    }

    return dirtyFields
  }

  function promptSettingOwnerStateKey(owner: PromptSettingOwnerContext): string {
    if (owner.kind === 'top-level') return `top-level:${owner.key}`
    return `${owner.kind}:${owner.presetId}:${owner.presetField}:${owner.key}`
  }

  function resolvePromptSettingOwnerForEdit(key: string): PromptSettingOwnerContext {
    const promptPresetField = promptPresetOwnerFieldForKey(key)
    if (promptPresetField) {
      const presetId = selectedPromptPresetId()
      if (presetId) {
        return {
          kind: 'prompt-preset',
          key,
          presetField: promptPresetField,
          presetId,
        }
      }
      return { kind: 'top-level', key }
    }

    if (!usePromptPresetModelOverrideForKey(key)) {
      const modelPresetField = modelPresetFieldForDatabaseKey(key)
      const presetId = modelPresetField ? selectedModelPresetId() : null
      if (modelPresetField && presetId) {
        return {
          kind: 'model-preset',
          key,
          presetField: modelPresetField,
          presetId,
        }
      }
    }

    return { kind: 'top-level', key }
  }

  function promptPresetOwnerFieldForKey(key: string): string | null {
    if (usePromptPresetModelOverrideForKey(key)) {
      return promptPresetModelOverrideFieldForDatabaseKey(key)
    }
    if (key === 'promptTemplate') return null
    return promptPresetFieldSet.has(key) ? key : null
  }

  function readPromptSettingOwnerValue<T>(
    owner: PromptSettingOwnerContext,
    key: string,
    fallback: T,
  ): { exists: boolean; value: T } {
    if (owner.kind === 'top-level') {
      const target = getResourceDatabase() as unknown as Record<string, unknown> | undefined
      const value = target?.[key]
      return { exists: true, value: value === undefined ? fallback : (value as T) }
    }

    const ownerRecord =
      owner.kind === 'prompt-preset' ? promptPresetById(owner.presetId) : modelPresetById(owner.presetId)
    if (!ownerRecord) return { exists: false, value: fallback }

    const value = ownerRecord[owner.presetField]
    return { exists: true, value: value === undefined ? fallback : (value as T) }
  }

  function reassertPromptSettingOwnerValue<T>(key: string, value: T, owner: PromptSettingOwnerContext): boolean {
    let reasserted = false
    withTrustedResourceWrite(() => {
      const target = getResourceDatabase() as unknown as Record<string, unknown>
      if (owner.kind === 'top-level') {
        target[key] = cloneJsonValue(value)
        reasserted = true
        return
      }

      if (owner.kind === 'prompt-preset') {
        const presetIndex = promptPresetIndexById(owner.presetId)
        const preset =
          presetIndex >= 0 ? (getResourceDatabase().promptPresets?.[presetIndex] as Record<string, unknown>) : null
        if (!preset) return

        preset[owner.presetField] = cloneJsonValue(value)
        if (getResourceDatabase().promptPresetsId === presetIndex) {
          target[key] = cloneJsonValue(value)
        }
        reasserted = true
        return
      }

      const presetIndex = modelPresetIndexById(owner.presetId)
      const preset =
        presetIndex >= 0 ? (getResourceDatabase().modelPresets?.[presetIndex] as Record<string, unknown>) : null
      if (!preset) return

      preset[owner.presetField] = cloneJsonValue(value)
      if (getResourceDatabase().modelPresetsId === presetIndex) {
        target[key] = cloneJsonValue(value)
      }
      reasserted = true
    })
    return reasserted
  }

  function promptPresetById(presetId: string): Record<string, unknown> | null {
    const index = promptPresetIndexById(presetId)
    return index >= 0
      ? ((getResourceDatabase().promptPresets?.[index] as Record<string, unknown> | undefined) ?? null)
      : null
  }

  function modelPresetById(presetId: string): Record<string, unknown> | null {
    const index = modelPresetIndexById(presetId)
    return index >= 0
      ? ((getResourceDatabase().modelPresets?.[index] as Record<string, unknown> | undefined) ?? null)
      : null
  }

  function promptPresetIndexById(presetId: string): number {
    return getResourceDatabase().promptPresets?.findIndex((preset) => preset?.id === presetId) ?? -1
  }

  function modelPresetIndexById(presetId: string): number {
    return getResourceDatabase().modelPresets?.findIndex((preset) => preset?.id === presetId) ?? -1
  }

  function currentPromptSettingValue<T>(key: string, fallback: T): T {
    if (usePromptPresetModelOverrideForKey(key)) {
      return currentPromptPresetModelOverrideValue(key, fallback)
    }
    const target = getResourceDatabase() as unknown as Record<string, unknown> | undefined
    const value = target?.[key]
    return value === undefined ? fallback : (value as T)
  }

  function usePromptPresetModelOverrideForKey(key: string): boolean {
    return promptPresetModelOverrideMode && !!promptPresetModelOverrideFieldForDatabaseKey(key)
  }

  $effect.pre(() => {
    if (!promptTemplateHydrated) return
    warns = templateCheck(getResourceDatabase())
  })
  $effect.pre(() => {
    if (!promptTemplateHydrated) return
    promptTemplateTokenizeSignature(promptTemplateDraft.value)
    untrack(() => {
      promptTokenizeDebouncer.schedule(promptTemplateDraft.value)
    })
  })
  $effect(() => {
    const selection = promptTemplatePresetSelectionSignature()
    if (selection === previousPromptTemplatePresetSelection) return
    previousPromptTemplatePresetSelection = selection
    untrack(() => {
      void hydrateCurrentPromptTemplateOwner({ resetSelectionDirtyState: true })
    })
  })
  $effect(() => {
    if (!promptTemplateHydrated) return
    // Reconcile the draft from the projection only when the cached server command
    // revision advances (a real server push / command response), not on every
    // keystroke. `reconcilePromptTemplateDraft` reads `getResourceDatabase().promptTemplate`
    // so this effect still re-runs on a projection change; the whole-template
    // stringify now happens only on a revision advance, never per keystroke.
    const { revision, nextDraft } = reconcilePromptTemplateDraft(
      promptTemplateDraft.value,
      previousPromptTemplateRevision,
      cloneSelectedPromptPresetTemplate(),
    )
    previousPromptTemplateRevision = revision
    if (nextDraft) {
      promptTemplateDraft.value = nextDraft
      syncSelectedPromptPresetTemplateProjection(nextDraft)
      promptTemplateDraftRenderEpoch += 1
    }
  })
  $effect(() => {
    if (!promptTemplateHydrated) return
    if (!promptTemplateIdsNeedNormalization(getResourceDatabase())) return
    withTrustedResourceWrite(() => {
      normalizePromptTemplateIds(getResourceDatabase())
    })
    markPromptTemplateOwnerAcknowledgementTainted(currentPromptTemplateOwnerId())
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
    const projectionFence = capturePromptTemplateOwnerMutationFence()
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

    const ownerId = applyPromptTemplateDraft(templates)
    dispatchReorderPromptItems(ownerId, previous, projectionFence)
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
    void hydrateCurrentPromptTemplateOwner()
  })

  onDestroy(() => {
    promptTemplateHydrationRequestId += 1
    document.removeEventListener('keydown', handleKeyDown)
    flushPendingPromptTemplatePatches()
    promptTokenizeDebouncer.cancel()
  })
</script>

{#if mode === 'independent'}
  <h2 class="mb-2 text-2xl font-bold mt-2 items-center flex">
    <button
      type="button"
      aria-label={language.goback}
      class="mr-2 text-textcolor2 hover:text-textcolor"
      onclick={onGoBack}>
      <ArrowLeft />
    </button>
    {language.promptTemplate}
  </h2>

  <div class="flex w-full rounded-md border border-selected">
    <button
      type="button"
      aria-pressed={subMenu === 0}
      onclick={() => {
        subMenu = 0
      }}
      class="p-2 flex-1"
      class:bg-selected={subMenu === 0}>
      <span>{language.template}</span>
    </button>
    <button
      type="button"
      aria-pressed={subMenu === 1}
      onclick={() => {
        subMenu = 1
      }}
      class="p-2 flex-1"
      class:bg-selected={subMenu === 1}>
      <span>{language.settings}</span>
    </button>
  </div>
{/if}
{#if promptTemplateHydrated && warns.length > 0 && subMenu === 0}
  <div class="text-red-500 flex flex-col items-start p-2 rounded-md border-red-500 border mt-4">
    <h2 class="text-xl font-bold">Warning</h2>
    <div class="border-b border-b-red-500 mt-1 mb-2 w-full"></div>
    {#each warns as warn}
      <span class="ml-4">{warn}</span>
    {/each}
  </div>
{/if}

{#if subMenu === 0}
  {#if promptTemplateHydrationFailed}
    <div
      class="flex min-h-28 items-center justify-center px-6 text-textcolor2"
      role="alert"
      data-testid="prompt-template-hydration-error">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="text-sm">{language.promptTemplateLoadFailed}</span>
        <button
          type="button"
          data-testid="prompt-template-hydration-retry"
          class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor transition-colors hover:border-textcolor hover:bg-selected focus:border-textcolor focus:bg-selected"
          onclick={() => {
            void hydrateCurrentPromptTemplateOwner({ force: true, resetSelectionDirtyState: true })
          }}>
          <RefreshCcwIcon size={16} />
          <span>{language.retry}</span>
        </button>
      </div>
    </div>
  {:else if promptTemplateHydrationPending || !promptTemplateHydrated}
    <div class="text-textcolor2 mt-4" role="status" data-testid="prompt-template-hydration-loading">
      {language.loading}
    </div>
  {:else}
    <div class="contain w-full max-w-full mt-4 flex flex-col p-3 rounded-md">
      {#if promptTemplateDraft.value.length === 0}
        <div class="text-textcolor2">No Format</div>
      {/if}
      {#key sorted}
        {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex } (`${promptTemplateDraftRenderEpoch}:${prompt.id ?? originalIndex}`)}
          <PromptDataItem
            bind:promptItem={promptTemplateDraft.value[originalIndex]}
            isDragging={draggedIndex === originalIndex}
            isOpened={openedItemIndices.has(originalIndex)}
            bind:draggedIndex
            bind:dragOverIndex
            bind:openedItemIndices
            currentIndex={originalIndex}
            {displayIndex}
            onUpdate={(promptItem, previousItem) => queuePromptItemUpdate(promptItem, previousItem, originalIndex)}
            onDrop={handlePromptDrop}
            onRemove={() => {
              const previous = currentPromptTemplateSnapshot()
              const projectionFence = capturePromptTemplateOwnerMutationFence()
              const removed = promptTemplateDraft.value[originalIndex]
              let templates = [...promptTemplateDraft.value]
              templates.splice(originalIndex, 1)
              const ownerId = applyPromptTemplateDraft(templates)

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
              dispatchDeletePromptItem(ownerId, removed, previous, projectionFence)
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
            }} />
        {/each}
      {/key}
    </div>

    <button
      type="button"
      aria-label={`${language.add}: ${language.promptTemplate}`}
      class="font-medium cursor-pointer hover:text-green-500"
      onclick={() => {
        const promptItem = createPromptItem()
        const projectionFence = capturePromptTemplateOwnerMutationFence()
        const ownerId = applyPromptTemplateDraft([...(promptTemplateDraft.value ?? []), promptItem])
        dispatchCreatePromptItem(ownerId, promptItem, projectionFence)
      }}><PlusIcon /></button>

    <span class="text-textcolor2 text-sm mt-2">{tokens} {language.fixedTokens}</span>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{extokens} {language.exactTokens}</span>
  {/if}
{:else}
  <span class="text-textcolor mt-4">{language.postEndInnerFormat}</span>
  <TextInput bind:value={promptSettingsDraft.value.postEndInnerFormat} />

  <Check bind:check={promptSettingsDraft.value.sendChatAsSystem} name={language.sendChatAsSystem} className="mt-4" />
  <Check bind:check={promptSettingsDraft.value.sendName} name={language.formatGroupInSingle} className="mt-4" />
  <Check bind:check={promptSettingsDraft.value.trimStartNewChat} name={language.trimStartNewChat} className="mt-4" />
  <Check bind:check={promptSettingsDraft.value.utilOverride} name={language.utilOverride} className="mt-4" />
  {#if showPromptModelOverrideFields}
    <Check bind:check={jsonSchemaEnabledDraft.value} name={language.enableJsonSchema} className="mt-4" />
    <Check bind:check={outputImageModalDraft.value} name={language.outputImageModal} className="mt-4" />

    <Check bind:check={strictJsonSchemaDraft.value} name={language.strictJsonSchema} className="mt-4" />
  {/if}

  {#if getResourceDatabase().showUnrecommended}
    <Check
      bind:check={promptSettingsDraft.value.customChainOfThought}
      name={language.customChainOfThought}
      className="mt-4">
      <Help unrecommended key="customChainOfThought" />
    </Check>
  {/if}
  <span class="text-textcolor mt-4">{language.maxThoughtTagDepth}</span>
  <NumberInput bind:value={promptSettingsDraft.value.maxThoughtTagDepth} />
  <span class="text-textcolor mt-4"
    >{language.customPromptTemplateToggle} <Help key="customPromptTemplateToggle" /></span>
  <TextAreaInput bind:value={customPromptTemplateToggleDraft.value} />
  <span class="text-textcolor mt-4">{language.defaultVariables} <Help key="defaultVariables" /></span>
  <TextAreaInput bind:value={templateDefaultVariablesDraft.value} />
  <span class="text-textcolor mt-4">{language.predictedOutput}</span>
  <TextAreaInput bind:value={OAIPredictionDraft.value} />
  <span class="text-textcolor mt-4">{language.autoSuggest} <Help key="autoSuggest" /></span>
  <TextAreaInput bind:value={autoSuggestPromptDraft.value} placeholder={defaultAutoSuggestPrompt} />
  {#if showPromptModelOverrideFields}
    <span class="text-textcolor mt-4">{language.systemContentReplacement} <Help key="systemContentReplacement" /></span>
    <TextAreaInput bind:value={systemContentReplacementDraft.value} />
    <span class="text-textcolor mt-4">{language.systemRoleReplacement} <Help key="systemRoleReplacement" /></span>
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
        type="button"
        aria-label={`${language.add}: ${fallbackModelLabel(arg)}`}
        class="bg-selected text-textcolor p-2 rounded-md"
        onclick={() => {
          const value = fallbackModelsDraft.value[arg] ?? []
          fallbackModelsDraft.value[arg] = [...value, '']
        }}><PlusIcon /></button>
      <button
        type="button"
        aria-label={`${language.remove}: ${fallbackModelLabel(arg)}`}
        class="bg-red-500 text-white p-2 rounded-md"
        onclick={() => {
          const value = fallbackModelsDraft.value[arg] ?? []
          fallbackModelsDraft.value[arg] = value.slice(0, -1)
        }}><TrashIcon /></button>
    </div>
  {/snippet}

  {#if showPromptModelOverrideFields}
    <Accordion name={language.fallbackModel} styled>
      <Check
        bind:check={fallbackWhenBlankResponseDraft.value}
        name={language.fallbackWhenBlankResponse}
        className="mt-4" />
      {#if !promptPresetModelOverrideMode}
        <Check
          bind:check={doNotChangeFallbackModelsDraft.value}
          name={language.doNotChangeFallbackModels}
          className="mt-4" />
      {/if}

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
      <Accordion name={language.modelRoles.roles.scriptMain} styled>
        {@render fallbackModelList('scriptMain')}
      </Accordion>
      <Accordion name={language.modelRoles.roles.scriptAux} styled>
        {@render fallbackModelList('scriptAux')}
      </Accordion>
    </Accordion>
  {/if}
{/if}
