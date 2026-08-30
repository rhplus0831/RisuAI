<script lang="ts">
  import { selectedCharID } from 'src/ts/stores.svelte'
  import { getDatabase, type loreBook } from 'src/ts/storage/database.svelte'
  import LoreBookData, { type LorebookDeletionTarget } from './LoreBookData.svelte'
  import Sortable from 'sortablejs/modular/sortable.core.esm.js'
  import { onDestroy, onMount, tick } from 'svelte'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { v4 } from 'uuid'
  import { alertError, alertNormal } from 'src/ts/alert'
  import { language } from '../../../lang'
  import {
    applyLorebookEntryDraftEdit,
    flushPendingLorebookEntryDraftEdit,
    replaceCharacterLorebookCollectionWithOutcome,
    replaceChatLorebookCollectionWithOutcome,
    replaceGlobalLorebookEntryCollectionWithOutcome,
    type ScopedLorebookMutationOperation,
  } from 'src/ts/server/lorebookBridge.svelte'
  import {
    findScopedLorebookCollectionMutationUiState,
    scopedLorebookMutationUiStates,
    scopedLorebookMutationUiStatesForDisplayScope,
    trackScopedLorebookMutationUiOperation,
    type ScopedLorebookMutationUiState,
  } from 'src/ts/server/scopedLorebookMutationUiState'
  import { lorebookPageIndexFromSnapshot, lorebookPageOwnerState } from 'src/ts/server/lorebookPageOwner.svelte'

  let reinitializeSortable = false

  interface Props {
    globalMode?: boolean
    submenu?: number
    lorePlus?: boolean
    externalLoreBooks?: loreBook[]
    showFolder?: string
    onCollectionChange?: (entries: loreBook[]) => void
    onEntryChange?: (index: number, entry: loreBook) => void
    onEntrySettled?: (index: number) => void
    entryDraftScopeKey?: string
    mutationLocked?: boolean
  }

  let {
    globalMode = false,
    submenu = 0,
    lorePlus = false,
    externalLoreBooks = $bindable(null),
    showFolder = '',
    onCollectionChange = (entries: loreBook[]) => {
      externalLoreBooks = entries
    },
    onEntryChange = (index: number, entry: loreBook) => {
      const entries = [...(externalLoreBooks ?? [])]
      entries[index] = entry
      updateExternalCollection(entries)
    },
    onEntrySettled = () => {},
    entryDraftScopeKey = undefined,
    mutationLocked = false,
  }: Props = $props()
  let stb: Sortable = null
  let ele: HTMLDivElement = $state()
  let sorted = $state(0)
  let idgroup = 'a' + v4()
  let destroyed = false

  function destroyStb(): void {
    if (!stb) return
    try {
      stb.destroy()
    } catch (error) {}
    stb = null
  }

  function selectedCharacter() {
    return getDatabase().characters?.[$selectedCharID]
  }

  function selectedChat() {
    const character = selectedCharacter()
    return character?.chats?.[character.chatPage ?? 0]
  }

  function characterGlobalLore(): loreBook[] {
    return selectedCharacter()?.globalLore ?? []
  }

  function chatLocalLore(): loreBook[] {
    return selectedChat()?.localLore ?? []
  }

  function globalLorebookEntries(): loreBook[] {
    const database = getDatabase()
    const page = lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0
    return database.loreBook?.[page]?.data ?? []
  }

  function selectedGlobalLorebookId(): string | null {
    const database = getDatabase()
    const page = lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0
    const lorebookId = (database.loreBook?.[page] as { id?: unknown } | undefined)?.id
    return typeof lorebookId === 'string' && lorebookId.trim() ? lorebookId : null
  }

  function internalEntryDraftScopeKey(): string | undefined {
    if (externalLoreBooks) return undefined
    if (globalMode) {
      const lorebookId = selectedGlobalLorebookId()
      return lorebookId ? `global:${lorebookId}` : undefined
    }
    if (submenu === 0) {
      const characterId = selectedCharacter()?.chaId
      return characterId ? `character:${characterId}` : undefined
    }
    if (submenu === 1) {
      const chatId = selectedChat()?.id
      return chatId ? `chat:${chatId}` : undefined
    }
    return undefined
  }

  let resolvedEntryDraftScopeKey = $derived(entryDraftScopeKey ?? internalEntryDraftScopeKey())
  let collectionMutationState = $derived(
    findScopedLorebookCollectionMutationUiState($scopedLorebookMutationUiStates, resolvedEntryDraftScopeKey),
  )
  let collectionMutationStatus = $derived(collectionMutationState?.status ?? 'idle')
  let displayedMutationStates = $derived(
    scopedLorebookMutationUiStatesForDisplayScope($scopedLorebookMutationUiStates, resolvedEntryDraftScopeKey),
  )
  let collectionMutationBlocked = $derived(mutationLocked || collectionMutationStatus === 'pending')

  function trackCollectionMutation(operation: ScopedLorebookMutationOperation | null): void {
    trackScopedLorebookMutationUiOperation({
      operation,
      kind: 'collection',
      onQueued: () => alertNormal(language.scopedLorebookMutation.queued),
      onFailed: (error) => alertError(language.scopedLorebookMutation.failed(error)),
    })
  }

  function mutationStatusText(state: ScopedLorebookMutationUiState): string {
    if (state.status === 'pending') return language.scopedLorebookMutation.pending
    if (state.context === 'local-activation-cleanup') {
      return state.status === 'queued'
        ? language.scopedLorebookMutation.localActivationCleanupQueued
        : language.scopedLorebookMutation.localActivationCleanupFailed(state.error ?? '')
    }
    return state.status === 'queued'
      ? language.scopedLorebookMutation.queued
      : language.scopedLorebookMutation.failed(state.error ?? '')
  }

  function cloneLoreBooks(entries: loreBook[]): loreBook[] {
    return JSON.parse(JSON.stringify(entries ?? []))
  }

  function updateExternalCollection(entries: loreBook[]): void {
    const cloned = cloneLoreBooks(entries)
    externalLoreBooks = cloned
    onCollectionChange(cloned)
  }

  function updateExternalLoreValue(index: number, value: loreBook): void {
    onEntryChange(index, value)
  }

  interface LorebookDeletionResolution {
    nextEntries: loreBook[]
    removedEntries: loreBook[]
  }

  function stableEntryId(entry: { id?: string } | undefined): string | null {
    return typeof entry?.id === 'string' && entry.id.trim() ? entry.id : null
  }

  type LorebookOpenRef = string | loreBook

  function openedRefForEntry(entry: loreBook): LorebookOpenRef {
    const entryId = stableEntryId(entry)
    if (entryId) return `entry:${entryId}`
    if (entry.mode === 'folder' && typeof entry.key === 'string' && entry.key.trim()) {
      return `folder:${entry.key}`
    }
    // Legacy id-less rows cannot be matched safely after cloning without
    // risking that open state transfers to a reordered sibling.
    return entry
  }

  function globalEntryRenderKey(lorebookId: string | null, entries: loreBook[], entry: loreBook): LorebookOpenRef {
    const entryId = stableEntryId(entry)
    if (entryId && entries.filter((candidate) => stableEntryId(candidate) === entryId).length === 1) {
      return `global:${lorebookId ?? ''}:entry:${entryId}`
    }
    if (entry.mode === 'folder' && typeof entry.key === 'string' && entry.key.trim()) {
      const matchingFolders = entries.filter((candidate) => candidate.mode === 'folder' && candidate.key === entry.key)
      if (matchingFolders.length === 1) return `global:${lorebookId ?? ''}:folder:${entry.key}`
    }
    return entry
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function snapshotsMatch(entry: loreBook | undefined, snapshot: loreBook): boolean {
    return Boolean(entry) && snapshotJson(entry) === snapshotJson(snapshot)
  }

  function resolveLorebookDeletionIndex(entries: loreBook[], target: LorebookDeletionTarget): number {
    const targetId = stableEntryId(target)
    if (targetId) {
      return entries.findIndex((entry) => stableEntryId(entry) === targetId)
    }

    if (target.mode === 'folder') {
      const folderKey = target.folderKey ?? ''
      const matchingFolderIndexes = entries.reduce<number[]>((matches, entry, index) => {
        if (entry.mode === 'folder' && entry.key === folderKey) {
          matches.push(index)
        }
        return matches
      }, [])
      if (matchingFolderIndexes.length === 1) {
        return matchingFolderIndexes[0]
      }
    }

    return snapshotsMatch(entries[target.index], target.snapshot) ? target.index : -1
  }

  function resolveLorebookDeletion(
    latestEntries: loreBook[] | undefined,
    target: LorebookDeletionTarget,
  ): LorebookDeletionResolution | null {
    const entries = latestEntries ?? []
    const resolvedIndex = resolveLorebookDeletionIndex(entries, target)
    if (resolvedIndex < 0) return null

    const resolvedEntry = entries[resolvedIndex]
    if (!resolvedEntry) return null
    if (target.mode === 'folder' && resolvedEntry.mode !== 'folder') return null
    if (target.mode !== 'folder' && resolvedEntry.mode === 'folder') return null

    if (target.mode === 'folder') {
      const resolvedFolderKey = resolvedEntry.key ?? ''
      const removedEntries = entries.filter(
        (entry, index) => index === resolvedIndex || entry.folder === resolvedFolderKey,
      )
      const nextEntries = entries.filter(
        (entry, index) => index !== resolvedIndex && entry.folder !== resolvedFolderKey,
      )
      return { nextEntries, removedEntries }
    }

    const nextEntries = [...entries]
    const removedEntries = nextEntries.splice(resolvedIndex, 1)
    return { nextEntries, removedEntries }
  }

  function closeRemovedLorebookRefs(removedEntries: loreBook[]): void {
    for (const entry of removedEntries) {
      if (!openedRefs.has(openedRefForEntry(entry))) continue
      onClose(entry.mode !== 'folder', entry)
    }
  }

  function removeLorebookTarget(
    latestEntries: loreBook[] | undefined,
    target: LorebookDeletionTarget,
    updateCollection: (entries: loreBook[]) => void,
  ): void {
    const resolution = resolveLorebookDeletion(latestEntries, target)
    if (!resolution) return

    closeRemovedLorebookRefs(resolution.removedEntries)
    updateCollection(resolution.nextEntries)
  }

  function updateCharacterGlobalLoreValue(index: number, value: loreBook): void {
    const characterId = selectedCharacter()?.chaId
    if (!characterId) return
    applyLorebookEntryDraftEdit({ kind: 'character', characterId }, index, value)
  }

  function flushCharacterGlobalLoreValue(): void {
    const characterId = selectedCharacter()?.chaId
    if (!characterId) return
    flushPendingLorebookEntryDraftEdit({ kind: 'character', characterId })
  }

  function updateCharacterGlobalLoreCollection(entries: loreBook[]): void {
    const characterId = selectedCharacter()?.chaId
    if (!characterId) return
    trackCollectionMutation(replaceCharacterLorebookCollectionWithOutcome(characterId, entries))
  }

  function updateChatLoreValue(index: number, value: loreBook): void {
    const chat = selectedChat()
    if (!chat?.id) return
    applyLorebookEntryDraftEdit({ kind: 'chat', chatId: chat.id }, index, value)
  }

  function flushChatLoreValue(): void {
    const chat = selectedChat()
    if (!chat?.id) return
    flushPendingLorebookEntryDraftEdit({ kind: 'chat', chatId: chat.id })
  }

  function updateChatLoreCollection(entries: loreBook[]): void {
    const chatId = selectedChat()?.id
    if (!chatId) return
    trackCollectionMutation(replaceChatLorebookCollectionWithOutcome(chatId, entries))
  }

  function updateGlobalLoreValue(lorebookId: string | null, index: number, value: loreBook): void {
    if (!lorebookId) return
    applyLorebookEntryDraftEdit({ kind: 'global', lorebookId }, index, value)
  }

  function flushGlobalLoreValue(lorebookId: string | null): void {
    if (!lorebookId) return
    flushPendingLorebookEntryDraftEdit({ kind: 'global', lorebookId })
  }

  function updateGlobalLorebookCollection(entries: loreBook[], lorebookId = selectedGlobalLorebookId()): void {
    if (!lorebookId) return
    trackCollectionMutation(replaceGlobalLorebookEntryCollectionWithOutcome(lorebookId, entries))
  }

  const waitForDOMReady = async () => {
    await tick()

    await new Promise((resolve) => requestAnimationFrame(resolve))

    if (!ele || !ele.isConnected) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (!ele || !ele.isConnected) {
        throw new Error('Container element is not ready')
      }
    }

    let expectedElements = 0
    if (externalLoreBooks) {
      expectedElements = externalLoreBooks.filter(
        (item) => (!showFolder && !item.folder) || showFolder === item.folder,
      ).length
    } else if (submenu === 1) {
      expectedElements = chatLocalLore().filter(
        (item) => (!showFolder && !item.folder) || showFolder === item.folder,
      ).length
    } else if (globalMode) {
      expectedElements = globalLorebookEntries().filter(
        (item) => (!showFolder && !item.folder) || showFolder === item.folder,
      ).length
    } else {
      expectedElements = characterGlobalLore().filter(
        (item) => (!showFolder && !item.folder) || showFolder === item.folder,
      ).length
    }

    // Wait until filtered children finish rendering, capped at 200ms.
    let attempts = 0
    const maxAttempts = 20
    while (ele.children.length < expectedElements && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      attempts++
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  const recreateStb = async () => {
    if (destroyed) return
    destroyStb()

    sorted += 1

    try {
      await waitForDOMReady()
    } catch (error) {
      console.warn('DOM stabilization failed:', error)
      // Fallback to short fixed wait
      await sleep(100)
    }

    // Drag stays disabled while a lorebook detail is open.
    if (openedDetails === 0 && !collectionMutationBlocked) {
      try {
        createStb()
      } catch (error) {
        console.error('Failed to recreate sortable:', error)
        await sleep(50)
        try {
          createStb()
        } catch (retryError) {
          console.error('Retry failed:', retryError)
        }
      }
    }
  }

  const createStb = () => {
    if (destroyed || !ele || openedDetails > 0 || collectionMutationBlocked || stb) return
    stb = Sortable.create(ele, {
      ...sortableOptions,
      group: 'lorebook',
      swapThreshold: 0.9,
      preventOnFilter: false,
      animation: 150,
      chosenClass: 'risu-chosen-item',
      ghostClass: 'risu-ghost-item',

      onEnd: async (evt) => {
        if (collectionMutationBlocked) {
          await recreateStb()
          return
        }
        if (!evt.from || !evt.to) {
          alertError("Error: 'evt.from' or 'evt.to' is null")
          await recreateStb()
          return
        }

        if (evt.oldIndex === undefined || evt.newIndex === undefined) {
          alertError('Error: oldIndex or newIndex is undefined')
          await recreateStb()
          return
        }

        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) {
          await recreateStb()
          return
        }

        // Revert SortableJS DOM movement so Svelte can re-render from data.
        const originalParent = evt.from
        const originalIndex = evt.oldIndex

        if (originalParent && evt.item.parentNode !== originalParent) {
          const referenceNode = originalParent.children[originalIndex]
          if (referenceNode) {
            originalParent.insertBefore(evt.item, referenceNode)
          } else {
            originalParent.appendChild(evt.item)
          }
        }

        const sourceFolder = evt.from.getAttribute('data-show-folder') || ''
        const targetFolder = evt.to.getAttribute('data-show-folder') || ''
        const oldIndex = evt.oldIndex
        const newIndex = evt.newIndex

        let currentArray: loreBook[]
        if (externalLoreBooks) {
          currentArray = externalLoreBooks
        } else if (submenu === 1) {
          currentArray = chatLocalLore()
        } else if (globalMode) {
          currentArray = globalLorebookEntries()
        } else {
          currentArray = characterGlobalLore()
        }

        const sourceIdx = oldIndex

        let realSourceIdx = sourceIdx

        if (realSourceIdx === undefined || realSourceIdx === null || realSourceIdx < 0) return
        const movedItem = currentArray[realSourceIdx]
        if (!movedItem) return

        const newArray = [...currentArray]
        const updatedMovedItem = { ...movedItem }
        let moveFolder = false

        if (sourceFolder !== targetFolder) {
          if (targetFolder) {
            updatedMovedItem.folder = targetFolder
          } else {
            delete updatedMovedItem.folder
          }
          moveFolder = true
        }

        let finalNewIndex = newIndex
        if (moveFolder && oldIndex < newIndex) {
          finalNewIndex -= 1
        }

        newArray.splice(realSourceIdx, 1)

        let adjustedFinalIndex = finalNewIndex

        if (adjustedFinalIndex > newArray.length) {
          adjustedFinalIndex = newArray.length
        }

        newArray.splice(adjustedFinalIndex, 0, updatedMovedItem)

        const sortedArray = []
        const processedItems = new Set()

        // Keep folder children immediately after their folder while preserving order.
        for (const item of newArray) {
          if (processedItems.has(item)) continue

          sortedArray.push(item)
          processedItems.add(item)

          if (item.mode === 'folder') {
            for (const subItem of newArray) {
              if (processedItems.has(subItem)) continue
              if (subItem.folder === item.key) {
                sortedArray.push(subItem)
                processedItems.add(subItem)
              }
            }
          }
        }

        newArray.splice(0, newArray.length, ...sortedArray)

        if (externalLoreBooks) {
          updateExternalCollection(newArray)
        } else if (submenu === 1) {
          updateChatLoreCollection(newArray)
        } else if (globalMode) {
          updateGlobalLorebookCollection(newArray)
        } else {
          updateCharacterGlobalLoreCollection(newArray)
        }

        await recreateStb()
      },
    })
  }

  onMount(createStb)

  let openedDetails = 0 // Count only lorebook details (for drag deactivation)
  let openedRefs = $state(new Set<LorebookOpenRef>()) // Track both folders + lorebooks (for UI state)
  let openedOwner: string | undefined
  let openedOwnerInitialized = false

  $effect(() => {
    if (collectionMutationBlocked) {
      destroyStb()
    } else if (openedDetails === 0) {
      createStb()
    }
  })

  $effect(() => {
    const nextOwner = resolvedEntryDraftScopeKey
    if (!openedOwnerInitialized) {
      openedOwnerInitialized = true
      openedOwner = nextOwner
      return
    }
    if (nextOwner === openedOwner) return
    openedOwner = nextOwner
    openedDetails = 0
    openedRefs = new Set()
    destroyStb()
    createStb()
  })

  $effect(() => {
    const entries = externalLoreBooks
      ? externalLoreBooks
      : globalMode
        ? globalLorebookEntries()
        : submenu === 1
          ? chatLocalLore()
          : characterGlobalLore()
    const liveRefs = new Set(entries.map(openedRefForEntry))
    const retainedRefs = new Set(Array.from(openedRefs).filter((ref) => liveRefs.has(ref)))
    const refsChanged = retainedRefs.size !== openedRefs.size
    const expectedOpenedDetails = entries.filter(
      (entry) => entry.mode !== 'folder' && retainedRefs.has(openedRefForEntry(entry)),
    ).length
    const detailsChanged = expectedOpenedDetails !== openedDetails
    if (!refsChanged && !detailsChanged) return

    openedRefs = retainedRefs
    openedDetails = expectedOpenedDetails
    if (openedDetails === 0) createStb()
    else destroyStb()
  })

  let openFolders = $derived(() => {
    let count = 0
    for (const ref of openedRefs) {
      if (typeof ref === 'string') {
        if (ref.startsWith('folder:')) count++
        continue
      }
      if (ref && typeof ref === 'object' && 'mode' in ref && ref.mode === 'folder') {
        count++
      }
    }
    return count
  })

  const onOpen = (isDetail: boolean = true, bookRef?: any) => {
    if (destroyed) return
    if (isDetail) {
      openedDetails += 1
      destroyStb()
    }
    if (bookRef) {
      openedRefs.add(openedRefForEntry(bookRef))
      openedRefs = new Set(openedRefs)
    }
  }
  const onClose = (isDetail: boolean = true, bookRef?: any) => {
    if (isDetail) {
      openedDetails = Math.max(0, openedDetails - 1)
      if (openedDetails === 0 && !destroyed) {
        createStb()
      }
    }
    if (bookRef) {
      openedRefs.delete(openedRefForEntry(bookRef))
      openedRefs = new Set(openedRefs)
    }
  }

  onDestroy(() => {
    destroyed = true
    destroyStb()
  })
</script>

{#each displayedMutationStates.filter((mutationState) => mutationState.status === 'failed') as mutationState (mutationState.key)}
  <p
    class="m-0 mb-2 text-xs"
    class:text-red-400={mutationState.status === 'failed'}
    class:text-textcolor2={mutationState.status !== 'failed'}
    data-risu-lorebook-persistence={mutationState.status}
    data-risu-lorebook-mutation-kind={mutationState.kind}
    data-risu-lorebook-mutation-context={mutationState.context}
    data-risu-lorebook-mutation-scope={mutationState.scopeKey}
    data-risu-lorebook-mutation-entry={mutationState.entryId ?? ''}
    role={mutationState.status === 'failed' ? 'alert' : 'status'}
    aria-live={mutationState.status === 'failed' ? 'assertive' : 'polite'}>
    {mutationStatusText(mutationState)}
  </p>
{/each}
{#key sorted}
  <div
    class="border-solid border-selected p-2 flex flex-col border-1 rounded-md"
    bind:this={ele}
    data-show-folder={showFolder || ''}
    data-risu-lorebook-persistence={collectionMutationStatus}
    aria-busy={collectionMutationBlocked}>
    {#if globalMode}
      {@const lorebookId = selectedGlobalLorebookId()}
      {@const entries = globalLorebookEntries()}
      {@const visibleItems = entries.filter((book) => (!showFolder && !book.folder) || showFolder === book.folder)}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if entries.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each entries as book, i (globalEntryRenderKey(lorebookId, entries, book))}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              entryDraftScopeKey={resolvedEntryDraftScopeKey}
              mutationLocked={collectionMutationBlocked}
              value={entries[i]}
              onDraftChange={(value) => updateGlobalLoreValue(lorebookId, i, value)}
              onDraftSettled={() => flushGlobalLoreValue(lorebookId)}
              idx={i}
              isOpen={openedRefs.has(openedRefForEntry(book))}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={(target) =>
                removeLorebookTarget(entries, target, (nextEntries) =>
                  updateGlobalLorebookCollection(nextEntries, lorebookId),
                )}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              externalLoreBooks={entries}
              onCollectionChange={(nextEntries) => updateGlobalLorebookCollection(nextEntries, lorebookId)}
              onEntryChange={(index, value) => updateGlobalLoreValue(lorebookId, index, value)}
              onEntrySettled={() => flushGlobalLoreValue(lorebookId)} />
          {:else}
            <!-- Hidden marker for filtered items (for SortableJS) -->
            <div data-risu-idx={i} data-risu-idgroup={idgroup} style="display: none;"></div>
          {/if}
        {/each}
      {/if}
    {:else if externalLoreBooks}
      {@const visibleItems = externalLoreBooks.filter(
        (book) => (!showFolder && !book.folder) || showFolder === book.folder,
      )}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if externalLoreBooks.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each externalLoreBooks as book, i}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              entryDraftScopeKey={resolvedEntryDraftScopeKey}
              mutationLocked={collectionMutationBlocked}
              value={externalLoreBooks[i]}
              onDraftChange={(value) => updateExternalLoreValue(i, value)}
              onDraftSettled={() => onEntrySettled(i)}
              idx={i}
              isOpen={openedRefs.has(openedRefForEntry(book))}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={(target) => removeLorebookTarget(externalLoreBooks, target, updateExternalCollection)}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              {externalLoreBooks}
              {onCollectionChange}
              {onEntryChange}
              {onEntrySettled} />
          {:else}
            <!-- Hidden marker for filtered items (for SortableJS) -->
            <div data-risu-idx={i} data-risu-idgroup={idgroup} style="display: none;"></div>
          {/if}
        {/each}
      {/if}
    {:else if submenu === 0}
      {@const entries = characterGlobalLore()}
      {@const visibleItems = entries.filter((book) => (!showFolder && !book.folder) || showFolder === book.folder)}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if entries.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each entries as book, i}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              entryDraftScopeKey={resolvedEntryDraftScopeKey}
              mutationLocked={collectionMutationBlocked}
              value={entries[i]}
              onDraftChange={(value) => updateCharacterGlobalLoreValue(i, value)}
              onDraftSettled={flushCharacterGlobalLoreValue}
              idx={i}
              isOpen={openedRefs.has(openedRefForEntry(book))}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={(target) => removeLorebookTarget(entries, target, updateCharacterGlobalLoreCollection)}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              {lorePlus}
              externalLoreBooks={entries}
              onCollectionChange={updateCharacterGlobalLoreCollection}
              onEntryChange={updateCharacterGlobalLoreValue}
              onEntrySettled={flushCharacterGlobalLoreValue} />
          {:else}
            <!-- Hidden marker for filtered items (for SortableJS) -->
            <div data-risu-idx={i} data-risu-idgroup={idgroup} style="display: none;"></div>
          {/if}
        {/each}
      {/if}
    {:else if submenu === 1}
      {@const entries = chatLocalLore()}
      {@const visibleItems = entries.filter((book) => (!showFolder && !book.folder) || showFolder === book.folder)}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if entries.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each entries as book, i}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              entryDraftScopeKey={resolvedEntryDraftScopeKey}
              mutationLocked={collectionMutationBlocked}
              value={entries[i]}
              onDraftChange={(value) => updateChatLoreValue(i, value)}
              onDraftSettled={flushChatLoreValue}
              idx={i}
              isOpen={openedRefs.has(openedRefForEntry(book))}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={(target) => removeLorebookTarget(entries, target, updateChatLoreCollection)}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              {lorePlus}
              externalLoreBooks={entries}
              onCollectionChange={updateChatLoreCollection}
              onEntryChange={updateChatLoreValue}
              onEntrySettled={flushChatLoreValue} />
          {:else}
            <!-- Hidden marker for filtered items (for SortableJS) -->
            <div data-risu-idx={i} data-risu-idgroup={idgroup} style="display: none;"></div>
          {/if}
        {/each}
      {/if}
    {/if}
  </div>
{/key}
