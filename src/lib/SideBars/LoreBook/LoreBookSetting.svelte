<script lang="ts">
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { language } from '../../../lang'
  import {
    DownloadIcon,
    HardDriveUploadIcon,
    PlusIcon,
    SunIcon,
    LinkIcon,
    FolderPlusIcon,
    RefreshCcwIcon,
  } from '@lucide/svelte'
  import { addLorebook, addLorebookFolder, exportLoreBook, importLoreBook } from '../../../ts/process/lorebook.svelte'
  import Check from '../../UI/GUI/CheckInput.svelte'
  import NumberInput from '../../UI/GUI/NumberInput.svelte'
  import LoreBookList from './LoreBookList.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import {
    replaceCharacterLorebookCollection,
    replaceChatLorebookCollection,
    watchServerBackedLorebooks,
    type LorebookWatchScope,
  } from 'src/ts/server/lorebookBridge.svelte'
  import { createServerBackedCharacterDraft } from 'src/ts/server/characterBridge.svelte'
  import {
    hasCharacterLorebookHydrationFailed,
    hydrateActiveCharacterLorebook,
    isCharacterLorebookHydrationPending,
  } from 'src/ts/server/chatMessageHydration.svelte'

  let submenu = $state(0)
  const characterLoreSettingsDraft = createServerBackedCharacterDraft(['loreSettings', 'lorePlus'])
  interface Props {
    globalMode?: boolean
  }

  let { globalMode = $bindable(false) }: Props = $props()
  let selectedCharacterId = $derived(globalMode ? undefined : getDatabase().characters?.[$selectedCharID]?.chaId)
  let characterLorebookLoading = $derived(
    !globalMode && submenu === 0 && isCharacterLorebookHydrationPending(selectedCharacterId),
  )
  let characterLorebookFailed = $derived(
    !globalMode && submenu === 0 && hasCharacterLorebookHydrationFailed(selectedCharacterId),
  )

  async function retryCharacterLorebookHydration() {
    await hydrateActiveCharacterLorebook({ force: true })
  }

  $effect(() => {
    // Global mode edits the global lorebook list; character mode edits the
    // selected character's globalLore and its chats' localLore. Scope change
    // detection to whichever this panel actually edits.
    const scope: LorebookWatchScope = globalMode ? { kind: 'global' } : { kind: 'character' }
    const stopLorebooks = watchServerBackedLorebooks({ scope })
    return () => stopLorebooks()
  })

  function isAllCharacterLoreAlwaysActive() {
    const globalLore = getDatabase().characters?.[$selectedCharID]?.globalLore
    return globalLore && globalLore.every((book) => book.alwaysActive)
  }

  function isAllChatLoreAlwaysActive() {
    const character = getDatabase().characters?.[$selectedCharID]
    const localLore = character?.chats?.[character.chatPage]?.localLore
    return localLore && localLore.every((book) => book.alwaysActive)
  }

  function toggleCharacterLoreAlwaysActive() {
    const character = getDatabase().characters?.[$selectedCharID]
    const globalLore = character?.globalLore

    if (!character?.chaId || !globalLore) return

    const allActive = globalLore.every((book) => book.alwaysActive)
    const nextLore = globalLore.map((book) => ({ ...book, alwaysActive: !allActive }))
    replaceCharacterLorebookCollection(character.chaId, nextLore)
  }

  function toggleChatLoreAlwaysActive() {
    const character = getDatabase().characters?.[$selectedCharID]
    const chat = character?.chats?.[character.chatPage]
    const localLore = chat?.localLore

    if (!chat?.id || !localLore) return

    const allActive = localLore.every((book) => book.alwaysActive)
    const nextLore = localLore.map((book) => ({ ...book, alwaysActive: !allActive }))
    replaceChatLorebookCollection(chat.id, nextLore)
  }
</script>

