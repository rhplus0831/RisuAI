<script lang="ts" module>
  import { getCharacterDisplayInfo } from 'src/ts/characterDisplayName'
  import { type character } from 'src/ts/storage/database.svelte'

  export interface MobileCharacterRow {
    chaId?: string
    image?: string
    chats: number
    index: number
    interaction: number
    name: string
    searchText: string
    agoText: string
    sortedIndex: number
  }

  interface MobileCharacterRowsOptions {
    hideTrash?: boolean
    agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>
    unknownText: string
    now?: number
  }

  const relativeTimeLocaleByUiLanguage: Readonly<Record<string, string>> = {
    cn: 'zh-CN',
    de: 'de',
    en: 'en',
    es: 'es',
    ko: 'ko',
    vi: 'vi',
    'zh-Hant': 'zh-TW',
  }

  export function resolveMobileRelativeTimeLocale(uiLanguage: unknown): string {
    if (typeof uiLanguage !== 'string') return 'en'
    return relativeTimeLocaleByUiLanguage[uiLanguage] ?? 'en'
  }

  export function normalizeMobileCharacterSearch(value: string) {
    return value.replace(/ /g, '').toLocaleLowerCase()
  }

  export function makeMobileCharacterAgoText(
    time: number,
    agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>,
    unknownText: string,
    now = Date.now(),
  ) {
    if (time === 0) {
      return unknownText
    }
    const diff = now - time
    if (diff < 3600000) {
      const min = Math.floor(diff / 60000)
      return agoFormatter.format(-min, 'minute')
    }
    if (diff < 86400000) {
      const hour = Math.floor(diff / 3600000)
      return agoFormatter.format(-hour, 'hour')
    }
    if (diff < 604800000) {
      const day = Math.floor(diff / 86400000)
      return agoFormatter.format(-day, 'day')
    }
    if (diff < 2592000000) {
      const week = Math.floor(diff / 604800000)
      return agoFormatter.format(-week, 'week')
    }
    if (diff < 31536000000) {
      const month = Math.floor(diff / 2592000000)
      return agoFormatter.format(-month, 'month')
    }
    const year = Math.floor(diff / 31536000000)
    return agoFormatter.format(-year, 'year')
  }

  export function formatMobileCharacterRows(
    characters: readonly character[],
    { hideTrash = false, agoFormatter, unknownText, now = Date.now() }: MobileCharacterRowsOptions,
  ): MobileCharacterRow[] {
    const rows = characters
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !hideTrash || !c.trashTime)
      .map(({ c, i }) => {
        const interaction = c.lastInteraction || 0
        const displayInfo = getCharacterDisplayInfo(c)
        return {
          chaId: c.chaId,
          name: displayInfo.name,
          searchText: displayInfo.searchText,
          image: c.image,
          chats: c.chats.length,
          index: i,
          interaction,
          agoText: makeMobileCharacterAgoText(interaction, agoFormatter, unknownText, now),
          sortedIndex: 0,
        }
      })
      .sort((a, b) => {
        if (a.interaction === b.interaction) {
          return a.name.localeCompare(b.name)
        }
        return b.interaction - a.interaction
      })

    for (let sortedIndex = 0; sortedIndex < rows.length; sortedIndex++) {
      rows[sortedIndex].sortedIndex = sortedIndex
    }

    return rows
  }

  export function filterMobileCharacterRows(rows: readonly MobileCharacterRow[], normalizedSearch: string) {
    return rows.filter((char) => normalizeMobileCharacterSearch(char.searchText).includes(normalizedSearch))
  }

  export function mobileCharacterRowKey(char: MobileCharacterRow) {
    return char.chaId || `legacy-${char.index}`
  }
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
