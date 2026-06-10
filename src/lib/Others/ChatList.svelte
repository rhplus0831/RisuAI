<script>
  import { alertConfirm, alertError } from '../../ts/alert'
  import { language } from '../../lang'

  import { DBState } from 'src/ts/stores.svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import {
    DownloadIcon,
    SquarePenIcon,
    HardDriveUploadIcon,
    PlusIcon,
    TrashIcon,
    XIcon,
  } from '@lucide/svelte'
  import { v4 } from 'uuid'
  import { exportChat, importChat } from '../../ts/characters'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { changeChatTo } from 'src/ts/globalApi.svelte'
  import {
    applyOptimisticCreatedChat,
    applyOptimisticDeletedChat,
    currentChatStateSnapshot,
    dispatchCreateChat,
    dispatchDeleteChat,
    dispatchUpdateChat,
  } from 'src/ts/chatCommands'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import { watchServerBackedChatMetadata } from 'src/ts/server/chatBridge.svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'

  let editMode = $state(false)
  let chatNameDrafts = $state({})
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()

  $effect(() => {
    const stop = watchServerBackedChatMetadata()
    return stop
  })

  $effect(() => {
    const drafts = {}
    for (const chat of DBState.db.characters[$selectedCharID]?.chats ?? []) {
      if (chat.id) {
        drafts[chat.id] = chat.name ?? ''
      }
    }
    chatNameDrafts = drafts
  })

  function updateChatName(chat, name) {
    if (!chat?.id || chat.name === name) return
    const previous = currentChatStateSnapshot()
    if (canUseServerCommands()) {
      dispatchUpdateChat(chat.id, { name }, previous)
      return
    }

    withTrustedServerProjectionWrite(() => {
      chat.name = name
    })
  }

  function openChatRoute(index) {
    const character = DBState.db.characters[$selectedCharID]
    const chatId = character?.chats?.[index]?.id
    if (character?.chaId && chatId) {
      navigate(characterRoutePath(character.chaId, chatId))
      close()
      return
    }

    changeChatTo(index)
    close()
  }
</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
  <div
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-72 max-h-full overflow-y-auto"
  >
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="mt-0 mb-0">{language.chatList}</h2>
      <div class="grow flex justify-end">
        <button
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          onclick={close}
        >
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#each DBState.db.characters[$selectedCharID].chats as chat, i}
      <button
        onclick={() => {
          if (!editMode) {
            openChatRoute(i)
          }
        }}
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={i === DBState.db.characters[$selectedCharID].chatPage}
      >
        {#if editMode}
          <TextInput
            bind:value={chatNameDrafts[chat.id]}
            padding={false}
            onchange={() => {
              updateChatName(chat, chatNameDrafts[chat.id])
            }}
          />
        {:else}
          <span>{chat.name}</span>
        {/if}
        <div class="grow flex justify-end">
          <div
            class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
            role="button"
            tabindex="0"
            onclick={async (e) => {
              e.stopPropagation()
              exportChat(i)
            }}
            onkeydown={() => {}}
          >
            <DownloadIcon size={18} />
          </div>
          <div
            class="text-textcolor2 hover:text-green-500 cursor-pointer"
            role="button"
            tabindex="0"
            onclick={async (e) => {
              e.stopPropagation()
              if (DBState.db.characters[$selectedCharID].chats.length === 1) {
                alertError(language.errors.onlyOneChat)
                return
              }
              const d = await alertConfirm(`${language.removeConfirm}${chat.name}`)
              if (d) {
                if (!chat.id) return
                const previous = currentChatStateSnapshot()
                const cha = DBState.db.characters[$selectedCharID]
                if (canUseServerCommands()) {
                  const result = applyOptimisticDeletedChat(cha.chaId, chat.id, previous)
                  if (result.applied && cha.chaId && result.selectedChatId) {
                    navigate(characterRoutePath(cha.chaId, result.selectedChatId), {
                      replace: true,
                    })
                  }
                } else {
                  changeChatTo(0)
                  let chats = DBState.db.characters[$selectedCharID].chats
                  chats.splice(i, 1)
                  DBState.db.characters[$selectedCharID].chats = chats
                }
                dispatchDeleteChat(chat.id, previous)
              }
            }}
            onkeydown={() => {}}
          >
            <TrashIcon size={18} />
          </div>
        </div>
      </button>
    {/each}
    <div class="flex mt-2 items-center">
      <button
        class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
        onclick={() => {
          const previous = currentChatStateSnapshot()
          const cha = DBState.db.characters[$selectedCharID]
          const len = DBState.db.characters[$selectedCharID].chats.length
          const chat = {
            message: [],
            note: '',
            name: `New Chat ${len + 1}`,
            localLore: [],
            fmIndex: -1,
            id: v4(),
          }
          if (!canUseServerCommands()) {
            let chats = DBState.db.characters[$selectedCharID].chats
            chats.unshift(chat)
            DBState.db.characters[$selectedCharID].chats = chats
            changeChatTo(0)
          } else {
            const applied = applyOptimisticCreatedChat(cha.chaId, chat, previous)
            if (applied && cha.chaId && chat.id) {
              navigate(characterRoutePath(cha.chaId, chat.id))
            }
          }
          dispatchCreateChat(cha.chaId, chat, previous)
          close()
        }}
      >
        <PlusIcon />
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
        class="text-textcolor2 hover:text-green-500 cursor-pointer"
        onclick={() => {
          editMode = !editMode
        }}
      >
        <SquarePenIcon size={18} />
      </button>
    </div>
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
</style>
