<script lang="ts">
  import { openPersonaListModal, openPresetListModal, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
  import Button from '../UI/GUI/Button.svelte'

  type NamedGenerationReference = {
    name?: string
  }

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let presetName = $derived.by(
    () =>
      (activeGenerationSettings.preset as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPresetUnconfigured,
  )

  let personaName = $derived.by(
    () =>
      (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPersonaUnconfigured,
  )
</script>

<div
  class="rounded-sm flex flex-col w-full gap-2"
  data-risu-generation-settings-picker-controls
  data-risu-picker-mode="active-chat-generation-settings"
>
  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="preset"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.presetId ?? ''}
  >
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPresetListModal('active-chat-generation-settings')
      }}
    >
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{presetName}</span>
      </div>
    </Button>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="persona"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.personaId ?? ''}
  >
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPersonaListModal('active-chat-generation-settings')
      }}
    >
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{personaName}</span>
      </div>
    </Button>
  </div>
</div>
