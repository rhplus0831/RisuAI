<script lang="ts">
  import { popupStore } from 'src/ts/stores.svelte'
  import PopupButton from './PopupButton.svelte'
  import PopupList from './PopupList.svelte'
</script>

<PopupButton>
  <button data-testid="popup-content">First action</button>
  <button data-testid="popup-second-action">Second action</button>
</PopupButton>
<!-- Mirror App.svelte: PopupList mounts only while a popup is open, so its
     deferred document listener attaches per open, not once per app load. -->
{#if popupStore.children}
  <PopupList />
{/if}
