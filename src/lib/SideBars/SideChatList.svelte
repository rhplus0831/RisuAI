<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
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
  } from '@lucide/svelte'

  import type { Chat, ChatFolder, character } from 'src/ts/storage/database.svelte'
  import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'

  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'

  import { exportChat, importChat, exportAllChats } from 'src/ts/characters'
  import {
    alertChatOptions,
    alertConfirm,
    alertError,
    alertNormal,
    alertSelect,
    alertStore,
  } from 'src/ts/alert'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { bookmarkListOpen } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import Toggles from './Toggles.svelte'
  import { changeChatTo, createChatCopyName } from 'src/ts/globalApi.svelte'
  import { ensureAllChatsHydrated } from 'src/ts/server/chatMessageHydration.svelte'
  import {
    currentChatStateSnapshot,
    dispatchCreateChat,
    dispatchCreateChatFolder,
    dispatchDeleteChat,
    dispatchDeleteChatFolder,
    dispatchForkChat,
    dispatchReorderChats,
    dispatchReorderChatsByIds,
    dispatchUpdateChat,
    dispatchUpdateChatFolder,
    restoreChatState,
    runOptimisticCommandSequence,
  } from 'src/ts/chatCommands'
  import {
    canUseServerCommands,
    reorderChatFoldersCommand,
    reorderChatsCommand,
  } from 'src/ts/server/commands'
  import { watchServerBackedChatMetadata } from 'src/ts/server/chatBridge.svelte'
  import { groupChatsByFolderId } from './chatFolderGrouping'

  interface Props {
    chara: character
  }

  let { chara = $bindable() }: Props = $props()
  let editMode = $state(false)

  let chatsStb: Sortable[] = []
  let folderStb: Sortable = null

  let folderEles: HTMLDivElement = $state()
  let listEle: HTMLDivElement = $state()
  let sorted = $state(0)
  let opened = 0

  // Group the chats by folder id in a single pass, keeping each chat's index in
  // `chara.chats`. The folder template previously ran `chara.chats.filter(...)`
  // twice per folder plus an `indexOf` per rendered chat — O(folders*chats) +
  // O(chats^2) on every render. The map lookup keeps the same ordering while
  // removing both rescans. See `chatFolderGrouping.ts` for the pure helper.
  let chatsByFolderId = $derived(groupChatsByFolderId(chara.chats))

  $effect(() => {
    const stop = watchServerBackedChatMetadata()
    return stop
  })

  function selectChat(index: number): void {
    const chatId = chara.chats[index]?.id
    if (canUseServerCommands() && chatId) {
      dispatchUpdateChat(chatId, {}, currentChatStateSnapshot(), true)
      return
    }
    changeChatTo(index)
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
      dispatchCreateChat(chara.chaId, chat, previous)
      return
    }
    chara.chats.unshift(chat)
    changeChatTo(0)
    $ReloadGUIPointer += 1
  }

  function forkChat(sourceChat: Chat): void {
    const previous = currentChatStateSnapshot()
    const newChat = $state.snapshot(sourceChat)
    newChat.name = createChatCopyName(newChat.name, 'Copy')
    newChat.id = v4()
    if (canUseServerCommands()) {
      dispatchForkChat(sourceChat.id, previous, { chat: newChat })
      return
    }
    chara.chats.unshift(newChat)
    changeChatTo(0)
    chara.chats = chara.chats
  }

  function updateChatName(chat: Chat, name: string): void {
    if (canUseServerCommands()) {
      dispatchUpdateChat(chat.id, { name }, currentChatStateSnapshot())
      return
    }
    chat.name = name
  }

  function updateFolderName(folder: ChatFolder, name: string): void {
    if (canUseServerCommands()) {
      dispatchUpdateChatFolder(folder.id, { name }, currentChatStateSnapshot())
      return
    }
    folder.name = name
  }

  const createStb = () => {
    for (let chat of listEle.querySelectorAll('.risu-chat')) {
      chatsStb.push(
        new Sortable(chat, {
          group: 'chats',
          onEnd: async (event) => {
            const previous = currentChatStateSnapshot()
            const currentChatPage = chara.chatPage
            const newChats: Chat[] = []
            const chatIds: string[] = []
            const folderByChatId: Record<string, string | null> = {}

            listEle.querySelectorAll('[data-risu-chat-folder-idx]').forEach((folder) => {
              const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
              folder.querySelectorAll('[data-risu-chat-idx]').forEach((chatInFolder) => {
                const chatIdx = parseInt(chatInFolder.getAttribute('data-risu-chat-idx'))
                const newChat = chara.chats[chatIdx]
                const folderId = chara.chatFolders[folderIdx].id
                if (newChat.id) {
                  chatIds.push(newChat.id)
                  folderByChatId[newChat.id] = folderId
                }
                if (!canUseServerCommands()) newChat.folderId = folderId
                newChats.push(newChat)
              })
            })

            listEle.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
              const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
              const newChat = chara.chats[idx]
              if (newChats.includes(newChat) == false) {
                if (newChat.id) {
                  chatIds.push(newChat.id)
                  folderByChatId[newChat.id] = null
                }
                if (!canUseServerCommands() && newChat.folderId != null) newChat.folderId = null
                newChats.push(newChat)
              }
            })

            const selectedChatId = chara.chats[currentChatPage]?.id
            if (canUseServerCommands()) {
              dispatchReorderChatsByIds(
                chara.chaId,
                chatIds,
                folderByChatId,
                previous,
                selectedChatId,
              )
            } else {
              changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
              chara.chats = newChats
              dispatchReorderChats(chara.chaId, previous, chara.chats[chara.chatPage]?.id)
            }

            try {
              this.destroy()
            } catch (e) {}
            sorted += 1
            await sleep(1)
            createStb()
          },
          ...sortableOptions,
        }),
      )
    }
    folderStb = Sortable.create(folderEles, {
      group: 'folders',
      onEnd: async (event) => {
        const previous = currentChatStateSnapshot()
        const newFolders: ChatFolder[] = []
        const newChats: Chat[] = []
        const folderIds: string[] = []
        const chatIds: string[] = []
        const folderByChatId: Record<string, string | null> = {}
        const folders: HTMLElement[] = Array.from<HTMLElement>(event.to.children)

        const currentChatPage = chara.chatPage

        folders.forEach((folder) => {
          const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
          const nextFolder = chara.chatFolders[folderIdx]
          newFolders.push(nextFolder)
          if (nextFolder?.id) folderIds.push(nextFolder.id)

          folder.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
            const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
            const chat = chara.chats[idx]
            newChats.push(chat)
            if (chat?.id) {
              chatIds.push(chat.id)
              folderByChatId[chat.id] = chat.folderId ?? null
            }
          })
        })

        listEle.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
          const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
          if (newChats.includes(chara.chats[idx]) == false) {
            const chat = chara.chats[idx]
            newChats.push(chat)
            if (chat?.id) {
              chatIds.push(chat.id)
              folderByChatId[chat.id] = chat.folderId ?? null
            }
          }
        })

        const selectedChatId = chara.chats[currentChatPage]?.id
        if (canUseServerCommands()) {
          // Serialize folder and chat reorders against one optimistic snapshot.
          const folderIdsSnapshot = [...folderIds]
          const chatIdsSnapshot = [...chatIds]
          const folderByChatIdSnapshot = { ...folderByChatId }
          runOptimisticCommandSequence(
            [
              (baseRevision) =>
                reorderChatFoldersCommand({
                  baseRevision,
                  characterId: chara.chaId,
                  folderIds: folderIdsSnapshot,
                  selectedChatId,
                }),
              (baseRevision) =>
                reorderChatsCommand({
                  baseRevision,
                  characterId: chara.chaId,
                  chatIds: chatIdsSnapshot,
                  folderByChatId: folderByChatIdSnapshot,
                  selectedChatId,
                }),
            ],
            () => restoreChatState(previous),
          )
        } else {
          chara.chatFolders = newFolders
          changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
          chara.chats = newChats
        }
        try {
          folderStb.destroy()
        } catch (e) {}
        sorted += 1
        await sleep(1)
        createStb()
      },
      ...sortableOptions,
    })
  }

  onMount(createStb)

  onDestroy(() => {
    if (folderStb) {
      try {
        folderStb.destroy()
      } catch (error) {}
    }
    chatsStb.map((stb) => {
      try {
        stb.destroy()
      } catch (error) {}
    })
  })
