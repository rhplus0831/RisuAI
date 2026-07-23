<script lang="ts">
  import { alertConfirm, alertError, alertNormal } from '../../ts/alert'
  import { language } from '../../lang'
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
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import {
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
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import ModelPresetList from './Pages/Model/ModelPresetList.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  type ModernPreset = ModelPreset | PromptPreset
  type ModernPresetKind = 'model' | 'prompt'

  let editMode = $state(false)
  let isDragging = $state(false)
  let dragOverIndex = $state(-1)
  let draggedPreset = $state<{ kind: ModernPresetKind; id: string } | null>(null)
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
  let modernPresets = $derived.by(() => (kind === 'prompt' ? getDatabase().promptPresets : getDatabase().modelPresets))
  let legacyPresets = $derived.by(() => (Array.isArray(getDatabase().botPresets) ? getDatabase().botPresets : []))
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

  function nonEmptyId(id: unknown): string | null {
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }

  function selectedIndex(): number {
    return kind === 'prompt' ? getDatabase().promptPresetsId : getDatabase().modelPresetsId
  }

  function presetDraftKey(preset: ModernPreset | undefined, index: number) {
    return `${kind}:${nonEmptyId(preset?.id) ?? `index:${index}`}`
  }

  function presetName(preset: ModernPreset | undefined) {
    return preset?.name ?? ''
  }

  function updatePresetName(preset: ModernPreset | undefined, index: number, name: string) {
    const key = presetDraftKey(preset, index)
    const presetId = nonEmptyId(preset?.id)
    const presets = kind === 'prompt' ? getDatabase().promptPresets : getDatabase().modelPresets
    const liveIndex = presetId ? presets.findIndex((candidate) => candidate?.id === presetId) : index
    const livePreset = presets[liveIndex]
    if (!livePreset || (!presetId && livePreset !== preset) || (livePreset.name ?? '') === name) return

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

  async function selectPreset(preset: ModernPreset | undefined, index: number) {
    if (editMode) return
    if (isChatGenerationSelectionMode) {
      const presetId = nonEmptyId(preset?.id)
      if (!presetId) return
      if (selectionPendingKey) return

      const operation = ++selectionOperation
      selectionPendingKey = presetDraftKey(preset, index)
      selectionError = ''
      const patch = kind === 'prompt' ? { promptPresetId: presetId } : { modelPresetId: presetId }
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

    if (isPresetSelected(preset, index)) {
      close()
      return
    }
    if (selectionPendingKey) return

    const operation = ++selectionOperation
    selectionPendingKey = presetDraftKey(preset, index)
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

  function isPresetSelected(preset: ModernPreset | undefined, index: number) {
    if (!isChatGenerationSelectionMode) return index === selectedIndex()
    const presetId = nonEmptyId(preset?.id)
    return !!presetId && presetId === activeSelectedId
  }

  function presetsForKind(presetKind: ModernPresetKind): ModernPreset[] {
    return presetKind === 'prompt' ? getDatabase().promptPresets : getDatabase().modelPresets
  }

  function observePresetRowMutation(key: string, outcome: Promise<PresetMutationOutcome> | undefined): void {
    if (!outcome) return
    const operation = ++rowMutationOperation
    rowMutationStates[key] = { operation, status: 'saving' }
    delete rowMutationErrors[key]
    void outcome.then(
      (result) => settlePresetRowMutation(key, operation, result),
      () => showPresetRowMutationFailure(key, operation),
    )
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

  function movePreset(presetKind: ModernPresetKind, fromIndex: number, toIndex: number) {
    const preset = presetsForKind(presetKind)[fromIndex]
    const key = `${presetKind}:${nonEmptyId(preset?.id) ?? `index:${fromIndex}`}`
    const outcome =
      presetKind === 'prompt' ? reorderPromptPresets(fromIndex, toIndex) : reorderModelPresets(fromIndex, toIndex)
    observePresetRowMutation(key, outcome)
  }

  function handlePresetDrop(targetPresetId: string | null | undefined, e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const data = e.dataTransfer?.getData('text')
    const drag = draggedPreset
    if (data !== 'preset' || !drag || drag.kind !== kind || targetPresetId === null) return

    const transferredPresetId = nonEmptyId(e.dataTransfer?.getData('presetId'))
    if (transferredPresetId && transferredPresetId !== drag.id) return

    const presets = presetsForKind(drag.kind)
    const sourceIndex = presets.findIndex((preset) => nonEmptyId(preset?.id) === drag.id)
    if (sourceIndex < 0) return

    const targetIndex =
      targetPresetId === undefined
        ? presets.length
        : presets.findIndex((preset) => nonEmptyId(preset?.id) === targetPresetId)
    if (targetIndex < 0) return

    movePreset(drag.kind, sourceIndex, targetIndex)
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

  async function removeModernPreset(index: number, preset: ModernPreset) {
    const list = modernPresets
    if (list.length <= 1) {
      alertError(language.errors.onlyOneChat)
      return
    }
    const targetKind = kind
    const presetId = nonEmptyId(preset?.id)
    if (!(await alertConfirm(`${language.removeConfirm}${preset.name ?? ''}`))) return

    const currentPresets = targetKind === 'prompt' ? getDatabase().promptPresets : getDatabase().modelPresets
    if (currentPresets.length <= 1) return
    const liveIndex = presetId ? currentPresets.findIndex((candidate) => candidate?.id === presetId) : index
    if (liveIndex < 0 || (!presetId && currentPresets[liveIndex] !== preset)) return

    const key = `${targetKind}:${presetId ?? `index:${liveIndex}`}`
    const outcome = targetKind === 'prompt' ? deletePromptPreset(liveIndex, 0) : deleteModelPreset(liveIndex, 0)
    observePresetRowMutation(key, outcome)
  }

  function extractLegacy(index: number, mode: 'all' | 'model' | 'prompt') {
    extractLegacyBotPresetByIndex(index, mode)
    if (legacyPresets.length <= 1) close()
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!selectionPendingKey) close()
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !selectionPendingKey) close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center"
  onclick={handleBackdropClick}>
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
      <div class="grow flex justify-end">
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
        {#each legacyPresets as preset, i}
          <div class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 gap-2">
            <div class="flex-1 min-w-0">
              <span class="truncate">{preset.name ?? 'Legacy preset'}</span>
            </div>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer"
              aria-label={`${language.extractModelAndPrompt}: ${preset.name ?? `#${i + 1}`}`}
              title={language.extractModelAndPrompt}
              onclick={() => extractLegacy(i, 'all')}>
              <WandSparklesIcon size={18} />
            </button>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer text-sm"
              onclick={() => extractLegacy(i, 'model')}>
              {language.extractModelOnly}
            </button>
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer text-sm"
              onclick={() => extractLegacy(i, 'prompt')}>
              {language.extractPromptOnly}
            </button>
          </div>
        {/each}
      {/if}
    {:else if useModelPresetManager}
      <ModelPresetList embedded afterApply={close} />
    {:else}
      {#each modernPresets as preset, i}
        <div
          class="w-full transition-all duration-200"
          class:h-0.5={!isDragging || dragOverIndex !== i}
          class:h-1={isDragging && dragOverIndex === i}
          class:bg-blue-500={isDragging && dragOverIndex === i}
          class:shadow-lg={isDragging && dragOverIndex === i}
          class:hover:bg-gray-600={!isDragging}
          role="listitem"
          ondragover={(e) => {
            e.preventDefault()
            dragOverIndex = i
          }}
          ondragleave={() => {
            dragOverIndex = -1
          }}
          ondrop={(e) => {
            handlePresetDrop(nonEmptyId(preset?.id), e)
            dragOverIndex = -1
          }}>
        </div>

        <!-- The native select button owns keyboard activation; this handler keeps the full row as the pointer target. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
          class:bg-selected={isPresetSelected(preset, i)}
          class:draggable-preset={!editMode}
          data-risu-generation-picker-row
          data-risu-picker-kind={kind}
          data-risu-picker-mode={mode}
          data-risu-row-id={nonEmptyId(preset?.id) ?? ''}
          data-risu-row-index={i}
          data-risu-selected={isPresetSelected(preset, i) ? 'true' : 'false'}
          draggable={!editMode ? 'true' : 'false'}
          onclick={() => {
            if (!editMode) selectPreset(preset, i)
          }}
          ondragstart={(e) => {
            if (editMode) {
              e.preventDefault()
              return
            }
            const presetId = nonEmptyId(preset?.id)
            if (!presetId) {
              e.preventDefault()
              return
            }
            const presetKind: ModernPresetKind = kind === 'prompt' ? 'prompt' : 'model'
            isDragging = true
            draggedPreset = { kind: presetKind, id: presetId }
            e.dataTransfer?.setData('text', 'preset')
            e.dataTransfer?.setData('presetId', presetId)
            e.dataTransfer?.setData('application/x-risu-internal', 'true')
          }}
          ondragend={() => {
            isDragging = false
            dragOverIndex = -1
            draggedPreset = null
          }}
          ondragover={(e) => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            dragOverIndex = e.clientY < rect.top + rect.height / 2 ? i : i + 1
          }}
          ondrop={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const dropIndex = e.clientY < rect.top + rect.height / 2 ? i : i + 1
            const targetPresetId =
              dropIndex >= modernPresets.length ? undefined : nonEmptyId(modernPresets[dropIndex]?.id)
            handlePresetDrop(targetPresetId, e)
            dragOverIndex = -1
          }}>
          {#if editMode}
            <div class="min-w-0 grow">
              <TextInput
                bind:value={() => presetName(preset), (value) => updatePresetName(preset, i, value)}
                ariaLabel={`${language.edit}: ${preset.name ?? `#${i + 1}`}`}
                placeholder="string"
                padding={false} />
              {#if renameErrors[presetDraftKey(preset, i)]}
                <span data-risu-preset-rename-status role="alert" class="block text-xs text-draculared">
                  {renameErrors[presetDraftKey(preset, i)]}
                </span>
              {/if}
            </div>
          {:else}
            <button
              type="button"
              data-risu-picker-select
              class="flex min-w-0 grow items-center text-left"
              disabled={!!selectionPendingKey}
              aria-pressed={isPresetSelected(preset, i)}
              aria-current={isPresetSelected(preset, i) ? 'true' : undefined}
              onclick={(event) => {
                event.stopPropagation()
                selectPreset(preset, i)
              }}>
              {#if i < 9}
                <span class="w-2 text-center mr-2 text-textcolor2">{i + 1}</span>
              {/if}
              <span>{preset.name}</span>
            </button>
          {/if}
          <div class="ml-auto flex shrink-0 justify-end">
            {#if kind === 'prompt'}
              <button
                class="text-textcolor2 hover:text-green-500 cursor-pointer mr-2"
                aria-label={`${language.export}: ${preset.name ?? `#${i + 1}`}`}
                onclick={async (e) => {
                  e.stopPropagation()
                  await downloadPreset(i, 'risupreset')
                }}>
                <Share2Icon size={18} />
              </button>
            {/if}
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer"
              aria-label={`${language.remove}: ${preset.name ?? `#${i + 1}`}`}
              onclick={(e) => {
                e.stopPropagation()
                removeModernPreset(i, preset)
              }}>
              <TrashIcon size={18} />
            </button>
          </div>
        </div>
        {#if rowMutationErrors[presetDraftKey(preset, i)]}
          <span data-risu-preset-row-mutation-status role="alert" class="block px-2 text-xs text-draculared">
            {rowMutationErrors[presetDraftKey(preset, i)]}
          </span>
        {/if}
      {/each}

      <div
        class="w-full transition-all duration-200"
        class:h-0.5={!isDragging || dragOverIndex !== modernPresets.length}
        class:h-1={isDragging && dragOverIndex === modernPresets.length}
        class:bg-blue-500={isDragging && dragOverIndex === modernPresets.length}
        class:shadow-lg={isDragging && dragOverIndex === modernPresets.length}
        role="listitem"
        ondragover={(e) => {
          e.preventDefault()
          dragOverIndex = modernPresets.length
        }}
        ondragleave={() => {
          dragOverIndex = -1
        }}
        ondrop={(e) => {
          handlePresetDrop(undefined, e)
          dragOverIndex = -1
        }}>
      </div>

      <div class="flex mt-2 items-center">
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

  .draggable-preset:hover {
    cursor: grab;
  }

  .draggable-preset:active {
    cursor: grabbing;
  }

  .h-0\.5 {
    min-height: 2px;
    height: 2px;
  }

  .h-1 {
    min-height: 4px;
    height: 4px;
  }
</style>
