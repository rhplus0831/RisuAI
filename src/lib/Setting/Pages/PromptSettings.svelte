<script lang="ts">
  import 'src/ts/stores.svelte'
  import { ArrowLeft, PlusIcon, RefreshCcwIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'
  import PromptDataItem from 'src/lib/UI/PromptDataItem.svelte'
  import {
    createPromptTokenizeDebouncer,
    promptTemplateTokenizeSignature,
    type PromptItem,
  } from 'src/ts/process/prompt'
  import { templateCheck } from 'src/ts/process/templates/templateCheck'
  import { createNonSecurityUuid } from 'src/ts/nonSecurityUuid'

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
    armPendingPromptItemProjectionUpdate,
    dropPendingPromptSettingsProjectionPatchKeys,
    capturePromptItemOptimisticAcknowledgement,
    capturePromptTemplateOwnerMutationFence,
    dispatchPromptTemplateStructuralMutation,
    flushPendingPromptTemplatePatches,
    queuePromptItemProjectionUpdate,
    queuePromptSettingsProjectionPatch,
    reconcilePromptTemplateDraft,
    reapplyPendingPromptTemplateStructuralProjections,
    resetPromptTemplateSelectionDirtyState,
    promptTemplateOwnerCommandId,
    promptTemplateOwnerMutationKey,
    replacePendingPromptSettingsProjectionPatchValue,
    rollbackFailedPromptTemplateItemCreate,
    rollbackFailedPromptTemplateItemDelete,
    rollbackFailedPromptTemplateItemReorder,
    runPromptTemplateOwnerCommand,
    stagePromptItemDeleteMutation,
    type PromptTemplateDraftBinding,
    type PromptTemplateOwnerMutationFence,
    type PromptTemplateStructuralFinalSettlement,
    type PromptTemplateStructuralMutationOutcome,
    type PromptTemplateStructuralOwnerState,
  } from 'src/ts/server/promptTemplateBridge.svelte'
  import { mergeProjectionIntoDirtyDraft } from 'src/ts/server/staleStateGuards'
  import {
    clonePromptTemplateSelectedFallback,
    currentPromptTemplateOwnerId,
    ensurePromptTemplateHydrated,
    isPromptTemplateHydrated,
    markPromptTemplateOwnerAcknowledgementTainted,
    promptTemplateOwnerUsesSelectedFallback,
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
    type ServerCommandResult,
    type SettingsPatch,
  } from 'src/ts/server/commands'
  import { dispatchDurableMutation } from 'src/ts/server/durableMutationDispatch'
  import { stagePendingMutation, type DurableMutationIntent } from 'src/ts/server/pendingMutationOutbox'
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
  type PromptDropPlacement = 'before' | 'after'
  interface PromptItemDragState {
    ownerId: string | null
    itemId: string
  }
  interface PromptItemDropBoundary {
    ownerId: string | null
    targetItemId: string
    placement: PromptDropPlacement
  }
  let promptItemDrag = $state<PromptItemDragState | null>(null)
  let promptItemDropBoundary = $state<PromptItemDropBoundary | null>(null)
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
  let suppressPromptTemplateDraftDispatch = false
  const promptTemplateDraftBinding: PromptTemplateDraftBinding = {
    getItems: () => promptTemplateDraft.value,
    setItems: (items) => {
      promptTemplateDraft.value = items
    },
  }
  let previousPromptTemplateRevision = peekCachedServerCommandRevision()
  let previousPromptTemplatePresetSelection = promptTemplatePresetSelectionSignature()
  let promptTemplateHydrated = $derived($promptTemplateHydratedStore && isPromptTemplateHydrated())
  let promptTemplateUsesSelectedFallback = $derived(promptTemplateOwnerUsesSelectedFallback(selectedPromptPresetId()))
  let promptTemplateHydrationPending = $state(!isPromptTemplateHydrated())
  let promptTemplateHydrationFailed = $state(false)
  let promptTemplateHydrationRequestId = 0
  let promptTemplateStructuralMutationState = $state<'idle' | 'saving' | 'queued' | 'failed'>('idle')
  let promptTemplateStructuralMutationError = $state('')
  let promptTemplateStructuralMutationSequence = 0
  let promptTemplateStructuralMutationPending = $derived(promptTemplateStructuralMutationState === 'saving')
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
      item.id = createNonSecurityUuid()
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
      if (Array.isArray(preset.promptTemplate)) return cloneJsonValue(preset.promptTemplate as PromptItem[])
      if (promptTemplateOwnerUsesSelectedFallback(selectedPromptPresetId())) {
        return cloneJsonValue(clonePromptTemplateSelectedFallback(selectedPromptPresetId()) ?? [])
      }
      return []
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
      } else if (promptTemplateOwnerUsesSelectedFallback(selectedPromptPresetId())) {
        const fallback = clonePromptTemplateSelectedFallback(selectedPromptPresetId())
        if (Array.isArray(fallback)) getResourceDatabase().promptTemplate = fallback
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

  function resetPromptTemplateUiState(): void {
    openedItemIndices = new Set<number>()
    resetPromptItemDragState()
  }

  function resetPromptItemDragState(): void {
    promptItemDrag = null
    promptItemDropBoundary = null
  }

  function promptTemplateStructureSignature(items: PromptItem[]): string {
    return items.map((item, index) => item.id?.trim() || `index:${index}`).join('\u0000')
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

  function uniquePromptItemIndex(items: PromptItem[], itemId: string): number | null {
    let foundIndex = -1
    for (let index = 0; index < items.length; index += 1) {
      if (items[index]?.id !== itemId) continue
      if (foundIndex !== -1) return null
      foundIndex = index
    }
    return foundIndex === -1 ? null : foundIndex
  }

  function remapOpenedPromptItemIndices(previous: PromptItem[], next: PromptItem[]): Set<number> {
    const nextOpenedIndices = new Set<number>()
    for (const previousIndex of openedItemIndices) {
      const itemId = previous[previousIndex]?.id
      if (typeof itemId !== 'string' || itemId.length === 0) continue
      const nextIndex = uniquePromptItemIndex(next, itemId)
      if (nextIndex !== null) nextOpenedIndices.add(nextIndex)
    }
    return nextOpenedIndices
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
    reapplyPendingPromptTemplateStructuralProjections(ownerId)

    if (options.resetSelectionDirtyState) {
      resetPromptTemplateDraftFromProjection()
    } else {
      adoptPromptTemplateDraftFromProjection()
    }
  }

  function createPromptItem(): PromptItem {
    return {
      id: createNonSecurityUuid(),
      type: 'plain',
      text: '',
      role: 'system',
      type2: 'normal',
    }
  }

  function clonePromptItemForDuplicate(promptItem: PromptItem): PromptItem {
    return {
      ...cloneJsonValue(promptItem),
      id: createNonSecurityUuid(),
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

  function promptTemplateStructuralOwnerState(items: PromptItem[]): PromptTemplateStructuralOwnerState {
    return { enabled: true, items: cloneJsonValue(items) }
  }

  function promptTemplateStructuralMutationMessage(result: ServerCommandResult): string {
    if (result.status === 'conflict') return language.promptTemplateMutation.commandConflict
    if (result.status === 'unavailable') return language.promptTemplateMutation.commandUnavailable
    if (result.status === 'error') return language.promptTemplateMutation.commandError(result.error)
    return language.promptTemplateMutation.commandUnavailable
  }

  function beginPromptTemplateStructuralMutation(): number | null {
    if (promptTemplateStructuralMutationPending) return null
    promptTemplateStructuralMutationState = 'saving'
    promptTemplateStructuralMutationError = ''
    return ++promptTemplateStructuralMutationSequence
  }

  function trackPromptTemplateStructuralMutation(
    sequence: number,
    pending: Promise<PromptTemplateStructuralMutationOutcome>,
  ): void {
    void pending.then(
      (outcome) => {
        if (sequence !== promptTemplateStructuralMutationSequence) return
        if (outcome.status === 'accepted') {
          promptTemplateStructuralMutationState = 'idle'
          return
        }
        if (outcome.status === 'queued') {
          promptTemplateStructuralMutationState = 'queued'
          return
        }
        promptTemplateStructuralMutationState = 'failed'
        promptTemplateStructuralMutationError = promptTemplateStructuralMutationMessage(outcome.result)
      },
      (error) => {
        if (sequence !== promptTemplateStructuralMutationSequence) return
        promptTemplateStructuralMutationState = 'failed'
        promptTemplateStructuralMutationError = language.promptTemplateMutation.commandError(
          error instanceof Error ? error.message : String(error),
        )
      },
    )
  }

  function handlePromptTemplateStructuralFinalSettlement(
    sequence: number,
    ownerId: string | null,
    settlement: PromptTemplateStructuralFinalSettlement,
  ): void {
    if (sequence !== promptTemplateStructuralMutationSequence || ownerId !== currentPromptTemplateOwnerId()) return
    if (settlement === 'accepted') {
      promptTemplateStructuralMutationState = 'idle'
      promptTemplateStructuralMutationError = ''
      return
    }
    adoptPromptTemplateDraftFromProjection()
    promptTemplateStructuralMutationState = 'failed'
    promptTemplateStructuralMutationError = language.promptTemplateMutation.replayDiscarded
  }

  function dispatchCreatePromptItem(
    ownerId: string | null,
    promptItem: PromptItem,
    previous: PromptItem[],
    projectionFence: PromptTemplateOwnerMutationFence,
    sequence: number,
    afterItemId?: string,
  ): Promise<PromptTemplateStructuralMutationOutcome> {
    if (!promptTemplateHydrated || !canUseServerCommands() || projectionFence.ownerId !== ownerId) {
      return Promise.resolve({ status: 'failed', result: { status: 'unavailable' } })
    }
    const itemId = promptItemId(promptItem)
    const attemptedItem = cloneJsonValue(promptItem)
    const attemptedItems = cloneJsonValue(promptTemplateDraft.value)
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/prompt-items',
          body: {
            ...(ownerId ? { promptPresetId: ownerId } : {}),
            ...(afterItemId ? { afterItemId } : {}),
            promptItem: cloneJsonValue(attemptedItem),
          },
        },
      ],
    }
    const outbox = stagePendingMutation(promptTemplateOwnerMutationKey(ownerId), intent)
    return dispatchPromptTemplateStructuralMutation({
      ownerId,
      operation: {
        kind: 'create',
        itemId,
        previous: promptTemplateStructuralOwnerState(previous),
        attempted: promptTemplateStructuralOwnerState(attemptedItems),
      },
      outbox,
      intent,
      dispatch: (transport, rollback) =>
        runServerCommand({
          command: (baseRevision) =>
            runPromptTemplateOwnerCommand(ownerId, () =>
              createPromptItemCommand({
                baseRevision,
                promptPresetId: promptTemplateOwnerCommandId(ownerId),
                afterItemId,
                promptItem: cloneJsonValue(attemptedItem) as PromptItemSnapshot,
                optimisticAcknowledgement,
              }),
            ),
          rollback,
          ...transport,
        }),
      rollback: () =>
        rollbackFailedPromptTemplateItemCreate({
          ownerId,
          binding: promptTemplateDraftBinding,
          itemId,
          attemptedItem,
          projectionFence,
        }),
      onFinalSettlement: (settlement) => handlePromptTemplateStructuralFinalSettlement(sequence, ownerId, settlement),
    })
  }

  function dispatchDeletePromptItem(
    ownerId: string | null,
    promptItem: PromptItem,
    previous: PromptItem[],
    projectionFence: PromptTemplateOwnerMutationFence,
    sequence: number,
  ): Promise<PromptTemplateStructuralMutationOutcome> {
    if (!promptTemplateHydrated || !canUseServerCommands() || projectionFence.ownerId !== ownerId) {
      return Promise.resolve({ status: 'failed', result: { status: 'unavailable' } })
    }
    const itemId = promptItemId(promptItem)
    const previousIndex = previous.findIndex((item) => item.id === itemId)
    const previousItem = previousIndex === -1 ? cloneJsonValue(promptItem) : previous[previousIndex]
    const attemptedItems = cloneJsonValue(promptTemplateDraft.value)
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    const stagedDelete = stagePromptItemDeleteMutation(ownerId, itemId)
    return dispatchPromptTemplateStructuralMutation({
      ownerId,
      operation: {
        kind: 'delete',
        itemId,
        previous: promptTemplateStructuralOwnerState(previous),
        attempted: promptTemplateStructuralOwnerState(attemptedItems),
      },
      outbox: stagedDelete.outbox,
      intent: stagedDelete.intent,
      dispatch: (transport, rollback) =>
        runServerCommand({
          command: (baseRevision) =>
            runPromptTemplateOwnerCommand(ownerId, () =>
              deletePromptItemCommand({
                baseRevision,
                promptPresetId: promptTemplateOwnerCommandId(ownerId),
                itemId,
                optimisticAcknowledgement,
              }),
            ),
          rollback,
          ...transport,
        }),
      rollback: () =>
        rollbackFailedPromptTemplateItemDelete({
          ownerId,
          binding: promptTemplateDraftBinding,
          itemId,
          previousIndex,
          previousItem,
          projectionFence,
        }),
      onFinalSettlement: (settlement) => handlePromptTemplateStructuralFinalSettlement(sequence, ownerId, settlement),
    })
  }

  function dispatchReorderPromptItems(
    ownerId: string | null,
    previous: PromptItem[],
    projectionFence: PromptTemplateOwnerMutationFence,
    sequence: number,
  ): Promise<PromptTemplateStructuralMutationOutcome> {
    if (!promptTemplateHydrated || !canUseServerCommands() || projectionFence.ownerId !== ownerId) {
      return Promise.resolve({ status: 'failed', result: { status: 'unavailable' } })
    }
    ensurePromptTemplateDraftIds(ownerId)
    const itemIds = promptTemplateItemIds(promptTemplateDraft.value)
    const previousItemIds = promptTemplateItemIds(previous)
    if (!itemIds || !previousItemIds) {
      return Promise.resolve({ status: 'failed', result: { status: 'unavailable' } })
    }
    const attemptedItemIds = [...itemIds]
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/prompt-items/reorder',
          body: {
            ...(ownerId ? { promptPresetId: ownerId } : {}),
            itemIds: [...itemIds],
          },
        },
      ],
    }
    const outbox = stagePendingMutation(promptTemplateOwnerMutationKey(ownerId), intent)
    return dispatchPromptTemplateStructuralMutation({
      ownerId,
      operation: {
        kind: 'reorder',
        previousItemIds,
        attemptedItemIds,
        previous: promptTemplateStructuralOwnerState(previous),
        attempted: promptTemplateStructuralOwnerState(promptTemplateDraft.value),
      },
      outbox,
      intent,
      dispatch: (transport, rollback) =>
        runServerCommand({
          command: (baseRevision) =>
            runPromptTemplateOwnerCommand(ownerId, () =>
              reorderPromptItemsCommand({
                baseRevision,
                promptPresetId: promptTemplateOwnerCommandId(ownerId),
                itemIds,
                optimisticAcknowledgement,
              }),
            ),
          rollback,
          ...transport,
        }),
      rollback: () =>
        rollbackFailedPromptTemplateItemReorder({
          ownerId,
          binding: promptTemplateDraftBinding,
          previousItemIds,
          attemptedItemIds,
          projectionFence,
        }),
      onFinalSettlement: (settlement) => handlePromptTemplateStructuralFinalSettlement(sequence, ownerId, settlement),
    })
  }

  function queuePromptItemUpdate(promptItem: PromptItem, previousItem: PromptItem, originalIndex: number): void {
    if (!promptTemplateHydrated || suppressPromptTemplateDraftDispatch) return
    const ownerId = currentPromptTemplateOwnerId()
    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    const itemId = ensurePromptItemDraftId(promptItem, previousItem, originalIndex, ownerId)
    syncSelectedPromptPresetItemProjection(itemId, promptItem)
    const queueRowPatch = (writeFence = projectionFence, delayMs: number | null = 250) =>
      queuePromptItemProjectionUpdate(promptTemplateDraftBinding, itemId, previousItem, delayMs, ownerId, writeFence)
    const attemptedItemSnapshot = snapshotJson(promptItem)
    const templateIdSync = queuePromptPresetTemplateIdServerSync(ownerId)
    if (!templateIdSync) {
      queueRowPatch()
      return
    }
    const changedAfterIdSync = templateIdSync.itemSnapshots.get(itemId) !== attemptedItemSnapshot
    if (changedAfterIdSync) {
      // Persist the successor before the prerequisite whole-preset repair
      // settles. Its network timer is armed only after that repair succeeds;
      // lifecycle flushes may safely enqueue it behind the already-queued repair.
      queueRowPatch(projectionFence, null)
    }
    void templateIdSync.completion.then((synced) => {
      if (!synced || !changedAfterIdSync) return
      const currentItem = promptTemplateDraft.value.find((item) => item.id === itemId)
      if (currentItem) syncSelectedPromptPresetItemProjection(itemId, currentItem)
      armPendingPromptItemProjectionUpdate(itemId, 250, ownerId, capturePromptTemplateOwnerMutationFence(ownerId))
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
      draftItem.id = createNonSecurityUuid()
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
        item.id = createNonSecurityUuid()
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
    const commandPatch = cloneJsonValue({ ...patch, id: promptPresetId }) as PromptPresetSnapshot
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: `/prompt-presets/${encodeURIComponent(promptPresetId)}`,
          body: { patch: cloneJsonValue(commandPatch) },
        },
      ],
    }
    const outbox = stagePendingMutation(promptTemplateOwnerMutationKey(promptPresetId), intent)
    const completion = dispatchDurableMutation(outbox, intent, (transport) =>
      runServerCommand({
        command: (baseRevision) =>
          runPromptTemplateOwnerCommand(ownerId, () =>
            updatePromptPresetCommand({
              baseRevision,
              promptPresetId,
              patch: commandPatch,
            }),
          ),
        ...transport,
      }),
    )
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
    if (!promptTemplateHydrated || promptTemplateStructuralMutationPending) return
    if (nextIndex < 0 || nextIndex >= promptTemplateDraft.value.length) return
    const sequence = beginPromptTemplateStructuralMutation()
    if (sequence === null) return
    if (canUseServerCommands()) flushPendingPromptTemplatePatches()
    const previous = currentPromptTemplateSnapshot()
    const templates = [...promptTemplateDraft.value]
    const temp = templates[originalIndex]
    templates[originalIndex] = templates[nextIndex]
    templates[nextIndex] = temp
    const ownerId = currentPromptTemplateOwnerId()
    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    promptTemplateDraft.value = templates
    syncSelectedPromptPresetTemplateProjection(templates)
    trackPromptTemplateStructuralMutation(
      sequence,
      dispatchReorderPromptItems(ownerId, previous, projectionFence, sequence),
    )
  }

  function insertPromptItem(promptItem: PromptItem, afterItemId?: string): number | null {
    if (!promptTemplateHydrated || promptTemplateStructuralMutationPending || promptTemplateUsesSelectedFallback) {
      return null
    }

    const ownerId = currentPromptTemplateOwnerId()
    ensurePromptTemplateDraftIds(ownerId)
    const afterIndex = afterItemId ? uniquePromptItemIndex(promptTemplateDraft.value, afterItemId) : null
    if (afterItemId && afterIndex === null) return null

    const sequence = beginPromptTemplateStructuralMutation()
    if (sequence === null) return null
    if (canUseServerCommands()) flushPendingPromptTemplatePatches()
    const previous = currentPromptTemplateSnapshot()
    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    const templates = [...promptTemplateDraft.value]
    const insertionIndex = afterIndex === null ? templates.length : afterIndex + 1
    templates.splice(insertionIndex, 0, promptItem)
    applyPromptTemplateDraft(templates)
    trackPromptTemplateStructuralMutation(
      sequence,
      dispatchCreatePromptItem(ownerId, promptItem, previous, projectionFence, sequence, afterItemId),
    )
    return insertionIndex
  }

  function duplicatePromptItem(originalIndex: number): void {
    const source = promptTemplateDraft.value[originalIndex]
    if (!source) return
    const sourceId = promptItemId(source)
    const insertionIndex = insertPromptItem(clonePromptItemForDuplicate(source), sourceId)
    if (insertionIndex === null) return

    const nextOpenedIndices = new Set<number>()
    for (const index of openedItemIndices) {
      nextOpenedIndices.add(index > originalIndex ? index + 1 : index)
    }
    nextOpenedIndices.add(insertionIndex)
    openedItemIndices = nextOpenedIndices
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
      promptTemplateStructuralMutationSequence += 1
      promptTemplateStructuralMutationState = 'idle'
      promptTemplateStructuralMutationError = ''
      resetPromptTemplateUiState()
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
    const { revision, nextDraft, structuralAdoption } = reconcilePromptTemplateDraft(
      promptTemplateDraft.value,
      previousPromptTemplateRevision,
      cloneSelectedPromptPresetTemplate(),
    )
    previousPromptTemplateRevision = revision
    if (nextDraft) {
      if (promptTemplateStructureSignature(nextDraft) !== promptTemplateStructureSignature(promptTemplateDraft.value)) {
        openedItemIndices = remapOpenedPromptItemIndices(promptTemplateDraft.value, nextDraft)
      }
      if (!structuralAdoption) suppressPromptTemplateDraftDispatch = true
      promptTemplateDraft.value = nextDraft
      syncSelectedPromptPresetTemplateProjection(nextDraft)
      if (structuralAdoption) {
        promptTemplateDraftRenderEpoch += 1
      } else {
        // The retained PromptDataItem observes the adopted value and advances
        // its change baseline, but must not redispatch that projection as an edit.
        queueMicrotask(() => {
          suppressPromptTemplateDraftDispatch = false
        })
      }
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
    const drag = resolvePromptItemDrag()
    if (!drag || drag.sourceIndex === drag.adjustedDropIndex) return getDisplayTemplate()

    const items = getDisplayTemplate()
    const [movedItem] = items.splice(drag.sourceIndex, 1)
    if (!movedItem) return getDisplayTemplate()

    items.splice(drag.adjustedDropIndex, 0, movedItem)

    return items.map((item, displayIndex) => ({
      ...item,
      displayIndex,
    }))
  }

  function capturePromptItemDrag(promptItem: PromptItem): void {
    if (promptTemplateStructuralMutationPending) return
    const ownerId = currentPromptTemplateOwnerId()
    ensurePromptTemplateDraftIds(ownerId)
    const itemId = promptItem.id
    if (
      typeof itemId !== 'string' ||
      itemId.length === 0 ||
      uniquePromptItemIndex(promptTemplateDraft.value, itemId) === null
    ) {
      resetPromptItemDragState()
      return
    }
    promptItemDrag = { ownerId, itemId }
    promptItemDropBoundary = null
  }

  function capturePromptItemDropBoundary(promptItem: PromptItem, placement: PromptDropPlacement): void {
    if (promptTemplateStructuralMutationPending) return
    const drag = promptItemDrag
    const ownerId = currentPromptTemplateOwnerId()
    const itemId = promptItem.id
    if (
      !drag ||
      drag.ownerId !== ownerId ||
      typeof itemId !== 'string' ||
      itemId.length === 0 ||
      uniquePromptItemIndex(promptTemplateDraft.value, itemId) === null
    ) {
      promptItemDropBoundary = null
      return
    }
    promptItemDropBoundary = { ownerId, targetItemId: itemId, placement }
  }

  function resolvePromptItemDrag(): { sourceIndex: number; adjustedDropIndex: number } | null {
    const drag = promptItemDrag
    const boundary = promptItemDropBoundary
    const ownerId = currentPromptTemplateOwnerId()
    if (!drag || !boundary || drag.ownerId !== ownerId || boundary.ownerId !== ownerId) return null
    if (!promptTemplateItemIds(promptTemplateDraft.value)) return null

    const sourceIndex = uniquePromptItemIndex(promptTemplateDraft.value, drag.itemId)
    const targetIndex = uniquePromptItemIndex(promptTemplateDraft.value, boundary.targetItemId)
    if (sourceIndex === null || targetIndex === null) return null

    const dropIndex = targetIndex + (boundary.placement === 'after' ? 1 : 0)
    return {
      sourceIndex,
      adjustedDropIndex: sourceIndex < dropIndex ? dropIndex - 1 : dropIndex,
    }
  }

  function isPromptItemDragging(originalIndex: number): boolean {
    const drag = promptItemDrag
    if (!drag || drag.ownerId !== currentPromptTemplateOwnerId()) return false
    return uniquePromptItemIndex(promptTemplateDraft.value, drag.itemId) === originalIndex
  }

  function handlePromptDrop(): void {
    if (promptTemplateStructuralMutationPending) {
      resetPromptItemDragState()
      return
    }
    const drag = resolvePromptItemDrag()
    if (!drag || drag.sourceIndex === drag.adjustedDropIndex) {
      resetPromptItemDragState()
      return
    }

    const sequence = beginPromptTemplateStructuralMutation()
    if (sequence === null) {
      resetPromptItemDragState()
      return
    }
    if (canUseServerCommands()) flushPendingPromptTemplatePatches()
    const templates = [...promptTemplateDraft.value]
    const previous = currentPromptTemplateSnapshot()
    const projectionFence = capturePromptTemplateOwnerMutationFence()
    const openedItemIds = new Set(
      [...openedItemIndices]
        .map((index) => templates[index]?.id)
        .filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0),
    )
    const [movedItem] = templates.splice(drag.sourceIndex, 1)
    if (!movedItem) {
      resetPromptItemDragState()
      return
    }

    templates.splice(drag.adjustedDropIndex, 0, movedItem)
    openedItemIndices = new Set(
      templates.flatMap((item, index) => (item.id && openedItemIds.has(item.id) ? [index] : [])),
    )

    const ownerId = applyPromptTemplateDraft(templates)
    trackPromptTemplateStructuralMutation(
      sequence,
      dispatchReorderPromptItems(ownerId, previous, projectionFence, sequence),
    )
    resetPromptItemDragState()
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
    {#if promptTemplateUsesSelectedFallback}
      <div
        class="mt-4 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor2"
        role="status"
        data-testid="prompt-template-selected-fallback-notice">
        {language.promptTemplateSelectedFallbackNotice}
      </div>
    {/if}
    <div class="contain w-full max-w-full mt-4 flex flex-col p-3 rounded-md">
      {#if promptTemplateDraft.value.length === 0}
        <div class="text-textcolor2">No Format</div>
      {/if}
      {#key sorted}
        {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex } (`${promptTemplateDraftRenderEpoch}:${prompt.id ?? originalIndex}`)}
          <PromptDataItem
            bind:promptItem={promptTemplateDraft.value[originalIndex]}
            isDragging={isPromptItemDragging(originalIndex)}
            isOpened={openedItemIndices.has(originalIndex)}
            bind:openedItemIndices
            currentIndex={originalIndex}
            {displayIndex}
            onUpdate={(promptItem, previousItem) => queuePromptItemUpdate(promptItem, previousItem, originalIndex)}
            onDragStart={capturePromptItemDrag}
            onDragOver={capturePromptItemDropBoundary}
            onDragEnd={resetPromptItemDragState}
            onDrop={handlePromptDrop}
            structuralDisabled={promptTemplateStructuralMutationPending || promptTemplateUsesSelectedFallback}
            readOnly={promptTemplateUsesSelectedFallback}
            onDuplicate={() => duplicatePromptItem(originalIndex)}
            onRemove={() => {
              if (promptTemplateStructuralMutationPending) return
              if (!confirmSettingsItemRemoval()) return
              const removed = promptTemplateDraft.value[originalIndex]
              if (!removed) return
              const sequence = beginPromptTemplateStructuralMutation()
              if (sequence === null) return
              if (canUseServerCommands()) flushPendingPromptTemplatePatches()
              const previous = currentPromptTemplateSnapshot()
              const projectionFence = capturePromptTemplateOwnerMutationFence()
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

              resetPromptItemDragState()
              trackPromptTemplateStructuralMutation(
                sequence,
                dispatchDeletePromptItem(ownerId, removed, previous, projectionFence, sequence),
              )
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
      disabled={promptTemplateStructuralMutationPending || promptTemplateUsesSelectedFallback}
      class="font-medium cursor-pointer hover:text-green-500"
      class:cursor-wait={promptTemplateStructuralMutationPending}
      class:opacity-60={promptTemplateStructuralMutationPending || promptTemplateUsesSelectedFallback}
      onclick={() => {
        insertPromptItem(createPromptItem())
      }}><PlusIcon /></button>

    {#if promptTemplateStructuralMutationState === 'failed'}
      <div class="mt-2 text-sm text-red-500" role="alert" data-testid="prompt-template-structural-mutation-status">
        {promptTemplateStructuralMutationError}
      </div>
    {/if}

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
          if (!confirmSettingsItemRemoval()) return
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
