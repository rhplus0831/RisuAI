<script>
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { alertConfirm, alertError, alertNormal } from '../../ts/alert'
  import { language } from '../../lang'

  import { charactersResourceState, getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { isServerCharacterShell } from 'src/ts/storage/database.svelte'
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
    dispatchCreateChatWithOutcome,
    dispatchDeleteChatWithOutcome,
    dispatchUpdateChatWithOutcome,
  } from 'src/ts/chatCommands'
  import { reportWriterAccessLostMutation } from 'src/ts/server/activeWriterSession'
  import { canUseServerCommands } from 'src/ts/server/commands'
  import {
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
    watchServerBackedChatMetadata,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { characterRoutePath, currentRoute, navigate } from 'src/ts/router'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  let editMode = $state(false)
  let chatNameDrafts = $state({})
  let chatNameBaselines = $state({})
  let chatNameDraftOwner = $state(undefined)
  /** @type {Record<string, {targetId: string, action: string, conflictKeys: string[], run: number, status: 'pending' | 'queued' | 'failed'}>} */
  let chatMutations = $state({})
  let nextMutationRun = 0
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

  // The owner detail is authoritative when hydrated; shell rows intentionally
  // fall back to the compatibility character for the existing lazy path.
  let renderedCharacter = $derived.by(() => {
    const owner = ownerCharacterId
      ? charactersResourceState.characters.find((candidate) => candidate?.chaId === ownerCharacterId)
      : undefined
    return owner && !isServerCharacterShell(owner) ? owner : modalCharacter
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

  function mutationKey(operation, targetId) {
    return `${operation}:${targetId}`
  }

  function mutationForChat(chatId) {
    const matches = Object.values(chatMutations).filter((mutation) => mutation.targetId === chatId)
    return (
      matches.find((mutation) => mutation.status === 'pending') ??
      matches.find((mutation) => mutation.status === 'queued') ??
      matches.find((mutation) => mutation.status === 'failed')
    )
  }

  function chatConflictKey(chatId) {
    return `chat:${chatId}`
  }

  function chatOrderConflictKey() {
    return `chat-order:${ownerCharacterId ?? `index:${ownerSelectedCharIndex}`}`
  }

  function hasConflictingMutation(conflictKeys, ignoredMutationKey) {
    return Object.entries(chatMutations).some(
      ([key, mutation]) =>
        (!ignoredMutationKey || (key !== ignoredMutationKey && !key.startsWith(`${ignoredMutationKey}:`))) &&
        mutation.status === 'pending' &&
        mutation.conflictKeys.some((conflictKey) => conflictKeys.includes(conflictKey)),
    )
  }

  function mutationKeyBelongsToGroup(key, groupKey) {
    return key === groupKey || key.startsWith(`${groupKey}:`)
  }

  function clearFailedMutations(groupKey) {
    for (const [key, mutation] of Object.entries(chatMutations)) {
      if (mutationKeyBelongsToGroup(key, groupKey) && mutation.status === 'failed') delete chatMutations[key]
    }
  }

  function clearAcceptedMutation(key, run, groupKey) {
    if (!groupKey) {
      clearMutation(key, run)
      return
    }
    for (const [candidateKey, mutation] of Object.entries(chatMutations)) {
      if (mutationKeyBelongsToGroup(candidateKey, groupKey) && mutation.run <= run) delete chatMutations[candidateKey]
    }
  }

  function isChatMutationPending(chatId) {
    return Boolean(chatId && hasConflictingMutation([chatConflictKey(chatId)]))
  }

  function isChatStructuralMutationPending(chatId) {
    return Boolean(chatId && hasConflictingMutation([chatOrderConflictKey(), chatConflictKey(chatId)]))
  }

  function isOrderMutationPending() {
    return hasConflictingMutation([chatOrderConflictKey()])
  }

  function setMutation(key, targetId, action, conflictKeys, run, status) {
    chatMutations[key] = { targetId, action, conflictKeys, run, status }
  }

  function isCurrentMutation(key, run) {
    return chatMutations[key]?.run === run
  }

  function clearMutation(key, run) {
    if (isCurrentMutation(key, run)) delete chatMutations[key]
  }

  function recoverRejectedProvisionalChatRoute(characterId, provisionalChatId) {
    const route = get(currentRoute)
    if (route.kind !== 'character' || route.chaId !== characterId || route.chatId !== provisionalChatId) return
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (!character || character.chats?.some((chat) => chat.id === provisionalChatId)) return
    const replacementChatId = character.chats?.[character.chatPage]?.id
    navigate(characterRoutePath(characterId, replacementChatId), { replace: true })
  }

  function settleQueuedMutation(key, run, targetId, action, conflictKeys, settlement, onFinal, mutationGroupKey) {
    void settlement.then(
      (finalOutcome) => {
        if (!isCurrentMutation(key, run)) return
        if (finalOutcome.status === 'accepted') {
          clearAcceptedMutation(key, run, mutationGroupKey)
          onFinal?.(finalOutcome)
          return
        }
        setMutation(key, targetId, action, conflictKeys, run, 'failed')
        alertError(language.chatStructureFailed(action))
        onFinal?.(finalOutcome)
      },
      () => {
        if (!isCurrentMutation(key, run)) return
        setMutation(key, targetId, action, conflictKeys, run, 'failed')
        alertError(language.chatStructureFailed(action))
        onFinal?.({ status: 'failed', result: { status: 'unavailable' } })
      },
    )
  }

  function mutationMessage(mutation) {
    if (mutation.status === 'pending') return language.chatStructurePending(mutation.action)
    if (mutation.status === 'queued') return language.chatStructureQueued(mutation.action)
    return language.chatStructureFailed(mutation.action)
  }

  async function settleMutation(
    key,
    targetId,
    action,
    conflictKeys,
    dispatch,
    queuedMessage,
    onFinal,
    mutationGroupKey,
  ) {
    const run = ++nextMutationRun
    setMutation(key, targetId, action, conflictKeys, run, 'pending')
    try {
      const outcome = await dispatch()
      if (!isCurrentMutation(key, run)) return 'failed'
      if (!outcome || outcome.status === 'failed') {
        setMutation(key, targetId, action, conflictKeys, run, 'failed')
        alertError(language.chatStructureFailed(action))
        return 'failed'
      }
      if (outcome.status === 'queued') {
        setMutation(key, targetId, action, conflictKeys, run, 'queued')
        alertNormal(queuedMessage ?? language.chatStructureQueued(action))
        settleQueuedMutation(key, run, targetId, action, conflictKeys, outcome.settlement, onFinal, mutationGroupKey)
        return 'queued'
      }
      clearAcceptedMutation(key, run, mutationGroupKey)
      return 'accepted'
    } catch {
      if (isCurrentMutation(key, run)) {
        setMutation(key, targetId, action, conflictKeys, run, 'failed')
        alertError(language.chatStructureFailed(action))
      }
      return 'failed'
    }
  }

  function currentRouteIdentity() {
    const route = get(currentRoute)
    return `${route.kind}:${route.path}`
  }

  function isExpectedOwnerChatSelected(originCharacterId, originSelectedCharIndex, originCharacterReference, chatId) {
    const character = resolveOriginCharacter(originCharacterId, originSelectedCharIndex, originCharacterReference)
    return Boolean(
      character &&
      isOriginCharacterSelected(character, originCharacterId) &&
      character.chats?.[character.chatPage]?.id === chatId,
    )
  }

  async function updateChatName(chat, name) {
    const character = resolveActiveOwnerCharacter()
    const liveTargetChat = character?.chats?.find((candidate) => candidate.id === chat?.id)
    if (!character || !liveTargetChat?.id || liveTargetChat.name === name) return
    const key = mutationKey('rename', liveTargetChat.id)
    if (hasConflictingMutation([chatConflictKey(liveTargetChat.id)], key)) return
    if (reportWriterAccessLostMutation()) return
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
    clearFailedMutations(key)
    const action = `${language.edit}: ${name}`
    await settleMutation(
      `${key}:${v4()}`,
      liveTargetChat.id,
      action,
      [chatConflictKey(liveTargetChat.id)],
      () =>
        dispatchUpdateChatWithOutcome(
          liveTargetChat.id,
          { name },
          previous,
          false,
          rollbackServerBackedChatRowMetadata,
        ),
      undefined,
      undefined,
      key,
    )
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
    if (!confirmed || !targetChatId || isChatStructuralMutationPending(targetChatId)) return

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
    const originRoute = currentRouteIdentity()

    if (canUseServerCommands()) {
      const result = applyOptimisticDeletedChat(originCharacterId, targetChatId, previous)
      if (!result.applied) return
      const action = `${language.remove}: ${targetChatName}`
      const outcome = await settleMutation(
        mutationKey('delete', targetChatId),
        targetChatId,
        action,
        [chatOrderConflictKey(), chatConflictKey(targetChatId)],
        () => dispatchDeleteChatWithOutcome(targetChatId, previous),
      )
      if (
        outcome !== 'failed' &&
        originStillSelected &&
        currentRouteIdentity() === originRoute &&
        isExpectedOwnerChatSelected(
          originCharacterId,
          originSelectedCharIndex,
          ownerCharacterReference,
          result.selectedChatId,
        ) &&
        resolvedOriginCharacter.chaId &&
        result.selectedChatId
      ) {
        navigate(characterRoutePath(resolvedOriginCharacter.chaId, result.selectedChatId), {
          replace: true,
        })
      }
      return
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
  }

  async function createModalChat() {
    const character = resolveActiveOwnerCharacter()
    if (!character || isOrderMutationPending()) return

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
      close()
      return
    }

    const applied = applyOptimisticCreatedChat(character.chaId, chat, previous)
    if (!applied || !character.chaId || !chat.id) return
    const originRoute = currentRouteIdentity()
    const outcome = await settleMutation(
      mutationKey('create', chat.id),
      chat.id,
      `${language.newChat}: ${chat.name}`,
      [chatOrderConflictKey(), chatConflictKey(chat.id)],
      () => dispatchCreateChatWithOutcome(character.chaId, chat, previous),
      language.chatCreateProvisional(chat.name),
      (finalOutcome) => {
        if (finalOutcome.status === 'failed') recoverRejectedProvisionalChatRoute(character.chaId, chat.id)
      },
    )
    if (outcome === 'failed') return
    if (
      currentRouteIdentity() !== originRoute ||
      !isExpectedOwnerChatSelected(character.chaId, ownerSelectedCharIndex, ownerCharacterReference, chat.id)
    )
      return
    navigate(characterRoutePath(character.chaId, chat.id))
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
</script>

{#if modalCharacter}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:modalBackdropDismiss={close}
    data-modal-root
    data-risu-chat-list="modal"
    class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
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
      <div aria-live="polite">
        {#each Object.entries(chatMutations).filter(([, mutation]) => mutation.status === 'failed') as [key, mutation] (key)}
          <div
            data-risu-chat-mutation={key}
            data-risu-chat-mutation-status={mutation.status}
            role={mutation.status === 'failed' ? 'alert' : 'status'}
            class="mb-2 rounded-md border border-darkborderc px-2 py-1 text-sm text-textcolor2">
            {mutationMessage(mutation)}
          </div>
        {/each}
      </div>
      {#each renderedCharacter?.chats ?? [] as chat, i}
        <div
          data-risu-chat-id={chat.id ?? ''}
          data-risu-chat-idx={i}
          data-risu-chat-selected={i === renderedCharacter?.chatPage ? 'true' : 'false'}
          data-risu-chat-mutation-status={mutationForChat(chat.id)?.status ?? ''}
          aria-busy={isChatMutationPending(chat.id)}
          class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
          class:bg-selected={i === renderedCharacter?.chatPage}>
          {#if editMode}
            <TextInput
              bind:value={chatNameDrafts[chat.id]}
              padding={false}
              onchange={() => {
                void updateChatName(chat, chatNameDrafts[chat.id])
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
              disabled={isChatStructuralMutationPending(chat.id)}
              class="text-textcolor2 hover:text-green-500 cursor-pointer"
              class:opacity-50={isChatStructuralMutationPending(chat.id)}
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
          aria-busy={isOrderMutationPending()}
          disabled={isOrderMutationPending()}
          class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
          class:opacity-50={isOrderMutationPending()}
          onclick={() => void createModalChat()}>
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
