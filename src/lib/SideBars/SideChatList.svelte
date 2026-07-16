<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { v4 } from 'uuid'
  import Sortable from 'sortablejs/modular/sortable.core.esm.js'
  import {
    DownloadIcon,
    PencilIcon,
    HardDriveUploadIcon,
    MenuIcon,
    TrashIcon,
    SplitIcon,
    FolderPlusIcon,
    BookmarkCheckIcon,
    ArrowLeftIcon,
  } from '@lucide/svelte'

  import type { Chat, ChatFolder, character } from 'src/ts/storage/database.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { reloadGuiDisplay } from 'src/ts/stores.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'

  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'

  import { exportChat, importChat, exportAllChats } from 'src/ts/characters'
  import { alertChatOptions, alertConfirm, alertError, alertNormal, alertSelect, alertStore } from 'src/ts/alert'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { bookmarkListOpen } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import Toggles from './Toggles.svelte'
  import AuthorNoteEditor from './AuthorNoteEditor.svelte'
  import { changeChatTo, createChatCopyName } from 'src/ts/globalApi.svelte'
  import { ensureAllChatsHydrated, hydrateChatMessages } from 'src/ts/server/chatMessageHydration.svelte'
  import {
    applyOptimisticCreatedChat,
    applyOptimisticCreatedChatFolder,
    applyOptimisticDeletedChat,
    currentChatSelectionSnapshot,
    currentChatStateSnapshot,
    dispatchCreateChat,
    dispatchCreateChatFolder,
    dispatchDeleteChat,
    dispatchDeleteChatFolder,
    dispatchForkChat,
    dispatchReorderChatFoldersAndChatsByIds,
    dispatchReorderChats,
    dispatchReorderChatsByIds,
    dispatchSelectChat,
    dispatchUpdateChatAsync,
    dispatchUpdateChatFolder,
  } from 'src/ts/chatCommands'
  import { canUseServerCommands, type ServerCommandResult } from 'src/ts/server/commands'
  import {
    rollbackServerBackedChatFolderRowMetadata,
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
    watchServerBackedChatMetadata,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { groupChatsByFolderId } from './chatFolderGrouping'
  import { characterRoutePath, currentRoute, navigate } from 'src/ts/router'

  interface Props {
    chara: character
  }

  let { chara }: Props = $props()
  let editMode = $state(false)
  let pendingPersonaBindings = $state<Record<string, boolean>>({})

  let chatsStb: Sortable[] = []
  let folderStb: Sortable = null

  let folderEles: HTMLDivElement = $state()
  let listEle: HTMLDivElement = $state()
  let sorted = $state(0)
  let opened = 0
  let sortableStructureSignature = ''
  let sortableReconcileGeneration = 0

  // Preserve source order and each chat's original array index within folder buckets.
  let chatsByFolderId = $derived(groupChatsByFolderId(chara.chats))

  let chatRouteOpen = $derived(
    $currentRoute.kind === 'character' &&
      $currentRoute.chaId === chara?.chaId &&
      typeof $currentRoute.chatId === 'string',
  )

  $effect(() => {
    const stop = untrack(() => watchServerBackedChatMetadata())
    return stop
  })

  function selectChat(index: number): void {
    const chatId = chara.chats[index]?.id
    if (chara.chaId && chatId) {
      navigate(characterRoutePath(chara.chaId, chatId))
      return
    }
    if (canUseServerCommands() && chatId) {
      // Scalar rollback: select only flips `chatPage`; the whole-array
      // snapshot deep-cloned every hydrated transcript per sidebar click.
      dispatchSelectChat(chatId, currentChatSelectionSnapshot())
      return
    }
    changeChatTo(index)
  }

  function backToChatList(): void {
    if (chara.chaId) {
      navigate(characterRoutePath(chara.chaId))
    }
  }

  function createChat(): void {
    const previous = currentChatStateSnapshot()
    const len = chara.chats.length
    const chat = {
      message: [],
      note: '',
      name: `New Chat ${len + 1}`,
      localLore: [],
      fmIndex: -1,
      id: v4(),
    }
    if (canUseServerCommands()) {
      const applied = applyOptimisticCreatedChat(chara.chaId, chat, previous)
      if (applied && chara.chaId && chat.id) {
        navigate(characterRoutePath(chara.chaId, chat.id))
      }
      dispatchCreateChat(chara.chaId, chat, previous)
      return
    }
    chara.chats.unshift(chat)
    changeChatTo(0)
    reloadGuiDisplay()
  }

  async function forkChat(sourceChat: Chat): Promise<void> {
    const sourceChatId = sourceChat.id
    const characterId = chara.chaId
    let liveSourceChat = sourceChat
    if (canUseServerCommands() && sourceChatId) {
      try {
        await hydrateChatMessages(sourceChatId, { strict: true })
      } catch {
        alertError(language.chatDataLoadFailed)
        return
      }

      const liveCharacter = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
      const hydratedSourceChat = liveCharacter?.chats?.find((candidate) => candidate.id === sourceChatId)
      if (!hydratedSourceChat) {
        alertError(language.chatDataLoadFailed)
        return
      }
      liveSourceChat = hydratedSourceChat
    }

    const previous = currentChatStateSnapshot()
    const newChat = $state.snapshot(liveSourceChat)
    newChat.name = createChatCopyName(newChat.name, 'Copy')
    newChat.id = v4()
    for (const message of newChat.message ?? []) {
      message.chatId = v4()
    }
    if (canUseServerCommands()) {
      dispatchForkChat(sourceChatId, previous, { chat: newChat })
      return
    }
    chara.chats.unshift(newChat)
    changeChatTo(0)
    chara.chats = chara.chats
  }

  function currentSidebarCharacter(): character | undefined {
    return (
      getDatabase().characters?.find((candidate) => Boolean(chara.chaId) && candidate.chaId === chara.chaId) ??
      getDatabase().characters?.[$selectedCharID]
    )
  }

  function applyOptimisticChatMetadata(chatId: string, mutate: (chat: Chat) => void): boolean {
    let applied = false
    withTrustedResourceWrite(() => {
      const liveChat = currentSidebarCharacter()?.chats?.find((candidate) => candidate.id === chatId)
      if (liveChat) {
        mutate(liveChat)
        applied = true
      }
    })
    return applied
  }

  function applyOptimisticFolderMetadata(folderId: string, mutate: (folder: ChatFolder) => void): boolean {
    let applied = false
    withTrustedResourceWrite(() => {
      const liveFolder = currentSidebarCharacter()?.chatFolders?.find((candidate) => candidate.id === folderId)
      if (liveFolder) {
        mutate(liveFolder)
        applied = true
      }
    })
    return applied
  }

  function applyDirectOptimisticChatMetadata(chatId: string, mutate: (chat: Chat) => void): boolean {
    const applied = applyOptimisticChatMetadata(chatId, mutate)
    if (applied) syncServerBackedChatMetadataBaselines()
    return applied
  }

  function applyDirectOptimisticFolderMetadata(folderId: string, mutate: (folder: ChatFolder) => void): boolean {
    const applied = applyOptimisticFolderMetadata(folderId, mutate)
    if (applied) syncServerBackedChatMetadataBaselines()
    return applied
  }

  function updateChatName(chat: Chat, name: string): void {
    if (canUseServerCommands()) {
      const chatId = chat.id
      if (!chatId) return
      applyOptimisticChatMetadata(chatId, (liveChat) => (liveChat.name = name))
      return
    }
    chat.name = name
  }

  function updateFolderName(folder: ChatFolder, name: string): void {
    if (canUseServerCommands()) {
      const folderId = folder.id
      if (!folderId) return
      applyOptimisticFolderMetadata(folderId, (liveFolder) => (liveFolder.name = name))
      return
    }
    folder.name = name
  }

  async function togglePersonaBinding(chatId: string | undefined): Promise<void> {
    if (!chatId || pendingPersonaBindings[chatId]) return
    pendingPersonaBindings[chatId] = true
    try {
      const chat = currentSidebarCharacter()?.chats?.find((candidate) => candidate.id === chatId)
      if (!chat) return

      const previousBinding = chat.bindedPersona ?? ''
      const confirmed = await alertConfirm(
        previousBinding ? language.doYouWantToUnbindCurrentPersona : language.doYouWantToBindCurrentPersona,
      )
      if (!confirmed) return

      const liveChat = currentSidebarCharacter()?.chats?.find((candidate) => candidate.id === chatId)
      if (!liveChat || (liveChat.bindedPersona ?? '') !== previousBinding) return

      const previous = currentChatStateSnapshot()
      let bindedPersona = ''
      if (!previousBinding) {
        const selectedPersona = getDatabase().selectedPersona
        const persona = getDatabase().personas?.[selectedPersona]
        if (!persona) return
        bindedPersona = persona.id || v4()
        if (!persona.id) {
          withTrustedResourceWrite(() => {
            if (getDatabase().selectedPersona !== selectedPersona) return
            const livePersona = getDatabase().personas?.[selectedPersona]
            if (livePersona && !livePersona.id) {
              livePersona.id = bindedPersona
            }
          })
        }
      }

      if (!applyDirectOptimisticChatMetadata(chatId, (candidate) => (candidate.bindedPersona = bindedPersona))) return

      let result: ServerCommandResult | null
      try {
        result = await dispatchUpdateChatAsync(
          chatId,
          { bindedPersona },
          previous,
          false,
          rollbackServerBackedChatRowMetadata,
        )
      } catch {
        alertError(language.personaBindingFailed)
        return
      }
      if (result && result.status !== 'ok') {
        alertError(language.personaBindingFailed)
        return
      }
      alertNormal(previousBinding ? language.personaUnbindedSuccess : language.personaBindedSuccess)
    } finally {
      delete pendingPersonaBindings[chatId]
    }
  }

  async function deleteChat(chat: Chat, index: number): Promise<void> {
    if (chara.chats.length === 1) {
      alertError(language.errors.onlyOneChat)
      return
    }
    const confirmed = await alertConfirm(`${language.removeConfirm}${chat.name}`)
    if (!confirmed || !chat.id) return

    const previous = currentChatStateSnapshot()
    if (canUseServerCommands()) {
      const result = applyOptimisticDeletedChat(chara.chaId, chat.id, previous)
      if (result.applied && chara.chaId && result.selectedChatId) {
        navigate(characterRoutePath(chara.chaId, result.selectedChatId), { replace: true })
      }
    } else {
      changeChatTo(0)
      const chats = chara.chats
      chats.splice(index, 1)
      chara.chats = chats
      reloadGuiDisplay()
    }
    dispatchDeleteChat(chat.id, previous)
  }

  type ChatDomOrder = {
    chatIds: string[]
    chatsById: Map<string, Chat>
    folderByChatId: Record<string, string | null>
  }

  type FolderDomOrder = ChatDomOrder & {
    folderIds: string[]
    foldersById: Map<string, ChatFolder>
  }

  function rejectStaleReorder(reason: string): null {
    console.warn(`Ignoring stale sidebar chat reorder: ${reason}`)
    return null
  }

  function buildCurrentChatIdMap(): Map<string, Chat> | null {
    const chatsById = new Map<string, Chat>()
    for (const chat of chara.chats) {
      if (!chat.id) return rejectStaleReorder('current chat is missing an id')
      if (chatsById.has(chat.id)) return rejectStaleReorder(`duplicate current chat id "${chat.id}"`)
      chatsById.set(chat.id, chat)
    }
    return chatsById
  }

  function buildCurrentFolderIdMap(): Map<string, ChatFolder> | null {
    const foldersById = new Map<string, ChatFolder>()
    for (const folder of chara.chatFolders) {
      if (!folder.id) return rejectStaleReorder('current folder is missing an id')
      if (foldersById.has(folder.id)) return rejectStaleReorder(`duplicate current folder id "${folder.id}"`)
      foldersById.set(folder.id, folder)
    }
    return foldersById
  }

  function folderIdForChatElement(chatEle: HTMLElement, foldersById: Map<string, ChatFolder>): string | null {
    const folderPanel = chatEle.closest<HTMLElement>('[data-risu-chat-folder-panel-id]')
    if (!folderPanel) return null

    const folderId = folderPanel.dataset.risuChatFolderPanelId
    if (!folderId) {
      throw new Error('folder panel is missing an id')
    }
    if (!foldersById.has(folderId)) {
      throw new Error(`unknown folder id "${folderId}"`)
    }
    return folderId
  }

  function buildChatDomOrder(): ChatDomOrder | null {
    if (!listEle) return rejectStaleReorder('chat list is not mounted')

    const chatsById = buildCurrentChatIdMap()
    const foldersById = buildCurrentFolderIdMap()
    if (!chatsById || !foldersById) return null

    const chatIds: string[] = []
    const seenChatIds = new Set<string>()
    const folderByChatId: Record<string, string | null> = {}

    try {
      listEle.querySelectorAll<HTMLElement>('[data-risu-chat-id]').forEach((chatEle) => {
        const chatId = chatEle.dataset.risuChatId
        if (!chatId) {
          throw new Error('DOM chat row is missing an id')
        }
        if (seenChatIds.has(chatId)) {
          throw new Error(`duplicate DOM chat id "${chatId}"`)
        }
        if (!chatsById.has(chatId)) {
          throw new Error(`unknown DOM chat id "${chatId}"`)
        }
        seenChatIds.add(chatId)
        chatIds.push(chatId)
        folderByChatId[chatId] = folderIdForChatElement(chatEle, foldersById)
      })
    } catch (error) {
      return rejectStaleReorder(error instanceof Error ? error.message : String(error))
    }

    for (const chatId of chatsById.keys()) {
      if (!seenChatIds.has(chatId)) {
        return rejectStaleReorder(`current chat id "${chatId}" is missing from the DOM`)
      }
    }

    return { chatIds, chatsById, folderByChatId }
  }

  function buildFolderDomOrder(folderContainer: HTMLElement): FolderDomOrder | null {
    const chatOrder = buildChatDomOrder()
    const foldersById = buildCurrentFolderIdMap()
    if (!chatOrder || !foldersById) return null

    const folderIds: string[] = []
    const seenFolderIds = new Set<string>()

    for (const folderEle of Array.from(folderContainer.children)) {
      if (!(folderEle instanceof HTMLElement)) return rejectStaleReorder('DOM folder row is not an element')
      const folderId = folderEle.dataset.risuChatFolderId
      if (!folderId) return rejectStaleReorder('DOM folder row is missing an id')
      if (seenFolderIds.has(folderId)) return rejectStaleReorder(`duplicate DOM folder id "${folderId}"`)
      if (!foldersById.has(folderId)) return rejectStaleReorder(`unknown DOM folder id "${folderId}"`)
      seenFolderIds.add(folderId)
      folderIds.push(folderId)
    }

    for (const folderId of foldersById.keys()) {
      if (!seenFolderIds.has(folderId)) {
        return rejectStaleReorder(`current folder id "${folderId}" is missing from the DOM`)
      }
    }

    return { ...chatOrder, folderIds, foldersById }
  }

  function selectedChatIdFromDom(chatsById: Map<string, Chat>, fallbackChatId?: string): string | undefined {
    const selectedRow = listEle?.querySelector<HTMLElement>('[data-risu-chat-selected="true"][data-risu-chat-id]')
    const selectedChatId = selectedRow?.dataset.risuChatId
    if (selectedChatId && chatsById.has(selectedChatId)) return selectedChatId
    return fallbackChatId
  }

  async function resetSortableProjection(): Promise<void> {
    destroyStb()
    sorted += 1
    await sleep(1)
    createStb()
  }

  function destroyStb(): void {
    if (folderStb) {
      try {
        folderStb.destroy()
      } catch (error) {}
      folderStb = null
    }
    chatsStb.map((stb) => {
      try {
        stb.destroy()
      } catch (error) {}
    })
    chatsStb = []
  }

  const createStb = () => {
    if (!listEle || !folderEles) return
    for (let chat of listEle.querySelectorAll('.risu-chat')) {
      chatsStb.push(
        new Sortable(chat, {
          group: 'chats',
          onEnd: async () => {
            const previous = currentChatStateSnapshot()
            const currentChatPage = chara.chatPage
            const usingServerCommands = canUseServerCommands()
            const chatOrder = buildChatDomOrder()

            if (!chatOrder || (usingServerCommands && !chara.chaId)) {
              if (!chara.chaId && usingServerCommands) rejectStaleReorder('character is missing an id')
              await resetSortableProjection()
              return
            }

            const selectedChatId = selectedChatIdFromDom(chatOrder.chatsById, chara.chats[currentChatPage]?.id)
            if (usingServerCommands) {
              dispatchReorderChatsByIds(
                chara.chaId,
                chatOrder.chatIds,
                chatOrder.folderByChatId,
                previous,
                selectedChatId,
              )
            } else {
              const newChats = chatOrder.chatIds.map((chatId) => chatOrder.chatsById.get(chatId) as Chat)
              for (const chat of newChats) {
                chat.folderId = chatOrder.folderByChatId[chat.id] ?? null
              }
              changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
              chara.chats = newChats
              dispatchReorderChats(chara.chaId, previous, chara.chats[chara.chatPage]?.id)
            }

            await resetSortableProjection()
          },
          ...sortableOptions,
        }),
      )
    }
    folderStb = Sortable.create(folderEles, {
      group: 'folders',
      onEnd: async (event) => {
        const previous = currentChatStateSnapshot()
        const currentChatPage = chara.chatPage
        const usingServerCommands = canUseServerCommands()
        const folderOrder = buildFolderDomOrder(event.to)

        if (!folderOrder || (usingServerCommands && !chara.chaId)) {
          if (!chara.chaId && usingServerCommands) rejectStaleReorder('character is missing an id')
          await resetSortableProjection()
          return
        }

        const selectedChatId = selectedChatIdFromDom(folderOrder.chatsById, chara.chats[currentChatPage]?.id)
        if (usingServerCommands) {
          dispatchReorderChatFoldersAndChatsByIds(
            chara.chaId,
            folderOrder.folderIds,
            folderOrder.chatIds,
            folderOrder.folderByChatId,
            previous,
            selectedChatId,
          )
        } else {
          const newFolders = folderOrder.folderIds.map(
            (folderId) => folderOrder.foldersById.get(folderId) as ChatFolder,
          )
          const newChats = folderOrder.chatIds.map((chatId) => folderOrder.chatsById.get(chatId) as Chat)
          for (const chat of newChats) {
            chat.folderId = folderOrder.folderByChatId[chat.id] ?? null
          }
          chara.chatFolders = newFolders
          changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
          chara.chats = newChats
        }
        await resetSortableProjection()
      },
      ...sortableOptions,
    })
  }

  $effect(() => {
    const signature = chatRouteOpen
      ? 'chat-open'
      : `chat-list:${(chara.chatFolders ?? []).map((folder) => folder.id).join('\u0000')}`
    if (signature === sortableStructureSignature) return
    sortableStructureSignature = signature
    const generation = ++sortableReconcileGeneration

    if (chatRouteOpen) {
      destroyStb()
      return
    }

    void tick().then(() => {
      if (generation !== sortableReconcileGeneration || chatRouteOpen) return
      destroyStb()
      createStb()
    })
  })

  onDestroy(() => {
    sortableReconcileGeneration += 1
    destroyStb()
  })
</script>

<div
  data-risu-chat-list="sidebar"
  class="flex flex-col w-full h-[calc(100%-2rem)] max-h-[calc(100%-2rem)]"
  data-risu-chat-open={chatRouteOpen ? 'true' : 'false'}>
  {#if chatRouteOpen}
    <div class="flex flex-col gap-3">
      <button
        data-risu-chat-action="back-to-chat-list"
        class="flex items-center gap-2 text-textcolor2 hover:text-green-500 cursor-pointer mb-1"
        onclick={backToChatList}>
        <ArrowLeftIcon size={18} />
        <span>{language.goback}</span>
      </button>

      {#if getDatabase().characters[$selectedCharID]?.chaId !== '§playground'}
        <AuthorNoteEditor {chara} />
        <Toggles {chara} />
      {/if}
    </div>
  {:else}
    <div class="w-full" data-risu-chat-action="create">
      <Button className="relative bottom-2 w-full" onclick={createChat}>{language.newChat}</Button>
    </div>

    {#key sorted}
      <div class="flex flex-col mt-2 overflow-y-auto grow" bind:this={listEle}>
        <div class="flex flex-col" bind:this={folderEles}>
          {#each chara.chatFolders as folder, i}
            <div
              data-risu-chat-folder-idx={i}
              data-risu-chat-folder-id={folder.id}
              data-risu-chat-folder-folded={folder.folded ? 'true' : 'false'}
              class="flex flex-col mb-2 border-solid border-1 border-darkborderc cursor-pointer rounded-md">
              <div
                data-risu-chat-folder-header
                class="flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
                class:bg-red-900={folder.color === 'red'}
                class:bg-yellow-900={folder.color === 'yellow'}
                class:bg-green-900={folder.color === 'green'}
                class:bg-blue-900={folder.color === 'blue'}
                class:bg-indigo-900={folder.color === 'indigo'}
                class:bg-purple-900={folder.color === 'purple'}
                class:bg-pink-900={folder.color === 'pink'}>
                {#if editMode}
                  <TextInput
                    bind:value={() => folder.name, (value) => updateFolderName(folder, value)}
                    className="grow min-w-0"
                    ariaLabel={`${language.edit}: ${folder.name}`}
                    padding={false} />
                {:else}
                  <button
                    type="button"
                    data-risu-chat-action="toggle-folder"
                    aria-expanded={!folder.folded}
                    aria-controls={`risu-chat-folder-panel-${folder.id}`}
                    class="min-w-0 grow cursor-pointer text-left"
                    onclick={() => {
                      const previous = currentChatStateSnapshot()
                      const folded = !folder.folded
                      if (!applyDirectOptimisticFolderMetadata(folder.id, (candidate) => (candidate.folded = folded)))
                        return
                      dispatchUpdateChatFolder(
                        folder.id,
                        { folded },
                        previous,
                        rollbackServerBackedChatFolderRowMetadata,
                      )
                      reloadGuiDisplay()
                    }}>
                    <span>{folder.name}</span>
                  </button>
                {/if}
                <div class="ml-auto flex shrink-0 justify-end">
                  <button
                    type="button"
                    data-risu-chat-action="folder-options"
                    aria-label={`${language.options}: ${folder.name}`}
                    class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                    onclick={async (e) => {
                      e.stopPropagation()
                      const selection = await alertSelect([language.changeFolderColor])
                      if (selection === null) return
                      const sel = Number(selection)
                      switch (sel) {
                        case 0:
                          const colors = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default']
                          const colorSelection = await alertSelect(colors)
                          if (colorSelection === null) return
                          const sel = Number(colorSelection)
                          const previous = currentChatStateSnapshot()
                          const color = colors[sel]
                          if (!color) break
                          if (!applyDirectOptimisticFolderMetadata(folder.id, (candidate) => (candidate.color = color)))
                            break
                          dispatchUpdateChatFolder(
                            folder.id,
                            { color },
                            previous,
                            rollbackServerBackedChatFolderRowMetadata,
                          )
                          break
                      }
                    }}>
                    <MenuIcon size={18} />
                  </button>
                  <button
                    type="button"
                    data-risu-chat-action="folder-edit"
                    aria-label={`${language.edit}: ${folder.name}`}
                    class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                    onclick={(e) => {
                      e.stopPropagation()
                      editMode = !editMode
                    }}>
                    <PencilIcon size={18} />
                  </button>
                  <button
                    type="button"
                    data-risu-chat-action="folder-delete"
                    aria-label={`${language.remove}: ${folder.name}`}
                    class="text-textcolor2 hover:text-green-500 cursor-pointer"
                    onclick={async (e) => {
                      e.stopPropagation()
                      const d = await alertConfirm(`${language.removeConfirm}${folder.name}`)
                      if (d) {
                        const previous = currentChatStateSnapshot()
                        reloadGuiDisplay()
                        if (!canUseServerCommands()) {
                          const folders = chara.chatFolders
                          folders.splice(i, 1)
                          chara.chats.forEach((chat) => {
                            if (chat.folderId == folder.id) {
                              chat.folderId = null
                            }
                          })
                          chara.chatFolders = folders
                        }
                        dispatchDeleteChatFolder(folder.id, previous)
                      }
                    }}>
                    <TrashIcon size={18} />
                  </button>
                </div>
              </div>
              <div
                id={`risu-chat-folder-panel-${folder.id}`}
                data-risu-chat-folder-panel-id={folder.id}
                hidden={folder.folded}
                class="risu-chat flex flex-col w-full text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md {folder.folded
                  ? 'hidden'
                  : ''}">
                {#if (chatsByFolderId.get(folder.id) ?? []).length == 0}
                  <span class="no-sort flex justify-center text-textcolor2">Empty</span>
                  <div></div>
                {:else}
                  {#each chatsByFolderId.get(folder.id) ?? [] as { chat, index }}
                    <div
                      data-risu-chat-idx={index}
                      data-risu-chat-id={chat.id ?? ''}
                      data-risu-chat-folder-id={chat.folderId ?? ''}
                      data-risu-chat-selected={index === chara.chatPage ? 'true' : 'false'}
                      class="risu-chats flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
                      class:bg-selected={index === chara.chatPage}>
                      {#if editMode}
                        <TextInput
                          bind:value={() => chat.name, (value) => updateChatName(chat, value)}
                          className="grow min-w-0"
                          ariaLabel={`${language.edit}: ${chat.name}`}
                          padding={false} />
                      {:else}
                        <button
                          type="button"
                          data-risu-chat-action="select"
                          aria-current={index === chara.chatPage ? 'page' : undefined}
                          class="min-w-0 grow cursor-pointer text-left"
                          onclick={() => {
                            selectChat(index)
                            reloadGuiDisplay()
                          }}>
                          <span>{chat.name}</span>
                        </button>
                      {/if}
                      <div class="ml-auto flex shrink-0 justify-end">
                        <button
                          type="button"
                          data-risu-chat-action="options"
                          aria-label={`${language.chatOptions}: ${chat.name}`}
                          aria-busy={pendingPersonaBindings[chat.id ?? ''] ?? false}
                          aria-disabled={pendingPersonaBindings[chat.id ?? ''] ?? false}
                          disabled={pendingPersonaBindings[chat.id ?? ''] ?? false}
                          class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                          class:opacity-50={pendingPersonaBindings[chat.id ?? '']}
                          onclick={async (e) => {
                            e.stopPropagation()
                            if (pendingPersonaBindings[chat.id ?? '']) return
                            const option = await alertChatOptions()
                            switch (option) {
                              case 0: {
                                await forkChat(chat)
                                break
                              }
                              case 1: {
                                await togglePersonaBinding(chat.id)
                                break
                              }
                            }
                          }}>
                          <MenuIcon size={18} />
                        </button>
                        <button
                          type="button"
                          data-risu-chat-action="edit"
                          aria-label={`${language.edit}: ${chat.name}`}
                          class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                          onclick={(e) => {
                            e.stopPropagation()
                            editMode = !editMode
                          }}>
                          <PencilIcon size={18} />
                        </button>
                        <button
                          type="button"
                          data-risu-chat-action="export"
                          aria-label={`${language.export}: ${chat.name}`}
                          class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                          onclick={async (e) => {
                            e.stopPropagation()
                            if (chara.chaId && chat.id) {
                              exportChat({ characterId: chara.chaId, chatId: chat.id })
                            }
                          }}>
                          <DownloadIcon size={18} />
                        </button>
                        <button
                          type="button"
                          data-risu-chat-action="delete"
                          aria-label={`${language.remove}: ${chat.name}`}
                          class="text-textcolor2 hover:text-green-500 cursor-pointer"
                          onclick={async (e) => {
                            e.stopPropagation()
                            await deleteChat(chat, chara.chats.indexOf(chat))
                          }}>
                          <TrashIcon size={18} />
                        </button>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
        <div class="risu-chat flex flex-col">
          {#each chara.chats as chat, i}
            {#if chat.folderId == null}
              <div
                data-risu-chat-idx={i}
                data-risu-chat-id={chat.id ?? ''}
                data-risu-chat-folder-id={chat.folderId ?? ''}
                data-risu-chat-selected={i === chara.chatPage ? 'true' : 'false'}
                class="flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
                class:bg-selected={i === chara.chatPage}>
                {#if editMode}
                  <TextInput
                    bind:value={() => chat.name, (value) => updateChatName(chat, value)}
                    className="grow min-w-0"
                    ariaLabel={`${language.edit}: ${chat.name}`}
                    padding={false} />
                {:else}
                  <button
                    type="button"
                    data-risu-chat-action="select"
                    aria-current={i === chara.chatPage ? 'page' : undefined}
                    class="min-w-0 grow cursor-pointer text-left"
                    onclick={() => {
                      selectChat(i)
                      reloadGuiDisplay()
                    }}>
                    <span>{chat.name}</span>
                  </button>
                {/if}
                <div class="ml-auto flex shrink-0 justify-end">
                  <button
                    type="button"
                    data-risu-chat-action="options"
                    aria-label={`${language.chatOptions}: ${chat.name}`}
                    aria-busy={pendingPersonaBindings[chat.id ?? ''] ?? false}
                    aria-disabled={pendingPersonaBindings[chat.id ?? ''] ?? false}
                    disabled={pendingPersonaBindings[chat.id ?? ''] ?? false}
                    class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                    class:opacity-50={pendingPersonaBindings[chat.id ?? '']}
                    onclick={async (e) => {
                      e.stopPropagation()
                      if (pendingPersonaBindings[chat.id ?? '']) return
                      const option = await alertChatOptions()
                      switch (option) {
                        case 0: {
                          await forkChat(chat)
                          break
                        }
                        case 1: {
                          await togglePersonaBinding(chat.id)
                          break
                        }
                      }
                    }}>
                    <MenuIcon size={18} />
                  </button>
                  <button
                    type="button"
                    data-risu-chat-action="edit"
                    aria-label={`${language.edit}: ${chat.name}`}
                    class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                    onclick={(e) => {
                      e.stopPropagation()
                      editMode = !editMode
                    }}>
                    <PencilIcon size={18} />
                  </button>
                  <button
                    type="button"
                    data-risu-chat-action="export"
                    aria-label={`${language.export}: ${chat.name}`}
                    class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                    onclick={async (e) => {
                      e.stopPropagation()
                      if (chara.chaId && chat.id) {
                        exportChat({ characterId: chara.chaId, chatId: chat.id })
                      }
                    }}>
                    <DownloadIcon size={18} />
                  </button>
                  <button
                    type="button"
                    data-risu-chat-action="delete"
                    aria-label={`${language.remove}: ${chat.name}`}
                    class="text-textcolor2 hover:text-green-500 cursor-pointer"
                    onclick={async (e) => {
                      e.stopPropagation()
                      await deleteChat(chat, i)
                    }}>
                    <TrashIcon size={18} />
                  </button>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/key}

    <div class="border-t border-selected mt-2">
      <div class="flex mt-2 ml-2 items-center">
        <button
          data-risu-chat-action="export-all"
          aria-label={language.chatListExportAll}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={() => {
            if (chara.chaId) {
              exportAllChats(chara.chaId)
            }
          }}>
          <DownloadIcon size={18} />
        </button>
        <button
          data-risu-chat-action="import"
          aria-label={language.chatListImport}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={() => {
            importChat()
          }}>
          <HardDriveUploadIcon size={18} />
        </button>
        <button
          data-risu-chat-action="edit-list"
          aria-label={language.chatListEdit}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={() => {
            editMode = !editMode
          }}>
          <PencilIcon size={18} />
        </button>
        <button
          data-risu-chat-action="branches"
          aria-label={language.branch}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={async () => {
            // Branch tree hashes require all lazily-loaded chats first.
            try {
              await ensureAllChatsHydrated({ strict: true })
            } catch (error) {
              alertError(error)
              return
            }
            alertStore.set({
              type: 'branches',
              msg: '',
            })
          }}>
          <SplitIcon size={18} />
        </button>
        <button
          data-risu-chat-action="bookmarks"
          aria-label={language.bookmarks}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={() => {
            $bookmarkListOpen = true
          }}>
          <BookmarkCheckIcon size={18} />
        </button>
        <button
          data-risu-chat-action="create-folder"
          aria-label={language.chatListCreateFolder}
          class="ml-auto text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={() => {
            const previous = currentChatStateSnapshot()
            const length = chara.chatFolders?.length ?? 0
            const folder = {
              id: v4(),
              name: `New Folder ${length + 1}`,
              folded: false,
            }
            if (canUseServerCommands()) {
              applyOptimisticCreatedChatFolder(chara.chaId, folder, previous)
            } else {
              if (!chara.chatFolders) {
                chara.chatFolders = []
              }
              const folders = chara.chatFolders
              folders.unshift(folder)
              chara.chatFolders = folders
              reloadGuiDisplay()
            }
            dispatchCreateChatFolder(chara.chaId, folder, previous)
          }}>
          <FolderPlusIcon size={18} />
        </button>
      </div>
    </div>
  {/if}
</div>
