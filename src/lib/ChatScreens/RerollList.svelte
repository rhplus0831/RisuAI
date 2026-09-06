<script lang="ts">
  import { CheckIcon, RefreshCcwIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { getRerollCandidates } from 'src/ts/process/rerollNavigation.svelte'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import type { Message } from 'src/ts/storage/database.svelte'

  let {
    currentMessage = '',
    target = null,
    disabled = false,
    onSelectRerollCandidate = async () => {},
    onNewReroll = async () => {},
  }: {
    currentMessage?: string
    target?: ActiveChatTarget | null
    disabled?: boolean
    onSelectRerollCandidate?: (index: number) => void | Promise<void>
    onNewReroll?: () => void | Promise<void>
  } = $props()

  const candidates = $derived(getRerollCandidates(target))

  function messageText(message: Message): string {
    return typeof message.data === 'string' ? message.data : ''
  }

  function candidatePreview(messages: readonly Message[]): string {
    const text = messages
      .map(messageText)
      .join('\n')
      .replace(/\{\{specialcomment::.*?\}\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return text || language.rerollCandidate
  }

  const currentPreview = $derived(currentMessage.replace(/\s+/g, ' ').trim() || language.rerollCandidate)
</script>

<div class="reroll-list flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2">
  {#if candidates.length > 0}
    <div class="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
      {#each candidates as candidate (candidate.index)}
        <button
          aria-pressed={candidate.active}
          class="reroll-candidate flex w-full min-w-0 items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors"
          class:border-selected={candidate.active}
          class:border-darkborderc={!candidate.active}
          class:bg-selected={candidate.active}
          class:bg-darkbutton={!candidate.active}
          class:text-textcolor={candidate.active}
          class:text-textcolor2={!candidate.active}
          class:cursor-not-allowed={disabled}
          class:opacity-50={disabled}
          {disabled}
          onclick={async () => {
            if (disabled) return
            await onSelectRerollCandidate(candidate.index)
          }}>
          <span class="mt-0.5 shrink-0 text-xs tabular-nums text-textcolor2">{candidate.index + 1}</span>
          <span class="reroll-candidate-preview min-w-0 grow text-sm leading-5">
            {candidatePreview(candidate.messages)}
          </span>
          {#if candidate.active}
            <CheckIcon size={16} class="mt-0.5 shrink-0 text-blue-400" />
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <div
      class="reroll-candidate flex w-full min-w-0 items-start gap-2 rounded-md border border-selected bg-selected px-2 py-2 text-left text-textcolor">
      <span class="mt-0.5 shrink-0 text-xs tabular-nums text-textcolor2">1</span>
      <span class="reroll-candidate-preview min-w-0 grow text-sm leading-5">
        {currentPreview}
      </span>
      <CheckIcon size={16} class="mt-0.5 shrink-0 text-blue-400" />
    </div>
  {/if}

  <button
    class="button-icon-new-reroll flex w-full items-center justify-center gap-2 rounded-md border border-darkborderc bg-darkbutton px-3 py-2 text-sm text-textcolor transition-colors hover:bg-selected hover:text-blue-400"
    class:cursor-not-allowed={disabled}
    class:opacity-50={disabled}
    {disabled}
    onclick={async () => {
      if (disabled) return
      await onNewReroll()
    }}>
    <RefreshCcwIcon size={18} />
    <span>{language.newReroll}</span>
  </button>
</div>

<style>
  .reroll-candidate-preview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
</style>
