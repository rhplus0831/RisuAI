<script lang="ts">
  import SideChatList from './SideChatList.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import { getDatabase } from 'src/ts/storage/database.svelte'
</script>

{#if $selectedCharID >= 0 && getDatabase().characters?.[$selectedCharID]}
  <SideChatList chara={getDatabase().characters[$selectedCharID]} />
{/if}
