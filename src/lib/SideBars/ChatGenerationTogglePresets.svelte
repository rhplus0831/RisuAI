<script lang="ts">
  import { language } from 'src/lang'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
  import {
    compareChatGenerationTogglePresetToActiveState,
    getChatGenerationTogglePresets,
  } from 'src/ts/chatGenerationTogglePresets'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import {
    chatGenerationTogglePresetListModalStore,
    openChatGenerationTogglePresetListModal,
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )
  let loadedPresetId = $derived(activeGenerationSettings.settings?.togglePresetId?.trim() ?? '')
  let loadedPreset = $derived.by(() => getChatGenerationTogglePresets().find((preset) => preset.id === loadedPresetId))
  let comparison = $derived.by(() =>
    loadedPreset ? compareChatGenerationTogglePresetToActiveState(loadedPreset, activeGenerationSettings) : null,
  )
  let state = $derived.by(() => {
    if (!loadedPresetId) return 'unused' as const
    if (!loadedPreset) return 'unlinked' as const
    if (comparison?.hasToggleTypeMismatch) return 'mismatch' as const
    if (comparison?.hasAnyDifference) return 'edited' as const
    return 'matched' as const
  })
  let label = $derived.by(() => {
    if (state === 'unused') return language.chatGenerationTogglePresetUnused
    if (state === 'unlinked') return language.chatGenerationTogglePresetUnlinked
    if (state === 'mismatch') return language.chatGenerationTogglePresetMismatch
    if (state === 'edited') return language.chatGenerationTogglePresetEdited(loadedPreset?.name ?? '')
    return loadedPreset?.name ?? language.chatGenerationTogglePresetUnused
  })
  let persistenceStatus = $derived(
    (activeGenerationSettings.identity.chatId &&
      chatGenerationTogglePresetListModalStore.saveStates[activeGenerationSettings.identity.chatId]?.status) ||
      'idle',
  )
</script>

<div
  class="w-full mt-2"
  data-risu-generation-toggle-presets
  data-risu-toggle-preset-state={state}
  data-risu-persistence-status={persistenceStatus}>
  <Button
    className="flex w-full min-w-0 justify-start text-left"
    disabled={!activeGenerationSettings.identity.chatId}
    onclick={() => openChatGenerationTogglePresetListModal(captureActiveChatTarget())}>
    <span class="truncate" data-risu-generation-toggle-preset-label>{label}</span>
  </Button>
</div>
