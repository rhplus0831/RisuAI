<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { language } from '../../lang'
  import { alertError, alertNormal } from 'src/ts/alert'

  import { selectedCharID, type GenerationSettingsPickerMode } from 'src/ts/stores.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { changeUserPersonaWithOutcome, validUniquePersonaIdAt } from 'src/ts/persona'
  import { getPersonaDisplayName } from 'src/ts/personaDisplayName'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    close?: any
    mode?: GenerationSettingsPickerMode
    target?: ActiveChatTarget | null
  }

  let { close = () => {}, mode = 'global', target = null }: Props = $props()
  let isChatGenerationSelectionMode = $derived(mode === 'active-chat-generation-settings')
  let activeChatPersonaId = $derived.by(() => {
    if (!isChatGenerationSelectionMode) return null
    return (
      resolveActiveChatGenerationSettings({
        selectedCharIndex: $selectedCharID,
      }).settings?.personaId ?? null
    )
  })
  let mutationPending = $state(false)
  let mutationError = $state('')

  function nonEmptyId(id: unknown): string | null {
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }

  async function selectPersona(index: number): Promise<void> {
    if (mutationPending) return
    mutationPending = true
    mutationError = ''
    try {
      if (isChatGenerationSelectionMode) {
        const personaId = validUniquePersonaIdAt(index)
        if (!personaId) return
        const persistence = saveActiveChatGenerationSettingsSelectionWithOutcome(
          { personaId },
          { expectedTarget: target },
        )
        if (!persistence) {
          mutationError = language.chatGenerationSettingsSaveFailed(language.chatGenerationSettingsTargetChanged)
          alertError(mutationError)
          return
        }
        const result = await persistence.settlement
        if (result.status === 'failed') {
          mutationError = language.chatGenerationSettingsSaveFailed(result.error)
          alertError(mutationError)
          return
        }
        if (result.status === 'queued') alertNormal(language.settingsSaveQueued)
        close()
        return
      }

      const persistence = changeUserPersonaWithOutcome(index)
      if (!persistence) {
        mutationError = language.personaMutationFailed
        return
      }
      const status = await persistence
      if (status === 'failed') {
        mutationError = language.personaMutationFailed
        return
      }
      if (status === 'queued') alertNormal(language.personaMutationQueued)
      close()
    } catch (error) {
      mutationError = isChatGenerationSelectionMode
        ? language.chatGenerationSettingsSaveFailed(error instanceof Error ? error.message : '')
        : language.personaMutationFailed
      if (isChatGenerationSelectionMode) alertError(mutationError)
    } finally {
      mutationPending = false
    }
  }

  function isPersonaSelected(index: number) {
    if (!isChatGenerationSelectionMode) {
      return index === getDatabase().selectedPersona
    }
    const personaId = nonEmptyId(getDatabase().personas[index]?.id)
    return !!personaId && personaId === activeChatPersonaId
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!mutationPending) close()
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !mutationPending) close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center"
  onclick={handleBackdropClick}>
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-96 max-h-full overflow-y-auto"
    data-risu-generation-picker
    data-risu-picker-kind="persona"
    data-risu-picker-mode={mode}
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-persona-picker-title"
    aria-busy={mutationPending}
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 id="risu-persona-picker-title" class="mt-0 mb-0 font-bold">{language.persona}</h2>
      <div class="grow flex justify-end">
        <button
          data-modal-initial-focus
          disabled={mutationPending}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={() => {
            if (!mutationPending) close()
          }}>
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#if mutationError}
      <div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
        {mutationError}
      </div>
    {/if}
    {#each getDatabase().personas as persona, i}
      <button
        disabled={mutationPending}
        onclick={async () => {
          await selectPersona(i)
        }}
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={isPersonaSelected(i)}
        data-risu-generation-picker-row
        data-risu-picker-kind="persona"
        data-risu-picker-mode={mode}
        data-risu-row-id={nonEmptyId(persona.id) ?? ''}
        data-risu-row-index={i}
        data-risu-selected={isPersonaSelected(i) ? 'true' : 'false'}
        aria-pressed={isPersonaSelected(i)}
        aria-current={isPersonaSelected(i) ? 'true' : undefined}>
        <span class="overflow-x-auto whitespace-nowrap w-full text-left">
          <span class="font-medium">{getPersonaDisplayName(persona)}</span>
          {#if persona.note}
            <span class="opacity-75"> / {persona.note}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
</style>
