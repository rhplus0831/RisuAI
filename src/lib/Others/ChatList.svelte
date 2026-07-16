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
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  let editMode = $state(false)
  let chatNameDrafts = $state({})
  let chatNameBaselines = $state({})
  let chatNameDraftOwner = $state(undefined)
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()
  const ownerSelectedCharIndex = $selectedCharID
  const ownerCharacterReference = getDatabase().characters?.[ownerSelectedCharIndex]
  const ownerCharacterId = ownerCharacterReference?.chaId
  let invalidated = $state(false)

  function resolveOriginCharacter(originCharacterId, originSelectedCharIndex, originCharacterReference) {
    if (originCharacterId) {
      return getDatabase().characters?.find((candidate) => candidate.chaId === originCharacterId)
    }

    const byIndex = getDatabase().characters?.[originSelectedCharIndex]
    if (originCharacterReference && byIndex !== originCharacterReference) return undefined
    return byIndex
  }

  function isOriginCharacterSelected(originCharacter, originCharacterId) {
    const selectedCharacter = getDatabase().characters?.[$selectedCharID]
    return (
      selectedCharacter === originCharacter || (originCharacterId && selectedCharacter?.chaId === originCharacterId)
    )
  }

  let modalCharacter = $derived.by(() => {
    if (invalidated) return undefined
    const character = resolveOriginCharacter(ownerCharacterId, ownerSelectedCharIndex, ownerCharacterReference)
    if (!character || !isOriginCharacterSelected(character, ownerCharacterId)) return undefined
    return character
  })

  function invalidateModal() {
    if (invalidated) return
    invalidated = true
    close()
  }

  function resolveActiveOwnerCharacter() {
    const character = modalCharacter
    if (!character) {
      invalidateModal()
      return undefined
    }
    return character
  }

  $effect(() => {
    const stop = untrack(() => watchServerBackedChatMetadata())
    return stop
  })

  $effect(() => {
    if (!modalCharacter) {
      untrack(() => invalidateModal())
    }
  })

  $effect(() => {
    const previousDrafts = untrack(() => chatNameDrafts)
    const previousBaselines = untrack(() => chatNameBaselines)
    const previousOwner = untrack(() => chatNameDraftOwner)
    const character = modalCharacter
    const owner = character?.chaId ?? `index:${ownerSelectedCharIndex}`
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
    const character = resolveActiveOwnerCharacter()
    const liveTargetChat = character?.chats?.find((candidate) => candidate.id === chat?.id)
    if (!character || !liveTargetChat?.id || liveTargetChat.name === name) return
    if (!canUseServerCommands()) {
      liveTargetChat.name = name
      return
    }

    const previous = currentChatStateSnapshot()
    const previousCharacter = ownerCharacterId
      ? previous.characters.find((candidate) => candidate.chaId === ownerCharacterId)
      : previous.characters[ownerSelectedCharIndex]
    const previousChat = previousCharacter?.chats?.find((candidate) => candidate.id === liveTargetChat.id)
    let applied = false
    withTrustedResourceWrite(() => {
      const liveCharacter = previousCharacter?.chaId
        ? getDatabase().characters?.find((candidate) => candidate.chaId === previousCharacter.chaId)
        : resolveOriginCharacter(undefined, ownerSelectedCharIndex, ownerCharacterReference)
      const liveChat = liveCharacter?.chats?.find((candidate) => candidate.id === liveTargetChat.id)
      if (!liveChat || liveChat.name !== previousChat?.name) return
      liveChat.name = name
      applied = true
    })
    if (!applied) return
    syncServerBackedChatMetadataBaselines()
    dispatchUpdateChat(liveTargetChat.id, { name }, previous, false, rollbackServerBackedChatRowMetadata)
  }

  function openChatRoute(index) {
    const character = resolveActiveOwnerCharacter()
    const chatId = character?.chats?.[index]?.id
    if (!character || !chatId) return
    if (character?.chaId && chatId) {
      navigate(characterRoutePath(character.chaId, chatId))
      close()
      return
    }

    changeChatTo(index)
    close()
  }

  async function deleteModalChat(chat) {
    const originSelectedCharIndex = ownerSelectedCharIndex
    const originCharacter = resolveActiveOwnerCharacter()
    const originCharacterId = ownerCharacterId
    const targetChatId = chat?.id
    const targetChatName = chat?.name ?? ''

    if (!originCharacter || !originCharacter.chats?.some((candidate) => candidate.id === targetChatId)) return

    if (originCharacter?.chats?.length === 1) {
      alertError(language.errors.onlyOneChat)
      return
    }

    const confirmed = await alertConfirm(`${language.removeConfirm}${targetChatName}`)
    if (!confirmed || !targetChatId) return

    const resolvedOriginCharacter = resolveOriginCharacter(
      originCharacterId,
      originSelectedCharIndex,
      ownerCharacterReference,
    )
    const liveChatIndex = resolvedOriginCharacter?.chats?.findIndex((candidate) => candidate.id === targetChatId) ?? -1
    if (!resolvedOriginCharacter || liveChatIndex < 0 || resolvedOriginCharacter.chats.length <= 1) return

    const previous = currentChatStateSnapshot()
    const previousOwnerIndex = originCharacterId
      ? previous.characters.findIndex((candidate) => candidate.chaId === originCharacterId)
      : originSelectedCharIndex
    if (previousOwnerIndex < 0) return
    previous.selectedCharID = previousOwnerIndex
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

  function createModalChat() {
    const character = resolveActiveOwnerCharacter()
    if (!character) return

    const previous = currentChatStateSnapshot()
    const chat = {
      message: [],
      note: '',
      name: `New Chat ${character.chats.length + 1}`,
      localLore: [],
      fmIndex: -1,
      id: v4(),
    }
    if (!canUseServerCommands()) {
      character.chats.unshift(chat)
      changeChatTo(0)
    } else {
      const applied = applyOptimisticCreatedChat(character.chaId, chat, previous)
      if (applied && character.chaId && chat.id) {
        navigate(characterRoutePath(character.chaId, chat.id))
      }
    }
    dispatchCreateChat(character.chaId, chat, previous)
    close()
  }

  function exportModalChat(chat) {
    const characterId = resolveActiveOwnerCharacter()?.chaId
    const chatId = chat?.id
    if (!characterId || !chatId) return
    exportChat({ characterId, chatId })
  }

  function importModalChat() {
    if (!resolveActiveOwnerCharacter()) return
    importChat()
  }

  /** @param {KeyboardEvent} event */
  function handleDialogKeydown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  /** @param {MouseEvent} event */
  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) close()
  }
</script>

{#if modalCharacter}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-modal-root
    data-risu-chat-list="modal"
    class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center"
    onclick={handleBackdropClick}>
    <div
      use:modalFocusTrap
      class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-72 max-h-full overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-chat-list-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}>
      <div class="flex items-center text-textcolor mb-4">
        <h2 id="risu-chat-list-title" class="mt-0 mb-0">{language.chatList}</h2>
        <div class="grow flex justify-end">
          <button
            data-modal-initial-focus
            data-risu-chat-action="close"
            aria-label={language.close}
            class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
            onclick={close}>
            <XIcon size={24} />
          </button>
        </div>
      </div>
      {#each modalCharacter.chats as chat, i}
        <div
          data-risu-chat-id={chat.id ?? ''}
          data-risu-chat-idx={i}
          data-risu-chat-selected={i === modalCharacter.chatPage ? 'true' : 'false'}
          class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
          class:bg-selected={i === modalCharacter.chatPage}>
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
                exportModalChat(chat)
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
          onclick={createModalChat}>
          <PlusIcon />
        </button>
        <button
          data-risu-chat-action="import"
          aria-label={language.import}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
          onclick={importModalChat}>
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
{/if}

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
</style>
