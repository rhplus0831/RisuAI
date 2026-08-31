<script lang="ts">
  import { charactersResourceState, settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import Hub from './Realm/RealmMain.svelte'
  import { OpenRealmStore } from 'src/ts/stores.svelte'
  import { ArrowLeft, ChevronRightIcon, Globe2Icon, PinIcon, UsersIcon } from '@lucide/svelte'
  import { getVersionString } from 'src/ts/globalApi.svelte'
  import { language } from 'src/lang'
  import Title from './Title.svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { onMount } from 'svelte'
  import { getCharImage } from 'src/ts/characterImage'
  import { characterRoutePath, navigate, openGridRoute } from 'src/ts/router'
  import GenerationIndicator from '../SideBars/GenerationIndicator.svelte'
  import UnreadIndicator from '../SideBars/UnreadIndicator.svelte'
  import {
    collectExhaustedGenerationChatIds,
    collectGeneratingChatIds,
    collectPinnedChats,
    type PinnedChatItem,
  } from '../SideBars/sidebarMultitasking'
  import { activeChatGenerations } from 'src/ts/process/generationActivity.svelte'
  import { activeGenerationJobs, generationJobLifecycles } from 'src/ts/process/reattach'
  import { markChatRead, unreadChatIds } from 'src/ts/process/chatUnread.svelte'
  import { resolveMobileRelativeTimeLocale } from '../Mobile/mobileCharacterRows'
  import {
    collectHomeRecentCharacters,
    HOME_PINNED_CHAT_COLLAPSED_LIMIT,
    type HomeRecentCharacterItem,
  } from './mainMenuProjection'

  let realmConfirmOpen = $state(false)
  let showAllPinnedChats = $state(false)
  let relativeTimeNow = $state(Date.now())
  let relativeTimeLocale = $derived(resolveMobileRelativeTimeLocale(readLanguageOwner()))
  let agoFormatter = $derived(new Intl.RelativeTimeFormat(relativeTimeLocale, { style: 'short' }))
  let roundIcons = $derived(readBooleanSettingsOwner('display', 'roundIcons') === true)
  let warningChatIds = $derived(collectExhaustedGenerationChatIds($generationJobLifecycles))
  let generatingChatIds = $derived(
    collectGeneratingChatIds($activeGenerationJobs, $activeChatGenerations, warningChatIds),
  )

  type ShellSettingsGroup = 'language' | 'advanced' | 'display'
  type ShellBooleanSetting = 'doNotWarnExternalServers' | 'roundIcons'

  function hasSettingsOwner(group: ShellSettingsGroup): boolean {
    const groupStatus = settingsResourceState.groupStatuses[group]
    if (settingsResourceState.status === 'error' || groupStatus === 'error') return false
    return groupStatus === 'ready' || settingsResourceState.shellRevision !== null
  }

  function readLanguageOwner(): string | undefined {
    const value = hasSettingsOwner('language') ? settingsResourceState.value.language : undefined
    return typeof value === 'string' ? value : undefined
  }

  function readBooleanSettingsOwner(group: ShellSettingsGroup, key: ShellBooleanSetting): boolean | undefined {
    const value = hasSettingsOwner(group) ? settingsResourceState.value[key] : undefined
    return typeof value === 'boolean' ? value : undefined
  }

  function characterRowsOwner() {
    if (
      (charactersResourceState.status !== 'ready' && charactersResourceState.status !== 'loading') ||
      charactersResourceState.listRevision === null
    ) {
      return []
    }

    const rows = charactersResourceState.characters
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row?.chaId) counts.set(row.chaId, (counts.get(row.chaId) ?? 0) + 1)
    }
    return rows.filter((row) => {
      if (!row?.chaId || counts.get(row.chaId) !== 1) return false
      const rowStatus = charactersResourceState.rowStatuses[row.chaId]
      return rowStatus === 'ready' || rowStatus === 'loading'
    })
  }

  function characterOrderOwner() {
    return (charactersResourceState.status === 'ready' || charactersResourceState.status === 'loading') &&
      charactersResourceState.orderRevision !== null
      ? charactersResourceState.characterOrder
      : []
  }

  let pinnedChats = $derived(collectPinnedChats(characterRowsOwner(), characterOrderOwner()))
  let visiblePinnedChats = $derived(
    showAllPinnedChats ? pinnedChats : pinnedChats.slice(0, HOME_PINNED_CHAT_COLLAPSED_LIMIT),
  )
  let recentCharacters = $derived(
    collectHomeRecentCharacters(characterRowsOwner(), {
      agoFormatter,
      unknownText: language.unknownInteractionTime,
      now: relativeTimeNow,
    }),
  )

  onMount(() => {
    const timer = window.setInterval(() => {
      relativeTimeNow = Date.now()
    }, 60_000)
    return () => window.clearInterval(timer)
  })

  async function openRealm() {
    if ($OpenRealmStore || realmConfirmOpen) return

    const doNotWarnExternalServers = readBooleanSettingsOwner('advanced', 'doNotWarnExternalServers') === true
    if (!doNotWarnExternalServers) {
      realmConfirmOpen = true
      try {
        if (!(await alertConfirm(language.sendExternalServerWarning))) return
      } finally {
        realmConfirmOpen = false
      }
    }

    $OpenRealmStore = true
  }

  function openPinnedChat(item: PinnedChatItem): void {
    markChatRead(item.chatId)
    navigate(characterRoutePath(item.characterId, item.chatId))
  }

  function openRecentCharacter(item: HomeRecentCharacterItem): void {
    navigate(characterRoutePath(item.characterId, item.activeChatId))
  }
