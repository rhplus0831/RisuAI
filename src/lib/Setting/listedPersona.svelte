<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { language } from '../../lang'
  import { alertError, alertNormal } from 'src/ts/alert'

  import { selectedCharID, type GenerationSettingsPickerMode } from 'src/ts/stores.svelte'
  import { collectionsResourceState, getPersonaOwnerStateSnapshot } from 'src/ts/server/resourceState.svelte'
  import { changeUserPersonaWithOutcome } from 'src/ts/persona'
  import { getPersonaDisplayName } from 'src/ts/personaDisplayName'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
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
  let personaOwner = $derived(getPersonaOwnerStateSnapshot())
  let personas = $derived(
    isChatGenerationSelectionMode ? readPersonaOwners() : (uniquePersonaOwners(personaOwner?.personas) ?? []),
  )
  let selectedPersonaId = $derived(personaOwner?.selectedPersonaId ?? null)

  function nonEmptyId(id: unknown): string | null {
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }

  async function selectPersona(index: number): Promise<void> {
    if (mutationPending) return
    mutationPending = true
    mutationError = ''
    try {
      if (isChatGenerationSelectionMode) {
        const personaId = uniquePersonaIdAt(index)
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

  function isPersonaSelected(persona: PersonaOwner) {
    const personaId = nonEmptyId(persona.id)
    if (!personaId) return false
    if (!isChatGenerationSelectionMode) {
      return personaId === selectedPersonaId
    }
    return personaId === activeChatPersonaId
  }

  function readPersonaOwners(): readonly PersonaOwner[] {
    const ownerValue = collectionsResourceState.values.personas
    const owners = uniquePersonaOwners(ownerValue)
    if (collectionsResourceState.statuses.personas === 'error') return []
    return owners ?? []
  }

  function uniquePersonaOwners(value: unknown): readonly PersonaOwner[] | undefined {
    if (!Array.isArray(value)) return undefined

    const ids = new Set<string>()
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
      const id = (candidate as { id?: unknown }).id
      if (typeof id !== 'string' || id.trim() !== id || id.length === 0 || ids.has(id)) return undefined
      ids.add(id)
    }
    return value as PersonaOwner[]
  }

  function uniquePersonaIdAt(index: number): string | null {
    const id = nonEmptyId(personas[index]?.id)
    if (!id) return null
    return personas.filter((persona) => nonEmptyId(persona.id) === id).length === 1 ? id : null
  }

  interface PersonaOwner {
    id: string
    name?: string
    displayName?: string
    note?: string
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!mutationPending) close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={() => {
    if (!mutationPending) close()
  }}
  data-modal-root
  class="fixed inset-0 z-40 bg-black/50 flex justify-center items-center">
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
    {#each personas as persona, i}
      <button
        disabled={mutationPending}
        onclick={async () => {
          await selectPersona(i)
        }}
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={isPersonaSelected(persona)}
        data-risu-generation-picker-row
        data-risu-picker-kind="persona"
        data-risu-picker-mode={mode}
        data-risu-row-id={nonEmptyId(persona.id) ?? ''}
        data-risu-row-index={i}
        data-risu-selected={isPersonaSelected(persona) ? 'true' : 'false'}
        aria-pressed={isPersonaSelected(persona)}
        aria-current={isPersonaSelected(persona) ? 'true' : undefined}>
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
