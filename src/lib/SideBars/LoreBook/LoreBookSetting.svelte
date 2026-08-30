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
    replaceCharacterLorebookCollectionWithOutcome,
    replaceChatLorebookCollectionWithOutcome,
    watchServerBackedLorebooks,
    type LorebookWatchScope,
    type ScopedLorebookMutationOperation,
  } from 'src/ts/server/lorebookBridge.svelte'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    findScopedLorebookCollectionMutationUiState,
    scopedLorebookMutationUiStates,
    trackScopedLorebookMutationUiOperation,
  } from 'src/ts/server/scopedLorebookMutationUiState'
  import { createServerBackedCharacterDraft } from 'src/ts/server/characterBridge.svelte'
  import {
    hasCharacterLorebookHydrationFailed,
    hydrateActiveCharacterLorebook,
    isCharacterLorebookHydrationPending,
  } from 'src/ts/server/chatMessageHydration.svelte'
  import { lorebookPageIndexFromSnapshot, lorebookPageOwnerState } from 'src/ts/server/lorebookPageOwner.svelte'

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

  function characterLorebookScopeKey(): string | null {
    const characterId = getDatabase().characters?.[$selectedCharID]?.chaId
    return characterId ? `character:${characterId}` : null
  }

  function chatLorebookScopeKey(): string | null {
    const character = getDatabase().characters?.[$selectedCharID]
    const chatId = character?.chats?.[character.chatPage]?.id
    return chatId ? `chat:${chatId}` : null
  }

  function globalLorebookScopeKey(): string | null {
    const database = getDatabase()
    const page = lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0
    const lorebookId = (database.loreBook?.[page] as { id?: unknown } | undefined)?.id
    return typeof lorebookId === 'string' && lorebookId.trim() ? `global:${lorebookId}` : null
  }

  let activeToolbarScopeKey = $derived(
    globalMode ? globalLorebookScopeKey() : submenu === 0 ? characterLorebookScopeKey() : chatLorebookScopeKey(),
  )
  let visibleLorebookMutationScopeKeys = $derived.by(() => {
    const keys = globalMode ? [globalLorebookScopeKey()] : [characterLorebookScopeKey(), chatLorebookScopeKey()]
    return [...new Set(keys.filter((key): key is string => Boolean(key)))]
  })

  function lorebookMutationStatus(scopeKey: string | null): 'pending' | 'queued' | 'failed' | 'idle' {
    return findScopedLorebookCollectionMutationUiState($scopedLorebookMutationUiStates, scopeKey)?.status ?? 'idle'
  }

  function lorebookMutationPending(scopeKey: string | null): boolean {
    return lorebookMutationStatus(scopeKey) === 'pending'
  }

  function trackLorebookMutation(operation: ScopedLorebookMutationOperation | null): void {
    trackScopedLorebookMutationUiOperation({
      operation,
      kind: 'collection',
      onQueued: () => alertNormal(language.scopedLorebookMutation.queued),
      onFailed: (error) => alertError(language.scopedLorebookMutation.failed(error)),
    })
  }

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
    trackLorebookMutation(replaceCharacterLorebookCollectionWithOutcome(character.chaId, nextLore))
  }

  function toggleChatLoreAlwaysActive() {
    const character = getDatabase().characters?.[$selectedCharID]
    const chat = character?.chats?.[character.chatPage]
    const localLore = chat?.localLore

    if (!chat?.id || !localLore) return

    const allActive = localLore.every((book) => book.alwaysActive)
    const nextLore = localLore.map((book) => ({ ...book, alwaysActive: !allActive }))
    trackLorebookMutation(replaceChatLorebookCollectionWithOutcome(chat.id, nextLore))
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
          characterLoreSettingsDraft.value.loreSettings = null
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
      disabled={lorebookMutationPending(activeToolbarScopeKey)}
      onclick={() => {
        if (lorebookMutationPending(activeToolbarScopeKey)) return
        trackLorebookMutation(addLorebook(globalMode ? -1 : submenu))
      }}
      class="hover:text-textcolor cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
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
      disabled={lorebookMutationPending(activeToolbarScopeKey)}
      onclick={() => {
        if (lorebookMutationPending(activeToolbarScopeKey)) return
        trackLorebookMutation(addLorebookFolder(globalMode ? -1 : submenu))
      }}
      class="hover:text-textcolor ml-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
      <FolderPlusIcon />
    </button>
    <button
      aria-label={`${language.import}: ${language.loreBook}`}
      disabled={lorebookMutationPending(activeToolbarScopeKey)}
      onclick={async () => {
        if (lorebookMutationPending(activeToolbarScopeKey)) return
        trackLorebookMutation(await importLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local'))
      }}
      class="hover:text-textcolor ml-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
      <HardDriveUploadIcon />
    </button>
    {#if getDatabase().bulkEnabling}
      <button
        aria-label={`${isAllCharacterLoreAlwaysActive() ? language.disable : language.enable}: ${language.alwaysActive} (${language.character})`}
        aria-pressed={Boolean(isAllCharacterLoreAlwaysActive())}
        disabled={lorebookMutationPending(characterLorebookScopeKey())}
        data-risu-lorebook-persistence={lorebookMutationStatus(characterLorebookScopeKey())}
        onclick={() => {
          if (lorebookMutationPending(characterLorebookScopeKey())) return
          toggleCharacterLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50">
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
        disabled={lorebookMutationPending(chatLorebookScopeKey())}
        data-risu-lorebook-persistence={lorebookMutationStatus(chatLorebookScopeKey())}
        onclick={() => {
          if (lorebookMutationPending(chatLorebookScopeKey())) return
          toggleChatLoreAlwaysActive()
        }}
        class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50">
        {#if isAllChatLoreAlwaysActive()}
          <SunIcon />
        {:else}
          <LinkIcon />
        {/if}
        <span class="text-xs">CHAT</span>
      </button>
    {/if}
  </div>
  {#each visibleLorebookMutationScopeKeys as scopeKey}
    {@const mutationState = findScopedLorebookCollectionMutationUiState($scopedLorebookMutationUiStates, scopeKey)}
    {@const status = mutationState?.status ?? 'idle'}
    {#if status === 'failed'}
      <p
        class="m-0 mt-1 text-xs text-red-400"
        data-risu-lorebook-persistence={status}
        data-risu-lorebook-scope={scopeKey}
        role="alert"
        aria-live="assertive">
        {language.scopedLorebookMutation.failed(mutationState?.error ?? '')}
      </p>
    {/if}
  {/each}
{/if}
