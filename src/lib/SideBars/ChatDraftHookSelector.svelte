<script lang="ts">
  import { language } from 'src/lang'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import { charactersResourceState } from 'src/ts/server/resourceState.svelte'
  import { setCurrentChatSelectedDraftHookId } from 'src/ts/chatCommands'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import { getDatabase, type InputHook } from 'src/ts/storage/database.svelte'
  import InputHookPickerDialog from '../ChatScreens/InputHookPickerDialog.svelte'
  import Button from '../UI/GUI/Button.svelte'

  let pickerOpen = $state(false)
  let currentChat = $derived.by(() => {
    const owner = getSelectedCharacterOwner()
    if (charactersResourceState.status === 'ready') return owner?.chats?.[owner.chatPage]
    if (owner) return owner.chats?.[owner.chatPage]
    const character = getDatabase().characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage]
  })
  let draftHooks = $derived((getDatabase().inputHooks ?? []).filter((hook) => hook.type === 'draft'))
  let selectedId = $derived(currentChat?.selectedDraftHookId)
  let selectedHook = $derived.by(() => draftHooks.find((hook) => hook.id === selectedId))

  function selectDraftHook(hook: InputHook | null): void {
    if (setCurrentChatSelectedDraftHookId(hook?.id ?? null)) {
      pickerOpen = false
    }
  }
</script>

{#if draftHooks.length > 0 || selectedId}
  <div class="mt-2 w-full" data-risu-draft-hook-selector data-risu-selected-id={selectedId ?? ''}>
    <div class="mb-1 text-xs font-medium text-textcolor2">{language.inputHookSelectDraft}</div>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      disabled={!currentChat}
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
