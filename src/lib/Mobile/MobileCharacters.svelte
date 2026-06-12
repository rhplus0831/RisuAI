<script lang="ts" module>
  import { type character } from 'src/ts/storage/database.svelte'

  export interface MobileCharacterRow {
    chaId?: string
    image?: string
    chats: number
    index: number
    interaction: number
    name: string
    agoText: string
    sortedIndex: number
  }

  interface MobileCharacterRowsOptions {
    hideTrash?: boolean
    agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>
    now?: number
  }

  export function normalizeMobileCharacterSearch(value: string) {
    return value.replace(/ /g, '').toLocaleLowerCase()
  }

  export function makeMobileCharacterAgoText(
    time: number,
    agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>,
    now = Date.now(),
  ) {
    if (time === 0) {
      return 'Unknown'
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
    { hideTrash = false, agoFormatter, now = Date.now() }: MobileCharacterRowsOptions,
  ): MobileCharacterRow[] {
    const rows = characters
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        return !hideTrash || !c.trashTime
      })
      .map(({ c, i }) => {
        const interaction = c.lastInteraction || 0
        return {
          chaId: c.chaId,
          name: c.name || 'Unnamed',
          image: c.image,
          chats: c.chats.length,
          index: i,
          interaction,
          agoText: makeMobileCharacterAgoText(interaction, agoFormatter, now),
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
    return rows.filter((char) => normalizeMobileCharacterSearch(char.name).includes(normalizedSearch))
  }

  export function mobileCharacterRowKey(char: MobileCharacterRow) {
    return char.chaId || `legacy-${char.index}`
  }
</script>

<script lang="ts">
  import { DBState, selectedCharID } from 'src/ts/stores.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { addCharacter, changeChar, getCharImage } from 'src/ts/characters'
  import { MobileSearch } from 'src/ts/stores.svelte'
  import { MessageSquareIcon, PlusIcon } from '@lucide/svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'

  interface Props {
    endGrid?: () => void
    search?: string
    hideTrash?: boolean
  }

  const agoFormatter = new Intl.RelativeTimeFormat(navigator.languages, { style: 'short' })

  let { endGrid = () => {}, search, hideTrash = false }: Props = $props()
  let normalizedSearch = $derived(normalizeMobileCharacterSearch(search ?? $MobileSearch))
  let mobileCharacterRows = $derived(formatMobileCharacterRows(DBState.db.characters, { hideTrash, agoFormatter }))
  let visibleMobileCharacterRows = $derived(filterMobileCharacterRows(mobileCharacterRows, normalizedSearch))

  function openCharacterRoute(index: number) {
    const character = DBState.db.characters?.[index]
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
      <BarIcon additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
      <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
        <span data-risu-mobile-character-name>{char.name}</span>
        <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
          <span class="mr-1">{char.chats}</span>
          <MessageSquareIcon size={14} />
          <span class="mr-1 ml-1">|</span>
          <span>{char.agoText}</span>
        </div>
      </div>
    </button>
  {/each}
</div>

<button
  class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc"
  data-risu-mobile-character-action="create"
  onclick={() => {
    addCharacter()
  }}>
  <PlusIcon size={24} />
</button>
