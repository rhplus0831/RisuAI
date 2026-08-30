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
    return formatGridCatalogCharacterListsFromCharacters(db.characters, normalizedSearch)
  }

  export function formatGridCatalogCharacterListsFromCharacters(
    characters: readonly Database['characters'][number][],
    normalizedSearch: string,
  ): GridCatalogCharacterLists {
    const active: GridCatalogCharacter[] = []
    const trash: GridCatalogCharacter[] = []

    for (let i = 0; i < characters.length; i++) {
      const c = characters[i]
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
    return char.chaId ? `${char.chaId}:${char.index}` : `legacy-${char.index}`
  }
</script>

<script lang="ts">
  import { changeChar, getCharImage, removeChar } from '../../ts/characters'
  import {
    charactersResourceState,
    getCharacterResourceOwner,
    getResourceDatabase as getDatabase,
  } from 'src/ts/server/resourceState.svelte'
  import BarIcon from '../SideBars/BarIcon.svelte'
  import { ArrowLeft, User, SquareMousePointer, TrashIcon, Undo2Icon } from '@lucide/svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { parseMultilangString } from 'src/ts/util'
  import MobileCharacters from '../Mobile/MobileCharacters.svelte'
  import {
    currentCharacterRowSnapshot,
    dispatchUpdateCharacterScopedWithOutcome,
    type CharacterMutationOutcome,
  } from 'src/ts/characterCommands'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'
  import { prefetchCharacterRouteResource } from 'src/ts/server/routeResourceLoader'
  import { alertError, alertNormal } from 'src/ts/alert'
  import { onDestroy } from 'svelte'
  interface Props {
    endGrid?: any
  }

  let { endGrid = () => {} }: Props = $props()
  let search = $state('')
  let selected = $state(3)
  let normalizedSearch = $derived(normalizeGridCatalogSearch(search))
  let catalogCharacters = $derived(
    formatGridCatalogCharacterListsFromCharacters(readCharacterOwners(), normalizedSearch),
  )
  let selectedCharacterIndex = $derived(
    charactersResourceState.status === 'ready' ? charactersResourceState.currentChar : $selectedCharID,
  )
  let selectedListKind = $derived(
    selected === 0 ? 'grid' : selected === 1 ? 'list' : selected === 2 ? 'trash' : 'simple',
  )
  let catalogCount = $derived(
    selectedListKind === 'trash' ? catalogCharacters.trash.length : catalogCharacters.active.length,
  )
  type CharacterCatalogActionKind = 'remove' | 'restore' | 'delete-permanent'
  interface CharacterCatalogActionState {
    kind: CharacterCatalogActionKind
    name: string
    status: 'pending' | 'queued' | 'failed'
    reason?: string
  }
  let characterCatalogActions = $state<Record<string, CharacterCatalogActionState>>({})
  let mounted = true

  onDestroy(() => {
    mounted = false
  })

  function characterCatalogActionMessage(state: CharacterCatalogActionState): string {
    if (state.kind === 'restore') {
      if (state.status === 'pending') return language.characterRestorePending(state.name)
      if (state.status === 'queued') return language.characterRestoreQueued(state.name)
      if (state.reason === 'missing-character-id') return language.characterRestoreUnavailable(state.name)
      return language.characterRestoreFailed(state.name)
    }
    if (state.kind === 'delete-permanent') {
      if (state.status === 'pending') return language.characterPermanentDeletePending(state.name)
      if (state.status === 'queued') return language.characterPermanentDeleteQueued(state.name)
      return language.characterPermanentDeleteFailed(state.name)
    }
    if (state.status === 'pending') return language.characterRemovalPending(state.name)
    if (state.status === 'queued') return language.characterRemovalQueued(state.name)
    return language.characterRemovalFailed(state.name)
  }

  async function runCharacterCatalogAction(
    char: GridCatalogCharacter,
    kind: CharacterCatalogActionKind,
    action: () => Promise<CharacterMutationOutcome | null>,
  ): Promise<void> {
    const actionId = gridCatalogCharacterKey(char)
    if (characterCatalogActions[actionId]?.status === 'pending') return
    characterCatalogActions[actionId] = { kind, name: char.name, status: 'pending' }
    try {
      const outcome = await action()
      if (!mounted) return
      if (!outcome) {
        delete characterCatalogActions[actionId]
        return
      }
      if (outcome.status === 'accepted') {
        delete characterCatalogActions[actionId]
        return
      }
      characterCatalogActions[actionId] = {
        kind,
        name: char.name,
        status: outcome.status,
        reason: outcome.result.status === 'error' ? outcome.result.error : undefined,
      }
      const message = characterCatalogActionMessage(characterCatalogActions[actionId])
      if (outcome.status === 'queued') alertNormal(message)
      else alertError(message)
    } catch {
      if (!mounted) return
      characterCatalogActions[actionId] = { kind, name: char.name, status: 'failed' }
      alertError(characterCatalogActionMessage(characterCatalogActions[actionId]))
    }
  }

  function resolveGridCatalogDescription(
    creatorNotes: string,
    preferredLanguage: string | undefined,
    fallback = 'No description',
  ) {
    const descriptions = parseMultilangString(creatorNotes)
    const languageOrder = [preferredLanguage, 'en', 'xx', ...Object.keys(descriptions)]
    const visitedLanguages = new Set<string>()

    for (const languageCode of languageOrder) {
      if (!languageCode || visitedLanguages.has(languageCode)) continue
      visitedLanguages.add(languageCode)

      const description = descriptions[languageCode]?.trim()
      if (description) return description
    }

    return fallback
  }

  function readCharacterOwners(): readonly Database['characters'][number][] {
    const owners = charactersResourceState.characters
    if (owners.length > 0 || charactersResourceState.status === 'ready') return owners
    return getDatabase().characters ?? []
  }

  function uniqueCharacterOwner(characterId: string) {
    if (charactersResourceState.status === 'ready') {
      const character = getCharacterResourceOwner(characterId)
      const index = character ? charactersResourceState.characters.indexOf(character) : -1
      return character && index >= 0 ? { character, index } : undefined
    }

    let owner: { character: Database['characters'][number]; index: number } | undefined
    for (const [index, character] of readCharacterOwners().entries()) {
      if (character?.chaId !== characterId) continue
      if (owner) return undefined
      owner = { character, index }
    }
    return owner
  }

  function resolveCatalogCharacterOwner(char: GridCatalogCharacter) {
    if (char.chaId) return uniqueCharacterOwner(char.chaId)
    const character = readCharacterOwners()[char.index]
    return character && !character.chaId ? { character, index: char.index } : undefined
  }

  function isSelectedCatalogCharacter(char: GridCatalogCharacter): boolean {
    if (char.index !== selectedCharacterIndex) return false
    return !char.chaId || uniqueCharacterOwner(char.chaId)?.index === char.index
  }

  function prefetchCatalogCharacter(char: GridCatalogCharacter): void {
    const characterId = resolveCatalogCharacterOwner(char)?.character.chaId
    if (characterId) prefetchCharacterRouteResource(characterId)
  }

  function openCharacterRoute(char: GridCatalogCharacter) {
    const owner = resolveCatalogCharacterOwner(char)
    if (!owner) return
    const { character, index } = owner
    if (!character.chaId) {
      changeChar(index)
      return
    }
    navigate(characterRoutePath(character.chaId, character.chats?.[character.chatPage]?.id))
  }

  async function removeCatalogCharacter(
    char: GridCatalogCharacter,
    type: 'normal' | 'permanent' = 'normal',
  ): Promise<CharacterMutationOutcome | null> {
    const owner = resolveCatalogCharacterOwner(char)
    if (!owner) return null
    return removeChar(owner.index, char.name, type)
  }

  async function restoreTrashedCharacter(char: GridCatalogCharacter): Promise<CharacterMutationOutcome | null> {
    const owner = resolveCatalogCharacterOwner(char)
    if (!owner) return null
    const { character, index } = owner

    const characterId = character.chaId
    if (!characterId) {
      return { status: 'failed', result: { status: 'error', error: 'missing-character-id' } }
    }
    const previous = currentCharacterRowSnapshot(index)
    let applied = false
    withTrustedResourceWrite(() => {
      const liveCharacter = uniqueCharacterOwner(characterId)?.character as
        | (typeof character & { trashTime?: number | null })
        | undefined
      if (!liveCharacter) return
      liveCharacter.trashTime = null
      applied = true
    })
    if (applied) {
      return (await dispatchUpdateCharacterScopedWithOutcome(characterId, { trashTime: null }, previous)) ?? null
    }
    return null
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
      {#each Object.entries(characterCatalogActions).filter(([, state]) => state.status === 'failed') as [actionId, state] (actionId)}
        <p
          class="mt-2 text-sm text-textcolor2"
          data-risu-character-action-status={state.status}
          data-risu-row-id={actionId}
          role="status"
          aria-live="polite">
          {characterCatalogActionMessage(state)}
        </p>
      {/each}
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
              data-risu-selected={isSelectedCatalogCharacter(char) ? 'true' : 'false'}
              onpointerenter={() => prefetchCatalogCharacter(char)}
              onfocusin={() => prefetchCatalogCharacter(char)}
              role="group"
              aria-current={isSelectedCatalogCharacter(char) ? 'true' : undefined}>
              {#if char.image}
                <span data-risu-grid-action="open">
                  <BarIcon
                    ariaLabel={language.openCharacter(char.name)}
                    onClick={() => {
                      openCharacterRoute(char)
                    }}
                    additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
                </span>
              {:else}
                <span data-risu-grid-action="open">
                  <BarIcon
                    ariaLabel={language.openCharacter(char.name)}
                    onClick={() => {
                      openCharacterRoute(char)
                    }}
                    additionalStyle={isSelectedCatalogCharacter(char) ? 'background:var(--risu-theme-selected)' : ''}>
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
            data-risu-selected={isSelectedCatalogCharacter(char) ? 'true' : 'false'}
            onpointerenter={() => prefetchCatalogCharacter(char)}
            onfocusin={() => prefetchCatalogCharacter(char)}
            role="group"
            aria-current={isSelectedCatalogCharacter(char) ? 'true' : undefined}>
            <span data-risu-grid-action="open">
              <BarIcon
                ariaLabel={language.openCharacter(char.name)}
                onClick={() => {
                  openCharacterRoute(char)
                }}
                additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
            </span>
            <div class="flex-1 flex flex-col ml-2">
              <h4 class="text-textcolor font-bold text-lg mb-1" data-risu-character-name>
                {char.name || 'Unnamed'}
              </h4>
              <span class="text-textcolor2" data-risu-character-description
                >{resolveGridCatalogDescription(char.desc, getDatabase().language)}</span>
              <div class="flex gap-2 justify-end">
                <button
                  data-risu-grid-action="open"
                  aria-label={language.openCharacter(char.name)}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    openCharacterRoute(char)
                  }}>
                  <SquareMousePointer />
                </button>
                <button
                  data-risu-grid-action="delete"
                  data-risu-mutation-status={characterCatalogActions[gridCatalogCharacterKey(char)]?.status ?? 'idle'}
                  aria-label={`${language.removeCharacter}: ${char.name}`}
                  aria-busy={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  disabled={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    void runCharacterCatalogAction(char, 'remove', () => removeCatalogCharacter(char))
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
            data-risu-selected={isSelectedCatalogCharacter(char) ? 'true' : 'false'}
            aria-current={isSelectedCatalogCharacter(char) ? 'true' : undefined}>
            <span data-risu-grid-action="open">
              <BarIcon
                ariaLabel={language.openCharacter(char.name)}
                onClick={() => {
                  openCharacterRoute(char)
                }}
                additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
            </span>
            <div class="flex-1 flex flex-col ml-2">
              <h4 class="text-textcolor font-bold text-lg mb-1" data-risu-character-name>
                {char.name || 'Unnamed'}
              </h4>
              <span class="text-textcolor2" data-risu-character-description
                >{resolveGridCatalogDescription(char.desc, getDatabase().language)}</span>
              <div class="flex gap-2 justify-end">
                <button
                  data-risu-grid-action="restore"
                  data-risu-mutation-status={characterCatalogActions[gridCatalogCharacterKey(char)]?.status ?? 'idle'}
                  aria-label={language.restoreCharacter(char.name)}
                  aria-busy={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  disabled={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    void runCharacterCatalogAction(char, 'restore', () => restoreTrashedCharacter(char))
                  }}>
                  <Undo2Icon />
                </button>
                <button
                  data-risu-grid-action="delete-permanent"
                  data-risu-mutation-status={characterCatalogActions[gridCatalogCharacterKey(char)]?.status ?? 'idle'}
                  aria-label={language.deleteCharacterPermanently(char.name)}
                  aria-busy={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  disabled={characterCatalogActions[gridCatalogCharacterKey(char)]?.status === 'pending'}
                  class="hover:text-textcolor text-textcolor2"
                  onclick={() => {
                    void runCharacterCatalogAction(char, 'delete-permanent', () =>
                      removeCatalogCharacter(char, 'permanent'),
                    )
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
