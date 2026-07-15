<script lang="ts">
  import { XIcon, TrashIcon, PencilIcon, BookOpenCheckIcon, BookLockIcon, ArrowRightIcon } from '@lucide/svelte'
  import Chat from '../ChatScreens/Chat.svelte'
  import { getCharImage } from 'src/ts/characters'
  import { getUserDisplayName, getUserIcon } from 'src/ts/util'
  import { createSimpleCharacter, bookmarkListOpen, selectedCharID, ScrollToMessageStore } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { alertInput } from 'src/ts/alert'
  import {
    currentChatScopedSnapshot,
    currentChatStateSnapshot,
    dispatchUpdateChat,
    dispatchUpdateChatScoped,
  } from 'src/ts/chatCommands'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import {
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  const close = () => ($bookmarkListOpen = false)
  let chara = $derived(getDatabase().characters[$selectedCharID])
  const simpleChar = $derived(createSimpleCharacter(chara))

  const messageMap = $derived.by(() => {
    if (!chara) return new Map()

    const chat = chara.chats[chara.chatPage]
    const allMessages = chat.message
    const map = new Map()

    allMessages.forEach((m, index) => {
      map.set(m.chatId, { ...m, originalIndex: index, saying: m.saying ?? '' })
    })

    return map
  })

  const bookmarkedMessages = $derived.by(() => {
    if (!chara) return []

    const chat = chara.chats[chara.chatPage]
    const bookmarkIds = chat.bookmarks ?? []
    const map = messageMap

    const messages = bookmarkIds
      .map((id) => {
        const message = map.get(id)
        if (!message) return null

        return { ...message, speaker: null }
      })
      .filter(Boolean)

    return messages
  })

  let expandedBookmarks = $state(new Set<string>())
  let expandAll = $state(false)

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  function toggleExpand(chatId: string) {
    if (expandAll) {
      expandAll = false
      const allIds = bookmarkedMessages.map((m) => m.chatId)
      const newSet = new Set(allIds)
      newSet.delete(chatId)
      expandedBookmarks = newSet
    } else {
      const newSet = new Set(expandedBookmarks)
      if (newSet.has(chatId)) {
        newSet.delete(chatId)
      } else {
        newSet.add(chatId)
      }
      expandedBookmarks = newSet
    }
  }

  function toggleExpandAll() {
    expandAll = !expandAll
    if (expandAll) {
      expandedBookmarks.clear()
    }
  }

  function applyOptimisticBookmarkMetadata(
    chatId: string,
    patch: { bookmarks?: string[]; bookmarkNames?: Record<string, string> },
  ): boolean {
    let applied = false
    withTrustedResourceWrite(() => {
      const character = getDatabase().characters[$selectedCharID]
      const liveChat = character?.chats?.find((candidate) => candidate.id === chatId)
      if (!liveChat) return
      if (patch.bookmarks) liveChat.bookmarks = patch.bookmarks
      if (patch.bookmarkNames) liveChat.bookmarkNames = patch.bookmarkNames
      applied = true
    })
    if (applied) syncServerBackedChatMetadataBaselines()
    return applied
  }

  async function editName(chatId: string) {
    const chat = chara.chats[chara.chatPage]
    const newName = await alertInput(language.bookmarkAskNameOrCancel, [], chat.bookmarkNames?.[chatId] || '')
    if (newName && newName.trim() !== '') {
      if (canUseServerCommands()) {
        if (!chat.id) return
        const previous = currentChatScopedSnapshot()
        if (previous.chatId !== chat.id || !previous.chat) return
        if (!(previous.chat.bookmarks ?? []).includes(chatId)) return
        const nextBookmarkNames = {
          ...(previous.chat.bookmarkNames ?? {}),
          [chatId]: newName,
        }
        if (!applyOptimisticBookmarkMetadata(chat.id, { bookmarkNames: nextBookmarkNames })) return
        dispatchUpdateChatScoped(
          chat.id,
          { bookmarkNames: nextBookmarkNames },
          previous,
          rollbackServerBackedChatRowMetadata,
        )
        return
      }

      const liveChat = chat.id ? chara.chats.find((candidate) => candidate.id === chat.id) : chara.chats[chara.chatPage]
      if (!liveChat || !(liveChat.bookmarks ?? []).includes(chatId)) return
      const nextBookmarkNames = {
        ...(liveChat.bookmarkNames ?? {}),
        [chatId]: newName,
      }
      liveChat.bookmarkNames = nextBookmarkNames
    }
  }

  function removeBookmark(chatId: string) {
    const chat = chara.chats[chara.chatPage]
    const bookmarks = chat.bookmarks ?? []
    const index = bookmarks.indexOf(chatId)
    if (index > -1) {
      if (canUseServerCommands()) {
        if (!chat.id) return
        const previous = currentChatScopedSnapshot()
        if (previous.chatId !== chat.id || !previous.chat) return
        const nextBookmarks = (previous.chat.bookmarks ?? []).filter((id) => id !== chatId)
        const nextBookmarkNames = { ...(previous.chat.bookmarkNames ?? {}) }
        delete nextBookmarkNames[chatId]
        if (!applyOptimisticBookmarkMetadata(chat.id, { bookmarks: nextBookmarks, bookmarkNames: nextBookmarkNames }))
          return
        dispatchUpdateChatScoped(
          chat.id,
          { bookmarks: nextBookmarks, bookmarkNames: nextBookmarkNames },
          previous,
          rollbackServerBackedChatRowMetadata,
        )
        return
      }

      const nextBookmarks = bookmarks.filter((id) => id !== chatId)
      const nextBookmarkNames = { ...(chat.bookmarkNames ?? {}) }
      delete nextBookmarkNames[chatId]
      chat.bookmarks = nextBookmarks
      chat.bookmarkNames = nextBookmarkNames
      if (chat.id) {
        dispatchUpdateChat(
          chat.id,
          { bookmarks: nextBookmarks, bookmarkNames: nextBookmarkNames },
          currentChatStateSnapshot(),
        )
      }
    }
  }

  function goToChat(index: number) {
    ScrollToMessageStore.value = index
    close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  class="fixed top-0 left-0 w-full h-full z-30 bg-black/50 flex justify-center items-center"
  onclick={(event) => {
    if (event.target === event.currentTarget) {
      close()
    }
  }}>
  <div
    use:modalFocusTrap
    class="bg-darkbg p-3 rounded-md flex flex-col max-w-4xl w-full max-h-[90%] overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-bookmark-list-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 id="risu-bookmark-list-title" class="text-xl font-bold">{language.bookmarks}</h2>
      <div class="ml-auto flex items-center gap-2">
        <button
          class="text-textcolor2 hover:text-green-500"
          onclick={toggleExpandAll}
          title={expandAll ? language.collapseAll : language.expandAll}
          aria-label={expandAll ? language.collapseAll : language.expandAll}>
          {#if expandAll}
            <BookLockIcon size={20} />
          {:else}
            <BookOpenCheckIcon size={20} />
          {/if}
        </button>
        <button
          data-modal-initial-focus
          class="text-textcolor2 hover:text-green-500"
          aria-label={language.close}
          onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    {#if bookmarkedMessages.length === 0}
      <p class="text-textcolor2" role="status">{language.noBookmarks}</p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each bookmarkedMessages as msg (msg.chatId)}
          {@const bookmarkName =
            chara.chats[chara.chatPage].bookmarkNames?.[msg.chatId] || msg.data.substring(0, 30) + '...'}
          <div data-risu-bookmark-id={msg.chatId} class="border border-darkborderc rounded-lg">
            <div class="flex items-center p-3 hover:bg-selected transition-colors">
              <button
                class="grow text-left truncate cursor-pointer"
                aria-expanded={expandAll || expandedBookmarks.has(msg.chatId)}
                onclick={() => toggleExpand(msg.chatId)}>
                {bookmarkName}
              </button>
              <div class="shrink-0 flex items-center gap-2 ml-2">
                <button
                  class="text-textcolor2 hover:text-blue-500"
                  title={language.goToChat}
                  aria-label={language.goToChat}
                  onclick={() => {
                    goToChat(msg.originalIndex)
                  }}>
                  <ArrowRightIcon size={20} />
                </button>
                <button
                  data-risu-bookmark-action="rename"
                  class="text-textcolor2 hover:text-green-500"
                  aria-label={`${language.edit}: ${bookmarkName}`}
                  onclick={() => {
                    editName(msg.chatId)
                  }}>
                  <PencilIcon size={16} />
                </button>
                <button
                  data-risu-bookmark-action="remove"
                  class="text-textcolor2 hover:text-red-500"
                  aria-label={`${language.remove}: ${bookmarkName}`}
                  onclick={() => {
                    removeBookmark(msg.chatId)
                  }}>
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>

            {#if expandAll || expandedBookmarks.has(msg.chatId)}
              <div class="p-1 border-t border-darkborderc">
                <Chat
                  idx={msg.originalIndex}
                  message={msg.data}
                  name={msg.role === 'user' ? getUserDisplayName() : getCharacterDisplayName(chara)}
                  img={msg.role === 'user' ? getCharImage(getUserIcon(), 'css') : getCharImage(chara.image, 'css')}
                  role={msg.role}
                  messageGenerationInfo={msg.generationInfo}
                  rerollIcon={false}
                  largePortrait={chara.largePortrait}
                  character={simpleChar}
                  isLastMemory={false} />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
