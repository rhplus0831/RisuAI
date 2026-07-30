<script lang="ts">
  import { Check, Folder, User, X } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { language } from 'src/lang'
  import { getCharImage } from 'src/ts/characters'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    buildMoodLightManagementTargets,
    moodLightMembershipFromDatabase,
    moodLightProtectedCharacterIds,
    type MoodLightManagementTarget,
  } from 'src/ts/moodLightMembership'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import BarIcon from './BarIcon.svelte'

  type CharacterTarget = Extract<MoodLightManagementTarget, { kind: 'character' }>
  type FolderTarget = Extract<MoodLightManagementTarget, { kind: 'folder' }>

  interface FolderSection {
    folder: FolderTarget
    children: CharacterTarget[]
  }

  interface TargetGroups {
    rootCharacters: CharacterTarget[]
    folders: FolderSection[]
  }

  interface Props {
    close?: () => void
    onToggle?: (target: MoodLightManagementTarget) => void | Promise<void>
    pending?: boolean
  }

  let { close = () => {}, onToggle = () => {}, pending = false }: Props = $props()
  let search = $state('')
  let searchInput = $state<HTMLInputElement>()

  let targets = $derived(buildMoodLightManagementTargets(getDatabase()))
  let targetGroups = $derived(groupTargets(targets))
  let normalizedSearch = $derived(normalizeSearch(search))
  let filteredGroups = $derived(filterGroups(targetGroups, normalizedSearch))
  let charactersById = $derived(new Map(getDatabase().characters.map((character) => [character.chaId, character])))
  let protectedCharacterIds = $derived(moodLightProtectedCharacterIds(getDatabase()))
  let protectedFolderIds = $derived(
    new Set(moodLightMembershipFromDatabase(getDatabase()).folders.map((folder) => folder.id)),
  )
  let hasResults = $derived(filteredGroups.rootCharacters.length > 0 || filteredGroups.folders.length > 0)

  onMount(() => {
    queueMicrotask(() => searchInput?.focus())
  })

  function normalizeSearch(value: string): string {
    return value.replace(/ /g, '').toLocaleLowerCase()
  }

  function matchesSearch(name: string, normalizedQuery: string): boolean {
    return normalizeSearch(name).includes(normalizedQuery)
  }

  function groupTargets(items: MoodLightManagementTarget[]): TargetGroups {
    const rootCharacters: CharacterTarget[] = []
    const folders: FolderSection[] = []
    let currentFolder: FolderSection | null = null

    for (const target of items) {
      if (target.kind === 'folder') {
        currentFolder = { folder: target, children: [] }
        folders.push(currentFolder)
      } else if (target.folderName && currentFolder) {
        currentFolder.children.push(target)
      } else {
        currentFolder = null
        rootCharacters.push(target)
      }
    }

    return { rootCharacters, folders }
  }

  function filterGroups(groups: TargetGroups, normalizedQuery: string): TargetGroups {
    if (!normalizedQuery) return groups

    const rootCharacters = groups.rootCharacters.filter((target) => matchesSearch(target.name, normalizedQuery))
    const folders = groups.folders.flatMap((section) => {
      if (matchesSearch(section.folder.name, normalizedQuery)) return [section]
      const children = section.children.filter((target) => matchesSearch(target.name, normalizedQuery))
      return children.length > 0 ? [{ ...section, children }] : []
    })
    return { rootCharacters, folders }
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }
</script>

