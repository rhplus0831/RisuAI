<script lang="ts">
  import GlobalLoreBookSettings from './GlobalLoreBookSettings.svelte'
  import Lorepreset from '../lorepreset.svelte'

  let openLoreList = $state(false)
</script>

<GlobalLoreBookSettings bind:openLoreList />

{#if openLoreList}
  <Lorepreset close={() => (openLoreList = false)} />
{/if}
