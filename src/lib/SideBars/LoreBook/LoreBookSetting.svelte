<script lang="ts">
  import { DBState } from 'src/ts/stores.svelte'
  import { language } from '../../../lang'
  import {
    DownloadIcon,
    HardDriveUploadIcon,
    PlusIcon,
    SunIcon,
    LinkIcon,
    FolderPlusIcon,
  } from '@lucide/svelte'
  import {
    addLorebook,
    addLorebookFolder,
    exportLoreBook,
    importLoreBook,
  } from '../../../ts/process/lorebook.svelte'
  import Check from '../../UI/GUI/CheckInput.svelte'
  import NumberInput from '../../UI/GUI/NumberInput.svelte'
  import LoreBookList from './LoreBookList.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import { watchServerBackedLorebooks } from 'src/ts/server/lorebookBridge.svelte'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import { createServerBackedCharacterDraft } from 'src/ts/server/characterBridge.svelte'
  import type { loreBook } from 'src/ts/storage/database.svelte'

  let submenu = $state(0)
  const characterLoreSettingsDraft = createServerBackedCharacterDraft(['loreSettings', 'lorePlus'])
  let characterLoreDraft = $state<loreBook[]>([])
  let chatLoreDraft = $state<loreBook[]>([])
  let loreDraftKey = ''
  let loreDraftSnapshot = ''
  let suppressLoreDraftDispatch = false
  interface Props {
    globalMode?: boolean
  }

  let { globalMode = $bindable(false) }: Props = $props()

  $effect(() => {
    const stopLorebooks = watchServerBackedLorebooks()
    return () => stopLorebooks()
  })

  $effect(() => {
    const character = DBState.db.characters?.[$selectedCharID]
    const chat = character?.chats?.[character.chatPage]
    const key = `${character?.chaId ?? ''}:${chat?.id ?? ''}`
    const snapshot = snapshotJson({
      key,
      characterLore: character?.globalLore ?? [],
      chatLore: chat?.localLore ?? [],
    })

    if (key !== loreDraftKey || snapshot !== loreDraftSnapshot) {
      suppressLoreDraftDispatch = true
      loreDraftKey = key
      characterLoreDraft = cloneJsonValue(character?.globalLore ?? [])
      chatLoreDraft = cloneJsonValue(chat?.localLore ?? [])
      loreDraftSnapshot = snapshot
      queueMicrotask(() => {
        suppressLoreDraftDispatch = false
      })
    }
  })

  $effect(() => {
    const character = DBState.db.characters?.[$selectedCharID]
    const chat = character?.chats?.[character.chatPage]
    const key = `${character?.chaId ?? ''}:${chat?.id ?? ''}`
    const snapshot = snapshotJson({
      key,
      characterLore: characterLoreDraft,
      chatLore: chatLoreDraft,
    })

    if (suppressLoreDraftDispatch || !character || !chat || snapshot === loreDraftSnapshot) return

    withTrustedServerProjectionWrite(() => {
      // Re-read live references inside the trusted scope; the captured
      // `character`/`chat` are read-only server-projection proxies in Fastify mode.
      const liveCharacter = DBState.db.characters?.[$selectedCharID]
      const liveChat = liveCharacter?.chats?.[liveCharacter.chatPage]
      if (liveCharacter) liveCharacter.globalLore = cloneJsonValue(characterLoreDraft)
      if (liveChat) liveChat.localLore = cloneJsonValue(chatLoreDraft)
    })
    loreDraftSnapshot = snapshot
  })

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function isAllCharacterLoreAlwaysActive() {
    const globalLore = characterLoreDraft
    return globalLore && globalLore.every((book) => book.alwaysActive)
  }

  function isAllChatLoreAlwaysActive() {
    const localLore = chatLoreDraft
    return localLore && localLore.every((book) => book.alwaysActive)
  }

  function toggleCharacterLoreAlwaysActive() {
    const globalLore = characterLoreDraft

    if (!globalLore) return

    const allActive = globalLore.every((book) => book.alwaysActive)

    globalLore.forEach((book) => {
      book.alwaysActive = !allActive
    })
    characterLoreDraft = [...globalLore]
  }

  function toggleChatLoreAlwaysActive() {
    const localLore = chatLoreDraft

    if (!localLore) return

    const allActive = localLore.every((book) => book.alwaysActive)

    localLore.forEach((book) => {
      book.alwaysActive = !allActive
    })
    chatLoreDraft = [...localLore]
  }
</script>

