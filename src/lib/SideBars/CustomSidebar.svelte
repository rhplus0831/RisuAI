<script lang="ts">
  import { Cog, PinIcon } from '@lucide/svelte'
  import {
    DBState,
    loadoutModalStore,
    openPersonaListModal,
    openPresetListModal,
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import type { CustomSideBarItem } from 'src/ts/storage/database.svelte'
  import { language } from 'src/lang'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { getFullSettingsData } from 'src/ts/setting/utils'
  import ModelList from '../UI/ModelList.svelte'
  import SettingRenderer from '../Setting/SettingRenderer.svelte'
  import { checkPersonaBinded } from 'src/ts/util'
  import { v4 } from 'uuid'
  import { currentChatStateSnapshot, dispatchUpdateChat } from 'src/ts/chatCommands'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'

  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')

  type NamedGenerationReference = {
    name?: string
  }

  let configPage: 'list' | 'add' | 'addSettingsSubmenu' = $state('list')
  let search = $state('')

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
</script>

<div class="rounded-sm flex flex-col w-full gap-2">
  {#each DBState.db.customSidebarItems as item}
    {#if item.type === 'model'}
      <ModelList bind:value={aiModelDraft.value} noMargin />
    {:else if item.type === 'preset'}
      <Button
        onclick={() => {
          openPresetListModal('active-chat-generation-settings')
        }}>{presetName}</Button
      >
    {:else if item.type === 'loadout'}
      <Button
        onclick={() => {
          loadoutModalStore.open = !loadoutModalStore.open
        }}>{DBState.db.lastLoadedLoadoutName || language.loadouts}</Button
      >
    {:else if item.type === 'persona'}
      <Button
        className="flex"
        onclick={() => {
          openPersonaListModal('active-chat-generation-settings')
        }}
      >
        <div class="flex-1 flex-col flex text-left">
          <span>{personaName}</span>
        </div>

        <button
          class={{
            'ml-2': true,
            'text-textcolor2': !bindedPersona,
            'text-textcolor': bindedPersona,
          }}
          onclick={(e) => {
            e.stopPropagation()
            const previous = currentChatStateSnapshot()
            const chatIndex = DBState.db.characters[$selectedCharID].chatPage
            const chat = DBState.db.characters[$selectedCharID].chats[chatIndex]
            const persona = DBState.db.personas[DBState.db.selectedPersona]
            const bindedPersona = checkPersonaBinded() ? '' : (persona.id ?? v4())
            if (!canUseServerCommands()) {
              if (!persona.id) {
                persona.id = bindedPersona
              }
              chat.bindedPersona = bindedPersona
            }
            if (chat.id) {
              dispatchUpdateChat(chat.id, { bindedPersona }, previous)
            }
          }}
        >
          <PinIcon size={20} />
        </button>
      </Button>
    {:else if item.type === 'setting'}
      <SettingRenderer items={[getFullSettingsData().find((s) => s.id === item.subType)]} />
    {/if}
  {/each}
</div>
