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
  import {
    DBState,
    selectedCharID,
    type GenerationSettingsPickerMode,
    type PresetPickerKind,
  } from 'src/ts/stores.svelte'
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

  type ModernPreset = ModelPreset | PromptPreset

  let editMode = $state(false)
  let isDragging = $state(false)
  let dragOverIndex = $state(-1)

  interface Props {
    close?: () => void
    mode?: GenerationSettingsPickerMode
    kind?: PresetPickerKind
  }

  let { close = () => {}, mode = 'global', kind = 'model' }: Props = $props()

  let isChatGenerationSelectionMode = $derived(mode === 'active-chat-generation-settings')
  let title = $derived(
    kind === 'model' ? language.modelPresets : kind === 'prompt' ? language.promptPresets : language.legacyBotPresets,
  )
  let modernPresets = $derived.by(() => (kind === 'prompt' ? DBState.db.promptPresets : DBState.db.modelPresets))
  let legacyPresets = $derived.by(() => (Array.isArray(DBState.db.botPresets) ? DBState.db.botPresets : []))
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
    return kind === 'prompt' ? DBState.db.promptPresetsId : DBState.db.modelPresetsId
  }

  function renamePreset(index: number, name: string) {
    if (kind === 'prompt') updatePromptPreset(index, { name })
    else if (kind === 'model') updateModelPreset(index, { name })
  }

  function selectPreset(preset: ModernPreset | undefined, index: number) {
    if (editMode) return
    if (isChatGenerationSelectionMode) {
      const presetId = nonEmptyId(preset?.id)
      if (!presetId) return
      const patch = kind === 'prompt' ? { promptPresetId: presetId } : { modelPresetId: presetId }
      if (saveActiveChatGenerationSettingsSelection(patch)) close()
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
    if (!(await alertConfirm(`${language.removeConfirm}${preset.name ?? ''}`))) return
    if (kind === 'prompt') deletePromptPreset(index, 0)
    else deleteModelPreset(index, 0)
  }

  function extractLegacy(index: number, mode: 'all' | 'model' | 'prompt') {
    extractLegacyBotPresetByIndex(index, mode)
    if (legacyPresets.length <= 1) close()
  }
</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
  <div
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-124 max-h-full overflow-y-auto"
    data-risu-generation-picker
    data-risu-picker-kind={kind}
    data-risu-picker-mode={mode}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="mt-0 mb-0">{title}</h2>
      <div class="grow flex justify-end">
        <button class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center" onclick={close}>
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
          role="button"
          tabindex="0"
          onclick={() => {
            selectPreset(preset, i)
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              selectPreset(preset, i)
            }
          }}
          class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
          class:bg-selected={isPresetSelected(preset, i)}
          class:draggable-preset={!editMode}
          data-risu-generation-picker-row
          data-risu-picker-kind={kind}
          data-risu-picker-mode={mode}
          data-risu-row-id={nonEmptyId(preset?.id) ?? ''}
          data-risu-row-index={i}
          data-risu-selected={isPresetSelected(preset, i) ? 'true' : 'false'}
          aria-current={isPresetSelected(preset, i) ? 'true' : undefined}
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
              bind:value={() => modernPresets[i].name, (value) => renamePreset(i, value)}
              placeholder="string"
              padding={false} />
          {:else}
            {#if i < 9}
              <span class="w-2 text-center mr-2 text-textcolor2">{i + 1}</span>
            {/if}
            <span>{preset.name}</span>
          {/if}
          <div class="grow flex justify-end">
            {#if kind === 'prompt'}
              <button
                class="text-textcolor2 hover:text-green-500 cursor-pointer mr-2"
                onclick={async (e) => {
                  e.stopPropagation()
                  await downloadPreset(i, 'risupreset')
                }}>
                <Share2Icon size={18} />
              </button>
            {/if}
            <button
              class="text-textcolor2 hover:text-green-500 cursor-pointer"
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
        <button class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1" onclick={createNewPreset}>
          <PlusIcon />
        </button>
        {#if kind === 'prompt'}
          <button
            class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
            onclick={() => {
              importPreset()
            }}>
            <HardDriveUploadIcon size={18} />
          </button>
        {/if}
        <button
          class="text-textcolor2 hover:text-green-500 cursor-pointer"
          onclick={() => {
            editMode = !editMode
          }}>
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
