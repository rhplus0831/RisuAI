<script>
  import { alertConfirm } from '../../ts/alert'
  import { language } from '../../lang'

  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { SquarePenIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import {
    createGlobalLorebook,
    deleteGlobalLorebook,
    renameGlobalLorebook,
    selectGlobalLorebook,
    watchServerBackedLorebooks,
  } from 'src/ts/server/lorebookBridge.svelte'
  let editMode = $state(false)
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()

  $effect(() => {
    // This modal only edits the global lorebook list, so scope change detection
    // to it instead of scanning every character/chat/module per keystroke.
    const stopLorebooks = watchServerBackedLorebooks({ scope: { kind: 'global' } })
    return () => stopLorebooks()
  })
</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
  <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-96 max-h-full overflow-y-auto">
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="mt-0 mb-0">{language.loreBook}</h2>
      <div class="grow flex justify-end">
        <button
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#each getDatabase().loreBook as lore, ind}
      <div
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={ind === getDatabase().loreBookPage}>
        {#if editMode}
          <TextInput
            bind:value={() => getDatabase().loreBook[ind].name, (value) => renameGlobalLorebook(ind, value)}
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
              const d = await alertConfirm(`${language.removeConfirm}${lore.name}`)
              if (d) {
                deleteGlobalLorebook(ind)
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
