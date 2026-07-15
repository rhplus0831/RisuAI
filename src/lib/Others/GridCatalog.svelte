<script lang="ts" module>
  import { getCharacterDisplayInfo } from 'src/ts/characterDisplayName'
  import { type Database } from '../../ts/storage/database.svelte'

  export interface GridCatalogCharacter {
    chaId?: string
    image?: string
    index: number
    name: string
    desc: string
  }

  export interface GridCatalogCharacterLists {
    active: GridCatalogCharacter[]
    trash: GridCatalogCharacter[]
  }

  export function normalizeGridCatalogSearch(search: string) {
    return search.replace(/ /g, '').toLocaleLowerCase()
  }

  export function formatGridCatalogCharacterLists(db: Database, normalizedSearch: string): GridCatalogCharacterLists {
    const active: GridCatalogCharacter[] = []
    const trash: GridCatalogCharacter[] = []

    for (let i = 0; i < db.characters.length; i++) {
      const c = db.characters[i]
      const displayInfo = getCharacterDisplayInfo(c)
      if (!normalizeGridCatalogSearch(displayInfo.searchText).includes(normalizedSearch)) {
        continue
      }

      const char = {
        chaId: c.chaId,
        image: c.image,
        index: i,
        name: displayInfo.name,
        desc: c.creatorNotes ?? 'No description',
      }

      if (c.trashTime) {
        trash.push(char)
      } else {
        active.push(char)
      }
    }

    return { active, trash }
  }

  function gridCatalogCharacterKey(char: GridCatalogCharacter) {
    return char.chaId || `legacy-${char.index}`
  }
</script>

<script lang="ts">
  import { changeChar, getCharImage, removeChar } from '../../ts/characters'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { ArrowLeft, User, SquareMousePointer, TrashIcon, Undo2Icon } from '@lucide/svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { parseMultilangString } from 'src/ts/util'
  import MobileCharacters from '../Mobile/MobileCharacters.svelte'
  import { currentCharacterRowSnapshot, dispatchUpdateCharacterScoped } from 'src/ts/characterCommands'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'
  interface Props {
    endGrid?: any
  }

  let { endGrid = () => {} }: Props = $props()
  let search = $state('')
  let selected = $state(3)
  let normalizedSearch = $derived(normalizeGridCatalogSearch(search))
  let catalogCharacters = $derived(formatGridCatalogCharacterLists(getDatabase(), normalizedSearch))
  let selectedListKind = $derived(
    selected === 0 ? 'grid' : selected === 1 ? 'list' : selected === 2 ? 'trash' : 'simple',
  )
  let catalogCount = $derived(
    selectedListKind === 'trash' ? catalogCharacters.trash.length : catalogCharacters.active.length,
  )

  function openCharacterRoute(index: number) {
    const character = getDatabase().characters?.[index]
    if (!character?.chaId) {
      changeChar(index)
      return
    }
    navigate(characterRoutePath(character.chaId, character.chats?.[character.chatPage]?.id))
  }

  function restoreTrashedCharacter(index: number): void {
    const character = getDatabase().characters?.[index]
    if (!character) return

    const characterId = character.chaId
    const previous = currentCharacterRowSnapshot(index)
    let applied = false
    withTrustedResourceWrite(() => {
      const liveIndex = characterId
        ? getDatabase().characters.findIndex((candidate) => candidate.chaId === characterId)
        : index
      const liveCharacter = getDatabase().characters?.[liveIndex] as
        | (typeof character & { trashTime?: number | null })
        | undefined
      if (!liveCharacter) return
      liveCharacter.trashTime = null
      applied = true
    })
    if (applied && characterId) {
      dispatchUpdateCharacterScoped(characterId, { trashTime: null }, previous)
    }
  }
</script>

