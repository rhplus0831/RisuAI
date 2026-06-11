<script lang="ts">
  let { openedData = $bindable(), children } = $props()

  void openedData
</script>

<div data-testid="app-marker" data-risu-test-marker="app-marker">
  {@render children?.()}
</div>