</script>

<div class="flex flex-col w-full h-[calc(100%-2rem)] max-h-[calc(100%-2rem)]">
  <Button className="relative bottom-2" onclick={createChat}>{language.newChat}</Button>

  {#key sorted}
    <div class="flex flex-col mt-2 overflow-y-auto grow" bind:this={listEle}>
      <!-- folder div -->
      <div class="flex flex-col" bind:this={folderEles}>
        <!-- chat folder -->
        {#each chara.chatFolders as folder, i}
          <div
            data-risu-chat-folder-idx={i}
            class="flex flex-col mb-2 border-solid border-1 border-darkborderc cursor-pointer rounded-md"
          >
            <!-- folder header -->
            <button
              onclick={() => {
                if (!editMode) {
                  const previous = currentChatStateSnapshot()
                  const folded = !folder.folded
                  if (!canUseServerCommands()) {
                    chara.chatFolders[i].folded = folded
                  }
                  dispatchUpdateChatFolder(folder.id, { folded }, previous)
                  $ReloadGUIPointer += 1
                }
              }}
              class="flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
              class:bg-red-900={folder.color === 'red'}
              class:bg-yellow-900={folder.color === 'yellow'}
              class:bg-green-900={folder.color === 'green'}
              class:bg-blue-900={folder.color === 'blue'}
              class:bg-indigo-900={folder.color === 'indigo'}
              class:bg-purple-900={folder.color === 'purple'}
              class:bg-pink-900={folder.color === 'pink'}
            >
              {#if editMode}
                <TextInput
                  bind:value={() => folder.name, (value) => updateFolderName(folder, value)}
                  className="grow min-w-0"
                  padding={false}
                />
              {:else}
                <span>{folder.name}</span>
              {/if}
              <div class="grow flex justify-end">
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                  onclick={async (e) => {
                    e.stopPropagation()
                    const sel = parseInt(
                      await alertSelect([language.changeFolderColor, language.cancel]),
                    )
                    switch (sel) {
                      case 0:
                        const colors = [
                          'red',
                          'green',
                          'blue',
                          'yellow',
                          'indigo',
                          'purple',
                          'pink',
                          'default',
                        ]
                        const sel = parseInt(await alertSelect(colors))
                        const previous = currentChatStateSnapshot()
                        const color = colors[sel]
                        if (!canUseServerCommands()) {
                          folder.color = color
                        }
                        dispatchUpdateChatFolder(folder.id, { color }, previous)
                        break
                    }
                  }}
                >
                  <MenuIcon size={18} />
                </div>
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                  onclick={(e) => {
                    e.stopPropagation()
                    editMode = !editMode
                  }}
                >
                  <PencilIcon size={18} />
                </div>
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 cursor-pointer"
                  onclick={async (e) => {
                    e.stopPropagation()
                    const d = await alertConfirm(`${language.removeConfirm}${folder.name}`)
                    if (d) {
                      const previous = currentChatStateSnapshot()
                      $ReloadGUIPointer += 1
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
                  }}
                >
                  <TrashIcon size={18} />
                </div>
              </div>
            </button>
            <!-- chats in folder -->
            <div
              class="risu-chat flex flex-col w-full text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md {folder.folded
                ? 'hidden'
                : ''}"
            >
              {#if (chatsByFolderId.get(folder.id) ?? []).length == 0}
                <span class="no-sort flex justify-center text-textcolor2">Empty</span>
                <div></div>
              {:else}
                {#each chatsByFolderId.get(folder.id) ?? [] as { chat, index }}
                  <button
                    data-risu-chat-idx={index}
                    onclick={() => {
                      if (!editMode) {
                        selectChat(index)
                        $ReloadGUIPointer += 1
                      }
                    }}
                    class="risu-chats flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
                    class:bg-selected={index === chara.chatPage}
                  >
                    {#if editMode}
                      <TextInput
                        bind:value={() => chat.name, (value) => updateChatName(chat, value)}
                        className="grow min-w-0"
                        padding={false}
                      />
                    {:else}
                      <span>{chat.name}</span>
                    {/if}
                    <div class="grow flex justify-end">
                      <div
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.click()
                          }
                        }}
                        class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                        onclick={async (e) => {
                          e.stopPropagation()
                          const option = await alertChatOptions()
                          switch (option) {
                            case 0: {
                              forkChat(chat)
                              break
                            }
                            case 1: {
                              const previous = currentChatStateSnapshot()
                              if (chat.bindedPersona) {
                                const confirm = await alertConfirm(
                                  language.doYouWantToUnbindCurrentPersona,
                                )
                                if (confirm) {
                                  if (!canUseServerCommands()) {
                                    chat.bindedPersona = ''
                                  }
                                  dispatchUpdateChat(chat.id, { bindedPersona: '' }, previous)
                                  alertNormal(language.personaUnbindedSuccess)
                                }
                              } else {
                                const confirm = await alertConfirm(
                                  language.doYouWantToBindCurrentPersona,
                                )
                                if (confirm) {
                                  const persona = DBState.db.personas[DBState.db.selectedPersona]
                                  const bindedPersona = persona.id || v4()
                                  if (!canUseServerCommands() && !persona.id) {
                                    persona.id = bindedPersona
                                  }
                                  if (!canUseServerCommands()) {
                                    chat.bindedPersona = bindedPersona
                                  }
                                  dispatchUpdateChat(chat.id, { bindedPersona }, previous)
                                  console.log(DBState.db.personas[DBState.db.selectedPersona])
                                  alertNormal(language.personaBindedSuccess)
                                }
                              }
                              break
                            }
                          }
                        }}
                      >
                        <MenuIcon size={18} />
                      </div>
                      <div
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.click()
                          }
                        }}
                        class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                        onclick={(e) => {
                          e.stopPropagation()
                          editMode = !editMode
                        }}
                      >
                        <PencilIcon size={18} />
                      </div>
                      <div
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.click()
                          }
                        }}
                        class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                        onclick={async (e) => {
                          e.stopPropagation()
                          exportChat(chara.chats.indexOf(chat))
                        }}
                      >
                        <DownloadIcon size={18} />
                      </div>
                      <div
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.click()
                          }
                        }}
                        class="text-textcolor2 hover:text-green-500 cursor-pointer"
                        onclick={async (e) => {
                          e.stopPropagation()
                          if (chara.chats.length === 1) {
                            alertError(language.errors.onlyOneChat)
                            return
                          }
                          const d = await alertConfirm(`${language.removeConfirm}${chat.name}`)
                          if (d) {
                            const previous = currentChatStateSnapshot()
                            if (!canUseServerCommands()) {
                              changeChatTo(0)
                            }
                            $ReloadGUIPointer += 1
                            if (!canUseServerCommands()) {
                              let chats = chara.chats
                              chats.splice(chara.chats.indexOf(chat), 1)
                              chara.chats = chats
                            }
                            dispatchDeleteChat(chat.id, previous)
                          }
                        }}
                      >
                        <TrashIcon size={18} />
                      </div>
                    </div>
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <!-- chat without folder div -->
      <div class="risu-chat flex flex-col">
        {#each chara.chats as chat, i}
          {#if chat.folderId == null}
            <button
              data-risu-chat-idx={i}
              onclick={() => {
                if (!editMode) {
                  selectChat(i)
                  $ReloadGUIPointer += 1
                }
              }}
              class="flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
              class:bg-selected={i === chara.chatPage}
            >
              {#if editMode}
                <TextInput
                  bind:value={() => chat.name, (value) => updateChatName(chat, value)}
                  className="grow min-w-0"
                  padding={false}
                />
              {:else}
                <span>{chat.name}</span>
              {/if}
              <div class="grow flex justify-end">
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                  onclick={async (e) => {
                    e.stopPropagation()
                    const option = await alertChatOptions()
                    switch (option) {
                      case 0: {
                        forkChat(chat)
                        break
                      }
                      case 1: {
                        const previous = currentChatStateSnapshot()
                        const chat = chara.chats[i]
                        if (chat.bindedPersona) {
                          const confirm = await alertConfirm(
                            language.doYouWantToUnbindCurrentPersona,
                          )
                          if (confirm) {
                            if (!canUseServerCommands()) {
                              chat.bindedPersona = ''
                            }
                            dispatchUpdateChat(chat.id, { bindedPersona: '' }, previous)
                            alertNormal(language.personaUnbindedSuccess)
                          }
                        } else {
                          const confirm = await alertConfirm(language.doYouWantToBindCurrentPersona)
                          if (confirm) {
                            const persona = DBState.db.personas[DBState.db.selectedPersona]
                            const bindedPersona = persona.id || v4()
                            if (!canUseServerCommands() && !persona.id) {
                              persona.id = bindedPersona
                            }
                            if (!canUseServerCommands()) {
                              chat.bindedPersona = bindedPersona
                            }
                            dispatchUpdateChat(chat.id, { bindedPersona }, previous)
                            console.log(DBState.db.personas[DBState.db.selectedPersona])
                            alertNormal(language.personaBindedSuccess)
                          }
                        }
                        break
                      }
                    }
                  }}
                >
                  <MenuIcon size={18} />
                </div>
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                  onclick={(e) => {
                    e.stopPropagation()
                    editMode = !editMode
                  }}
                >
                  <PencilIcon size={18} />
                </div>
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 mr-1 cursor-pointer"
                  onclick={async (e) => {
                    e.stopPropagation()
                    exportChat(i)
                  }}
                >
                  <DownloadIcon size={18} />
                </div>
                <div
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.click()
                    }
                  }}
                  class="text-textcolor2 hover:text-green-500 cursor-pointer"
                  onclick={async (e) => {
                    e.stopPropagation()
                    if (chara.chats.length === 1) {
                      alertError(language.errors.onlyOneChat)
                      return
                    }
                    const d = await alertConfirm(`${language.removeConfirm}${chat.name}`)
                    if (d) {
                      const previous = currentChatStateSnapshot()
                      if (!canUseServerCommands()) {
                        changeChatTo(0)
                      }
                      $ReloadGUIPointer += 1
                      if (!canUseServerCommands()) {
                        let chats = chara.chats
                        chats.splice(i, 1)
                        chara.chats = chats
                      }
                      dispatchDeleteChat(chat.id, previous)
                    }
                  }}
                >
                  <TrashIcon size={18} />
                </div>
              </div>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/key}

  <div class="border-t border-selected mt-2">
    <div class="flex mt-2 ml-2 items-center">
      <button
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          exportAllChats()
        }}
      >
        <DownloadIcon size={18} />
      </button>
      <button
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          importChat()
        }}
      >
        <HardDriveUploadIcon size={18} />
      </button>
      <button
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          editMode = !editMode
        }}
      >
        <PencilIcon size={18} />
      </button>
      <button
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={async () => {
          // Branch tree hashes require all lazily-loaded chats first.
          await ensureAllChatsHydrated()
          alertStore.set({
            type: 'branches',
            msg: '',
          })
        }}
      >
        <SplitIcon size={18} />
      </button>
      <button
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          $bookmarkListOpen = true
        }}
      >
        <BookmarkCheckIcon size={18} />
      </button>
      <button
        class="ml-auto text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          const previous = currentChatStateSnapshot()
          const length = chara.chatFolders?.length ?? 0
          const folder = {
            id: v4(),
            name: `New Folder ${length + 1}`,
            folded: false,
          }
          if (!canUseServerCommands()) {
            if (!chara.chatFolders) {
              chara.chatFolders = []
            }
            const folders = chara.chatFolders
            folders.unshift(folder)
            chara.chatFolders = folders
          }
          dispatchCreateChatFolder(chara.chaId, folder, previous)
          $ReloadGUIPointer += 1
        }}
      >
        <FolderPlusIcon size={18} />
      </button>
    </div>

    {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
      <Toggles bind:chara />
    {/if}
  </div>
</div>
