<script>
  import { alertConfirm, alertError, alertNormal } from '../../ts/alert'
  import { language } from '../../lang'

  import { collectionsResourceState } from 'src/ts/server/resourceState.svelte'
  import { SquarePenIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    createGlobalLorebook,
    deleteGlobalLorebookByIdWithOutcome,
    renameGlobalLorebookById,
    subscribeGlobalLorebookDeleteStates,
  } from 'src/ts/server/lorebookBridge.svelte'
  import {
    lorebookPageIndexFromSnapshot,
    lorebookPageOwner,
    lorebookPageOwnerState,
  } from 'src/ts/server/lorebookPageOwner.svelte'
  let editMode = $state(false)
  /** @type {Map<string, import('src/ts/server/lorebookBridge.svelte').GlobalLorebookDeleteState>} */
  let globalLorebookDeleteStates = $state(new Map())
  /** @type {{close?: any}} */
  let { close = () => {} } = $props()

  function globalLorebookOwners() {
    if (collectionsResourceState.statuses.loreBook !== 'ready') return []
    const lorebooks = collectionsResourceState.values.loreBook
    return Array.isArray(lorebooks) ? lorebooks : []
  }

  let globalLorebooks = $derived(globalLorebookOwners())

  /** @param {unknown} value */
  function stableLorebookId(value) {
    return typeof value === 'string' && value.trim() ? value : null
  }

  /** @param {{id?: unknown}} lorebook */
  function lorebookRenderKey(lorebook) {
    return selectableLorebookId(lorebook) ?? lorebook
  }

  function selectedLorebookPage() {
    return lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0
  }

  /** @param {{id?: unknown}} lorebook */
  function selectableLorebookId(lorebook) {
    const lorebookId = stableLorebookId(lorebook.id)
    if (!lorebookId) return null
    return globalLorebookOwners().filter((candidate) => candidate.id === lorebookId).length === 1 ? lorebookId : null
  }

  /** @param {{id?: unknown}} lorebook @param {number} index */
  async function selectLorebook(lorebook, index) {
    const lorebookId = selectableLorebookId(lorebook)
    if (!lorebookId) {
      alertError(language.globalLorebookSelection.invalid)
      return
    }

    const result = await lorebookPageOwner.select({ lorebookId, index })
    if (result.status === 'failed') {
      alertError(language.globalLorebookSelection.failed(result.error))
      return
    }
    if (result.status !== 'queued') return

    alertNormal(language.globalLorebookSelection.queued)
    const settlement = await result.settlement
    if (settlement === 'failed') {
      alertError(language.globalLorebookSelection.failed(''))
      return
    }
    const reload = await lorebookPageOwner.retry()
    if (reload.status !== 'ok') {
      alertError(language.globalLorebookSelection.reloadFailed)
    }
  }

  function selectionStatus(lorebookId) {
    const mutation = $lorebookPageOwnerState.mutation
    return mutation.status !== 'idle' && mutation.lorebookId === lorebookId ? mutation.status : undefined
  }

  /** @param {import('src/ts/server/lorebookBridge.svelte').GlobalLorebookDeleteState | undefined} state */
  function isDeletePending(state) {
    return state?.status === 'deleting' || state?.status === 'queued'
  }

  /** @param {import('src/ts/server/lorebookBridge.svelte').GlobalLorebookDeleteState} state */
  function deleteStatusText(state) {
    if (state.status === 'deleting') return language.globalLorebookDelete.deleting
    if (state.status === 'queued') return language.globalLorebookDelete.queued
    return language.globalLorebookDelete.failed
  }

  /** @param {KeyboardEvent} event */
  function handleDialogKeydown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  $effect(() => {
    return subscribeGlobalLorebookDeleteStates((states) => {
      globalLorebookDeleteStates = new Map(states.map((state) => [state.lorebookId, state]))
    })
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
    {#each globalLorebooks as lore, ind (lorebookRenderKey(lore))}
      {@const lorebookId = selectableLorebookId(lore)}
      {@const deleteState = lorebookId ? globalLorebookDeleteStates.get(lorebookId) : undefined}
      {@const deletePending = isDeletePending(deleteState)}
      {@const pageSelectionStatus = lorebookId ? selectionStatus(lorebookId) : undefined}
      {@const pageSelectionPending = pageSelectionStatus === 'pending' || pageSelectionStatus === 'queued'}
      <div
        class="flex flex-col items-stretch text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2"
        class:bg-selected={ind === selectedLorebookPage()}
        class:opacity-70={deletePending || pageSelectionPending}
        aria-busy={deletePending || pageSelectionPending}
        data-risu-global-lorebook-delete-status={deleteState?.status}
        data-risu-global-lorebook-selection-status={pageSelectionStatus}>
        <div class="flex items-center gap-2">
          {#if editMode && lorebookId && !deletePending}
            <TextInput
              bind:value={
                () => lore.name,
                (value) => {
                  if (lorebookId) {
                    renameGlobalLorebookById(lorebookId, value)
                  }
                }
              }
              placeholder="string"
              padding={false} />
          {:else}
            <button
              class="grow text-left disabled:cursor-not-allowed"
              disabled={deletePending || pageSelectionPending}
              onclick={() => selectLorebook(lore, ind)}>{lore.name}</button>
          {/if}
          <div class="grow flex justify-end">
            <button
              type="button"
              class="text-textcolor2 hover:text-green-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`${language.remove}: ${lore.name}`}
              disabled={deletePending || !lorebookId || globalLorebooks.length === 1}
              onclick={async () => {
                if (deletePending || !lorebookId || globalLorebooks.length === 1) {
                  return
                }
                const targetLorebookId = lorebookId
                const d = await alertConfirm(`${language.removeConfirm}${lore.name}`)
                if (!d) return
                await deleteGlobalLorebookByIdWithOutcome(targetLorebookId)
              }}>
              <TrashIcon size={18} />
            </button>
          </div>
        </div>
        {#if deleteState?.status === 'failed'}
          <p
            class="m-0 mt-1 text-xs"
            class:text-red-400={deleteState.status === 'failed'}
            class:text-textcolor2={deleteState.status !== 'failed'}
            role={deleteState.status === 'failed' ? 'alert' : 'status'}
            aria-live={deleteState.status === 'failed' ? 'assertive' : 'polite'}>
            {deleteStatusText(deleteState)}
          </p>
        {/if}
        {#if pageSelectionStatus}
          <p
            class="m-0 mt-1 text-xs"
            class:text-red-400={pageSelectionStatus === 'failed'}
            class:text-textcolor2={pageSelectionStatus !== 'failed'}
            role={pageSelectionStatus === 'failed' ? 'alert' : 'status'}
            aria-live={pageSelectionStatus === 'failed' ? 'assertive' : 'polite'}>
            {pageSelectionStatus === 'pending'
              ? language.globalLorebookSelection.selecting
              : pageSelectionStatus === 'queued'
                ? language.globalLorebookSelection.queued
                : language.globalLorebookSelection.failed($lorebookPageOwnerState.mutation.error)}
          </p>
        {/if}
      </div>
    {/each}
    <div class="flex mt-2 items-center">
      <button
        aria-label={language.add}
        disabled={collectionsResourceState.statuses.loreBook !== 'ready'}
        class="text-textcolor2 hover:text-green-500 cursor-pointer mr-1"
        onclick={() => {
          createGlobalLorebook()
        }}>
        <PlusIcon />
      </button>
      <button
        aria-label={language.edit}
        disabled={collectionsResourceState.statuses.loreBook !== 'ready'}
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
