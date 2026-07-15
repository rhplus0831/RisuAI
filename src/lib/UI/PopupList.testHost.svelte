<script lang="ts">
  import PopupButton from './PopupButton.svelte'
  import PopupList from './PopupList.svelte'
</script>

<PopupButton>
  <button data-testid="popup-content">First action</button>
  <button data-testid="popup-second-action">Second action</button>
</PopupButton>
<PopupList />
