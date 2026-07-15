<script>
  import { untrack } from 'svelte'
  import { alertConfirm, alertError } from '../../ts/alert'
  import { language } from '../../lang'

  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import { DownloadIcon, SquarePenIcon, HardDriveUploadIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
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
  import {
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
    watchServerBackedChatMetadata,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { characterRoutePath, navigate } from 'src/ts/router'

  let editMode = $state(false)
  let chatNameDrafts = $state({})
  let chatNameBaselines = $state({})
  let chatNameDraftOwner = $state(undefined)
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()

  $effect(() => {
    const stop = untrack(() => watchServerBackedChatMetadata())
    return stop
  })

  $effect(() => {
    const previousDrafts = untrack(() => chatNameDrafts)
    const previousBaselines = untrack(() => chatNameBaselines)
    const previousOwner = untrack(() => chatNameDraftOwner)
    const character = getDatabase().characters[$selectedCharID]
    const owner = character?.chaId ?? `index:${$selectedCharID}`
    const drafts = {}
    const baselines = {}
    for (const chat of character?.chats ?? []) {
      if (chat.id) {
        const baseline = chat.name ?? ''
        const hasPreviousBaseline =
          previousOwner === owner && Object.prototype.hasOwnProperty.call(previousBaselines, chat.id)
        const draftIsDirty = hasPreviousBaseline && previousDrafts[chat.id] !== previousBaselines[chat.id]
        drafts[chat.id] = draftIsDirty ? previousDrafts[chat.id] : baseline
        baselines[chat.id] = baseline
      }
    }
    chatNameDrafts = drafts
    chatNameBaselines = baselines
    chatNameDraftOwner = owner
  })

  function updateChatName(chat, name) {
    if (!chat?.id || chat.name === name) return
    if (!canUseServerCommands()) {
      chat.name = name
      return
    }

    const previous = currentChatStateSnapshot()
    const previousCharacter = previous.characters[previous.selectedCharID]
    const previousChat = previousCharacter?.chats?.find((candidate) => candidate.id === chat.id)
    let applied = false
    withTrustedResourceWrite(() => {
      const liveCharacter = previousCharacter?.chaId
        ? getDatabase().characters?.find((candidate) => candidate.chaId === previousCharacter.chaId)
        : getDatabase().characters?.[previous.selectedCharID]
      const liveChat = liveCharacter?.chats?.find((candidate) => candidate.id === chat.id)
      if (!liveChat || liveChat.name !== previousChat?.name) return
      liveChat.name = name
      applied = true
    })
    if (!applied) return
    syncServerBackedChatMetadataBaselines()
    dispatchUpdateChat(chat.id, { name }, previous, false, rollbackServerBackedChatRowMetadata)
  }

  function openChatRoute(index) {
    const character = getDatabase().characters[$selectedCharID]
    const chatId = character?.chats?.[index]?.id
    if (character?.chaId && chatId) {
      navigate(characterRoutePath(character.chaId, chatId))
      close()
      return
    }

    changeChatTo(index)
    close()
  }

  function resolveOriginCharacter(originCharacterId, originSelectedCharIndex) {
    if (originCharacterId) {
      const byId = getDatabase().characters?.find((candidate) => candidate.chaId === originCharacterId)
      if (byId) return byId
    }

    const byIndex = getDatabase().characters?.[originSelectedCharIndex]
    if (originCharacterId && byIndex?.chaId && byIndex.chaId !== originCharacterId) return undefined
    return byIndex
  }

  function isOriginCharacterSelected(originCharacter, originCharacterId) {
    const selectedCharacter = getDatabase().characters?.[$selectedCharID]
    return (
      selectedCharacter === originCharacter || (originCharacterId && selectedCharacter?.chaId === originCharacterId)
    )
  }

  async function deleteModalChat(chat) {
    const originSelectedCharIndex = $selectedCharID
    const originCharacter = getDatabase().characters?.[originSelectedCharIndex]
    const originCharacterId = originCharacter?.chaId
    const targetChatId = chat?.id
    const targetChatName = chat?.name ?? ''

    if (originCharacter?.chats?.length === 1) {
      alertError(language.errors.onlyOneChat)
      return
    }

    const confirmed = await alertConfirm(`${language.removeConfirm}${targetChatName}`)
    if (!confirmed || !targetChatId) return

    const resolvedOriginCharacter = resolveOriginCharacter(originCharacterId, originSelectedCharIndex)
    const liveChatIndex = resolvedOriginCharacter?.chats?.findIndex((candidate) => candidate.id === targetChatId) ?? -1
    if (!resolvedOriginCharacter || liveChatIndex < 0 || resolvedOriginCharacter.chats.length <= 1) return

    const previous = currentChatStateSnapshot()
    previous.selectedCharID = originSelectedCharIndex
    const originStillSelected = isOriginCharacterSelected(resolvedOriginCharacter, originCharacterId)

    if (canUseServerCommands()) {
      const result = applyOptimisticDeletedChat(originCharacterId, targetChatId, previous)
      if (originStillSelected && result.applied && resolvedOriginCharacter.chaId && result.selectedChatId) {
        navigate(characterRoutePath(resolvedOriginCharacter.chaId, result.selectedChatId), {
          replace: true,
        })
      }
    } else {
      if (originStillSelected) {
        changeChatTo(0)
      } else {
        resolvedOriginCharacter.chatPage = 0
      }
      const chats = resolvedOriginCharacter.chats
      chats.splice(liveChatIndex, 1)
      resolvedOriginCharacter.chats = chats
    }
    dispatchDeleteChat(targetChatId, previous)
  }
</script>

<div data-risu-chat-list="modal" class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
  <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-72 max-h-full overflow-y-auto">
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="mt-0 mb-0">{language.chatList}</h2>
      <div class="grow flex justify-end">
        <button
          data-risu-chat-action="close"
          aria-label={language.close}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#each getDatabase().characters[$selectedCharID].chats as chat, i}
      <div
        data-risu-chat-id={chat.id ?? ''}
        data-risu-chat-idx={i}
        data-risu-chat-selected={i === getDatabase().characters[$selectedCharID].chatPage ? 'true' : 'false'}
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={i === getDatabase().characters[$selectedCharID].chatPage}>
        {#if editMode}
          <TextInput
            bind:value={chatNameDrafts[chat.id]}
            padding={false}
            onchange={() => {
              updateChatName(chat, chatNameDrafts[chat.id])
            }} />
        {:else}
          <button data-risu-chat-action="open" class="grow text-left" onclick={() => openChatRoute(i)}
            >{chat.name}</button>
        {/if}
        <div class="grow flex justify-end">
          <button
            type="button"
            data-risu-chat-action="export"
            aria-label={`${language.export}: ${chat.name}`}
            class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
            onclick={async () => {
              exportChat(i)
            }}>
            <DownloadIcon size={18} />
          </button>
          <button
            type="button"
            data-risu-chat-action="delete"
            aria-label={`${language.remove}: ${chat.name}`}
            class="text-textcolor2 hover:text-green-500 cursor-pointer"
            onclick={async () => {
              await deleteModalChat(chat)
            }}>
            <TrashIcon size={18} />
          </button>
        </div>
      </div>
    {/each}
    <div class="flex mt-2 items-center">
      <button
        data-risu-chat-action="create"
        aria-label={language.newChat}
        class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
        onclick={() => {
          const previous = currentChatStateSnapshot()
          const cha = getDatabase().characters[$selectedCharID]
          const len = getDatabase().characters[$selectedCharID].chats.length
          const chat = {
            message: [],
            note: '',
            name: `New Chat ${len + 1}`,
            localLore: [],
            fmIndex: -1,
            id: v4(),
          }
          if (!canUseServerCommands()) {
            let chats = getDatabase().characters[$selectedCharID].chats
            chats.unshift(chat)
            getDatabase().characters[$selectedCharID].chats = chats
            changeChatTo(0)
          } else {
            const applied = applyOptimisticCreatedChat(cha.chaId, chat, previous)
            if (applied && cha.chaId && chat.id) {
              navigate(characterRoutePath(cha.chaId, chat.id))
            }
          }
          dispatchCreateChat(cha.chaId, chat, previous)
          close()
        }}>
        <PlusIcon />
      </button>
      <button
        data-risu-chat-action="import"
        aria-label={language.import}
        class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
        onclick={() => {
          importChat()
        }}>
        <HardDriveUploadIcon size={18} />
      </button>
      <button
        data-risu-chat-action="edit"
        aria-label={language.edit}
        class="text-textcolor2 hover:text-green-500 cursor-pointer"
        onclick={() => {
          editMode = !editMode
        }}>
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
