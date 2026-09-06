<script module lang="ts">
  export function resolveOwnedDraftHooks<T extends { id?: unknown; type?: unknown }>(
    status: string,
    hooks: readonly T[] | undefined,
  ): T[] {
    if (status !== 'ready' || !hooks) return []

    const draftHooks = hooks.filter(
      (hook): hook is T & { id: string; type: 'draft' } =>
        hook.type === 'draft' && typeof hook.id === 'string' && hook.id.trim().length > 0,
    )
    const idCounts = new Map<string, number>()
    for (const hook of draftHooks) idCounts.set(hook.id, (idCounts.get(hook.id) ?? 0) + 1)
    return draftHooks.filter((hook) => idCounts.get(hook.id) === 1)
  }

  export function resolveOwnedSelectedDraftHookId(
    metadata: Readonly<Record<string, unknown>> | undefined,
  ): string | undefined {
    const selectedId = metadata?.selectedDraftHookId
    return typeof selectedId === 'string' && selectedId.trim().length > 0 ? selectedId : undefined
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import {
    charactersResourceState,
    getChatMetadataOwnerSnapshot,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { setCurrentChatSelectedDraftHookId } from 'src/ts/chatCommands'
  import type { InputHook } from 'src/ts/storage/database.svelte'
  import InputHookPickerDialog from '../ChatScreens/InputHookPickerDialog.svelte'
  import Button from '../UI/GUI/Button.svelte'

  let pickerOpen = $state(false)
  let currentChatSelection = $derived.by(() => {
    if (charactersResourceState.status !== 'ready') return undefined
    const character = getSelectedCharacterOwner()
    const selectedCharacter = charactersResourceState.currentChar
    const selectedChat = character?.chatPage
    const characterId = character?.chaId
    if (
      typeof characterId !== 'string' ||
      characterId.trim().length === 0 ||
      !Number.isInteger(selectedCharacter) ||
      !Number.isInteger(selectedChat)
    ) {
      return undefined
    }
    const chatId = character.chats?.[selectedChat]?.id
    if (typeof chatId !== 'string' || chatId.trim().length === 0) return undefined
    const metadata = getChatMetadataOwnerSnapshot(characterId, chatId)
    if (!metadata) return undefined
    return {
      characterId,
      chatId,
      selectedCharacter,
      selectedChat,
    }
  })
  let draftHooks = $derived(
    resolveOwnedDraftHooks(
      settingsResourceState.groupStatuses.advanced ?? 'idle',
      settingsResourceState.value.inputHooks,
    ),
  )
  let selectedId = $derived.by(() => {
    const selection = currentChatSelection
    if (!selection) return undefined
    const character = charactersResourceState.characters[selection.selectedCharacter]
    const chat = character?.chats?.[selection.selectedChat]
    if (character?.chaId !== selection.characterId || chat?.id !== selection.chatId) return undefined
    // Track this optional field directly so adding or deleting it invalidates
    // the owner snapshot even though it was absent from the previous projection.
    void chat.selectedDraftHookId
    return resolveOwnedSelectedDraftHookId(
      getChatMetadataOwnerSnapshot(selection.characterId, selection.chatId)?.metadata,
    )
  })
  let selectedHook = $derived.by(() => draftHooks.find((hook) => hook.id === selectedId))

  function selectDraftHook(hook: InputHook | null): void {
    const selection = currentChatSelection
    if (!selection || (hook && !draftHooks.some((candidate) => candidate.id === hook.id))) return
    if (
      setCurrentChatSelectedDraftHookId(hook?.id ?? null, {
        selectedChar: selection.selectedCharacter,
        selectedChat: selection.selectedChat,
      })
    ) {
      pickerOpen = false
    }
  }
</script>

{#if draftHooks.length > 0 || selectedId}
  <div class="mt-2 w-full" data-risu-draft-hook-selector data-risu-selected-id={selectedId ?? ''}>
    <div class="mb-1 text-xs font-medium text-textcolor2">{language.inputHookSelectDraft}</div>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      disabled={!currentChatSelection}
      onclick={() => (pickerOpen = true)}>
      <span class="truncate" data-risu-draft-hook-label>{selectedHook?.name ?? language.inputHookNone}</span>
    </Button>
  </div>
{/if}

{#if pickerOpen}
  <InputHookPickerDialog
    kind="draft"
    hooks={draftHooks}
    {selectedId}
    close={() => (pickerOpen = false)}
    select={selectDraftHook} />
{/if}
