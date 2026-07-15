<script>
  import { alertConfirm } from '../../ts/alert'
  import { language } from '../../lang'

  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { SquarePenIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    createGlobalLorebook,
    deleteGlobalLorebook,
    deleteGlobalLorebookById,
    renameGlobalLorebook,
    renameGlobalLorebookById,
    selectGlobalLorebook,
    watchServerBackedLorebooks,
  } from 'src/ts/server/lorebookBridge.svelte'
  let editMode = $state(false)
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()

  /** @param {unknown} value */
  function stableLorebookId(value) {
    return typeof value === 'string' && value.trim() ? value : null
  }

  /** @param {{id?: unknown}} lorebook */
  function lorebookRenderKey(lorebook) {
    const lorebookId = stableLorebookId(lorebook.id)
    if (!lorebookId) return lorebook
    const matches = getDatabase().loreBook.filter((candidate) => candidate.id === lorebookId)
    return matches.length === 1 ? lorebookId : lorebook
  }

  /** @param {KeyboardEvent} event */
  function handleDialogKeydown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  $effect(() => {
    // This modal only edits the global lorebook list, so scope change detection
    // to it instead of scanning every character/chat/module per keystroke.
    const stopLorebooks = watchServerBackedLorebooks({ scope: { kind: 'global' } })
    return () => stopLorebooks()
  })
</script>

<div data-modal-root class="fixed inset-0 z-40 bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-96 max-h-full overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-global-lorebook-dialog-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 id="risu-global-lorebook-dialog-title" class="mt-0 mb-0">{language.loreBook}</h2>
      <div class="grow flex justify-end">
        <button
          data-modal-initial-focus
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#each getDatabase().loreBook as lore, ind (lorebookRenderKey(lore))}
      <div
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={ind === getDatabase().loreBookPage}>
        {#if editMode}
          <TextInput
            bind:value={
              () => lore.name,
              (value) => {
                const lorebookId = stableLorebookId(lore.id)
                if (lorebookId) {
                  renameGlobalLorebookById(lorebookId, value)
                } else if (getDatabase().loreBook[ind] === lore) {
                  renameGlobalLorebook(ind, value)
                }
              }
            }
            placeholder="string"
            padding={false} />
        {:else}
          <button class="grow text-left" onclick={() => selectGlobalLorebook(ind)}>{lore.name}</button>
        {/if}
        <div class="grow flex justify-end">
          <button
            type="button"
            class="text-textcolor2 hover:text-green-500 cursor-pointer"
            aria-label={`${language.remove}: ${lore.name}`}
            onclick={async () => {
              if (getDatabase().loreBook.length === 1) {
                return
              }
              const lorebookId = stableLorebookId(lore.id)
              const lorebookReference = lore
              const d = await alertConfirm(`${language.removeConfirm}${lore.name}`)
              if (d) {
                if (lorebookId) {
                  deleteGlobalLorebookById(lorebookId)
                } else if (getDatabase().loreBook[ind] === lorebookReference) {
                  deleteGlobalLorebook(ind)
                }
              }
            }}>
            <TrashIcon size={18} />
          </button>
        </div>
      </div>
    {/each}
    <div class="flex mt-2 items-center">
      <button
        aria-label={language.add}
        class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
        onclick={() => {
          createGlobalLorebook()
        }}>
        <PlusIcon />
      </button>
      <button
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
