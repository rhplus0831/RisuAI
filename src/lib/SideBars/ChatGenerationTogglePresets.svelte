<script lang="ts">
  import { SaveIcon, TrashIcon, UploadIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertConfirm, alertInput, alertSelect } from 'src/ts/alert'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
  import {
    applyChatGenerationTogglePreset,
    compareChatGenerationTogglePresetToActiveState,
    deleteChatGenerationTogglePreset,
    getChatGenerationTogglePresets,
    overwriteCurrentChatGenerationTogglePreset,
    saveCurrentChatGenerationTogglePreset,
  } from 'src/ts/chatGenerationTogglePresets'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'

  interface Props {
    selectedPresetId?: string
  }

  let { selectedPresetId = $bindable('') }: Props = $props()

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )
  let presets = $derived.by(() => getChatGenerationTogglePresets())
  let selectedPreset = $derived.by(() => presets.find((preset) => preset.id === selectedPresetId))
  let selectedPresetComparison = $derived.by(() =>
    selectedPreset ? compareChatGenerationTogglePresetToActiveState(selectedPreset, activeGenerationSettings) : null,
  )
  let saveDisabled = $derived.by(() => {
    if (!activeGenerationSettings.identity.chatId) return true
    if (!selectedPreset) return false
    return (
      selectedPresetComparison?.hasToggleTypeMismatch === true || selectedPresetComparison?.hasAnyDifference !== true
    )
  })
  let applyDisabled = $derived.by(
    () =>
      !activeGenerationSettings.identity.chatId ||
      !selectedPreset ||
      selectedPresetComparison?.hasAnyDifference !== true,
  )
  let showToggleTypeWarning = $derived.by(
    () => !!selectedPreset && selectedPresetComparison?.hasToggleTypeMismatch === true,
  )

  $effect(() => {
    if (!selectedPresetId || presets.some((preset) => preset.id === selectedPresetId)) return
    selectedPresetId = presets[0]?.id ?? ''
  })

  async function savePreset(): Promise<void> {
    const existingPreset = selectedPreset
    const target = captureActiveChatTarget()
    if (existingPreset) {
      const selectedAction = await alertSelect(
        [language.chatGenerationTogglePresetOverwrite, language.chatGenerationTogglePresetCreateNew],
        language.chatGenerationTogglePresetSaveChoice(existingPreset.name),
      )
      if (selectedAction === null) return
      const selection = Number(selectedAction)
      if (selection === 0) {
        const overwrittenPreset = overwriteCurrentChatGenerationTogglePreset(existingPreset.id, {
          expectedTarget: target,
        })
        if (overwrittenPreset) {
          selectedPresetId = overwrittenPreset.id
        }
        return
      }
      if (selection !== 1) return
    }

    const name = await alertInput(language.chatGenerationTogglePresetNamePrompt)
    if (typeof name !== 'string' || name.trim().length === 0) return
    const preset = saveCurrentChatGenerationTogglePreset(name, { expectedTarget: target })
    if (preset) {
      selectedPresetId = preset.id
    }
  }

  async function applyPreset(): Promise<void> {
    const presetId = selectedPreset?.id
    const target = captureActiveChatTarget()
    if (!presetId) return
    if (!(await alertConfirm(language.chatGenerationTogglePresetApplyConfirm))) return
    applyChatGenerationTogglePreset(presetId, { expectedTarget: target })
  }

  async function deletePreset(): Promise<void> {
    const preset = selectedPreset
    if (!preset) return
    if (!(await alertConfirm(language.chatGenerationTogglePresetDeleteConfirm(preset.name)))) return
    deleteChatGenerationTogglePreset(preset.id)
  }
</script>

<div class="w-full mt-2 flex flex-col gap-1" data-risu-generation-toggle-presets>
  <SelectInput
    size="sm"
    className="w-full min-w-0"
    bind:value={selectedPresetId}
    onchange={(event) => {
      selectedPresetId = event.currentTarget.value
    }}>
    <OptionInput value="">{language.chatGenerationTogglePresetSelect}</OptionInput>
    {#each presets as preset}
      <OptionInput value={preset.id}>{preset.name}</OptionInput>
    {/each}
  </SelectInput>

  <div class="grid grid-cols-3 gap-1">
    <Button size="sm" className="min-w-0" onclick={savePreset} disabled={saveDisabled}>
      <span class="flex items-center justify-center gap-1 min-w-0">
        <SaveIcon size={14} />
        <span class="truncate">{language.chatGenerationTogglePresetSave}</span>
      </span>
    </Button>
    <Button size="sm" className="min-w-0" onclick={applyPreset} disabled={applyDisabled}>
      <span class="flex items-center justify-center gap-1 min-w-0">
        <UploadIcon size={14} />
        <span class="truncate">{language.chatGenerationTogglePresetApply}</span>
      </span>
    </Button>
    <Button size="sm" styled="danger" className="min-w-0" onclick={deletePreset} disabled={!selectedPresetId}>
      <span class="flex items-center justify-center gap-1 min-w-0">
        <TrashIcon size={14} />
        <span class="truncate">{language.chatGenerationTogglePresetDelete}</span>
      </span>
    </Button>
  </div>
  {#if showToggleTypeWarning}
    <div class="text-draculared text-xs" data-risu-generation-toggle-preset-warning>
      {language.chatGenerationTogglePresetTypeMismatchWarning}
    </div>
  {/if}
</div>
