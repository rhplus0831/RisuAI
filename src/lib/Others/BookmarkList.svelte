<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
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
  import { syncServerBackedChatMetadataBaselines } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'

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

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  })

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
        const nextBookmarkNames = {
          ...(previous.chat.bookmarkNames ?? {}),
          [chatId]: newName,
        }
        if (!applyOptimisticBookmarkMetadata(chat.id, { bookmarkNames: nextBookmarkNames })) return
        dispatchUpdateChatScoped(chat.id, { bookmarkNames: nextBookmarkNames }, previous)
        return
      }

      const nextBookmarkNames = {
        ...(chat.bookmarkNames ?? {}),
        [chatId]: newName,
      }
      chat.bookmarkNames = nextBookmarkNames
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
        dispatchUpdateChatScoped(chat.id, { bookmarks: nextBookmarks, bookmarkNames: nextBookmarkNames }, previous)
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed top-0 left-0 w-full h-full z-30 bg-black/50 flex justify-center items-center"
  onclick={(event) => {
    if (event.target === event.currentTarget) {
      close()
    }
  }}
  onkeydown={(event) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      close()
    }
  }}>
  <div class="bg-darkbg p-3 rounded-md flex flex-col max-w-4xl w-full max-h-[90%] overflow-y-auto">
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="text-xl font-bold">{language.bookmarks}</h2>
      <div class="ml-auto flex items-center gap-2">
        <button
          class="text-textcolor2 hover:text-green-500"
          onclick={toggleExpandAll}
          title={expandAll ? language.collapseAll : language.expandAll}>
          {#if expandAll}
            <BookLockIcon size={20} />
          {:else}
            <BookOpenCheckIcon size={20} />
          {/if}
        </button>
        <button class="text-textcolor2 hover:text-green-500" onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    {#if bookmarkedMessages.length === 0}
      <p class="text-textcolor2">{language.noBookmarks}</p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each bookmarkedMessages as msg (msg.chatId)}
          <div class="border border-darkborderc rounded-lg">
            <div
              class="flex items-center p-3 cursor-pointer hover:bg-selected transition-colors"
              onclick={() => toggleExpand(msg.chatId)}
              onkeydown={(e) => e.key === 'Enter' && toggleExpand(msg.chatId)}
              role="button"
              tabindex="0">
              <span class="grow text-left truncate"
                >{chara.chats[chara.chatPage].bookmarkNames?.[msg.chatId] || msg.data.substring(0, 30) + '...'}</span>
              <div class="shrink-0 flex items-center gap-2 ml-2">
                <button
                  class="text-textcolor2 hover:text-blue-500"
                  title={language.goToChat}
                  onclick={(e) => {
                    e.stopPropagation()
                    goToChat(msg.originalIndex)
                  }}>
                  <ArrowRightIcon size={20} />
                </button>
                <button
                  class="text-textcolor2 hover:text-green-500"
                  onclick={(e) => {
                    e.stopPropagation()
                    editName(msg.chatId)
                  }}>
                  <PencilIcon size={16} />
                </button>
                <button
                  class="text-textcolor2 hover:text-red-500"
                  onclick={(e) => {
                    e.stopPropagation()
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
