<script lang="ts">
  import { showRealmInfoStore } from 'src/ts/realmInfoStore'
  import RealmPopUp from './RealmPopUp.svelte'
</script>

{#if $showRealmInfoStore}
  <RealmPopUp bind:openedData={$showRealmInfoStore} />
{/if}