<div class="h-full w-full flex justify-center" data-risu-grid-catalog data-risu-list-kind={selectedListKind}>
  <div class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col overflow-y-auto">
    <div class="mx-4 mb-6 flex flex-col">
      <div class="flex items-center gap-3 mb-2">
        <button
          data-risu-grid-action="back"
          class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
          onclick={() => endGrid()}
          title={language.goback}
          aria-label={language.goback}>
          <ArrowLeft size={20} />
        </button>
        <div class="flex-1">
          <TextInput
            placeholder={language.search}
            ariaLabel={language.search}
            bind:value={search}
            size="lg"
            autocomplete="off"
            fullwidth={true} />
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mt-2">
        <span data-risu-grid-tab data-risu-list-kind="simple" data-risu-selected={selected === 3 ? 'true' : 'false'}>
          <Button
            selected={selected === 3}
            styled={selected === 3 ? 'primary' : 'outlined'}
            size="sm"
            onclick={() => {
              selected = 3
            }}>
            {language.simple}
          </Button>
        </span>
        <span data-risu-grid-tab data-risu-list-kind="grid" data-risu-selected={selected === 0 ? 'true' : 'false'}>
          <Button
            selected={selected === 0}
            styled={selected === 0 ? 'primary' : 'outlined'}
            size="sm"
            onclick={() => {
              selected = 0
            }}>
            {language.grid}
          </Button>
        </span>
        <span data-risu-grid-tab data-risu-list-kind="list" data-risu-selected={selected === 1 ? 'true' : 'false'}>
          <Button
            selected={selected === 1}
            styled={selected === 1 ? 'primary' : 'outlined'}
            size="sm"
            onclick={() => {
              selected = 1
            }}>
            {language.list}
          </Button>
        </span>
        <span data-risu-grid-tab data-risu-list-kind="trash" data-risu-selected={selected === 2 ? 'true' : 'false'}>
          <Button
            selected={selected === 2}
            styled={selected === 2 ? 'primary' : 'outlined'}
            size="sm"
            onclick={() => {
              selected = 2
            }}>
            {language.trash}
          </Button>
        </span>
        <div class="grow"></div>
        <span class="text-textcolor2 text-sm" data-risu-grid-catalog-count>
          {catalogCount}
          {language.character}
        </span>
      </div>
    </div>
    {#if selected === 0}
      <div class="w-full flex justify-center" data-risu-grid-list data-risu-list-kind="grid">
        <div class="flex flex-wrap gap-2 w-full justify-center">
          {#each catalogCharacters.active as char (gridCatalogCharacterKey(char))}
            <div
              class="flex items-center text-textcolor"
              data-risu-grid-character-row
              data-risu-row-id={char.chaId ?? ''}
              data-risu-row-index={char.index}
              data-risu-list-kind="grid"
              data-risu-selected={char.index === $selectedCharID ? 'true' : 'false'}
              aria-current={char.index === $selectedCharID ? 'true' : undefined}>
              {#if char.image}
                <span data-risu-grid-action="open">
                  <BarIcon
                    ariaLabel={language.openCharacter(char.name)}
                    onClick={() => {
                      openCharacterRoute(char.index)
                    }}
                    additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
                </span>
              {:else}
                <span data-risu-grid-action="open">
                  <BarIcon
                    ariaLabel={language.openCharacter(char.name)}
                    onClick={() => {
                      openCharacterRoute(char.index)
                    }}
                    additionalStyle={char.index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}>
                    <User />
                  </BarIcon>
                </span>
              {/if}
            </div>
          {/each}
          {#if catalogCharacters.active.length === 0}
            <p class="p-6 text-center text-textcolor2" role="status" aria-live="polite">
              {language.noSearchResults}
            </p>
          {/if}
        </div>
      </div>
    {:else if selected === 1}
      <div class="contents" data-risu-grid-list data-risu-list-kind="list">
        {#each catalogCharacters.active as char (gridCatalogCharacterKey(char))}
          <div
            class="flex p-2 border border-darkborderc rounded-md mb-2"
            data-risu-grid-character-row
            data-risu-row-id={char.chaId ?? ''}
            data-risu-row-index={char.index}
            data-risu-list-kind="list"
            data-risu-selected={char.index === $selectedCharID ? 'true' : 'false'}
            aria-current={char.index === $selectedCharID ? 'true' : undefined}>
            <span data-risu-grid-action="open">
              <BarIcon
                ariaLabel={language.openCharacter(char.name)}
                onClick={() => {
                  openCharacterRoute(char.index)
                }}
                additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
            </span>
            <div class="flex-1 flex flex-col ml-2">
              <h4 class="text-textcolor font-bold text-lg mb-1" data-risu-character-name>
                {char.name || 'Unnamed'}
              </h4>
              <span class="text-textcolor2"
                >{parseMultilangString(char.desc)['en'] ||
                  parseMultilangString(char.desc)['xx'] ||
                  'No description'}</span>
              <div class="flex gap-2 justify-end">
                <button
                  data-risu-grid-action="open"
                  aria-label={language.openCharacter(char.name)}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    openCharacterRoute(char.index)
                  }}>
                  <SquareMousePointer />
                </button>
                <button
                  data-risu-grid-action="delete"
                  aria-label={`${language.removeCharacter}: ${char.name}`}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    removeChar(char.index, char.name)
                  }}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        {/each}
        {#if catalogCharacters.active.length === 0}
          <p class="p-6 text-center text-textcolor2" role="status" aria-live="polite">
            {language.noSearchResults}
          </p>
        {/if}
      </div>
    {:else if selected === 2}
      <div class="contents" data-risu-grid-list data-risu-list-kind="trash">
        <span class="text-textcolor2 text-sm mb-2">{language.trashDesc}</span>
        {#each catalogCharacters.trash as char (gridCatalogCharacterKey(char))}
          <div
            class="flex p-2 border border-darkborderc rounded-md mb-2"
            data-risu-grid-character-row
            data-risu-row-id={char.chaId ?? ''}
            data-risu-row-index={char.index}
            data-risu-list-kind="trash"
            data-risu-selected={char.index === $selectedCharID ? 'true' : 'false'}
            aria-current={char.index === $selectedCharID ? 'true' : undefined}>
            <span data-risu-grid-action="open">
              <BarIcon
                ariaLabel={language.openCharacter(char.name)}
                onClick={() => {
                  openCharacterRoute(char.index)
                }}
                additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
            </span>
            <div class="flex-1 flex flex-col ml-2">
              <h4 class="text-textcolor font-bold text-lg mb-1" data-risu-character-name>
                {char.name || 'Unnamed'}
              </h4>
              <span class="text-textcolor2"
                >{parseMultilangString(char.desc)['en'] ||
                  parseMultilangString(char.desc)['xx'] ||
                  'No description'}</span>
              <div class="flex gap-2 justify-end">
                <button
                  data-risu-grid-action="restore"
                  aria-label={language.restoreCharacter(char.name)}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    restoreTrashedCharacter(char.index)
                  }}>
                  <Undo2Icon />
                </button>
                <button
                  data-risu-grid-action="delete-permanent"
                  aria-label={language.deleteCharacterPermanently(char.name)}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    removeChar(char.index, char.name, 'permanent')
                  }}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        {/each}
        {#if catalogCharacters.trash.length === 0}
          <p class="p-6 text-center text-textcolor2" role="status" aria-live="polite">
            {language.noSearchResults}
          </p>
        {/if}
      </div>
    {:else if selected === 3}
      <div class="contents" data-risu-grid-list data-risu-list-kind="simple">
        <MobileCharacters {endGrid} {search} hideTrash={true} />
      </div>
    {/if}
  </div>
</div>
