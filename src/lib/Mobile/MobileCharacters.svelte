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
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { addCharacter, changeChar, getCharImage } from 'src/ts/characters'
  import { MobileSearch } from 'src/ts/stores.svelte'
  import { MessageSquareIcon, PlusIcon } from '@lucide/svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'
  import { language } from 'src/lang'
  import { onMount } from 'svelte'
  import { prefetchCharacterRouteResource } from 'src/ts/server/routeResourceLoader'

  interface Props {
    endGrid?: () => void
    search?: string
    hideTrash?: boolean
  }

  let { endGrid = () => {}, search, hideTrash = false }: Props = $props()
  let relativeTimeNow = $state(Date.now())
  let relativeTimeLocale = $derived(resolveMobileRelativeTimeLocale(getDatabase().language))
  let agoFormatter = $derived(new Intl.RelativeTimeFormat(relativeTimeLocale, { style: 'short' }))
  let normalizedSearch = $derived(normalizeMobileCharacterSearch(search ?? $MobileSearch))
  let mobileCharacterRows = $derived(
    formatMobileCharacterRows(getDatabase().characters, {
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

  function openCharacterRoute(index: number) {
    const character = getDatabase().characters?.[index]
    if (!character?.chaId) {
      changeChar(index)
      endGrid()
      return
    }
    navigate(characterRoutePath(character.chaId, character.chats?.[character.chatPage]?.id))
  }
</script>

<div class="flex flex-col items-center w-full overflow-y-auto h-full">
  {#each visibleMobileCharacterRows as char (mobileCharacterRowKey(char))}
    <button
      class="flex p-2 border-t-darkborderc gap-2 w-full"
      class:border-t={char.sortedIndex !== 0}
      data-risu-mobile-character-row
      data-risu-row-id={char.chaId ?? ''}
      data-risu-row-index={char.index}
      data-risu-row-sorted-index={char.sortedIndex}
      data-risu-list-kind={hideTrash ? 'active' : 'all'}
      data-risu-selected={char.index === $selectedCharID ? 'true' : 'false'}
      data-risu-mobile-character-action="open"
      onpointerenter={() => char.chaId && prefetchCharacterRouteResource(char.chaId)}
      onfocus={() => char.chaId && prefetchCharacterRouteResource(char.chaId)}
      aria-current={char.index === $selectedCharID ? 'true' : undefined}
      onclick={() => {
        openCharacterRoute(char.index)
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
