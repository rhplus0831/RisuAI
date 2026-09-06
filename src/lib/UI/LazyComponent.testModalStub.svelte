<script lang="ts">
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  let open = $state(true)
</script>

{#if open}
  <div data-modal-root>
    <div use:modalFocusTrap role="dialog" aria-modal="true" tabindex="-1">
      <button data-modal-initial-focus data-testid="lazy-modal-close" onclick={() => (open = false)}>Close</button>
    </div>
  </div>
{/if}
