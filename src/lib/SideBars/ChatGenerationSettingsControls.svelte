<script lang="ts">
  import { PinIcon } from '@lucide/svelte'
  import {
    DBState,
    openPersonaListModal,
    openPresetListModal,
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
  import { checkPersonaBinded } from 'src/ts/util'
  import { currentChatStateSnapshot, dispatchUpdateChat } from 'src/ts/chatCommands'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import { v4 } from 'uuid'
  import Button from '../UI/GUI/Button.svelte'

  type NamedGenerationReference = {
    name?: string
  }

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let bindedPersona = $derived.by(() => {
    DBState.db.characters?.[$selectedCharID]?.chatPage
    return checkPersonaBinded()
  })

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

  function toggleBindedPersona(event: MouseEvent): void {
    event.stopPropagation()
    const previous = currentChatStateSnapshot()
    const chatIndex = DBState.db.characters[$selectedCharID].chatPage
    const chat = DBState.db.characters[$selectedCharID].chats[chatIndex]
    const persona = DBState.db.personas[DBState.db.selectedPersona]
    const nextBindedPersona = checkPersonaBinded() ? '' : (persona.id ?? v4())
    if (!canUseServerCommands()) {
      if (!persona.id) {
        persona.id = nextBindedPersona
      }
      chat.bindedPersona = nextBindedPersona
    }
    if (chat.id) {
      dispatchUpdateChat(chat.id, { bindedPersona: nextBindedPersona }, previous)
    }
  }
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
      onclick={() => {
        openPresetListModal('active-chat-generation-settings')
      }}>{presetName}</Button
    >
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="persona"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.personaId ?? ''}
  >
    <div class="flex gap-2">
      <Button
        className="flex flex-1 min-w-0"
        onclick={() => {
          openPersonaListModal('active-chat-generation-settings')
        }}
      >
        <div class="flex-1 flex-col flex text-left min-w-0">
          <span class="truncate">{personaName}</span>
        </div>
      </Button>
      <button
        class={{
          'px-3 py-2 border border-darkborderc rounded-md bg-darkbutton hover:bg-selected focus:outline-hidden focus:ring-2 focus:ring-selected transition-colors duration-200': true,
          'text-textcolor2': !bindedPersona,
          'text-textcolor': bindedPersona,
        }}
        onclick={toggleBindedPersona}
        data-risu-generation-picker-action="bind-persona"
        aria-pressed={!!bindedPersona}
      >
        <PinIcon size={20} />
      </button>
    </div>
  </div>
</div>
