<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { language } from '../../lang'

  import {
    DBState,
    selectedCharID,
    type GenerationSettingsPickerMode,
  } from 'src/ts/stores.svelte'
  import { changeUserPersona, normalizePersonaIds } from 'src/ts/persona'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelection,
  } from 'src/ts/activeChatGenerationSettings'

  interface Props {
    close?: any
    mode?: GenerationSettingsPickerMode
  }

  let { close = () => {}, mode = 'global' }: Props = $props()
  let isChatGenerationSelectionMode = $derived(mode === 'active-chat-generation-settings')
  let activeChatPersonaId = $derived.by(() => {
    if (!isChatGenerationSelectionMode) return null
    return (
      resolveActiveChatGenerationSettings({
        selectedCharIndex: $selectedCharID,
      }).settings?.personaId ?? null
    )
  })

  function nonEmptyId(id: unknown): string | null {
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }

  function selectPersona(index: number) {
    if (isChatGenerationSelectionMode) {
      normalizePersonaIds()
      const personaId = nonEmptyId(DBState.db.personas[index]?.id)
      if (!personaId) return
      if (saveActiveChatGenerationSettingsSelection({ personaId })) {
        close()
      }
      return
    }

    changeUserPersona(index)
    close()
  }

  function isPersonaSelected(index: number) {
    if (!isChatGenerationSelectionMode) {
      return index === DBState.db.selectedPersona
    }
    const personaId = nonEmptyId(DBState.db.personas[index]?.id)
    return !!personaId && personaId === activeChatPersonaId
  }
</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
  <div
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-96 max-h-full overflow-y-auto"
  >
    <div class="flex items-center text-textcolor mb-4">
      <h2 class="mt-0 mb-0 font-bold">{language.persona}</h2>
      <div class="grow flex justify-end">
        <button
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          onclick={close}
        >
          <XIcon size={24} />
        </button>
      </div>
    </div>
    {#each DBState.db.personas as persona, i}
      <button
        onclick={() => {
          selectPersona(i)
        }}
        class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
        class:bg-selected={isPersonaSelected(i)}
      >
        <span class="overflow-x-auto whitespace-nowrap w-full text-left">
          <span class="font-medium">{persona.name}</span>
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