{#if !globalMode}
  <div class="flex w-full rounded-md border border-selected">
    <button
      onclick={() => {
        submenu = 0
      }}
      class="p-2 flex-1"
      class:bg-selected={submenu === 0}
    >
      <span>{language.character}</span>
    </button>
    <button
      onclick={() => {
        submenu = 1
      }}
      class="p2 flex-1 border-r border-l border-selected"
      class:bg-selected={submenu === 1}
    >
      <span>{language.Chat}</span>
    </button>
    <button
      onclick={() => {
        submenu = 2
      }}
      class="p-2 flex-1"
      class:bg-selected={submenu === 2}
    >
      <span>{language.settings}</span>
    </button>
  </div>
{/if}
{#if submenu !== 2}
  {#if !globalMode}
    <span class="text-textcolor2 mt-2 mb-6 text-sm"
      >{submenu === 0 ? language.globalLoreInfo : language.localLoreInfo}</span
    >
  {/if}
  {#if !globalMode && submenu === 0}
    <LoreBookList
      {globalMode}
      {submenu}
      lorePlus={DBState.db.characters[$selectedCharID]?.lorePlus}
      bind:externalLoreBooks={characterLoreDraft}
    />
  {:else if !globalMode && submenu === 1}
    <LoreBookList
      {globalMode}
      {submenu}
      lorePlus={DBState.db.characters[$selectedCharID]?.lorePlus}
      bind:externalLoreBooks={chatLoreDraft}
    />
  {:else}
    <LoreBookList
      {globalMode}
      {submenu}
      lorePlus={!globalMode && DBState.db.characters[$selectedCharID]?.lorePlus}
    />
  {/if}
{:else}
  {#if characterLoreSettingsDraft.value.loreSettings}
    <div class="flex items-center mt-4">
      <Check
        check={false}
        onChange={() => {
          characterLoreSettingsDraft.value.loreSettings = undefined
          characterLoreSettingsDraft.value = { ...characterLoreSettingsDraft.value }
        }}
        name={language.useGlobalSettings}
      />
    </div>
    <div class="flex items-center mt-4">
      <Check
        bind:check={characterLoreSettingsDraft.value.loreSettings.recursiveScanning}
        name={language.recursiveScanning}
      />
    </div>
    <div class="flex items-center mt-4">
      <Check
        bind:check={characterLoreSettingsDraft.value.loreSettings.fullWordMatching}
        name={language.fullWordMatching}
      />
    </div>
    <span class="text-textcolor mt-4 mb-2">{language.loreBookDepth}</span>
    <NumberInput
      size="sm"
      min={0}
      max={20}
      bind:value={characterLoreSettingsDraft.value.loreSettings.scanDepth}
    />
    <span class="text-textcolor">{language.loreBookToken}</span>
    <NumberInput
      size="sm"
      min={0}
      max={4096}
      bind:value={characterLoreSettingsDraft.value.loreSettings.tokenBudget}
    />
  {:else}
    <div class="flex items-center mt-4">
      <Check
        check={true}
        onChange={() => {
          characterLoreSettingsDraft.value.loreSettings = {
            tokenBudget: DBState.db.loreBookToken,
            scanDepth: DBState.db.loreBookDepth,
            recursiveScanning: false,
          }
          characterLoreSettingsDraft.value = { ...characterLoreSettingsDraft.value }
        }}
        name={language.useGlobalSettings}
      />
    </div>
  {/if}
  <div class="flex items-center mt-4">
    {#if DBState.db.useExperimental}
      <Check bind:check={characterLoreSettingsDraft.value.lorePlus} name={language.lorePlus}
        ><Help key="lorePlus"></Help><Help key="experimental"></Help></Check
      >
    {/if}
  </div>
{/if}
{#if submenu !== 2}
  <div class="text-textcolor2 mt-2 flex">
    <button
      onclick={() => {
        addLorebook(globalMode ? -1 : submenu)
      }}
      class="hover:text-textcolor cursor-pointer"
    >
      <PlusIcon />
    </button>
    <button
      onclick={() => {
        exportLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
      }}
      class="hover:text-textcolor ml-1 cursor-pointer"
    >
      <DownloadIcon />
    </button>
    <button
      onclick={() => {
        addLorebookFolder(globalMode ? -1 : submenu)
      }}
      class="hover:text-textcolor ml-2 cursor-pointer"
    >
      <FolderPlusIcon />
    </button>
    <button
      onclick={() => {
        importLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
      }}
      class="hover:text-textcolor ml-2 cursor-pointer"
    >
      <HardDriveUploadIcon />
    </button>
    {#if DBState.db.bulkEnabling}
      <button
        onclick={() => {
          toggleCharacterLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1"
      >
        {#if isAllCharacterLoreAlwaysActive()}
          <SunIcon />
        {:else}
          <LinkIcon />
        {/if}
        <span class="text-xs">CHAR</span>
      </button>
      <button
        onclick={() => {
          toggleChatLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1"
      >
        {#if isAllChatLoreAlwaysActive()}
          <SunIcon />
        {:else}
          <LinkIcon />
        {/if}
        <span class="text-xs">CHAT</span>
      </button>
    {/if}
  </div>
{/if}
