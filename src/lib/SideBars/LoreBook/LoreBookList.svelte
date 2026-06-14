<script lang="ts">
  import { type loreBook } from 'src/ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import LoreBookData from './LoreBookData.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import Sortable from 'sortablejs/modular/sortable.core.esm.js'
  import { onDestroy, onMount, tick } from 'svelte'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { v4 } from 'uuid'
  import { alertError } from 'src/ts/alert'
  import {
    applyLorebookEntryDraftEdit,
    flushPendingLorebookEntryDraftEdit,
    replaceCharacterLorebookCollection,
    replaceChatLorebookCollection,
    replaceGlobalLorebookEntryCollection,
  } from 'src/ts/server/lorebookBridge.svelte'

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
  }: Props = $props()
  let stb: Sortable = null
  let ele: HTMLDivElement = $state()
  let sorted = $state(0)
  let idgroup = 'a' + v4() //make should it starts with alphabetic character

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

  function updateCharacterGlobalLoreValue(index: number, value: loreBook): void {
    const characterId = DBState.db.characters[$selectedCharID]?.chaId
    if (!characterId) return
    applyLorebookEntryDraftEdit({ kind: 'character', characterId }, index, value)
  }

  function flushCharacterGlobalLoreValue(): void {
    const characterId = DBState.db.characters[$selectedCharID]?.chaId
    if (!characterId) return
    flushPendingLorebookEntryDraftEdit({ kind: 'character', characterId })
  }

  function updateCharacterGlobalLoreCollection(entries: loreBook[]): void {
    const characterId = DBState.db.characters[$selectedCharID]?.chaId
    if (!characterId) return
    replaceCharacterLorebookCollection(characterId, entries)
  }

  function updateChatLoreValue(index: number, value: loreBook): void {
    const chat = DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage ?? 0]
    if (!chat?.id) return
    applyLorebookEntryDraftEdit({ kind: 'chat', chatId: chat.id }, index, value)
  }

  function flushChatLoreValue(): void {
    const chat = DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage ?? 0]
    if (!chat?.id) return
    flushPendingLorebookEntryDraftEdit({ kind: 'chat', chatId: chat.id })
  }

  function updateChatLoreCollection(entries: loreBook[]): void {
    const character = DBState.db.characters[$selectedCharID]
    const chatPage = character?.chatPage ?? 0
    const chatId = character?.chats?.[chatPage]?.id
    if (!chatId) return
    replaceChatLorebookCollection(chatId, entries)
  }

  function updateGlobalLorebookCollection(entries: loreBook[]): void {
    const lorebook = DBState.db.loreBook?.[DBState.db.loreBookPage]
    const lorebookId = (lorebook as { id?: string } | undefined)?.id
    if (!lorebookId) return
    replaceGlobalLorebookEntryCollection(lorebookId, entries)
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
      expectedElements = DBState.db.characters[$selectedCharID].chats[
        DBState.db.characters[$selectedCharID].chatPage
      ].localLore.filter((item) => (!showFolder && !item.folder) || showFolder === item.folder).length
    } else if (globalMode) {
      expectedElements = DBState.db.loreBook[DBState.db.loreBookPage].data.filter(
        (item) => (!showFolder && !item.folder) || showFolder === item.folder,
      ).length
    } else {
      expectedElements = DBState.db.characters[$selectedCharID].globalLore.filter(
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
    try {
      stb.destroy()
    } catch (error) {
      // Ignore destroy failure (may already be removed)
    }

    sorted += 1

    try {
      await waitForDOMReady()
    } catch (error) {
      console.warn('DOM stabilization failed:', error)
      // Fallback to short fixed wait
      await sleep(100)
    }

    // Drag stays disabled while a lorebook detail is open.
    if (openedDetails === 0) {
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
    stb = Sortable.create(ele, {
      ...sortableOptions,
      group: 'lorebook',
      swapThreshold: 0.9,
      preventOnFilter: false,
      animation: 150,
      chosenClass: 'risu-chosen-item',
      ghostClass: 'risu-ghost-item',

      onEnd: async (evt) => {
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
          currentArray =
            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore
        } else if (globalMode) {
          currentArray = DBState.db.loreBook[DBState.db.loreBookPage].data
        } else {
          currentArray = DBState.db.characters[$selectedCharID].globalLore
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
  let openedRefs = $state(new Set()) // Track both folders + lorebooks (for UI state)

  let openFolders = $derived(() => {
    let count = 0
    for (const ref of openedRefs) {
      if (ref && typeof ref === 'object' && 'mode' in ref && ref.mode === 'folder') {
        count++
      }
    }
    return count
  })

  const onOpen = (isDetail: boolean = true, bookRef?: any) => {
    if (isDetail) {
      openedDetails += 1
      if (stb) {
        try {
          stb.destroy()
        } catch (error) {}
      }
    }
    if (bookRef) {
      openedRefs.add(bookRef)
      openedRefs = new Set(openedRefs)
    }
  }
  const onClose = (isDetail: boolean = true, bookRef?: any) => {
    if (isDetail) {
      openedDetails -= 1
      if (openedDetails === 0) {
        createStb()
      }
    }
    if (bookRef) {
      openedRefs.delete(bookRef)
      openedRefs = new Set(openedRefs)
    }
  }

  onDestroy(() => {
    if (stb) {
      try {
        stb.destroy()
      } catch (error) {}
    }
  })
</script>

{#key sorted}
  <div
    class="border-solid border-selected p-2 flex flex-col border-1 rounded-md"
    bind:this={ele}
    data-show-folder={showFolder || ''}>
    {#if globalMode}
      <!-- Global lorebooks render elsewhere. -->
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
              value={externalLoreBooks[i]}
              onDraftChange={(value) => updateExternalLoreValue(i, value)}
              onDraftSettled={() => onEntrySettled(i)}
              idx={i}
              isOpen={openedRefs.has(book)}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={() => {
                if (openedRefs.has(book) && !book.folder) {
                  onClose(true, book)
                } else if (openedRefs.has(book) && book.folder) {
                  onClose(false, book)
                }

                let lore = [...externalLoreBooks]

                // When deleting a folder, also delete all items that belong to that folder
                if (book.mode === 'folder') {
                  // Close items belonging to the folder if they are open
                  lore.forEach((item) => {
                    if (item.folder === book.key && openedRefs.has(item)) {
                      onClose(true, item)
                    }
                  })

                  // Filter out the folder and all items belonging to it
                  lore = lore.filter((item) => item !== book && item.folder !== book.key)
                } else {
                  // Delete regular item
                  lore.splice(i, 1)
                }

                updateExternalCollection(lore)
              }}
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
      {@const visibleItems = DBState.db.characters[$selectedCharID].globalLore.filter(
        (book) => (!showFolder && !book.folder) || showFolder === book.folder,
      )}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if DBState.db.characters[$selectedCharID].globalLore.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each DBState.db.characters[$selectedCharID].globalLore as book, i}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              value={DBState.db.characters[$selectedCharID].globalLore[i]}
              onDraftChange={(value) => updateCharacterGlobalLoreValue(i, value)}
              onDraftSettled={flushCharacterGlobalLoreValue}
              idx={i}
              isOpen={openedRefs.has(book)}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={() => {
                if (openedRefs.has(book) && !book.folder) {
                  onClose(true, book)
                } else if (openedRefs.has(book) && book.folder) {
                  onClose(false, book)
                }

                let lore = [...DBState.db.characters[$selectedCharID].globalLore]

                // When deleting a folder, also delete all items that belong to that folder
                if (book.mode === 'folder') {
                  // Close items belonging to the folder if they are open
                  lore.forEach((item) => {
                    if (item.folder === book.key && openedRefs.has(item)) {
                      onClose(true, item)
                    }
                  })

                  // Filter out the folder and all items belonging to it
                  lore = lore.filter((item) => item !== book && item.folder !== book.key)
                } else {
                  // Delete regular item
                  lore.splice(i, 1)
                }

                updateCharacterGlobalLoreCollection(lore)
              }}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              {lorePlus}
              externalLoreBooks={DBState.db.characters[$selectedCharID].globalLore}
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
      {@const visibleItems = DBState.db.characters[$selectedCharID].chats[
        DBState.db.characters[$selectedCharID].chatPage
      ].localLore.filter((book) => (!showFolder && !book.folder) || showFolder === book.folder)}
      {@const lastVisibleItem = visibleItems[visibleItems.length - 1]}
      {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore.length === 0}
        <span class="text-textcolor2">No Lorebook</span>
      {:else}
        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore as book, i}
          {#if (!showFolder && !book.folder) || showFolder === book.folder}
            <LoreBookData
              {idgroup}
              value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                .localLore[i]}
              onDraftChange={(value) => updateChatLoreValue(i, value)}
              onDraftSettled={flushChatLoreValue}
              idx={i}
              isOpen={openedRefs.has(book)}
              openFolders={openFolders()}
              isLastInContainer={book === lastVisibleItem}
              onRemove={() => {
                if (openedRefs.has(book) && !book.folder) {
                  onClose(true, book)
                } else if (openedRefs.has(book) && book.folder) {
                  onClose(false, book)
                }

                let lore = [
                  ...DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    .localLore,
                ]

                // When deleting a folder, also delete all items that belong to that folder
                if (book.mode === 'folder') {
                  // Close items belonging to the folder if they are open
                  lore.forEach((item) => {
                    if (item.folder === book.key && openedRefs.has(item)) {
                      onClose(true, item)
                    }
                  })

                  // Filter out the folder and all items belonging to it
                  lore = lore.filter((item) => item !== book && item.folder !== book.key)
                } else {
                  // Delete regular item
                  lore.splice(i, 1)
                }

                updateChatLoreCollection(lore)
              }}
              onOpen={(isDetail = true) => onOpen(isDetail, book)}
              onClose={(isDetail = true) => onClose(isDetail, book)}
              {lorePlus}
              externalLoreBooks={DBState.db.characters[$selectedCharID].chats[
                DBState.db.characters[$selectedCharID].chatPage
              ].localLore}
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
