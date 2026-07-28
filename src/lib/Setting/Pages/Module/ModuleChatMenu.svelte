<script lang="ts">
  import { CircleCheckIcon, Waypoints, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    toggleSelectedCharacterModule,
    toggleSelectedChatModule,
    type ScopedModuleMutationOutcome,
  } from 'src/ts/moduleCommands'
  import type { RisuModule } from 'src/ts/process/modules'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import { selectedCharID, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    close?: any
    alertMode?: boolean
  }

  let { close = (i: string) => {}, alertMode = false }: Props = $props()
  let moduleSearch = $state('')
  let nextScopedModuleMutationSequence = 0
  let scopedModuleMutationStates = $state<
    Record<string, { sequence: number; status: 'saving' | 'queued' | 'failed'; error?: string }>
  >({})

  function sortModules(modules: RisuModule[], search: string) {
    return modules
      .filter((v) => {
        if (search === '') return true
        return v.name.toLowerCase().includes(search.toLowerCase())
      })
      .sort((a, b) => {
        let score = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        return score
      })
  }

  function closeMenu(): void {
    close('')
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
  }

  function moduleMutationError(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    if (result.status === 'conflict') return language.moduleSave.commandConflict
    if (result.status === 'unavailable') return language.moduleSave.commandUnavailable
    return language.moduleSave.commandError(result.error)
  }

  function thrownMutationError(error: unknown): string {
    return language.moduleSave.commandError(error instanceof Error ? error.message : String(error))
  }

  function isScopedModuleMutationPending(moduleId: string): boolean {
    const status = scopedModuleMutationStates[moduleId]?.status
    return status === 'saving' || status === 'queued'
  }

  function clearScopedModuleMutation(moduleId: string, sequence: number): void {
    if (scopedModuleMutationStates[moduleId]?.sequence === sequence) delete scopedModuleMutationStates[moduleId]
  }

  function failScopedModuleMutation(moduleId: string, sequence: number, error: string): void {
    if (scopedModuleMutationStates[moduleId]?.sequence !== sequence) return
    scopedModuleMutationStates[moduleId] = { sequence, status: 'failed', error }
    alertError(error)
  }

  async function trackScopedModuleMutation(
    moduleId: string,
    dispatch: () => Promise<ScopedModuleMutationOutcome>,
  ): Promise<void> {
    if (isScopedModuleMutationPending(moduleId)) return
    const sequence = ++nextScopedModuleMutationSequence
    scopedModuleMutationStates[moduleId] = { sequence, status: 'saving' }

    try {
      const outcome = await dispatch()
      if (scopedModuleMutationStates[moduleId]?.sequence !== sequence) return
      if (outcome.status === 'accepted') {
        clearScopedModuleMutation(moduleId, sequence)
        return
      }
      if (outcome.status === 'failed') {
        failScopedModuleMutation(moduleId, sequence, moduleMutationError(outcome.result))
        return
      }

      scopedModuleMutationStates[moduleId] = { sequence, status: 'queued' }
      alertNormal(language.moduleSave.queued)
      void outcome.settlement.then(
        (settlement) => {
          if (settlement.status === 'accepted') {
            clearScopedModuleMutation(moduleId, sequence)
          } else {
            failScopedModuleMutation(moduleId, sequence, moduleMutationError(settlement.result))
          }
        },
        (error) => failScopedModuleMutation(moduleId, sequence, thrownMutationError(error)),
      )
    } catch (error) {
      failScopedModuleMutation(moduleId, sequence, thrownMutationError(error))
    }
  }

  function scopedModuleMutationStatus(moduleId: string): string {
    const state = scopedModuleMutationStates[moduleId]
    if (state?.status === 'saving') return language.moduleSave.saving
    if (state?.status === 'queued') return language.moduleSave.queued
    if (state?.status === 'failed') return state.error ?? language.moduleSave.commandUnavailable
    return ''
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={closeMenu}
  data-modal-root
  class="fixed inset-0 z-[100] bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-full max-h-full overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-module-chat-menu-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor">
      <h2 id="risu-module-chat-menu-title" class="mt-0 mb-0 text-lg">{language.modules}</h2>
      <div class="grow flex justify-end">
        <button
          data-modal-initial-focus
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={closeMenu}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    <span class="text-sm text-textcolor2">{language.chatModulesInfo}</span>

    <TextInput className="mt-4" placeholder={language.search} ariaLabel={language.search} bind:value={moduleSearch} />

    <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md">
      {#if getResourceDatabase().modules.length === 0}
        <div class="text-textcolor2 p-3">{language.noModules}</div>
      {:else}
        {#each sortModules(getResourceDatabase().modules, moduleSearch) as rmodule, i}
          {#if i !== 0}
            <div class="border-t-1 border-selected"></div>
          {/if}
          <div class="pl-3 py-3 text-left">
            <div class="flex items-center">
              {#if rmodule.mcp}
                <Waypoints size={18} class="mr-2" />
              {/if}
              {#if !alertMode && getResourceDatabase().enabledModules.includes(rmodule.id)}
                <span class="text-textcolor2">{rmodule.name}</span>
              {:else}
                <span class="">{rmodule.name}</span>
              {/if}
              <div class="grow flex justify-end">
                {#if alertMode}
                  <button
                    class={'text-textcolor2 mr-2 cursor-pointer hover:text-blue-500 transition-colors'}
                    aria-label={`${language.select}: ${rmodule.name}`}
                    onclick={async (e) => {
                      e.stopPropagation()

                      close(rmodule.id)
                    }}>
                    <CircleCheckIcon size={18} />
                  </button>
                {:else if getResourceDatabase().enabledModules.includes(rmodule.id)}
                  <span class="mr-2" aria-hidden="true"></span>
                {:else if rmodule.mcp}
                  <span class="mr-2" aria-hidden="true"></span>
                {:else}
                  <button
                    aria-label={`${language.module}: ${rmodule.name}`}
                    aria-pressed={getResourceDatabase().characters[$selectedCharID].chats[
                      getResourceDatabase().characters[$selectedCharID].chatPage
                    ].modules?.includes(rmodule.id) ||
                      getResourceDatabase().characters[$selectedCharID]?.modules?.includes(rmodule.id)}
                    aria-busy={isScopedModuleMutationPending(rmodule.id)}
                    disabled={isScopedModuleMutationPending(rmodule.id)}
                    class={getResourceDatabase().characters[$selectedCharID].chats[
                      getResourceDatabase().characters[$selectedCharID].chatPage
                    ].modules?.includes(rmodule.id)
                      ? 'mr-2 cursor-pointer text-blue-500 disabled:cursor-wait disabled:opacity-60'
                      : getResourceDatabase().characters[$selectedCharID]?.modules?.includes(rmodule.id)
                        ? 'mr-2 cursor-pointer text-violet-500 disabled:cursor-wait disabled:opacity-60'
                        : 'text-textcolor2 hover:text-blue-400 mr-2 cursor-pointer disabled:cursor-wait disabled:opacity-60'}
                    onclick={(e) => {
                      e.stopPropagation()
                      void trackScopedModuleMutation(rmodule.id, () => toggleSelectedChatModule(rmodule.id))
                    }}
                    oncontextmenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void trackScopedModuleMutation(rmodule.id, () => toggleSelectedCharacterModule(rmodule.id))
                    }}>
                    <CircleCheckIcon size={18} />
                  </button>
                {/if}
              </div>
            </div>
            {#if !alertMode && scopedModuleMutationStates[rmodule.id]?.status === 'failed'}
              <div
                data-module-mutation-status={rmodule.id}
                class={scopedModuleMutationStates[rmodule.id]?.status === 'failed'
                  ? 'mt-1 pr-2 text-xs text-draculared'
                  : 'mt-1 pr-2 text-xs text-textcolor2'}
                role={scopedModuleMutationStates[rmodule.id]?.status === 'failed' ? 'alert' : 'status'}>
                {scopedModuleMutationStatus(rmodule.id)}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
    <div>
      <Button
        className="mt-4 grow-0"
        size="sm"
        onclick={() => {
          $SettingsMenuIndex = 14
          $settingsOpen = true
          close('')
        }}>{language.edit}</Button>
    </div>
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
</style>
