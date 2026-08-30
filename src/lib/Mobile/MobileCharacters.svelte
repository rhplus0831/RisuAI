<script lang="ts" module>
  import {
    filterMobileCharacterRows,
    formatMobileCharacterRows,
    makeMobileCharacterAgoText,
    mobileCharacterRowKey,
    normalizeMobileCharacterSearch,
    resolveMobileRelativeTimeLocale,
  } from './mobileCharacterRows'

  export {
    filterMobileCharacterRows,
    formatMobileCharacterRows,
    makeMobileCharacterAgoText,
    mobileCharacterRowKey,
    normalizeMobileCharacterSearch,
    resolveMobileRelativeTimeLocale,
  }
  export type { MobileCharacterRow, MobileCharacterRowsOptions } from './mobileCharacterRows'
</script>

<script lang="ts">
  import { selectedCharID } from 'src/ts/stores.svelte'
  import {
    charactersResourceState,
    getResourceDatabase,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { addCharacter, changeChar, getCharImage } from 'src/ts/characters'
  import { MobileSearch } from 'src/ts/stores.svelte'
  import { MessageSquareIcon, PlusIcon } from '@lucide/svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'
  import { language } from 'src/lang'
  import { onMount } from 'svelte'
  import { prefetchCharacterRouteResource } from 'src/ts/server/routeResourceLoader'
  import type { MobileCharacterSummary } from './mobileCharacterRows'

  interface Props {
    endGrid?: () => void
    search?: string
    hideTrash?: boolean
  }

  let { endGrid = () => {}, search, hideTrash = false }: Props = $props()
  let relativeTimeNow = $state(Date.now())
  let relativeTimeLocale = $derived(resolveMobileRelativeTimeLocale(settingsResourceState.value.language))
  let agoFormatter = $derived(new Intl.RelativeTimeFormat(relativeTimeLocale, { style: 'short' }))
  let normalizedSearch = $derived(normalizeMobileCharacterSearch(search ?? $MobileSearch))
  let selectedCharacterIndex = $derived(
    charactersResourceState.status === 'ready' ? charactersResourceState.currentChar : $selectedCharID,
  )
  let mobileCharacterRows = $derived(
    formatMobileCharacterRows(readCharacterOwners(), {
      hideTrash,
      agoFormatter,
      unknownText: language.unknownInteractionTime,
      now: relativeTimeNow,
    }),
  )
  let visibleMobileCharacterRows = $derived(filterMobileCharacterRows(mobileCharacterRows, normalizedSearch))

  onMount(() => {
    const timer = window.setInterval(() => {
      relativeTimeNow = Date.now()
    }, 60_000)
    return () => window.clearInterval(timer)
  })

  function openCharacterRoute(row: { chaId?: string; index: number }) {
    const characters = readCharacterOwners()
    const owner = row.chaId ? uniqueCharacterOwner(characters, row.chaId) : undefined
    const index = owner?.index ?? (row.chaId ? -1 : row.index)
    if (index < 0) return
    const character = (owner?.character ?? characters[index]) as MobileCharacterSummary | undefined
    if (!character?.chaId) {
      changeChar(index)
      endGrid()
      return
    }
    navigate(characterRoutePath(character.chaId, character.activeChatId ?? character.chats?.[character.chatPage]?.id))
  }

  function readCharacterOwners(): readonly MobileCharacterSummary[] {
    const ownedCharacters = charactersResourceState.characters
    if (ownedCharacters.length > 0 || charactersResourceState.status === 'ready') {
      return ownedCharacters as MobileCharacterSummary[]
    }
    // Compatibility is limited to the pre-readiness empty state. Once the
    // owner resource has rows (including during a refresh), keep rendering
    // that resident projection rather than switching sources.
    return (getResourceDatabase().characters ?? []) as MobileCharacterSummary[]
  }

  function uniqueCharacterOwner(characters: readonly MobileCharacterSummary[], characterId: string) {
    let owner: { character: MobileCharacterSummary; index: number } | undefined
    for (const [index, character] of characters.entries()) {
      if (character.chaId !== characterId) continue
      if (owner) return undefined
      owner = { character, index }
    }
    return owner
  }

  function isSelectedRow(row: { chaId?: string; index: number }): boolean {
    if (row.index !== selectedCharacterIndex) return false
    return !row.chaId || uniqueCharacterOwner(readCharacterOwners(), row.chaId)?.index === row.index
  }
</script>

<div class="flex flex-col items-center w-full overflow-y-auto h-full">
  {#each visibleMobileCharacterRows as char (char.chaId ? `${char.chaId}:${char.index}` : mobileCharacterRowKey(char))}
    <button
      class="flex p-2 border-t-darkborderc gap-2 w-full"
      class:border-t={char.sortedIndex !== 0}
      data-risu-mobile-character-row
      data-risu-row-id={char.chaId ?? ''}
      data-risu-row-index={char.index}
      data-risu-row-sorted-index={char.sortedIndex}
      data-risu-list-kind={hideTrash ? 'active' : 'all'}
      data-risu-selected={isSelectedRow(char) ? 'true' : 'false'}
      data-risu-mobile-character-action="open"
      onpointerenter={() => char.chaId && prefetchCharacterRouteResource(char.chaId)}
      onfocus={() => char.chaId && prefetchCharacterRouteResource(char.chaId)}
      aria-current={isSelectedRow(char) ? 'true' : undefined}
      onclick={() => {
        openCharacterRoute(char)
      }}>
      <BarIcon additionalStyle={getCharImage(char.image, 'css')} interactive={false}></BarIcon>
      <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
        <span data-risu-mobile-character-name>{char.name}</span>
        <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
          <span class="mr-1">{char.chats}</span>
          <MessageSquareIcon size={14} />
          <span class="mr-1 ml-1">|</span>
          <span data-risu-mobile-character-ago>{char.agoText}</span>
        </div>
      </div>
    </button>
  {/each}
  {#if visibleMobileCharacterRows.length === 0}
    <p class="p-6 text-center text-textcolor2" role="status" aria-live="polite">{language.noSearchResults}</p>
  {/if}
</div>

<button
  class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc"
  aria-label={language.addCharacter}
  data-risu-mobile-character-action="create"
  onclick={() => {
    addCharacter()
  }}>
  <PlusIcon size={24} />
</button>