{#if !globalMode}
  <div class="flex w-full rounded-md border border-selected">
    <button
      aria-pressed={submenu === 0}
      onclick={() => {
        submenu = 0
      }}
      class="p-2 flex-1"
      class:bg-selected={submenu === 0}>
      <span>{language.character}</span>
    </button>
    <button
      aria-pressed={submenu === 1}
      onclick={() => {
        submenu = 1
      }}
      class="p-2 flex-1 border-r border-l border-selected"
      class:bg-selected={submenu === 1}>
      <span>{language.Chat}</span>
    </button>
    <button
      aria-pressed={submenu === 2}
      onclick={() => {
        submenu = 2
      }}
      class="p-2 flex-1"
      class:bg-selected={submenu === 2}>
      <span>{language.settings}</span>
    </button>
  </div>
{/if}
{#if submenu !== 2}
  {#if !globalMode}
    <span class="text-textcolor2 mt-2 mb-6 text-sm"
      >{submenu === 0 ? language.globalLoreInfo : language.localLoreInfo}</span>
  {/if}
  {#if characterLorebookLoading}
    <div
      class="flex min-h-28 items-center justify-center text-textcolor2"
      role="status"
      data-testid="character-lorebook-hydration-loading">
      <div class="flex flex-col items-center">
        <svg class="animate-spin h-6 w-6 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm">{language.loadingLorebookData}</span>
      </div>
    </div>
  {:else if characterLorebookFailed}
    <div
      class="flex min-h-28 items-center justify-center px-6 text-textcolor2"
      role="alert"
      data-testid="character-lorebook-hydration-error">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="text-sm">{language.lorebookDataLoadFailed}</span>
        <button
          type="button"
          class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor transition-colors hover:border-textcolor hover:bg-selected focus:border-textcolor focus:bg-selected"
          onclick={retryCharacterLorebookHydration}>
          <RefreshCcwIcon size={16} />
          <span>{language.retry}</span>
        </button>
      </div>
    </div>
  {:else if !globalMode && submenu === 0}
    <LoreBookList {globalMode} {submenu} lorePlus={getDatabase().characters[$selectedCharID]?.lorePlus} />
  {:else if !globalMode && submenu === 1}
    <LoreBookList {globalMode} {submenu} lorePlus={getDatabase().characters[$selectedCharID]?.lorePlus} />
  {:else}
    <LoreBookList
      {globalMode}
      {submenu}
      lorePlus={!globalMode && getDatabase().characters[$selectedCharID]?.lorePlus} />
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
        name={language.useGlobalSettings} />
    </div>
    <div class="flex items-center mt-4">
      <Check
        bind:check={characterLoreSettingsDraft.value.loreSettings.recursiveScanning}
        name={language.recursiveScanning} />
    </div>
    <div class="flex items-center mt-4">
      <Check
        bind:check={characterLoreSettingsDraft.value.loreSettings.fullWordMatching}
        name={language.fullWordMatching} />
    </div>
    <span class="text-textcolor mt-4 mb-2">{language.loreBookDepth}</span>
    <NumberInput size="sm" min={0} max={20} bind:value={characterLoreSettingsDraft.value.loreSettings.scanDepth} />
    <span class="text-textcolor">{language.loreBookToken}</span>
    <NumberInput size="sm" min={0} max={4096} bind:value={characterLoreSettingsDraft.value.loreSettings.tokenBudget} />
  {:else}
    <div class="flex items-center mt-4">
      <Check
        check={true}
        onChange={() => {
          characterLoreSettingsDraft.value.loreSettings = {
            tokenBudget: getDatabase().loreBookToken,
            scanDepth: getDatabase().loreBookDepth,
            recursiveScanning: false,
          }
          characterLoreSettingsDraft.value = { ...characterLoreSettingsDraft.value }
        }}
        name={language.useGlobalSettings} />
    </div>
  {/if}
  <div class="flex items-center mt-4">
    {#if getDatabase().useExperimental}
      <Check bind:check={characterLoreSettingsDraft.value.lorePlus} name={language.lorePlus}
        ><Help key="lorePlus"></Help><Help key="experimental"></Help></Check>
    {/if}
  </div>
{/if}
{#if submenu !== 2 && !characterLorebookLoading && !characterLorebookFailed}
  <div class="text-textcolor2 mt-2 flex">
    <button
      aria-label={`${language.add}: ${language.loreBook}`}
      onclick={() => {
        addLorebook(globalMode ? -1 : submenu)
      }}
      class="hover:text-textcolor cursor-pointer">
      <PlusIcon />
    </button>
    <button
      aria-label={`${language.export}: ${language.loreBook}`}
      onclick={() => {
        exportLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
      }}
      class="hover:text-textcolor ml-1 cursor-pointer">
      <DownloadIcon />
    </button>
    <button
      aria-label={`${language.add}: ${language.folderName}`}
      onclick={() => {
        addLorebookFolder(globalMode ? -1 : submenu)
      }}
      class="hover:text-textcolor ml-2 cursor-pointer">
      <FolderPlusIcon />
    </button>
    <button
      aria-label={`${language.import}: ${language.loreBook}`}
      onclick={() => {
        importLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
      }}
      class="hover:text-textcolor ml-2 cursor-pointer">
      <HardDriveUploadIcon />
    </button>
    {#if getDatabase().bulkEnabling}
      <button
        aria-label={`${isAllCharacterLoreAlwaysActive() ? language.disable : language.enable}: ${language.alwaysActive} (${language.character})`}
        aria-pressed={Boolean(isAllCharacterLoreAlwaysActive())}
        onclick={() => {
          toggleCharacterLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1">
        {#if isAllCharacterLoreAlwaysActive()}
          <SunIcon />
        {:else}
          <LinkIcon />
        {/if}
        <span class="text-xs">CHAR</span>
      </button>
      <button
        aria-label={`${isAllChatLoreAlwaysActive() ? language.disable : language.enable}: ${language.alwaysActive} (${language.Chat})`}
        aria-pressed={Boolean(isAllChatLoreAlwaysActive())}
        onclick={() => {
          toggleChatLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1">
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
