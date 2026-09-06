<script lang="ts">
  import { SaveIcon } from '@lucide/svelte'
  import { saving } from 'src/ts/globalApi.svelte'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'

  let showSavingIcon = $derived(
    settingsResourceState.status !== 'error' &&
      settingsResourceState.groupStatuses.display !== 'error' &&
      (settingsResourceState.groupStatuses.display === 'ready' || settingsResourceState.shellRevision !== null) &&
      settingsResourceState.value.showSavingIcon === true,
  )
</script>

{#if showSavingIcon && saving.state}
  <div
    class="absolute top-3 right-3 z-10 text-white p-2 rounded-sm bg-linear-to-br from-blue-500 to-purple-800 saving-animation pointer-events-none opacity-15">
    <SaveIcon size={24} />
  </div>
{/if}
