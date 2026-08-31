<script lang="ts">
  import { XIcon, TrashIcon, PencilIcon, BookOpenCheckIcon, BookLockIcon, ArrowRightIcon } from '@lucide/svelte'
  import { onDestroy, untrack } from 'svelte'
  import Chat from '../ChatScreens/Chat.svelte'
  import { getCharImage } from 'src/ts/characterImage'
  import { getUserDisplayName, getUserIcon } from 'src/ts/utilState'
  import { bookmarkListOpen, selectedCharID } from 'src/ts/stores.svelte'
  import { createSimpleCharacter } from 'src/ts/simpleCharacter'
  import {
    RegexDisplayReloadPointer,
    RegexDisplayReloadScope,
    regexDisplayReloadTokenForContext,
  } from 'src/ts/process/regexDisplayReload'
  import { language } from 'src/lang'
  import { alertError, alertInput, alertNormal } from 'src/ts/alert'
  import {
    currentChatScopedSnapshot,
    dispatchUpdateChatScopedWithOutcome,
    type ChatMutationOutcome,
  } from 'src/ts/chatCommands'
  import { reportWriterAccessLostMutation } from 'src/ts/server/activeWriterSession'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import {
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { charactersResourceState, getCharacterResourceOwner } from 'src/ts/server/resourceState.svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { hydrateChatMessages } from 'src/ts/server/chatMessageHydration.svelte'
  import { getChatMessageOwnerState } from 'src/ts/server/chatMessageHydration.svelte'
  import { navigateToCharacterChatMessage } from 'src/ts/router'
  import { getDatabase, type Chat as ChatData, type character } from 'src/ts/storage/database.svelte'

  const close = () => ($bookmarkListOpen = false)
  let chara = $derived(resolveBookmarkCharacter())
  let chatMessageOwner = $derived.by(() => {
    const chat = chara?.chats?.[chara.chatPage]
    return chat?.id ? getChatMessageOwnerState(chat.id) : undefined
  })
  let regexDisplayReloadToken = $derived(
    regexDisplayReloadTokenForContext($RegexDisplayReloadPointer, $RegexDisplayReloadScope, {
      characterId: chara?.chaId,
      chatId: chara?.chats?.[chara.chatPage]?.id,
    }),
  )
  const simpleChar = $derived.by(() => {
    void regexDisplayReloadToken
    if (!chara) return null
    return createSimpleCharacter(
      chara,
      untrack(() => chara.customscript),
    )
  })
  let bookmarkHydrationState = $state<'loading' | 'ready' | 'error'>('loading')
  let bookmarkHydrationRun = 0
  type BookmarkHydrationOwner = {
    selectedCharacterIndex: number
    characterId?: string
    characterReference: character
    chatPage: number
    chatId?: string
    chatReference: ChatData
  }
  let preparedBookmarkOwner: BookmarkHydrationOwner | null | undefined
  type BookmarkMutationOperation = 'rename' | 'remove'
  interface BookmarkMutationState {
    chatId: string
    messageId: string
    operation: BookmarkMutationOperation
    label: string
    sequence: number
    status: 'pending' | 'queued' | 'failed'
  }
  let bookmarkMutations = $state<Record<string, BookmarkMutationState>>({})
  let bookmarkMutationSequence = 0

  function bookmarkMutationKey(chatId: string, messageId: string, operation: BookmarkMutationOperation): string {
    return `${chatId}::${messageId}::${operation}`
  }

  function isBookmarkMutationPending(chatId: string, messageId: string): boolean {
    return Object.values(bookmarkMutations).some(
      (mutation) => mutation.chatId === chatId && mutation.messageId === messageId && mutation.status === 'pending',
    )
  }

  function bookmarkMutationStatus(chatId: string, messageId: string): BookmarkMutationState['status'] | 'idle' {
    const matching = Object.values(bookmarkMutations).filter(
      (mutation) => mutation.chatId === chatId && mutation.messageId === messageId,
    )
    return (
      matching.reduce<BookmarkMutationState | undefined>(
        (latest, mutation) => (!latest || mutation.sequence > latest.sequence ? mutation : latest),
        undefined,
      )?.status ?? 'idle'
    )
  }

  function bookmarkMutationMessage(mutation: BookmarkMutationState): string {
    if (mutation.operation === 'rename') {
      if (mutation.status === 'pending') return language.bookmarkRenamePending(mutation.label)
      if (mutation.status === 'queued') return language.bookmarkRenameQueued(mutation.label)
      return language.bookmarkRenameFailed(mutation.label)
    }
    if (mutation.status === 'pending') return language.bookmarkRemovePending(mutation.label)
    if (mutation.status === 'queued') return language.bookmarkRemoveQueued(mutation.label)
    return language.bookmarkRemoveFailed(mutation.label)
  }

  async function runBookmarkMutation(
    chatId: string,
    messageId: string,
    operation: BookmarkMutationOperation,
    label: string,
    action: () => Promise<ChatMutationOutcome> | undefined,
  ): Promise<void> {
    if (isBookmarkMutationPending(chatId, messageId)) return
    const key = bookmarkMutationKey(chatId, messageId, operation)
    const sequence = ++bookmarkMutationSequence
    const mutation = { chatId, messageId, operation, label, sequence }

    function setCurrentMutationStatus(status: BookmarkMutationState['status']): BookmarkMutationState {
      const next = { ...mutation, status }
      if (bookmarkMutations[key]?.sequence === sequence) bookmarkMutations[key] = next
      return next
    }

    function clearCurrentMutation(): void {
      if (bookmarkMutations[key]?.sequence === sequence) delete bookmarkMutations[key]
    }

    function reportFailure(): void {
      alertError(bookmarkMutationMessage(setCurrentMutationStatus('failed')))
    }

    bookmarkMutations[key] = { ...mutation, status: 'pending' }
    try {
      const outcome = await action()
      if (outcome?.status === 'accepted') {
        clearCurrentMutation()
        return
      }
      if (outcome?.status === 'queued') {
        alertNormal(bookmarkMutationMessage(setCurrentMutationStatus('queued')))
        void outcome.settlement.then(
          (settlement) => {
            if (settlement.status === 'accepted') {
              clearCurrentMutation()
              return
            }
            reportFailure()
          },
          () => reportFailure(),
        )
        return
      }
      reportFailure()
    } catch {
      reportFailure()
    }
  }

  function activeBookmarkChat() {
    return chara?.chats?.[chara.chatPage]
  }

  function readCharacterOwners(): readonly character[] {
    if (charactersResourceState.status === 'ready') return charactersResourceState.characters
    if (charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading') {
      return charactersResourceState.characters.length > 0
        ? charactersResourceState.characters
        : (getDatabase().characters ?? [])
    }
    return []
  }

  function uniqueCharacterOwner(characterId: string): character | undefined {
    if (charactersResourceState.status === 'ready') return getCharacterResourceOwner(characterId)
    let owner: character | undefined
    for (const candidate of readCharacterOwners()) {
      if (candidate?.chaId !== characterId) continue
      if (owner) return undefined
      owner = candidate
    }
    return owner
  }

  function currentSelectedCharacterIndex(): number {
    return charactersResourceState.status === 'ready' ? charactersResourceState.currentChar : $selectedCharID
  }

  function activeChatIdIsUnique(character: character): boolean {
    const chatId = character.chats?.[character.chatPage]?.id
    if (!chatId) return false
    return (
      readCharacterOwners().reduce(
        (count, candidate) => count + (candidate.chats ?? []).filter((chat) => chat?.id === chatId).length,
        0,
      ) === 1
    )
  }

  function resolveBookmarkCharacter(): character | undefined {
    const selectedIndex = currentSelectedCharacterIndex()
    const owners = readCharacterOwners()
    const candidate = owners[selectedIndex]
    const character = candidate?.chaId ? uniqueCharacterOwner(candidate.chaId) : undefined
    return character && activeChatIdIsUnique(character) ? character : undefined
  }

  function captureBookmarkHydrationOwner(): BookmarkHydrationOwner | null {
    const selectedCharacterIndex = currentSelectedCharacterIndex()
    const characterReference = chara
    const chatPage = characterReference?.chatPage
    const chatReference = chatPage === undefined ? undefined : characterReference?.chats?.[chatPage]
    if (!characterReference || chatPage === undefined || !chatReference) return null

    return {
      selectedCharacterIndex,
      characterId: characterReference.chaId,
      characterReference,
      chatPage,
      chatId: chatReference.id,
      chatReference,
    }
  }

  function isSameBookmarkHydrationOwner(
    left: BookmarkHydrationOwner | null | undefined,
    right: BookmarkHydrationOwner | null | undefined,
  ): boolean {
    if (!left || !right) return left === right

    const leftCharacterId = left.characterId || undefined
    const rightCharacterId = right.characterId || undefined
    const sameCharacter =
      leftCharacterId || rightCharacterId
        ? leftCharacterId === rightCharacterId
        : left.selectedCharacterIndex === right.selectedCharacterIndex &&
          left.characterReference === right.characterReference
    if (!sameCharacter) return false

    const leftChatId = left.chatId || undefined
    const rightChatId = right.chatId || undefined
    return leftChatId || rightChatId
      ? leftChatId === rightChatId
      : left.chatPage === right.chatPage && left.chatReference === right.chatReference
  }

  function isCurrentBookmarkHydrationOwner(owner: BookmarkHydrationOwner): boolean {
    return isSameBookmarkHydrationOwner(owner, captureBookmarkHydrationOwner())
  }

  function hasNonresidentBookmarks(owner: BookmarkHydrationOwner): boolean {
    const residentMessageIds = new Set(owner.chatReference.message.map((message) => message.chatId))
    return (owner.chatReference.bookmarks ?? []).some((bookmarkId) => !residentMessageIds.has(bookmarkId))
  }

  async function prepareBookmarkMessages(force = false, owner = captureBookmarkHydrationOwner()): Promise<void> {
    const run = ++bookmarkHydrationRun
    if (!owner || !isCurrentBookmarkHydrationOwner(owner)) {
      if (run === bookmarkHydrationRun) bookmarkHydrationState = 'ready'
      return
    }

    const chat = owner.chatReference
    if ((!force && !hasNonresidentBookmarks(owner)) || !chat.id) {
      if (run === bookmarkHydrationRun && isCurrentBookmarkHydrationOwner(owner)) {
        bookmarkHydrationState = 'ready'
      }
      return
    }

    bookmarkHydrationState = 'loading'
    try {
      await hydrateChatMessages(chat.id, { strict: true })
      if (run !== bookmarkHydrationRun || !isCurrentBookmarkHydrationOwner(owner)) return
      bookmarkHydrationState = 'ready'
    } catch {
      if (run !== bookmarkHydrationRun || !isCurrentBookmarkHydrationOwner(owner)) return
      bookmarkHydrationState = 'error'
    }
  }

  $effect(() => {
    const owner = captureBookmarkHydrationOwner()
    if (isSameBookmarkHydrationOwner(owner, preparedBookmarkOwner)) return
    preparedBookmarkOwner = owner
    void prepareBookmarkMessages(false, owner)
  })

  onDestroy(() => {
    bookmarkHydrationRun += 1
  })

  const messageMap = $derived.by(() => {
    if (!chara) return new Map()

    const allMessages = chatMessageOwner?.messages ?? []
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
      const character = chara?.chaId ? uniqueCharacterOwner(chara.chaId) : undefined
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
    const previousName = chat.bookmarkNames?.[chatId] || ''
    const newName = await alertInput(language.bookmarkAskNameOrCancel, [], previousName)
    if (newName && newName.trim() !== '') {
      if (reportWriterAccessLostMutation()) return
      if (canUseServerCommands()) {
        if (!chat.id) return
        await runBookmarkMutation(chat.id, chatId, 'rename', previousName || newName, () => {
          const previous = currentChatScopedSnapshot()
          if (previous.chatId !== chat.id || !previous.chat) return
          if (!(previous.chat.bookmarks ?? []).includes(chatId)) return
          const nextBookmarkNames = {
            ...(previous.chat.bookmarkNames ?? {}),
            [chatId]: newName,
          }
          if (!applyOptimisticBookmarkMetadata(chat.id!, { bookmarkNames: nextBookmarkNames })) return
          return dispatchUpdateChatScopedWithOutcome(
            chat.id!,
            { bookmarkNames: nextBookmarkNames },
            previous,
            rollbackServerBackedChatRowMetadata,
          )
        })
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

  async function removeBookmark(chatId: string) {
    const chat = chara.chats[chara.chatPage]
    const bookmarks = chat.bookmarks ?? []
    const index = bookmarks.indexOf(chatId)
    if (index > -1) {
      if (reportWriterAccessLostMutation()) return
      if (canUseServerCommands()) {
        if (!chat.id) return
        const bookmarkLabel = chat.bookmarkNames?.[chatId] || chatId
        await runBookmarkMutation(chat.id, chatId, 'remove', bookmarkLabel, () => {
          const previous = currentChatScopedSnapshot()
          if (previous.chatId !== chat.id || !previous.chat) return
          const nextBookmarks = (previous.chat.bookmarks ?? []).filter((id) => id !== chatId)
          const nextBookmarkNames = { ...(previous.chat.bookmarkNames ?? {}) }
          delete nextBookmarkNames[chatId]
          if (
            !applyOptimisticBookmarkMetadata(chat.id!, {
              bookmarks: nextBookmarks,
              bookmarkNames: nextBookmarkNames,
            })
          ) {
            return
          }
          return dispatchUpdateChatScopedWithOutcome(
            chat.id!,
            { bookmarks: nextBookmarks, bookmarkNames: nextBookmarkNames },
            previous,
            rollbackServerBackedChatRowMetadata,
          )
        })
        return
      }

      const nextBookmarks = bookmarks.filter((id) => id !== chatId)
      const nextBookmarkNames = { ...(chat.bookmarkNames ?? {}) }
      delete nextBookmarkNames[chatId]
      chat.bookmarks = nextBookmarks
      chat.bookmarkNames = nextBookmarkNames
    }
  }

  function goToChat(index: number) {
    const chat = activeBookmarkChat()
    if (!chara?.chaId || !chat?.id) return
    navigateToCharacterChatMessage(chara.chaId, chat.id, index)
    close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={close}
  data-modal-root
  class="fixed top-0 left-0 w-full h-full z-30 bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-3 rounded-md flex flex-col max-w-4xl w-full max-h-[90%] overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-bookmark-list-title"
    aria-busy={bookmarkHydrationState === 'loading'}
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

    {#each Object.entries(bookmarkMutations).filter((entry) => entry[1].chatId === activeBookmarkChat()?.id && entry[1].status === 'failed') as mutationEntry (mutationEntry[0])}
      {@const mutation = mutationEntry[1]}
      <p
        class="mb-2 text-sm text-textcolor2"
        data-risu-bookmark-mutation-status={mutation.status}
        data-risu-bookmark-mutation-id={mutation.messageId}
        role="status"
        aria-live="polite">
        {bookmarkMutationMessage(mutation)}
      </p>
    {/each}

    {#if bookmarkHydrationState === 'loading'}
      <p class="text-textcolor2" role="status">{language.loading}</p>
    {:else if bookmarkHydrationState === 'error'}
      <div class="flex flex-col items-start gap-2 text-textcolor2" role="alert">
        <p>{language.chatDataLoadFailed}</p>
        <button
          type="button"
          class="rounded-md border border-darkborderc px-3 py-2 text-textcolor hover:bg-selected"
          onclick={() => void prepareBookmarkMessages(true)}>{language.retry}</button>
      </div>
    {:else if bookmarkedMessages.length === 0}
      <p class="text-textcolor2" role="status">{language.noBookmarks}</p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each bookmarkedMessages as msg (msg.chatId)}
          {@const bookmarkName =
            chara.chats[chara.chatPage].bookmarkNames?.[msg.chatId] || msg.data.substring(0, 30) + '...'}
          <div
            data-risu-bookmark-id={msg.chatId}
            data-risu-mutation-status={bookmarkMutationStatus(chara.chats[chara.chatPage].id ?? '', msg.chatId)}
            aria-busy={isBookmarkMutationPending(chara.chats[chara.chatPage].id ?? '', msg.chatId)}
            class="border border-darkborderc rounded-lg">
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
                  disabled={isBookmarkMutationPending(chara.chats[chara.chatPage].id ?? '', msg.chatId)}
                  onclick={() => {
                    void editName(msg.chatId)
                  }}>
                  <PencilIcon size={16} />
                </button>
                <button
                  data-risu-bookmark-action="remove"
                  class="text-textcolor2 hover:text-red-500"
                  aria-label={`${language.remove}: ${bookmarkName}`}
                  disabled={isBookmarkMutationPending(chara.chats[chara.chatPage].id ?? '', msg.chatId)}
                  onclick={() => {
                    void removeBookmark(msg.chatId)
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
