<script lang="ts">
  import { LoaderCircleIcon, RefreshCcwIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import {
    characterShellHydrationState,
    retryCharacterShellHydration,
  } from 'src/ts/server/characterShellHydration.svelte'

  let { characterId }: { characterId: string } = $props()
  let hydration = $derived(characterShellHydrationState.rows[characterId])
</script>

<div class="flex h-full grow items-center justify-center bg-bgcolor px-6" data-character-shell-hydration-gate>
  {#if hydration?.status === 'error'}
    <div class="flex flex-col items-center gap-3 text-center text-textcolor2" role="alert">
      <span class="text-sm">{language.characterDataLoadFailed}</span>
      <button
        type="button"
        data-testid="character-hydration-retry"
        class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor transition-colors hover:border-textcolor hover:bg-selected focus:border-textcolor focus:bg-selected"
        onclick={() => void retryCharacterShellHydration(characterId)}>
        <RefreshCcwIcon size={16} />
        <span>{language.retry}</span>
      </button>
    </div>
  {:else}
    <div
      class="flex flex-col items-center text-textcolor2"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="character-hydration-loading">
      <LoaderCircleIcon size={24} class="risu-ongoing-pulse mb-3 animate-spin" aria-hidden="true" />
      <span class="text-sm">{language.loadingCharacter}</span>
    </div>
  {/if}
</div>
