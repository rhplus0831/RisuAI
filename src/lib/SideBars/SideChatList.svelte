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
  import {
    currentChatStateSnapshot,
    dispatchCreateChat,
    dispatchCreateChatFolder,
    dispatchDeleteChat,
    dispatchDeleteChatFolder,
    dispatchForkChat,
    dispatchReorderChatFolders,
    dispatchReorderChats,
    dispatchUpdateChat,
    dispatchUpdateChatFolder,
  } from 'src/ts/chatCommands'
  import { watchServerBackedChatMetadata } from 'src/ts/server/chatBridge.svelte'

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

  $effect(() => {
    const stop = watchServerBackedChatMetadata()
    return stop
  })

  const createStb = () => {
    for (let chat of listEle.querySelectorAll('.risu-chat')) {
      chatsStb.push(
        new Sortable(chat, {
          group: 'chats',
          onEnd: async (event) => {
            const previous = currentChatStateSnapshot()
            const currentChatPage = chara.chatPage
            const newChats: Chat[] = []

            // const chats: HTMLElement = event.to
            // chats.querySelectorAll()

            listEle.querySelectorAll('[data-risu-chat-folder-idx]').forEach((folder) => {
              const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
              folder.querySelectorAll('[data-risu-chat-idx]').forEach((chatInFolder) => {
                const chatIdx = parseInt(chatInFolder.getAttribute('data-risu-chat-idx'))
                const newChat = chara.chats[chatIdx]
                newChat.folderId = chara.chatFolders[folderIdx].id
                newChats.push(newChat)
              })
            })

            listEle.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
              const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
              const newChat = chara.chats[idx]
              if (newChats.includes(newChat) == false) {
                if (newChat.folderId != null) newChat.folderId = null
                newChats.push(newChat)
              }
            })

            changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
            chara.chats = newChats
            dispatchReorderChats(chara.chaId, previous, chara.chats[chara.chatPage]?.id)

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
        const folders: HTMLElement[] = Array.from<HTMLElement>(event.to.children)

        const currentChatPage = chara.chatPage

        folders.forEach((folder) => {
          const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
          newFolders.push(chara.chatFolders[folderIdx])

          folder.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
            const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
            newChats.push(chara.chats[idx])
          })
        })

        listEle.querySelectorAll('[data-risu-chat-idx]').forEach((chatEle) => {
          const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
          if (newChats.includes(chara.chats[idx]) == false) {
            newChats.push(chara.chats[idx])
          }
        })

        chara.chatFolders = newFolders
        changeChatTo(newChats.indexOf(chara.chats[currentChatPage]))
        chara.chats = newChats
        dispatchReorderChatFolders(chara.chaId, previous, chara.chats[chara.chatPage]?.id)
        dispatchReorderChats(chara.chaId, previous, chara.chats[chara.chatPage]?.id)
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
  <Button
    className="relative bottom-2"
    onclick={() => {
      const previous = currentChatStateSnapshot()
      const len = chara.chats.length
      let chats = chara.chats
      const chat = {
        message: [],
        note: '',
        name: `New Chat ${len + 1}`,
        localLore: [],
        fmIndex: -1,
        id: v4(),
      }
      chats.unshift(chat)
      chara.chats = chats
      changeChatTo(0)
      dispatchCreateChat(chara.chaId, chat, previous)
      $ReloadGUIPointer += 1
    }}>{language.newChat}</Button
  >

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
                  chara.chatFolders[i].folded = !folder.folded
                  dispatchUpdateChatFolder(
                    folder.id,
                    { folded: chara.chatFolders[i].folded },
                    previous,
                  )
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
                  bind:value={chara.chatFolders[i].name}
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
                        folder.color = colors[sel]
                        dispatchUpdateChatFolder(folder.id, { color: folder.color }, previous)
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
                  onclick={() => {
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
                      const folders = chara.chatFolders
                      folders.splice(i, 1)
                      chara.chats.forEach((chat) => {
                        if (chat.folderId == folder.id) {
                          chat.folderId = null
                        }
                      })
                      chara.chatFolders = folders
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
              {#if chara.chats.filter((chat) => chat.folderId == chara.chatFolders[i].id).length == 0}
                <span class="no-sort flex justify-center text-textcolor2">Empty</span>
                <div></div>
              {:else}
                {#each chara.chats.filter((chat) => chat.folderId == chara.chatFolders[i].id) as chat}
                  <button
                    data-risu-chat-idx={chara.chats.indexOf(chat)}
                    onclick={() => {
                      if (!editMode) {
                        changeChatTo(chara.chats.indexOf(chat))
                        $ReloadGUIPointer += 1
                      }
                    }}
                    class="risu-chats flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
                    class:bg-selected={chara.chats.indexOf(chat) === chara.chatPage}
                  >
                    {#if editMode}
                      <TextInput bind:value={chat.name} className="grow min-w-0" padding={false} />
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
                        onclick={async () => {
                          const option = await alertChatOptions()
                          switch (option) {
                            case 0: {
                              const previous = currentChatStateSnapshot()
                              const newChat = $state.snapshot(
                                chara.chats[chara.chats.indexOf(chat)],
                              )
                              newChat.name = createChatCopyName(newChat.name, 'Copy')
                              newChat.id = v4()
                              chara.chats.unshift(newChat)
                              changeChatTo(0)
                              chara.chats = chara.chats
                              dispatchForkChat(chat.id, previous, { chat: newChat })
                              break
                            }
                            case 1: {
                              const previous = currentChatStateSnapshot()
                              if (chat.bindedPersona) {
                                const confirm = await alertConfirm(
                                  language.doYouWantToUnbindCurrentPersona,
                                )
                                if (confirm) {
                                  chat.bindedPersona = ''
                                  dispatchUpdateChat(chat.id, { bindedPersona: '' }, previous)
                                  alertNormal(language.personaUnbindedSuccess)
                                }
                              } else {
                                const confirm = await alertConfirm(
                                  language.doYouWantToBindCurrentPersona,
                                )
                                if (confirm) {
                                  if (!DBState.db.personas[DBState.db.selectedPersona].id) {
                                    DBState.db.personas[DBState.db.selectedPersona].id = v4()
                                  }
                                  chat.bindedPersona =
                                    DBState.db.personas[DBState.db.selectedPersona].id
                                  dispatchUpdateChat(
                                    chat.id,
                                    { bindedPersona: chat.bindedPersona },
                                    previous,
                                  )
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
                        onclick={() => {
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
                            changeChatTo(0)
                            $ReloadGUIPointer += 1
                            let chats = chara.chats
                            chats.splice(chara.chats.indexOf(chat), 1)
                            chara.chats = chats
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
                  changeChatTo(i)
                  $ReloadGUIPointer += 1
                }
              }}
              class="flex items-center text-textcolor border-solid border-0 border-darkborderc p-2 cursor-pointer rounded-md"
              class:bg-selected={i === chara.chatPage}
            >
              {#if editMode}
                <TextInput
                  bind:value={chara.chats[i].name}
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
                  onclick={async () => {
                    const option = await alertChatOptions()
                    switch (option) {
                      case 0: {
                        const previous = currentChatStateSnapshot()
                        const newChat = $state.snapshot(chara.chats[i])
                        newChat.name = createChatCopyName(newChat.name, 'Copy')
                        newChat.id = v4()
                        chara.chats.unshift(newChat)
                        changeChatTo(0)
                        chara.chats = chara.chats
                        dispatchForkChat(chat.id, previous, { chat: newChat })
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
                            chat.bindedPersona = ''
                            dispatchUpdateChat(chat.id, { bindedPersona: '' }, previous)
                            alertNormal(language.personaUnbindedSuccess)
                          }
                        } else {
                          const confirm = await alertConfirm(language.doYouWantToBindCurrentPersona)
                          if (confirm) {
                            if (!DBState.db.personas[DBState.db.selectedPersona].id) {
                              DBState.db.personas[DBState.db.selectedPersona].id = v4()
                            }
                            chat.bindedPersona = DBState.db.personas[DBState.db.selectedPersona].id
                            dispatchUpdateChat(
                              chat.id,
                              { bindedPersona: chat.bindedPersona },
                              previous,
                            )
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
                  onclick={() => {
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
                      changeChatTo(0)
                      $ReloadGUIPointer += 1
                      let chats = chara.chats
                      chats.splice(i, 1)
                      chara.chats = chats
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
        onclick={() => {
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
          if (!chara.chatFolders) {
            chara.chatFolders = []
          }
          const folders = chara.chatFolders
          const length = chara.chatFolders.length
          folders.unshift({
            id: v4(),
            name: `New Folder ${length + 1}`,
            folded: false,
          })
          const folder = folders[0]
          chara.chatFolders = folders
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