{#snippet selectedBadge()}
  <span
    aria-hidden="true"
    class="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-darkbg bg-[var(--risu-theme-selected)] text-white shadow-sm">
    <Check size={12} strokeWidth={3} />
  </span>
{/snippet}

{#snippet characterTile(target: CharacterTarget)}
  {@const selected = protectedCharacterIds.has(target.id)}
  {@const character = charactersById.get(target.id)}
  <button
    type="button"
    class="flex w-20 flex-col items-center gap-2 rounded-lg p-2 text-textcolor transition-colors hover:bg-selected disabled:cursor-not-allowed disabled:opacity-60 {selected
      ? 'ring-2 ring-[var(--risu-theme-selected)]'
      : 'ring-1 ring-darkborderc'}"
    disabled={pending}
    aria-label={target.name}
    aria-pressed={selected}
    data-risu-mood-light-target="character"
    data-risu-target-id={target.id}
    onclick={() => {
      void onToggle(target)
    }}>
    <span class="relative">
      {#if character?.image}
        {#await getCharImage(character.image, 'css')}
          <BarIcon interactive={false}><User size={28} /></BarIcon>
        {:then avatarStyle}
          <BarIcon interactive={false} additionalStyle={avatarStyle}></BarIcon>
        {/await}
      {:else}
        <BarIcon interactive={false}><User size={28} /></BarIcon>
      {/if}
      {#if selected}
        {@render selectedBadge()}
      {/if}
    </span>
    <span class="w-16 truncate text-center text-xs" title={target.name}>{target.name}</span>
  </button>
{/snippet}

{#snippet folderToggle(target: FolderTarget)}
  {@const selected = protectedFolderIds.has(target.id)}
  <button
    type="button"
    class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-textcolor transition-colors hover:bg-selected disabled:cursor-not-allowed disabled:opacity-60 {selected
      ? 'ring-2 ring-[var(--risu-theme-selected)]'
      : 'ring-1 ring-darkborderc'}"
    disabled={pending}
    aria-label={target.name}
    aria-pressed={selected}
    data-risu-mood-light-target="folder"
    data-risu-target-id={target.id}
    onclick={() => {
      void onToggle(target)
    }}>
    <Folder size={24} />
    {#if selected}
      {@render selectedBadge()}
    {/if}
  </button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  data-risu-mood-light-dialog-root
  class="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black/50 p-4"
  onclick={(event) => {
    if (event.target === event.currentTarget) close()
  }}>
  <div
    use:modalFocusTrap
    class="max-h-[calc(100dvh-2rem)] w-3xl max-w-full overflow-y-auto overscroll-contain rounded-lg border border-darkborderc bg-darkbg p-5 text-textcolor shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label={language.moodLightManage}
    aria-busy={pending}
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <header class="flex items-start gap-4">
      <div class="min-w-0 flex-1">
        <h2 class="m-0 text-xl font-semibold">{language.moodLightManage}</h2>
        <p class="mt-1 text-sm text-textcolor2">{language.moodLightManagePrompt}</p>
      </div>
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
        aria-label={language.close}
        onclick={close}>
        <X size={22} />
      </button>
    </header>

    <div class="mt-4">
      <TextInput
        bind:inputRef={searchInput}
        bind:value={search}
        placeholder={language.search}
        ariaLabel={language.search}
        autocomplete="off"
        fullwidth={true} />
    </div>

    <div class="mt-5 flex flex-col gap-5" data-risu-mood-light-targets>
      {#if filteredGroups.rootCharacters.length > 0}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3" data-risu-mood-light-root-characters>
          {#each filteredGroups.rootCharacters as target (target.id)}
            {@render characterTile(target)}
          {/each}
        </div>
      {/if}

      {#each filteredGroups.folders as section (section.folder.id)}
        <section class="rounded-lg border border-darkborderc p-4" data-risu-mood-light-folder-section>
          <div class="flex items-center gap-3">
            <h3 class="m-0 min-w-0 flex-1 truncate text-base font-semibold" title={section.folder.name}>
              {section.folder.name}
            </h3>
            {@render folderToggle(section.folder)}
          </div>
          {#if section.children.length > 0}
            <div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
              {#each section.children as target (target.id)}
                {@render characterTile(target)}
              {/each}
            </div>
          {/if}
        </section>
      {/each}

      {#if !hasResults}
        <p class="p-6 text-center text-textcolor2" role="status" aria-live="polite">
          {language.noSearchResults}
        </p>
      {/if}
    </div>
  </div>
</div>
