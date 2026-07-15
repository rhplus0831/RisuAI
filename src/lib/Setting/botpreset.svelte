<script lang="ts">
  import { alertConfirm, alertError } from '../../ts/alert'
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
    saveActiveChatGenerationSettingsSelection,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import { onDestroy } from 'svelte'
  import ModelPresetList from './Pages/Model/ModelPresetList.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  type ModernPreset = ModelPreset | PromptPreset
  type PendingRenameTarget = {
    kind: 'model' | 'prompt'
    presetId: string | null
    index: number
  }

  let editMode = $state(false)
  let isDragging = $state(false)
  let dragOverIndex = $state(-1)
  let renameDrafts = $state<Record<string, string>>({})
  const pendingRenameTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingRenameTargets = new Map<string, PendingRenameTarget>()
  const RENAME_DEBOUNCE_MS = 250

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

  function presetNameDraft(preset: ModernPreset | undefined, index: number) {
    const key = presetDraftKey(preset, index)
    if (Object.prototype.hasOwnProperty.call(renameDrafts, key)) return renameDrafts[key]
    return preset?.name ?? ''
  }

  function updatePresetNameDraft(preset: ModernPreset | undefined, index: number, name: string) {
    const key = presetDraftKey(preset, index)
    renameDrafts[key] = name
    schedulePresetRename(key, {
      kind: kind === 'prompt' ? 'prompt' : 'model',
      presetId: nonEmptyId(preset?.id),
      index,
    })
  }

  function schedulePresetRename(key: string, target: PendingRenameTarget) {
    const existing = pendingRenameTimers.get(key)
    if (existing) clearTimeout(existing)
    pendingRenameTargets.set(key, target)
    pendingRenameTimers.set(
      key,
      setTimeout(() => {
        pendingRenameTimers.delete(key)
        commitPendingRename(key)
      }, RENAME_DEBOUNCE_MS),
    )
  }

  function commitPendingRename(key: string) {
    const target = pendingRenameTargets.get(key)
    pendingRenameTargets.delete(key)
    if (!target) return

    const presets = target.kind === 'prompt' ? getDatabase().promptPresets : getDatabase().modelPresets
    const index = target.presetId ? presets.findIndex((preset) => preset?.id === target.presetId) : target.index
    const preset = presets[index]
    if (!preset) return

    const name = renameDrafts[key] ?? ''
    if ((preset.name ?? '') === name) return
    if (target.kind === 'prompt') updatePromptPreset(index, { name })
    else updateModelPreset(index, { name })
  }

  function flushPendingRenames() {
    for (const timer of pendingRenameTimers.values()) {
      clearTimeout(timer)
    }
    pendingRenameTimers.clear()
    for (const key of Array.from(pendingRenameTargets.keys())) {
      commitPendingRename(key)
    }
  }

  function clearRenameDrafts() {
    renameDrafts = {}
  }

  function toggleEditMode() {
    if (editMode) {
      flushPendingRenames()
      clearRenameDrafts()
      editMode = false
      return
    }
    clearRenameDrafts()
    editMode = true
  }

  function selectPreset(preset: ModernPreset | undefined, index: number) {
    if (editMode) return
    if (isChatGenerationSelectionMode) {
      const presetId = nonEmptyId(preset?.id)
      if (!presetId) return
      const patch = kind === 'prompt' ? { promptPresetId: presetId } : { modelPresetId: presetId }
      if (saveActiveChatGenerationSettingsSelection(patch, { expectedTarget: target })) close()
      return
    }

    if (kind === 'prompt') selectPromptPreset(index)
    else selectModelPreset(index)
    close()
  }

  function isPresetSelected(preset: ModernPreset | undefined, index: number) {
    if (!isChatGenerationSelectionMode) return index === selectedIndex()
    const presetId = nonEmptyId(preset?.id)
    return !!presetId && presetId === activeSelectedId
  }

  function movePreset(fromIndex: number, toIndex: number) {
    if (kind === 'prompt') reorderPromptPresets(fromIndex, toIndex)
    else if (kind === 'model') reorderModelPresets(fromIndex, toIndex)
  }

  function handlePresetDrop(targetIndex: number, e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const data = e.dataTransfer?.getData('text')
    if (data === 'preset') {
      const sourceIndex = parseInt(e.dataTransfer?.getData('presetIndex') || '0')
      movePreset(sourceIndex, targetIndex)
    }
  }

  function createNewPreset() {
    const preset = safeStructuredClone(prebuiltPresets.OAI2)
    if (kind === 'prompt') {
      preset.name = 'New Prompt Preset'
      createPromptPreset(preset)
    } else {
      preset.name = 'New Model Preset'
      createModelPreset(preset)
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

    if (targetKind === 'prompt') deletePromptPreset(liveIndex, 0)
    else deleteModelPreset(liveIndex, 0)
  }

  function extractLegacy(index: number, mode: 'all' | 'model' | 'prompt') {
    extractLegacyBotPresetByIndex(index, mode)
    if (legacyPresets.length <= 1) close()
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) close()
  }

  onDestroy(() => {
    flushPendingRenames()
  })
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
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={close}>
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
            handlePresetDrop(i, e)
            dragOverIndex = -1
          }}>
        </div>

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
          ondragstart={(e) => {
            if (editMode) {
              e.preventDefault()
              return
            }
            isDragging = true
            e.dataTransfer?.setData('text', 'preset')
            e.dataTransfer?.setData('presetIndex', i.toString())
          }}
          ondragend={() => {
            isDragging = false
            dragOverIndex = -1
          }}
          ondragover={(e) => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            dragOverIndex = e.clientY < rect.top + rect.height / 2 ? i : i + 1
          }}>
          {#if editMode}
            <TextInput
              bind:value={() => presetNameDraft(preset, i), (value) => updatePresetNameDraft(preset, i, value)}
              ariaLabel={`${language.edit}: ${preset.name ?? `#${i + 1}`}`}
              placeholder="string"
              padding={false} />
          {:else}
            <button
              type="button"
              data-risu-picker-select
              class="flex min-w-0 grow items-center text-left"
              aria-pressed={isPresetSelected(preset, i)}
              aria-current={isPresetSelected(preset, i) ? 'true' : undefined}
              onclick={() => {
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
          handlePresetDrop(modernPresets.length, e)
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
