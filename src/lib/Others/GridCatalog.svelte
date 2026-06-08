<script lang="ts" module>
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

  export function formatGridCatalogCharacterLists(
    db: Database,
    normalizedSearch: string,
  ): GridCatalogCharacterLists {
    const active: GridCatalogCharacter[] = []
    const trash: GridCatalogCharacter[] = []

    for (let i = 0; i < db.characters.length; i++) {
      const c = db.characters[i]
      const name = c.name
      if (!normalizeGridCatalogSearch(name).includes(normalizedSearch)) {
        continue
      }

      const char = {
        chaId: c.chaId,
        image: c.image,
        index: i,
        name,
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
  import { DBState } from 'src/ts/stores.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { ArrowLeft, User, SquareMousePointer, TrashIcon, Undo2Icon } from '@lucide/svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { parseMultilangString } from 'src/ts/util'
  import { checkCharOrder } from 'src/ts/globalApi.svelte'
  import MobileCharacters from '../Mobile/MobileCharacters.svelte'
  import { currentCharacterStateSnapshot, dispatchUpdateCharacter } from 'src/ts/characterCommands'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import { characterRoutePath, navigate } from 'src/ts/router'
  interface Props {
    endGrid?: any
  }

  let { endGrid = () => {} }: Props = $props()
  let search = $state('')
  let selected = $state(3)
  let normalizedSearch = $derived(normalizeGridCatalogSearch(search))
  let catalogCharacters = $derived(formatGridCatalogCharacterLists(DBState.db, normalizedSearch))

  function openCharacterRoute(index: number) {
    const character = DBState.db.characters?.[index]
    if (!character?.chaId) {
      changeChar(index)
      return
    }
    navigate(characterRoutePath(character.chaId, character.chats?.[character.chatPage]?.id))
  }
</script>

<div class="h-full w-full flex justify-center">
  <div class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col overflow-y-auto">
    <div class="mx-4 mb-6 flex flex-col">
      <div class="flex items-center gap-3 mb-2">
        <button
          class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
          onclick={() => endGrid()}
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div class="flex-1">
          <TextInput
            placeholder="Search"
            bind:value={search}
            size="lg"
            autocomplete="off"
            fullwidth={true}
          />
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mt-2">
        <Button
          styled={selected === 3 ? 'primary' : 'outlined'}
          size="sm"
          onclick={() => {
            selected = 3
          }}
        >
          {language.simple}
        </Button>
        <Button
          styled={selected === 0 ? 'primary' : 'outlined'}
          size="sm"
          onclick={() => {
            selected = 0
          }}
        >
          {language.grid}
        </Button>
        <Button
          styled={selected === 1 ? 'primary' : 'outlined'}
          size="sm"
          onclick={() => {
            selected = 1
          }}
        >
          {language.list}
        </Button>
        <Button
          styled={selected === 2 ? 'primary' : 'outlined'}
          size="sm"
          onclick={() => {
            selected = 2
          }}
        >
          {language.trash}
        </Button>
        <div class="grow"></div>
        <span class="text-textcolor2 text-sm">
          {catalogCharacters.active.length}
          {language.character}
        </span>
      </div>
    </div>
    {#if selected === 0}
      <div class="w-full flex justify-center">
        <div class="flex flex-wrap gap-2 w-full justify-center">
          {#each catalogCharacters.active as char (gridCatalogCharacterKey(char))}
            <div class="flex items-center text-textcolor">
              {#if char.image}
                <BarIcon
                  onClick={() => {
                    openCharacterRoute(char.index)
                  }}
                  additionalStyle={getCharImage(char.image, 'css')}
                ></BarIcon>
              {:else}
                <BarIcon
                  onClick={() => {
                    openCharacterRoute(char.index)
                  }}
                  additionalStyle={char.index === $selectedCharID
                    ? 'background:var(--risu-theme-selected)'
                    : ''}
                >
                  <User />
                </BarIcon>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else if selected === 1}
      {#each catalogCharacters.active as char (gridCatalogCharacterKey(char))}
        <div class="flex p-2 border border-darkborderc rounded-md mb-2">
          <BarIcon
            onClick={() => {
              openCharacterRoute(char.index)
            }}
            additionalStyle={getCharImage(char.image, 'css')}
          ></BarIcon>
          <div class="flex-1 flex flex-col ml-2">
            <h4 class="text-textcolor font-bold text-lg mb-1">{char.name || 'Unnamed'}</h4>
            <span class="text-textcolor2"
              >{parseMultilangString(char.desc)['en'] ||
                parseMultilangString(char.desc)['xx'] ||
                'No description'}</span
            >
            <div class="flex gap-2 justify-end">
              <button
                class="hover:text-textcolor text-textcolor2"
                onclick={() => {
                  openCharacterRoute(char.index)
                }}
              >
                <SquareMousePointer />
              </button>
              <button
                class="hover:text-textcolor text-textcolor2"
                onclick={() => {
                  removeChar(char.index, char.name)
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        </div>
      {/each}
    {:else if selected === 2}
      <span class="text-textcolor2 text-sm mb-2">{language.trashDesc}</span>
      {#each catalogCharacters.trash as char (gridCatalogCharacterKey(char))}
        <div class="flex p-2 border border-darkborderc rounded-md mb-2">
          <BarIcon
            onClick={() => {
              openCharacterRoute(char.index)
            }}
            additionalStyle={getCharImage(char.image, 'css')}
          ></BarIcon>
          <div class="flex-1 flex flex-col ml-2">
            <h4 class="text-textcolor font-bold text-lg mb-1">{char.name || 'Unnamed'}</h4>
            <span class="text-textcolor2"
              >{parseMultilangString(char.desc)['en'] ||
                parseMultilangString(char.desc)['xx'] ||
                'No description'}</span
            >
            <div class="flex gap-2 justify-end">
              <button
                class="hover:text-textcolor text-textcolor2"
                onclick={() => {
                  const previous = currentCharacterStateSnapshot()
                  const characterId = DBState.db.characters[char.index].chaId
                  if (!canUseServerCommands()) {
                    DBState.db.characters[char.index].trashTime = undefined
                    checkCharOrder()
                  }
                  if (characterId) {
                    dispatchUpdateCharacter(characterId, { trashTime: null }, previous)
                  }
                }}
              >
                <Undo2Icon />
              </button>
              <button
                class="hover:text-textcolor text-textcolor2"
                onclick={() => {
                  removeChar(char.index, char.name, 'permanent')
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        </div>
      {/each}
    {:else if selected === 3}
      <MobileCharacters {endGrid} {search} hideTrash={true} />
    {/if}
  </div>
</div>