</script>

<div class="h-full w-full flex flex-col overflow-y-auto items-center">
  {#if !$OpenRealmStore}
    <Title />
    <h3 class="text-textcolor2 mt-1">{getVersionString()}</h3>
  {/if}
  <div class="w-full flex p-4 pb-8 flex-col text-textcolor max-w-4xl">
    {#if !$OpenRealmStore}
      <div class="mt-4 mb-5 w-full border-t border-t-selected"></div>

      <section aria-labelledby="home-pinned-chats-title" data-risu-home-section="pinned-chats">
        <div class="mb-3 flex items-center gap-2">
          <PinIcon size={18} aria-hidden="true" />
          <h2 id="home-pinned-chats-title" class="text-lg font-bold">{language.pinnedChats}</h2>
        </div>

        {#if pinnedChats.length > 0}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2" data-risu-home-pinned-list>
            {#each visiblePinnedChats as item (`${item.characterId}:${item.chatId}`)}
              <button
                type="button"
                class="group flex min-w-0 items-center gap-3 rounded-xl border border-darkborderc bg-darkbg p-3 text-left shadow-sm transition-colors hover:border-green-500 hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-label={language.openPinnedChat(item.chatName, item.characterName)}
                data-risu-home-pinned-chat={item.chatId}
                onclick={() => openPinnedChat(item)}>
                <span class="relative flex h-14 w-14 shrink-0 items-center justify-center">
                  {#await item.characterImage ? getCharImage(item.characterImage, 'plain') : '/none.webp'}
                    <span class="h-14 w-14 animate-pulse rounded-lg bg-selected" aria-hidden="true"></span>
                  {:then imageSource}
                    <img
                      src={imageSource || '/none.webp'}
                      alt=""
                      class="h-14 w-14 rounded-lg object-cover object-top"
                      class:rounded-full={roundIcons} />
                  {/await}
                  {#if warningChatIds.has(item.chatId)}
                    <GenerationIndicator
                      state="warning"
                      label={language.generationReattachFailure.sidebarWarning(item.chatName)}
                      onActivate={() => openPinnedChat(item)} />
                  {:else if generatingChatIds.has(item.chatId)}
                    <GenerationIndicator
                      label={`${language.generatingMessage}: ${item.chatName}`}
                      onActivate={() => openPinnedChat(item)} />
                  {:else if $unreadChatIds.has(item.chatId)}
                    <UnreadIndicator
                      label={`${language.newMessage}: ${item.chatName}`}
                      onActivate={() => openPinnedChat(item)} />
                  {/if}
                </span>
                <span class="min-w-0 grow">
                  <span class="block truncate font-semibold">{item.chatName}</span>
                  <span class="mt-0.5 block truncate text-sm text-textcolor2">{item.characterName}</span>
                </span>
                <ChevronRightIcon
                  size={18}
                  class="shrink-0 text-textcolor2 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true" />
              </button>
            {/each}
          </div>

          {#if pinnedChats.length > HOME_PINNED_CHAT_COLLAPSED_LIMIT}
            <button
              type="button"
              class="mt-3 rounded-md px-2 py-1 text-sm font-medium text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              aria-expanded={showAllPinnedChats}
              onclick={() => (showAllPinnedChats = !showAllPinnedChats)}>
              {showAllPinnedChats
                ? language.homeShowFewerPinnedChats
                : language.homeShowAllPinnedChats(pinnedChats.length)}
            </button>
          {/if}
        {:else}
          <div
            class="rounded-xl border border-dashed border-darkborderc bg-darkbg/60 px-4 py-3 text-sm text-textcolor2">
            {language.homePinnedChatsEmpty}
          </div>
        {/if}
      </section>

      <section class="mt-7" aria-labelledby="home-recent-characters-title" data-risu-home-section="recent-characters">
        <div class="mb-3 flex items-center gap-2">
          <UsersIcon size={18} aria-hidden="true" />
          <h2 id="home-recent-characters-title" class="text-lg font-bold">{language.homeRecentCharacters}</h2>
          <button
            type="button"
            class="ml-auto rounded-md px-2 py-1 text-sm font-medium text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            onclick={openGridRoute}>
            {language.homeViewAllCharacters}
          </button>
        </div>

        {#if recentCharacters.length > 0}
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4" data-risu-home-recent-list>
            {#each recentCharacters as item (item.characterId)}
              <button
                type="button"
                class="flex min-w-0 items-center gap-2 rounded-xl border border-darkborderc bg-darkbg p-3 text-left shadow-sm transition-colors hover:border-green-500 hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-label={language.openCharacter(item.characterName)}
                data-risu-home-recent-character={item.characterId}
                onclick={() => openRecentCharacter(item)}>
                {#await item.characterImage ? getCharImage(item.characterImage, 'plain') : '/none.webp'}
                  <span class="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-selected" aria-hidden="true"></span>
                {:then imageSource}
                  <img
                    src={imageSource || '/none.webp'}
                    alt=""
                    class="h-11 w-11 shrink-0 rounded-lg object-cover object-top"
                    class:rounded-full={roundIcons} />
                {/await}
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold">{item.characterName}</span>
                  <span class="mt-0.5 block truncate text-xs text-textcolor2">{item.agoText}</span>
                </span>
              </button>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-xl border border-dashed border-darkborderc bg-darkbg/60 px-4 py-3 text-sm text-textcolor2">
            {language.homeRecentCharactersEmpty}
          </div>
        {/if}
      </section>

      <section class="mt-7" aria-labelledby="home-explore-title" data-risu-home-section="explore">
        <div class="mb-3 flex items-center gap-2">
          <Globe2Icon size={18} aria-hidden="true" />
          <h2 id="home-explore-title" class="text-lg font-bold">{language.homeExplore}</h2>
        </div>
        <button
          type="button"
          class="group flex w-full items-center gap-4 rounded-xl border border-darkborderc bg-darkbg px-5 py-4 text-left shadow-sm transition-colors hover:border-green-500 hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          onclick={openRealm}>
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-selected text-textcolor">
            <Globe2Icon size={22} aria-hidden="true" />
          </span>
          <span class="min-w-0 grow">
            <span class="block text-lg font-bold">{language.openRisuRealm}</span>
            <span class="mt-0.5 block text-sm text-textcolor2">{language.homeExploreRealmDescription}</span>
          </span>
          <ChevronRightIcon
            size={20}
            class="shrink-0 text-textcolor2 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true" />
        </button>
      </section>
    {:else}
      <div class="flex items-center mt-4">
        <button
          class="mr-2 text-textcolor2 hover:text-green-500"
          aria-label={language.goback}
          onclick={() => ($OpenRealmStore = false)}>
          <ArrowLeft aria-hidden="true" />
        </button>
      </div>
      <Hub />
    {/if}
  </div>
</div>
