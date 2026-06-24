<script lang="ts">
  import { openPersonaListModal, openPresetListModal, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import Button from '../UI/GUI/Button.svelte'

  type NamedGenerationReference = {
    name?: string
    note?: string
  }

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let modelPresetName = $derived.by(
    () =>
      (activeGenerationSettings.modelPreset as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationModelPresetUnconfigured,
  )

  let promptPresetName = $derived.by(
    () =>
      (activeGenerationSettings.promptPreset as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPromptPresetUnconfigured,
  )

  let personaName = $derived.by(
    () =>
      (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPersonaUnconfigured,
  )

  let personaNote = $derived.by(() => {
    const note = (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.note
    return typeof note === 'string' && note.trim().length > 0 ? note : ''
  })
</script>

<div
  class="rounded-sm flex flex-col w-full gap-2"
  data-risu-generation-settings-picker-controls
  data-risu-picker-mode="active-chat-generation-settings">
  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="model"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.modelPresetId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPresetListModal('active-chat-generation-settings', 'model', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{modelPresetName}</span>
      </div>
    </Button>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="prompt"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.promptPresetId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPresetListModal('active-chat-generation-settings', 'prompt', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{promptPresetName}</span>
      </div>
    </Button>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="persona"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.personaId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPersonaListModal('active-chat-generation-settings', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{personaName}</span>
      </div>
    </Button>
    {#if personaNote}
      <span class="mt-1 text-sm opacity-75 whitespace-pre-wrap break-words" data-risu-generation-picker-persona-note
        >{personaNote}</span>
    {/if}
  </div>
</div>
