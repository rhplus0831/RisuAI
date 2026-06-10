<script lang="ts">
  import SideChatList from './SideChatList.svelte'
  import { DBState, selectedCharID } from 'src/ts/stores.svelte'
</script>

{#if $selectedCharID >= 0 && DBState.db.characters?.[$selectedCharID]}
  <SideChatList bind:chara={DBState.db.characters[$selectedCharID]} />
{/if}
