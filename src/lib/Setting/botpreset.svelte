<script lang="ts">
  import { untrack } from 'svelte'
  import { alertConfirm, alertError, alertNormal } from '../../ts/alert'
  import { language } from '../../lang'
  // Durable preset-command compatibility facade. Every row call resolves its stable owner id immediately beforehand.
  import {
    createModelPreset,
    createPromptPreset,
    deleteModelPreset,
    deletePromptPreset,
    downloadPreset,
    extractLegacyBotPresetByIndex,
    importPreset,
    reorderModelPresets,
    reorderPromptPresets,
    selectModelPreset,
    selectPromptPreset,
    updateModelPreset,
    updatePromptPreset,
    type ModelPreset,
    type PresetMutationOutcome,
    type PromptPreset,
    type botPreset,
  } from '../../ts/storage/database.svelte'
  import { selectedCharID, type GenerationSettingsPickerMode, type PresetPickerKind } from 'src/ts/stores.svelte'
  import { collectionsResourceState, settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import {
    ArchiveIcon,
    ArchiveRestoreIcon,
    CopyIcon,
    GripVerticalIcon,
    HardDriveUploadIcon,
    PlusIcon,
    PencilIcon,
    Share2Icon,
    TrashIcon,
    XIcon,
    WandSparklesIcon,
  } from '@lucide/svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { prebuiltPresets } from 'src/ts/process/templates/templates'
  // Active-chat owner bridge: retained for chat-scoped selection persistence and settlement reporting.
  import {
    createManualModelPresetSelection,
    createPromptPresetSelection,
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import ModelPresetList from './Pages/Model/ModelPresetList.svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  // Prompt-template hydration bridge: retained for duplicating the exact prompt owner body.
  import {
    clonePromptTemplateSelectedFallback,
    ensurePromptTemplateHydrated,
    promptTemplateOwnerUsesSelectedFallback,
  } from 'src/ts/server/promptTemplateHydration'
  import { internalReorderSortableOptions } from 'src/ts/gui/internalReorderSortable'
  import Sortable, { type SortableEvent } from 'sortablejs'

  type ModernPreset = ModelPreset | PromptPreset
  type ModernPresetKind = 'model' | 'prompt'
  type StableModernPreset = ModernPreset & { id: string }
  type StableLegacyPreset = botPreset & { id: string }

  let editMode = $state(false)
  let showArchivedPromptPresets = $state(false)
  let presetListElement: HTMLDivElement | undefined = $state()
  let presetSortable: Sortable | null = null
  let renameOperation = 0
  let renameStates = $state<Record<string, { operation: number; status: 'saving' | 'queued' }>>({})
  let renameErrors = $state<Record<string, string>>({})
  let selectionOperation = 0
  let selectionPendingKey = $state<string | null>(null)
  let selectionError = $state('')
  let rowMutationOperation = 0
  let rowMutationStates = $state<Record<string, { operation: number; status: 'saving' | 'queued' }>>({})
  let rowMutationErrors = $state<Record<string, string>>({})
  let latestRowMutationError = $derived(Object.values(rowMutationErrors).at(-1) ?? '')
  let presetSortingDisabled = $derived(editMode || !!selectionPendingKey || Object.keys(rowMutationStates).length > 0)

  interface Props {
    close?: () => void
    mode?: GenerationSettingsPickerMode
    kind?: PresetPickerKind
    target?: ActiveChatTarget | null
  }

  let { close = () => {}, mode = 'global', kind = 'model', target = null }: Props = $props()

  let isChatGenerationSelectionMode = $derived(mode === 'active-chat-generation-settings')
  let title = $derived(
    kind === 'model' ? language.modelPresets : kind === 'prompt' ? language.promptPresets : language.legacyBotPresets,
  )
  let modernPresets = $derived.by(() => modernPresetOwners(kind === 'prompt' ? 'prompt' : 'model'))
  let visibleModernPresetEntries = $derived.by(() =>
    modernPresets.flatMap((preset, index) => {
      if (kind !== 'prompt' || ((preset as PromptPreset).archived === true) === showArchivedPromptPresets) {
        return [{ preset, index }]
      }
      return []
    }),
  )
  let legacyPresets = $derived.by(() =>
    readUniquePresetOwners<StableLegacyPreset>(collectionsResourceState.values.botPresets),
  )
  let useModelPresetManager = $derived(kind === 'model' && mode === 'global')
  let activeChatSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )
  let activeSelectedId = $derived.by(() => {
    if (!isChatGenerationSelectionMode) return null
    return kind === 'prompt'
      ? (activeChatSettings.settings?.promptPresetId ?? null)
      : (activeChatSettings.settings?.modelPresetId ?? null)
  })

  $effect(() => {
    presetSortable?.option('disabled', presetSortingDisabled)
  })

  $effect(() => {
    if (!presetListElement) return
    const sortable = Sortable.create(presetListElement, {
      ...internalReorderSortableOptions,
      disabled: untrack(() => presetSortingDisabled),
      draggable: '[data-risu-preset-sortable-item]',
      handle: '[data-risu-preset-drag-handle]',
      onEnd: handlePresetSortEnd,
    })
    presetSortable = sortable
    return () => {
      try {
        sortable.destroy()
      } catch {}
      if (presetSortable === sortable) presetSortable = null
    }
  })

  function stableId(id: unknown): string | null {
    return typeof id === 'string' && id.length > 0 && id.trim() === id ? id : null
  }

  function readUniquePresetOwners<T extends { id?: unknown }>(value: unknown): T[] {
    if (!Array.isArray(value)) return []
    const ids = new Set<string>()
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const id = stableId((candidate as { id?: unknown }).id)
      if (!id || ids.has(id)) return []
      ids.add(id)
    }
    return value as T[]
  }

  function modernPresetOwners(presetKind: ModernPresetKind): StableModernPreset[] {
    return presetKind === 'prompt'
      ? readUniquePresetOwners<StableModernPreset>(collectionsResourceState.values.promptPresets)
      : readUniquePresetOwners<StableModernPreset>(collectionsResourceState.values.modelPresets)
  }

  function selectedIndex(presetKind: ModernPresetKind): number {
    const value =
      presetKind === 'prompt' ? settingsResourceState.value.promptPresetsId : settingsResourceState.value.modelPresetsId
    return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : -1
  }

  function selectedGlobalPresetId(presetKind: ModernPresetKind): string | null {
    return modernPresetOwners(presetKind)[selectedIndex(presetKind)]?.id ?? null
  }

  function livePresetIndex(presetKind: ModernPresetKind, presetId: string): number {
    const presets = modernPresetOwners(presetKind)
    const index = presets.findIndex((candidate) => candidate.id === presetId)
    return index >= 0 && presets.filter((candidate) => candidate.id === presetId).length === 1 ? index : -1
  }

  function presetDraftKey(preset: StableModernPreset) {
    return `${kind}:${preset.id}`
  }

  function presetName(preset: StableModernPreset) {
    return preset?.name ?? ''
  }

  function updatePresetName(preset: StableModernPreset, name: string) {
    const presetKind: ModernPresetKind = kind === 'prompt' ? 'prompt' : 'model'
    const key = presetDraftKey(preset)
    const presets = modernPresetOwners(presetKind)
    const liveIndex = livePresetIndex(presetKind, preset.id)
    const livePreset = presets[liveIndex]
    if (!livePreset || (livePreset.name ?? '') === name) return

    const operation = ++renameOperation
    renameStates[key] = { operation, status: 'saving' }
    delete renameErrors[key]
    const outcome = kind === 'prompt' ? updatePromptPreset(liveIndex, { name }) : updateModelPreset(liveIndex, { name })
    void outcome.then((result) => settlePresetRename(key, operation, result))
  }

  function toggleEditMode() {
    renameErrors = {}
    editMode = !editMode
  }

  function togglePromptPresetArchiveView() {
    if (kind !== 'prompt') return
    showArchivedPromptPresets = !showArchivedPromptPresets
  }

  function settlePresetRename(
    key: string,
    operation: number,
    outcome: Awaited<ReturnType<typeof updateModelPreset>>,
  ): void {
    if (renameStates[key]?.operation !== operation) return
    if (outcome.status === 'accepted') {
      delete renameStates[key]
      return
    }
    if (outcome.status === 'failed') {
      showPresetRenameFailure(key)
      return
    }

    renameStates[key] = { operation, status: 'queued' }
    alertNormal(language.presetRenameQueued)
    void outcome.settlement.then((status) => {
      if (renameStates[key]?.operation !== operation) return
      if (status === 'accepted') delete renameStates[key]
      else showPresetRenameFailure(key)
    })
  }

  function showPresetRenameFailure(key: string): void {
    delete renameStates[key]
    renameErrors[key] = language.presetRenameFailed
    alertError(language.presetRenameFailed)
  }

  async function selectPreset(preset: StableModernPreset) {
    if (editMode) return
    if (isChatGenerationSelectionMode) {
      if (selectionPendingKey) return

      const operation = ++selectionOperation
      selectionPendingKey = presetDraftKey(preset)
      selectionError = ''
      const patch =
        kind === 'prompt'
          ? createPromptPresetSelection(preset.id, preset, activeChatSettings)
          : createManualModelPresetSelection(preset.id)
      try {
        const persistence = saveActiveChatGenerationSettingsSelectionWithOutcome(patch, { expectedTarget: target })
        if (!persistence) {
          if (operation !== selectionOperation) return
          selectionPendingKey = null
          selectionError = language.chatGenerationSettingsSaveFailed(language.chatGenerationSettingsTargetChanged)
          alertError(selectionError)
          return
        }

        const result = await persistence.settlement
        if (operation !== selectionOperation) return
        selectionPendingKey = null
        if (result.status === 'failed') {
          selectionError = language.chatGenerationSettingsSaveFailed(result.error)
          alertError(selectionError)
          return
        }
        if (result.status === 'queued') alertNormal(language.settingsSaveQueued)
        close()
      } catch (error) {
        if (operation !== selectionOperation) return
        selectionPendingKey = null
        selectionError = language.chatGenerationSettingsSaveFailed(error instanceof Error ? error.message : '')
        alertError(selectionError)
      }
      return
    }

    if (isPresetSelected(preset)) {
      close()
      return
    }
    if (selectionPendingKey) return

    const presetKind: ModernPresetKind = kind === 'prompt' ? 'prompt' : 'model'
    const index = livePresetIndex(presetKind, preset.id)
    if (index < 0) return

    const operation = ++selectionOperation
    selectionPendingKey = presetDraftKey(preset)
    selectionError = ''
    const outcome = await (kind === 'prompt' ? selectPromptPreset(index) : selectModelPreset(index))
    if (operation !== selectionOperation) return
    selectionPendingKey = null

    if (outcome.status === 'failed') {
      selectionError = language.presetSelectionFailed
      alertError(selectionError)
      return
    }
    if (outcome.status === 'queued') alertNormal(language.presetSelectionQueued)
    close()
  }

  function isPresetSelected(preset: StableModernPreset) {
    const presetKind: ModernPresetKind = kind === 'prompt' ? 'prompt' : 'model'
    if (!isChatGenerationSelectionMode) return preset.id === selectedGlobalPresetId(presetKind)
    return preset.id === activeSelectedId
  }

  function presetsForKind(presetKind: ModernPresetKind): StableModernPreset[] {
    return modernPresetOwners(presetKind)
  }

  function observePresetRowMutation(key: string, outcome: Promise<PresetMutationOutcome> | undefined): void {
    if (!outcome) return
    const operation = beginPresetRowMutation(key)
    void outcome.then(
      (result) => settlePresetRowMutation(key, operation, result),
      () => showPresetRowMutationFailure(key, operation),
    )
  }

  function beginPresetRowMutation(key: string): number {
    const operation = ++rowMutationOperation
    rowMutationStates[key] = { operation, status: 'saving' }
    delete rowMutationErrors[key]
    return operation
  }

  function settlePresetRowMutation(key: string, operation: number, outcome: PresetMutationOutcome): void {
    if (rowMutationStates[key]?.operation !== operation) return
    if (outcome.status === 'accepted') {
      delete rowMutationStates[key]
      return
    }
    if (outcome.status === 'failed') {
      showPresetRowMutationFailure(key, operation)
      return
    }

    rowMutationStates[key] = { operation, status: 'queued' }
    alertNormal(language.presetMutationQueued)
    void outcome.settlement.then(
      (status) => {
        if (rowMutationStates[key]?.operation !== operation) return
        if (status === 'accepted') delete rowMutationStates[key]
        else showPresetRowMutationFailure(key, operation)
      },
      () => showPresetRowMutationFailure(key, operation),
    )
  }

  function showPresetRowMutationFailure(key: string, operation: number): void {
    if (rowMutationStates[key]?.operation !== operation) return
    delete rowMutationStates[key]
    rowMutationErrors[key] = language.presetMutationFailed
    alertError(language.presetMutationFailed)
  }

  function movePreset(presetKind: ModernPresetKind, presetId: string, toIndex: number) {
    const fromIndex = livePresetIndex(presetKind, presetId)
    if (fromIndex < 0) return
    const preset = presetsForKind(presetKind)[fromIndex]
    if (!preset || preset.id !== presetId) return
    const key = `${presetKind}:${presetId}`
    const outcome =
      presetKind === 'prompt' ? reorderPromptPresets(fromIndex, toIndex) : reorderModelPresets(fromIndex, toIndex)
    observePresetRowMutation(key, outcome)
  }

  function setPromptPresetArchived(preset: StableModernPreset, archived: boolean) {
    const presets = modernPresetOwners('prompt')
    const liveIndex = livePresetIndex('prompt', preset.id)
    const livePreset = presets[liveIndex]
    if (!livePreset || livePreset.archived === archived) return

    const key = `prompt:${preset.id}`
    observePresetRowMutation(key, updatePromptPreset(liveIndex, { archived }))
  }

  function duplicatePromptPreset(preset: StableModernPreset): void {
    const presetId = preset.id
    const key = `prompt:${presetId}`
    if (rowMutationStates[key]) return

    const operation = beginPresetRowMutation(key)
    void ensurePromptTemplateHydrated({ promptPresetId: presetId, applyProjection: false }).then(
      (hydrated) => {
        if (rowMutationStates[key]?.operation !== operation) return
        if (!hydrated) {
          showPresetRowMutationFailure(key, operation)
          return
        }

        const presets = modernPresetOwners('prompt')
        const liveIndex = livePresetIndex('prompt', presetId)
        const livePreset = presets[liveIndex]
        if (!livePreset) {
          showPresetRowMutationFailure(key, operation)
          return
        }

        const copy = safeStructuredClone(livePreset)
        delete copy.id
        copy.name = language.presetCopyName(livePreset.name?.trim() || language.promptPresets)
        if (
          !Object.prototype.hasOwnProperty.call(copy, 'promptTemplate') &&
          promptTemplateOwnerUsesSelectedFallback(presetId)
        ) {
          const fallback = clonePromptTemplateSelectedFallback(presetId)
          if (fallback) copy.promptTemplate = fallback
        }

        const outcome = createPromptPreset(copy)
        void outcome.then(
          (result) => settlePresetRowMutation(key, operation, result),
          () => showPresetRowMutationFailure(key, operation),
        )
      },
      () => showPresetRowMutationFailure(key, operation),
    )
  }

  function handlePresetSortEnd(event: SortableEvent): void {
    const oldIndex = event.oldDraggableIndex
    const newIndex = event.newDraggableIndex
    const presetId = stableId((event.item as HTMLElement).dataset.risuPresetSortableKey)
    restorePresetSortableDom(event, presetId)
    if (
      presetSortingDisabled ||
      oldIndex === undefined ||
      newIndex === undefined ||
      oldIndex === newIndex ||
      !presetId
    ) {
      return
    }

    const presetKind: ModernPresetKind = kind === 'prompt' ? 'prompt' : 'model'
    const visiblePresetIds = visibleModernPresetEntries.map((entry) => entry.preset.id)
    const visibleSourceIndex = visiblePresetIds.indexOf(presetId)
    if (visibleSourceIndex < 0 || newIndex < 0 || newIndex >= visiblePresetIds.length) return

    const reorderedVisibleIds = [...visiblePresetIds]
    reorderedVisibleIds.splice(visibleSourceIndex, 1)
    reorderedVisibleIds.splice(newIndex, 0, presetId)

    const presets = presetsForKind(presetKind)
    const sourceIndex = presets.findIndex((preset) => preset.id === presetId)
    const followingPresetId = reorderedVisibleIds[newIndex + 1]
    const targetIndex = followingPresetId
      ? presets.findIndex((preset) => preset.id === followingPresetId)
      : presets.length
    if (sourceIndex < 0 || targetIndex < 0) return
    movePreset(presetKind, presetId, targetIndex)
  }

  function restorePresetSortableDom(event: SortableEvent, presetId: string | null): void {
    if (!presetId) return
    const originalAnchor = Array.from(event.from.querySelectorAll<HTMLElement>('[data-risu-preset-sort-anchor]')).find(
      (candidate) => candidate.dataset.risuPresetSortAnchor === presetId,
    )
    originalAnchor?.after(event.item)
  }

  function createNewPreset() {
    const preset = safeStructuredClone(prebuiltPresets.OAI2)
    if (kind === 'prompt') {
      preset.name = 'New Prompt Preset'
      observePresetRowMutation('prompt:create', createPromptPreset(preset))
    } else {
      preset.name = 'New Model Preset'
      observePresetRowMutation('model:create', createModelPreset(preset))
    }
  }

  async function removeModernPreset(preset: StableModernPreset) {
    const list = modernPresets
    if (list.length <= 1) {
      alertError(language.errors.onlyOneChat)
      return
    }
    const targetKind = kind
    if (!(await alertConfirm(`${language.removeConfirm}${preset.name ?? ''}`))) return

    const presetKind: ModernPresetKind = targetKind === 'prompt' ? 'prompt' : 'model'
    const currentPresets = modernPresetOwners(presetKind)
    if (currentPresets.length <= 1) return
    const liveIndex = livePresetIndex(presetKind, preset.id)
    if (liveIndex < 0) return

    const key = `${presetKind}:${preset.id}`
    const outcome = targetKind === 'prompt' ? deletePromptPreset(liveIndex, 0) : deleteModelPreset(liveIndex, 0)
    observePresetRowMutation(key, outcome)
  }

  function extractLegacy(preset: StableLegacyPreset, mode: 'all' | 'model' | 'prompt') {
    const index = legacyPresets.findIndex((candidate) => candidate.id === preset.id)
    if (index < 0) return
    // Compatibility bridge: legacy extraction remains index-based after resolving the stable owner id.
    extractLegacyBotPresetByIndex(index, mode)
    if (legacyPresets.length <= 1) close()
  }

  async function downloadModernPromptPreset(presetId: string): Promise<void> {
    const index = livePresetIndex('prompt', presetId)
    if (index < 0) return
    // Compatibility bridge: the export facade accepts an index, resolved here from the stable prompt owner id.
    await downloadPreset(index, 'risupreset')
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!selectionPendingKey) close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={() => {
    if (!selectionPendingKey) close()
  }}
  data-modal-root
  class="fixed inset-0 z-40 bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-h-full overflow-y-auto preset-modal"
    class:modelPresetManager={useModelPresetManager}
    data-risu-generation-picker
    data-risu-picker-kind={kind}
    data-risu-picker-mode={mode}
    aria-busy={selectionPendingKey ? 'true' : 'false'}
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-preset-picker-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 id="risu-preset-picker-title" class="mt-0 mb-0">{title}</h2>
      <div class="grow flex justify-end items-center gap-2">
        {#if kind === 'prompt'}
          <button
            type="button"
            data-risu-preset-archive-view
            disabled={!!selectionPendingKey}
            class="flex items-center gap-1 rounded border border-darkborderc px-2 py-1 text-sm text-textcolor2 hover:text-green-500 cursor-pointer"
            class:text-textcolor={showArchivedPromptPresets}
            aria-label={showArchivedPromptPresets
              ? language.showActivePromptPresets
              : language.showArchivedPromptPresets}
            title={showArchivedPromptPresets ? language.showActivePromptPresets : language.showArchivedPromptPresets}
            aria-pressed={showArchivedPromptPresets}
            onclick={togglePromptPresetArchiveView}>
            {#if showArchivedPromptPresets}
              <ArchiveRestoreIcon size={18} />
              <span>{language.activePromptPresets}</span>
            {:else}
              <ArchiveIcon size={18} />
              <span>{language.archivedPromptPresets}</span>
            {/if}
          </button>
        {/if}
        <button
          data-modal-initial-focus
          disabled={!!selectionPendingKey}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={() => {
            if (!selectionPendingKey) close()
          }}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    {#if kind === 'legacy'}
      {#if legacyPresets.length === 0}
        <span class="text-textcolor2 text-sm">{language.noLegacyBotPresets}</span>
      {:else}
        {#each legacyPresets as preset, i (preset.id)}
          <div class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 gap-2">
            <div class="flex-1 min-w-0">
              <span class="truncate">{preset.name ?? 'Legacy preset'}</span>
            </div>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer"
              aria-label={`${language.extractModelAndPrompt}: ${preset.name ?? `#${i + 1}`}`}
              title={language.extractModelAndPrompt}
              onclick={() => extractLegacy(preset, 'all')}>
              <WandSparklesIcon size={18} />
            </button>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer text-sm"
              onclick={() => extractLegacy(preset, 'model')}>
              {language.extractModelOnly}
            </button>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer text-sm"
              onclick={() => extractLegacy(preset, 'prompt')}>
              {language.extractPromptOnly}
            </button>
          </div>
        {/each}
      {/if}
    {:else if useModelPresetManager}
      <ModelPresetList embedded afterApply={close} />
    {:else}
      {#if kind === 'prompt' && visibleModernPresetEntries.length === 0}
        <span data-risu-preset-empty-state class="text-textcolor2 text-sm">
          {showArchivedPromptPresets ? language.noArchivedPromptPresets : language.noActivePromptPresets}
        </span>
      {/if}
      <div class="flex flex-col" role="list" data-risu-preset-sortable-list bind:this={presetListElement}>
        {#each visibleModernPresetEntries as entry, visibleIndex (entry.preset.id)}
          {@const preset = entry.preset}
          {@const i = entry.index}
          {@const presetId = preset.id}
          <div role="presentation" class="contents" data-risu-preset-sort-anchor={presetId}></div>

          <!-- The native select button owns keyboard activation; this handler keeps the full row as the pointer target. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
            class:bg-selected={isPresetSelected(preset)}
            data-risu-generation-picker-row
            data-risu-preset-sortable-item
            data-risu-preset-sortable-key={presetId}
            data-risu-picker-kind={kind}
            data-risu-picker-mode={mode}
            data-risu-row-id={presetId}
            data-risu-row-index={i}
            data-risu-selected={isPresetSelected(preset) ? 'true' : 'false'}
            onclick={() => {
              if (!editMode) selectPreset(preset)
            }}>
            {#if !editMode}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center text-textcolor2 active:cursor-grabbing"
                title={kind === 'prompt' ? language.dragPromptPreset : language.dragModelPreset}
                data-risu-preset-drag-handle
                aria-hidden="true"
                onclick={(event) => event.stopPropagation()}>
                <GripVerticalIcon size={18} />
              </span>
            {/if}
            {#if editMode}
              <div class="min-w-0 grow">
                <TextInput
                  bind:value={() => presetName(preset), (value) => updatePresetName(preset, value)}
                  ariaLabel={`${language.edit}: ${preset.name ?? `#${i + 1}`}`}
                  placeholder="string"
                  padding={false} />
                {#if renameErrors[presetDraftKey(preset)]}
                  <span data-risu-preset-rename-status role="alert" class="block text-xs text-draculared">
                    {renameErrors[presetDraftKey(preset)]}
                  </span>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                data-risu-picker-select
                class="flex min-w-0 grow items-center text-left"
                disabled={!!selectionPendingKey}
                aria-pressed={isPresetSelected(preset)}
                aria-current={isPresetSelected(preset) ? 'true' : undefined}
                onclick={(event) => {
                  event.stopPropagation()
                  selectPreset(preset)
                }}>
                {#if visibleIndex < 9}
                  <span class="w-2 text-center mr-2 text-textcolor2">{visibleIndex + 1}</span>
                {/if}
                <span>{preset.name}</span>
              </button>
            {/if}
            <div class="ml-auto flex shrink-0 justify-end">
              {#if kind === 'prompt'}
                <button
                  type="button"
                  data-risu-preset-duplicate-action
                  disabled={!!rowMutationStates[presetDraftKey(preset)]}
                  class="text-textcolor2 hover:text-green-500 cursor-pointer mr-2"
                  aria-label={`${language.duplicate}: ${preset.name ?? `#${visibleIndex + 1}`}`}
                  title={language.duplicate}
                  onclick={(e) => {
                    e.stopPropagation()
                    duplicatePromptPreset(preset)
                  }}>
                  <CopyIcon size={18} />
                </button>
                <button
                  type="button"
                  data-risu-preset-archive-action
                  class="text-textcolor2 hover:text-green-500 cursor-pointer mr-2"
                  aria-label={`${
                    (preset as PromptPreset).archived === true
                      ? language.restorePromptPreset
                      : language.archivePromptPreset
                  }: ${preset.name ?? `#${visibleIndex + 1}`}`}
                  title={(preset as PromptPreset).archived === true
                    ? language.restorePromptPreset
                    : language.archivePromptPreset}
                  onclick={(e) => {
                    e.stopPropagation()
                    setPromptPresetArchived(preset, (preset as PromptPreset).archived !== true)
                  }}>
                  {#if (preset as PromptPreset).archived === true}
                    <ArchiveRestoreIcon size={18} />
                  {:else}
                    <ArchiveIcon size={18} />
                  {/if}
                </button>
                <button
                  class="text-textcolor2 hover:text-green-500 cursor-pointer mr-2"
                  aria-label={`${language.export}: ${preset.name ?? `#${i + 1}`}`}
                  onclick={async (e) => {
                    e.stopPropagation()
                    await downloadModernPromptPreset(preset.id)
                  }}>
                  <Share2Icon size={18} />
                </button>
              {/if}
              <button
                class="text-textcolor2 hover:text-green-500 cursor-pointer"
                aria-label={`${language.remove}: ${preset.name ?? `#${i + 1}`}`}
                onclick={(e) => {
                  e.stopPropagation()
                  removeModernPreset(preset)
                }}>
                <TrashIcon size={18} />
              </button>
            </div>
          </div>
          {#if rowMutationErrors[presetDraftKey(preset)]}
            <span data-risu-preset-row-mutation-status role="alert" class="block px-2 text-xs text-draculared">
              {rowMutationErrors[presetDraftKey(preset)]}
            </span>
          {/if}
        {/each}
      </div>

      <div class="flex mt-2 items-center">
        {#if kind !== 'prompt' || !showArchivedPromptPresets}
          <button
            class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
            aria-label={`${language.add}: ${title}`}
            onclick={createNewPreset}>
            <PlusIcon />
          </button>
          {#if kind === 'prompt'}
            <button
              class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
              aria-label={`${language.import}: ${title}`}
              onclick={() => {
                importPreset()
              }}>
              <HardDriveUploadIcon size={18} />
            </button>
          {/if}
        {/if}
        <button
          class="text-textcolor2 hover:text-green-500 cursor-pointer"
          class:text-textcolor={editMode}
          data-risu-preset-edit
          aria-label={`${language.edit}: ${title}`}
          aria-pressed={editMode}
          onclick={toggleEditMode}>
          <PencilIcon size={18} />
        </button>
      </div>
      <span class="text-textcolor2 text-sm">{language.quickPreset}</span>
      {#if selectionError}
        <span data-risu-preset-selection-status role="alert" class="text-draculared text-sm">{selectionError}</span>
      {/if}
      {#if latestRowMutationError}
        <span data-risu-preset-mutation-status role="alert" class="text-draculared text-sm">
          {latestRowMutationError}
        </span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }

  .preset-modal {
    width: 31rem;
    max-width: min(48rem, calc(100vw - 2rem));
  }

  .preset-modal.modelPresetManager {
    width: min(72rem, calc(100vw - 2rem));
    max-width: 72rem;
  }
</style>
